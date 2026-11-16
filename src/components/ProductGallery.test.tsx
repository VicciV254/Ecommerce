import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureImage } from "../test-support/catalogFixtures";
import { ProductGallery, type GalleryLayout } from "./ProductGallery";

const LAYOUT: GalleryLayout = { sizes: "100vw", thumbnailSizes: "80px", thumbnails: "grid grid-cols-4" };
const stored = (name: string) => `https://res.cloudinary.com/apex-test/image/upload/v1763200000/apex-cart/products/${name}.webp`;
const images = [
  fixtureImage({ id: "front", url: stored("front"), alt: "Linen shirt, front", isMain: true }),
  fixtureImage({ id: "back", url: stored("back"), alt: null, order: 1 }),
  fixtureImage({ id: "sample", url: stored("sample"), alt: "Sample view", order: 2, isPlaceholder: true }),
];

const count = () => screen.getByText(/^Image \d of \d$/, { selector: "p" }).textContent;
const current = () => screen.getAllByRole("button", { name: /^Image \d of \d$/ }).findIndex((button) => button.getAttribute("aria-current") === "true");

function renderGallery(resetKey = "first") {
  return render(<ProductGallery name="Linen Short-Sleeve Shirt" images={images} resetKey={resetKey} layout={LAYOUT} />);
}

describe("product gallery", () => {
  it("names thumbnails by position, moves with buttons and arrow keys, and never moves on its own", async () => {
    renderGallery();
    expect(screen.getAllByRole("button", { name: /^Image \d of 3$/ }).map((button) => button.getAttribute("aria-label")))
      .toEqual(["Image 1 of 3", "Image 2 of 3", "Image 3 of 3"]);
    expect([count(), current()]).toEqual(["Image 1 of 3", 0]);
    // The image's own alt text, otherwise the product name and position.
    expect(screen.getByRole("img", { name: "Linen shirt, front" })).toBeTruthy();
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(count()).toBe("Image 1 of 3");

    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect([count(), current()]).toEqual(["Image 2 of 3", 1]);
    expect(screen.getByRole("img", { name: "Linen Short-Sleeve Shirt, image 2 of 3" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("button", { name: "Image 2 of 3" }), { key: "ArrowRight" });
    expect(count()).toBe("Image 3 of 3");
    // Past the last image, Next and → wrap to the first.
    fireEvent.keyDown(screen.getByRole("button", { name: "Next image" }), { key: "ArrowRight" });
    expect(count()).toBe("Image 1 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
    expect(count()).toBe("Image 3 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Image 2 of 3" }));
    expect(count()).toBe("Image 2 of 3");
  });

  it("requests only the shown image and its neighbours, keeping images that have loaded", () => {
    const five = Array.from({ length: 5 }, (_, index) => fixtureImage({ id: `view-${index}`, url: stored(`view-${index}`), alt: `View ${index + 1}`, order: index }));
    render(<ProductGallery name="Linen Short-Sleeve Shirt" images={five} resetKey="first" layout={LAYOUT} />);
    const stage = screen.getByRole("list", { name: "Images of Linen Short-Sleeve Shirt" });
    const requested = () => [...stage.querySelectorAll("img")].map((image) => image.getAttribute("alt"));
    expect(requested()).toEqual(["View 1", "View 2"]);
    fireEvent.load(stage.querySelector("img")!);
    fireEvent.click(screen.getByRole("button", { name: "Image 4 of 5" }));
    expect(requested()).toEqual(["View 1", "View 3", "View 4", "View 5"]);
  });

  it("returns to the first image when the choice changes", () => {
    const { rerender } = renderGallery();
    fireEvent.click(screen.getByRole("button", { name: "Image 3 of 3" }));
    rerender(<ProductGallery name="Linen Short-Sleeve Shirt" images={images} resetKey="first" layout={LAYOUT} />);
    expect(count()).toBe("Image 3 of 3");
    rerender(<ProductGallery name="Linen Short-Sleeve Shirt" images={images} resetKey="changed" layout={LAYOUT} />);
    expect([count(), current()]).toEqual(["Image 1 of 3", 0]);
  });

  it("opens the zoom viewer at the shown image, loading the zoom rendition only then", () => {
    renderGallery();
    expect(document.body.innerHTML).not.toMatch(/w_2400/);
    fireEvent.click(screen.getByRole("button", { name: "Image 3 of 3" }));
    const zoom = screen.getByRole("button", { name: "Zoom image 3 of 3" });
    zoom.focus();
    fireEvent.click(zoom);
    const viewer = screen.getByRole("dialog", { name: "Image viewer" });
    expect(document.activeElement).toBe(within(viewer).getByRole("button", { name: "Close" }));
    const picture = within(viewer).getByRole("img", { name: "Sample view" });
    expect(picture.getAttribute("src")).toBe("https://res.cloudinary.com/apex-test/image/upload/c_limit,w_2400/q_auto/f_auto/v1763200000/apex-cart/products/sample.webp");
    // Placeholder images keep their label in the viewer too.
    expect(within(viewer).getByText("Sample image")).toBeTruthy();
  });

  it("zooms by buttons and keys within 1× to 4×, changes image with arrows, and returns focus to the zoom button", () => {
    renderGallery();
    const zoom = screen.getByRole("button", { name: "Zoom image 1 of 3" });
    zoom.focus();
    fireEvent.click(zoom);
    const viewer = screen.getByRole("dialog", { name: "Image viewer" });
    /** The visible zoom level (its accessible text also says "Zoom"). */
    const level = () => within(viewer).getByText(/%$/).textContent?.replace(/^Zoom /, "");
    const zoomOut = within(viewer).getByRole("button", { name: "Zoom out" });
    const zoomIn = within(viewer).getByRole("button", { name: "Zoom in" });
    expect([level(), zoomOut.getAttribute("aria-disabled"), zoomIn.getAttribute("aria-disabled")]).toEqual(["100%", "true", "false"]);
    fireEvent.click(zoomOut);
    expect(level()).toBe("100%");
    fireEvent.click(zoomIn);
    expect(level()).toBe("150%");
    for (let press = 0; press < 4; press += 1) fireEvent.keyDown(zoomIn, { key: "+" });
    expect([level(), zoomIn.getAttribute("aria-disabled")]).toEqual(["400%", "true"]);
    fireEvent.keyDown(zoomIn, { key: "-" });
    expect(level()).toBe("267%");
    fireEvent.keyDown(zoomIn, { key: "0" });
    expect(level()).toBe("100%");

    fireEvent.keyDown(zoomIn, { key: "+" });
    fireEvent.keyDown(zoomIn, { key: "ArrowRight" });
    // A new image starts unzoomed.
    expect([within(viewer).getByText(/^Image \d of 3$/).textContent, level()]).toEqual(["Image 2 of 3", "100%"]);
    fireEvent(viewer, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog", { name: "Image viewer" })).toBeNull();
    // The page gallery follows the viewer, and focus is back on its zoom button.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Zoom image 2 of 3" }));
  });
});
