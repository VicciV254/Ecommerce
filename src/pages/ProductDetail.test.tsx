import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PRODUCTS, type Product } from "../data/products";
import ProductDetail from "./ProductDetail";

const store = vi.hoisted((): { catalog: Product[] } => ({ catalog: [] }));

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({ user: null }),
}));
vi.mock("../store/StoreContext", () => ({
  useStore: () => ({
    catalog: store.catalog,
    state: { wishlist: [] },
    productWithStock: (product: Product) => product,
    addToCart: vi.fn(),
    toggleWish: vi.fn(),
  }),
  formatKES: (value: number) => `KES ${value}`,
}));

describe("ProductDetail", () => {
  it("keeps hook order when an asynchronously loaded custom product becomes available", () => {
    store.catalog = [];
    const id = "test-custom-product";
    const { rerender } = render(<ProductDetail id={id} />);
    expect(screen.getByRole("heading", { name: "Product not found" })).toBeTruthy();
    store.catalog = [{ ...PRODUCTS[0], id, name: "Test custom product" }];
    rerender(<ProductDetail id={id} />);
    expect(screen.getByRole("heading", { name: "Test custom product" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add to Cart" })).toBeTruthy();
    store.catalog = [];
  });
});
