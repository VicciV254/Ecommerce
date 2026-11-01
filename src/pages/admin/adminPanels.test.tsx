import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogDiscount, CatalogProduct, CatalogStock, StorefrontDraft } from "../../api/catalog";
import { buildCategoryTree } from "../../store/catalogModel";
import type { CatalogValue } from "../../store/CatalogContext";
import { fixtureDiscounts, fixtureImage, fixtureSnapshot, fixtureStorefrontSettings } from "../../test-support/catalogFixtures";
import { DiscountManager } from "./DiscountManager";
import { StockManager } from "./StockManager";
import { StorefrontManager } from "./StorefrontManager";

const admin = vi.hoisted(() => ({
  reload: vi.fn(),
  api: {
    createDiscount: vi.fn(),
    updateDiscount: vi.fn(),
    deleteDiscount: vi.fn(),
    bulkUpdateStock: vi.fn(),
    updateStock: vi.fn(),
    getStorefrontDraft: vi.fn(),
    saveStorefrontDraft: vi.fn(),
    publishStorefront: vi.fn(),
  },
  catalog: null as CatalogValue | null,
}));

/** Staff snapshots include coupon-only discounts, which public snapshots omit. */
const couponDiscount: CatalogDiscount = { ...fixtureDiscounts[0], id: "disc-coupon", name: "Linen coupon", value: 15, couponCode: "LINEN15" };
const fixedDiscount: CatalogDiscount = { ...couponDiscount, id: "disc-fixed", name: "Fixed coupon", type: "FIXED", value: 150.25, couponCode: "FIXED150" };
const snapshot = { ...fixtureSnapshot({ mode: "admin" }), discounts: [...fixtureDiscounts, couponDiscount, fixedDiscount] };
const stocks: CatalogStock[] = snapshot.products.flatMap((product) => product.variants.map((variant) => ({
  id: `stock-${variant.id}`, variantId: variant.id, sku: variant.sku, attributes: variant.attributes,
  productId: product.id, productName: product.name, categoryId: product.categoryId, isDemo: product.isDemo,
  quantity: variant.onHand, reserved: variant.reserved, available: variant.stock,
  maxStock: variant.maxStock, minThreshold: variant.minThreshold, status: "IN_STOCK" as const,
}))).map((row) => (row.variantId === "var-polo" ? { ...row, quantity: 14, reserved: 2 } : row));

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

  it("creates a coupon-only discount with the normalized code and keeps codes when editing", async () => {
    admin.api.createDiscount.mockResolvedValue({ data: {} });
    admin.api.updateDiscount.mockResolvedValue({ data: {} });
    render(<DiscountManager showToast={vi.fn()} />);
    const code = screen.getByLabelText("Coupon code (optional)");
    fireEvent.change(code, { target: { value: "bad code" } });
    expect(screen.getByRole("alert").textContent).toBe("Use 3–40 letters, numbers, hyphens or underscores.");
    expect(screen.getByRole("button", { name: "Create Discount" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(code, { target: { value: " linen-20 " } });
    fireEvent.click(screen.getByRole("button", { name: "Create Discount" }));
    const dialog = screen.getByRole("dialog", { name: "Create this discount?" });
    expect(within(dialog).getByText(/applies only to checkout quotes that enter the code/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Discount" }));
    await waitFor(() => expect(admin.reload).toHaveBeenCalled());
    expect(admin.api.createDiscount).toHaveBeenCalledWith(expect.objectContaining({ type: "PERCENTAGE", value: 10, couponCode: "LINEN-20" }));

    const card = screen.getByText("Coupon LINEN15").closest("article")!;
    fireEvent.change(within(card).getByLabelText("Percentage"), { target: { value: "20" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(admin.api.updateDiscount).toHaveBeenCalledWith("disc-coupon", expect.objectContaining({ value: 20, couponCode: "LINEN15" })));
  });

  it("edits on-hand stock, shows reserved and available units and never goes below reserved", async () => {
    admin.api.bulkUpdateStock.mockResolvedValue({ data: { stocks: [], updated: 1 } });
    render(<StockManager showToast={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search stock"), { target: { value: "Polo" } });
    const row = screen.getByText("VAR-POLO").closest("tr")!;
    expect(within(row).getByText("2")).toBeTruthy();
    expect(within(row).getByText("12")).toBeTruthy();
    fireEvent.change(within(row).getByLabelText("On-hand quantity for VAR-POLO"), { target: { value: "1" } });
    expect(within(row).getByText("Whole number, at least 2")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Bulk quantity"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Subtract" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Apply bulk stock change?" })).getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(admin.api.bulkUpdateStock).toHaveBeenCalledWith([{ variantId: "var-polo", quantity: 2 }]));
    expect(admin.api.updateStock).not.toHaveBeenCalled();
  });

  it("creates fixed coupons in cents and explains their once-per-basket scope", async () => {
    admin.api.createDiscount.mockResolvedValue({ data: {} });
    render(<DiscountManager showToast={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Fixed amount" }));
    fireEvent.change(screen.getByLabelText("Fixed amount (KES)"), { target: { value: "150.25" } });
    fireEvent.change(screen.getByLabelText("Coupon code (optional)"), { target: { value: "save150" } });
    expect(screen.getByText(/deducted once from eligible merchandise/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create Discount" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Create this discount?" })).getByRole("button", { name: "Create Discount" }));
    await waitFor(() => expect(admin.api.createDiscount).toHaveBeenCalledWith(expect.objectContaining({
      type: "FIXED", value: 150.25, couponCode: "SAVE150",
    })));
  });

  it("edits and stops existing fixed discounts without changing their coupon identity", async () => {
    admin.api.updateDiscount.mockResolvedValue({ data: {} });
    admin.api.deleteDiscount.mockResolvedValue({ data: {} });
    render(<DiscountManager showToast={vi.fn()} />);
    const card = screen.getByText("Coupon FIXED150").closest("article")!;
    fireEvent.change(within(card).getByLabelText("Amount (KES)"), { target: { value: "250.75" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(admin.api.updateDiscount).toHaveBeenCalledWith("disc-fixed", expect.objectContaining({
      type: "FIXED", value: 250.75, couponCode: "FIXED150",
    })));
    await waitFor(() => expect(within(card).getByRole("button", { name: "Stop Discount" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(within(card).getByRole("button", { name: "Stop Discount" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Stop this discount?" })).getByRole("button", { name: "Stop Discount" }));
    await waitFor(() => expect(admin.api.deleteDiscount).toHaveBeenCalledWith("disc-fixed"));
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
