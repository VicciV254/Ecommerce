import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Campaign, StorefrontSettings } from "../api/catalog";
import { buildCategoryTree } from "../store/catalogModel";
import type { CatalogValue } from "../store/CatalogContext";
import { fixtureCategories, fixtureImage, fixtureStorefrontSettings, linenShirt, poloShirt } from "../test-support/catalogFixtures";
import { ModalDialog } from "./Modal";
import { StorefrontSections } from "./StorefrontSections";

/*
 * The hero carousel (APG carousel pattern): slides rotate every 6 s with one clock driving the progress line and the slow
 * zoom; hover, dialogs, a hidden tab and leaving the screen pause it (time kept); keyboard entry, Previous/Next, a dot, a
 * swipe or a tap stop it until "Play slides"; reduced motion starts it stopped.
 */
const state = vi.hoisted(() => ({ catalog: null as CatalogValue | null }));
vi.mock("../store/CatalogContext", () => ({ useCatalog: () => state.catalog }));
vi.mock("../store/StoreContext", () => ({ useStore: () => ({ state: { wishlist: [] }, addToCart: vi.fn(), toggleWish: vi.fn() }) }));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

type Section = StorefrontSettings["sections"][number];
const SLIDE_MS = 6000;

function catalogWith(status: CatalogValue["status"] = "ready"): CatalogValue {
  const products = [linenShirt, poloShirt];
  return {
    status, error: status === "error" ? "The catalog could not be loaded." : null, mode: "live", products,
    productsById: new Map(products.map((product) => [product.id, product])), categories: buildCategoryTree(fixtureCategories),
    designers: [], discounts: [], returnPolicy: null, delivery: null, demonstrationOrders: null, sampleOrderRetentionDays: null, reload: vi.fn(),
  };
}

const campaign = (id: string, title: string, overrides: Partial<Campaign> = {}): Campaign => ({
  id, title, body: `${title}: new arrivals.`, conditions: "", cta: { label: `Shop ${title}`, target: "shop", targetId: null },
  desktopMediaId: `media-${id}`, mobileMediaId: null, desktopFocal: { x: 50, y: 50 }, mobileFocal: { x: 40, y: 30 }, layout: "overlay",
  ...overrides,
});
const CAMPAIGNS = [campaign("week", "Fashion week"), campaign("season", "New season"), campaign("home", "Home refresh")];
const mediaById = new Map(CAMPAIGNS.map((item) => {
  const asset = fixtureImage({ id: `media-${item.id}`, url: `https://media.example.test/${item.id}.jpg`, alt: "" });
  return [asset.id, asset];
}));
const carousel = (campaignIds: string[], extra: Partial<Section> = {}): Section => ({
  id: "hero-carousel", type: "carousel", title: "Highlights", enabled: true, productIds: [], categoryIds: [], campaignId: null, campaignIds, ...extra,
});
const settingsWith = (sections: Section[], campaigns = CAMPAIGNS) => fixtureStorefrontSettings({ sections, campaigns });
const show = (sections: Section[], campaigns = CAMPAIGNS, props: { showProblems?: boolean } = {}) =>
  render(<StorefrontSections settings={settingsWith(sections, campaigns)} mediaById={mediaById} {...props} />);

const region = () => screen.getByRole("region", { name: "Highlights" });
/** The slide shoppers and assistive technology can reach: the others are inert and hidden. */
const current = () => within(region()).getByRole("group").getAttribute("aria-label");
const allSlides = () => within(region()).getAllByRole("group", { hidden: true });
const slidesBox = () => allSlides()[0].parentElement!;
const rotation = () => within(region()).getByRole("button", { name: /^(Pause|Play) slides$/ });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
/**
 * Web Animations stand-in (jsdom has none) on the fake clock: enough to tell where the browser would have got an
 * animation of one `scale(...)` or `scaleX(...)` transform to. Cancelling removes it.
 */
