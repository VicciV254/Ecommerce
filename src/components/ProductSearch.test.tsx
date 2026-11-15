import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCategoryTree } from "../store/catalogModel";
import type { CatalogValue } from "../store/CatalogContext";
import { fixtureCategories, fixtureCategory, fixtureProduct, fixtureReturnPolicy, fixtureSnapshot } from "../test-support/catalogFixtures";
import { ProductSearch, SUGGEST_DELAY_MS } from "./ProductSearch";

const state = vi.hoisted(() => ({ catalog: null as CatalogValue | null }));
vi.mock("../store/CatalogContext", () => ({ useCatalog: () => state.catalog }));

function catalog(status: CatalogValue["status"] = "ready"): CatalogValue {
  const products = status === "ready" ? fixtureSnapshot().products : [];
  return {
    status, error: status === "error" ? "Catalog temporarily unavailable" : null, mode: "demo", products,
    productsById: new Map(products.map((product) => [product.id, product])),
    categories: buildCategoryTree(status === "ready" ? fixtureCategories : []), designers: [], discounts: [],
    returnPolicy: status === "ready" ? fixtureReturnPolicy : null, reload: vi.fn(),
  };
}

const input = () => screen.getByRole("combobox", { name: "Search products" });
const status = () => screen.getByRole("status");
function type(value: string) {
  fireEvent.focus(input());
  fireEvent.change(input(), { target: { value } });
  act(() => { vi.advanceTimersByTime(SUGGEST_DELAY_MS); });
}
const key = (name: string) => fireEvent.keyDown(input(), { key: name });
const activeOption = () => document.getElementById(input().getAttribute("aria-activedescendant") ?? "");

beforeEach(() => {
  vi.useFakeTimers();
  state.catalog = catalog();
  window.location.hash = "#/";
});
afterEach(() => {
  vi.useRealTimers();
});

describe("search suggestions", () => {
  it("waits for two characters and a pause in typing before suggesting", () => {
    render(<ProductSearch />);
    type("s");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input().getAttribute("aria-expanded")).toBe("false");
    fireEvent.change(input(), { target: { value: "sh" } });
    act(() => { vi.advanceTimersByTime(SUGGEST_DELAY_MS - 1); });
    expect(screen.queryByRole("listbox")).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    const list = screen.getByRole("listbox", { name: "Search suggestions" });
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(input().getAttribute("aria-controls")).toBe(list.id);
    // "Shirts" starts with the text and "Fashion" contains it; three products mention it.
    expect(within(within(list).getByRole("group", { name: "Departments and categories" })).getAllByRole("option")).toHaveLength(2);
    expect(status().textContent).toBe("5 suggestions");
  });

  it("offers up to three categories and five products, with each product's price", () => {
    render(<ProductSearch />);
    type("shirt");
    const categories = within(screen.getByRole("group", { name: "Departments and categories" })).getAllByRole("option");
    expect(categories.map((option) => option.textContent)).toEqual(["Shirtsin Fashion › Men"]);
    const products = within(screen.getByRole("group", { name: "Products" })).getAllByRole("option");
    expect(products.map((option) => option.textContent)).toEqual([
      "Linen Short-Sleeve ShirtShirtsKES 900", "Cotton Polo ShirtShirtsKES 2,200", "Oxford Shirt Without ImagesShirtsKES 1,800",
    ]);
  });

  it("caps the list at three categories and five products, broader categories first", () => {
    const lamps = Array.from({ length: 8 }, (_, index) => fixtureProduct({ id: `lamp-${index}`, name: `Lamp ${index}` }));
    const groups = Array.from({ length: 4 }, (_, index) =>
      fixtureCategory({ id: `cat-lamps-${index}`, name: `Lamps ${index}`, parentId: "cat-lighting", productCount: 2 }));
    const lighting = fixtureCategory({ id: "cat-lighting", name: "Lighting and lamps", productCount: 8 });
    const empty = fixtureCategory({ id: "cat-lamp-parts", name: "Lamp parts", productCount: 0 });
    state.catalog = { ...catalog(), products: lamps, categories: buildCategoryTree([...groups, lighting, empty]) };
    render(<ProductSearch />);
    type("lamp");
    const categories = within(screen.getByRole("group", { name: "Departments and categories" })).getAllByRole("option");
    // Names starting with the text outrank a later word ("Lighting and lamps"); the empty category is never offered.
    expect(categories.map((option) => option.textContent)).toEqual([
      "Lamps 0in Lighting and lamps", "Lamps 1in Lighting and lamps", "Lamps 2in Lighting and lamps",
    ]);
    expect(within(screen.getByRole("group", { name: "Products" })).getAllByRole("option")).toHaveLength(5);
    expect(status().textContent).toBe("8 suggestions");
  });

  it("moves the active option with the arrow keys, wrapping at both ends, and opens it with Enter", () => {
    render(<ProductSearch />);
    type("shirt");
    key("ArrowDown");
    expect(activeOption()?.textContent).toContain("Shirtsin Fashion");
    expect(activeOption()?.getAttribute("aria-selected")).toBe("true");
    key("ArrowDown");
    expect(activeOption()?.textContent).toContain("Linen Short-Sleeve Shirt");
    key("ArrowUp");
    key("ArrowUp");
    expect(activeOption()?.textContent).toContain("Oxford Shirt");
    key("ArrowDown");
    expect(activeOption()?.textContent).toContain("Shirtsin Fashion");
    key("Enter");
    expect(window.location.hash).toBe("#/shop?cat=shirts");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect((input() as HTMLInputElement).value).toBe("");
  });

  it("submits the text to the listing when no option is active", () => {
    const onNavigate = vi.fn();
    render(<ProductSearch onNavigate={onNavigate} />);
    type("linen shirt");
    fireEvent.submit(input().closest("form")!);
    expect(window.location.hash).toBe("#/shop?q=linen+shirt");
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("closes the list on the first Escape, clears the text on the second, and only then lets Escape through", () => {
    render(<ProductSearch />);
    type("polo");
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(fireEvent.keyDown(input(), { key: "Escape" })).toBe(false);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect((input() as HTMLInputElement).value).toBe("polo");
    expect(status().textContent).toBe("");
    expect(fireEvent.keyDown(input(), { key: "Escape" })).toBe(false);
    expect((input() as HTMLInputElement).value).toBe("");
    // Not handled here, so a surrounding dialog can close.
    expect(fireEvent.keyDown(input(), { key: "Escape" })).toBe(true);
  });

  it("closes the list when the page changes underneath it, as with Back", async () => {
    render(<ProductSearch />);
    type("polo");
    expect(screen.getByRole("listbox")).toBeTruthy();
    vi.useRealTimers();
    act(() => { window.location.hash = "#/about"; });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect((input() as HTMLInputElement).value).toBe("polo");
  });

  it("opens a tapped option", () => {
    render(<ProductSearch />);
    type("polo");
    fireEvent.click(screen.getByRole("option", { name: /Cotton Polo Shirt/ }));
    expect(window.location.hash).toBe("#/product/prod-polo-shirt");
  });

  it("says when nothing matches and keeps search usable when the catalog failed", () => {
    const { rerender } = render(<ProductSearch />);
    type("zzz");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(status().textContent).toBe('No suggestions for "zzz". Press Enter to search all products.');
    state.catalog = catalog("error");
    rerender(<ProductSearch />);
    expect(status().textContent).toBe("Suggestions are unavailable. Press Enter to search.");
    fireEvent.submit(input().closest("form")!);
    expect(window.location.hash).toBe("#/shop?q=zzz");
  });
});
