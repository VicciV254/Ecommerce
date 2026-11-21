import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishedStorefront, StorefrontSettings } from "../api/catalog";
import { STORE_FACTS } from "../store/storeFacts";
import { campaignMedia, fixtureStorefront, fixtureStorefrontSettings } from "../test-support/catalogFixtures";
import { STORAGE_KEYS } from "../utils/storage";
import { ModalDialog } from "./Modal";
import { usePageReady } from "./pageReady";
import { WelcomeDialog } from "./WelcomeDialog";

/*
 * The arrival popup: once per browser, on browsing pages only, about 2 s after the page's own content is ready, never
 * over another dialog. Focus starts on its heading; the newsletter form is the footer's; nothing subscribes unless the
 * shopper presses Subscribe.
 */
const state = vi.hoisted(() => ({
  mode: "demo" as "demo" | "live" | null,
  storefront: null as PublishedStorefront | null,
  subscribe: vi.fn(),
}));
vi.mock("../store/CatalogContext", () => ({ useCatalog: () => ({ mode: state.mode, status: state.mode ? "ready" : "loading" }) }));
vi.mock("../store/StorefrontContext", () => ({
  useStorefront: () => ({
    brandName: "Apex Cart", storefront: state.storefront, status: state.storefront ? "ready" : "loading",
    mediaById: new Map(campaignMedia.map((asset) => [asset.id, asset])),
  }),
}));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: null, refreshUser: vi.fn() }) }));
vi.mock("../api/subscriptions", () => ({ subscriptionsAPI: { subscribe: state.subscribe } }));

const OPEN_AFTER_MS = 2000;
type Section = StorefrontSettings["sections"][number];
const carousel: Section = {
  id: "hero-carousel", type: "carousel", title: "Highlights", enabled: true, productIds: [], categoryIds: [], campaignId: null, campaignIds: ["week"],
};
const week = {
  id: "week", title: "Fashion week", body: "", conditions: "", cta: { label: "Shop now", target: "shop" as const, targetId: null },
  desktopMediaId: "media-campaign-desktop", mobileMediaId: null, desktopFocal: { x: 50, y: 50 }, mobileFocal: { x: 50, y: 50 }, layout: "overlay" as const,
};

/** A page that reports its own content ready when told. */
function Page({ ready }: { ready: boolean }) {
  usePageReady(ready);
  return <button type="button">On the page</button>;
}
const dialog = () => screen.queryByRole("dialog", { name: "Welcome to Apex Cart" });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
function go(route: string) {
  act(() => {
    window.history.pushState(null, "", `#${route}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}
const wide = (matches: boolean) => {
  window.matchMedia = vi.fn((query: string) => ({ matches: query.includes("min-width") ? matches : false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  window.history.replaceState(null, "", "#/");
  // The shared test setup marks the welcome as seen; these tests start as a first visit.
  localStorage.removeItem(STORAGE_KEYS.welcomeShown);
  state.mode = "demo";
  state.storefront = fixtureStorefront();
  state.subscribe.mockReset();
  wide(false);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("welcome dialog timing", () => {
  it("opens 2 seconds after the page's own content is ready, with focus on its heading, and marks itself shown", () => {
    const { rerender } = render(<><WelcomeDialog /><Page ready={false} /></>);
    advance(OPEN_AFTER_MS * 3);
    expect(dialog()).toBeNull();
    rerender(<><WelcomeDialog /><Page ready /></>);
    advance(OPEN_AFTER_MS - 100);
    expect(dialog()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.welcomeShown)).toBeNull();
    advance(200);
    expect(dialog()).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog()!).getByRole("heading", { level: 2, name: "Welcome to Apex Cart" }));
    expect(localStorage.getItem(STORAGE_KEYS.welcomeShown)).not.toBeNull();
  });

  it("is shown once per browser", () => {
    localStorage.setItem(STORAGE_KEYS.welcomeShown, "true");
    render(<><WelcomeDialog /><Page ready /></>);
    advance(OPEN_AFTER_MS * 5);
    expect(dialog()).toBeNull();
  });

  it.each([
    ["can't be stored", () => vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); })],
    ["can't be read", () => vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SecurityError"); })],
  ])("is never shown when its mark %s", (_case, breakStorage) => {
    breakStorage();
    render(<><WelcomeDialog /><Page ready /></>);
    advance(OPEN_AFTER_MS * 5);
    expect(dialog()).toBeNull();
  });

  it.each(["/", "/shop?cat=fashion", "/departments", "/product/prod-polo-shirt", "/about", "/contact", "/delivery", "/returns", "/faq"])(
    "opens on the browsing page %s", (route) => {
      window.history.replaceState(null, "", `#${route}`);
      render(<><WelcomeDialog /><Page ready /></>);
      advance(OPEN_AFTER_MS + 100);
      expect(dialog()).toBeTruthy();
    },
  );

  it.each([
    "/cart", "/checkout", "/account", "/account/orders", "/login", "/register", "/verify-email?token=x", "/unsubscribe?token=x",
    "/track", "/privacy", "/terms", "/wishlist", "/no-such-page", "/admin",
  ])("never opens on %s", (route) => {
    window.history.replaceState(null, "", `#${route}`);
    render(<><WelcomeDialog /><Page ready /></>);
    advance(OPEN_AFTER_MS * 5);
    expect(dialog()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.welcomeShown)).toBeNull();
  });

  it("doesn't open once the shopper has moved on to an excluded page", () => {
    render(<><WelcomeDialog /><Page ready /></>);
    advance(1000);
    go("/cart");
    advance(OPEN_AFTER_MS * 5);
    expect(dialog()).toBeNull();
  });

  it("waits while another dialog is open and opens 2 seconds after it closes", () => {
    function WithCart() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <WelcomeDialog />
          <Page ready />
          <ModalDialog open={open} label="Your cart" onClose={() => setOpen(false)}>
            <button type="button" onClick={() => setOpen(false)}>Close cart</button>
          </ModalDialog>
        </>
      );
    }
    render(<WithCart />);
    advance(OPEN_AFTER_MS * 5);
    expect(dialog()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close cart" }));
    advance(OPEN_AFTER_MS - 100);
    expect(dialog()).toBeNull();
    advance(200);
    expect(dialog()).toBeTruthy();
  });
});

