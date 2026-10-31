import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogProvider } from "./CatalogContext";
import { StoreProvider } from "./StoreContext";
import { StorefrontProvider } from "./StorefrontContext";
import Home from "../pages/Home";
import Shop from "../pages/Shop";
import Wishlist from "../pages/Wishlist";
import Showroom from "../pages/Showroom";
import Cart from "../pages/Cart";
import ProductDetail from "../pages/ProductDetail";
import { ProductSearch } from "../components/ProductSearch";
import { shopperStateKey } from "../utils/storage";
import { fixtureSnapshot, fixtureStorefront, linenShirt, poloShirt } from "../test-support/catalogFixtures";

const CUSTOMER_ID = "pricing-test-user";
const api = vi.hoisted(() => ({ getSnapshot: vi.fn(), getStorefront: vi.fn(), getProduct: vi.fn() }));
vi.mock("../api/catalog", () => ({ catalogAPI: api }));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "pricing-test-user" } }) }));

function renderStore(view: ReactNode) {
  return render(
    <StorefrontProvider>
      <CatalogProvider>
        <StoreProvider>{view}</StoreProvider>
      </CatalogProvider>
    </StorefrontProvider>,
  );
}

beforeEach(() => {
  api.getSnapshot.mockResolvedValue({ data: fixtureSnapshot() });
  api.getStorefront.mockResolvedValue({ data: fixtureStorefront() });
  api.getProduct.mockImplementation((id: string) => {
    const product = fixtureSnapshot().products.find((item) => item.id === id);
    return product ? Promise.resolve({ data: product }) : new Promise(() => undefined);
  });
  localStorage.setItem(shopperStateKey(CUSTOMER_ID), JSON.stringify({
    cart: [{ productId: linenShirt.id, variantId: "var-linen-m-white", quantity: 2 }],
    wishlist: [linenShirt.id],
  }));
});

describe("single display discount from the canonical catalog", () => {
  for (const [name, view] of [
    ["Home featured section", <Home />],
    ["Shop search", <Shop route="/shop?q=Linen%20Short-Sleeve%20Shirt" />],
    ["Wishlist", <Wishlist />],
    ["Showroom", <Showroom />],
    ["Product detail", <ProductDetail id={linenShirt.id} />],
    ["Related product card", <ProductDetail id={poloShirt.id} />],
  ] as const) {
    it(`${name} shows 10% off KES 1,000 as KES 900, never KES 810`, async () => {
      renderStore(view);
      expect((await screen.findAllByText("KES 900")).length).toBeGreaterThan(0);
      expect(screen.queryByText("KES 810")).toBeNull();
    });
  }

  it("prices cart lines per SKU from the API without a client coupon", async () => {
    renderStore(<Cart />);
    const line = (await screen.findByRole("link", { name: "Linen Short-Sleeve Shirt" })).closest("li")!;
    expect(within(line).getByText("Size: M · Color: White")).toBeTruthy();
    expect(within(line).getByText("KES 1,800")).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Promo Code/)).toBeNull();
    expect(screen.getByText("Not yet calculated")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Checkout temporarily unavailable" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows the same single discounted price in search suggestions", async () => {
    renderStore(<ProductSearch />);
    fireEvent.change(screen.getByRole("combobox", { name: "Search products" }), { target: { value: "Linen Short-Sleeve Shirt" } });
    const option = await screen.findByRole("option", { name: /Linen Short-Sleeve Shirt/ });
    expect(within(option).getByText("KES 900")).toBeTruthy();
  });

  it("reports an unavailable catalog instead of rendering a success-shaped empty shop", async () => {
    api.getSnapshot.mockRejectedValue(new Error("offline"));
    renderStore(<Shop route="/shop" />);
    expect(await screen.findByRole("heading", { name: "Products are unavailable" })).toBeTruthy();
    expect(screen.queryByText(/products found/)).toBeNull();
  });
});
