import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogProduct } from "../../api/catalog";
import { buildCategoryTree } from "../../store/catalogModel";
import type { CatalogValue } from "../../store/CatalogContext";
import { fixtureCategories, fixtureImage, fixtureReturnPolicy, fixtureStorefrontSettings, linenShirt, poloShirt } from "../../test-support/catalogFixtures";
import { StorefrontPreviewFrame } from "./StorefrontPreviewFrame";
import { PREVIEW_MESSAGES } from "./storefrontPreviewModel";

const state = vi.hoisted(() => ({ catalog: null as CatalogValue | null }));
vi.mock("../../store/CatalogContext", () => ({ useCatalog: () => state.catalog }));
vi.mock("../../store/StoreContext", () => ({ useStore: () => ({ state: { wishlist: [], cart: [] }, addToCart: vi.fn(), toggleWish: vi.fn() }) }));
vi.mock("../../store/StorefrontContext", () => ({ useStorefront: () => ({ brandName: "Apex Cart" }), usePageTitle: vi.fn() }));

function catalogWith(products: CatalogProduct[]): CatalogValue {
  return {
    status: "ready", error: null, mode: "live", products,
    productsById: new Map(products.map((product) => [product.id, product])),
    categories: buildCategoryTree(fixtureCategories), designers: [], discounts: [], returnPolicy: fixtureReturnPolicy, reload: vi.fn(),
  };
}

const ORIGIN = window.location.origin;
/** Unpublished artwork that only the draft's own media list resolves. */
const standalone = fixtureImage({ id: "media-standalone", url: "https://media.example.test/standalone-hero.jpg", alt: "" });
const baseTheme = fixtureStorefrontSettings().theme;
const draftSettings = fixtureStorefrontSettings({
  brand: { name: "Apex Cart Draft", tagline: "", logoMediaId: null, faviconMediaId: null },
  theme: { fontId: "lora", colors: { ...baseTheme.colors, primary: "#123456" } },
  sections: [
    { id: "hero", type: "campaign", title: "Hero", enabled: true, productIds: [], categoryIds: [], campaignId: "launch" },
    { id: "departments", type: "departments", title: "Shop by department", enabled: true, productIds: [], categoryIds: [], campaignId: null },
    { id: "featured", type: "featured", title: "Featured products", enabled: true, productIds: [], categoryIds: [], campaignId: null },
  ],
  campaigns: [{
    id: "launch", title: "Launch week", body: "", conditions: "", cta: { label: "Shop now", target: "shop", targetId: null },
    desktopMediaId: standalone.id, mobileMediaId: null, desktopFocal: { x: 50, y: 50 }, mobileFocal: { x: 20, y: 80 }, layout: "overlay",
  }],
});
const draftMessage = { type: PREVIEW_MESSAGES.draft, settings: draftSettings, media: [standalone] };
const renamed = (name: string) => ({ ...draftSettings, brand: { ...draftSettings.brand, name } });

type FakeWindow = { postMessage: ReturnType<typeof vi.fn> };
let parent: FakeWindow;
const otherWindow: FakeWindow = { postMessage: vi.fn() };

/** Renders the frame as the draft preview's frame: inside a parent window. */
function renderFramed() {
  vi.spyOn(window, "parent", "get").mockReturnValue(parent as unknown as Window);
  return render(<StorefrontPreviewFrame />);
}

function receive(data: unknown, { source = parent, origin = ORIGIN }: { source?: FakeWindow; origin?: string } = {}) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin, source: source as unknown as Window }));
  });
}

