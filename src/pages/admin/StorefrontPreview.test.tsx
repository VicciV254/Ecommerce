import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaAsset, StorefrontSettings } from "../../api/catalog";
import { campaignMedia, fixtureStorefrontSettings } from "../../test-support/catalogFixtures";
import { StorefrontPreview } from "./StorefrontPreview";
import { PREVIEW_MESSAGES } from "./storefrontPreviewModel";

const draft = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("./StorefrontDraft", () => ({ useStorefrontDraft: () => draft.value }));

const ORIGIN = window.location.origin;
const settings = fixtureStorefrontSettings();

function useDraft(current: StorefrontSettings, media: MediaAsset[] = campaignMedia) {
  draft.value = { load: { status: "ready" }, settings: current, dirty: false, media, unresolved: [], reloadDraft: vi.fn() };
}

function Preview() {
  const heading = useRef<HTMLHeadingElement>(null);
  return <StorefrontPreview heading={heading} />;
}

const frame = () => screen.getByTitle(/^Storefront draft at/) as HTMLIFrameElement;
const widthButton = (name: string) => within(screen.getByRole("group", { name: "Preview width" })).getByRole("button", { name });
const pressed = () => within(screen.getByRole("group", { name: "Preview width" })).getAllByRole("button")
  .filter((button) => button.getAttribute("aria-pressed") === "true").map((button) => button.textContent);

function report(data: unknown, { source = frame().contentWindow, origin = ORIGIN }: { source?: unknown; origin?: string } = {}) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin, source: source as Window }));
  });
}
const ready = { type: PREVIEW_MESSAGES.ready };
const height = (value: unknown) => ({ type: PREVIEW_MESSAGES.height, height: value });

