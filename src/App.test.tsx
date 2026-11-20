import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "./api/auth";
import { navigate } from "./router";
import { buildCategoryTree } from "./store/catalogModel";
import type { CatalogValue } from "./store/CatalogContext";
import { fixtureSnapshot } from "./test-support/catalogFixtures";
import App from "./App";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";

const state = vi.hoisted(() => ({ user: null as User | null, catalog: null as CatalogValue | null }));
/** Every page renders as its name, so a test sees which page a route shows (the account page shows its child too). */
const page = vi.hoisted(() => (name: string) => async () => {
  const { createElement } = await import("react");
  return { default: ({ children }: { children?: ReactNode }) => createElement("div", null, `page:${name}`, children) };
});
const passThrough = vi.hoisted(() => ({ children }: { children: ReactNode }) => children);

vi.mock("aos", () => ({ default: { init: () => undefined } }));
vi.mock("./store/StorefrontContext", () => ({
  StorefrontProvider: passThrough, useStorefront: () => ({ brandName: "Apex Cart" }), usePageTitle: () => undefined,
}));
vi.mock("./store/CatalogContext", () => ({ CatalogProvider: passThrough, useCatalog: () => state.catalog }));
vi.mock("./contexts/AuthContext", () => ({
  AuthProvider: passThrough, useAuth: () => ({ user: state.user, refreshUser: () => Promise.resolve() }),
}));
vi.mock("./store/StoreContext", () => ({
  StoreProvider: passThrough, useStore: () => ({ cartCount: 0, state: { cart: [], wishlist: [] }, ownerReady: true }),
}));
vi.mock("./components/MiniCart", () => ({ MiniCartProvider: passThrough, useMiniCart: () => ({ isOpen: false, open: () => undefined }) }));
vi.mock("./components/GuestCartMerge", () => ({ GuestCartMerge: () => null }));
vi.mock("./pages/Home", page("home"));
vi.mock("./pages/Shop", page("shop"));
vi.mock("./pages/Departments", page("departments"));
vi.mock("./pages/ProductDetail", page("product"));
vi.mock("./pages/Cart", page("cart"));
vi.mock("./pages/Checkout", page("checkout"));
vi.mock("./pages/About", page("about"));
vi.mock("./pages/Contact", page("contact"));
vi.mock("./pages/Wishlist", page("wishlist"));
vi.mock("./pages/Admin", page("admin"));
vi.mock("./pages/admin/StorefrontPreviewFrame", async () => ({ StorefrontPreviewFrame: (await page("preview-frame")()).default }));
vi.mock("./pages/TrackOrder", page("track"));
vi.mock("./pages/Login", page("login"));
vi.mock("./pages/Register", page("register"));
vi.mock("./pages/Account", page("account"));
vi.mock("./pages/AccountProfile", page("account-profile"));
vi.mock("./pages/AccountOrders", page("account-orders"));
vi.mock("./pages/AccountAddresses", page("account-addresses"));
vi.mock("./pages/VerifyEmail", page("verify-email"));
vi.mock("./pages/Unsubscribe", page("unsubscribe"));
vi.mock("./pages/Delivery", page("delivery"));
vi.mock("./pages/Returns", page("returns"));
vi.mock("./pages/Faq", page("faq"));
vi.mock("./pages/Privacy", page("privacy"));
vi.mock("./pages/Terms", page("terms"));
vi.mock("./pages/NotFound", page("not-found"));

const customer: User = { id: "customer-1", email: "amina@example.test", firstName: "Amina", lastName: "Customer", addresses: [] };

beforeEach(() => {
  const snapshot = fixtureSnapshot();
  state.user = null;
  state.catalog = {
    status: "ready", error: null, mode: "demo", products: snapshot.products,
    productsById: new Map(snapshot.products.map((product) => [product.id, product])), categories: buildCategoryTree(snapshot.categories),
    designers: [], discounts: [], returnPolicy: snapshot.returnPolicy, delivery: snapshot.delivery, demonstrationOrders: false, sampleOrderRetentionDays: null, reload: () => undefined,
  };
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined });
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve() } });
});

afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
  Reflect.deleteProperty(document, "fonts");
});

/** The page App shows at `hash`, by its stub's name (the staff area has no shopper `main`). */
function pageAt(hash: string) {
  window.location.hash = hash;
  const { unmount } = render(<App />);
  const shown = (screen.queryByRole("main") ?? document.body).textContent;
  unmount();
  return shown;
}

