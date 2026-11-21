import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Campaign, PublishedStorefront, StorefrontSettings } from "../api/catalog";
import { buildCategoryTree } from "../store/catalogModel";
import type { CatalogValue } from "../store/CatalogContext";
import { campaignMedia, fixtureCategories, fixtureStorefront, fixtureStorefrontSettings } from "../test-support/catalogFixtures";
import Home from "./Home";

/*
 * The home page around the published sections: a hero carousel that leads the page sits directly under the header,
 * edge to edge, with the sample-catalog notice after it; otherwise the notice comes first. While the storefront loads,
 * the page holds a screen-tall shape of what is coming.
 */
const state = vi.hoisted(() => ({
  storefront: null as null | { status: "loading" | "ready" | "error"; storefront: PublishedStorefront | null },
  catalog: null as CatalogValue | null,
}));
vi.mock("../store/StorefrontContext", () => ({
  useStorefront: () => ({
    status: state.storefront!.status, error: null, storefront: state.storefront!.storefront, brandName: "Apex Cart",
    mediaById: new Map(campaignMedia.map((asset) => [asset.id, asset])), reload: vi.fn(),
  }),
}));
vi.mock("../store/CatalogContext", () => ({ useCatalog: () => state.catalog }));
vi.mock("../store/StoreContext", () => ({ useStore: () => ({ state: { wishlist: [] }, addToCart: vi.fn(), toggleWish: vi.fn() }) }));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

type Section = StorefrontSettings["sections"][number];
const campaign = (id: string, title: string): Campaign => ({
  id, title, body: "", conditions: "", cta: { label: "Shop now", target: "shop", targetId: null },
  desktopMediaId: "media-campaign-desktop", mobileMediaId: null, desktopFocal: { x: 50, y: 50 }, mobileFocal: { x: 50, y: 50 }, layout: "overlay",
});
const campaigns = [campaign("week", "Fashion week"), campaign("season", "New season")];
const carousel: Section = {
  id: "hero-carousel", type: "carousel", title: "Highlights", enabled: true, productIds: [], categoryIds: [], campaignId: null, campaignIds: ["week", "season"],
};
const hero: Section = { id: "hero", type: "campaign", title: "Hero", enabled: true, productIds: [], categoryIds: [], campaignId: "week" };
const featured: Section = { id: "featured", type: "featured", title: "Featured products", enabled: true, productIds: [], categoryIds: [], campaignId: null };

function catalog(status: CatalogValue["status"], mode: CatalogValue["mode"] = "demo"): CatalogValue {
  return {
    status, error: null, mode: status === "ready" ? mode : null, products: [], productsById: new Map(), categories: buildCategoryTree(fixtureCategories),
    designers: [], discounts: [], returnPolicy: null, delivery: null, demonstrationOrders: null, sampleOrderRetentionDays: null, reload: vi.fn(),
  };
}
const ready = (sections: Section[]) => {
  state.storefront = { status: "ready", storefront: fixtureStorefront({ settings: fixtureStorefrontSettings({ sections, campaigns }) }) };
};
const notice = () => document.querySelector("main p.rounded-md, p.rounded-md")!;
const before = (first: Element, second: Element) => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  state.catalog = catalog("ready");
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

describe("home page placement", () => {
  it("puts a leading carousel first, edge to edge, with the sample-catalog notice after it", () => {
    ready([carousel, featured]);
    render(<Home />);
    const heading = screen.getByRole("heading", { level: 1, name: "Apex Cart" });
    const region = screen.getByRole("region", { name: "Highlights" });
    expect(screen.getByRole("note").textContent).toMatch(/^Demo catalog:/);
    expect(before(heading, region)).toBe(true);
    expect(before(region, screen.getByRole("note"))).toBe(true);
    expect(region.closest(".max-w-\\[1440px\\]")).toBeNull();
    expect(region.querySelector("img")?.getAttribute("fetchpriority")).toBe("high");
  });

  it("holds the notice's place after a leading carousel while the catalog loads", () => {
    state.catalog = catalog("loading");
    ready([carousel, featured]);
    render(<Home />);
    const held = notice();
    expect(held.getAttribute("aria-hidden")).toBe("true");
    expect(before(screen.getByRole("region", { name: "Highlights" }), held)).toBe(true);
  });

  it.each([
    ["a campaign", [hero, carousel]],
    ["a hidden carousel", [{ ...carousel, enabled: false }, hero]],
    ["a product section", [featured, carousel]],
  ])("keeps the notice first when %s leads", (_case, sections) => {
    ready(sections as Section[]);
    render(<Home />);
    const first = screen.queryByRole("region", { name: "Highlights" }) ?? screen.getByRole("region", { name: "Fashion week" });
    expect(before(screen.getByRole("note"), first)).toBe(true);
  });
});

describe("home page while the storefront loads", () => {
  it("holds a screen-tall shape: a full-width hero block, a facts row and a product row, with its status and no spinner", () => {
    state.storefront = { status: "loading", storefront: null };
    const { container } = render(<Home />);
    expect(screen.getByRole("status").textContent).toBe("Loading the storefront…");
    expect(container.querySelector(".min-h-svh")).toBeTruthy();
    expect(container.querySelector(".animate-spin")).toBeNull();
    const shapes = [...container.querySelectorAll<HTMLElement>("[aria-hidden='true'] .skeleton, [aria-hidden='true'].skeleton")];
    const heroBlock = shapes[0];
    expect(heroBlock.className).toMatch(/h-\[440px\].*sm:h-\[520px\].*lg:h-\[600px\]/);
    expect(heroBlock.closest(".max-w-\\[1440px\\]")).toBeNull();
    expect(container.querySelectorAll(".facts-grid > .skeleton")).toHaveLength(4);
    // A product row: card shapes, each with its square picture.
    expect(container.querySelectorAll(".skeleton.aspect-square").length).toBeGreaterThanOrEqual(4);
  });
});