beforeEach(() => {
  window.history.replaceState(null, "", "#/admin/storefront/preview");
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  useDraft(settings);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("draft preview widths", () => {
  it("offers three widths under the banner and before the frame, starting at phone width", () => {
    render(<Preview />);
    expect(screen.getByRole("heading", { level: 1, name: "Draft preview: shoppers can't see this" })).toBeTruthy();
    expect(screen.getByText("Links don't open from the preview; buying and wishlists are off.")).toBeTruthy();
    const group = screen.getByRole("group", { name: "Preview width" });
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual(["Phone 390 px", "Tablet 768 px", "Desktop 1280 px"]);
    expect(widthButton("Phone 390 px").getAttribute("aria-label")).toBeNull();
    expect(pressed()).toEqual(["Phone 390 px"]);

    const element = frame();
    expect(element.title).toBe("Storefront draft at phone width (390 px)");
    expect(element.style.width).toBe("390px");
    expect(element.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
    expect(element.src).toBe(`${ORIGIN}/#/admin/storefront/preview-frame`);
    expect(group.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to editor" }).compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("changes width in place: the address is replaced and the same frame takes the new width", () => {
    render(<Preview />);
    const element = frame();
    const entries = window.history.length;
    fireEvent.click(widthButton("Tablet 768 px"));
    expect(window.location.hash).toBe("#/admin/storefront/preview?device=tablet");
    expect(window.history.length).toBe(entries);
    expect(pressed()).toEqual(["Tablet 768 px"]);
    expect(frame()).toBe(element);
    expect(element.style.width).toBe("768px");
    expect(element.title).toBe("Storefront draft at tablet width (768 px)");

    fireEvent.click(widthButton("Desktop 1280 px"));
    expect(window.location.hash).toBe("#/admin/storefront/preview?device=desktop");
    expect(element.style.width).toBe("1280px");
    fireEvent.click(widthButton("Phone 390 px"));
    expect(window.location.hash).toBe("#/admin/storefront/preview");
    expect(window.history.length).toBe(entries);
    expect(element.style.width).toBe("390px");
  });

  it("reads the width from the address, and corrects an unknown one in place to phone width", () => {
    window.history.replaceState(null, "", "#/admin/storefront/preview?device=desktop");
    const { unmount } = render(<Preview />);
    expect(pressed()).toEqual(["Desktop 1280 px"]);
    expect(frame().style.width).toBe("1280px");
    unmount();

    window.history.replaceState(null, "", "#/admin/storefront/preview?device=watch");
    const entries = window.history.length;
    render(<Preview />);
    expect(window.location.hash).toBe("#/admin/storefront/preview");
    expect(window.history.length).toBe(entries);
    expect(pressed()).toEqual(["Phone 390 px"]);
  });
});

describe("talking to the frame", () => {
  it("posts the draft to its own frame at its own origin once it is ready, again on each change and each new ready", () => {
    const { rerender } = render(<Preview />);
    const sent = vi.spyOn(frame().contentWindow!, "postMessage");
    expect(screen.getByRole("status").textContent).toBe("Loading the preview…");
    expect(sent).not.toHaveBeenCalled();

    report(ready);
    expect(screen.queryByRole("status")).toBeNull();
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenLastCalledWith({ type: PREVIEW_MESSAGES.draft, settings, media: campaignMedia }, ORIGIN);

    const edited = fixtureStorefrontSettings({ brand: { ...settings.brand, name: "Apex Cart Draft" } });
    useDraft(edited);
    rerender(<Preview />);
    expect(sent).toHaveBeenCalledTimes(2);
    expect(sent).toHaveBeenLastCalledWith({ type: PREVIEW_MESSAGES.draft, settings: edited, media: campaignMedia }, ORIGIN);

    useDraft(edited, [campaignMedia[0]]);
    rerender(<Preview />);
    expect(sent).toHaveBeenCalledTimes(3);
    expect(sent).toHaveBeenLastCalledWith({ type: PREVIEW_MESSAGES.draft, settings: edited, media: [campaignMedia[0]] }, ORIGIN);

    // A frame the browser reloaded reports ready again and gets the draft again.
    report(ready);
    expect(sent).toHaveBeenCalledTimes(4);
  });

  it("ignores reports from another window, even at its own origin", () => {
    render(<Preview />);
    const sent = vi.spyOn(frame().contentWindow!, "postMessage");
    report(ready, { source: window });
    report(height(900), { source: window });
    expect(sent).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("Loading the preview…");
    expect(frame().style.height).toBe("0px");
  });

  it("ignores reports from its frame's window at another origin", () => {
    render(<Preview />);
    const sent = vi.spyOn(frame().contentWindow!, "postMessage");
    report(ready, { origin: "http://evil.example.test" });
    report(height(900), { origin: "http://evil.example.test" });
    expect(sent).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("Loading the preview…");
    expect(frame().style.height).toBe("0px");
  });

  it("follows the height its frame reports, rounded up and capped at 20,000 px, and ignores a malformed one", () => {
    render(<Preview />);
    report(ready);
    report(height(1234.4));
    expect(frame().style.height).toBe("1235px");
    report(height(860));
    expect(frame().style.height).toBe("860px");
    report(height(25_000));
    expect(frame().style.height).toBe("20000px");
    report(height("tall"));
    report(height(-5));
    expect(frame().style.height).toBe("20000px");
  });
});

describe("loading and failure", () => {
  it("offers a reload when the frame isn't ready after 15 seconds, and the reload mounts a new frame", () => {
    vi.useFakeTimers();
    render(<Preview />);
    const first = frame();
    act(() => { vi.advanceTimersByTime(14_999); });
    expect(screen.getByRole("status").textContent).toBe("Loading the preview…");
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole("alert").textContent).toContain("The preview didn't load.");
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reload the preview" }));
    const second = frame();
    expect(second).not.toBe(first);
    expect(screen.getByRole("status").textContent).toBe("Loading the preview…");
    expect(screen.queryByRole("alert")).toBeNull();

    // The new frame has its own 15 seconds, and only it can end the wait.
    act(() => { vi.advanceTimersByTime(10_000); });
    report(ready, { source: first.contentWindow });
    expect(screen.getByRole("status").textContent).toBe("Loading the preview…");
    const sent = vi.spyOn(second.contentWindow!, "postMessage");
    report(ready, { source: second.contentWindow });
    expect(screen.queryByRole("status")).toBeNull();
    expect(sent).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a frame that reports ready late", () => {
    vi.useFakeTimers();
    render(<Preview />);
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(screen.getByRole("alert")).toBeTruthy();
    const sent = vi.spyOn(frame().contentWindow!, "postMessage");
    report(ready);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it("offers the reload again when the reloaded frame doesn't load either, after its own 15 seconds", () => {
    vi.useFakeTimers();
    render(<Preview />);
    act(() => { vi.advanceTimersByTime(15_000); });
    fireEvent.click(screen.getByRole("button", { name: "Reload the preview" }));
    act(() => { vi.advanceTimersByTime(14_999); });
    expect(screen.getByRole("status").textContent).toBe("Loading the preview…");
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole("alert").textContent).toContain("The preview didn't load.");
    expect(screen.getByRole("button", { name: "Reload the preview" })).toBeTruthy();
  });
});

describe("scaling", () => {
  it("scales a frame wider than the space for display only, and states the percentage", () => {
    const observers: ResizeObserverCallback[] = [];
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { observers.push(callback); }
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    window.history.replaceState(null, "", "#/admin/storefront/preview?device=tablet");
    render(<Preview />);
    act(() => { for (const callback of observers) callback([{ contentRect: { width: 390 } } as ResizeObserverEntry], {} as ResizeObserver); });
    report(ready);
    report(height(1000));

    expect(screen.getByText("Shown at 50% of actual size")).toBeTruthy();
    const element = frame();
    expect(element.style.width).toBe("768px");
    expect(element.style.transform).toBe("scale(0.5)");
    expect(element.parentElement?.style.width).toBe("384px");
    expect(element.parentElement?.style.height).toBe("500px");

    fireEvent.click(widthButton("Desktop 1280 px"));
    expect(screen.getByText("Shown at 30% of actual size")).toBeTruthy();
    expect(element.style.transform).toBe("scale(0.3)");

    fireEvent.click(widthButton("Phone 390 px"));
    expect(screen.queryByText(/^Shown at/)).toBeNull();
    expect(element.style.transform).toBe("");
    expect(element.parentElement?.style.width).toBe("390px");
  });
});
