import { describe, expect, it } from "vitest";
import type { CatalogProduct } from "../api/catalog";
import { fixtureCategory, fixtureProduct, fixtureVariant, listPricing } from "../test-support/catalogFixtures";
import { LISTING_PAGE_SIZE, buildListing, countByCategory } from "./listingModel";
import { EMPTY_LISTING, parseListingQuery, type ListingQuery } from "./listingQuery";

const fashion = fixtureCategory({ id: "cat-fashion", name: "Fashion", attributeKeys: ["Brand", "Material"] });
const shirts = fixtureCategory({ id: "cat-shirts", name: "Shirts", parentId: "cat-men" });
const phones = fixtureCategory({ id: "cat-phones", name: "Phones", attributeKeys: ["Brand", "Storage"] });

const shirt = (id: string, specifications: Record<string, string>, variants: CatalogProduct["variants"], designerId: string | null = null) =>
  fixtureProduct({ id, name: `Shirt ${id}`, specifications, variants, designerId, categoryPath: ["cat-fashion", "cat-men", "cat-shirts"] });
const sku = (id: string, size: string, color: string, stock: number, price: number) =>
  fixtureVariant({ id, attributes: { size, color }, stock, price, pricing: listPricing(price) });

/** A has S/White, a sold-out M/White and M/Blue; B only M/Black; C only L/White. */
const shirtA = shirt("a", { Brand: "Apex", Material: "Linen" }, [
  sku("a-s-white", "S", "White", 4, 900), sku("a-m-white", "M", "White", 0, 900), sku("a-m-blue", "M", "Blue", 3, 950),
], "designer-1");
const shirtB = shirt("b", { Brand: "Kora", Material: "Cotton" }, [sku("b-m-black", "M", "Black", 2, 2200)], "designer-2");
const shirtC = shirt("c", { Brand: "Apex", Material: "Cotton" }, [sku("c-l-white", "L", "White", 5, 1500)], "designer-1");
const phone = fixtureProduct({
  id: "phone", name: "Phone", categoryId: "cat-phones", categoryName: "Phones", categorySlug: "phones", categoryPath: ["cat-phones"],
  specifications: { Brand: "Apex", Storage: "128 GB" },
  // The payable projection (7,500) is what counts, not the base SKU price.
  variants: [fixtureVariant({ id: "phone-sku", price: 15000, pricing: { price: 7500, originalPrice: 15000, comparePrice: 15000, discountPercent: 50, discountId: "d" } })],
});
const unpriced = fixtureProduct({ id: "unpriced", name: "Retired shirt", categoryPath: ["cat-fashion", "cat-men", "cat-shirts"], variants: [] });
const catalog = [shirtA, shirtB, shirtC, phone, unpriced];

const query = (search: string): ListingQuery => parseListingQuery(new URLSearchParams(search));
const inShirts = { category: shirts, specKeys: fashion.attributeKeys };
const facet = (listing: ReturnType<typeof buildListing>, key: string) =>
  Object.fromEntries(listing.facets.find((item) => item.key === key)?.values.map((value) => [value.value, [value.count, value.selected]]) ?? []);
const ids = (products: readonly CatalogProduct[]) => products.map((product) => product.id);

