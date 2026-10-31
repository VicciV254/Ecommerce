import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogProduct, CatalogStock, StorefrontDraft } from "../../api/catalog";
import { buildCategoryTree, productPriceView, variantPriceView } from "../../store/catalogModel";
import type { CatalogValue } from "../../store/CatalogContext";
import { fixtureImage, fixtureSnapshot, fixtureStorefrontSettings } from "../../test-support/catalogFixtures";
import { DiscountManager } from "./DiscountManager";
import { StockManager } from "./StockManager";
import { StorefrontManager } from "./StorefrontManager";

const NOW = new Date("2026-10-31T12:00:00.000Z");
const admin = vi.hoisted(() => ({
  reload: vi.fn(),
  api: {
    createDiscount: vi.fn(),
    updateDiscount: vi.fn(),
    bulkUpdateStock: vi.fn(),
    getStorefrontDraft: vi.fn(),
    saveStorefrontDraft: vi.fn(),
    publishStorefront: vi.fn(),
  },
  catalog: null as CatalogValue | null,
}));

const snapshot = fixtureSnapshot({ mode: "admin" });
const stocks: CatalogStock[] = snapshot.products.flatMap((product) => product.variants.map((variant) => ({
  id: `stock-${variant.id}`, variantId: variant.id, sku: variant.sku, attributes: variant.attributes,
  productId: product.id, productName: product.name, categoryId: product.categoryId, isDemo: product.isDemo,
  quantity: variant.stock, maxStock: variant.maxStock, minThreshold: variant.minThreshold, status: "IN_STOCK" as const,
})));

vi.mock("./AdminCatalogContext", () => ({
  useAdminCatalog: () => ({
    status: "ready", data: { snapshot, stocks }, categories: buildCategoryTree(snapshot.categories),
    error: null, sessionExpired: false, refreshing: false, reload: admin.reload,
  }),
}));
vi.mock("../../api/catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/catalog")>();
  return { ...actual, catalogAdminAPI: admin.api };
});
vi.mock("../../store/StorefrontContext", () => ({ useStorefront: () => ({ mediaById: new Map(), reload: vi.fn() }) }));
vi.mock("../../store/CatalogContext", () => ({ useCatalog: () => admin.catalog }));
vi.mock("../../store/StoreContext", () => ({ useStore: () => ({ state: { wishlist: [] }, addToCart: vi.fn(), toggleWish: vi.fn() }) }));
vi.mock("../../contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

function publicCatalog(products: CatalogProduct[]): CatalogValue {
  return {
    status: "ready", error: null, mode: "live", products,
    productsById: new Map(products.map((product) => [product.id, product])),
    categories: buildCategoryTree(snapshot.categories), designers: [], discounts: [], reload: vi.fn(),
    priceOf: (product) => productPriceView(product, [], NOW),
    priceOfVariant: (product, variant) => variantPriceView(product, variant, [], NOW),
  };
}

function conflict() {
  return new AxiosError("Conflict", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 409, statusText: "Conflict", data: { error: "The storefront changed. Reload before saving your draft." },
    headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() },
  });
}

const draft: StorefrontDraft = {
  version: 5, publishedVersion: 3, publishedAt: null, settings: fixtureStorefrontSettings(), media: [], unavailableMediaIds: [],
};

/** A saved campaign whose artwork is standalone media that has never been published. */
const standalone = fixtureImage({ id: "media-standalone", url: "https://media.example.test/standalone-hero.jpg", alt: "" });
function campaignDraft(desktopMediaId: string, overrides: Partial<StorefrontDraft> = {}): StorefrontDraft {
  return {
    ...draft,
    settings: fixtureStorefrontSettings({
      sections: [{ id: "hero", type: "campaign", title: "Hero", enabled: true, productIds: [], categoryIds: [], campaignId: "launch" }],
      campaigns: [{
        id: "launch", title: "Launch week", body: "", conditions: "", cta: { label: "Shop now", target: "shop", targetId: null },
        desktopMediaId, mobileMediaId: null, desktopFocal: { x: 50, y: 50 }, mobileFocal: { x: 20, y: 80 }, layout: "overlay",
      }],
    }),
    ...overrides,
  };
}

