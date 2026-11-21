import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogDiscount, CatalogProduct, CatalogStock, StorefrontDraft } from "../../api/catalog";
import { buildCategoryTree } from "../../store/catalogModel";
import type { CatalogValue } from "../../store/CatalogContext";
import { fixtureDiscounts, fixtureImage, fixtureSnapshot, fixtureStorefrontSettings } from "../../test-support/catalogFixtures";
import { useRoute } from "../../router";
import { ADMIN_PREVIEW_ROUTE } from "./adminRoutes";
import { DiscountManager } from "./DiscountManager";
import { StockManager } from "./StockManager";
import { StorefrontDraftProvider } from "./StorefrontDraft";
import { StorefrontManager } from "./StorefrontManager";
import { StorefrontPreview } from "./StorefrontPreview";
import { PREVIEW_MESSAGES } from "./storefrontPreviewModel";
import { UnsavedChangesProvider } from "./unsavedChanges";

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
    categories: buildCategoryTree(snapshot.categories), designers: [], discounts: [], returnPolicy: snapshot.returnPolicy, delivery: snapshot.delivery, demonstrationOrders: false, sampleOrderRetentionDays: null, reload: vi.fn(),
  };
}

function conflict() {
  return new AxiosError("Conflict", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 409, statusText: "Conflict", data: { error: "The storefront changed. Reload before saving your draft." },
    headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() },
  });
}

const draft: StorefrontDraft = {
  version: 5, publishedVersion: 3, publishedAt: null, publishedBy: null, settings: fixtureStorefrontSettings(), media: [], unavailableMediaIds: [],
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

/** The Storefront group as the shell mounts it: one draft shared by the editor and its preview route. */
function StorefrontRoutes() {
  const route = useRoute();
  const heading = useRef<HTMLHeadingElement>(null);
  return route.startsWith(ADMIN_PREVIEW_ROUTE) ? <StorefrontPreview heading={heading} /> : <StorefrontManager canWrite />;
}

function renderStorefront() {
  return render(
    <UnsavedChangesProvider>
      <StorefrontDraftProvider canWrite showToast={vi.fn()}>
        <StorefrontRoutes />
      </StorefrontDraftProvider>
    </UnsavedChangesProvider>,
  );
}

/** Whether the shell's guard currently holds unsaved edits: it then asks before the page unloads. */
function unloadPrevented() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/** Has the preview's frame report ready, and returns what the preview posts to it. */
function frameReady(element: HTMLElement) {
  const frame = (element as HTMLIFrameElement).contentWindow!;
  const sent = vi.spyOn(frame, "postMessage");
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { type: PREVIEW_MESSAGES.ready }, origin: window.location.origin, source: frame }));
  });
  return sent;
}

beforeEach(() => {
  window.history.replaceState(null, "", "#/admin/storefront/editor");
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  admin.reload.mockReset();
  for (const fn of Object.values(admin.api)) fn.mockReset();
  admin.catalog = publicCatalog(fixtureSnapshot().products);
});

