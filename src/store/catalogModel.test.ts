import { describe, expect, it } from "vitest";
import {
  CatalogFormatError,
  applyPercent,
  bestDiscountPercent,
  buildCategoryTree,
  findVariant,
  optionAvailable,
  parseCatalogSnapshot,
  productPriceView,
  variantOptions,
  variantPriceView,
} from "./catalogModel";
import {
  demoPhone,
  fixtureCategory,
  fixtureDiscounts,
  fixtureProduct,
  fixtureSnapshot,
  fixtureVariant,
  linenShirt,
  poloShirt,
} from "../test-support/catalogFixtures";
import type { CatalogDiscount } from "../api/catalog";

const NOW = new Date("2026-10-31T12:00:00.000Z");

describe("catalog snapshot boundary", () => {
  it("accepts a canonical public snapshot", () => {
    const snapshot = fixtureSnapshot();
    expect(parseCatalogSnapshot(snapshot, ["live", "demo"]).products).toHaveLength(snapshot.products.length);
  });

  it("rejects malformed, legacy and wrong-audience responses instead of returning an empty catalog", () => {
    expect(() => parseCatalogSnapshot(null, ["live"])).toThrow(CatalogFormatError);
    expect(() => parseCatalogSnapshot({ stock: {}, discounts: [] }, ["live"])).toThrow(CatalogFormatError);
    expect(() => parseCatalogSnapshot({ ...fixtureSnapshot(), version: 1 }, ["live", "demo"])).toThrow(CatalogFormatError);
    expect(() => parseCatalogSnapshot(fixtureSnapshot({ mode: "admin" }), ["live", "demo"])).toThrow(/unexpected admin mode/);
    const broken = { ...fixtureSnapshot(), products: [{ ...linenShirt, variants: [{ id: "missing-fields" }] }] };
    expect(() => parseCatalogSnapshot(broken, ["demo"])).toThrow(/products/);
  });
});

describe("variant resolution", () => {
  it("lists only offered option values and matches an exact active SKU", () => {
    expect(variantOptions(linenShirt)).toEqual([
      { key: "size", values: ["S", "M"] },
      { key: "color", values: ["White", "Blue"] },
    ]);
    expect(findVariant(linenShirt, { size: "M", color: "Blue" })?.id).toBe("var-linen-m-blue");
  });

  it("never substitutes the first SKU for an incomplete, unknown or inactive combination", () => {
    expect(findVariant(linenShirt, { size: "S" })).toBeUndefined();
    expect(findVariant(linenShirt, { size: "S", color: "Blue" })).toBeUndefined();
    expect(findVariant(linenShirt, { size: "M", color: "White", fit: "Slim" })).toBeUndefined();
    const retired = { ...linenShirt, variants: linenShirt.variants.map((variant) => ({ ...variant, isActive: variant.id !== "var-linen-s-white" })) };
    expect(findVariant(retired, { size: "S", color: "White" })).toBeUndefined();
    expect(optionAvailable(linenShirt, { color: "Blue" }, "size", "S")).toBe(false);
    expect(optionAvailable(linenShirt, { color: "Blue" }, "size", "M")).toBe(true);
  });

  it("resolves a single default SKU with no options", () => {
    expect(variantOptions(poloShirt)).toEqual([]);
    expect(findVariant(poloShirt, {})?.id).toBe("var-polo");
  });
});

