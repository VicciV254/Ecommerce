import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogProduct } from "../api/catalog";
import { useRoute } from "../router";
import { buildCategoryTree } from "../store/catalogModel";
import type { CatalogValue } from "../store/CatalogContext";
import {
  fixtureCategories,
  fixtureDesigners,
  fixtureProduct,
  fixtureReturnPolicy,
  fixtureVariant,
  listPricing,
} from "../test-support/catalogFixtures";
import Shop from "./Shop";

const state = vi.hoisted(() => ({ catalog: null as CatalogValue | null }));
vi.mock("../store/CatalogContext", () => ({ useCatalog: () => state.catalog }));
vi.mock("../store/StoreContext", () => ({ useStore: () => ({ state: { wishlist: [] }, addToCart: vi.fn(), toggleWish: vi.fn() }) }));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

const SIZES = ["S", "M", "L"];
/** 30 shirts: sizes rotate S, M, L; every third is out of stock; prices rise by KES 100. */
const shirts: CatalogProduct[] = Array.from({ length: 30 }, (_, index) => fixtureProduct({
  id: `shirt-${index + 1}`,
  name: `Shirt ${index + 1}`,
  specifications: { Material: index % 2 ? "Cotton" : "Linen" },
  variants: [fixtureVariant({
    id: `shirt-${index + 1}-sku`, attributes: { size: SIZES[index % 3] }, stock: index % 3 === 2 ? 0 : 5,
    price: 1000 + index * 100, pricing: listPricing(1000 + index * 100),
  })],
}));

function catalogWith(products: CatalogProduct[]): CatalogValue {
  return {
    status: "ready", error: null, mode: "live", products,
    productsById: new Map(products.map((product) => [product.id, product])),
    categories: buildCategoryTree(fixtureCategories), designers: fixtureDesigners, discounts: [],
    returnPolicy: fixtureReturnPolicy, reload: vi.fn(),
  };
}

/** The listing as the app routes to it; anything else stands in for the product page. */
function RoutedShop() {
  const route = useRoute();
  return route.startsWith("/shop") ? <Shop route={route} /> : <main><h1>Product page</h1></main>;
}

function open(hash: string) {
  window.location.hash = hash;
  return render(<RoutedShop />);
}

const found = (count: number) => screen.getByText(`${count} ${count === 1 ? "product" : "products"} found`);
const cards = () => within(screen.getByRole("list", { name: "Products" })).getAllByRole("listitem");

let scrollTo: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  state.catalog = catalogWith(shirts);
  scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => {
  sessionStorage.clear();
  window.location.hash = "";
});

