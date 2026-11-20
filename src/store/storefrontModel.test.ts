import { describe, expect, it } from "vitest";
import type { CatalogProduct, StorefrontSettings } from "../api/catalog";
import {
  campaignMedia,
  demoPhone,
  fixtureCategories,
  fixtureStorefront,
  fixtureStorefrontSettings,
  imagelessShirt,
  linenShirt,
  poloShirt,
} from "../test-support/catalogFixtures";
import { buildCategoryTree } from "./catalogModel";
import {
  StorefrontFormatError,
  bestSellerProducts,
  departmentRow,
  isStorefrontSettings,
  parseBestSellers,
  parsePublishedStorefront,
  sectionLayout,
  type CatalogLookup,
  type LayoutKind,
} from "./storefrontModel";

type Section = StorefrontSettings["sections"][number];
const section = (type: string, extra: Record<string, unknown> = {}) =>
  ({ id: type.toLowerCase(), type, title: "Section", enabled: true, productIds: [], categoryIds: [], campaignId: null, ...extra }) as Section;
const lookup = (products: CatalogProduct[]): CatalogLookup => ({
  products, productsById: new Map(products.map((product) => [product.id, product])), categories: buildCategoryTree(fixtureCategories),
});

describe("section kinds and layouts", () => {
  it("accepts the new kinds, and a layout only on the kinds the API gives one", () => {
    const accepts = (...sections: Section[]) => isStorefrontSettings(fixtureStorefrontSettings({ sections }));
    expect(accepts(
      section("category", { categoryIds: ["cat-fashion"], layout: "grid" }), section("promises"),
      section("bestSellers", { title: "Best sellers" }), section("departments", { layout: "grid" }),
      section("featured", { layout: "rail" }), section("products", { productIds: ["prod-1"], layout: "rail" }),
    )).toBe(true);
    expect(accepts(section("featured", { layout: "carousel" }))).toBe(false);
    expect(accepts(section("featured", { layout: null }))).toBe(false);
    expect(accepts(section("promises", { layout: "grid" }))).toBe(false);
    expect(accepts(section("bestSellers", { title: "Best sellers", layout: "rail" }))).toBe(false);
    expect(accepts(section("campaign", { campaignId: "launch", layout: "rail" }))).toBe(false);
  });

  it("reads a missing layout as the kind's established default: rows for departments, grids for products", () => {
    const laidOut = (type: LayoutKind, extra: Record<string, unknown> = {}) => sectionLayout(section(type, extra) as Section & { type: LayoutKind });
    expect(laidOut("departments")).toBe("rail");
    expect(laidOut("featured")).toBe("grid");
    expect(laidOut("products")).toBe("grid");
    expect(laidOut("category")).toBe("rail");
    expect(laidOut("departments", { layout: "grid" })).toBe("grid");
    expect(laidOut("featured", { layout: "rail" })).toBe("rail");
    expect(laidOut("category", { layout: "grid" })).toBe("grid");
  });

  it("shoppers' storefront leaves out sections of a kind this version doesn't know; a staff draft with one is refused whole", () => {
    const later = { ...section("stores"), sellerIds: ["seller-1"] };
    const settings = fixtureStorefrontSettings({ sections: [section("promises"), later, ...fixtureStorefrontSettings().sections] });
    const parsed = parsePublishedStorefront({ ...fixtureStorefront(), settings });
    expect(parsed.settings.sections.map((item) => item.type)).toEqual(["promises", "departments", "featured"]);
    expect(isStorefrontSettings(settings)).toBe(false);
    // Known kinds are still checked: a malformed one, or a section with no kind at all, refuses the storefront.
    for (const malformed of [section("category", { categoryIds: "cat-fashion" }), { ...section("featured"), type: 7 }, "featured"]) {
      const sections = [malformed, ...fixtureStorefrontSettings().sections] as Section[];
      expect(() => parsePublishedStorefront({ ...fixtureStorefront(), settings: fixtureStorefrontSettings({ sections }) })).toThrow(StorefrontFormatError);
    }
  });

  it("a department row holds its category's products, sub-categories included, in catalog order", () => {
    const catalog = lookup([poloShirt, demoPhone, linenShirt, imagelessShirt]);
    expect(departmentRow(section("category", { categoryIds: ["cat-fashion"] }), catalog)).toEqual({
      category: fixtureCategories[0], products: [poloShirt, linenShirt, imagelessShirt],
    });
    expect(departmentRow(section("category", { categoryIds: ["cat-smartphones"] }), catalog).products).toEqual([demoPhone]);
    expect(departmentRow(section("category", { categoryIds: ["retired-category"] }), catalog)).toEqual({ category: null, products: [] });
  });
});

describe("best sellers answer", () => {
  it("reads the API's answer strictly; any other shape is unavailable", () => {
    expect(parseBestSellers({ windowDays: 30, productIds: ["prod-a", "prod-b"] })).toEqual({ windowDays: 30, productIds: ["prod-a", "prod-b"] });
    expect(parseBestSellers({ windowDays: 30, productIds: [] })).toEqual({ windowDays: 30, productIds: [] });
    const malformed = [
      null, [], "30", {}, { windowDays: 30 }, { productIds: [] }, { windowDays: "30", productIds: [] }, { windowDays: 0, productIds: [] },
      { windowDays: 1.5, productIds: [] }, { windowDays: 30, productIds: "prod-a" }, { windowDays: 30, productIds: [7] }, { windowDays: 30, productIds: [null] },
    ];
    for (const body of malformed) expect(parseBestSellers(body), JSON.stringify(body)).toBeNull();
  });

  it("resolves ranked ids in the API's order, skipping any the catalog doesn't show, twelve at most", () => {
    const ranked = Array.from({ length: 14 }, (_, index) => ({ ...poloShirt, id: `ranked-${index}`, name: `Ranked ${index}` }));
    const catalog = lookup(ranked);
    expect(bestSellerProducts(["ranked-3", "retired", "ranked-1"], catalog)).toEqual([ranked[3], ranked[1]]);
    expect(bestSellerProducts(ranked.map((product) => product.id).reverse(), catalog)).toEqual(ranked.slice(2).reverse());
  });
});

describe("published storefront media", () => {
  it("reads fields that older media payloads omit as null", () => {
    const { variantId: _variant, format: _format, bytes: _bytes, width: _width, height: _height, ...older } = campaignMedia[0];
    const parsed = parsePublishedStorefront({ ...fixtureStorefront(), media: [older] });
    expect(parsed.media).toEqual([{ ...older, variantId: null, format: null, bytes: null, width: null, height: null }]);
  });

  it("rejects malformed uploaded-file facts", () => {
    expect(() => parsePublishedStorefront({ ...fixtureStorefront(), media: [{ ...campaignMedia[0], bytes: "245000" }] }))
      .toThrow(StorefrontFormatError);
  });
});