describe("listing facets and counts", () => {
  it("counts every matching product across the catalog, not just the page shown", () => {
    const many = Array.from({ length: 30 }, (_, index) => fixtureProduct({ id: `p${index}`, name: `Product ${index}` }));
    const first = buildListing(many, EMPTY_LISTING, { specKeys: [] });
    expect([first.results.length, first.page.length, first.pageCount]).toEqual([30, LISTING_PAGE_SIZE, 3]);
    const last = buildListing(many, query("page=3"), { specKeys: [] });
    expect(ids(last.page)).toEqual(ids(many.slice(24)));
    // A page past the end shows the last page rather than nothing.
    expect(buildListing(many, query("page=9"), { specKeys: [] }).pageNumber).toBe(3);
  });

  it("counts facet values and availability across every product in scope, not just the first page", () => {
    // 30 shirts: sizes S, M and L in turn; Apex and Kora alternately; every fifth one sold out.
    const many = Array.from({ length: 30 }, (_, index) => shirt(`m${index}`, { Brand: index % 2 ? "Kora" : "Apex", Material: "Linen" },
      [sku(`m${index}-sku`, ["S", "M", "L"][index % 3], "White", index % 5 ? 2 : 0, 1000 + index)]));
    const listing = buildListing(many, EMPTY_LISTING, inShirts);
    expect([listing.results.length, listing.page.length]).toEqual([30, LISTING_PAGE_SIZE]);
    expect(facet(listing, "size")).toEqual({ S: [10, false], M: [10, false], L: [10, false] });
    expect(facet(listing, "Brand")).toEqual({ Apex: [15, false], Kora: [15, false] });
    expect(listing.inStockCount).toBe(24);
  });

  it("gives each value the count it would have with every other active filter applied", () => {
    const listing = buildListing(catalog, query("a.size=M"), inShirts);
    expect(ids(listing.results)).toEqual(["a", "b"]);
    // Size ignores its own selection; colour and brand counts apply size M.
    expect(facet(listing, "size")).toEqual({ S: [1, false], M: [2, true], L: [1, false] });
    expect(facet(listing, "color")).toEqual({ White: [1, false], Blue: [1, false], Black: [1, false] });
    expect(facet(listing, "Brand")).toEqual({ Apex: [1, false], Kora: [1, false] });
    expect(listing.inStockCount).toBe(2);
  });

  it("requires one SKU to satisfy every chosen option, and availability to apply to that SKU", () => {
    expect(ids(buildListing(catalog, query("a.size=M&a.color=White"), inShirts).results)).toEqual(["a"]);
    expect(ids(buildListing(catalog, query("a.size=S&a.color=Blue"), inShirts).results)).toEqual([]);
    const available = buildListing(catalog, query("a.size=M&a.color=White&stock=in"), inShirts);
    expect(ids(available.results)).toEqual([]);
    // Within M/White nothing is available, so availability counts 0 while White alone still counts A.
    expect(buildListing(catalog, query("a.size=M&a.color=White"), inShirts).inStockCount).toBe(0);
    expect(facet(available, "color")).toEqual({ White: [0, true], Blue: [1, false], Black: [1, false] });
  });

  it("keeps a selected value that matches nothing listed and removable", () => {
    const listing = buildListing(catalog, query("a.size=XXL&s.Brand=Nova"), inShirts);
    expect(listing.results).toEqual([]);
    expect(facet(listing, "size")).toEqual({ S: [0, false], M: [0, false], L: [0, false], XXL: [0, true] });
    expect(facet(listing, "Brand").Nova).toEqual([0, true]);
    expect(listing.applied.attributes.get("size")).toEqual(["XXL"]);
  });

  it("ignores filters on attributes the scope does not have instead of emptying it", () => {
    const listing = buildListing(catalog, query("a.fit=slim&s.Storage=128+GB"), inShirts);
    expect(ids(listing.results)).toEqual(["a", "b", "c", "unpriced"]);
    expect([...listing.applied.attributes.keys(), ...listing.applied.specs.keys()]).toEqual([]);
  });

  it("offers only attributes found in scope and the scoped department's specification keys", () => {
    const fashionFacets = buildListing(catalog, EMPTY_LISTING, inShirts).facets.map((item) => `${item.kind}:${item.key}`);
    expect(fashionFacets).toEqual(["attribute:size", "attribute:color", "spec:Brand", "spec:Material"]);
    const phoneFacets = buildListing(catalog, EMPTY_LISTING, { category: phones, specKeys: phones.attributeKeys }).facets;
    expect(phoneFacets.map((item) => `${item.kind}:${item.key}`)).toEqual(["spec:Brand", "spec:Storage"]);
    expect(buildListing(catalog, EMPTY_LISTING, { specKeys: [] }).facets.every((item) => item.kind === "attribute")).toBe(true);
  });

  it("bounds the effective price inclusively and leaves unpriced products out of a price filter", () => {
    expect(ids(buildListing(catalog, query("min=900&max=1500"), inShirts).results)).toEqual(["a", "c"]);
    expect(ids(buildListing(catalog, query("min=7500&max=7500"), { specKeys: [] }).results)).toEqual(["phone"]);
    expect(buildListing(catalog, EMPTY_LISTING, inShirts).priceRange).toEqual({ min: 900, max: 2200 });
  });

  it("sorts by the payable price, unpriced last, and keeps catalog order for Featured", () => {
    expect(ids(buildListing(catalog, query("sort=price-desc"), { specKeys: [] }).results)).toEqual(["phone", "b", "c", "a", "unpriced"]);
    expect(ids(buildListing(catalog, query("sort=price-asc"), { specKeys: [] }).results)).toEqual(["a", "c", "b", "phone", "unpriced"]);
    expect(ids(buildListing(catalog, EMPTY_LISTING, { specKeys: [] }).results)).toEqual(ids(catalog));
  });

  it("counts designers and categories with the other filters applied", () => {
    const listing = buildListing(catalog, query("s.Material=Cotton"), { ...inShirts, designerId: "designer-2" });
    expect(ids(listing.results)).toEqual(["b"]);
    expect([...listing.designerCounts]).toEqual([["designer-2", 1], ["designer-1", 1]]);
    expect([...countByCategory(buildListing(catalog, query("q=shirt"), { specKeys: [] }).results, [fashion, phones])])
      .toEqual([["cat-fashion", 4], ["cat-phones", 0]]);
  });
});