describe("URL-backed listing", () => {
  it("counts every match, shows one page and restores it from a shared link", () => {
    open("#/shop?cat=shirts&page=2");
    expect(found(30)).toBeTruthy();
    expect(cards()).toHaveLength(12);
    expect(within(cards()[0]).getByRole("link", { name: "Shirt 13" })).toBeTruthy();
    expect(screen.getByText("Showing 13–24 of 30 products")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Pagination" }).querySelector("[aria-current=page]")?.textContent).toBe("Page 2");
  });

  it("replaces the history entry for a filter, starting again at page 1 without scrolling", async () => {
    open("#/shop?cat=shirts&page=2");
    const entries = window.history.length;
    fireEvent.click(within(screen.getByRole("group", { name: "Size" })).getByRole("checkbox", { name: /^M/ }));
    expect(window.location.hash).toBe("#/shop?cat=shirts&a.size=M");
    expect(window.history.length).toBe(entries);
    expect(found(10)).toBeTruthy();
    expect(scrollTo).not.toHaveBeenCalled();
    // Counts in other groups apply the size; availability shows what remains buyable.
    expect(within(screen.getByRole("group", { name: "Material" })).getByRole("checkbox", { name: /^Linen/ }).closest("label")?.textContent).toBe("Linen5");
    fireEvent.click(screen.getByRole("checkbox", { name: /^In stock only/ }));
    expect(window.location.hash).toBe("#/shop?cat=shirts&a.size=M&stock=in");
    expect(found(10)).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), { target: { value: "price-desc" } });
    expect(window.location.hash).toBe("#/shop?cat=shirts&a.size=M&stock=in&sort=price-desc");
    expect(window.history.length).toBe(entries);
    expect(within(cards()[0]).getByRole("link", { name: "Shirt 29" })).toBeTruthy();
  });

  it("pushes an entry for a category or a page and moves focus to the listing heading", async () => {
    open("#/shop?cat=fashion");
    const entries = window.history.length;
    fireEvent.click(within(screen.getByRole("navigation", { name: "Categories" })).getByRole("link", { name: /^Men/ }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Men" })).toBe(document.activeElement));
    expect(window.location.hash).toBe("#/shop?cat=men");
    expect(window.history.length).toBe(entries + 1);
    fireEvent.click(screen.getByRole("link", { name: "Next" }));
    await screen.findByText("Showing 13–24 of 30 products");
    expect(window.location.hash).toBe("#/shop?cat=men&page=2");
    expect(window.history.length).toBe(entries + 2);
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Men" }));
  });

  it("returns from a product to the same page, scroll position and product", async () => {
    open("#/shop?cat=shirts&page=2");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 640 });
    act(() => { window.dispatchEvent(new Event("scroll")); });
    await waitFor(() => expect(sessionStorage.getItem("apex-cart:v2:listing-scroll")).toContain("640"));
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    fireEvent.click(screen.getByRole("link", { name: "Shirt 17" }));
    await screen.findByRole("heading", { name: "Product page" });
    scrollTo.mockClear();
    act(() => window.history.back());
    const product = await screen.findByRole("link", { name: "Shirt 17" });
    expect(window.location.hash).toBe("#/shop?cat=shirts&page=2");
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 640, behavior: "instant" });
    expect(document.activeElement).toBe(product);
  });

  it("ignores unknown and invalid parameters rather than emptying the listing", () => {
    open("#/shop?cat=shirts&sort=cheapest&page=abc&a.fit=slim&min=-4&stock=maybe&utm_source=x");
    expect(found(30)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Active filters" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveProperty("value", "featured");
  });

  it("names the active filters when nothing matches, and removes them one at a time or all at once", () => {
    open("#/shop?q=shirt&cat=shirts&a.size=XL&min=5000");
    expect(screen.getByRole("heading", { name: "No matching products" })).toBeTruthy();
    expect(screen.getByText(/Nothing here matches Search: shirt; Size: XL; Price: KES 5,000 and up\./)).toBeTruthy();
    // The empty state holds the only set of chips, so no control is listed twice.
    const chips = screen.getByRole("list", { name: "Active filters" });
    expect(screen.getByRole("heading", { name: "No matching products" }).parentElement!.contains(chips)).toBe(true);
    fireEvent.click(within(chips).getByRole("button", { name: "Remove Size: XL" }));
    expect(window.location.hash).toBe("#/shop?q=shirt&cat=shirts&min=5000");
    fireEvent.click(within(screen.getByRole("list", { name: "Active filters" })).getByRole("button", { name: "Clear all" }));
    // Clear all keeps the search and the category.
    expect(window.location.hash).toBe("#/shop?q=shirt&cat=shirts");
    expect(found(30)).toBeTruthy();
  });

  it("keeps a selected value with no matches listed and removable", () => {
    open("#/shop?cat=shirts&a.size=XL");
    const xl = within(screen.getByRole("group", { name: "Size" })).getByRole("checkbox", { name: /^XL/ });
    expect(xl).toHaveProperty("checked", true);
    expect(xl.closest("label")?.textContent).toBe("XL0");
    fireEvent.click(xl);
    expect(window.location.hash).toBe("#/shop?cat=shirts");
  });

  it("shows the live count in the filter sheet and closes it to show the results", async () => {
    open("#/shop?cat=shirts");
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const sheet = screen.getByRole("dialog", { name: "Product filters" });
    fireEvent.click(within(within(sheet).getByRole("group", { name: "Size" })).getByRole("checkbox", { name: /^S/ }));
    expect(within(sheet).getByRole("status").textContent).toBe("10 products match");
    expect(screen.getByRole("button", { name: /^Filters/ }).textContent).toMatch(/Filters\s*1\s*active/);
    fireEvent.click(within(sheet).getByRole("button", { name: "Show 10 results" }));
    expect(screen.queryByRole("dialog", { name: "Product filters" })).toBeNull();
  });

  it("applies whole-KES price bounds and explains an invalid entry without applying it", () => {
    open("#/shop?cat=shirts");
    const form = screen.getAllByRole("form", { name: "Price (KES)" })[0];
    fireEvent.change(within(form).getByRole("textbox", { name: "Minimum price" }), { target: { value: "12.5" } });
    fireEvent.click(within(form).getByRole("button", { name: "Apply price" }));
    expect(within(form).getByRole("alert").textContent).toBe("Enter whole amounts in KES, using digits only.");
    expect(window.location.hash).toBe("#/shop?cat=shirts");
    fireEvent.change(within(form).getByRole("textbox", { name: "Minimum price" }), { target: { value: "1500" } });
    fireEvent.change(within(form).getByRole("textbox", { name: "Maximum price" }), { target: { value: "2000" } });
    fireEvent.blur(within(form).getByRole("textbox", { name: "Maximum price" }));
    expect(window.location.hash).toBe("#/shop?cat=shirts&min=1500&max=2000");
    expect(found(6)).toBeTruthy();
  });
});
