import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogProduct, CatalogProductDetail } from "../api/catalog";
import { buildCategoryTree } from "../store/catalogModel";
import type { CatalogValue } from "../store/CatalogContext";
import {
  demoPhone,
  fixtureCategories,
  fixtureDiscounts,
  fixtureImage,
  fixtureVariant,
  imagelessShirt,
  linenShirt,
  poloShirt,
} from "../test-support/catalogFixtures";
import ProductDetail from "./ProductDetail";

const mocks = vi.hoisted(() => ({
  addToCart: vi.fn(),
  getProduct: vi.fn(),
  catalog: null as CatalogValue | null,
}));

vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "test-customer" } }) }));
vi.mock("../store/StoreContext", () => ({
  useStore: () => ({ state: { wishlist: [] }, addToCart: mocks.addToCart, toggleWish: vi.fn() }),
}));
vi.mock("../store/CatalogContext", () => ({ useCatalog: () => mocks.catalog }));
vi.mock("../api/catalog", () => ({ catalogAPI: { getProduct: mocks.getProduct } }));

function catalogWith(products: CatalogProduct[], status: CatalogValue["status"] = "ready"): CatalogValue {
  return {
    status,
    error: status === "error" ? "The catalog could not be loaded." : null,
    mode: status === "ready" ? "demo" : null,
    products,
    productsById: new Map(products.map((product) => [product.id, product])),
    categories: buildCategoryTree(fixtureCategories),
    designers: [],
    discounts: fixtureDiscounts,
    reload: vi.fn(),
  };
}

function notFound() {
  return new AxiosError("Not found", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 404, statusText: "Not Found", data: { error: "Product not found" }, headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() },
  });
}

/** Detail request that stays pending, so the page renders the snapshot record. */
const pending = () => new Promise<never>(() => undefined);
const resolved = (product: CatalogProductDetail) => Promise.resolve({ data: product });
/** The purchase button precedes any related-product cards in document order. */
const addButton = () => screen.getAllByRole("button", { name: /^(✓ )?Add(ed)? to Cart$|^Out of Stock$/ })[0];

beforeEach(() => {
  mocks.addToCart.mockClear();
  mocks.getProduct.mockReset();
  mocks.catalog = catalogWith([linenShirt, poloShirt, imagelessShirt, demoPhone]);
});