const animations = new Map<Element, { from: number; to: number; start: number; duration: number }>();
const scaleIn = (transform: unknown) => Number(/^scaleX?\((.+)\)$/.exec(String(transform))?.[1]);
function fakeAnimate(this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
  const entry = { from: scaleIn(keyframes[0].transform), to: scaleIn(keyframes.at(-1)?.transform), start: performance.now(), duration: Number(options.duration) };
  animations.set(this, entry);
  return { cancel: () => { if (animations.get(this) === entry) animations.delete(this); } };
}
/** The scale an element shows: where its animation has got to, else what was written on it, else its resting value. */
const shownScale = (element: HTMLElement | null, rest: number) => {
  const animation = element ? animations.get(element) : undefined;
  if (animation) return animation.from + (animation.to - animation.from) * Math.min((performance.now() - animation.start) / animation.duration, 1);
  const match = /^scaleX?\((.+)\)$/.exec(element?.style.transform ?? "");
  return match ? Number(match[1]) : rest;
};
const progress = () => shownScale(region().querySelector<HTMLElement>("[aria-current='true'] span span"), 0);
const zoomOf = (slide: HTMLElement) => shownScale(slide.querySelector<HTMLElement>("[data-slide-zoom]"), 1);

/** Media queries: reduced motion as each test sets it; listeners kept so a test can change it live. */
const media = { reduce: false, listeners: new Set<(event: { matches: boolean }) => void>() };
function setReducedMotion(reduce: boolean) {
  media.reduce = reduce;
  for (const listener of media.listeners) listener({ matches: reduce });
}

/** IntersectionObserver stand-in: tests report entries for observed elements. */
const observed = new Map<Element, (entries: Partial<IntersectionObserverEntry>[]) => void>();
class FakeIntersectionObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    observed.set(target, (entries) => this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver));
  }
  unobserve(target: Element) { observed.delete(target); }
  disconnect() {}
  takeRecords() { return []; }
}
function reportIntersection(target: Element, isIntersecting: boolean) {
  const report = observed.get(target);
  expect(report, "the element is observed").toBeTruthy();
  act(() => report!([{ target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0, boundingClientRect: target.getBoundingClientRect() }]));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "performance", "Date"] });
  Object.defineProperty(Element.prototype, "animate", { value: fakeAnimate, configurable: true, writable: true });
  animations.clear();
  state.catalog = catalogWith();
  media.reduce = false;
  media.listeners.clear();
  observed.clear();
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes("reduce") ? media.reduce : false,
    media: query,
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => { if (query.includes("reduce")) media.listeners.add(listener); },
    removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => { media.listeners.delete(listener); },
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(Element.prototype, "animate");
  Reflect.deleteProperty(globalThis, "IntersectionObserver");
  Reflect.deleteProperty(window, "visualViewport");
  Reflect.deleteProperty(document, "visibilityState");
});

