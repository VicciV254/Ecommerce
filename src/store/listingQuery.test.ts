import { describe, expect, it } from "vitest";
import {
  EMPTY_LISTING,
  MAX_SEARCH_LENGTH,
  MAX_SELECTION_KEYS,
  MAX_SELECTION_VALUES,
  changeListing,
  listingRoute,
  listingSearch,
  parseListingQuery,
  toggleSelection,
  type ListingQuery,
} from "./listingQuery";

const parse = (search: string) => parseListingQuery(new URLSearchParams(search));
/** Maps compared as plain entries, so equal selections match whatever their insertion order. */
const plain = (query: ListingQuery) => ({
  ...query,
  attributes: Object.fromEntries([...query.attributes].map(([key, values]) => [key, [...values].sort()])),
  specs: Object.fromEntries([...query.specs].map(([key, values]) => [key, [...values].sort()])),
});

const FULL: ListingQuery = {
  q: "linen shirt", cat: "shirts", designer: "test-studio", featured: true, sort: "price-desc", page: 3,
  attributes: new Map([["size", ["M", "L"]], ["color", ["White"]]]),
  specs: new Map([["Brand", ["Apex & Co"]], ["Storage", ["128 GB"]]]),
  min: 500, max: 2500, inStock: true,
};

describe("listing URL", () => {
  it("writes every parameter canonically and reads the same listing back", () => {
    const search = listingSearch(FULL);
    expect(search).toBe(
      "q=linen+shirt&cat=shirts&designer=test-studio&featured=1&a.color=White&a.size=L&a.size=M" +
      "&s.Brand=Apex+%26+Co&s.Storage=128+GB&min=500&max=2500&stock=in&sort=price-desc&page=3");
    expect(plain(parse(search))).toEqual(plain(FULL));
  });

  it("gives the same address whatever order the parameters arrive in", () => {
    const shuffled = parse("page=3&stock=in&a.size=M&max=2500&sort=price-desc&s.Storage=128+GB&a.color=White" +
      "&min=500&featured=1&a.size=L&designer=test-studio&s.Brand=Apex+%26+Co&cat=shirts&q=linen+shirt");
    expect(listingSearch(shuffled)).toBe(listingSearch(FULL));
  });

  it("omits defaults, so the plain listing is just /shop", () => {
    expect(listingRoute()).toBe("/shop");
    expect(listingRoute({ cat: "fashion" })).toBe("/shop?cat=fashion");
    expect(listingSearch(parse("sort=featured&page=1&featured=0&stock="))).toBe("");
  });

  it("ignores unknown and invalid parameters instead of failing or emptying the listing", () => {
    const query = parse("sort=cheapest&page=-2&min=abc&max=1e3&featured=yes&stock=out&a.=x&s.Brand=&a.size=%20&foo=bar&q=%20%20");
    expect(plain(query)).toEqual(plain(EMPTY_LISTING));
    expect(parse("page=0").page).toBe(1);
    expect(parse("page=2.5").page).toBe(1);
    expect(parse("page=999999999999").page).toBe(100_000);
  });

  it("trims values, drops duplicates and swaps reversed price bounds", () => {
    const query = parse("q=+linen+&a.size=M&a.size=+M+&a.size=L&min=3000&max=1000");
    expect(query.q).toBe("linen");
    expect(query.attributes.get("size")).toEqual(["M", "L"]);
    expect([query.min, query.max]).toEqual([1000, 3000]);
  });

  it("keeps link-supplied keys as data, never as object properties", () => {
    const query = parse("a.__proto__=polluted&a.constructor=x&s.toString=y");
    expect(query.attributes.get("__proto__")).toEqual(["polluted"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(listingSearch(query)).toBe("a.__proto__=polluted&a.constructor=x&s.toString=y");
  });

  it("bounds what a link can select, so a hand-made or damaged address cannot stall the page", () => {
    const params = new URLSearchParams({ q: "x".repeat(MAX_SEARCH_LENGTH + 50) });
    for (let key = 0; key < MAX_SELECTION_KEYS + 10; key += 1) params.append(`a.key${key}`, "on");
    for (let value = 0; value < 5000; value += 1) params.append("s.Brand", `Brand ${value}`);
    const query = parseListingQuery(params);
    expect(query.q).toHaveLength(MAX_SEARCH_LENGTH);
    expect([...query.attributes.keys()]).toEqual(Array.from({ length: MAX_SELECTION_KEYS }, (_, key) => `key${key}`));
    // The first values are kept, in link order.
    expect(query.specs.get("Brand")).toEqual(Array.from({ length: MAX_SELECTION_VALUES }, (_, value) => `Brand ${value}`));
  });
});

describe("listing history rule", () => {
  const onPage3 = { ...parse("cat=shirts&a.size=M&sort=price-asc"), page: 3 };

  it.each([
    ["a category", { cat: "fashion" }, "/shop?cat=fashion&a.size=M&sort=price-asc"],
    ["a submitted search", { q: "polo" }, "/shop?q=polo&cat=shirts&a.size=M&sort=price-asc"],
    ["the designer", { designer: "test-studio" }, "/shop?cat=shirts&designer=test-studio&a.size=M&sort=price-asc"],
    ["featured only", { featured: true }, "/shop?cat=shirts&featured=1&a.size=M&sort=price-asc"],
  ])("pushes an entry for %s and starts again at page 1", (_name, change, route) => {
    expect(changeListing(onPage3, change)).toEqual({ route, replace: false });
  });

  it("pushes an entry for a page change and keeps everything else", () => {
    expect(changeListing(onPage3, { page: 4 })).toEqual({ route: "/shop?cat=shirts&a.size=M&sort=price-asc&page=4", replace: false });
  });

  it.each([
    ["a facet", { attributes: toggleSelection(onPage3.attributes, "size", "L") }, "/shop?cat=shirts&a.size=L&a.size=M&sort=price-asc"],
    ["a specification", { specs: new Map([["Brand", ["Apex"]]]) }, "/shop?cat=shirts&a.size=M&s.Brand=Apex&sort=price-asc"],
    ["the sort", { sort: "rating" as const }, "/shop?cat=shirts&a.size=M&sort=rating"],
    ["the price", { min: 100, max: 900 }, "/shop?cat=shirts&a.size=M&min=100&max=900&sort=price-asc"],
    ["availability", { inStock: true }, "/shop?cat=shirts&a.size=M&stock=in&sort=price-asc"],
  ])("replaces the entry for %s, resetting the page", (_name, change, route) => {
    expect(changeListing(onPage3, change)).toEqual({ route, replace: true });
  });

  it("removes a key once its last value is toggled off", () => {
    const cleared = toggleSelection(onPage3.attributes, "size", "M");
    expect(cleared.has("size")).toBe(false);
    expect(changeListing(onPage3, { attributes: cleared })).toEqual({ route: "/shop?cat=shirts&sort=price-asc", replace: true });
  });
});
