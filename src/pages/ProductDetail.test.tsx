import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRODUCTS, type Product } from "../data/products";
import ProductDetail from "./ProductDetail";

const store = vi.hoisted(() => ({ catalog: [] as Product[], addToCart: vi.fn() }));

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "test-customer" } }),
}));
vi.mock("../store/StoreContext", () => ({
  useStore: () => ({
    catalog: store.catalog,
    state: { wishlist: [] },
    productWithStock: (product: Product) => product,
    addToCart: store.addToCart,
    toggleWish: vi.fn(),
  }),
  formatKES: (value: number) => `KES ${value}`,
}));

beforeEach(() => {
  store.catalog = [];
  store.addToCart.mockClear();
});

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

  it("resets selections and quantity when navigating to a different product", () => {
    const first = { ...PRODUCTS[0], id: "first-custom", sizes: ["S", "M"], colors: ["White", "Blue"], stock: 3 };
    const second = { ...PRODUCTS[0], id: "second-custom", sizes: ["L"], colors: ["Brown"], stock: 5 };
    store.catalog = [first, second];
    const { rerender } = render(<ProductDetail id={first.id} />);
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    fireEvent.click(screen.getByRole("button", { name: "Blue" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Add to Cart" })[0]);
    expect(store.addToCart).toHaveBeenLastCalledWith({ productId: first.id, qty: 2, size: "M", color: "Blue" });

    rerender(<ProductDetail id={second.id} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Add to Cart" })[0]);
    expect(store.addToCart).toHaveBeenLastCalledWith({ productId: second.id, qty: 1, size: "L", color: "Brown" });
  });

  it("uses current options and clamps quantity when the product stock changes", () => {
    const product = { ...PRODUCTS[0], id: "edited-custom", sizes: ["S", "M"], colors: ["White", "Blue"], stock: 3 };
    store.catalog = [product];
    const { rerender } = render(<ProductDetail id={product.id} />);
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    fireEvent.click(screen.getByRole("button", { name: "Blue" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity" }));
    expect(screen.getByRole("button", { name: "Increase quantity" }).hasAttribute("disabled")).toBe(true);
    store.catalog = [{ ...product, stock: 1, sizes: ["L"], colors: ["Brown"] }];
    rerender(<ProductDetail id={product.id} />);
    expect(screen.getByRole("button", { name: "L" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(store.addToCart).toHaveBeenLastCalledWith({ productId: product.id, qty: 1, size: "L", color: "Brown" });

    store.catalog = [{ ...product, stock: 0 }];
    rerender(<ProductDetail id={product.id} />);
    fireEvent.click(screen.getByRole("button", { name: "Out of Stock" }));
    expect(store.addToCart).toHaveBeenCalledTimes(1);
  });

  it("keeps a loaded thumbnail selected without restarting its spinner and recovers when its source changes", () => {
    const product = { ...PRODUCTS[0], id: "image-custom", name: "Image test product", main_image: "https://example.test/first.jpg" };
    store.catalog = [product];
    const { rerender } = render(<ProductDetail id={product.id} />);
    const mainImage = screen.getAllByRole("img", { name: "Image test product — Front View" })[0];
    fireEvent.load(mainImage);
    fireEvent.click(screen.getByRole("button", { name: "Front View" }));
    expect(screen.queryByText("Loading image...")).toBeNull();

    fireEvent.error(mainImage);
    expect(screen.getByText("Image unavailable")).toBeTruthy();
    store.catalog = [{ ...product, main_image: "https://example.test/replaced.jpg" }];
    rerender(<ProductDetail id={product.id} />);
    expect(screen.queryByText("Image unavailable")).toBeNull();
    expect(screen.getByText("Loading image...")).toBeTruthy();
    const replacement = screen.getAllByRole("img", { name: "Image test product — Front View" })[0];
    expect(replacement.getAttribute("src")).toBe("https://example.test/replaced.jpg");
    fireEvent.load(replacement);
    expect(screen.queryByText("Loading image...")).toBeNull();
  });
});