describe("hero carousel structure", () => {
  it("is a carousel region named by its heading, with slides named N of M and only the current one exposed", () => {
    show([carousel(["week", "season", "home"])]);
    expect(region().getAttribute("aria-roledescription")).toBe("carousel");
    expect(allSlides().map((slide) => [slide.getAttribute("aria-roledescription"), slide.getAttribute("aria-label")])).toEqual([
      ["slide", "1 of 3"], ["slide", "2 of 3"], ["slide", "3 of 3"],
    ]);
    expect(current()).toBe("1 of 3");
    expect(allSlides().map((slide) => [slide.hasAttribute("inert"), slide.getAttribute("aria-hidden")])).toEqual([
      [false, null], [true, "true"], [true, "true"],
    ]);
    const slide = within(region()).getByRole("group");
    expect(within(slide).getByRole("heading", { level: 2, name: "Fashion week" }).className).toContain("type-hero");
    expect(within(slide).getByText("Fashion week: new arrivals.")).toBeTruthy();
    expect(within(slide).getByRole("link", { name: "Shop Fashion week" }).getAttribute("href")).toBe("#/shop");
    // Slides share one grid cell, so the tallest sets the height and nothing moves between slides.
    expect(new Set(allSlides().map((item) => item.className.match(/\b(col|row)-start-1\b/g)?.join(" "))).size).toBe(1);
  });

  it("puts the rotation control first, then the dots and Previous/Next, each named; the current dot is marked", () => {
    show([carousel(["week", "season", "home"])]);
    const controls = within(region()).getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent);
    expect(controls).toEqual(["Pause slides", "Slide 1: Fashion week", "Slide 2: New season", "Slide 3: Home refresh", "Previous slide", "Next slide"]);
    expect(within(region()).getAllByRole("button").map((button) => button.getAttribute("aria-current"))).toEqual([null, "true", null, null, null, null]);
    // The first Tab stop inside the carousel is the rotation control.
    const focusable = region().querySelectorAll<HTMLElement>("a[href], button");
    expect(focusable[0]).toBe(rotation());
    expect(slidesBox().getAttribute("aria-live")).toBe("off");
  });

  it("renders edge to edge, outside the page container, wherever it is placed; later campaigns become bands", () => {
    show([
      { id: "picks", type: "products", title: "Staff picks", enabled: true, productIds: [poloShirt.id], categoryIds: [], campaignId: null },
      carousel(["week", "season"]),
      { id: "band", type: "campaign", title: "Band", enabled: true, productIds: [], categoryIds: [], campaignId: "home" },
    ]);
    expect(region().closest(".max-w-\\[1440px\\]")).toBeNull();
    expect(screen.getByRole("heading", { name: "Home refresh" }).className).toContain("type-h3");
  });

  it("is a still hero with one slide: no controls, timer, progress or zoom", () => {
    show([carousel(["week"])]);
    expect(region().hasAttribute("aria-roledescription")).toBe(false);
    expect(within(region()).queryAllByRole("button")).toEqual([]);
    expect(within(region()).getByRole("heading", { name: "Fashion week" })).toBeTruthy();
    advance(SLIDE_MS * 3);
    expect(progress()).toBe(0);
    expect([...region().querySelectorAll<HTMLElement>("[data-slide-zoom]")].map((layer) => layer.style.transform)).toEqual([""]);
  });

  it("keeps a call to action that needs the catalog in its place, unseen and unannounced, until the catalog confirms it", () => {
    state.catalog = catalogWith("loading");
    const targeted = [campaign("week", "Fashion week", { cta: { label: "Shop fashion", target: "category", targetId: "cat-fashion" } }), CAMPAIGNS[1]];
    const { rerender } = show([carousel(["week", "season"])], targeted);
    const slide = within(region()).getByRole("group");
    expect(within(slide).queryByRole("link")).toBeNull();
    const held = within(slide).getByText("Shop fashion");
    expect([held.getAttribute("aria-hidden"), held.className.includes("invisible")]).toEqual(["true", true]);
    state.catalog = catalogWith("ready");
    rerender(<StorefrontSections settings={settingsWith([carousel(["week", "season"])], targeted)} mediaById={mediaById} />);
    expect(within(within(region()).getByRole("group")).getByRole("link", { name: "Shop fashion" }).getAttribute("href")).toBe("#/shop?cat=fashion");
  });

  it("in the staff preview, names campaigns that don't exist; shoppers see only the ones that do, or nothing", () => {
    const { unmount } = show([carousel(["week", "retired"])], CAMPAIGNS, { showProblems: true });
    expect(screen.getByText("“Highlights” has unavailable references")).toBeTruthy();
    expect(screen.getByText("Campaign retired does not exist")).toBeTruthy();
    expect(within(region()).getByRole("heading", { name: "Fashion week" })).toBeTruthy();
    unmount();
    const { container } = show([carousel(["retired"])]);
    expect(container.textContent).toBe("");
  });
});