describe("price preview", () => {
  it("applies one 10% discount to KES 1,000 as KES 900 and leaves other products unchanged", () => {
    expect(variantPriceView(linenShirt, linenShirt.variants[0], fixtureDiscounts, NOW)).toMatchObject({
      price: 900, originalPrice: 1000, comparePrice: 1000, discountPercent: 10,
    });
    expect(productPriceView(poloShirt, fixtureDiscounts, NOW)).toMatchObject({ price: 2200, discountPercent: 0, comparePrice: null });
  });

  it("uses the highest active percentage without stacking and ignores fixed, paused and expired discounts", () => {
    const discounts: CatalogDiscount[] = [
      { ...fixtureDiscounts[0], id: "a", value: 10 },
      { ...fixtureDiscounts[0], id: "b", value: 25, applyTo: "CATEGORY", targetIds: ["cat-fashion"] },
      { ...fixtureDiscounts[0], id: "c", value: 60, isActive: false },
      { ...fixtureDiscounts[0], id: "d", value: 70, endDate: "2001-01-01T00:00:00.000Z" },
      { ...fixtureDiscounts[0], id: "e", value: 80, startDate: "2099-01-01T00:00:00.000Z" },
      { ...fixtureDiscounts[0], id: "f", type: "FIXED", value: 500 },
    ];
    expect(bestDiscountPercent(linenShirt, discounts, NOW)).toBe(25);
    expect(applyPercent(1000, 25)).toBe(750);
  });

  it("applies category discounts to descendants only", () => {
    const category: CatalogDiscount = { ...fixtureDiscounts[0], applyTo: "CATEGORY", targetIds: ["cat-men"] };
    expect(bestDiscountPercent(linenShirt, [category], NOW)).toBe(10);
    expect(bestDiscountPercent(demoPhone, [{ ...category, isDemo: true }], NOW)).toBe(0);
  });

  it("keeps demo promotions off real products", () => {
    expect(bestDiscountPercent(poloShirt, fixtureDiscounts, NOW)).toBe(0);
    expect(bestDiscountPercent(demoPhone, fixtureDiscounts, NOW)).toBe(50);
  });

  it("shows the lowest active SKU as a from-price on cards when SKU prices differ", () => {
    const product = fixtureProduct({
      id: "multi-price",
      name: "Multi price",
      price: 1000,
      variants: [
        fixtureVariant({ id: "v1", attributes: { size: "S" }, price: 1000 }),
        fixtureVariant({ id: "v2", attributes: { size: "L" }, price: 1200 }),
        fixtureVariant({ id: "v3", attributes: { size: "XS" }, price: 500, isActive: false }),
      ],
    });
    expect(productPriceView(product, [], NOW)).toMatchObject({ price: 1000, isFromPrice: true });
    expect(productPriceView(poloShirt, [], NOW).isFromPrice).toBe(false);
  });

  it("only strikes through a merchant compare-at price for SKUs at the base price", () => {
    const product = fixtureProduct({
      id: "compare",
      name: "Compare",
      price: 1000,
      comparePrice: 1500,
      variants: [fixtureVariant({ id: "base", attributes: { size: "S" } }), fixtureVariant({ id: "override", attributes: { size: "L" }, price: 1600 })],
    });
    expect(variantPriceView(product, product.variants[0], [], NOW).comparePrice).toBe(1500);
    expect(variantPriceView(product, product.variants[1], [], NOW).comparePrice).toBeNull();
  });
});

describe("category tree", () => {
  it("orders departments, finds children and builds root-to-leaf paths", () => {
    const tree = buildCategoryTree(fixtureSnapshot().categories);
    expect(tree.roots.map((category) => category.name)).toEqual(["Phones & Tablets", "Fashion"]);
    expect(tree.children("cat-men").map((category) => category.id)).toEqual(["cat-shirts"]);
    expect(tree.path("cat-shirts").map((category) => category.id)).toEqual(["cat-fashion", "cat-men", "cat-shirts"]);
    expect(tree.bySlug.get("smartphones")?.id).toBe("cat-smartphones");
  });

  it("stops at a cycle or missing parent instead of looping", () => {
    const tree = buildCategoryTree([
      fixtureCategory({ id: "a", name: "A", parentId: "b" }),
      fixtureCategory({ id: "b", name: "B", parentId: "a" }),
      fixtureCategory({ id: "orphan", name: "Orphan", parentId: "gone" }),
    ]);
    expect(tree.path("a").map((category) => category.id)).toEqual(["b", "a"]);
    expect(tree.path("orphan").map((category) => category.id)).toEqual(["orphan"]);
  });
});
