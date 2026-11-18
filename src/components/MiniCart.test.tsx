import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogProduct } from "../api/catalog";
import { buildCategoryTree } from "../store/catalogModel";
import type { CatalogValue } from "../store/CatalogContext";
import { StoreProvider, useStore } from "../store/StoreContext";
import { fixtureCategories, fixtureDelivery, fixtureReturnPolicy, linenShirt, poloShirt } from "../test-support/catalogFixtures";
import { shopperStateKey } from "../utils/storage";
import { MiniCartProvider, useMiniCart } from "./MiniCart";

const mocks = vi.hoisted(() => ({ user: null as { id: string } | null, catalog: null as CatalogValue | null }));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../store/CatalogContext", () => ({ useCatalog: () => mocks.catalog }));

function catalogWith(products: CatalogProduct[], status: CatalogValue["status"] = "ready"): CatalogValue {
  return {
    status, error: status === "error" ? "The catalog could not be loaded." : null, mode: "live", products,
    productsById: new Map(products.map((product) => [product.id, product])), categories: buildCategoryTree(fixtureCategories),
    designers: [], discounts: [], returnPolicy: fixtureReturnPolicy, delivery: fixtureDelivery, demonstrationOrders: false, reload: vi.fn(),
  };
}

const linenM = { productId: linenShirt.id, variantId: "var-linen-m-white", quantity: 2 };
const polo = { productId: poloShirt.id, variantId: "var-polo", quantity: 1 };
let store: ReturnType<typeof useStore>;

function Opener() {
  const miniCart = useMiniCart();
  store = useStore();
  return <button type="button" onClick={() => miniCart?.open({ message: "Added Cotton Polo Shirt to your cart." })}>Open cart</button>;
}

function openDrawer() {
  render(<StoreProvider><MiniCartProvider><Opener /></MiniCartProvider></StoreProvider>);
  const opener = screen.getByRole("button", { name: "Open cart" });
  opener.focus();
  fireEvent.click(opener);
  return { opener, drawer: screen.getByRole("dialog", { name: "Your cart" }) };
}

const lineNames = (drawer: HTMLElement) =>
  within(within(drawer).getByRole("list", { name: "Items in your cart" })).queryAllByRole("link").map((link) => link.textContent);

beforeEach(() => {
  mocks.user = null;
  mocks.catalog = catalogWith([linenShirt, poloShirt]);
  localStorage.setItem(shopperStateKey(null), JSON.stringify({ cart: [linenM, polo], wishlist: [] }));
});

describe("mini-cart", () => {
  it("opens on its heading with the lines, an estimated subtotal and pending fees, then gives focus back", async () => {
    const { opener, drawer } = openDrawer();
    const heading = within(drawer).getByRole("heading", { name: "Your cart (3 items)" });
    expect(document.activeElement).toBe(heading);
    expect(await within(drawer).findByText("Added Cotton Polo Shirt to your cart.")).toBeTruthy();
    expect(lineNames(drawer)).toEqual(["Linen Short-Sleeve Shirt", "Cotton Polo Shirt"]);
    expect(within(drawer).getByText("Size: M · Color: White")).toBeTruthy();
    expect(within(drawer).getByText("Subtotal (excl. VAT)").nextElementSibling?.textContent).toBe("KES 4,000");
    expect(within(drawer).getByText("VAT (16%) and delivery").nextElementSibling?.textContent).toBe("Calculated at checkout");
    // Guests sign in first and come back to checkout; the full cart page stays one link away.
    expect(within(drawer).getByRole("link", { name: "Checkout" }).getAttribute("href")).toBe("#/login?returnTo=%2Fcheckout");
    expect(within(drawer).getByRole("link", { name: "View cart" }).getAttribute("href")).toBe("#/cart");
    // The stepper stops at the SKU's stock (2) and keeps focus there.
    expect(within(drawer).getByRole("button", { name: "Increase quantity of Linen Short-Sleeve Shirt" }).getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(within(drawer).getByRole("button", { name: "Close cart" }));
    expect(screen.queryByRole("dialog", { name: "Your cart" })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("moves focus to Undo on removal, and Undo puts the line back in place with its quantity", () => {
    const { drawer } = openDrawer();
    fireEvent.click(within(drawer).getByRole("button", { name: "Remove Linen Short-Sleeve Shirt from cart" }));
    const undo = within(drawer).getByRole("button", { name: "Undo removing Linen Short-Sleeve Shirt" });
    expect(document.activeElement).toBe(undo);
    expect(lineNames(drawer)).toEqual(["Cotton Polo Shirt"]);
    expect(within(drawer).getByText("Removed Linen Short-Sleeve Shirt.")).toBeTruthy();

    fireEvent.click(undo);
    expect(store.state.cart).toEqual([linenM, polo]);
    expect(lineNames(drawer)).toEqual(["Linen Short-Sleeve Shirt", "Cotton Polo Shirt"]);
    expect(document.activeElement).toBe(within(drawer).getByRole("button", { name: "Remove Linen Short-Sleeve Shirt from cart" }));
  });

  it("keeps one Undo: a later removal replaces it, and removing the last line still leaves Undo focused", () => {
    const { drawer } = openDrawer();
    fireEvent.click(within(drawer).getByRole("button", { name: "Remove Linen Short-Sleeve Shirt from cart" }));
    fireEvent.click(within(drawer).getByRole("button", { name: "Remove Cotton Polo Shirt from cart" }));
    expect(within(drawer).queryByRole("button", { name: "Undo removing Linen Short-Sleeve Shirt" })).toBeNull();
    expect(document.activeElement).toBe(within(drawer).getByRole("button", { name: "Undo removing Cotton Polo Shirt" }));
    expect(within(drawer).getByText("Your cart is empty.")).toBeTruthy();
    fireEvent.click(within(drawer).getByRole("button", { name: "Undo removing Cotton Polo Shirt" }));
    expect(store.state.cart).toEqual([polo]);
  });

  it("sends a signed-in shopper straight to checkout", () => {
    mocks.user = { id: "customer-a" };
    localStorage.setItem(shopperStateKey("customer-a"), JSON.stringify({ cart: [polo], wishlist: [] }));
    const { drawer } = openDrawer();
    expect(within(drawer).getByRole("link", { name: "Checkout" }).getAttribute("href")).toBe("#/checkout");
  });

  it("shows loading and failure states instead of unpriced lines, and an empty state", () => {
    mocks.catalog = catalogWith([], "loading");
    const view = openDrawer();
    expect(within(view.drawer).getByText("Loading current prices…")).toBeTruthy();
    expect(within(view.drawer).queryByRole("link", { name: "Checkout" })).toBeNull();
    act(() => { mocks.catalog = catalogWith([], "error"); store.toggleWish("refresh"); });
    expect(within(view.drawer).getByRole("alert").textContent).toMatch(/Cart prices could not be loaded\..*Your cart is unchanged\./);
    fireEvent.click(within(view.drawer).getByRole("button", { name: "Try again" }));
    expect(mocks.catalog.reload).toHaveBeenCalled();

    act(() => { mocks.catalog = catalogWith([linenShirt, poloShirt]); store.clearCart(); });
    expect(within(view.drawer).getByText("Your cart is empty.")).toBeTruthy();
    fireEvent.click(within(view.drawer).getByRole("button", { name: "Continue shopping" }));
    expect(screen.queryByRole("dialog", { name: "Your cart" })).toBeNull();
  });
});
