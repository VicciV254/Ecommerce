import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StoreProvider, useStore } from "./StoreContext";
import { shopperStateKey } from "../utils/storage";
import type { OrderIntent } from "./checkoutModel";

const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: auth.user }) }));

let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return null;
}

const stored = (owner: string | null) => JSON.parse(localStorage.getItem(shopperStateKey(owner)) ?? "null");
const noCheckout = { couponCode: null, checkout: { addressId: null, deliveryMethod: "STANDARD" }, pendingOrder: null, acknowledgedOrderIds: [] };
const intent = (key: string): OrderIntent => ({
  quoteId: `quote-${key}`, idempotencyKey: `key-${key}-0123456789abcdef`, signature: `signature-${key}`, total: 1244,
  createdAt: "2026-10-31T12:00:00.000Z",
});

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
    expect(stored("customer-b")).toEqual({ cart: [], wishlist: ["p9"], ...noCheckout });
    expect(store.state.cart).toEqual([]);
    expect(stored("customer-a").cart).toEqual([{ productId: "p1", variantId: "v1", quantity: 1 }]);

    auth.user = null;
    rerender(<StoreProvider><Probe /></StoreProvider>);
    expect(store.state.cart).toEqual([]);
    expect(stored(null)).toEqual({ cart: [], wishlist: [], ...noCheckout });
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

  it("keeps coupon and checkout choices per account and never writes them under another account", () => {
    auth.user = { id: "customer-a" };
    const { rerender } = render(<StoreProvider><Probe /></StoreProvider>);
    act(() => store.setCouponCode("SAVE10"));
    act(() => store.setCheckoutPreferences({ addressId: "addr-a", deliveryMethod: "SAME_DAY" }));
    expect(stored("customer-a")).toMatchObject({ couponCode: "SAVE10", checkout: { addressId: "addr-a", deliveryMethod: "SAME_DAY" } });

    const setCouponAsA = store.setCouponCode;
    auth.user = { id: "customer-b" };
    rerender(<StoreProvider><Probe /></StoreProvider>);
    expect(store.state.couponCode).toBeNull();
    expect(store.state.checkout).toEqual(noCheckout.checkout);
    // A late update from customer A's screen is ignored rather than applied to customer B.
    act(() => setCouponAsA("STALE"));
    expect(store.state.couponCode).toBeNull();
    expect(stored("customer-b")).toEqual({ cart: [], wishlist: [], ...noCheckout });
    expect(stored("customer-a").couponCode).toBe("SAVE10");

    auth.user = { id: "customer-a" };
    rerender(<StoreProvider><Probe /></StoreProvider>);
    expect(store.state.couponCode).toBe("SAVE10");
    localStorage.setItem(shopperStateKey("customer-c"), JSON.stringify({ cart: [], wishlist: [], couponCode: " bad code! " }));
    auth.user = { id: "customer-c" };
    rerender(<StoreProvider><Probe /></StoreProvider>);
    expect(store.state.couponCode).toBeNull();
  });

  it("stores an order intent before it can be sent and refuses a second unresolved one", () => {
    auth.user = { id: "customer-a" };
    render(<StoreProvider><Probe /></StoreProvider>);
    act(() => store.addToCart({ productId: "p1", variantId: "v1", quantity: 1 }));
    let accepted = false;
    act(() => {
      accepted = store.beginOrder(intent("first"));
      // Durable at once, before any request is made with it.
      expect(stored("customer-a").pendingOrder).toEqual(intent("first"));
    });
    expect(accepted).toBe(true);
    expect(store.state.pendingOrder).toEqual(intent("first"));
    act(() => { accepted = store.beginOrder(intent("second")); });
    expect(accepted).toBe(false);
    expect(stored("customer-a").pendingOrder).toEqual(intent("first"));

    act(() => store.endOrder(intent("second").idempotencyKey));
    expect(store.state.pendingOrder).toEqual(intent("first"));
    act(() => store.endOrder(intent("first").idempotencyKey));
    expect(stored("customer-a").pendingOrder).toBeNull();
    expect(stored("customer-a").cart).toEqual([{ productId: "p1", variantId: "v1", quantity: 1 }]);
  });

  it("acknowledges a verified order once and keeps lines added or increased while it was pending", () => {
    auth.user = { id: "customer-a" };
    render(<StoreProvider><Probe /></StoreProvider>);
    act(() => store.addToCart({ productId: "p1", variantId: "v1", quantity: 2 }));
    act(() => store.addToCart({ productId: "p2", variantId: "v2", quantity: 1 }));
    act(() => store.setCouponCode("SAVE10"));
    act(() => { store.beginOrder(intent("order")); });
    // While the request is in flight the customer adds more and raises a quantity.
    act(() => store.addToCart({ productId: "p3", variantId: "v3", quantity: 1 }));
    act(() => store.setQuantity(0, 3));

    const ordered = [{ productId: "p1", variantId: "v1", quantity: 2 }, { productId: "p2", variantId: "v2", quantity: 1 }];
    act(() => store.acknowledgeOrder("order-1", ordered, intent("order").idempotencyKey));
    const expected = [{ productId: "p1", variantId: "v1", quantity: 1 }, { productId: "p3", variantId: "v3", quantity: 1 }];
    expect(store.state.cart).toEqual(expected);
    expect(store.state.pendingOrder).toBeNull();
    expect(store.state.couponCode).toBe("SAVE10");

    // A replayed or re-resolved response for the same order changes nothing.
    act(() => store.acknowledgeOrder("order-1", ordered, intent("order").idempotencyKey));
    expect(store.state.cart).toEqual(expected);
    expect(stored("customer-a")).toMatchObject({ cart: expected, acknowledgedOrderIds: ["order-1"], pendingOrder: null });

    act(() => store.acknowledgeOrder("order-2", expected, "key-unrelated-0123456789"));
    expect(store.state.cart).toEqual([]);
    expect(store.state.couponCode).toBeNull();
  });

  it("ignores an order outcome that arrives after the customer changed", () => {
    auth.user = { id: "customer-a" };
    const { rerender } = render(<StoreProvider><Probe /></StoreProvider>);
    act(() => store.addToCart({ productId: "p1", variantId: "v1", quantity: 1 }));
    act(() => { store.beginOrder(intent("a")); });
    const acknowledgeAsA = store.acknowledgeOrder;
    localStorage.setItem(shopperStateKey("customer-b"), JSON.stringify({ cart: [{ productId: "p1", variantId: "v1", quantity: 4 }], wishlist: [] }));

    auth.user = { id: "customer-b" };
    rerender(<StoreProvider><Probe /></StoreProvider>);
    act(() => acknowledgeAsA("order-a", [{ productId: "p1", variantId: "v1", quantity: 1 }], intent("a").idempotencyKey));
    expect(store.state.cart).toEqual([{ productId: "p1", variantId: "v1", quantity: 4 }]);
    expect(stored("customer-b").acknowledgedOrderIds).toEqual([]);
    expect(stored("customer-a").pendingOrder).toEqual(intent("a"));
  });
});
