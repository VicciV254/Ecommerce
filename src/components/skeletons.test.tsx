import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCategoryTree } from "../store/catalogModel";
import type { CatalogValue } from "../store/CatalogContext";
import { fixtureCategories, fixtureStorefrontSettings, linenShirt } from "../test-support/catalogFixtures";
import Cart from "../pages/Cart";
import Departments from "../pages/Departments";
import ProductDetail from "../pages/ProductDetail";
import Shop from "../pages/Shop";
import Wishlist from "../pages/Wishlist";
import { DepartmentGridSkeleton, DepartmentRailSkeleton } from "./DepartmentRail";
import { ProductRailSkeleton } from "./ProductRail";
import { StorefrontSections } from "./StorefrontSections";

/*
 * Loading shapes: every skeleton shape shimmers (the `skeleton` utility: a light band sweeping a few times, then still,
 * and still throughout under reduced motion), and browsing pages show their layout's shape instead of a spinner, keeping
 * their status text for screen readers.
 */
const state = vi.hoisted(() => ({ catalog: null as CatalogValue | null, store: { cart: [] as unknown[], wishlist: [] as string[] }, ownerReady: true }));
vi.mock("../store/CatalogContext", () => ({ useCatalog: () => state.catalog }));
vi.mock("../store/StoreContext", () => ({
  useStore: () => ({ state: state.store, ownerReady: state.ownerReady, cartCount: state.store.cart.length, addToCart: vi.fn(), toggleWish: vi.fn() }),
}));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("../api/catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/catalog")>();
  return { ...actual, catalogAPI: { ...actual.catalogAPI, getProduct: () => new Promise(() => undefined), getBestSellers: () => new Promise(() => undefined) } };
});

function loadingCatalog(): CatalogValue {
  return {
    status: "loading", error: null, mode: null, products: [], productsById: new Map(), categories: buildCategoryTree(fixtureCategories),
    designers: [], discounts: [], returnPolicy: null, delivery: null, demonstrationOrders: null, sampleOrderRetentionDays: null, reload: vi.fn(),
  };
}

/** The leaf shapes of every aria-hidden loading block: each is a `skeleton`, and nothing spins. */
function expectShimmeringShapes(container: HTMLElement) {
  const blocks = [...container.querySelectorAll<HTMLElement>("[aria-hidden='true']")];
  expect(blocks.length, "a hidden loading shape").toBeGreaterThan(0);
  const tinted = blocks.flatMap((block) => [block, ...block.querySelectorAll<HTMLElement>("*")])
    .filter((element) => /\bbg-surface-soft\b/.test(element.className));
  expect(tinted, "shapes tinted without the shimmer").toEqual([]);
  const shapes = blocks.flatMap((block) => [...block.querySelectorAll<HTMLElement>(".skeleton")]);
  expect(shapes.length).toBeGreaterThan(2);
  expect(container.querySelector(".animate-spin")).toBeNull();
}

beforeEach(() => {
  state.catalog = loadingCatalog();
  state.store = { cart: [], wishlist: [] };
  state.ownerReady = true;
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

describe("skeleton shapes shimmer", () => {
  it.each([
    ["department row", <DepartmentRailSkeleton key="rail" />],
    ["department grid", <DepartmentGridSkeleton key="grid" />],
    ["product row", <ProductRailSkeleton key="products" />],
  ] as [string, ReactElement][])("%s", (_name, element) => {
    const { container } = render(element);
    expectShimmeringShapes(container);
  });

  it("home sections while the catalog loads", () => {
    const [departments, featured] = fixtureStorefrontSettings().sections;
    const sections = [
      departments,
      { id: "picks", type: "products" as const, title: "Staff picks", enabled: true, productIds: [linenShirt.id], categoryIds: [], campaignId: null, layout: "rail" as const },
      featured,
    ];
    const { container } = render(<StorefrontSections settings={fixtureStorefrontSettings({ sections })} mediaById={new Map()} />);
    expectShimmeringShapes(container);
    expect(screen.getAllByRole("status").map((status) => status.textContent)).toEqual(["Loading shop by department…", "Loading staff picks…", "Loading featured products…"]);
  });

  it("the shop listing while the catalog loads", () => {
    const { container } = render(<Shop route="/shop" />);
    expectShimmeringShapes(container);
    expect(screen.getByRole("status").textContent).toBe("Loading products…");
  });
});

describe("browsing pages show their shape instead of a spinner", () => {
  it("the product page: a gallery square, the name, price and buttons", () => {
    const { container } = render(<ProductDetail id={linenShirt.id} />);
    expect(screen.getByRole("status").textContent).toBe("Loading product…");
    expectShimmeringShapes(container);
    expect(container.querySelector(".skeleton.aspect-square")).toBeTruthy();
  });

  it("departments: the tile grid", () => {
    const { container } = render(<Departments />);
    expect(screen.getByRole("status").textContent).toBe("Loading departments…");
    expectShimmeringShapes(container);
  });

  it("the wishlist: product cards", () => {
    state.store = { cart: [], wishlist: [linenShirt.id] };
    const { container } = render(<Wishlist />);
    expect(screen.getByRole("status").textContent).toBe("Loading your saved items…");
    expectShimmeringShapes(container);
  });

  it("the cart: its lines, while the account or the prices load", () => {
    state.ownerReady = false;
    const { container, unmount } = render(<Cart />);
    expect(screen.getByRole("status").textContent).toBe("Loading your cart…");
    expectShimmeringShapes(container);
    unmount();
    state.ownerReady = true;
    state.store = { cart: [{ productId: linenShirt.id, variantId: linenShirt.variants[0].id, quantity: 1 }], wishlist: [] };
    const pending = render(<Cart />);
    expect(screen.getByRole("status").textContent).toBe("Loading current prices for your cart…");
    expectShimmeringShapes(pending.container);
  });
});