beforeEach(() => {
  window.history.replaceState(null, "", "#/admin/storefront/preview-frame");
  parent = { postMessage: vi.fn() };
  state.catalog = catalogWith([linenShirt, poloShirt]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.getElementById("apex-cart-preview-font-link")?.remove();
});

describe("the draft preview's frame", () => {
  it("opened outside a frame, says what it is and links to the draft preview", () => {
    render(<StorefrontPreviewFrame />);
    expect(screen.getByRole("heading", { level: 1, name: "Draft preview frame" })).toBeTruthy();
    expect(screen.getByText("This address shows the storefront draft inside the draft preview. On its own, it has nothing to show.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the draft preview" }).getAttribute("href")).toBe("#/admin/storefront/preview");
  });

  it("tells its parent alone that it is ready, then shows only the draft its parent posts", () => {
    renderFramed();
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    expect(parent.postMessage).toHaveBeenCalledWith({ type: PREVIEW_MESSAGES.ready }, ORIGIN);
    expect(screen.queryByRole("heading")).toBeNull();

    receive(draftMessage);
    expect(screen.getByText("Apex Cart Draft")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Launch week" })).toBeTruthy();
    // Unpublished artwork resolves through the posted media, at the campaign's own focal points.
    const image = screen.getByRole("region", { name: "Launch week" }).querySelector<HTMLImageElement>("picture img")!;
    expect(image.getAttribute("src")).toBe(standalone.url);
    expect(image.style.getPropertyValue("--focal-mobile")).toBe("20% 80%");
    expect(screen.queryByText(/is unavailable/)).toBeNull();

    receive({ ...draftMessage, settings: renamed("Apex Cart Second") });
    expect(screen.getByText("Apex Cart Second")).toBeTruthy();
  });

  it("ignores a draft from another window, even at its own origin", () => {
    renderFramed();
    receive(draftMessage, { source: otherWindow });
    expect(screen.queryByText("Apex Cart Draft")).toBeNull();
    receive(draftMessage);
    expect(screen.getByText("Apex Cart Draft")).toBeTruthy();
  });

  it("ignores a draft from its parent window at another origin", () => {
    renderFramed();
    receive(draftMessage, { origin: "http://evil.example.test" });
    expect(screen.queryByText("Apex Cart Draft")).toBeNull();
    receive(draftMessage);
    expect(screen.getByText("Apex Cart Draft")).toBeTruthy();
  });

  it("ignores a malformed draft from its parent and keeps the last one it showed", () => {
    renderFramed();
    receive(draftMessage);
    receive({ ...draftMessage, settings: { ...renamed("Wrong sections"), sections: [{ id: "x", type: "carousel" }] } });
    receive({ ...draftMessage, settings: renamed("Wrong media"), media: [{ id: "media-x" }] });
    expect(screen.queryByText("Wrong sections")).toBeNull();
    expect(screen.queryByText("Wrong media")).toBeNull();
    expect(screen.getByText("Apex Cart Draft")).toBeTruthy();
  });

  it("cancels link clicks, so nothing in the frame navigates, and leaves other clicks alone", () => {
    renderFramed();
    receive(draftMessage);
    const links = [
      screen.getByRole("link", { name: "Shop now" }),
      screen.getByRole("link", { name: "All departments" }),
      within(screen.getByRole("list", { name: "Shop by department" })).getAllByRole("link")[0],
      screen.getByRole("link", { name: /View all\s*Featured products/ }),
      within(screen.getByRole("list", { name: "Featured products" })).getByRole("link", { name: "Linen Short-Sleeve Shirt" }),
    ];
    for (const link of links) {
      fireEvent.click(link);
      expect(window.location.hash, link.textContent ?? "").toBe("#/admin/storefront/preview-frame");
    }
    expect(fireEvent.click(screen.getByRole("heading", { name: "Launch week" }))).toBe(true);
  });

  it("shows product cards in preview mode: they lead to the product preview and offer no buying or wishlist", () => {
    renderFramed();
    receive(draftMessage);
    const featured = screen.getByRole("list", { name: "Featured products" });
    expect(within(featured).getByRole("link", { name: "Linen Short-Sleeve Shirt" }).getAttribute("href")).toBe("#/admin/catalog/preview?product=prod-linen-shirt");
    expect(within(featured).queryAllByRole("button")).toEqual([]);
  });

  it("reports the height of its own content wrapper to its parent", () => {
    const observers: { callback: ResizeObserverCallback; target: Element | null }[] = [];
    vi.stubGlobal("ResizeObserver", class {
      record: { callback: ResizeObserverCallback; target: Element | null };
      constructor(callback: ResizeObserverCallback) {
        this.record = { callback, target: null };
        observers.push(this.record);
      }
      observe(target: Element) { this.record.target = target; }
      unobserve() {}
      disconnect() {}
    });
    renderFramed();
    receive(draftMessage);
    const brand = screen.getByText("Apex Cart Draft");
    const measured = observers.find((observer) => observer.target?.contains(brand));
    expect(measured?.target).not.toBe(document.body);
    expect(measured?.target).not.toBe(document.documentElement);
    vi.spyOn(measured!.target!, "getBoundingClientRect").mockReturnValue({ height: 2345.5 } as DOMRect);
    act(() => measured!.callback([], {} as ResizeObserver));
    expect(parent.postMessage).toHaveBeenLastCalledWith({ type: PREVIEW_MESSAGES.height, height: 2345.5 }, ORIGIN);
  });

  it("applies the draft's theme and fonts inside the frame only while it shows the draft", () => {
    const { unmount } = renderFramed();
    receive(draftMessage);
    const wrapper = screen.getByText("Apex Cart Draft").closest<HTMLElement>("[style]")!;
    expect(wrapper.style.getPropertyValue("--color-brand-primary")).toBe("#123456");
    expect(document.documentElement.style.getPropertyValue("--color-brand-primary")).toBe("");
    expect(document.getElementById("apex-cart-preview-font-link")?.getAttribute("href")).toContain("family=Lora");
    unmount();
    expect(document.getElementById("apex-cart-preview-font-link")).toBeNull();
  });
});
