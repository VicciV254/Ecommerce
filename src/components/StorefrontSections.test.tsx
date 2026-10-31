import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Campaign, CatalogProduct } from "../api/catalog";
import { buildCategoryTree, productPriceView, variantPriceView } from "../store/catalogModel";
import type { CatalogValue } from "../store/CatalogContext";
import {
  campaignMedia,
  fixtureCategories,
  fixtureStorefrontSettings,
  linenShirt,
  poloShirt,
} from "../test-support/catalogFixtures";
import { StorefrontSections } from "./StorefrontSections";

const NOW = new Date("2026-10-31T12:00:00.000Z");
const state = vi.hoisted(() => ({ catalog: null as CatalogValue | null }));
vi.mock("../store/CatalogContext", () => ({ useCatalog: () => state.catalog }));
vi.mock("../store/StoreContext", () => ({ useStore: () => ({ state: { wishlist: [] }, addToCart: vi.fn(), toggleWish: vi.fn() }) }));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

function catalogWith(products: CatalogProduct[], status: CatalogValue["status"] = "ready"): CatalogValue {
  return {
    status,
    error: status === "error" ? "The catalog could not be loaded." : null,
    mode: "live",
    products,
    productsById: new Map(products.map((product) => [product.id, product])),
    categories: buildCategoryTree(fixtureCategories),
    designers: [],
    discounts: [],
    reload: vi.fn(),
    priceOf: (product) => productPriceView(product, [], NOW),
    priceOfVariant: (product, variant) => variantPriceView(product, variant, [], NOW),
  };
}

const mediaById = new Map(campaignMedia.map((asset) => [asset.id, asset]));

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "launch", title: "Workspace week", body: "Desks and laptops for home offices.", conditions: "While stocks last.",
    cta: { label: "Shop phones", target: "category", targetId: "cat-smartphones" },
    desktopMediaId: "media-campaign-desktop", mobileMediaId: "media-campaign-mobile",
    desktopFocal: { x: 30, y: 40 }, mobileFocal: { x: 70, y: 20 }, layout: "overlay",
    ...overrides,
  };
}

function settingsWith(item: Campaign) {
  return fixtureStorefrontSettings({
    sections: [{ id: "hero", type: "campaign", title: "Hero", enabled: true, productIds: [], categoryIds: [], campaignId: item.id }],
    campaigns: [item],
  });
}

beforeEach(() => {
  state.catalog = catalogWith([linenShirt, poloShirt]);
});

describe("StorefrontSections", () => {
  it("renders one campaign with viewport-specific artwork and shared copy, conditions and destination", () => {
    render(<StorefrontSections settings={settingsWith(campaign())} mediaById={mediaById} />);
    const section = screen.getByRole("region", { name: "Workspace week" });
    const source = section.querySelector("picture source");
    expect(source?.getAttribute("media")).toBe("(width < 48rem)");
    expect(source?.getAttribute("srcset")).toBe("https://media.example.test/campaign-mobile.jpg");
    const image = section.querySelector<HTMLImageElement>("picture img")!;
    expect(image.getAttribute("src")).toBe("https://media.example.test/campaign-desktop.jpg");
    expect(image.style.getPropertyValue("--focal-desktop")).toBe("30% 40%");
    expect(image.style.getPropertyValue("--focal-mobile")).toBe("70% 20%");
    expect(within(section).getByText("While stocks last.")).toBeTruthy();
    expect(within(section).getAllByRole("link")).toHaveLength(1);
    expect(within(section).getByRole("link", { name: "Shop phones" }).getAttribute("href")).toBe("#/shop?cat=smartphones");
  });

  it("crops the desktop image at the explicit mobile focal point when no mobile artwork is configured", () => {
    render(<StorefrontSections settings={settingsWith(campaign({ mobileMediaId: null }))} mediaById={mediaById} />);
    const section = screen.getByRole("region", { name: "Workspace week" });
    expect(section.querySelector("picture source")).toBeNull();
    const image = section.querySelector<HTMLImageElement>("picture img")!;
    expect(image.getAttribute("src")).toBe("https://media.example.test/campaign-desktop.jpg");
    expect(image.style.getPropertyValue("--focal-desktop")).toBe("30% 40%");
    expect(image.style.getPropertyValue("--focal-mobile")).toBe("70% 20%");
  });

  it("drops an unavailable call-to-action target instead of linking somewhere else, and reports it in preview", () => {
    const broken = campaign({ cta: { label: "Shop the phone", target: "product", targetId: "retired-product" } });
    const { unmount } = render(<StorefrontSections settings={settingsWith(broken)} mediaById={mediaById} />);
    expect(screen.queryByRole("link", { name: "Shop the phone" })).toBeNull();
    expect(screen.queryByText(/unavailable/)).toBeNull();
    unmount();
    render(<StorefrontSections settings={settingsWith(broken)} mediaById={mediaById} showProblems />);
    expect(screen.getByText("Call-to-action product retired-product is unavailable")).toBeTruthy();
  });

  it("does not link a catalog destination before the catalog confirms it exists", () => {
    state.catalog = catalogWith([], "loading");
    render(<StorefrontSections settings={settingsWith(campaign())} mediaById={mediaById} />);
    expect(screen.queryByRole("link", { name: "Shop phones" })).toBeNull();
    expect(screen.getByText("Workspace week")).toBeTruthy();
  });

  it("shows departments from the canonical tree and skips unknown product references", () => {
    const settings = fixtureStorefrontSettings({
      sections: [
        { id: "departments", type: "departments", title: "Shop by department", enabled: true, productIds: [], categoryIds: [], campaignId: null },
        { id: "picks", type: "products", title: "Staff picks", enabled: true, productIds: ["missing-product", poloShirt.id], categoryIds: [], campaignId: null },
        { id: "hidden", type: "featured", title: "Hidden section", enabled: false, productIds: [], categoryIds: [], campaignId: null },
      ],
    });
    render(<StorefrontSections settings={settings} mediaById={mediaById} />);
    const departments = screen.getByRole("list", { name: "Shop by department" });
    expect(within(departments).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "#/shop?cat=phones-tablets",
      "#/shop?cat=fashion",
    ]);
    expect(screen.getByRole("heading", { name: "Staff picks" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Cotton Polo Shirt" })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Hidden section" })).toBeNull();
  });

  it("states that nothing is published instead of inventing sections", () => {
    render(<StorefrontSections settings={fixtureStorefrontSettings({ sections: [] })} mediaById={mediaById} />);
    expect(screen.getByRole("heading", { name: "No storefront sections are published yet" })).toBeTruthy();
  });

  it("shows a catalog error once instead of empty product sections", () => {
    state.catalog = catalogWith([], "error");
    render(<StorefrontSections settings={fixtureStorefrontSettings()} mediaById={mediaById} />);
    expect(screen.getAllByRole("heading", { name: "Products are unavailable" })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Featured products" })).toBeNull();
  });
});