beforeEach(() => {
  admin.reload.mockReset();
  for (const fn of Object.values(admin.api)) fn.mockReset();
  admin.catalog = publicCatalog(fixtureSnapshot().products);
});

describe("admin catalog panels", () => {
  it("creates a percentage discount for a category with inclusive local dates", async () => {
    admin.api.createDiscount.mockResolvedValue({ data: {} });
    render(<DiscountManager showToast={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Category (includes its sub-categories)"), { target: { value: "cat-men" } });
    fireEvent.click(screen.getByRole("button", { name: "15%" }));
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText("End (inclusive)"), { target: { value: "2026-11-07" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Discount" }));
    const dialog = screen.getByRole("dialog", { name: "Create this discount?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Discount" }));
    await waitFor(() => expect(admin.reload).toHaveBeenCalled());
    expect(admin.api.createDiscount).toHaveBeenCalledWith({
      name: "Men sale", type: "PERCENTAGE", value: 15, applyTo: "CATEGORY", targetIds: ["cat-men"],
      startDate: new Date(2026, 10, 1, 0, 0, 0, 0).toISOString(),
      endDate: new Date(2026, 10, 7, 23, 59, 59, 999).toISOString(),
      isActive: true,
    });
    expect(screen.getByText("Demo: demo products only")).toBeTruthy();
  });

  it("clears an end date explicitly and never offers demo products as live discount targets", async () => {
    admin.api.updateDiscount.mockResolvedValue({ data: {} });
    render(<DiscountManager showToast={vi.fn()} />);
    fireEvent.change(screen.getAllByLabelText("End date")[0], { target: { value: "" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
    await waitFor(() => expect(admin.reload).toHaveBeenCalled());
    expect(admin.api.updateDiscount).toHaveBeenCalledWith("disc-linen", expect.objectContaining({ value: 10, endDate: null }));

    fireEvent.click(screen.getByRole("button", { name: "Products" }));
    expect(screen.getByRole("checkbox", { name: /Cotton Polo Shirt/ })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /Demo Smartphone/ })).toBeNull();
  });

  it("applies bulk stock changes atomically and reports a failed batch", async () => {
    admin.api.bulkUpdateStock.mockRejectedValue(new AxiosError("Offline", "ERR_NETWORK"));
    render(<StockManager showToast={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search stock"), { target: { value: "Linen" } });
    fireEvent.change(screen.getByLabelText("Bulk quantity"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Apply bulk stock change?" })).getByRole("button", { name: "Apply" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent",
      "Could not reach the server. Check your connection and try again. 0 of 3 SKUs were saved before the failure; the failed batch was not applied.");
    expect(admin.api.bulkUpdateStock).toHaveBeenCalledWith([
      { variantId: "var-linen-s-white", quantity: 9 },
      { variantId: "var-linen-m-white", quantity: 7 },
      { variantId: "var-linen-m-blue", quantity: 5 },
    ]);
    expect(admin.reload).toHaveBeenCalled();
  });

  it("keeps drafts private, blocks publishing unsaved edits and recovers from a stale save", async () => {
    admin.api.getStorefrontDraft.mockResolvedValue({ data: draft });
    admin.api.saveStorefrontDraft.mockRejectedValue(conflict());
    const onDirtyChange = vi.fn();
    render(<StorefrontManager showToast={vi.fn()} onDirtyChange={onDirtyChange} />);
    const name = await screen.findByLabelText("Store name");
    fireEvent.change(name, { target: { value: "Apex Cart Draft" } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("button", { name: "Publish" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Preview Draft" }));
    expect(within(screen.getByRole("region", { name: "Draft preview" })).getByText("Apex Cart Draft")).toBeTruthy();
    expect(document.documentElement.style.getPropertyValue("--color-brand-primary")).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    expect(await screen.findByText("The storefront changed. Reload before saving your draft.")).toBeTruthy();
    expect(admin.api.saveStorefrontDraft).toHaveBeenCalledWith(5, expect.objectContaining({ brand: expect.objectContaining({ name: "Apex Cart Draft" }) }));
    expect(admin.api.publishStorefront).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reload the latest draft" }));
    await waitFor(() => expect(admin.api.getStorefrontDraft).toHaveBeenCalledTimes(2));
    expect(await screen.findByDisplayValue("Apex Cart")).toBeTruthy();
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it("previews a reloaded draft through its authenticated media, including unpublished standalone images", async () => {
    admin.api.getStorefrontDraft.mockResolvedValue({ data: campaignDraft(standalone.id, { media: [standalone] }) });
    render(<StorefrontManager showToast={vi.fn()} onDirtyChange={vi.fn()} />);
    await screen.findByLabelText("Store name");
    expect(screen.queryByText("Unavailable media references")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Preview Draft" }));
    const preview = screen.getByRole("region", { name: "Draft preview" });
    const image = preview.querySelector<HTMLImageElement>("picture img")!;
    expect(image.getAttribute("src")).toBe(standalone.url);
    expect(image.style.getPropertyValue("--focal-mobile")).toBe("20% 80%");
    expect(within(preview).queryByText(/is unavailable/)).toBeNull();
    expect(screen.getByLabelText<HTMLSelectElement>("Desktop image").value).toBe(standalone.id);
    expect(screen.getByRole("spinbutton", { name: "Mobile focal point horizontal" }).hasAttribute("disabled")).toBe(false);
  });

  it("keeps unavailable media references visible for repair and blocks saving until replaced", async () => {
    admin.api.getStorefrontDraft.mockResolvedValue({ data: campaignDraft("media-missing", { media: [standalone], unavailableMediaIds: ["media-missing"] }) });
    admin.api.saveStorefrontDraft.mockImplementation((version: number, settings: StorefrontDraft["settings"]) =>
      Promise.resolve({ data: { ...draft, version: version + 1, settings, media: [standalone], unavailableMediaIds: [] } }));
    render(<StorefrontManager showToast={vi.fn()} onDirtyChange={vi.fn()} />);
    await screen.findByLabelText("Store name");
    const notice = screen.getByText("Unavailable media references").parentElement!;
    expect(within(notice).getByText('Campaign "Launch week" desktop image: media-missing')).toBeTruthy();
    const desktop = screen.getByLabelText<HTMLSelectElement>("Desktop image");
    expect(desktop.value).toBe("media-missing");
    expect(within(desktop).getByRole("option", { name: "Unavailable media media-missing" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Store name"), { target: { value: "Apex Cart Repair" } });
    expect(screen.getByText('Campaign "Launch week" desktop image (media-missing) is unavailable; choose another image.')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save Draft" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(desktop, { target: { value: standalone.id } });
    expect(screen.queryByText("Unavailable media references")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(admin.api.saveStorefrontDraft).toHaveBeenCalledTimes(1));
    expect(admin.api.saveStorefrontDraft.mock.calls[0][1].campaigns[0].desktopMediaId).toBe(standalone.id);
    expect(await screen.findByText("Draft saved. Shoppers still see the published version.")).toBeTruthy();
  });

  it("refuses to save sections that would publish nothing", async () => {
    admin.api.getStorefrontDraft.mockResolvedValue({ data: draft });
    render(<StorefrontManager showToast={vi.fn()} onDirtyChange={vi.fn()} />);
    await screen.findByLabelText("Store name");
    fireEvent.click(screen.getByRole("button", { name: "+ products" }));
    expect(screen.getByText('"Selected products" needs at least one product.')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save Draft" }).hasAttribute("disabled")).toBe(true);
  });
});
