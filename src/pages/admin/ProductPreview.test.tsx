import { act, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminCatalogSnapshot } from "../../api/catalog";
import { navigate, useRoute } from "../../router";
import { buildCategoryTree } from "../../store/catalogModel";
import { fixtureAdminSnapshot, fixtureCategories, fixtureProduct, fixtureVariant, imagelessShirt, linenShirt, poloShirt } from "../../test-support/catalogFixtures";
import { CarriedNoticeProvider, useCarriedNotice } from "./carriedNotice";
import { ProductPreview } from "./ProductPreview";

const mocks = vi.hoisted(() => ({
  snapshot: null as unknown,
  getProduct: vi.fn(),
  addToCart: vi.fn(),
  toggleWish: vi.fn(),
}));

vi.mock("./AdminCatalogContext", async () => {
  const { useMemo } = await import("react");
  return {
    useOptionalAdminCatalog: () => {
      const snapshot = mocks.snapshot as AdminCatalogSnapshot;
      const categories = useMemo(() => buildCategoryTree(snapshot.categories), [snapshot]);
      return { status: "ready", data: { snapshot, stocks: [] }, categories, error: null, sessionExpired: false, refreshing: false, reload: vi.fn() };
    },
  };
});
vi.mock("../../api/catalog", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/catalog")>(),
  catalogAPI: { getProduct: mocks.getProduct, getSnapshot: vi.fn(), getStorefront: vi.fn() },
}));
vi.mock("../../store/StoreContext", () => ({
  useStore: () => ({ state: { wishlist: [], cart: [] }, addToCart: mocks.addToCart, toggleWish: mocks.toggleWish }),
}));
vi.mock("../../contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

const hiddenJacket = fixtureProduct({
  id: "prod-hidden", name: "Hidden Draft Jacket", isActive: false, variants: [fixtureVariant({ id: "var-hidden", stock: 0 })],
});
const hiddenCousin = fixtureProduct({ id: "prod-hidden-2", name: "Hidden Draft Waistcoat", isActive: false });

function staffCatalog(hidden: string[] = []) {
  return fixtureAdminSnapshot({
    categories: fixtureCategories.map((category) => ({ ...category, isActive: !hidden.includes(category.id) })),
    products: [linenShirt, poloShirt, imagelessShirt, hiddenJacket, hiddenCousin],
  });
}

function open(route: string) {
  window.history.replaceState(null, "", `#${route}`);
  return render(<ProductPreview heading={{ current: null }} />);
}

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  mocks.snapshot = staffCatalog();
  mocks.getProduct.mockReset();
  mocks.addToCart.mockReset();
  mocks.toggleWish.mockReset();
});

describe("product preview", () => {
  it("shows a hidden product on shoppers' own page under a banner, with buying off and every link kept in the admin", () => {
    open("/admin/catalog/preview?product=prod-hidden");
    expect(screen.getAllByRole("heading", { level: 1 }).map((heading) => heading.textContent)).toEqual(["Preview: shoppers can't see this product"]);
    expect(screen.getByRole("heading", { level: 2, name: "Hidden Draft Jacket" })).toBeTruthy();
    expect(screen.getByText(/^Hidden \(draft\): only staff can see it\. This shows the saved product: changes not yet saved in the editor are not included\.$/)).toBeTruthy();
    const page = screen.getByRole("region", { name: "Product preview" });
    expect(within(page).getByText("Buying is off in this preview.")).toBeTruthy();
    expect(within(page).queryAllByRole("button", { name: /add to cart|choose options|wishlist/i })).toEqual([]);
    expect(within(page).getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe("Home/Shop/Fashion/Men/Shirts/Hidden Draft Jacket");
    expect(within(within(page).getByRole("navigation", { name: "Breadcrumb" })).queryAllByRole("link")).toEqual([]);
    // Related products come from the staff catalog, hidden ones included, and lead to their own previews.
    const related = within(page).getByRole("heading", { name: "More in Shirts" }).parentElement!;
    expect(within(related).getByText("Hidden Draft Waistcoat")).toBeTruthy();
    const hrefs = [...page.querySelectorAll("a")].map((link) => link.getAttribute("href"));
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.filter((href) => !href?.startsWith("#/admin/catalog/preview?product="))).toEqual([]);
    expect(within(page).getByText("Reviews aren't part of this preview.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to product" }).getAttribute("href")).toBe("#/admin/catalog/products?product=prod-hidden");
    expect(mocks.getProduct).not.toHaveBeenCalled();
    expect(mocks.addToCart).not.toHaveBeenCalled();
    expect(mocks.toggleWish).not.toHaveBeenCalled();
  });

  it("says a visible product is live, and why a visible product in a hidden category is not", () => {
    const live = open("/admin/catalog/preview?product=prod-linen-shirt");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Preview of the live product");
    expect(screen.getByText(/^Visible to shoppers\./)).toBeTruthy();
    live.unmount();
    mocks.snapshot = staffCatalog(["cat-men"]);
    open("/admin/catalog/preview?product=prod-linen-shirt");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Preview: shoppers can't see this product");
    expect(screen.getByText(/^Its category, Men, is hidden\./)).toBeTruthy();
    // The hidden category still renders in the trail, as text.
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toContain("Men");
  });

  it("goes back to the editor it was opened from, keeping that list's filters", async () => {
    open("/admin/catalog/products?status=hidden&product=prod-hidden");
    act(() => navigate("/admin/catalog/preview?product=prod-hidden"));
    await waitFor(() => expect(screen.getByRole("link", { name: "Back to product" }).getAttribute("href"))
      .toBe("#/admin/catalog/products?status=hidden&product=prod-hidden"));
  });

  it("sends an unknown, malformed or missing product id to the products list, which says it wasn't found", async () => {
    function NoticeProbe() {
      return <p data-testid="notice">{useCarriedNotice()}</p>;
    }
    /** The preview where the address points at one, as the shell's router does (a new preview for each product). */
    function Place() {
      const route = useRoute();
      return route.startsWith("/admin/catalog/preview") ? <ProductPreview key={route} heading={{ current: null }} /> : null;
    }
    window.history.replaceState(null, "", "#/admin/catalog/stock");
    render(<CarriedNoticeProvider><Place /><NoticeProbe /></CarriedNoticeProvider>);
    // One after another, as typed addresses: each lands on the list with the notice, never left on the preview.
    for (const route of ["/admin/catalog/preview?product=prod-missing", "/admin/catalog/preview?product=%3Cimg%3E", "/admin/catalog/preview", "/admin/catalog/preview?product=new"]) {
      act(() => navigate(route, { replace: true }));
      await waitFor(() => expect(window.location.hash, route).toBe("#/admin/catalog/products"));
      expect(screen.getByTestId("notice").textContent, route).toBe("That product wasn't found.");
    }
    // Moving on ends the notice.
    act(() => navigate("/admin/catalog/stock", { replace: true }));
    await waitFor(() => expect(screen.getByTestId("notice").textContent).toBe(""));
  });
});
