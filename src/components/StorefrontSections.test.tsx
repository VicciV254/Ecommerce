import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Campaign, CatalogProduct, StorefrontSettings } from "../api/catalog";
import { buildCategoryTree } from "../store/catalogModel";
import type { CatalogValue } from "../store/CatalogContext";
import {
  campaignMedia,
  fixtureCategories,
  fixtureImage,
  fixtureReturnPolicy,
  fixtureStorefrontSettings,
  linenShirt,
  poloShirt,
} from "../test-support/catalogFixtures";
import { StorefrontSections } from "./StorefrontSections";

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
    returnPolicy: status === "ready" ? fixtureReturnPolicy : null,
    reload: vi.fn(),
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

  it("offers hero renditions for each artwork while keeping its art direction and focal points", () => {
    const desktop = fixtureImage({
      id: "media-hero-desktop", url: "https://res.cloudinary.com/apex-test/image/upload/v7/apex-cart/storefront/hero.jpg", width: 2400, height: 1200,
    });
    const mobile = fixtureImage({ id: "media-hero-mobile", url: "https://images.unsplash.com/photo-9?w=1080&fit=crop&ixid=keep", width: 1080, height: 1350 });
    const media = new Map([desktop, mobile].map((asset) => [asset.id, asset]));
    render(<StorefrontSections settings={settingsWith(campaign({ desktopMediaId: desktop.id, mobileMediaId: mobile.id }))} mediaById={media} />);
    const section = screen.getByRole("region", { name: "Workspace week" });
    const source = section.querySelector("picture source")!;
    expect(source.getAttribute("media")).toBe("(width < 48rem)");
    expect(source.getAttribute("sizes")).toBe("100vw");
    expect(source.getAttribute("srcset")!.split(", ").map((entry) => {
      const [url, width] = entry.split(" ");
      return [new URL(url).searchParams.get("w"), new URL(url).searchParams.get("ixid"), width];
    })).toEqual([["640", "keep", "640w"], ["960", "keep", "960w"], ["1280", "keep", "1280w"], ["1920", "keep", "1920w"], ["2560", "keep", "2560w"]]);
    const image = section.querySelector<HTMLImageElement>("picture img")!;
    expect(image.getAttribute("srcset")).toContain("/upload/c_limit,w_2560/q_auto/f_auto/v7/apex-cart/storefront/hero.jpg 2560w");
    expect(image.getAttribute("src")).toBe("https://res.cloudinary.com/apex-test/image/upload/c_limit,w_1280/q_auto/f_auto/v7/apex-cart/storefront/hero.jpg");
    expect([image.getAttribute("sizes"), image.getAttribute("width"), image.getAttribute("height")]).toEqual(["100vw", "2400", "1200"]);
    // The only section leads the page, so its artwork loads eagerly with high priority.
    expect([image.getAttribute("loading"), image.getAttribute("fetchpriority"), image.getAttribute("decoding")]).toEqual(["eager", "high", "async"]);
    expect(image.style.getPropertyValue("--focal-mobile")).toBe("70% 20%");
  });

  it("[7] keeps an artwork address that cannot be resized as a single srcset candidate", () => {
    const sneaky = fixtureImage({ id: "media-sneaky", url: "https://media.example.test/hero.jpg 2000w, https://elsewhere.example/x.jpg" });
    const media = new Map([...mediaById, [sneaky.id, sneaky]]);
    render(<StorefrontSections settings={settingsWith(campaign({ mobileMediaId: sneaky.id }))} mediaById={media} />);
    const source = screen.getByRole("region", { name: "Workspace week" }).querySelector("picture source")!;
    expect(source.getAttribute("srcset")).toBe("https://media.example.test/hero.jpg%202000w,%20https://elsewhere.example/x.jpg");
  });

  it("sizes department artwork to the rail tiles and keeps the missing-image fallback", () => {
    state.catalog = {
      ...catalogWith([linenShirt]),
      categories: buildCategoryTree(fixtureCategories.map((category) =>
        category.id === "cat-fashion" ? { ...category, image: "https://res.cloudinary.com/apex-test/image/upload/v3/apex-cart/storefront/fashion.jpg" } : category)),
    };
    const settings = fixtureStorefrontSettings({
      sections: [{ id: "departments", type: "departments", title: "Shop by department", enabled: true, productIds: [], categoryIds: [], campaignId: null }],
    });
    render(<StorefrontSections settings={settings} mediaById={mediaById} />);
    const [phones, fashion] = within(screen.getByRole("list", { name: "Shop by department" })).getAllByRole("link");
    expect(within(phones).getByRole("img", { name: "No department image" })).toBeTruthy();
    const tile = fashion.querySelector("img")!;
    // Rail tiles: 42% of the rail on phones, 22% from 768px, 15% from 1280px.
    expect(tile.getAttribute("sizes")).toBe("(min-width: 1440px) 208px, (min-width: 1280px) 15vw, (min-width: 768px) 22vw, 42vw");
    expect(tile.getAttribute("srcset")!.split(", ").map((entry) => entry.split(" ")[1])).toEqual(["240w", "320w", "480w", "640w", "960w"]);
    expect([tile.getAttribute("loading"), tile.getAttribute("alt")]).toEqual(["lazy", ""]);
    expect(tile.getAttribute("class")).toContain("group-hover:scale-110");
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

describe("published composition", () => {
  type Section = StorefrontSettings["sections"][number];
  const section = (id: string, type: Section["type"], title: string, extra: Partial<Section> = {}): Section =>
    ({ id, type, title, enabled: true, productIds: [], categoryIds: [], campaignId: null, ...extra });
  const departments = section("departments", "departments", "Shop by department");
  const featured = section("featured", "featured", "Featured products");
  const picks = section("picks", "products", "Staff picks", { productIds: [poloShirt.id, linenShirt.id] });
  const hero = section("hero", "campaign", "Hero", { campaignId: "launch" });
  const later = section("later", "campaign", "Later", { campaignId: "later" });
  const campaigns = [campaign(), campaign({ id: "later", title: "Later offer", layout: "split" })];
  /** Section headings and campaign regions in document order. */
  const outline = () => [...document.querySelectorAll("h2")].map((heading) => heading.textContent?.replace(/View all.*/, ""));

  it("follows the published order exactly, and a reorder changes the page", () => {
    const { rerender } = render(<StorefrontSections settings={fixtureStorefrontSettings({ sections: [hero, featured, departments, later], campaigns })} mediaById={mediaById} />);
    expect(outline()).toEqual(["Workspace week", "Featured products", "Shop by department", "Later offer"]);
    rerender(<StorefrontSections settings={fixtureStorefrontSettings({ sections: [departments, later, featured, hero], campaigns })} mediaById={mediaById} />);
    expect(outline()).toEqual(["Shop by department", "Later offer", "Featured products", "Workspace week"]);
  });

  it("renders nothing at all for a hidden section, with no fallback in its place", () => {
    const sections = [hero, { ...departments, enabled: false }, { ...featured, enabled: false }, picks];
    const { container } = render(<StorefrontSections settings={fixtureStorefrontSettings({ sections, campaigns })} mediaById={mediaById} />);
    expect(outline()).toEqual(["Workspace week", "Staff picks"]);
    expect(screen.queryByRole("list", { name: "Shop by department" })).toBeNull();
    // Hero section, then the product section's container: no empty wrapper is left where the hidden ones were.
    expect(container.children).toHaveLength(2);
  });

  it("makes the first campaign shoppers see the hero and later campaigns compact bands with their conditions", () => {
    const art = fixtureImage({ id: "media-band", url: "https://res.cloudinary.com/apex-test/image/upload/v7/apex-cart/storefront/band.jpg" });
    const bandCampaigns = [campaigns[0], { ...campaigns[1], desktopMediaId: art.id, mobileMediaId: null }];
    const media = new Map([...mediaById, [art.id, art]]);
    render(<StorefrontSections settings={fixtureStorefrontSettings({ sections: [featured, hero, later], campaigns: bandCampaigns })} mediaById={media} />);
    expect(screen.getByRole("heading", { name: "Workspace week" }).className).toContain("type-display");
    const band = screen.getByRole("region", { name: "Later offer" });
    expect(within(band).getByRole("heading", { name: "Later offer" }).className).toContain("type-h3");
    expect(within(band).getByText("While stocks last.")).toBeTruthy();
    expect(band.querySelector("picture img")?.getAttribute("sizes")).toBe("(min-width: 90rem) 459px, (min-width: 48rem) 33vw, 100vw");
  });

  it("shows 4, 6 then 8 products by breakpoint and links the rest through View all", () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ ...linenShirt, id: `featured-${index}`, name: `Featured ${index}` }));
    state.catalog = catalogWith(many);
    render(<StorefrontSections settings={fixtureStorefrontSettings({ sections: [featured, { ...picks, productIds: many.map((product) => product.id) }] })} mediaById={mediaById} />);
    const items = within(screen.getByRole("list", { name: "Featured products" })).getAllByRole("listitem");
    expect(items.map((item) => item.className.replace("min-w-0", "").trim())).toEqual([
      "", "", "", "", "hidden md:block", "hidden md:block", "hidden xl:block", "hidden xl:block",
    ]);
    expect(screen.getByRole("link", { name: /View all\s*Featured products/ }).getAttribute("href")).toBe("#/shop?featured=1");
    expect(screen.getByRole("link", { name: /View all\s*Staff picks/ }).getAttribute("href")).toBe("#/shop");
  });

  it("keeps each catalog section's place while the catalog loads", () => {
    state.catalog = catalogWith([], "loading");
    render(<StorefrontSections settings={fixtureStorefrontSettings({ sections: [departments, featured] })} mediaById={mediaById} />);
    expect(screen.getAllByRole("status").map((status) => status.textContent)).toEqual(["Loading shop by department…", "Loading featured products…"]);
    expect(document.querySelectorAll(".product-grid > div")).toHaveLength(8);
  });

  it("in a staff preview, leads product cards to the preview route and offers no buying or wishlist", () => {
    const settings = fixtureStorefrontSettings({ sections: [picks] });
    const { rerender } = render(<StorefrontSections settings={settings} mediaById={mediaById} />);
    const cards = () => within(screen.getByRole("list", { name: "Staff picks" }));
    expect(cards().getByRole("link", { name: "Cotton Polo Shirt" }).getAttribute("href")).toBe("#/product/prod-polo-shirt");
    expect(cards().getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual([
      "Save Cotton Polo Shirt to wishlist", "Add to cart",
      "Save Linen Short-Sleeve Shirt to wishlist", "Choose options for Linen Short-Sleeve Shirt",
    ]);

    rerender(<StorefrontSections settings={settings} mediaById={mediaById} productPreviewRoute={(id) => `/admin/catalog/preview?product=${id}`} />);
    expect(cards().getByRole("link", { name: "Cotton Polo Shirt" }).getAttribute("href")).toBe("#/admin/catalog/preview?product=prod-polo-shirt");
    expect(cards().getByRole("link", { name: "Linen Short-Sleeve Shirt" }).getAttribute("href")).toBe("#/admin/catalog/preview?product=prod-linen-shirt");
    expect(cards().queryAllByRole("button")).toEqual([]);
  });
});

