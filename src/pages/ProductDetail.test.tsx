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
  fixtureDelivery, fixtureReturnPolicy,
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
  useStore: () => ({ state: { wishlist: [], cart: [] }, addToCart: mocks.addToCart, toggleWish: vi.fn() }),
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
    returnPolicy: status === "ready" ? fixtureReturnPolicy : null, delivery: status === "ready" ? fixtureDelivery : null,
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
/** The page's own purchase action precedes any related-product cards and the phone purchase bar in document order. */
const addButton = () => screen.getAllByRole("button", { name: /^(Add to cart|Choose options)$/ })[0];

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

  it.each([
    ["STANDARD", "Returns within 7 days of delivery."],
    ["FAULT_ONLY", "Returnable only if faulty, damaged or wrong — within 7 days."],
    ["UNOPENED_OR_FAULT", "Returnable within 7 days if unopened, or if faulty, damaged or wrong."],
  ] as const)("states the %s returns rule with the purchase facts", (returnRule, window) => {
    mocks.catalog = catalogWith([{ ...poloShirt, returnRule }]);
    mocks.getProduct.mockImplementation(pending);
    render(<ProductDetail id={poloShirt.id} />);
    const fact = screen.getByText(/^Returns:/).closest("p");
    expect(fact?.textContent).toBe(`Returns: ${window} Refunds by M-Pesa; delivery fee refunded only for faulty, damaged or wrong items.`);
    // Phone order: options, quantity and Add come first, then the delivery and returns facts.
    expect(fact && fact.compareDocumentPosition(addButton()) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("reports an unknown product as not found instead of showing another product", async () => {
    mocks.getProduct.mockRejectedValue(notFound());
    render(<ProductDetail id="mens-fashion-1" />);
    expect(await screen.findByRole("heading", { name: "Product not found" })).toBeTruthy();
    expect(screen.queryByText("Linen Short-Sleeve Shirt")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to shop" })).toBeTruthy();
  });

  it("offers retry when the product request fails and nothing canonical is loaded", async () => {
    mocks.catalog = catalogWith([]);
    mocks.getProduct.mockRejectedValueOnce(new AxiosError("Offline", "ERR_NETWORK"));
    render(<ProductDetail id={poloShirt.id} />);
    expect(await screen.findByRole("heading", { name: "This product could not be loaded" })).toBeTruthy();
    mocks.getProduct.mockReturnValueOnce(resolved(poloShirt));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Cotton Polo Shirt" })).toBeTruthy();
  });

  it("requires explicit option choices and adds only the exact SKU", async () => {
    mocks.getProduct.mockReturnValue(resolved(linenShirt));
    render(<ProductDetail id={linenShirt.id} />);
    await screen.findByText("No reviews yet.");
    // Until every choice has a value the action reads "Choose options" and leads to the first missing choice.
    expect(screen.getByRole("group", { name: "Size Not selected" })).toBeTruthy();
    expect(addButton().textContent).toBe("Choose options");
    expect(screen.getByText("Select size and color to continue.")).toBeTruthy();
    fireEvent.click(addButton());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "S" }));
    expect(mocks.addToCart).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "M" }));
    expect(screen.getByRole("group", { name: "Size M" })).toBeTruthy();
    expect(addButton().textContent).toBe("Choose options");
    fireEvent.click(screen.getByRole("button", { name: "White" }));
    expect(screen.getAllByText("KES 900").length).toBeGreaterThan(0);
    expect(addButton().textContent).toBe("Add to cart");
    fireEvent.click(addButton());
    expect(mocks.addToCart).toHaveBeenLastCalledWith({ productId: linenShirt.id, variantId: "var-linen-m-white", quantity: 1 });

    // Unavailable values say so in text; choosing one states the reason and disables Add.
    fireEvent.click(screen.getByRole("button", { name: "Blue (sold out)" }));
    expect(screen.getByText("This combination is sold out. Choose different options.")).toBeTruthy();
    expect(addButton().hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "S (unavailable)" }));
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
    // At the limit the button stays focusable (aria-disabled), so a keyboard user's focus is not dropped.
    expect(screen.getByRole("button", { name: "Increase quantity" }).getAttribute("aria-disabled")).toBe("true");

    const fewer = { ...linenShirt, variants: linenShirt.variants.map((variant) => variant.id === "var-linen-m-white" ? { ...variant, stock: 1 } : variant) };
    mocks.catalog = catalogWith([fewer]);
    rerender(<ProductDetail id={linenShirt.id} />);
    fireEvent.click(addButton());
    expect(mocks.addToCart).toHaveBeenLastCalledWith({ productId: linenShirt.id, variantId: "var-linen-m-white", quantity: 1 });

    const recoloured = { ...linenShirt, variants: [fixtureVariant({ id: "var-linen-m-green", attributes: { size: "M", color: "Green" }, stock: 3 })] };
    mocks.catalog = catalogWith([recoloured]);
    rerender(<ProductDetail id={linenShirt.id} />);
    // A single remaining value is a fixed fact, not a choice.
    expect(screen.getByText("Green").closest("div")?.textContent).toBe("Color:Green");
    expect(screen.queryByRole("button", { name: /Green|White/ })).toBeNull();
    fireEvent.click(addButton());
    expect(mocks.addToCart).toHaveBeenLastCalledWith({ productId: linenShirt.id, variantId: "var-linen-m-green", quantity: 2 });
  });

  it("keeps a loaded image selected without restarting its spinner and recovers when its source changes", () => {
    mocks.getProduct.mockImplementation(pending);
    const { rerender } = render(<ProductDetail id={linenShirt.id} />);
    const main = screen.getByRole("img", { name: "Linen shirt, front" });
    fireEvent.load(main);
    fireEvent.click(screen.getByRole("button", { name: "Image 1 of 2" }));
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

  it("loads only the cover eagerly with high priority at detail renditions, and other views and thumbnails lazily", () => {
    mocks.getProduct.mockImplementation(pending);
    const stored = (name: string) => `https://res.cloudinary.com/apex-test/image/upload/v1763200000/apex-cart/products/${name}.webp`;
    mocks.catalog = catalogWith([{ ...linenShirt, images: [
      fixtureImage({ id: "img-cover", url: stored("cover"), alt: "Linen shirt, front", isMain: true, width: 2400, height: 3000 }),
      fixtureImage({ id: "img-back", url: stored("back"), alt: "Linen shirt, back", order: 1 }),
    ] }]);
    render(<ProductDetail id={linenShirt.id} />);
    const cover = screen.getByRole("img", { name: "Linen shirt, front" });
    expect([cover.getAttribute("loading"), cover.getAttribute("fetchpriority"), cover.getAttribute("decoding")]).toEqual(["eager", "high", "async"]);
    // From 768px the gallery is the left of two columns.
    expect(cover.getAttribute("sizes")).toBe("(min-width: 768px) 50vw, 100vw");
    expect(cover.getAttribute("srcset")?.split(", ").map((entry) => entry.split(" ")[1])).toEqual(["480w", "640w", "960w", "1280w", "1600w"]);
    expect([cover.getAttribute("width"), cover.getAttribute("height")]).toEqual(["2400", "3000"]);
    const thumbnails = screen.getAllByRole("button", { name: /^Image \d+ of \d+$/ }).map((button) => button.querySelector("img")!);
    const strip = "(min-width: 1440px) 157px, (min-width: 1024px) calc(12.5vw - 23px), (min-width: 768px) calc(12.5vw - 20px), (min-width: 640px) calc(25vw - 22px), calc(25vw - 18px)";
    expect(thumbnails.map((image) => [image.getAttribute("sizes"), image.getAttribute("loading")])).toEqual([[strip, "lazy"], [strip, "lazy"]]);
    expect(thumbnails[0].getAttribute("srcset")?.split(", ").map((entry) => entry.split(" ")[1])).toEqual(["96w", "160w", "240w"]);

    fireEvent.click(screen.getByRole("button", { name: "Image 2 of 2" }));
    const back = screen.getByRole("img", { name: "Linen shirt, back" });
    expect([back.getAttribute("loading"), back.hasAttribute("fetchpriority")]).toEqual(["lazy", false]);
    expect(document.body.innerHTML).not.toMatch(/w_2400/);
  });

  it("labels demo listings and sample imagery, and never renders an empty image source", () => {
    mocks.getProduct.mockImplementation(pending);
    const { rerender } = render(<ProductDetail id={demoPhone.id} />);
    expect(screen.getByText("Demo")).toBeTruthy();
    expect(screen.getByText(/Demo listing: details, price, stock and images are samples/)).toBeTruthy();
    expect(screen.getByText("Sample image")).toBeTruthy();
    // The price in the purchase facts (the phone purchase bar repeats it).
    expect(within(screen.getByRole("heading", { level: 1 }).parentElement!).getByText("KES 7,500")).toBeTruthy();

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
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
