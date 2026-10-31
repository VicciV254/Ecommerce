import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StoreProvider, useStore } from "./StoreContext";
import Home from "../pages/Home";
import Shop from "../pages/Shop";
import Wishlist from "../pages/Wishlist";
import Showroom from "../pages/Showroom";
import ProductDetail from "../pages/ProductDetail";
import { ProductSearch } from "../components/ProductSearch";

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "pricing-test-user" } }),
}));
vi.mock("../api/settings", () => ({
  settingsAPI: { getAdminData: vi.fn(async () => ({ data: null })) },
}));

function prepareDiscount() {
  localStorage.setItem("nmb-admin-store", JSON.stringify({
    admin: {
      productOverrides: { "mens-fashion-1": { price: 1000 } },
      discounts: [{
        id: "test-discount",
        name: "Test discount",
        scope: "products",
        productIds: ["mens-fashion-1"],
        percent: 10,
        startDate: "2000-01-01",
        endDate: "2100-01-01",
      }],
    },
  }));
  localStorage.setItem("nmb-store:pricing-test-user", JSON.stringify({
    cart: [],
    wishlist: ["mens-fashion-1"],
  }));
}

describe("single display discount", () => {
  for (const [name, view] of [
    ["Home", <Home />],
    ["Shop", <Shop route="/shop?q=Linen%20Short-Sleeve%20Shirt" />],
    ["Wishlist", <Wishlist />],
    ["Showroom", <Showroom />],
    ["Product detail", <ProductDetail id="mens-fashion-1" />],
    ["Related product card", <ProductDetail id="mens-fashion-2" />],
  ] as const) {
    it(`${name} displays a 10% discount on KES 1,000 as KES 900, not KES 810`, async () => {
      prepareDiscount();
      render(<StoreProvider>{view}</StoreProvider>);
      expect((await screen.findAllByText("KES 900")).length).toBeGreaterThan(0);
      expect(screen.queryByText("KES 810")).toBeNull();
    });
  }

  it("preserves the original catalog price and leaves unrelated products unchanged", () => {
    prepareDiscount();
    function PriceProbe() {
      const { catalog, productWithStock } = useStore();
      const original = catalog.find((product) => product.id === "mens-fashion-1")!;
      const unrelated = catalog.find((product) => product.id === "mens-fashion-2")!;
      const discounted = productWithStock(original);
      expect(original.price).toBe(1000);
      expect(discounted.price).toBe(900);
      expect(discounted.comparePrice).toBe(1000);
      expect(productWithStock(unrelated).price).toBe(unrelated.price);
      return null;
    }
    render(<StoreProvider><PriceProbe /></StoreProvider>);
  });

  it("shows the same single discounted price in product search suggestions", async () => {
    prepareDiscount();
    render(<StoreProvider><ProductSearch /></StoreProvider>);
    fireEvent.change(screen.getByRole("combobox", { name: "Search products" }), { target: { value: "Linen Short-Sleeve Shirt" } });
    const product = await screen.findByRole("option", { name: /Linen Short-Sleeve Shirt/ });
    expect(within(product).getByText("KES 900")).toBeTruthy();
    expect(within(product).queryByText("KES 810")).toBeNull();
  });
});