describe("hero carousel images", () => {
  const photos = () => [...region().querySelectorAll("img")].map((image) => image.getAttribute("src"));

  it("requests only the shown slide's photo at first, eagerly and first as the page's lead; the next a second after a slide shows", () => {
    show([carousel(["week", "season", "home"]), { id: "featured", type: "featured", title: "Featured products", enabled: true, productIds: [], categoryIds: [], campaignId: null }]);
    expect(photos()).toEqual(["https://media.example.test/week.jpg"]);
    const first = region().querySelector("img")!;
    expect([first.getAttribute("loading"), first.getAttribute("fetchpriority")]).toEqual(["eager", "high"]);
    expect(document.querySelectorAll('img[fetchpriority="high"]')).toHaveLength(1);
    advance(900);
    expect(photos()).toEqual(["https://media.example.test/week.jpg"]);
    advance(200);
    expect(photos()).toEqual(["https://media.example.test/week.jpg", "https://media.example.test/season.jpg"]);
    expect(document.querySelectorAll('img[fetchpriority="high"]')).toHaveLength(1);
    // Slide 2 shows at 6 s; a second later the third photo is requested.
    advance(SLIDE_MS - 1100 + 100);
    expect(current()).toBe("2 of 3");
    expect(photos()).toHaveLength(2);
    advance(1100);
    expect(photos()).toHaveLength(3);
  });

  it("keeps its first photo lazy when another section leads the page", () => {
    show([{ id: "picks", type: "products", title: "Staff picks", enabled: true, productIds: [poloShirt.id], categoryIds: [], campaignId: null }, carousel(["week", "season"])]);
    const first = region().querySelector("img")!;
    expect([first.getAttribute("loading"), first.hasAttribute("fetchpriority")]).toEqual(["lazy", false]);
  });

  it("crops each photo at its campaign's focal points, with the mobile crop below 768px", () => {
    show([carousel(["week", "season"])]);
    const image = region().querySelector<HTMLImageElement>("img")!;
    expect(image.style.getPropertyValue("--focal-desktop")).toBe("50% 50%");
    expect(image.style.getPropertyValue("--focal-mobile")).toBe("40% 30%");
    expect(image.className).toContain("object-cover");
  });
});

