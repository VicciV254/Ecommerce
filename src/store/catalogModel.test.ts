import { describe, expect, it } from "vitest";
import {
  CatalogFormatError,
  buildCategoryTree,
  discountAppliesTo,
  findVariant,
  isDiscountActive,
  isMoney,
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
  listPricing,
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

describe("server price projection", () => {
  it("displays the server's 10% projection on KES 1,000 as KES 900 and leaves other products unchanged", () => {
    expect(variantPriceView(linenShirt.variants[0])).toEqual({
      price: 900, originalPrice: 1000, comparePrice: 1000, discountPercent: 10, isFromPrice: false,
    });
    expect(productPriceView(poloShirt)).toMatchObject({ price: 2200, discountPercent: 0, comparePrice: null, isFromPrice: false });
  });

  it("never recomputes a price from base fields or snapshot discounts", () => {
    // The base price and an active storewide discount both disagree with the projection; only the projection is shown.
    const product = fixtureProduct({
      id: "projected", name: "Projected", price: 5000,
      variants: [fixtureVariant({ id: "projected-sku", price: 5000, pricing: listPricing(4321.5) })],
    });
    const storewide: CatalogDiscount = { ...fixtureDiscounts[0], applyTo: "ALL", targetIds: [], value: 50 };
    expect(discountAppliesTo(storewide, product)).toBe(true);
    expect(productPriceView(product)).toMatchObject({ price: 4321.5, originalPrice: 4321.5, discountPercent: 0 });
  });

  it("shows the cheapest active SKU projection as a from-price and nothing when no SKU is sellable", () => {
    const product = fixtureProduct({
      id: "multi-price",
      name: "Multi price",
      variants: [
        fixtureVariant({ id: "v1", attributes: { size: "S" }, price: 1000 }),
        fixtureVariant({
          id: "v2", attributes: { size: "L" }, price: 1200,
          pricing: { price: 960, originalPrice: 1200, comparePrice: 1200, discountPercent: 20, discountId: "disc-l" },
        }),
        fixtureVariant({ id: "v3", attributes: { size: "XS" }, price: 500, isActive: false }),
      ],
    });
    expect(productPriceView(product)).toEqual({ price: 960, originalPrice: 1200, comparePrice: 1200, discountPercent: 20, isFromPrice: true });
    expect(productPriceView(poloShirt)?.isFromPrice).toBe(false);
    const retired = { ...product, variants: product.variants.map((variant) => ({ ...variant, isActive: false })) };
    expect(productPriceView(retired)).toBeNull();
  });

  it("rejects missing or malformed projections and stock counts instead of falling back", () => {
    const withVariant = (patch: Record<string, unknown>) =>
      ({ ...fixtureSnapshot(), products: [{ ...poloShirt, variants: [{ ...poloShirt.variants[0], ...patch }] }] });
    expect(() => parseCatalogSnapshot(withVariant({ pricing: undefined }), ["demo"])).toThrow(/products/);
    expect(() => parseCatalogSnapshot(withVariant({ pricing: { ...listPricing(2200), price: "2200" } }), ["demo"])).toThrow(CatalogFormatError);
    expect(() => parseCatalogSnapshot(withVariant({ pricing: { ...listPricing(2200), price: 2199.999 } }), ["demo"])).toThrow(CatalogFormatError);
    expect(() => parseCatalogSnapshot(withVariant({ pricing: { ...listPricing(2200), comparePrice: -1 } }), ["demo"])).toThrow(CatalogFormatError);
    expect(() => parseCatalogSnapshot(withVariant({ reserved: undefined }), ["demo"])).toThrow(CatalogFormatError);
    expect(() => parseCatalogSnapshot(withVariant({ onHand: 1.5 }), ["demo"])).toThrow(CatalogFormatError);
    const valid = parseCatalogSnapshot(withVariant({ pricing: listPricing(2199.5), onHand: 5, reserved: 2, stock: 3 }), ["demo"]);
    expect(valid.products[0].variants[0]).toMatchObject({ pricing: { price: 2199.5 }, onHand: 5, reserved: 2, stock: 3 });
  });

  it("accepts only bounded server amounts with at most two decimals", () => {
    for (const amount of [0, 0.29, 1044.4, 999_999_999_999.99]) expect(isMoney(amount)).toBe(true);
    for (const amount of [-0.01, 1.005, 0.1 + 0.2, Number.NaN, Number.POSITIVE_INFINITY, 1e21, "10"]) expect(isMoney(amount)).toBe(false);
  });
});

describe("staff discount status", () => {
  it("reports the active window and matches category descendants without touching other modes", () => {
    const category: CatalogDiscount = { ...fixtureDiscounts[0], applyTo: "CATEGORY", targetIds: ["cat-men"] };
    expect(isDiscountActive(category, NOW)).toBe(true);
    expect(isDiscountActive({ ...category, isActive: false }, NOW)).toBe(false);
    expect(isDiscountActive({ ...category, endDate: "2001-01-01T00:00:00.000Z" }, NOW)).toBe(false);
    expect(isDiscountActive({ ...category, startDate: "2099-01-01T00:00:00.000Z" }, NOW)).toBe(false);
    expect(discountAppliesTo(category, linenShirt)).toBe(true);
    expect(discountAppliesTo(category, demoPhone)).toBe(false);
    expect(discountAppliesTo(fixtureDiscounts[1], poloShirt)).toBe(false);
    expect(discountAppliesTo(fixtureDiscounts[1], demoPhone)).toBe(true);
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