describe("campaign loading priority", () => {
  type Section = StorefrontSettings["sections"][number];
  const featured: Section = { id: "featured", type: "featured", title: "Featured products", enabled: true, productIds: [], categoryIds: [], campaignId: null };
  const campaignAt = (id: string, campaignId: string): Section =>
    ({ id, type: "campaign", title: id, enabled: true, productIds: [], categoryIds: [], campaignId });
  const artworkOf = (title: string) => screen.getByRole("region", { name: title }).querySelector("picture img")!;
  const highPriority = () => document.querySelectorAll('img[fetchpriority="high"]');

  it("loads only the leading campaign eagerly with high priority; a campaign further down stays lazy", () => {
    const settings = fixtureStorefrontSettings({
      sections: [campaignAt("top", "launch"), featured, campaignAt("lower", "later")],
      campaigns: [campaign(), campaign({ id: "later", title: "Later offer" })],
    });
    render(<StorefrontSections settings={settings} mediaById={mediaById} />);
    expect([artworkOf("Workspace week").getAttribute("loading"), artworkOf("Workspace week").getAttribute("fetchpriority")]).toEqual(["eager", "high"]);
    expect([artworkOf("Later offer").getAttribute("loading"), artworkOf("Later offer").hasAttribute("fetchpriority")]).toEqual(["lazy", false]);
    expect(highPriority()).toHaveLength(1);
  });

  it.each(["ready", "loading"] as const)("keeps a campaign lazy below products while the catalog is %s", (status) => {
    state.catalog = catalogWith([linenShirt, poloShirt], status);
    render(<StorefrontSections settings={fixtureStorefrontSettings({ sections: [featured, campaignAt("hero", "launch")], campaigns: [campaign()] })} mediaById={mediaById} />);
    expect(artworkOf("Workspace week").getAttribute("loading")).toBe("lazy");
    expect(highPriority()).toHaveLength(0);
  });

  it("leads with the first campaign shoppers see when earlier sections show them nothing", () => {
    const settings = fixtureStorefrontSettings({
      sections: [campaignAt("missing", "retired-campaign"), { ...featured, id: "picks", type: "products", productIds: ["retired-product"] }, campaignAt("hero", "launch")],
      campaigns: [campaign()],
    });
    render(<StorefrontSections settings={settings} mediaById={mediaById} />);
    expect(artworkOf("Workspace week").getAttribute("fetchpriority")).toBe("high");
    expect(highPriority()).toHaveLength(1);
  });
});
