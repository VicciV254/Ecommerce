import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackToTop } from "./BackToTop";

/** A page six screens tall, scrolled by setting `scrollY`; animation frames run at once. */
const SCREEN = 800;
const PAGE = 6000;
let position = 0;
const saved = (["scrollY", "innerHeight"] as const).map((key) => [key, Object.getOwnPropertyDescriptor(window, key)] as const);

beforeEach(() => {
  position = 0;
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => position });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: SCREEN });
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: PAGE });
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(performance.now());
    return 1;
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

afterEach(() => {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(window, key, descriptor);
    else Reflect.deleteProperty(window, key);
  }
  Reflect.deleteProperty(document.documentElement, "scrollHeight");
});

const scrollTo = (y: number) => act(() => {
  position = y;
  window.dispatchEvent(new Event("scroll"));
});
const button = () => screen.getByRole("button", { name: "Back to top" });
const shown = () => button().hasAttribute("data-shown");
const rect = (left: number, top: number, size: number) =>
  ({ left, top, right: left + size, bottom: top + size, width: size, height: size, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

describe("back to top", () => {
  it("appears only while the page scrolls up, more than a screen from the top, and leaves on the way down or near the top", () => {
    render(<BackToTop />);
    expect(shown()).toBe(false);
    scrollTo(1500);
    scrollTo(3000);
    expect(shown(), "scrolling down").toBe(false);
    scrollTo(2800);
    expect(shown(), "scrolling up").toBe(true);
    scrollTo(2600);
    expect(shown(), "still scrolling up").toBe(true);
    scrollTo(2700);
    expect(shown(), "down again").toBe(false);
    scrollTo(2695);
    expect(shown(), "a few pixels back is not a change of direction").toBe(false);
    scrollTo(2650);
    expect(shown()).toBe(true);
    scrollTo(2653);
    expect(shown(), "nor is a few pixels on").toBe(true);
    scrollTo(700);
    expect(shown(), "within a screen of the top").toBe(false);
  });

  it("ignores the bounce past the bottom of the page", () => {
    render(<BackToTop />);
    scrollTo(PAGE - SCREEN);
    scrollTo(PAGE - SCREEN + 60);
    scrollTo(PAGE - SCREEN);
    expect(shown(), "settling back from the bottom is not scrolling up").toBe(false);
  });

  it("takes the page to the top, and focus to the start of the page", () => {
    render(
      <>
        <header data-site-header><a href="#/">Apex Cart</a><button type="button">Menu</button></header>
        <main><button type="button">Inside</button></main>
        <BackToTop />
      </>,
    );
    scrollTo(3000);
    scrollTo(2800);
    const home = screen.getByRole("link", { name: "Apex Cart" });
    const focus = vi.spyOn(home, "focus");
    fireEvent.click(button());
    // "auto" follows the page's own scroll behaviour: smooth, or at once when the shopper prefers reduced motion.
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(home);
  });

  it("stays while it has focus, and steps aside for keyboard focus it would cover", () => {
    render(<><button type="button">Under</button><button type="button">Elsewhere</button><BackToTop /></>);
    const under = screen.getByRole("button", { name: "Under" });
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    button().getBoundingClientRect = () => rect(330, 730, 48);
    under.getBoundingClientRect = () => rect(300, 700, 44);
    elsewhere.getBoundingClientRect = () => rect(20, 700, 44);
    scrollTo(3000);
    scrollTo(2800);
    act(() => button().focus());
    scrollTo(2900);
    expect(shown(), "focused, so it stays on the way down").toBe(true);
    act(() => button().blur());
    expect(shown(), "and leaves with its focus").toBe(false);
    scrollTo(2700);
    expect(shown()).toBe(true);
    act(() => elsewhere.focus());
    expect(shown(), "focus it does not cover").toBe(true);
    act(() => under.focus());
    expect(shown(), "focus it would cover").toBe(false);
  });
});
