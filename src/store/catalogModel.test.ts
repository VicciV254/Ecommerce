import { describe, expect, it } from "vitest";
import {
  CatalogFormatError,
  buildCategoryTree,
  discountAppliesTo,
  findVariant,
  isDiscountActive,
  isMoney,
  optionAvailable,
  parseAdminCatalogSnapshot,
  parseCatalogSnapshot,
  productPriceView,
  variantOptions,
  variantPriceView,
} from "./catalogModel";
import {
  FIXTURE_VERSION,
  demoPhone,
  fixtureAdminSnapshot,
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

  it("says whether sample orders can be paid with a demonstration payment; an older backend that omits it offers none", () => {
    expect(parseCatalogSnapshot(fixtureSnapshot({ demonstrationOrders: true }), ["demo"]).demonstrationOrders).toBe(true);
    expect(parseCatalogSnapshot(fixtureSnapshot(), ["demo"]).demonstrationOrders).toBe(false);
    expect(parseAdminCatalogSnapshot(fixtureAdminSnapshot({ demonstrationOrders: true })).demonstrationOrders).toBe(true);
    const { demonstrationOrders: _public, ...publicWithout } = fixtureSnapshot({ demonstrationOrders: true });
    const { demonstrationOrders: _admin, ...adminWithout } = fixtureAdminSnapshot({ demonstrationOrders: true });
    expect(parseCatalogSnapshot(publicWithout, ["demo"]).demonstrationOrders).toBe(false);
    expect(parseAdminCatalogSnapshot(adminWithout).demonstrationOrders).toBe(false);
    for (const value of ["true", 1, null, 0, {}]) {
      expect(() => parseCatalogSnapshot({ ...fixtureSnapshot(), demonstrationOrders: value }, ["demo"]), JSON.stringify(value))
        .toThrow(CatalogFormatError);
      expect(() => parseAdminCatalogSnapshot({ ...fixtureAdminSnapshot(), demonstrationOrders: value }), JSON.stringify(value))
        .toThrow(/demonstration orders/);
    }
  });

  it("says after how many days sample orders are deleted, null where none are or an older backend omits it", () => {
    for (const days of [1, 7, 3650]) {
      expect(parseCatalogSnapshot(fixtureSnapshot({ sampleOrderRetentionDays: days }), ["demo"]).sampleOrderRetentionDays).toBe(days);
      expect(parseAdminCatalogSnapshot(fixtureAdminSnapshot({ sampleOrderRetentionDays: days })).sampleOrderRetentionDays).toBe(days);
    }
    expect(parseCatalogSnapshot(fixtureSnapshot({ sampleOrderRetentionDays: null }), ["demo"]).sampleOrderRetentionDays).toBeNull();
    const { sampleOrderRetentionDays: _public, ...publicWithout } = fixtureSnapshot({ sampleOrderRetentionDays: 7 });
    const { sampleOrderRetentionDays: _admin, ...adminWithout } = fixtureAdminSnapshot({ sampleOrderRetentionDays: 7 });
    expect(parseCatalogSnapshot(publicWithout, ["live", "demo"]).sampleOrderRetentionDays).toBeNull();
    expect(parseAdminCatalogSnapshot(adminWithout).sampleOrderRetentionDays).toBeNull();
    for (const value of ["7", 0, -1, 1.5, 3651, true, Number.NaN, {}]) {
      expect(() => parseCatalogSnapshot({ ...fixtureSnapshot(), sampleOrderRetentionDays: value }, ["demo"]), String(value))
        .toThrow(CatalogFormatError);
      expect(() => parseAdminCatalogSnapshot({ ...fixtureAdminSnapshot(), sampleOrderRetentionDays: value }), String(value))
        .toThrow(/sample order retention/);
    }
  });

  it("carries each product's return rule and the catalog's return terms, rejecting unknown or missing ones", () => {
    const snapshot = fixtureSnapshot({ products: [{ ...linenShirt, returnRule: "UNOPENED_OR_FAULT" }] });
    const parsed = parseCatalogSnapshot(snapshot, ["demo"]);
    expect(parsed.products[0].returnRule).toBe("UNOPENED_OR_FAULT");
    expect(parsed.returnPolicy).toEqual({
      version: 1, windowDays: 7, deliveryFeeRefund: "MERCHANT_FAULT_ONLY", partialReturns: true, refundRounding: "UP_TO_WHOLE_KES",
    });
    const { returnRule: _rule, ...ruleless } = linenShirt;
    const { returnPolicy: _policy, ...policyless } = snapshot;
    expect(() => parseCatalogSnapshot({ ...snapshot, products: [ruleless] }, ["demo"])).toThrow(/products/);
    expect(() => parseCatalogSnapshot({ ...snapshot, products: [{ ...linenShirt, returnRule: "EXCHANGE_ONLY" }] }, ["demo"])).toThrow(/products/);
    expect(() => parseCatalogSnapshot(policyless, ["demo"])).toThrow(/return policy/);
    expect(() => parseCatalogSnapshot({ ...snapshot, returnPolicy: { ...snapshot.returnPolicy, windowDays: 0 } }, ["demo"])).toThrow(/return policy/);
    expect(() => parseCatalogSnapshot({ ...snapshot, returnPolicy: { ...snapshot.returnPolicy, deliveryFeeRefund: "SOMETIMES" } }, ["demo"]))
      .toThrow(/return policy/);
  });

  it("carries the offered delivery methods in order, and fails the snapshot when they are missing or malformed", () => {
    const snapshot = fixtureSnapshot();
    expect(parseCatalogSnapshot(snapshot, ["demo"]).delivery).toEqual([
      { method: "STANDARD", fee: 200, freeAbove: null, counties: [] },
      { method: "SAME_DAY", fee: 500, freeAbove: null, counties: ["Nairobi"] },
    ]);
    const legacy = [{ method: "STORE_PICKUP", fee: 0, freeAbove: 5000, counties: [] }, ...snapshot.delivery];
    expect(parseCatalogSnapshot({ ...snapshot, delivery: legacy }, ["demo"]).delivery.map((option) => option.method))
      .toEqual(["STORE_PICKUP", "STANDARD", "SAME_DAY"]);
    expect(parseAdminCatalogSnapshot(fixtureAdminSnapshot()).delivery).toEqual(snapshot.delivery);

    const { delivery: _delivery, ...deliveryless } = snapshot;
    const standard = snapshot.delivery[0];
    for (const delivery of [
      undefined, null, [], {}, [{ ...standard, method: "COURIER" }], [standard, { ...standard, fee: 300 }],
      [{ ...standard, fee: -1 }], [{ ...standard, fee: "200" }], [{ ...standard, fee: 200.001 }], [{ ...standard, freeAbove: undefined }],
      [{ ...standard, freeAbove: "free" }], [{ ...standard, counties: [""] }], [{ ...standard, counties: ["  "] }],
      [{ ...standard, counties: "Nairobi" }], [{ ...standard, counties: [7] }], [{ method: "STANDARD", fee: 200, freeAbove: null }],
    ]) {
      const payload = delivery === undefined ? deliveryless : { ...snapshot, delivery };
      expect(() => parseCatalogSnapshot(payload, ["demo"]), JSON.stringify(delivery)).toThrow(/delivery/);
    }
    expect(() => parseAdminCatalogSnapshot({ ...fixtureAdminSnapshot(), delivery: [] })).toThrow(/delivery/);
  });

  it("carries each category's own return rule or null, and fails the snapshot on an unknown or missing one", () => {
    const [fashion, ...others] = fixtureSnapshot().categories;
    const snapshot = fixtureSnapshot({ categories: [{ ...fashion, returnRule: "FAULT_ONLY" }, ...others] });
    const parsed = parseCatalogSnapshot(snapshot, ["demo"]);
    expect(parsed.categories.map((category) => category.returnRule)).toEqual(["FAULT_ONLY", null, null, null, null]);
    expect(parseAdminCatalogSnapshot(fixtureAdminSnapshot({ categories: snapshot.categories })).categories[0].returnRule).toBe("FAULT_ONLY");

    const { returnRule: _rule, ...ruleless } = fashion;
    for (const category of [ruleless, { ...fashion, returnRule: "EXCHANGE_ONLY" }, { ...fashion, returnRule: "" }, { ...fashion, returnRule: 1 }]) {
      expect(() => parseCatalogSnapshot({ ...snapshot, categories: [category, ...others] }, ["demo"]), JSON.stringify(category))
        .toThrow(/categories/);
    }
  });

  it("reads media fields that older payloads omit as null and keeps uploaded-file facts", () => {
    const { variantId: _variant, format: _format, bytes: _bytes, width: _width, height: _height, ...older } = linenShirt.images[0];
    const uploaded = {
      ...linenShirt.images[1], variantId: "var-linen-m-blue", format: "webp", bytes: 245_000, width: 2400, height: 3000,
      url: "https://res.cloudinary.com/apex-test/image/upload/v1763200000/apex-cart/products/a.webp",
    };
    const parsed = parseCatalogSnapshot({ ...fixtureSnapshot(), products: [{ ...linenShirt, images: [older, uploaded] }] }, ["demo"]);
    const [first, second] = parsed.products[0].images;
    expect([first.variantId, first.format, first.bytes, first.width, first.height]).toEqual([null, null, null, null, null]);
    expect([second.variantId, second.format, second.bytes, second.width, second.height]).toEqual(["var-linen-m-blue", "webp", 245_000, 2400, 3000]);
  });

  it.each([
    ["variantId", 7],
    ["format", 5],
    ["bytes", -1],
    ["bytes", 1.5],
    ["width", "2400"],
  ])("rejects a media %s of %j instead of guessing", (field, value) => {
    const images = [{ ...linenShirt.images[0], [field]: value }];
    expect(() => parseCatalogSnapshot({ ...fixtureSnapshot(), products: [{ ...linenShirt, images }] }, ["demo"])).toThrow(/products/);
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

describe("staff catalog snapshot boundary", () => {
  it("keeps each product's and category's version, as issued by the API", () => {
    const staff = fixtureAdminSnapshot();
    const versions = { ...staff, products: staff.products.map((product, index) => ({ ...product, updatedAt: `2026-11-17T08:00:0${index}.000Z` })) };
    const parsed = parseAdminCatalogSnapshot(versions);
    expect(parsed.mode).toBe("admin");
    expect(parsed.products.map((product) => product.updatedAt)).toEqual(versions.products.map((product) => product.updatedAt));
    expect(parsed.categories.every((category) => category.updatedAt === FIXTURE_VERSION)).toBe(true);
  });

  it("refuses a staff snapshot whose records lack a well-formed version, so no editor saves without one", () => {
    const staff = fixtureAdminSnapshot();
    const [first, ...rest] = staff.products;
    const { updatedAt: _dropped, ...unversioned } = first;
    expect(() => parseAdminCatalogSnapshot({ ...staff, products: [unversioned, ...rest] })).toThrow(/products version/);
    for (const updatedAt of ["2026-11-17T08:00:00Z", "2026-11-17T11:00:00.000+03:00", "yesterday", 1_763_366_400_000, null]) {
      expect(() => parseAdminCatalogSnapshot({ ...staff, categories: [{ ...staff.categories[0], updatedAt }, ...staff.categories.slice(1)] }), String(updatedAt))
        .toThrow(/categories version/);
    }
    expect(() => parseAdminCatalogSnapshot(fixtureSnapshot({ mode: "demo" }))).toThrow(/unexpected demo mode/);
  });
});
