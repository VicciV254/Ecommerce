import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StoreProvider, useStore } from "./StoreContext";
import { shopperStateKey } from "../utils/storage";

const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: auth.user }) }));

let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return null;
}

const stored = (owner: string | null) => JSON.parse(localStorage.getItem(shopperStateKey(owner)) ?? "null");

beforeEach(() => {
  auth.user = null;
});

describe("shopper state", () => {
  it("persists variant-level cart lines under the versioned key and merges the same SKU", () => {
    auth.user = { id: "customer-a" };
    render(<StoreProvider><Probe /></StoreProvider>);
    act(() => store.addToCart({ productId: "p1", variantId: "v1", quantity: 1 }));
    act(() => store.addToCart({ productId: "p1", variantId: "v1", quantity: 2 }));
    act(() => store.addToCart({ productId: "p1", variantId: "v2", quantity: 1 }));
    expect(store.cartCount).toBe(4);
    expect(stored("customer-a").cart).toEqual([
      { productId: "p1", variantId: "v1", quantity: 3 },
      { productId: "p1", variantId: "v2", quantity: 1 },
    ]);
    expect(localStorage.getItem("nmb-store:customer-a")).toBeNull();
  });

  it("never reads, migrates or clears legacy carts and drops malformed versioned lines", () => {
    auth.user = { id: "customer-a" };
    const legacy = JSON.stringify({ cart: [{ productId: "mens-fashion-1", qty: 2, size: "M" }], wishlist: ["mens-fashion-1"] });
    localStorage.setItem("nmb-store:customer-a", legacy);
    localStorage.setItem(shopperStateKey("customer-a"), JSON.stringify({
      cart: [
        { productId: "p1", variantId: "v1", quantity: 1 },
        { productId: "p2", qty: 3 },
        { productId: "p3", variantId: "v3", quantity: 0 },
        { productId: "p4", variantId: "", quantity: 1 },
      ],
      wishlist: ["p1", 7, "p1"],
    }));
    render(<StoreProvider><Probe /></StoreProvider>);
    expect(store.state.cart).toEqual([{ productId: "p1", variantId: "v1", quantity: 1 }]);
    expect(store.state.wishlist).toEqual(["p1"]);
    expect(localStorage.getItem("nmb-store:customer-a")).toBe(legacy);
  });

  it("does not write the previous account's cart under the next account's key", () => {
    auth.user = { id: "customer-a" };
    const { rerender } = render(<StoreProvider><Probe /></StoreProvider>);
    act(() => store.addToCart({ productId: "p1", variantId: "v1", quantity: 1 }));
    localStorage.setItem(shopperStateKey("customer-b"), JSON.stringify({ cart: [], wishlist: ["p9"] }));

    auth.user = { id: "customer-b" };
    rerender(<StoreProvider><Probe /></StoreProvider>);
    expect(stored("customer-b")).toEqual({ cart: [], wishlist: ["p9"] });
    expect(store.state.cart).toEqual([]);
    expect(stored("customer-a").cart).toEqual([{ productId: "p1", variantId: "v1", quantity: 1 }]);

    auth.user = null;
    rerender(<StoreProvider><Probe /></StoreProvider>);
    expect(store.state.cart).toEqual([]);
    expect(stored(null)).toEqual({ cart: [], wishlist: [] });
  });

  it("keeps quantities whole and at least one", () => {
    auth.user = { id: "customer-a" };
    render(<StoreProvider><Probe /></StoreProvider>);
    act(() => store.addToCart({ productId: "p1", variantId: "v1", quantity: 2.7 }));
    act(() => store.setQuantity(0, 0));
    expect(store.state.cart[0].quantity).toBe(1);
    act(() => store.setQuantity(5, 3));
    expect(store.state.cart).toHaveLength(1);
  });
});