describe("hero carousel rotation", () => {
  it("advances every 6 seconds and wraps around; the dot, progress line and slow zoom follow one clock", () => {
    show([carousel(["week", "season", "home"])]);
    advance(3000);
    expect(progress()).toBeCloseTo(0.5, 1);
    expect(zoomOf(allSlides()[0])).toBeCloseTo(1.03, 2);
    // The browser animates the line and the zoom: nothing runs frame by frame from script, which kept a phone's main
    // thread busy (measured 97% of the time with the CPU 4x slower, against 1%).
    const frames = vi.spyOn(window, "requestAnimationFrame");
    advance(2900);
    expect(frames).not.toHaveBeenCalled();
    frames.mockRestore();
    expect(current()).toBe("1 of 3");
    advance(200);
    expect(current()).toBe("2 of 3");
    expect(within(region()).getByRole("button", { name: "Slide 2: New season" }).getAttribute("aria-current")).toBe("true");
    expect(progress()).toBeLessThan(0.1);
    advance(SLIDE_MS);
    expect(current()).toBe("3 of 3");
    advance(SLIDE_MS);
    expect(current()).toBe("1 of 3");
  });

  it("pauses while a mouse is over it, keeping the time elapsed; a finger resting on it doesn't pause it", () => {
    show([carousel(["week", "season", "home"])]);
    advance(4000);
    fireEvent.pointerEnter(region(), { pointerType: "mouse" });
    advance(SLIDE_MS * 2);
    expect(current()).toBe("1 of 3");
    expect(progress()).toBeCloseTo(4000 / SLIDE_MS, 1);
    expect(zoomOf(allSlides()[0])).toBeCloseTo(1.04, 2);
    fireEvent.pointerLeave(region(), { pointerType: "mouse" });
    // The line and the photo carry on from where they were, not from the start.
    advance(1000);
    expect(progress()).toBeCloseTo(5000 / SLIDE_MS, 1);
    expect(zoomOf(allSlides()[0])).toBeCloseTo(1.05, 2);
    advance(900);
    expect(current()).toBe("1 of 3");
    advance(200);
    expect(current()).toBe("2 of 3");
    fireEvent.pointerEnter(region(), { pointerType: "touch" });
    advance(SLIDE_MS);
    expect(current()).toBe("3 of 3");
  });

  it("pauses while any dialog is open and carries on where it was once it closes", () => {
    function WithDialog() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open cart</button>
          <StorefrontSections settings={settingsWith([carousel(["week", "season", "home"])])} mediaById={mediaById} />
          <ModalDialog open={open} label="Your cart" onClose={() => setOpen(false)}>
            <button type="button" onClick={() => setOpen(false)}>Close cart</button>
          </ModalDialog>
        </>
      );
    }
    render(<WithDialog />);
    advance(3000);
    fireEvent.click(screen.getByRole("button", { name: "Open cart" }));
    advance(SLIDE_MS * 2);
    expect(current()).toBe("1 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Close cart" }));
    advance(2900);
    expect(current()).toBe("1 of 3");
    advance(200);
    expect(current()).toBe("2 of 3");
  });

  it("pauses while the tab is hidden and while the carousel is off screen", () => {
    globalThis.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
    show([carousel(["week", "season", "home"])]);
    advance(2000);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    advance(SLIDE_MS * 2);
    expect(current()).toBe("1 of 3");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    advance(2000);
    reportIntersection(region(), false);
    advance(SLIDE_MS * 2);
    expect(current()).toBe("1 of 3");
    reportIntersection(region(), true);
    advance(1900);
    expect(current()).toBe("1 of 3");
    advance(200);
    expect(current()).toBe("2 of 3");
  });

  it("stops for good on Next, Previous or a dot, showing no progress, until Play slides", () => {
    show([carousel(["week", "season", "home"])]);
    advance(3000);
    fireEvent.click(within(region()).getByRole("button", { name: "Next slide" }));
    expect(current()).toBe("2 of 3");
    expect(rotation().getAttribute("aria-label")).toBe("Play slides");
    expect(slidesBox().getAttribute("aria-live")).toBe("polite");
    expect(progress()).toBe(0);
    advance(SLIDE_MS * 3);
    expect(current()).toBe("2 of 3");
    fireEvent.click(within(region()).getByRole("button", { name: "Previous slide" }));
    fireEvent.click(within(region()).getByRole("button", { name: "Previous slide" }));
    expect(current()).toBe("3 of 3");
    fireEvent.click(within(region()).getByRole("button", { name: "Slide 2: New season" }));
    expect(current()).toBe("2 of 3");
    advance(SLIDE_MS * 2);
    expect(current()).toBe("2 of 3");

    fireEvent.click(rotation());
    expect(rotation().getAttribute("aria-label")).toBe("Pause slides");
    expect(slidesBox().getAttribute("aria-live")).toBe("off");
    advance(SLIDE_MS + 100);
    expect(current()).toBe("3 of 3");
    advance(2900);
    expect(progress()).toBeCloseTo(0.5, 1);
    fireEvent.click(rotation());
    expect(rotation().getAttribute("aria-label")).toBe("Play slides");
    expect(progress()).toBe(0);
    advance(SLIDE_MS * 2);
    expect(current()).toBe("3 of 3");
  });

  it("shows no progress once Pause is pressed, also while the mouse had already paused it part way", () => {
    show([carousel(["week", "season", "home"])]);
    advance(3000);
    fireEvent.pointerEnter(region(), { pointerType: "mouse" });
    expect(progress()).toBeCloseTo(0.5, 1);
    fireEvent.click(rotation());
    expect(rotation().getAttribute("aria-label")).toBe("Play slides");
    expect(progress()).toBe(0);
  });

  it("carries the photo's zoom on from where Pause froze it, and a slide shown again starts unzoomed", () => {
    show([carousel(["week", "season", "home"])]);
    const first = allSlides()[0];
    advance(3000);
    expect(zoomOf(first)).toBeCloseTo(1.03, 2);
    fireEvent.click(rotation());
    advance(SLIDE_MS);
    expect(zoomOf(first)).toBeCloseTo(1.03, 2);
    // Play gives the slide a whole 6 s again, zooming on from 1.03 towards 1.06 rather than jumping back to 1.
    fireEvent.click(rotation());
    advance(100);
    expect(zoomOf(first)).toBeGreaterThanOrEqual(1.03);
    advance(2900);
    expect(zoomOf(first)).toBeCloseTo(1.045, 2);
    fireEvent.click(within(region()).getByRole("button", { name: "Next slide" }));
    fireEvent.click(within(region()).getByRole("button", { name: "Previous slide" }));
    expect(current()).toBe("1 of 3");
    expect(zoomOf(first)).toBe(1);
  });

  it("stops when the slide is tapped or clicked anywhere but its call to action", () => {
    show([carousel(["week", "season", "home"])]);
    fireEvent.click(within(within(region()).getByRole("group")).getByRole("link", { name: "Shop Fashion week" }));
    expect(rotation().getAttribute("aria-label")).toBe("Pause slides");
    fireEvent.click(within(within(region()).getByRole("group")).getByText("Fashion week: new arrivals."));
    expect(rotation().getAttribute("aria-label")).toBe("Play slides");
    advance(SLIDE_MS * 2);
    expect(current()).toBe("1 of 3");
  });

  it("stops when keyboard focus enters it; focus moving within doesn't stop it again after Play", () => {
    /** Moves focus as Tab does: the key goes down first, so the browser shows keyboard focus (`:focus-visible`). */
    const tabTo = (element: HTMLElement) => act(() => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab" });
      element.focus();
    });
    show([carousel(["week", "season", "home"])]);
    tabTo(rotation());
    expect(rotation().getAttribute("aria-label")).toBe("Play slides");
    fireEvent.keyDown(rotation(), { key: "Enter" });
    fireEvent.click(rotation());
    tabTo(within(region()).getByRole("button", { name: "Next slide" }));
    expect(rotation().getAttribute("aria-label")).toBe("Pause slides");
    advance(SLIDE_MS + 100);
    expect(current()).toBe("2 of 3");
    // Leaving and coming back by keyboard stops it again.
    const outside = document.createElement("button");
    document.body.append(outside);
    tabTo(outside);
    tabTo(rotation());
    expect(rotation().getAttribute("aria-label")).toBe("Play slides");
    outside.remove();
  });

  it("Play slides starts at once with the mouse still over it; hovering pauses again only after the pointer leaves and returns", () => {
    show([carousel(["week", "season", "home"])]);
    fireEvent.pointerEnter(region(), { pointerType: "mouse" });
    fireEvent.click(within(region()).getByRole("button", { name: "Next slide" }));
    fireEvent.click(rotation());
    advance(SLIDE_MS + 100);
    expect(current()).toBe("3 of 3");
    fireEvent.pointerLeave(region(), { pointerType: "mouse" });
    fireEvent.pointerEnter(region(), { pointerType: "mouse" });
    advance(SLIDE_MS * 2);
    expect(current()).toBe("3 of 3");
  });
});

