import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogProduct } from "../api/catalog";
import { buildCategoryTree } from "../store/catalogModel";
import type { CatalogValue } from "../store/CatalogContext";
import { StoreProvider, useStore } from "../store/StoreContext";
import { fixtureCategories, fixtureDelivery, fixtureReturnPolicy, linenShirt, poloShirt } from "../test-support/catalogFixtures";
import { MiniCartProvider } from "./MiniCart";
import { ProductCard } from "./ProductCard";

const mocks = vi.hoisted(() => ({ catalog: null as CatalogValue | null }));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("../store/CatalogContext", () => ({ useCatalog: () => mocks.catalog }));

let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return null;
}

function renderCards(products: CatalogProduct[]) {
  return render(
    <StoreProvider>
      <MiniCartProvider>
        <Probe />
        {products.map((product) => <ProductCard key={product.id} product={product} />)}
      </MiniCartProvider>
    </StoreProvider>,
  );
}

beforeEach(() => {
  const products = [linenShirt, poloShirt];
  mocks.catalog = {
    status: "ready", error: null, mode: "live", products, productsById: new Map(products.map((product) => [product.id, product])),
    categories: buildCategoryTree(fixtureCategories), designers: [], discounts: [], returnPolicy: fixtureReturnPolicy, delivery: fixtureDelivery, demonstrationOrders: false, sampleOrderRetentionDays: null, reload: vi.fn(),
  };
});

describe("Quick View from a product card", () => {
  it("requires every choice, adds the same line as the product page, confirms in place and returns focus to the card", () => {
    renderCards([linenShirt]);
    const opener = screen.getByRole("button", { name: "Choose options for Linen Short-Sleeve Shirt" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Quick view: Linen Short-Sleeve Shirt" });
    expect(document.activeElement).toBe(within(dialog).getByRole("heading", { level: 2, name: "Linen Short-Sleeve Shirt" }));
    expect(within(dialog).getByText("excl. VAT")).toBeTruthy();

    const action = () => within(dialog).getByRole("button", { name: /^(Add to cart|Choose options)$/ });
    fireEvent.click(action());
    expect(action().textContent).toBe("Choose options");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "S" }));
    expect(store.state.cart).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "M" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "White" }));
    fireEvent.click(action());
    expect(store.state.cart).toEqual([{ productId: linenShirt.id, variantId: "var-linen-m-white", quantity: 1 }]);
    expect(within(dialog).getByText("Added to cart.")).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "View cart" }).getAttribute("href")).toBe("#/cart");
    expect(within(dialog).getByRole("link", { name: "View full details" }).getAttribute("href")).toBe(`#/product/${linenShirt.id}`);
    // Quick View confirms in place; it never opens the mini-cart on top of itself.
    expect(screen.queryByRole("dialog", { name: "Your cart" })).toBeNull();

    // A second add of the last unit fits; a third is refused with the reason.
    fireEvent.click(action());
    fireEvent.click(action());
    expect(store.state.cart).toEqual([{ productId: linenShirt.id, variantId: "var-linen-m-white", quantity: 2 }]);
    expect(within(dialog).getByText("Your cart already has all 2 available, so nothing more was added.")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Keep shopping" }));
    expect(screen.queryByRole("dialog", { name: /Quick view/ })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("adds a single-SKU product directly and opens the mini-cart with what was added", () => {
    renderCards([poloShirt]);
    fireEvent.click(screen.getByRole("button", { name: "Add to cart" }));
    expect(store.state.cart).toEqual([{ productId: poloShirt.id, variantId: "var-polo", quantity: 1 }]);
    const drawer = screen.getByRole("dialog", { name: "Your cart" });
    expect(within(drawer).getByRole("list", { name: "Items in your cart" })).toBeTruthy();
  });
});

describe("card feedback", () => {
  const reducedMotion = (reduce: boolean) => {
    window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("reduce") ? reduce : false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
  };

  it("confirms an add with a check for about a second and a half, keeping its name and label, and adds again meanwhile", () => {
    vi.useFakeTimers();
    try {
      reducedMotion(false);
      renderCards([poloShirt]);
      const add = screen.getByRole("button", { name: "Add to cart" });
      expect(add.className).toContain("motion-safe:active:scale-[0.97]");
      fireEvent.click(add);
      expect(add.getAttribute("data-added")).toBe("true");
      expect(add.textContent).toBe("Add to cart");
      expect(add.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "Add to cart", hidden: true }));
      expect(store.state.cart).toEqual([{ productId: poloShirt.id, variantId: "var-polo", quantity: 2 }]);
      act(() => { vi.advanceTimersByTime(1400); });
      expect(add.getAttribute("data-added")).toBe("true");
      act(() => { vi.advanceTimersByTime(1600); });
      expect(add.hasAttribute("data-added")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pops the wishlist heart when a product is saved, not when it is removed, and never under reduced motion", () => {
    const animate = vi.fn();
    Object.defineProperty(Element.prototype, "animate", { configurable: true, value: animate });
    try {
      reducedMotion(false);
      const { unmount } = renderCards([poloShirt]);
      fireEvent.click(screen.getByRole("button", { name: "Save Cotton Polo Shirt to wishlist" }));
      expect(animate).toHaveBeenCalledTimes(1);
      expect(animate.mock.contexts[0]).toBe(screen.getByRole("button", { name: "Remove Cotton Polo Shirt from wishlist" }).querySelector("svg"));
      fireEvent.click(screen.getByRole("button", { name: "Remove Cotton Polo Shirt from wishlist" }));
      expect(animate).toHaveBeenCalledTimes(1);
      unmount();
      localStorage.clear();
      reducedMotion(true);
      renderCards([poloShirt]);
      fireEvent.click(screen.getByRole("button", { name: "Save Cotton Polo Shirt to wishlist" }));
      expect(animate).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(Element.prototype, "animate");
    }
  });
});
