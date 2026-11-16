import { act, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { navigate } from "../router";
import { buildCategoryTree } from "../store/catalogModel";
import type { CatalogValue } from "../store/CatalogContext";
import { StoreProvider, useStore } from "../store/StoreContext";
import { fixtureCategories, fixtureReturnPolicy, linenShirt, poloShirt } from "../test-support/catalogFixtures";
import { STORAGE_KEYS, shopperStateKey } from "../utils/storage";
import { GuestCartMerge } from "./GuestCartMerge";

const mocks = vi.hoisted(() => ({ user: null as { id: string } | null, catalog: null as CatalogValue | null }));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../store/CatalogContext", () => ({ useCatalog: () => mocks.catalog }));

function catalog(status: CatalogValue["status"]): CatalogValue {
  const products = status === "ready" ? [linenShirt, poloShirt] : [];
  return {
    status, error: null, mode: "live", products, productsById: new Map(products.map((product) => [product.id, product])),
    categories: buildCategoryTree(fixtureCategories), designers: [], discounts: [], returnPolicy: fixtureReturnPolicy, reload: vi.fn(),
  };
}

const linenM = { productId: linenShirt.id, variantId: "var-linen-m-white", quantity: 1 };
const polo = { productId: poloShirt.id, variantId: "var-polo", quantity: 1 };
const retired = { productId: "prod-retired", variantId: "var-retired", quantity: 1 };
let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return null;
}
const app = () => <StoreProvider><Probe /><GuestCartMerge /></StoreProvider>;
const seed = (owner: string | null, cart: unknown[]) => localStorage.setItem(shopperStateKey(owner), JSON.stringify({ cart, wishlist: [] }));
const report = () => screen.queryByRole("region", { name: "Your guest cart" });
/** Signs in as `id` the way this tab's sign-in form does: the session appears with this tab's merge note. */
const signIn = (id: string) => {
  sessionStorage.setItem(STORAGE_KEYS.pendingGuestMerge, id);
  mocks.user = { id };
};

beforeEach(() => {
  mocks.user = null;
  mocks.catalog = catalog("ready");
  sessionStorage.clear();
  window.location.hash = "#/login";
});

describe("guest cart merge report", () => {
  it("reports added, reduced and removed lines once, on the page returned to after sign-in", async () => {
    seed(null, [{ ...linenM, quantity: 2 }, polo, retired]);
    seed("customer-a", [linenM]);
    const view = render(app());
    signIn("customer-a");
    view.rerender(app());
    await waitFor(() => expect(store.mergePending).toBe(false));
    // Not on the sign-in page itself, which is about to be replaced.
    expect(report()).toBeNull();

    act(() => navigate("/checkout", { replace: true }));
    const shown = await screen.findByRole("region", { name: "Your guest cart" });
    expect(within(shown).getByText(/Cotton Polo Shirt: 1 added, 1 in your cart\./)).toBeTruthy();
    expect(within(shown).getByText("Linen Short-Sleeve Shirt (Size: M · Color: White): only 2 available, so your cart now has 2.")).toBeTruthy();
    expect(within(shown).getByText("An item you added earlier: no longer available.")).toBeTruthy();
    // It sits in a live region that existed before it appeared, so it is announced.
    expect(shown.closest("[role=status]")).toBeTruthy();
    expect(store.state.cart).toEqual([{ ...linenM, quantity: 2 }, polo]);

    act(() => navigate("/shop", { replace: true }));
    await waitFor(() => expect(report()).toBeNull());
  });

  it("says nothing when nothing merged, and waits for the catalog without dropping lines", async () => {
    seed("customer-a", [linenM]);
    const view = render(app());
    signIn("customer-a");
    view.rerender(app());
    act(() => navigate("/cart", { replace: true }));
    await waitFor(() => expect(store.mergePending).toBe(false));
    expect(report()).toBeNull();
    view.unmount();

    // A second guest visit whose sign-in happens before the catalog has loaded.
    mocks.user = null;
    mocks.catalog = catalog("loading");
    window.location.hash = "#/login";
    seed(null, [polo]);
    const waiting = render(app());
    signIn("customer-a");
    waiting.rerender(app());
    expect([store.mergePending, store.ownerReady, store.cartCount]).toEqual([true, false, 0]);
    expect(JSON.parse(localStorage.getItem(shopperStateKey(null))!).cart).toEqual([polo]);
    mocks.catalog = catalog("ready");
    waiting.rerender(app());
    await waitFor(() => expect(store.state.cart).toEqual([linenM, polo]));
    act(() => navigate("/", { replace: true }));
    expect(await screen.findByRole("region", { name: "Your guest cart" })).toBeTruthy();
  });

  it("disappears when the account changes", async () => {
    seed(null, [polo]);
    const view = render(app());
    signIn("customer-a");
    view.rerender(app());
    act(() => navigate("/cart", { replace: true }));
    expect(await screen.findByRole("region", { name: "Your guest cart" })).toBeTruthy();
    mocks.user = null;
    view.rerender(app());
    await waitFor(() => expect(report()).toBeNull());
  });
});
