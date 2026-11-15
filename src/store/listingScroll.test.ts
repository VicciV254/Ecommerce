import { afterEach, describe, expect, it } from "vitest";
import { LISTING_SCROLL_LIMIT, recallListingScroll, rememberListingScroll } from "./listingScroll";

afterEach(() => sessionStorage.clear());

describe("listing scroll memory", () => {
  it("recalls the latest position saved for the exact listing route", () => {
    rememberListingScroll("/shop?cat=shirts&page=2", 1200.6);
    rememberListingScroll("/shop?cat=shirts", 300);
    rememberListingScroll("/shop?cat=shirts&page=2", 1480);
    expect(recallListingScroll("/shop?cat=shirts&page=2")).toBe(1480);
    expect(recallListingScroll("/shop?cat=shirts")).toBe(300);
    expect(recallListingScroll("/shop?cat=shirts&page=3")).toBeNull();
  });

  it(`keeps only the ${LISTING_SCROLL_LIMIT} most recently saved listings`, () => {
    for (let page = 1; page <= LISTING_SCROLL_LIMIT + 2; page += 1) rememberListingScroll(`/shop?page=${page}`, page * 100);
    // Saving again makes an entry recent, so it outlives older ones.
    rememberListingScroll("/shop?page=3", 333);
    rememberListingScroll("/shop?page=23", 2300);
    expect(recallListingScroll("/shop?page=1")).toBeNull();
    expect(recallListingScroll("/shop?page=2")).toBeNull();
    expect(recallListingScroll("/shop?page=4")).toBeNull();
    expect(recallListingScroll("/shop?page=3")).toBe(333);
    expect(recallListingScroll("/shop?page=5")).toBe(500);
    expect(JSON.parse(sessionStorage.getItem("apex-cart:v2:listing-scroll")!)).toHaveLength(LISTING_SCROLL_LIMIT);
  });

  it("treats a damaged record as empty instead of failing", () => {
    sessionStorage.setItem("apex-cart:v2:listing-scroll", "{not json");
    expect(recallListingScroll("/shop")).toBeNull();
    sessionStorage.setItem("apex-cart:v2:listing-scroll", JSON.stringify([["/shop", -5], ["/shop?page=2", "x"], ["/shop?page=3", 90]]));
    expect(recallListingScroll("/shop")).toBeNull();
    expect(recallListingScroll("/shop?page=3")).toBe(90);
    rememberListingScroll("/shop", 10);
    expect(recallListingScroll("/shop")).toBe(10);
  });
});