describe("admin catalog panels", () => {
  it("creates a percentage discount for a category with inclusive local dates", async () => {
    admin.api.createDiscount.mockResolvedValue({ data: {} });
    render(<DiscountManager canWrite showToast={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Category (includes its sub-categories)"), { target: { value: "cat-men" } });
    fireEvent.click(screen.getByRole("button", { name: "15%" }));
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText("End (inclusive)"), { target: { value: "2026-11-07" } });
    fireEvent.click(screen.getByRole("button", { name: "Create discount" }));
    const dialog = screen.getByRole("dialog", { name: "Create this discount?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create discount" }));
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
    render(<DiscountManager canWrite showToast={vi.fn()} />);
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
    render(<DiscountManager canWrite showToast={vi.fn()} />);
    const code = screen.getByLabelText("Coupon code (optional)");
    fireEvent.change(code, { target: { value: "bad code" } });
    expect(screen.getByRole("alert").textContent).toBe("Use 3–40 letters, numbers, hyphens or underscores.");
    expect(screen.getByRole("button", { name: "Create discount" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(code, { target: { value: " linen-20 " } });
    fireEvent.click(screen.getByRole("button", { name: "Create discount" }));
    const dialog = screen.getByRole("dialog", { name: "Create this discount?" });
    expect(within(dialog).getByText(/applies only to checkout quotes that enter the code/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Create discount" }));
    await waitFor(() => expect(admin.reload).toHaveBeenCalled());
    expect(admin.api.createDiscount).toHaveBeenCalledWith(expect.objectContaining({ type: "PERCENTAGE", value: 10, couponCode: "LINEN-20" }));

    const card = screen.getByText("Coupon LINEN15").closest("article")!;
    fireEvent.change(within(card).getByLabelText("Percentage"), { target: { value: "20" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(admin.api.updateDiscount).toHaveBeenCalledWith("disc-coupon", expect.objectContaining({ value: 20, couponCode: "LINEN15" })));
  });

  it("edits on-hand stock, shows reserved and available units and never goes below reserved", async () => {
    admin.api.bulkUpdateStock.mockResolvedValue({ data: { stocks: [], updated: 1 } });
    render(<StockManager canWrite showToast={vi.fn()} />);
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

  it("keeps the stock status and category in the address, changing them with a replace", () => {
    window.history.replaceState(null, "", "#/admin/catalog/stock?status=OUT_OF_STOCK&category=cat-men");
    const entries = window.history.length;
    render(<StockManager canWrite={false} showToast={vi.fn()} />);
    expect((screen.getByLabelText("Filter stock by status") as HTMLSelectElement).value).toBe("OUT_OF_STOCK");
    expect((screen.getByLabelText("Filter stock by category") as HTMLSelectElement).value).toBe("cat-men");
    expect(screen.getByText("No SKUs match these filters.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Filter stock by status"), { target: { value: "IN_STOCK" } });
    expect(window.location.hash).toBe("#/admin/catalog/stock?status=IN_STOCK&category=cat-men");
    expect(screen.getByText("VAR-POLO")).toBeTruthy();
    expect(screen.queryByText("VAR-DEMO-PHONE")).toBeNull();
    fireEvent.change(screen.getByLabelText("Filter stock by category"), { target: { value: "" } });
    expect(window.location.hash).toBe("#/admin/catalog/stock?status=IN_STOCK");
    expect(screen.getByText("VAR-DEMO-PHONE")).toBeTruthy();
    expect(window.history.length).toBe(entries);
  });

  it("drops an unknown stock status or category from the address in place", async () => {
    window.history.replaceState(null, "", "#/admin/catalog/stock?status=LOW&category=cat-missing");
    const entries = window.history.length;
    render(<StockManager canWrite={false} showToast={vi.fn()} />);
    await waitFor(() => expect(window.location.hash).toBe("#/admin/catalog/stock"));
    expect(window.history.length).toBe(entries);
    expect(screen.getByText("VAR-POLO")).toBeTruthy();
    expect((screen.getByLabelText("Filter stock by category") as HTMLSelectElement).value).toBe("");
  });

  it("creates fixed coupons in cents and explains their once-per-basket scope", async () => {
    admin.api.createDiscount.mockResolvedValue({ data: {} });
    render(<DiscountManager canWrite showToast={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Fixed amount" }));
    fireEvent.change(screen.getByLabelText("Fixed amount (KES)"), { target: { value: "150.25" } });
    fireEvent.change(screen.getByLabelText("Coupon code (optional)"), { target: { value: "save150" } });
    expect(screen.getByText(/deducted once from eligible merchandise/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create discount" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Create this discount?" })).getByRole("button", { name: "Create discount" }));
    await waitFor(() => expect(admin.api.createDiscount).toHaveBeenCalledWith(expect.objectContaining({
      type: "FIXED", value: 150.25, couponCode: "SAVE150",
    })));
  });

  it("edits and stops existing fixed discounts without changing their coupon identity", async () => {
    admin.api.updateDiscount.mockResolvedValue({ data: {} });
    admin.api.deleteDiscount.mockResolvedValue({ data: {} });
    render(<DiscountManager canWrite showToast={vi.fn()} />);
    const card = screen.getByText("Coupon FIXED150").closest("article")!;
    fireEvent.change(within(card).getByLabelText("Amount (KES)"), { target: { value: "250.75" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(admin.api.updateDiscount).toHaveBeenCalledWith("disc-fixed", expect.objectContaining({
      type: "FIXED", value: 250.75, couponCode: "FIXED150",
    })));
    await waitFor(() => expect(within(card).getByRole("button", { name: "Stop discount" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(within(card).getByRole("button", { name: "Stop discount" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Stop this discount?" })).getByRole("button", { name: "Stop discount" }));
    await waitFor(() => expect(admin.api.deleteDiscount).toHaveBeenCalledWith("disc-fixed"));
  });

  it("applies bulk stock changes atomically and reports a failed batch", async () => {
    admin.api.bulkUpdateStock.mockRejectedValue(new AxiosError("Offline", "ERR_NETWORK"));
    render(<StockManager canWrite showToast={vi.fn()} />);
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
    renderStorefront();
    const name = await screen.findByLabelText("Store name");
    fireEvent.change(name, { target: { value: "Apex Cart Draft" } });
    expect(unloadPrevented()).toBe(true);
    expect(screen.getByRole("button", { name: "Publish" }).hasAttribute("disabled")).toBe(true);

    // The preview is its own route: it posts the unsaved edit to its frame, and returning keeps it.
    fireEvent.click(screen.getByRole("link", { name: "Draft preview" }));
    const sent = frameReady(await screen.findByTitle("Storefront draft at phone width (390 px)"));
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenCalledWith(
      expect.objectContaining({ type: PREVIEW_MESSAGES.draft, settings: expect.objectContaining({ brand: expect.objectContaining({ name: "Apex Cart Draft" }) }) }),
      window.location.origin,
    );
    expect(document.documentElement.style.getPropertyValue("--color-brand-primary")).toBe("");
    fireEvent.click(screen.getByRole("link", { name: "Back to editor" }));
    expect((await screen.findByLabelText<HTMLInputElement>("Store name")).value).toBe("Apex Cart Draft");

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("The storefront changed. Reload before saving your draft.")).toBeTruthy();
    expect(admin.api.saveStorefrontDraft).toHaveBeenCalledWith(5, expect.objectContaining({ brand: expect.objectContaining({ name: "Apex Cart Draft" }) }));
    expect(admin.api.publishStorefront).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reload the latest draft" }));
    await waitFor(() => expect(admin.api.getStorefrontDraft).toHaveBeenCalledTimes(2));
    expect(await screen.findByDisplayValue("Apex Cart")).toBeTruthy();
    await waitFor(() => expect(unloadPrevented()).toBe(false));
  });

  it("previews a reloaded draft through its authenticated media, including unpublished standalone images", async () => {
    admin.api.getStorefrontDraft.mockResolvedValue({ data: campaignDraft(standalone.id, { media: [standalone] }) });
    renderStorefront();
    await screen.findByLabelText("Store name");
    expect(screen.queryByText("Unavailable media references")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Draft preview" }));
    const sent = frameReady(await screen.findByTitle("Storefront draft at phone width (390 px)"));
    const [message] = sent.mock.calls[0];
    expect(message.settings.campaigns[0].desktopMediaId).toBe(standalone.id);
    expect(message.media).toContainEqual(standalone);
    expect(screen.queryByText(/Unavailable references/)).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Back to editor" }));
    expect((await screen.findByLabelText<HTMLSelectElement>("Desktop image")).value).toBe(standalone.id);
    expect(screen.getByRole("spinbutton", { name: "Mobile focal point horizontal" }).hasAttribute("disabled")).toBe(false);
  });

  it("keeps unavailable media references visible for repair and blocks saving until replaced", async () => {
    admin.api.getStorefrontDraft.mockResolvedValue({ data: campaignDraft("media-missing", { media: [standalone], unavailableMediaIds: ["media-missing"] }) });
    admin.api.saveStorefrontDraft.mockImplementation((version: number, settings: StorefrontDraft["settings"]) =>
      Promise.resolve({ data: { ...draft, version: version + 1, settings, media: [standalone], unavailableMediaIds: [] } }));
    renderStorefront();
    await screen.findByLabelText("Store name");
    const notice = screen.getByText("Unavailable media references").parentElement!;
    expect(within(notice).getByText('Campaign "Launch week" desktop image: media-missing')).toBeTruthy();
    const desktop = screen.getByLabelText<HTMLSelectElement>("Desktop image");
    expect(desktop.value).toBe("media-missing");
    expect(within(desktop).getByRole("option", { name: "Unavailable media media-missing" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Publish" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Store name"), { target: { value: "Apex Cart Repair" } });
    expect(screen.getByText('Campaign "Launch week" desktop image (media-missing) is unavailable; choose another image.')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save draft" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(desktop, { target: { value: standalone.id } });
    expect(screen.queryByText("Unavailable media references")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(admin.api.saveStorefrontDraft).toHaveBeenCalledTimes(1));
    expect(admin.api.saveStorefrontDraft.mock.calls[0][1].campaigns[0].desktopMediaId).toBe(standalone.id);
    expect(await screen.findByText("Draft saved. Shoppers still see the published version.")).toBeTruthy();
  });

  it("lists unavailable references in the preview banner and marks a preview that includes unsaved edits", async () => {
    admin.api.getStorefrontDraft.mockResolvedValue({ data: campaignDraft("media-missing", { media: [standalone], unavailableMediaIds: ["media-missing"] }) });
    renderStorefront();
    fireEvent.change(await screen.findByLabelText("Store name"), { target: { value: "Apex Cart Repair" } });
    fireEvent.click(screen.getByRole("link", { name: "Draft preview" }));
    const heading = await screen.findByRole("heading", { level: 1, name: "Draft preview: shoppers can't see this" });
    const banner = heading.closest("div.on-navy") as HTMLElement;
    expect(within(banner).getByText("Includes unsaved changes")).toBeTruthy();
    expect(within(banner).getByText('Campaign "Launch week" desktop image: media-missing')).toBeTruthy();
    expect(within(banner).getByRole("link", { name: "Back to editor" }).getAttribute("href")).toBe("#/admin/storefront/editor");
  });

  it("refuses to save sections that would publish nothing", async () => {
    admin.api.getStorefrontDraft.mockResolvedValue({ data: draft });
    renderStorefront();
    await screen.findByLabelText("Store name");
    fireEvent.click(screen.getByRole("button", { name: "+ products" }));
    expect(screen.getByText('"Selected products" needs at least one product.')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save draft" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("P8.7 storefront section kinds in the editor", () => {
  const cards = () => screen.getAllByRole("article");
  const kindOf = (card: HTMLElement) => card.querySelector("p")?.textContent;
  const heading = (card: HTMLElement) => within(card).getByRole<HTMLInputElement>("textbox", { name: "Heading" });
  const layout = (card: HTMLElement) => within(card).queryByRole<HTMLSelectElement>("combobox", { name: "Layout" });
  const search = (card: HTMLElement) => within(card).getByPlaceholderText<HTMLInputElement>("Search to add…");
  async function openEditor(settings = draft.settings) {
    admin.api.getStorefrontDraft.mockResolvedValue({ data: { ...draft, settings } });
    admin.api.saveStorefrontDraft.mockImplementation((version: number, saved: StorefrontDraft["settings"]) =>
      Promise.resolve({ data: { ...draft, version: version + 1, settings: saved } }));
    renderStorefront();
    await screen.findByLabelText("Store name");
  }
  const add = (label: string) => fireEvent.click(screen.getByRole("button", { name: `+ ${label}` }));

  it("adds a department row, shopping facts and best sellers; one shopping facts and one best sellers section at most", async () => {
    await openEditor();
    add("Department row");
    add("Shopping facts");
    add("Best sellers");
    expect(cards().map(kindOf)).toEqual(["1. Departments", "2. Featured products", "3. Department row", "4. Shopping facts", "5. Best sellers"]);
    for (const label of ["Shopping facts", "Best sellers"]) {
      expect(screen.getByRole("button", { name: `+ ${label}` }).hasAttribute("disabled"), label).toBe(true);
    }
    expect(screen.getByRole("button", { name: "+ Department row" }).hasAttribute("disabled")).toBe(false);
    // Removing the strip offers it again.
    fireEvent.click(within(cards()[3]).getByRole("button", { name: "Remove section 4" }));
    expect(screen.getByRole("button", { name: "+ Shopping facts" }).hasAttribute("disabled")).toBe(false);
  });

  it("a department row needs one department, and its heading follows the department until staff write their own", async () => {
    await openEditor();
    add("Department row");
    const row = cards()[2];
    expect(heading(row).value).toBe("Department row");
    expect(screen.getByText('"Department row" needs exactly one department.')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save draft" }).hasAttribute("disabled")).toBe(true);

    fireEvent.change(search(row), { target: { value: "shirts" } });
    fireEvent.click(within(row).getByRole("button", { name: "Fashion › Men › Shirts" }));
    expect(heading(row).value).toBe("Shirts");
    expect(screen.queryByText(/needs exactly one department/)).toBeNull();
    // One department at most: the search stays closed until it is removed.
    expect(search(row).disabled).toBe(true);
    fireEvent.click(within(row).getByRole("button", { name: "Remove Fashion › Men › Shirts" }));
    expect(heading(row).value).toBe("Department row");
    fireEvent.change(search(row), { target: { value: "phones" } });
    fireEvent.click(within(row).getByRole("button", { name: "Phones & Tablets" }));
    expect(heading(row).value).toBe("Phones & Tablets");

    fireEvent.change(heading(row), { target: { value: "Phones for every budget" } });
    fireEvent.click(within(row).getByRole("button", { name: "Remove Phones & Tablets" }));
    fireEvent.change(search(row), { target: { value: "fashion" } });
    fireEvent.click(within(row).getByRole("button", { name: "Fashion" }));
    expect(heading(row).value).toBe("Phones for every budget");

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(admin.api.saveStorefrontDraft).toHaveBeenCalledTimes(1));
    expect(admin.api.saveStorefrontDraft.mock.calls[0][1].sections[2]).toEqual({
      id: "department-row", type: "category", title: "Phones for every budget", enabled: false,
      productIds: [], categoryIds: ["cat-fashion"], campaignId: null,
    });
  });

  it("offers a layout only for departments, featured, selected products and department rows, saving the choice", async () => {
    await openEditor();
    add("Department row");
    add("Shopping facts");
    add("Best sellers");
    add("campaign");
    const [departments, featured, row, facts, best, campaign] = cards();
    expect([layout(departments)?.value, layout(featured)?.value, layout(row)?.value]).toEqual(["rail", "grid", "rail"]);
    expect(within(layout(departments)!).getAllByRole("option").map((option) => option.textContent)).toEqual(["Row you scroll", "Grid"]);
    expect([layout(facts), layout(best), layout(campaign)]).toEqual([null, null, null]);

    fireEvent.change(layout(departments)!, { target: { value: "grid" } });
    fireEvent.change(layout(featured)!, { target: { value: "rail" } });
    expect([layout(departments)!.value, layout(featured)!.value]).toEqual(["grid", "rail"]);
    // Only the changed sections carry a layout; the others keep their kind's default.
    fireEvent.click(within(row).getByRole("button", { name: "Remove section 3" }));
    fireEvent.click(within(cards()[4]).getByRole("button", { name: "Remove section 5" }));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(admin.api.saveStorefrontDraft).toHaveBeenCalledTimes(1));
    const sent = admin.api.saveStorefrontDraft.mock.calls[0][1].sections;
    expect(sent.map((item: { id: string; layout?: string }) => [item.id, item.layout])).toEqual([
      ["departments", "grid"], ["featured", "rail"], ["shopping-facts", undefined], ["best-sellers", undefined],
    ]);
  });

  it("keeps the best sellers heading fixed and explains when the row shows; the shopping facts heading stays editable", async () => {
    await openEditor();
    add("Best sellers");
    add("Shopping facts");
    const [best, facts] = cards().slice(2);
    expect(within(best).queryAllByRole("textbox")).toEqual([]);
    expect(within(best).getByText("Best sellers", { selector: "p" })).toBeTruthy();
    expect(within(best).getByText(
      "This heading is fixed because the row is measured: up to 12 products, ranked by paid orders in the last 30 days, each bought by at least 2 different accounts. Sample orders and sandbox payments never count. Shoppers don't see the row until at least 4 products qualify.",
    )).toBeTruthy();
    expect(within(best).queryByText(/can't claim a ranking/)).toBeNull();

    expect(heading(facts).value).toBe("How shopping works");
    expect(within(facts).getByText(
      "Shows four facts from the store's settings, each linking to its page: prices and VAT, delivery, payment and returns. The heading is read out by screen readers; it isn't shown.",
    )).toBeTruthy();
    fireEvent.change(heading(facts), { target: { value: "Shopping here" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(admin.api.saveStorefrontDraft).toHaveBeenCalledTimes(1));
    expect(admin.api.saveStorefrontDraft.mock.calls[0][1].sections.slice(2)).toEqual([
      { id: "best-sellers", type: "bestSellers", title: "Best sellers", enabled: false, productIds: [], categoryIds: [], campaignId: null },
      { id: "shopping-facts", type: "promises", title: "Shopping here", enabled: false, productIds: [], categoryIds: [], campaignId: null },
    ]);
  });

  it("still refuses a ranking claim in any other heading", async () => {
    await openEditor();
    fireEvent.change(heading(cards()[1]), { target: { value: "Best sellers" } });
    expect(within(cards()[1]).getByText(/headings can't claim a ranking/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save draft" }).hasAttribute("disabled")).toBe(true);
  });

  it("does not open a draft holding a section kind this version doesn't know, rather than dropping it", async () => {
    const later = { id: "stores", type: "stores", title: "Our sellers", enabled: true, productIds: [], categoryIds: [], campaignId: null };
    admin.api.getStorefrontDraft.mockResolvedValue({ data: { ...draft, settings: { ...draft.settings, sections: [...draft.settings.sections, later] } } });
    renderStorefront();
    expect(await screen.findByText("The storefront draft was not in the expected format.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
  });
});

describe("the hero carousel in the editor", () => {
  type Campaign = StorefrontDraft["settings"]["campaigns"][number];
  type Section = StorefrontDraft["settings"]["sections"][number];
  const campaign = (id: string, title: string): Campaign => ({
    id, title, body: "", conditions: "", cta: { label: "Shop now", target: "shop", targetId: null },
    desktopMediaId: null, mobileMediaId: null, desktopFocal: { x: 50, y: 50 }, mobileFocal: { x: 50, y: 50 }, layout: "overlay",
  });
  const campaigns = [
    campaign("week", "Fashion week"), campaign("season", "New season"), campaign("home", "Home refresh"),
    campaign("desk", "Desk set-up"), campaign("phones", "Phones month"), campaign("spare", "Spare offer"),
  ];
  const cards = () => screen.getAllByRole("article");
  const kindOf = (card: HTMLElement) => card.querySelector("p")?.textContent;
  const campaignCard = (id: string) => cards().find((card) => kindOf(card) === `Campaign “${id}”`)!;
  const removeCampaign = (id: string) => within(campaignCard(id)).getByRole<HTMLButtonElement>("button", { name: "Remove" });
  async function openEditor(settings = fixtureStorefrontSettings({ campaigns })) {
    admin.api.getStorefrontDraft.mockResolvedValue({ data: { ...draft, settings } });
    admin.api.saveStorefrontDraft.mockImplementation((version: number, saved: StorefrontDraft["settings"]) =>
      Promise.resolve({ data: { ...draft, version: version + 1, settings: saved } }));
    renderStorefront();
    await screen.findByLabelText("Store name");
  }
  const choose = (card: HTMLElement, term: string, name: string) => {
    fireEvent.change(within(card).getByPlaceholderText("Search to add…"), { target: { value: term } });
    fireEvent.click(within(card).getByRole("button", { name }));
  };

  it("adds one hidden carousel titled Highlights, lists up to five campaigns in the order chosen and saves them", async () => {
    await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "+ Hero carousel" }));
    expect(screen.getByRole("button", { name: "+ Hero carousel" }).hasAttribute("disabled")).toBe(true);
    const carousel = cards()[2];
    expect(kindOf(carousel)).toBe("3. Hero carousel");
    expect(within(carousel).getByRole<HTMLInputElement>("textbox", { name: "Heading" }).value).toBe("Highlights");
    expect(within(carousel).queryByRole("combobox", { name: "Layout" })).toBeNull();
    expect(within(carousel).getByText("Campaigns (0/5)")).toBeTruthy();
    expect(screen.getByText('"Highlights" needs 1 to 5 campaigns.')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save draft" }).hasAttribute("disabled")).toBe(true);

    choose(carousel, "week", "Fashion week");
    choose(carousel, "season", "New season");
    fireEvent.click(within(carousel).getByRole("button", { name: "Move New season up" }));
    for (const [term, name] of [["home", "Home refresh"], ["desk", "Desk set-up"], ["phones", "Phones month"]]) choose(carousel, term, name);
    expect(within(carousel).getByText("Campaigns (5/5)")).toBeTruthy();
    expect(within(carousel).getByPlaceholderText<HTMLInputElement>("Search to add…").disabled).toBe(true);
    expect(screen.queryByText(/needs 1 to 5 campaigns/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(admin.api.saveStorefrontDraft).toHaveBeenCalledTimes(1));
    const sent: Section[] = admin.api.saveStorefrontDraft.mock.calls[0][1].sections;
    expect(sent[2]).toEqual({
      id: "hero-carousel", type: "carousel", title: "Highlights", enabled: false, productIds: [], categoryIds: [], campaignId: null,
      campaignIds: ["season", "week", "home", "desk", "phones"],
    });
    // Every other section still carries no campaign list.
    expect(sent.slice(0, 2).map((section) => "campaignIds" in section)).toEqual([false, false]);
  });

  it("keeps a campaign while any section uses it, a carousel included, shown or not; once taken out it can be removed", async () => {
    const carouselSection: Section = {
      id: "hero-carousel", type: "carousel", title: "Highlights", enabled: false, productIds: [], categoryIds: [], campaignId: null,
      campaignIds: ["week", "season"],
    };
    const band: Section = { id: "band", type: "campaign", title: "Band", enabled: true, productIds: [], categoryIds: [], campaignId: "season" };
    await openEditor(fixtureStorefrontSettings({ sections: [carouselSection, band], campaigns: campaigns.slice(0, 3) }));
    // Only in the (hidden) carousel; in the carousel and a campaign section; in neither.
    expect(removeCampaign("week").disabled).toBe(true);
    expect(within(campaignCard("week")).getByText("Used by: Highlights. Take it out of those sections before deleting it.")).toBeTruthy();
    expect(removeCampaign("season").disabled).toBe(true);
    expect(within(campaignCard("season")).getByText("Used by: Highlights, Band. Take it out of those sections before deleting it.")).toBeTruthy();
    expect(removeCampaign("home").disabled).toBe(false);

    fireEvent.click(within(cards()[0]).getByRole("button", { name: "Remove Fashion week" }));
    expect(removeCampaign("week").disabled).toBe(false);
    fireEvent.click(removeCampaign("week"));
    expect(cards().some((card) => kindOf(card) === "Campaign “week”")).toBe(false);
    // The carousel keeps its other campaign.
    expect(within(cards()[0]).getByText("New season")).toBeTruthy();
  });
});