describe("routes", () => {
  it("shows each new information page at its own address", () => {
    for (const [hash, shown] of [
      ["#/delivery", "page:delivery"], ["#/returns", "page:returns"], ["#/faq", "page:faq"], ["#/faq?section=contact", "page:faq"],
      ["#/privacy", "page:privacy"], ["#/privacy?section=your-rights", "page:privacy"], ["#/terms", "page:terms"],
      ["#/unsubscribe?token=abc", "page:unsubscribe"],
    ]) expect(pageAt(hash), hash).toBe(shown);
  });

  it("keeps every existing page, including sub-paths of existing roots", () => {
    for (const [hash, shown] of [
      ["#/", "page:home"], ["#/shop?cat=fashion", "page:shop"], ["#/departments", "page:departments"], ["#/product/linen", "page:product"],
      ["#/cart", "page:cart"], ["#/checkout?step=delivery", "page:checkout"], ["#/about", "page:about"], ["#/about/team", "page:about"],
      ["#/contact", "page:contact"], ["#/wishlist", "page:wishlist"], ["#/track?order=APX-1", "page:track"], ["#/login", "page:login"],
      ["#/register", "page:register"], ["#/verify-email", "page:verify-email"], ["#/account", "page:accountpage:account-profile"],
      ["#/account/orders", "page:accountpage:account-orders"], ["#/account/addresses", "page:accountpage:account-addresses"],
    ]) expect(pageAt(hash), hash).toBe(shown);
  });

  it("shows the not-found page for any unknown address instead of the home page", () => {
    for (const hash of ["#/does-not-exist", "#/showrooms", "#/FAQ", "#/toString", "#/constructor", "#/delivery-info"]) {
      expect(pageAt(hash), hash).toBe("page:not-found");
    }
  });

  it("still sends old showroom links to the shop", () => {
    expect(pageAt("#/showroom?go=events")).toBe("page:shop");
    expect(window.location.hash).toBe("#/shop");
  });

  it("keeps the long information pages mounted across their own section changes", async () => {
    for (const path of ["/faq", "/privacy", "/terms"]) {
      window.location.hash = `#${path}`;
      const { unmount } = render(<App />);
      const main = screen.getByRole("main");
      act(() => navigate(`${path}?section=contact`));
      await waitFor(() => expect(window.location.hash).toBe(`#${path}?section=contact`));
      expect(screen.getByRole("main")).toBe(main);
      unmount();
    }
  });
});

describe("link inventory", () => {
  /** Every route a set of rendered components links to (`#/…`); mail, phone and outside links are left out. */
  const targets = new Set<string>();
  const collect = () => {
    for (const link of document.querySelectorAll("a")) {
      const href = link.getAttribute("href") ?? "";
      expect(href, `${link.textContent}: a bare #section link`).not.toMatch(/^#(?!\/)/);
      if (href.startsWith("#/")) targets.add(href);
    }
  };

  it("resolves every link and navigate() target of the header, footer and public pages to a page", async () => {
    window.location.hash = "#/about";
    for (const signedIn of [false, true]) {
      state.user = signedIn ? customer : null;
      const { unmount } = render(<><Header /><Footer /></>);
      collect();
      // Hidden branches: the phone menu drawer, one department inside it, and the desktop departments panel.
      fireEvent.click(screen.getByRole("button", { name: "Menu" }));
      const drawer = screen.getByRole("dialog", { name: "Navigation menu" });
      collect();
      fireEvent.click(within(drawer).getByRole("button", { name: "Fashion" }));
      collect();
      fireEvent.click(within(drawer).getByRole("button", { name: "Close menu" }));
      fireEvent.click(screen.getByRole("button", { name: "Departments" }));
      collect();
      // navigate() callers: the header search.
      for (const search of screen.getAllByRole("combobox", { name: "Search products" })) {
        window.location.hash = "#/about";
        fireEvent.change(search, { target: { value: "linen shirt" } });
        fireEvent.submit(search.closest("form")!);
        targets.add(window.location.hash);
      }
      unmount();
    }

    const pages = [
      ["About", "/about"], ["Contact", "/contact"], ["Faq", "/faq"], ["Delivery", "/delivery"], ["Returns", "/returns"],
      ["Privacy", "/privacy"], ["Terms", "/terms"], ["NotFound", "/does-not-exist"],
    ];
    for (const [name, path] of pages) {
      const { default: Page } = await vi.importActual<{ default: () => ReactNode }>(`./pages/${name}`);
      window.location.hash = `#${path}`;
      const { unmount } = render(<Page />);
      collect();
      unmount();
    }

    // The inventory reached the hidden branches and every new page link.
    for (const expected of [
      "#/login?returnTo=%2Fabout", "#/account", "#/departments", "#/shop?q=linen+shirt", "#/privacy", "#/terms", "#/admin", "#/delivery",
      "#/returns", "#/faq", "#/faq?section=contact", "#/privacy?section=your-rights", "#/terms?section=law", "#/account/orders",
    ]) expect(targets, expected).toContain(expected);

    const unknown = [...targets].filter((target) => pageAt(target) === "page:not-found");
    expect(unknown).toEqual([]);
  });
});
