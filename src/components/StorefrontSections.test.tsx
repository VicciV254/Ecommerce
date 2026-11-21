import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Campaign, CatalogProduct, StorefrontSettings } from "../api/catalog";
import { buildCategoryTree } from "../store/catalogModel";
import type { CatalogValue } from "../store/CatalogContext";
import {
  campaignMedia,
  demoPhone,
  fixtureCategories,
  fixtureCategory,
  fixtureImage,
  fixtureDelivery, fixtureReturnPolicy,
  fixtureStorefrontSettings,
  linenShirt,
  poloShirt,
} from "../test-support/catalogFixtures";
import { StorefrontSections } from "./StorefrontSections";

const state = vi.hoisted(() => ({ catalog: null as CatalogValue | null }));
const api = vi.hoisted(() => ({ getBestSellers: vi.fn() }));
vi.mock("../store/CatalogContext", () => ({ useCatalog: () => state.catalog }));
vi.mock("../store/StoreContext", () => ({ useStore: () => ({ state: { wishlist: [] }, addToCart: vi.fn(), toggleWish: vi.fn() }) }));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("../api/catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/catalog")>();
  return { ...actual, catalogAPI: { ...actual.catalogAPI, getBestSellers: api.getBestSellers } };
});

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
    returnPolicy: status === "ready" ? fixtureReturnPolicy : null, delivery: status === "ready" ? fixtureDelivery : null,
    demonstrationOrders: status === "ready" ? false : null, sampleOrderRetentionDays: null,
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
  api.getBestSellers.mockReset();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
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
    expect(tile.getAttribute("sizes")).toBe("(min-width: 90em) 208px, (min-width: 80em) 15vw, (min-width: 48em) 22vw, 42vw");
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
    expect(band.querySelector("picture img")?.getAttribute("sizes")).toBe("(min-width: 90em) 459px, (min-width: 48em) 33vw, 100vw");
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
    // Chosen products: content the storefront guarantees, so the campaign below shows while the catalog loads.
    const picks: Section = { ...featured, id: "picks", type: "products", productIds: [poloShirt.id] };
    render(<StorefrontSections settings={fixtureStorefrontSettings({ sections: [picks, campaignAt("hero", "launch")], campaigns: [campaign()] })} mediaById={mediaById} />);
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

