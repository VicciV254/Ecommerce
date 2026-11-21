import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCategoryTree } from "../store/catalogModel";
import type { CatalogValue } from "../store/CatalogContext";
import { fixtureSnapshot } from "../test-support/catalogFixtures";
import { Header } from "./Header";

/* The header's cart count pops when it rises, keeping its count text for screen readers; nothing moves under reduced motion. */
const state = vi.hoisted(() => ({ cartCount: 0, catalog: null as CatalogValue | null }));
vi.mock("../store/StoreContext", () => ({
  useStore: () => ({ cartCount: state.cartCount, state: { cart: [], wishlist: [] }, ownerReady: true }),
}));
vi.mock("../store/CatalogContext", () => ({ useCatalog: () => state.catalog }));
vi.mock("../store/StorefrontContext", () => ({ useStorefront: () => ({ brandName: "Apex Cart" }) }));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("./MiniCart", () => ({ useMiniCart: () => ({ isOpen: false, open: () => undefined }) }));

const animate = vi.fn();
const setReduced = (reduce: boolean) => {
  window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("reduce") ? reduce : false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
};

beforeEach(() => {
  const snapshot = fixtureSnapshot();
  state.cartCount = 0;
  state.catalog = {
    status: "ready", error: null, mode: "demo", products: snapshot.products, productsById: new Map(snapshot.products.map((product) => [product.id, product])),
    categories: buildCategoryTree(snapshot.categories), designers: [], discounts: [], returnPolicy: snapshot.returnPolicy, delivery: snapshot.delivery,
    demonstrationOrders: false, sampleOrderRetentionDays: null, reload: () => undefined,
  };
  animate.mockClear();
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: animate });
  setReduced(false);
});

afterEach(() => {
  Reflect.deleteProperty(Element.prototype, "animate");
});

describe("cart count badge", () => {
  it("pops when the count rises, not when it falls, and keeps describing the cart button", () => {
    const { rerender } = render(<Header />);
    expect(animate).not.toHaveBeenCalled();
    state.cartCount = 1;
    rerender(<Header />);
    const badge = () => document.getElementById("header-cart-count")!;
    expect(screen.getByRole("button", { name: "Cart" }).getAttribute("aria-describedby")).toBe("header-cart-count");
    expect(badge().textContent).toBe("1 item in your cart");
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.contexts[0]).toBe(badge());
    state.cartCount = 3;
    rerender(<Header />);
    expect(animate).toHaveBeenCalledTimes(2);
    state.cartCount = 2;
    rerender(<Header />);
    expect(animate).toHaveBeenCalledTimes(2);
    expect(badge().textContent).toBe("2 items in your cart");
  });

  it("stays still under reduced motion", () => {
    setReduced(true);
    const { rerender } = render(<Header />);
    state.cartCount = 2;
    rerender(<Header />);
    expect(animate).not.toHaveBeenCalled();
  });
});