describe("hero carousel swipes", () => {
  const area = () => slidesBox();
  function swipe(target: HTMLElement, from: [number, number], to: [number, number], { pointerType = "touch", pointerId = 1 } = {}) {
    fireEvent.pointerDown(target, { pointerId, pointerType, isPrimary: true, clientX: from[0], clientY: from[1], button: 0 });
    fireEvent.pointerMove(target, { pointerId, pointerType, isPrimary: true, clientX: (from[0] + to[0]) / 2, clientY: (from[1] + to[1]) / 2 });
    fireEvent.pointerMove(target, { pointerId, pointerType, isPrimary: true, clientX: to[0], clientY: to[1] });
    fireEvent.pointerUp(target, { pointerId, pointerType, isPrimary: true, clientX: to[0], clientY: to[1], button: 0 });
  }

  it("lets the page scroll vertically and pinch-zoom, and changes slides on a horizontal swipe, which stops rotation", () => {
    show([carousel(["week", "season", "home"])]);
    expect(area().className).toContain("touch-pan-y");
    expect(area().className).toContain("pinch-zoom");
    swipe(area(), [300, 200], [240, 205]);
    expect(current()).toBe("2 of 3");
    expect(rotation().getAttribute("aria-label")).toBe("Play slides");
    swipe(area(), [100, 200], [170, 190]);
    expect(current()).toBe("1 of 3");
    swipe(area(), [100, 200], [50, 200]);
    expect(current()).toBe("2 of 3");
  });

  it("ignores vertical, short, mouse, cancelled and two-finger gestures", () => {
    show([carousel(["week", "season", "home"])]);
    swipe(area(), [300, 200], [270, 300]);
    swipe(area(), [300, 200], [270, 202]);
    swipe(area(), [300, 200], [100, 200], { pointerType: "mouse" });
    fireEvent.pointerDown(area(), { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 300, clientY: 200 });
    fireEvent.pointerMove(area(), { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 200, clientY: 200 });
    fireEvent.pointerCancel(area(), { pointerId: 1, pointerType: "touch", isPrimary: true });
    fireEvent.pointerUp(area(), { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 200, clientY: 200 });
    fireEvent.pointerDown(area(), { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 300, clientY: 200 });
    fireEvent.pointerDown(area(), { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 200, clientY: 260 });
    fireEvent.pointerMove(area(), { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 150, clientY: 200 });
    fireEvent.pointerUp(area(), { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 200, clientY: 260 });
    fireEvent.pointerUp(area(), { pointerId: 1, pointerType: "touch", isPrimary: true, clientX: 150, clientY: 200 });
    // A pinch whose second finger moves sideways and lifts first is no swipe either.
    fireEvent.pointerDown(area(), { pointerId: 3, pointerType: "touch", isPrimary: true, clientX: 300, clientY: 200 });
    fireEvent.pointerDown(area(), { pointerId: 4, pointerType: "touch", isPrimary: false, clientX: 250, clientY: 220 });
    fireEvent.pointerUp(area(), { pointerId: 4, pointerType: "touch", isPrimary: false, clientX: 100, clientY: 220 });
    fireEvent.pointerUp(area(), { pointerId: 3, pointerType: "touch", isPrimary: true, clientX: 300, clientY: 200 });
    expect(current()).toBe("1 of 3");
    expect(rotation().getAttribute("aria-label")).toBe("Pause slides");
  });

  it("swallows the click that ends a swipe that changed the slide, so the call to action is not followed", () => {
    window.location.hash = "#/";
    show([carousel(["week", "season", "home"])]);
    const link = within(within(region()).getByRole("group")).getByRole("link", { name: "Shop Fashion week" });
    swipe(link, [300, 200], [200, 200]);
    expect(current()).toBe("2 of 3");
    fireEvent.click(link);
    expect(window.location.hash).toBe("#/");
    // Only that one click: the next one is followed.
    fireEvent.click(within(within(region()).getByRole("group")).getByRole("link", { name: "Shop New season" }));
    expect(window.location.hash).toBe("#/shop");
  });

  it("ignores swipes while the page is pinch-zoomed, so panning the page never changes slides", () => {
    Object.defineProperty(window, "visualViewport", {
      configurable: true, value: { scale: 2, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    });
    show([carousel(["week", "season", "home"])]);
    swipe(area(), [300, 200], [150, 200]);
    expect(current()).toBe("1 of 3");
    expect(area().className).not.toContain("touch-pan-y");
  });
});

describe("hero carousel under reduced motion", () => {
  it("starts stopped with no slow zoom; Play still rotates, still without zooming", () => {
    media.reduce = true;
    show([carousel(["week", "season", "home"])]);
    expect(rotation().getAttribute("aria-label")).toBe("Play slides");
    expect(slidesBox().getAttribute("aria-live")).toBe("polite");
    advance(SLIDE_MS * 3);
    expect(current()).toBe("1 of 3");
    fireEvent.click(rotation());
    advance(3000);
    expect(zoomOf(allSlides()[0])).toBe(1);
    advance(3100);
    expect(current()).toBe("2 of 3");
    expect(allSlides().map(zoomOf)).toEqual([1, 1, 1]);
  });

  it("stops when the shopper turns on reduced motion while it rotates", () => {
    show([carousel(["week", "season", "home"])]);
    advance(2000);
    act(() => setReducedMotion(true));
    expect(rotation().getAttribute("aria-label")).toBe("Play slides");
    advance(SLIDE_MS * 2);
    expect(current()).toBe("1 of 3");
  });
});