describe("ProductDetail", () => {
  it("keeps hook order when the authoritative product arrives after a loading state", async () => {
    mocks.catalog = catalogWith([]);
    let finish!: (value: { data: CatalogProductDetail }) => void;
    mocks.getProduct.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<ProductDetail id={poloShirt.id} />);
    expect(screen.getByText("Loading product…")).toBeTruthy();
    await act(async () => finish({ data: poloShirt }));
    expect(screen.getByRole("heading", { name: "Cotton Polo Shirt" })).toBeTruthy();
    expect(addButton().hasAttribute("disabled")).toBe(false);
  });

  it("reports an unknown product as not found instead of showing another product", async () => {
    mocks.getProduct.mockRejectedValue(notFound());
    render(<ProductDetail id="mens-fashion-1" />);
    expect(await screen.findByRole("heading", { name: "Product not found" })).toBeTruthy();
    expect(screen.queryByText("Linen Short-Sleeve Shirt")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to Shop" })).toBeTruthy();
  });

  it("offers retry when the product request fails and nothing canonical is loaded", async () => {
    mocks.catalog = catalogWith([]);
    mocks.getProduct.mockRejectedValueOnce(new AxiosError("Offline", "ERR_NETWORK"));
    render(<ProductDetail id={poloShirt.id} />);
    expect(await screen.findByRole("heading", { name: "This product could not be loaded" })).toBeTruthy();
    mocks.getProduct.mockReturnValueOnce(resolved(poloShirt));
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(await screen.findByRole("heading", { name: "Cotton Polo Shirt" })).toBeTruthy();
  });

  it("requires explicit option choices and adds only the exact SKU", async () => {
    mocks.getProduct.mockReturnValue(resolved(linenShirt));
    render(<ProductDetail id={linenShirt.id} />);
    await screen.findByText("No reviews yet.");
    expect(addButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Select size and color to continue.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "M" }));
    fireEvent.click(screen.getByRole("button", { name: "White" }));
    expect(screen.getAllByText("KES 900").length).toBeGreaterThan(0);
    fireEvent.click(addButton());
    expect(mocks.addToCart).toHaveBeenLastCalledWith({ productId: linenShirt.id, variantId: "var-linen-m-white", quantity: 1 });

    fireEvent.click(screen.getByRole("button", { name: "Blue" }));
    expect(addButton().textContent).toBe("Out of Stock");
    expect(addButton().hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "S" }));
    expect(screen.getByText("This combination is not available. Choose different options.")).toBeTruthy();
    expect(addButton().hasAttribute("disabled")).toBe(true);
    expect(mocks.addToCart).toHaveBeenCalledTimes(1);
  });

  it("resets selections and quantity when navigating to a different product", () => {
    mocks.getProduct.mockImplementation(pending);
    const { rerender } = render(<ProductDetail id={linenShirt.id} />);
    fireEvent.click(screen.getByRole("button", { name: "S" }));
    fireEvent.click(screen.getByRole("button", { name: "White" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity" }));
    fireEvent.click(addButton());
    expect(mocks.addToCart).toHaveBeenLastCalledWith({ productId: linenShirt.id, variantId: "var-linen-s-white", quantity: 2 });

    rerender(<ProductDetail id={poloShirt.id} />);
    fireEvent.click(addButton());
    expect(mocks.addToCart).toHaveBeenLastCalledWith({ productId: poloShirt.id, variantId: "var-polo", quantity: 1 });
  });

  it("revalidates choices and clamps quantity when the catalog record changes", () => {
    mocks.getProduct.mockImplementation(pending);
    const { rerender } = render(<ProductDetail id={linenShirt.id} />);
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    fireEvent.click(screen.getByRole("button", { name: "White" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity" }));
    expect(screen.getByRole("button", { name: "Increase quantity" }).hasAttribute("disabled")).toBe(true);

    const fewer = { ...linenShirt, variants: linenShirt.variants.map((variant) => variant.id === "var-linen-m-white" ? { ...variant, stock: 1 } : variant) };
    mocks.catalog = catalogWith([fewer]);
    rerender(<ProductDetail id={linenShirt.id} />);
    fireEvent.click(addButton());
    expect(mocks.addToCart).toHaveBeenLastCalledWith({ productId: linenShirt.id, variantId: "var-linen-m-white", quantity: 1 });

    const recoloured = { ...linenShirt, variants: [fixtureVariant({ id: "var-linen-m-green", attributes: { size: "M", color: "Green" }, stock: 3 })] };
    mocks.catalog = catalogWith([recoloured]);
    rerender(<ProductDetail id={linenShirt.id} />);
    expect(screen.getByRole("button", { name: "Green" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "White" })).toBeNull();
    fireEvent.click(addButton());
    expect(mocks.addToCart).toHaveBeenLastCalledWith({ productId: linenShirt.id, variantId: "var-linen-m-green", quantity: 2 });
  });

  it("keeps a loaded image selected without restarting its spinner and recovers when its source changes", () => {
    mocks.getProduct.mockImplementation(pending);
    const { rerender } = render(<ProductDetail id={linenShirt.id} />);
    const main = screen.getByRole("img", { name: "Linen shirt, front" });
    fireEvent.load(main);
    fireEvent.click(screen.getByRole("button", { name: "Show image 1 of 2" }));
    expect(screen.queryByText("Loading image...")).toBeNull();

    fireEvent.error(main);
    expect(screen.getByText("Image unavailable")).toBeTruthy();
    const replaced = { ...linenShirt, images: [fixtureImage({ id: "img-new", url: "https://media.example.test/replaced.jpg", alt: "Linen shirt, front", isMain: true })] };
    mocks.catalog = catalogWith([replaced]);
    rerender(<ProductDetail id={linenShirt.id} />);
    expect(screen.queryByText("Image unavailable")).toBeNull();
    expect(screen.getByText("Loading image...")).toBeTruthy();
    const replacement = screen.getByRole("img", { name: "Linen shirt, front" });
    expect(replacement.getAttribute("src")).toBe("https://media.example.test/replaced.jpg");
    fireEvent.load(replacement);
    expect(screen.queryByText("Loading image...")).toBeNull();
  });

  it("labels demo listings and sample imagery, and never renders an empty image source", () => {
    mocks.getProduct.mockImplementation(pending);
    const { rerender } = render(<ProductDetail id={demoPhone.id} />);
    expect(screen.getByText("Demo")).toBeTruthy();
    expect(screen.getByText(/Demo listing: details, price, stock and images are samples/)).toBeTruthy();
    expect(screen.getByText("Sample image")).toBeTruthy();
    expect(screen.getByText("KES 7,500")).toBeTruthy();

    rerender(<ProductDetail id={imagelessShirt.id} />);
    expect(screen.getByRole("img", { name: "Product images are not yet available" })).toBeTruthy();
    expect(document.querySelector('img[src=""]')).toBeNull();
  });

  it("shows only validated review records from the product API", async () => {
    const malformed = { id: "review-2", rating: 5, comment: "Malformed record" };
    mocks.getProduct.mockReturnValue(Promise.resolve({
      data: {
        ...poloShirt,
        rating: 4,
        reviewsCount: 1,
        reviewList: [{ id: "review-1", rating: 4, comment: "Fits as described.", author: "Test C", createdAt: "2026-10-01T00:00:00.000Z" }, malformed],
      },
    }));
    render(<ProductDetail id={poloShirt.id} />);
    const reviews = (await screen.findByText("Fits as described.")).closest("section");
    expect(reviews).not.toBeNull();
    expect(within(reviews!).queryByText("Malformed record")).toBeNull();
  });

  it("shows the catalog error instead of static product data", () => {
    mocks.catalog = catalogWith([], "error");
    mocks.getProduct.mockImplementation(pending);
    render(<ProductDetail id={linenShirt.id} />);
    expect(screen.getByRole("heading", { name: "Products are unavailable" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try Again" })).toBeTruthy();
  });
});
