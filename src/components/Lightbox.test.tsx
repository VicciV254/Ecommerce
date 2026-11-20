import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureImage } from "../test-support/catalogFixtures";
import { Lightbox } from "./Lightbox";

const images = [
  fixtureImage({ id: "one", url: "https://media.example.test/one.jpg", alt: "First view", width: 1200, height: 1500 }),
  fixtureImage({ id: "two", url: "https://media.example.test/two.jpg", alt: "Second view", width: 1200, height: 1500 }),
];

function renderViewer() {
  render(<Lightbox name="Linen Short-Sleeve Shirt" images={images} index={0} onIndexChange={() => {}} onClose={() => {}} />);
  const viewer = screen.getByRole("dialog", { name: "Image viewer" });
  const surface = within(viewer).getByRole("img", { name: "First view" }).parentElement!;
  const level = () => within(viewer).getByText(/%$/).textContent?.replace(/^Zoom /, "");
  return { surface, level };
}

const touch = (pointerId: number, x: number, y = 100) => ({ pointerId, pointerType: "touch", clientX: x, clientY: y, isPrimary: pointerId === 1 });

/** The viewer at its first image, recording every image it asks to show instead. */
function renderTracked() {
  const shown: number[] = [];
  render(<Lightbox name="Linen Short-Sleeve Shirt" images={images} index={0} onIndexChange={(next) => shown.push(next)} onClose={() => {}} />);
  const viewer = screen.getByRole("dialog", { name: "Image viewer" });
  const surface = within(viewer).getByRole("img", { name: "First view" }).parentElement!;
  return { viewer, surface, shown };
}

describe("changing the picture while zoomed", () => {
  it("keeps the picture while zoomed: Previous and Next are unavailable and the arrow keys pan; at 100% both change it", () => {
    const { viewer, shown } = renderTracked();
    const next = within(viewer).getByRole("button", { name: "Next image" });
    const previous = within(viewer).getByRole("button", { name: "Previous image" });
    fireEvent.click(within(viewer).getByRole("button", { name: "Zoom in" }));
    expect([next.getAttribute("aria-disabled"), previous.getAttribute("aria-disabled")]).toEqual(["true", "true"]);
    fireEvent.click(next);
    fireEvent.click(previous);
    fireEvent.keyDown(next, { key: "ArrowRight" });
    fireEvent.keyDown(next, { key: "ArrowLeft" });
    expect(shown).toEqual([]);
    fireEvent.keyDown(next, { key: "0" });
    expect([next.getAttribute("aria-disabled"), previous.getAttribute("aria-disabled")]).toEqual(["false", "false"]);
    fireEvent.click(next);
    fireEvent.keyDown(next, { key: "ArrowLeft" });
    expect(shown).toEqual([1, 1]);
  });

  it("never swipes to another picture with the finger left on the glass after pinching back to 100%", () => {
    const { surface, shown } = renderTracked();
    fireEvent.pointerDown(surface, touch(1, 100));
    fireEvent.pointerDown(surface, touch(2, 140));
    fireEvent.pointerMove(surface, touch(2, 180));
    fireEvent.pointerMove(surface, touch(2, 140));
    fireEvent.pointerUp(surface, touch(2, 140));
    fireEvent.pointerMove(surface, touch(1, 40));
    fireEvent.pointerMove(surface, touch(1, -20));
    fireEvent.pointerUp(surface, touch(1, -20));
    expect(shown).toEqual([]);
    // A fresh swipe at 100% still changes it.
    fireEvent.pointerDown(surface, touch(3, 200));
    fireEvent.pointerMove(surface, touch(3, 120));
    fireEvent.pointerUp(surface, touch(3, 120));
    expect(shown).toEqual([1]);
  });
});

describe("image viewer gestures", () => {
  it("zooms with a pinch, and lifting the fingers afterwards never counts as a tap", () => {
    const { surface, level } = renderViewer();
    fireEvent.pointerDown(surface, touch(1, 100));
    fireEvent.pointerDown(surface, touch(2, 140));
    fireEvent.pointerMove(surface, touch(2, 180));
    expect(level()).toBe("200%");
    fireEvent.pointerUp(surface, touch(1, 100));
    fireEvent.pointerUp(surface, touch(2, 180));
    // A single tap right after, where the last finger lifted, is one tap: it must not complete a double-tap.
    fireEvent.pointerDown(surface, touch(3, 180));
    fireEvent.pointerUp(surface, touch(3, 180));
    expect(level()).toBe("200%");
  });

  it("toggles zoom once for a touch double-tap, even when the browser also reports a double-click", () => {
    const { surface, level } = renderViewer();
    for (let tap = 0; tap < 2; tap += 1) {
      fireEvent.pointerDown(surface, touch(10 + tap, 120));
      fireEvent.pointerUp(surface, touch(10 + tap, 120));
    }
    expect(level()).toBe("200%");
    fireEvent.doubleClick(surface, { clientX: 120, clientY: 100 });
    expect(level()).toBe("200%");
    // A mouse double-click toggles on its own.
    fireEvent.pointerDown(surface, { pointerId: 20, pointerType: "mouse", button: 0, clientX: 120, clientY: 100 });
    fireEvent.pointerUp(surface, { pointerId: 20, pointerType: "mouse", button: 0, clientX: 120, clientY: 100 });
    fireEvent.doubleClick(surface, { clientX: 120, clientY: 100 });
    expect(level()).toBe("100%");
  });
});
