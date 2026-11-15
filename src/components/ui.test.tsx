import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fixtureImage } from "../test-support/catalogFixtures";
import { MediaImage, ProductImage, ResponsiveImage } from "./ui";

vi.mock("../store/StoreContext", () => ({ useStore: () => ({ state: { wishlist: [] }, addToCart: vi.fn(), toggleWish: vi.fn() }) }));
vi.mock("../store/CatalogContext", () => ({ useCatalog: () => ({ mode: "live" }) }));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

const STORED = "https://res.cloudinary.com/apex-test/image/upload/v1763200000/apex-cart/products/20261115-abc.webp";
const uploaded = fixtureImage({ id: "img-up", url: STORED, alt: "Linen shirt, front", width: 2400, height: 3000, format: "webp", bytes: 245_000 });
const widthsOf = (image: HTMLElement) =>
  (image.getAttribute("srcset") ?? "").split(", ").map((candidate) => Number(/w_(\d+)\//.exec(candidate)?.[1]));

describe("catalog images", () => {
  it("offer card renditions with intrinsic size, async decoding and lazy loading by default", () => {
    render(<MediaImage asset={uploaded} alt="Fallback name" />);
    const image = screen.getByRole("img", { name: "Linen shirt, front" });
    expect(widthsOf(image)).toEqual([240, 320, 480, 640, 960]);
    expect(image.getAttribute("sizes")).toBe("(min-width: 1280px) 300px, (min-width: 768px) 33vw, 50vw");
    expect(image.getAttribute("src")).toContain("/upload/c_limit,w_480/q_auto/f_auto/v1763200000/");
    expect([image.getAttribute("width"), image.getAttribute("height")]).toEqual(["2400", "3000"]);
    expect(image.getAttribute("decoding")).toBe("async");
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.hasAttribute("fetchpriority")).toBe(false);
  });

  it("use the requested preset and fall back to the product name for alt text", () => {
    render(<ProductImage product={{ name: "Cotton Polo Shirt", images: [{ ...uploaded, alt: null, isMain: true }] }} preset="thumbnail" />);
    const image = screen.getByRole("img", { name: "Cotton Polo Shirt" });
    expect(widthsOf(image)).toEqual([96, 160, 240]);
    expect(image.getAttribute("sizes")).toBe("80px");
  });

  it("keep addresses that cannot be resized as src only and omit unknown dimensions", () => {
    render(<MediaImage asset={fixtureImage({ id: "img-ext", url: "https://media.example.test/polo.jpg", alt: "Polo" })} alt="Polo" />);
    const image = screen.getByRole("img", { name: "Polo" });
    expect(image.getAttribute("src")).toBe("https://media.example.test/polo.jpg");
    for (const attribute of ["srcset", "sizes", "width", "height"]) expect(image.hasAttribute(attribute), attribute).toBe(false);
  });

  it("label sample imagery and show a placeholder when there is no image", () => {
    const { unmount } = render(<MediaImage asset={{ ...uploaded, isPlaceholder: true }} alt="Sample" />);
    expect(screen.getByText("Sample image")).toBeTruthy();
    unmount();
    render(<MediaImage asset={undefined} alt="Missing" />);
    expect(screen.getByRole("img", { name: "Image not yet available" })).toBeTruthy();
  });

  it("load eagerly with high fetch priority only when marked as the priority image", () => {
    render(
      <>
        <ResponsiveImage url={STORED} preset="detail" alt="Cover" priority />
        <ResponsiveImage url={STORED} preset="detail" alt="Second view" />
      </>,
    );
    const cover = screen.getByRole("img", { name: "Cover" });
    expect([cover.getAttribute("loading"), cover.getAttribute("fetchpriority")]).toEqual(["eager", "high"]);
    expect(cover.getAttribute("sizes")).toBe("(min-width: 1024px) 50vw, 100vw");
    const second = screen.getByRole("img", { name: "Second view" });
    expect([second.getAttribute("loading"), second.hasAttribute("fetchpriority")]).toEqual(["lazy", false]);
  });
});
