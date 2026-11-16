import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StoreProvider, useStore } from "./StoreContext";
import { STORAGE_KEYS, shopperStateKey } from "../utils/storage";
import type { OrderIntent } from "./checkoutModel";
import type { MergeOutcome } from "./cartModel";
import { linenShirt, poloShirt } from "../test-support/catalogFixtures";
import { readAddressDraft, saveAddressDraft } from "./addressModel";
import { fromAnotherTab } from "../test-support/otherTab";

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

  it("forgets an address typed at checkout when the account changes or signs out, but keeps it on a reload", () => {
    const typed = { street: "12 Moi Avenue", city: "Nairobi", county: "", postalCode: "" };
    auth.user = { id: "customer-a" };
    saveAddressDraft("customer-a", typed);
    render(<StoreProvider><Probe /></StoreProvider>).unmount();
    expect(readAddressDraft("customer-a")).toEqual(typed);
    // A reload mounts the provider again for the same account: the draft stays.
    const { rerender } = render(<StoreProvider><Probe /></StoreProvider>);
    expect(readAddressDraft("customer-a")).toEqual(typed);

    auth.user = { id: "customer-b" };
    rerender(<StoreProvider><Probe /></StoreProvider>);
    expect(sessionStorage.getItem(STORAGE_KEYS.checkoutAddressDraft)).toBeNull();

    saveAddressDraft("customer-b", typed);
    auth.user = null;
    rerender(<StoreProvider><Probe /></StoreProvider>);
    expect(sessionStorage.getItem(STORAGE_KEYS.checkoutAddressDraft)).toBeNull();
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

const products = new Map([linenShirt, poloShirt].map((product) => [product.id, product]));
const linenM = { productId: linenShirt.id, variantId: "var-linen-m-white", quantity: 1 };
const polo = { productId: poloShirt.id, variantId: "var-polo", quantity: 1 };
const retired = { productId: "prod-retired", variantId: "var-retired", quantity: 1 };
const seed = (owner: string | null, cart: unknown[], wishlist: string[] = []) =>
  localStorage.setItem(shopperStateKey(owner), JSON.stringify({ cart, wishlist }));
/** The note a sign-in made in this tab leaves (see `AuthContext`): this tab's guest cart joins `owner`. */
const signedInHere = (owner: string) => sessionStorage.setItem(STORAGE_KEYS.pendingGuestMerge, owner);

describe("guest cart merge on sign-in", () => {
  beforeEach(() => sessionStorage.clear());

  it("merges the guest cart into the signed-in account once, clears it and reports each change", async () => {
    seed(null, [{ ...linenM, quantity: 2 }, polo, retired], ["guest-wish"]);
    seed("customer-a", [linenM]);
    const { rerender } = render(<StoreProvider><Probe /></StoreProvider>);
    expect(store.mergePending).toBe(false);

    auth.user = { id: "customer-a" };
    signedInHere("customer-a");
    rerender(<StoreProvider><Probe /></StoreProvider>);
    // Until the merge runs (it needs the catalog), nothing claims to be this account's cart.
    expect([store.mergePending, store.ownerReady, store.cartCount]).toEqual([true, false, 0]);

    let outcome: MergeOutcome | null = null;
    await act(async () => { outcome = await store.completeGuestMerge(products); });
    expect(outcome!.reduced.map((entry) => [entry.variantId, entry.quantity])).toEqual([["var-linen-m-white", 2]]);
    expect(outcome!.added.map((entry) => [entry.variantId, entry.quantity])).toEqual([["var-polo", 1]]);
    expect(outcome!.removed.map((entry) => [entry.variantId, entry.reason])).toEqual([["var-retired", "unavailable"]]);
    const merged = [{ ...linenM, quantity: 2 }, polo];
    expect(store.state.cart).toEqual(merged);
    expect([store.mergePending, store.ownerReady, store.cartCount]).toEqual([false, true, 3]);
    expect(stored("customer-a").cart).toEqual(merged);
    // The guest cart is emptied in the same step; the guest wishlist is not merged and stays as it was.
    expect(stored(null)).toMatchObject({ cart: [], wishlist: ["guest-wish"] });

    // Running it again adds nothing.
    await act(async () => { outcome = await store.completeGuestMerge(products); });
    expect(outcome).toBeNull();
    expect(store.state.cart).toEqual(merged);
    expect(stored("customer-a").cart).toEqual(merged);
  });

  it("never merges when one account replaces another, and signing out copies nothing into the guest cart", async () => {
    seed(null, [polo]);
    seed("customer-a", [linenM]);
    auth.user = { id: "customer-a" };
    const { rerender } = render(<StoreProvider><Probe /></StoreProvider>);
    expect(store.mergePending).toBe(false);

    auth.user = { id: "customer-b" };
    rerender(<StoreProvider><Probe /></StoreProvider>);
    expect(store.mergePending).toBe(false);
    await act(async () => { expect(await store.completeGuestMerge(products)).toBeNull(); });
    expect(store.state.cart).toEqual([]);
    expect(stored("customer-b")?.cart ?? []).toEqual([]);

    auth.user = null;
    rerender(<StoreProvider><Probe /></StoreProvider>);
    expect(store.state.cart).toEqual([polo]);
    expect(stored(null).cart).toEqual([polo]);
    expect(stored("customer-a").cart).toEqual([linenM]);
  });

  it("finishes a merge still waiting for the catalog after the tab reloads, for the same account only", async () => {
    seed(null, [polo]);
    const first = render(<StoreProvider><Probe /></StoreProvider>);
    auth.user = { id: "customer-a" };
    signedInHere("customer-a");
    first.rerender(<StoreProvider><Probe /></StoreProvider>);
    expect(sessionStorage.getItem(STORAGE_KEYS.pendingGuestMerge)).toBe("customer-a");
    first.unmount();

    // A reload: the session is restored as customer A from the start, with the merge still to do.
    const second = render(<StoreProvider><Probe /></StoreProvider>);
    expect([store.mergePending, store.ownerReady]).toEqual([true, false]);
    await act(async () => { await store.completeGuestMerge(products); });
    expect(store.state.cart).toEqual([polo]);
    expect(sessionStorage.getItem(STORAGE_KEYS.pendingGuestMerge)).toBeNull();
    second.unmount();

    // Another account restored in this tab never picks up someone else's pending merge.
    sessionStorage.setItem(STORAGE_KEYS.pendingGuestMerge, "customer-a");
    seed(null, [polo]);
    auth.user = { id: "customer-b" };
    render(<StoreProvider><Probe /></StoreProvider>);
    expect([store.mergePending, store.ownerReady]).toEqual([false, true]);
    await act(async () => { expect(await store.completeGuestMerge(products)).toBeNull(); });
    expect(stored(null).cart).toEqual([polo]);
  });

  it("never shows the previous owner's lines while a sign-in change is applied", () => {
    seed("customer-a", [linenM, polo]);
    seed("customer-b", []);
    auth.user = { id: "customer-a" };
    const seen: { owner: string | null; ready: boolean; count: number }[] = [];
    function Recorder() {
      const value = useStore();
      seen.push({ owner: value.state.personalOwner, ready: value.ownerReady, count: value.cartCount });
      return null;
    }
    const { rerender } = render(<StoreProvider><Recorder /></StoreProvider>);
    expect(seen.at(-1)).toEqual({ owner: "customer-a", ready: true, count: 2 });
    seen.length = 0;
    auth.user = { id: "customer-b" };
    rerender(<StoreProvider><Recorder /></StoreProvider>);
    // The render before customer B's data is loaded still holds customer A's lines: it is not ready and counts nothing.
    expect(seen.filter((entry) => entry.owner === "customer-a")).not.toHaveLength(0);
    expect(seen.filter((entry) => entry.owner === "customer-a").every((entry) => !entry.ready && entry.count === 0)).toBe(true);
    expect(seen.at(-1)).toEqual({ owner: "customer-b", ready: true, count: 0 });
  });

  it("restores an undone removal in place, but never into another owner's cart", () => {
    auth.user = { id: "customer-a" };
    seed("customer-a", [linenM, polo, retired]);
    seed("customer-b", [retired]);
    const { rerender } = render(<StoreProvider><Probe /></StoreProvider>);
    act(() => store.removeFromCart(1));
    act(() => store.restoreLine(polo, 1, "customer-a"));
    expect(store.state.cart).toEqual([linenM, polo, retired]);

    act(() => store.removeFromCart(1));
    auth.user = { id: "customer-b" };
    rerender(<StoreProvider><Probe /></StoreProvider>);
    act(() => store.restoreLine(polo, 1, "customer-a"));
    expect(store.state.cart).toEqual([retired]);
    expect(stored("customer-b").cart).toEqual([retired]);
  });
});

describe("changes made in other tabs", () => {
  beforeEach(() => sessionStorage.clear());
  /** A shopper state exactly as this store saves it, so reading it back changes nothing. */
  const saved = (cart: unknown[]) => JSON.stringify({ cart, wishlist: [], ...noCheckout });

  it("never merges in a tab that only learns of a sign-in made in another tab", async () => {
    seed(null, [polo]);
    seed("customer-a", [linenM]);
    const { rerender } = render(<StoreProvider><Probe /></StoreProvider>);
    auth.user = { id: "customer-a" };
    rerender(<StoreProvider><Probe /></StoreProvider>);
    expect([store.mergePending, store.ownerReady]).toEqual([false, true]);
    expect(store.state.cart).toEqual([linenM]);
    await act(async () => { expect(await store.completeGuestMerge(products)).toBeNull(); });
    expect(stored(null).cart).toEqual([polo]);
    expect(stored("customer-a").cart).toEqual([linenM]);
  });

  it("takes up another tab's change to the same owner's cart and builds on it", () => {
    auth.user = { id: "customer-a" };
    seed("customer-a", [linenM]);
    render(<StoreProvider><Probe /></StoreProvider>);
    act(() => fromAnotherTab({ [shopperStateKey("customer-a")]: saved([linenM, polo]) }));
    expect(store.state.cart).toEqual([linenM, polo]);
    act(() => store.addToCart(retired));
    expect(stored("customer-a").cart).toEqual([linenM, polo, retired]);
  });

  it("keeps a guest cart emptied by another tab's merge empty, so merged lines never come back", () => {
    seed(null, [polo]);
    render(<StoreProvider><Probe /></StoreProvider>);
    act(() => fromAnotherTab({ [shopperStateKey(null)]: saved([]) }));
    expect(store.state.cart).toEqual([]);
    act(() => store.addToCart(linenM));
    expect(stored(null).cart).toEqual([linenM]);
  });

  it("writes nothing back that storage already holds, on load or after another tab's change", () => {
    auth.user = { id: "customer-a" };
    localStorage.setItem(shopperStateKey("customer-a"), saved([linenM]));
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const writes = () => setItem.mock.calls.filter(([key]) => key === shopperStateKey("customer-a")).length;
    try {
      render(<StoreProvider><Probe /></StoreProvider>);
      expect(writes()).toBe(0);
      act(() => fromAnotherTab({ [shopperStateKey("customer-a")]: saved([linenM, polo]) }));
      expect(store.state.cart).toEqual([linenM, polo]);
      // Only the other tab's own write: echoing it back would start a ping-pong between tabs.
      expect(writes()).toBe(1);
    } finally {
      setItem.mockRestore();
    }
  });

  it("merges the carts as they are stored when the merge runs, not as this tab last saw them", async () => {
    seed(null, []);
    seed("customer-a", []);
    const { rerender } = render(<StoreProvider><Probe /></StoreProvider>);
    auth.user = { id: "customer-a" };
    signedInHere("customer-a");
    rerender(<StoreProvider><Probe /></StoreProvider>);
    // While the catalog loads, a line reaches the account's cart from another tab, and the guest cart gains one.
    seed("customer-a", [linenM]);
    seed(null, [polo]);
    await act(async () => { await store.completeGuestMerge(products); });
    expect(stored("customer-a").cart).toEqual([linenM, polo]);
    expect(stored(null).cart).toEqual([]);
    expect(store.state.cart).toEqual([linenM, polo]);
  });
});
