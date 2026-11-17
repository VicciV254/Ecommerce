import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogStock, StorefrontDraft } from "../../api/catalog";
import { buildCategoryTree } from "../../store/catalogModel";
import { fixtureSnapshot, fixtureStorefrontSettings } from "../../test-support/catalogFixtures";
import { CatalogManager } from "./CatalogManager";
import { CustomersManager } from "./CustomersManager";
import { DiscountManager } from "./DiscountManager";
import { StockManager } from "./StockManager";
import { StorefrontDraftProvider } from "./StorefrontDraft";
import { StorefrontManager } from "./StorefrontManager";

const api = vi.hoisted(() => ({
  catalog: {
    createDiscount: vi.fn(), updateDiscount: vi.fn(), deleteDiscount: vi.fn(),
    updateStock: vi.fn(), bulkUpdateStock: vi.fn(),
    createProduct: vi.fn(), updateProduct: vi.fn(), deleteProduct: vi.fn(),
    createCategory: vi.fn(), updateCategory: vi.fn(), deleteCategory: vi.fn(),
    createDesigner: vi.fn(), updateDesigner: vi.fn(), deleteDesigner: vi.fn(),
    getStorefrontDraft: vi.fn(), saveStorefrontDraft: vi.fn(), publishStorefront: vi.fn(), registerMedia: vi.fn(),
  },
  users: { getAll: vi.fn(), sendVerification: vi.fn(), sendVerificationBulk: vi.fn(), setDisabled: vi.fn(), delete: vi.fn() },
}));
vi.mock("../../api/catalog", async (importOriginal) => ({ ...await importOriginal<typeof import("../../api/catalog")>(), catalogAdminAPI: api.catalog }));
vi.mock("../../api/admin", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/admin")>(),
  adminAPI: { users: api.users },
}));

const snapshot = fixtureSnapshot({ mode: "admin" });
const stocks: CatalogStock[] = snapshot.products.flatMap((product) => product.variants.map((variant) => ({
  id: `stock-${variant.id}`, variantId: variant.id, sku: variant.sku, attributes: variant.attributes,
  productId: product.id, productName: product.name, categoryId: product.categoryId, isDemo: product.isDemo,
  quantity: variant.onHand, reserved: variant.reserved, available: variant.stock,
  maxStock: variant.maxStock, minThreshold: variant.minThreshold, status: "IN_STOCK" as const,
})));
vi.mock("./AdminCatalogContext", () => ({
  useAdminCatalog: () => ({
    status: "ready", data: { snapshot, stocks }, categories: buildCategoryTree(snapshot.categories),
    error: null, sessionExpired: false, refreshing: false, reload: vi.fn(),
  }),
}));
vi.mock("../../store/StorefrontContext", () => ({ useStorefront: () => ({ mediaById: new Map(), reload: vi.fn() }) }));
vi.mock("../../store/StoreContext", () => ({ useStore: () => ({ state: { wishlist: [] }, addToCart: vi.fn(), toggleWish: vi.fn() }) }));
vi.mock("../../store/CatalogContext", () => ({ useCatalog: () => ({ mode: "live" }) }));
vi.mock("../../contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

/** Controls that would change something; a read-only screen renders none of them. Case-insensitive, so a relabel cannot hide one. */
const WRITE_ACTIONS = /^(Add|Add product|Save|Save product|Save draft|Save category|Save designer|Restock to max|Subtract|Create discount|Stop discount|Delete( .+)?|Edit|\+ ?Sub|\+ Department|\+ Designer|Hide|Show|Publish|Discard changes|Reload draft|Send verification to (selected|\d+ selected)|(Verify|Disable|Enable)( .+)?|Upload images|\+ Image URL|Remove.*|\+ .*)$/i;

function expectReadOnly(scope: HTMLElement = document.body) {
  expect(within(scope).queryAllByRole("button").map((button) => button.textContent?.trim()).filter((name) => WRITE_ACTIONS.test(name ?? ""))).toEqual([]);
  expect(within(scope).queryAllByRole("spinbutton")).toEqual([]);
  expect(within(scope).queryAllByRole("checkbox")).toEqual([]);
  expect(within(scope).queryAllByRole("radio")).toEqual([]);
}

function noWrites() {
  const calls = [...Object.entries(api.catalog), ...Object.entries(api.users)]
    .filter(([name, fn]) => !["getStorefrontDraft", "getAll"].includes(name) && fn.mock.calls.length > 0)
    .map(([name]) => name);
  expect(calls).toEqual([]);
}

const draft: StorefrontDraft = {
  version: 5, publishedVersion: 3, publishedAt: null, settings: fixtureStorefrontSettings(), media: [], unavailableMediaIds: [],
};

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  for (const group of Object.values(api)) for (const fn of Object.values(group)) fn.mockReset();
  api.catalog.getStorefrontDraft.mockResolvedValue({ data: draft });
  api.users.getAll.mockResolvedValue({ data: { users: [{
    id: "user-1", email: "shopper@example.test", firstName: "Ada", lastName: "Shopper", emailVerified: false, isDisabled: false,
    createdAt: "2026-11-01T00:00:00Z", _count: { orders: 2, addresses: 1, wishlist: 0 },
  }] } });
});