describe("P8.7 section kinds", () => {
  type Section = StorefrontSettings["sections"][number];
  const kind = (id: string, type: string, title: string, extra: Record<string, unknown> = {}) =>
    ({ id, type, title, enabled: true, productIds: [], categoryIds: [], campaignId: null, ...extra }) as Section;
  const show = (sections: Section[], props: { showProblems?: boolean } = {}) =>
    render(<StorefrontSections settings={fixtureStorefrontSettings({ sections })} mediaById={mediaById} {...props} />);
  /** jsdom does no layout: give the rail a size and scroll position, then let it measure as a scroll would. */
  async function layOut(rail: HTMLElement, { scrollLeft, clientWidth = 400, scrollWidth = 1400 }: { scrollLeft: number; clientWidth?: number; scrollWidth?: number }) {
    Object.defineProperties(rail, {
      scrollLeft: { configurable: true, value: scrollLeft },
      clientWidth: { configurable: true, value: clientWidth },
      scrollWidth: { configurable: true, value: scrollWidth },
    });
    fireEvent.scroll(rail);
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  }
  const cardNames = (list: HTMLElement) => within(list).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
  const visibility = (list: HTMLElement) => within(list).getAllByRole("listitem")
    .map((item) => item.className.split(/\s+/).filter((name) => /^((md|xl):)?(hidden|block)$/.test(name)).join(" "));
  /** Fourteen products in the Shirts category (Fashion › Men › Shirts). */
  const shirts = Array.from({ length: 14 }, (_, index) => ({ ...poloShirt, id: `shirt-${index}`, name: `Shirt ${index}` }));

  describe("product rails", () => {
    it("shows selected products as a row of up to twelve, with View all and controls named for the section", async () => {
      state.catalog = catalogWith(shirts);
      show([kind("picks", "products", "Staff picks", { productIds: shirts.map((product) => product.id), layout: "rail" })]);
      const rail = screen.getByRole("list", { name: "Staff picks" });
      expect(cardNames(rail)).toEqual(shirts.slice(0, 12).map((product) => product.name));
      expect(visibility(rail).every((classes) => classes === "")).toBe(true);
      expect(screen.getByRole("link", { name: /View all\s*Staff picks/ }).getAttribute("href")).toBe("#/shop");
      const controls = () => screen.queryAllByRole("button", { name: /products in Staff picks$/ }).map((button) => button.getAttribute("aria-label"));
      await layOut(rail, { scrollLeft: 0 });
      expect(controls()).toEqual(["Next products in Staff picks"]);
      await layOut(rail, { scrollLeft: 500 });
      expect(controls()).toEqual(["Previous products in Staff picks", "Next products in Staff picks"]);
      await layOut(rail, { scrollLeft: 1000 });
      expect(controls()).toEqual(["Previous products in Staff picks"]);
    });

    it("moves a product rail by most of its width, at once under reduced motion", async () => {
      state.catalog = catalogWith(shirts);
      show([kind("featured", "featured", "Staff picks", { layout: "rail", productIds: shirts.map((product) => product.id) })]);
      const rail = screen.getByRole("list", { name: "Staff picks" });
      const scrollBy = vi.fn();
      rail.scrollBy = scrollBy;
      await layOut(rail, { scrollLeft: 500 });
      fireEvent.click(screen.getByRole("button", { name: "Next products in Staff picks" }));
      expect(scrollBy).toHaveBeenLastCalledWith({ left: 340, behavior: "smooth" });
      window.matchMedia = vi.fn().mockReturnValue({ matches: true });
      fireEvent.click(screen.getByRole("button", { name: "Previous products in Staff picks" }));
      expect(scrollBy).toHaveBeenLastCalledWith({ left: -340, behavior: "auto" });
    });

    it("shows products marked Featured as a row when the featured section chooses none, leading View all to them", () => {
      const featured = shirts.map((product, index) => ({ ...product, isFeatured: index % 2 === 0 }));
      state.catalog = catalogWith(featured);
      show([kind("featured", "featured", "Staff picks", { layout: "rail" })]);
      expect(cardNames(screen.getByRole("list", { name: "Staff picks" }))).toEqual(featured.filter((product) => product.isFeatured).map((product) => product.name));
      expect(screen.getByRole("link", { name: /View all\s*Staff picks/ }).getAttribute("href")).toBe("#/shop?featured=1");
    });

    it("sizes rail card images to the rail and loads them lazily", () => {
      const pictured = shirts.map((product) => ({
        ...product, images: [fixtureImage({ id: `${product.id}-image`, url: `https://res.cloudinary.com/apex-test/image/upload/v1/apex-cart/${product.id}.jpg`, isMain: true })],
      }));
      state.catalog = catalogWith(pictured);
      show([kind("picks", "products", "Staff picks", { productIds: pictured.map((product) => product.id), layout: "rail" })]);
      const images = [...screen.getByRole("list", { name: "Staff picks" }).querySelectorAll("img")];
      expect(images).toHaveLength(12);
      expect(new Set(images.map((image) => image.getAttribute("sizes")))).toEqual(new Set([
        "(min-width: 90em) 241px, (min-width: 80em) calc((100vw - 64px) * 0.175), (min-width: 64em) calc((100vw - 64px) * 0.23), (min-width: 48em) calc((100vw - 48px) * 0.3), (min-width: 40em) calc((100vw - 48px) * 0.42), calc((100vw - 32px) * 0.42)",
      ]));
      expect(images.every((image) => image.getAttribute("loading") === "lazy")).toBe(true);
    });
  });

  describe("department rows", () => {
    it("lists the department's products in catalog order, sub-categories included, and See all leads to its listing", () => {
      state.catalog = catalogWith([demoPhone, ...shirts]);
      show([kind("fashion", "category", "Fashion", { categoryIds: ["cat-fashion"] })]);
      const row = screen.getByRole("list", { name: "Fashion" });
      expect(cardNames(row)).toEqual(shirts.slice(0, 12).map((product) => product.name));
      expect(screen.getByRole("link", { name: /See all\s*Fashion/ }).getAttribute("href")).toBe("#/shop?cat=fashion");
      expect(screen.queryAllByRole("button", { name: /products in Fashion$/ })).toEqual([]);
    });

    it("as a grid shows 4, 6 then 8 of them by breakpoint, like a product grid", () => {
      state.catalog = catalogWith(shirts);
      show([kind("shirts", "category", "Shirts for warm days", { categoryIds: ["cat-shirts"], layout: "grid" })]);
      const grid = screen.getByRole("list", { name: "Shirts for warm days" });
      expect(grid.className).toContain("product-grid");
      expect(visibility(grid)).toEqual(["", "", "", "", "hidden md:block", "hidden md:block", "hidden xl:block", "hidden xl:block"]);
      expect(screen.getByRole("link", { name: /See all\s*Shirts for warm days/ }).getAttribute("href")).toBe("#/shop?cat=shirts");
    });

    it("is hidden from shoppers when its department is gone or has no products; the staff preview says why", () => {
      state.catalog = catalogWith([linenShirt]);
      const sections = [
        kind("gone", "category", "Gone", { categoryIds: ["retired-category"] }),
        kind("phones", "category", "Phones", { categoryIds: ["cat-phones-tablets"] }),
      ];
      const { container, unmount } = show(sections);
      expect(container.textContent).toBe("");
      unmount();
      show(sections, { showProblems: true });
      expect(screen.getByText("Category retired-category is unavailable")).toBeTruthy();
      expect(screen.getByText("No products in Phones & Tablets; shoppers will not see this section")).toBeTruthy();
    });
  });

  describe("departments grid", () => {
    const departments = Array.from({ length: 14 }, (_, index) => fixtureCategory({
      id: `dept-${index}`, name: `Department ${index}`, order: index, productCount: 2,
      image: index === 0 ? "https://res.cloudinary.com/apex-test/image/upload/v3/apex-cart/storefront/dept.jpg" : null,
    }));

    it("shows 8 departments on phones, 12 from 768px and all from 1280px, with All departments for the rest", () => {
      state.catalog = { ...catalogWith([]), categories: buildCategoryTree(departments) };
      show([kind("departments", "departments", "Shop by department", { layout: "grid" })]);
      const grid = screen.getByRole("list", { name: "Shop by department" });
      // 2, 4 then 7 columns, each at least 9rem wide, so enlarged text drops a column instead of squeezing names.
      expect(grid.className.split(/\s+/)).toContain("department-grid");
      expect(visibility(grid)).toEqual([...Array(8).fill(""), ...Array(4).fill("hidden md:block"), ...Array(2).fill("hidden xl:block")]);
      expect(within(grid).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(departments.map((item) => `#/shop?cat=${item.slug}`));
      expect(screen.getByRole("link", { name: "All departments" }).getAttribute("href")).toBe("#/departments");
      expect(screen.queryAllByRole("button")).toEqual([]);
      const image = within(grid).getAllByRole("link")[0].querySelector("img")!;
      expect(image.getAttribute("sizes")).toBe(
        "(min-width: 90em) 187px, (min-width: 80em) calc((100vw - 136px) / 7), (min-width: 64em) calc((100vw - 100px) / 4), (min-width: 48em) calc((100vw - 84px) / 4), (min-width: 40em) calc((100vw - 60px) / 2), calc((100vw - 44px) / 2)",
      );
      expect(image.getAttribute("loading")).toBe("lazy");
    });
  });

  describe("shopping facts strip", () => {
    const facts = kind("facts", "promises", "How shopping works");
    const strip = () => screen.getByRole("list", { name: "How shopping works" });
    const factLinks = () => within(strip()).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")]);

    it("states four facts from the catalog's settings, each leading to its page, under the section's heading", () => {
      show([facts]);
      expect(screen.getByRole("heading", { level: 2, name: "How shopping works" })).toBeTruthy();
      expect(factLinks()).toEqual([
        ["Prices and VAT Shown excluding VAT; 16% VAT is added at checkout.", "#/faq?section=how-the-store-is-set-up"],
        ["Delivery Anywhere in Kenya; same-day in Nairobi only.", "#/delivery"],
        ["Payment By M-Pesa: approve the prompt on your phone.", "#/faq?section=how-the-store-is-set-up"],
        ["Returns Return items within 7 days of delivery. Refunds by M-Pesa.", "#/returns"],
      ]);
    });

    it("words payment and refunds for demonstration payments where sample orders take them", () => {
      state.catalog = { ...catalogWith([linenShirt]), demonstrationOrders: true };
      show([facts]);
      expect(factLinks().map(([text]) => text)).toEqual([
        "Prices and VAT Shown excluding VAT; 16% VAT is added at checkout.",
        "Delivery Anywhere in Kenya; same-day in Nairobi only.",
        "Payment Sample orders use a demonstration payment; no money is taken.",
        "Returns Return items within 7 days of delivery. Refunds of demonstration payments move no money.",
      ]);
    });

    it("names only the return limits that exist", () => {
      const restricted = fixtureCategories.map((category) => (category.id === "cat-smartphones" ? { ...category, returnRule: "FAULT_ONLY" as const } : category));
      state.catalog = { ...catalogWith([linenShirt]), categories: buildCategoryTree(restricted) };
      show([facts]);
      expect(factLinks()[3][0]).toBe("Returns Return most items within 7 days of delivery. Refunds by M-Pesa.");
    });

    it.each(["loading", "error"] as const)("claims no payment method while the catalog is %s", (status) => {
      state.catalog = catalogWith([], status);
      show([facts]);
      expect(factLinks()).toEqual([
        ["Prices and VAT Shown excluding VAT; 16% VAT is added at checkout.", "#/faq?section=how-the-store-is-set-up"],
        ["Delivery The fee shows in your total before you reserve.", "#/delivery"],
        ["Payment See how payment works.", "#/faq?section=how-the-store-is-set-up"],
        ["Returns Each product page shows its rule.", "#/returns"],
      ]);
      expect(strip().textContent).not.toMatch(/M-Pesa|emonstration/);
    });
  });

  describe("best sellers", () => {
    const best = kind("best", "bestSellers", "Best sellers");
    const ranked = Array.from({ length: 14 }, (_, index) => ({ ...poloShirt, id: `best-${index}`, name: `Best ${index}` }));
    const answer = (productIds: string[]) => ({ data: { windowDays: 30, productIds } });
    const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    beforeEach(() => { state.catalog = catalogWith(ranked); });

    it("asks for the ranking only when an enabled best sellers section is shown", async () => {
      show(fixtureStorefrontSettings().sections);
      show([{ ...best, enabled: false }]);
      await settle();
      expect(api.getBestSellers).not.toHaveBeenCalled();
    });

    it("shows the ranked products in the API's order and says how they are ranked", async () => {
      api.getBestSellers.mockResolvedValue(answer(["best-3", "retired", "best-1", "best-0", "best-2"]));
      show([best]);
      const rail = await screen.findByRole("list", { name: "Best sellers" });
      expect(cardNames(rail)).toEqual(["Best 3", "Best 1", "Best 0", "Best 2"]);
      expect(screen.getByText("Ranked by paid orders in the last 30 days")).toBeTruthy();
      expect(screen.getByRole("link", { name: /View all\s*Best sellers/ }).getAttribute("href")).toBe("#/shop");
      expect(api.getBestSellers).toHaveBeenCalledTimes(1);
    });

    it("lists twelve at most", async () => {
      api.getBestSellers.mockResolvedValue(answer(ranked.map((product) => product.id)));
      show([best]);
      expect(within(await screen.findByRole("list", { name: "Best sellers" })).getAllByRole("listitem")).toHaveLength(12);
    });

    const hidden: [string, () => void, string][] = [
      ["fewer than four of its products are in the catalog", () => api.getBestSellers.mockResolvedValue(answer(["best-0", "best-1", "best-2", "retired"])), "fewer than 4 products qualify"],
      ["the API lists none", () => api.getBestSellers.mockResolvedValue(answer([])), "fewer than 4 products qualify"],
      ["the request fails", () => api.getBestSellers.mockRejectedValue(new Error("Network Error")), "the ranking could not be loaded"],
      ["the answer is malformed", () => api.getBestSellers.mockResolvedValue({ data: { windowDays: 30, productIds: "best-0" } }), "the ranking could not be loaded"],
      ["the ranking is still loading", () => api.getBestSellers.mockReturnValue(new Promise(() => undefined)), "the ranking is still loading"],
    ];
    it.each(hidden)("renders nothing for shoppers when %s, and the staff preview explains it", async (_case, arrange, reason) => {
      arrange();
      const { container, unmount } = show([best]);
      await settle();
      expect(container.textContent).toBe("");
      unmount();
      arrange();
      show([best], { showProblems: true });
      await settle();
      expect(screen.queryByRole("list", { name: "Best sellers" })).toBeNull();
      expect(screen.getByRole("note").textContent).toBe(
        `“Best sellers” is hidden from shoppers: ${reason}. It shows once at least 4 products in the catalog were each bought by at least 2 different accounts in paid orders in the last 30 days.`,
      );
    });

    it("waits for the catalog: nothing shows while it loads, even with the ranking in", async () => {
      api.getBestSellers.mockResolvedValue(answer(ranked.slice(0, 5).map((product) => product.id)));
      state.catalog = catalogWith([], "loading");
      const { container } = show([best]);
      await settle();
      expect(api.getBestSellers).toHaveBeenCalledTimes(1);
      expect(container.textContent).toBe("");
    });
  });

  it("keeps each new section's place while the catalog loads; the shopping facts show at once", () => {
    state.catalog = catalogWith([], "loading");
    api.getBestSellers.mockReturnValue(new Promise(() => undefined));
    show([
      kind("departments", "departments", "Shop by department", { layout: "grid" }),
      kind("picks", "products", "Staff picks", { productIds: ["prod-polo-shirt"], layout: "rail" }),
      kind("facts", "promises", "How shopping works"),
      kind("fashion", "category", "Fashion", { categoryIds: ["cat-fashion"] }),
      kind("best", "bestSellers", "Best sellers"),
    ]);
    expect(screen.getAllByRole("status").map((status) => status.textContent)).toEqual(["Loading shop by department…", "Loading staff picks…", "Loading fashion…"]);
    expect(screen.getByRole("list", { name: "How shopping works" })).toBeTruthy();
  });

  describe("while the page arrives, nothing shoppers see moves", () => {
    const facts = kind("facts", "promises", "How shopping works");
    const departments = kind("departments", "departments", "Shop by department", { layout: "grid" });
    const placeholder = (container: HTMLElement) => container.querySelector(":scope > .min-h-svh");

    it.each([
      ["a department row", kind("fashion", "category", "Fashion", { categoryIds: ["cat-fashion"] }), "Loading fashion…"],
      ["Featured without chosen products", kind("featured", "featured", "Featured products"), "Loading featured products…"],
    ])("waits with what follows %s until the catalog says whether it has products, keeping a screen below it", (_case, uncertain, status) => {
      state.catalog = catalogWith([], "loading");
      const { container, rerender } = show([uncertain, facts, departments]);
      expect(screen.getAllByRole("status").map((item) => item.textContent)).toEqual([status]);
      expect(screen.queryByRole("list", { name: "How shopping works" })).toBeNull();
      expect(placeholder(container)?.getAttribute("aria-hidden")).toBe("true");
      state.catalog = catalogWith([]);
      rerender(<StorefrontSections settings={fixtureStorefrontSettings({ sections: [uncertain, facts, departments] })} mediaById={mediaById} />);
      expect(screen.getByRole("list", { name: "How shopping works" })).toBeTruthy();
      expect(screen.getByRole("list", { name: "Shop by department" })).toBeTruthy();
      expect(placeholder(container)).toBeNull();
    });

    it("waits with what follows the best sellers until the ranking is in", async () => {
      let answer!: (value: { data: unknown }) => void;
      api.getBestSellers.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
      show([kind("best", "bestSellers", "Best sellers"), facts]);
      expect(screen.queryByRole("list", { name: "How shopping works" })).toBeNull();
      await act(async () => answer({ data: { windowDays: 30, productIds: [] } }));
      expect(screen.getByRole("list", { name: "How shopping works" })).toBeTruthy();
    });

    it("puts a catalog error where the first section needing the catalog was, below what already shows", () => {
      state.catalog = catalogWith([], "error");
      const sections = [kind("hero", "campaign", "Hero", { campaignId: "launch" }), facts, departments, kind("picks", "products", "Staff picks", { productIds: ["prod-polo-shirt"] })];
      render(<StorefrontSections settings={fixtureStorefrontSettings({ sections, campaigns: [campaign()] })} mediaById={mediaById} />);
      const order = [screen.getByRole("heading", { name: "Workspace week" }), screen.getByRole("list", { name: "How shopping works" }), screen.getByRole("heading", { name: "Products are unavailable" })];
      expect(order.every((element, index) => index === 0 || Boolean(order[index - 1].compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
      expect(screen.getAllByRole("heading", { name: "Products are unavailable" })).toHaveLength(1);
    });
  });

  it("shows one catalog error for product sections and keeps the shopping facts", () => {
    state.catalog = catalogWith([], "error");
    show([kind("facts", "promises", "How shopping works"), kind("fashion", "category", "Fashion", { categoryIds: ["cat-fashion"] })]);
    expect(screen.getAllByRole("heading", { name: "Products are unavailable" })).toHaveLength(1);
    expect(screen.getByRole("list", { name: "How shopping works" })).toBeTruthy();
  });

  it("shows no catalog error when only the shopping facts and campaigns depend on it", () => {
    state.catalog = catalogWith([], "error");
    show([kind("facts", "promises", "How shopping works")]);
    expect(screen.queryByRole("heading", { name: "Products are unavailable" })).toBeNull();
  });
});