describe("welcome dialog content and closing", () => {
  function openIt() {
    render(<><WelcomeDialog /><Page ready /></>);
    advance(OPEN_AFTER_MS + 100);
    return dialog()!;
  }

  it("welcomes, says what to do here and, for a demonstration catalog, that nothing is sold or delivered", () => {
    const welcome = openIt();
    expect(within(welcome).getByText(/^Browse the departments/)).toBeTruthy();
    expect(within(welcome).getByText(STORE_FACTS.demonstration)).toBeTruthy();
    expect(within(welcome).getByRole("link", { name: "Privacy notice" }).getAttribute("href")).toBe("#/privacy");
    expect(within(welcome).getByLabelText("Email address")).toBeTruthy();
    expect(within(welcome).getByRole("button", { name: "Subscribe" }).className).toContain("motion-safe:active:scale-[0.97]");
    expect(document.activeElement).not.toBe(within(welcome).getByLabelText("Email address"));
  });

  it("leaves the demonstration note out for a live catalog", () => {
    state.mode = "live";
    const welcome = openIt();
    expect(within(welcome).queryByText(STORE_FACTS.demonstration)).toBeNull();
  });

  it.each([
    ["Start browsing", (welcome: HTMLElement) => fireEvent.click(within(welcome).getByRole("button", { name: "Start browsing" }))],
    ["the close button", (welcome: HTMLElement) => fireEvent.click(within(welcome).getByRole("button", { name: "Close" }))],
    ["Escape", (welcome: HTMLElement) => fireEvent(welcome, new Event("cancel", { cancelable: true }))],
    ["the backdrop", (welcome: HTMLElement) => { fireEvent.pointerDown(welcome); fireEvent.click(welcome); }],
  ])("closes with %s and subscribes no one", (_case, close) => {
    const welcome = openIt();
    expect(within(welcome).getByRole("button", { name: "Close" }).className).toMatch(/size-\[44px\]/);
    close(welcome);
    expect(dialog()).toBeNull();
    expect(state.subscribe).not.toHaveBeenCalled();
    advance(OPEN_AFTER_MS * 5);
    expect(dialog()).toBeNull();
  });

  it("subscribes only from its Subscribe button, then thanks the shopper in place, with focus on the thanks", async () => {
    state.subscribe.mockResolvedValue({ data: { message: "Subscribed" } });
    const welcome = openIt();
    const field = within(welcome).getByLabelText("Email address");
    act(() => field.focus());
    fireEvent.change(field, { target: { value: "amina@example.test" } });
    await act(async () => { fireEvent.submit(within(welcome).getByRole("button", { name: "Subscribe" })); });
    expect(state.subscribe).toHaveBeenCalledWith({ email: "amina@example.test" });
    const thanks = within(welcome).getByText("Thank you for subscribing. Every email has a link to unsubscribe.");
    expect(document.activeElement).toBe(thanks);
  });

  it("closes when its Privacy link leads to an excluded page, leaving focus to that page rather than returning it", () => {
    render(<><WelcomeDialog /><Page ready /></>);
    const outside = screen.getByRole("button", { name: "On the page" });
    act(() => outside.focus());
    advance(OPEN_AFTER_MS + 100);
    fireEvent.click(within(dialog()!).getByRole("link", { name: "Privacy notice" }));
    act(() => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(window.location.hash).toBe("#/privacy");
    expect(dialog()).toBeNull();
    expect(document.activeElement).not.toBe(outside);
  });
});

describe("welcome dialog photo", () => {
  it("shows the hero's first slide photo from 768px, decided when it opens and decorative", () => {
    wide(true);
    state.storefront = fixtureStorefront({ settings: fixtureStorefrontSettings({ sections: [carousel], campaigns: [week] }) });
    render(<><WelcomeDialog /><Page ready /></>);
    advance(OPEN_AFTER_MS + 100);
    const photo = dialog()!.querySelector("img")!;
    expect(photo.getAttribute("alt")).toBe("");
    expect(photo.getAttribute("src")).toBe(campaignMedia[0].url);
  });

  it("has no photo at all on phones, so none is downloaded", () => {
    wide(false);
    state.storefront = fixtureStorefront({ settings: fixtureStorefrontSettings({ sections: [carousel], campaigns: [week] }) });
    render(<><WelcomeDialog /><Page ready /></>);
    advance(OPEN_AFTER_MS + 100);
    expect(dialog()!.querySelector("img")).toBeNull();
  });
});