describe("view-only presentation for roles without writes", () => {
  it("stock: on-hand units as text, search and filters kept, no bulk change, save or restock", () => {
    render(<StockManager canWrite={false} showToast={vi.fn()} />);
    expect(screen.getByText("View only: your role can see stock levels but cannot change them.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search stock"), { target: { value: "Polo" } });
    fireEvent.change(screen.getByLabelText("Filter stock by status"), { target: { value: "IN_STOCK" } });
    const row = screen.getByText("VAR-POLO").closest("tr")!;
    // The On hand column holds the number itself, not a field.
    expect(row.querySelectorAll("td")[1].textContent).toBe(String(stocks.find((stock) => stock.sku === "VAR-POLO")!.quantity));
    expect(screen.queryByLabelText("Bulk quantity")).toBeNull();
    expectReadOnly();
    noWrites();
  });

  it("discounts: current discounts as text, with no create form, edit fields or stop", () => {
    render(<DiscountManager canWrite={false} showToast={vi.fn()} />);
    expect(screen.getByText("View only: your role can see discounts and when they apply but cannot change them.")).toBeTruthy();
    expect(screen.getByText("Linen promotion")).toBeTruthy();
    expect(screen.queryByText(/^Create discount$/i)).toBeNull();
    expect(screen.queryAllByRole("textbox")).toEqual([]);
    expectReadOnly();
    noWrites();
  });

  it("customers: the list, search and filters, with no selection or account actions", async () => {
    render(<CustomersManager canWrite={false} showToast={vi.fn()} />);
    expect(await screen.findByText("shopper@example.test")).toBeTruthy();
    expect(screen.getByText("View only: your role can see customer accounts but cannot change them.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search users"), { target: { value: "ada" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByLabelText("Filter by verification"), { target: { value: "false" } });
    await waitFor(() => expect(api.users.getAll).toHaveBeenCalledWith(expect.objectContaining({ q: "ada" })));
    expectReadOnly();
    noWrites();
  });

  it("storefront editor: the draft as text and its preview link, with no save, publish or discard", async () => {
    render(<StorefrontDraftProvider canWrite={false} showToast={vi.fn()}><StorefrontManager canWrite={false} /></StorefrontDraftProvider>);
    expect(await screen.findByText("View only: your role can see the storefront draft and its preview but cannot change them.")).toBeTruthy();
    expect(screen.getByText("Store name")).toBeTruthy();
    expect(screen.getAllByText(draft.settings.brand.name).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Draft preview" }).getAttribute("href")).toBe("#/admin/storefront/preview");
    expect(screen.queryAllByRole("textbox")).toEqual([]);
    expect(screen.queryAllByRole("combobox")).toEqual([]);
    expectReadOnly();
    noWrites();
  });

  it("products: read-only rows and product details; adding is not available", async () => {
    window.history.replaceState(null, "", "#/admin/catalog/products?product=new");
    render(<CatalogManager canWrite={false} showToast={vi.fn()} />);
    expect(await screen.findByText("Adding products is not available for your role.")).toBeTruthy();
    expect(window.location.hash).toBe("#/admin/catalog/products");
    expect(screen.getByText("View only: your role can see products, categories and designers but cannot change them.")).toBeTruthy();
    expectReadOnly();
    fireEvent.change(screen.getByRole("textbox", { name: "Search products" }), { target: { value: "linen" } });

    fireEvent.click(screen.getByRole("button", { name: "View Linen Short-Sleeve Shirt" }));
    const details = await screen.findByRole("dialog", { name: "Product details" });
    expect(within(details).getByText("View only: your role can see this product but cannot change it.")).toBeTruthy();
    expect(within(details).getByText("View only: your role can see these images but cannot change them.")).toBeTruthy();
    expect(within(details).getByRole("region", { name: "Variants" })).toBeTruthy();
    expect(within(details).queryAllByRole("textbox")).toEqual([]);
    expectReadOnly(details);
    fireEvent.click(within(details).getByRole("button", { name: "Close product details" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Product details" })).toBeNull());
    noWrites();
  });
});
