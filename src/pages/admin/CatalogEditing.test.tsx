import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminCatalogSnapshot } from "../../api/catalog";
import {
  FIXTURE_VERSION,
  fixtureAdminSnapshot,
  fixtureCategories,
  fixtureCategory,
  fixtureImage,
  fixtureProduct,
  fixtureVariant,
  imagelessShirt,
  linenShirt,
  demoPhone,
  poloShirt,
  staffRecord,
} from "../../test-support/catalogFixtures";
import { CatalogManager } from "./CatalogManager";
import { CategoryForm } from "./CatalogForms";
import { ProductEditor } from "./ProductEditor";

/*
 * P8.2: staff edits carry the version they opened (conflicts are refused and offer a reload), category order changes
 * with keyboard-operable Up and Down buttons, the products list keeps its filters in the address, and readiness shows
 * as card labels and as the editor's "Before publishing" checklist.
 */

/** The staff catalog as a small store: `publish` stands for a reload delivering a newer snapshot. */
const catalog = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const store = {
    snapshot: null as unknown,
    reload: vi.fn(),
    publish(next: unknown) {
      store.snapshot = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  return store;
});
const api = vi.hoisted(() => ({
  reorderCategories: vi.fn(), createCategory: vi.fn(), updateCategory: vi.fn(), deleteCategory: vi.fn(),
  createProduct: vi.fn(), updateProduct: vi.fn(), deleteProduct: vi.fn(),
  createDesigner: vi.fn(), updateDesigner: vi.fn(), deleteDesigner: vi.fn(),
}));

vi.mock("./AdminCatalogContext", async () => {
  const { useMemo, useSyncExternalStore } = await import("react");
  const { buildCategoryTree } = await import("../../store/catalogModel");
  const useAdminCatalog = () => {
    const snapshot = useSyncExternalStore(catalog.subscribe, () => catalog.snapshot) as AdminCatalogSnapshot;
    const categories = useMemo(() => buildCategoryTree(snapshot.categories), [snapshot]);
    const data = useMemo(() => ({ snapshot, stocks: [] }), [snapshot]);
    return { status: "ready", data, categories, error: null, sessionExpired: false, refreshing: false, reload: catalog.reload };
  };
  return { useAdminCatalog, useOptionalAdminCatalog: useAdminCatalog };
});
vi.mock("../../api/catalog", async (importOriginal) => ({ ...await importOriginal<typeof import("../../api/catalog")>(), catalogAdminAPI: api }));
vi.mock("../../store/StoreContext", () => ({ useStore: () => ({ state: { wishlist: [] }, addToCart: vi.fn(), toggleWish: vi.fn() }) }));
vi.mock("../../store/CatalogContext", () => ({ useCatalog: () => ({ mode: "live" }) }));
vi.mock("../../contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

const PRODUCT_CHANGED = "Someone else changed this product after you opened it. Reload it to see their changes, then make yours again.";
const CATEGORY_CHANGED = "Someone else changed this category after you opened it. Reload it to see their changes, then make yours again.";
const SIBLINGS_CHANGED = "The categories here changed after you opened them. Reload and try again.";
/** The refusal for a save that raced another one with the same version. */
const RACED = "The catalog changed concurrently. Reload and retry your change.";
/** A version later than every fixture's: what another editor's save leaves behind. */
const NEWER = "2026-11-17T09:30:00.000Z";

const hiddenJacket = fixtureProduct({
  id: "prod-hidden", name: "Hidden Draft Jacket", isActive: false, variants: [fixtureVariant({ id: "var-hidden", stock: 0 })],
});
const readyCoat = fixtureProduct({
  id: "prod-ready", name: "Ready Wool Coat", isActive: false,
  images: [fixtureImage({ id: "img-coat", url: "https://media.example.test/coat.jpg", isMain: true })],
  variants: [fixtureVariant({ id: "var-coat", stock: 4 })],
});
const sample = fixtureImage({
  id: "img-sample", url: "https://media.example.test/sample.jpg", isMain: true, isPlaceholder: true,
  sourceUrl: "https://images.example.test/source", license: "Test licence",
});

/** Three departments (Phones & Tablets, Fashion, Home & Living) and six products, two of them hidden drafts. */
function staffCatalog(hidden: string[] = []): AdminCatalogSnapshot {
  return fixtureAdminSnapshot({
    categories: [...fixtureCategories, fixtureCategory({ id: "cat-home", name: "Home & Living", order: 2 })]
      .map((category) => ({ ...category, isActive: !hidden.includes(category.id) })),
    products: [linenShirt, poloShirt, imagelessShirt, demoPhone, hiddenJacket, readyCoat],
  });
}

/** The snapshot after a reorder: `ids` (children of `parentId`) at positions 0, 1, 2…, each with a new version. */
function reordered(snapshot: AdminCatalogSnapshot, parentId: string | null, ids: string[]): AdminCatalogSnapshot {
  return {
    ...snapshot,
    categories: snapshot.categories.map((category) => category.parentId === parentId && ids.includes(category.id)
      ? { ...category, order: ids.indexOf(category.id), updatedAt: NEWER }
      : category),
  };
}

const current = () => catalog.snapshot as AdminCatalogSnapshot;
const moveButton = (name: string, direction: "up" | "down") => screen.getByRole("button", { name: `Move ${name} ${direction}` });
/** The text of the elements an element's `aria-describedby` points to. */
const describedBy = (element: HTMLElement) => (element.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean)
  .map((id) => document.getElementById(id)?.textContent ?? "").join(" ");

function apiError(status: number, data: unknown) {
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status, statusText: "", data, headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  window.history.replaceState(null, "", "#/admin/catalog/products");
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  for (const fn of Object.values(api)) fn.mockReset();
  catalog.reload.mockReset();
  catalog.publish(staffCatalog());
});

describe("counts in the catalog", () => {
  it("counts one product in the singular, in the tree and in the list's total", () => {
    const counted = staffCatalog().categories.map((category, index) => ({ ...category, productCount: [1, 2, 0][index] ?? 3 }));
    catalog.publish({ ...staffCatalog(), categories: counted });
    const view = render(<CatalogManager canWrite showToast={vi.fn()} />);
    const [one, two, none] = counted;
    expect(screen.getByText(`1 product · /${one.slug}`)).toBeTruthy();
    expect(screen.getByText(`2 products · /${two.slug}`)).toBeTruthy();
    expect(screen.getByText(`0 products · /${none.slug}`)).toBeTruthy();
    expect(screen.queryByText(/\b1 products\b/)).toBeNull();
    view.unmount();
    catalog.publish({ ...staffCatalog(), products: [current().products[0]] });
    render(<CatalogManager canWrite showToast={vi.fn()} />);
    expect(screen.getByText("1 of 1 product")).toBeTruthy();
  });
});

describe("category order in the tree", () => {
  it("names each move button with its category and disables the ends with a reason, keeping them focusable", () => {
    render(<CatalogManager canWrite showToast={vi.fn()} />);
    const top = moveButton("Phones & Tablets", "up");
    expect(top.getAttribute("aria-disabled")).toBe("true");
    expect(top.hasAttribute("disabled")).toBe(false);
    expect(describedBy(top)).toBe("Already first here.");
    expect(moveButton("Home & Living", "down").getAttribute("aria-disabled")).toBe("true");
    expect(describedBy(moveButton("Home & Living", "down"))).toBe("Already last here.");
    expect([moveButton("Fashion", "up"), moveButton("Fashion", "down")].map((button) => [button.getAttribute("aria-disabled"), describedBy(button)]))
      .toEqual([["false", ""], ["false", ""]]);
    // An only child cannot move either way.
    expect([moveButton("Men", "up"), moveButton("Men", "down")].map((button) => button.getAttribute("aria-disabled"))).toEqual(["true", "true"]);
    fireEvent.click(top);
    expect(api.reorderCategories).not.toHaveBeenCalled();
  });

  it("moves a category among its siblings, says so politely and keeps focus on the pressed button or its pair", async () => {
    api.reorderCategories.mockResolvedValue({ data: { categories: [] } });
    render(<CatalogManager canWrite showToast={vi.fn()} />);
    const status = screen.getByRole("status");
    moveButton("Home & Living", "up").focus();
    fireEvent.click(moveButton("Home & Living", "up"));
    await waitFor(() => expect(status.textContent).toBe("Moved Home & Living above Fashion"));
    expect(api.reorderCategories).toHaveBeenCalledWith(null, ["cat-phones-tablets", "cat-home", "cat-fashion"]);
    expect(catalog.reload).toHaveBeenCalledTimes(1);
    act(() => catalog.publish(reordered(current(), null, ["cat-phones-tablets", "cat-home", "cat-fashion"])));
    expect(document.activeElement).toBe(moveButton("Home & Living", "up"));

    // Reaching the top disables Up, so focus moves to Down.
    fireEvent.click(moveButton("Home & Living", "up"));
    await waitFor(() => expect(status.textContent).toBe("Moved Home & Living above Phones & Tablets"));
    expect(api.reorderCategories).toHaveBeenLastCalledWith(null, ["cat-home", "cat-phones-tablets", "cat-fashion"]);
    act(() => catalog.publish(reordered(current(), null, ["cat-home", "cat-phones-tablets", "cat-fashion"])));
    expect(moveButton("Home & Living", "up").getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(moveButton("Home & Living", "down"));

    fireEvent.click(moveButton("Phones & Tablets", "down"));
    await waitFor(() => expect(status.textContent).toBe("Moved Phones & Tablets below Fashion"));
    expect(api.reorderCategories).toHaveBeenLastCalledWith(null, ["cat-home", "cat-fashion", "cat-phones-tablets"]);
  });

  it("sends one move at a time", async () => {
    const pending = deferred<{ data: { categories: [] } }>();
    api.reorderCategories.mockReturnValue(pending.promise);
    render(<CatalogManager canWrite showToast={vi.fn()} />);
    fireEvent.click(moveButton("Fashion", "up"));
    fireEvent.click(moveButton("Fashion", "up"));
    fireEvent.click(moveButton("Home & Living", "up"));
    expect(api.reorderCategories).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ data: { categories: [] } }));
  });

  it("shows the server's plain message and reloads the catalog when the siblings changed", async () => {
    api.reorderCategories.mockRejectedValue(apiError(409, { error: SIBLINGS_CHANGED, code: "CATEGORY_SIBLINGS_CHANGED" }));
    render(<CatalogManager canWrite showToast={vi.fn()} />);
    fireEvent.click(moveButton("Fashion", "down"));
    expect((await screen.findByRole("alert")).textContent).toBe(SIBLINGS_CHANGED);
    expect(catalog.reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("offers view-only staff no move controls", () => {
    render(<CatalogManager canWrite={false} showToast={vi.fn()} />);
    expect(screen.queryAllByRole("button", { name: /^Move / })).toEqual([]);
  });

  it("hides a category with the version it was listed with, and reloads after a conflict", async () => {
    api.updateCategory.mockRejectedValue(apiError(409, { error: CATEGORY_CHANGED, code: "CATEGORY_CHANGED" }));
    render(<CatalogManager canWrite showToast={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Hide Fashion" }));
    expect((await screen.findByRole("alert")).textContent).toBe(CATEGORY_CHANGED);
    expect(api.updateCategory).toHaveBeenCalledWith("cat-fashion", { isActive: false, expectedUpdatedAt: FIXTURE_VERSION });
    expect(catalog.reload).toHaveBeenCalledTimes(1);
  });
});

describe("category form", () => {
  it("has no display order: a new category is created without one, and an edit sends the version it opened", async () => {
    api.createCategory.mockResolvedValue({ data: staffRecord(fixtureCategory({ id: "cat-bags", name: "Bags", parentId: "cat-fashion" })) });
    const created = render(<CategoryForm category={null} defaultParentId="cat-fashion" onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByLabelText("Display order")).toBeNull();
    expect(screen.queryAllByRole("spinbutton")).toEqual([]);
    fireEvent.change(screen.getByLabelText("Category name"), { target: { value: "Bags" } });
    fireEvent.click(screen.getByRole("button", { name: "Create category" }));
    await waitFor(() => expect(api.createCategory).toHaveBeenCalledTimes(1));
    expect(api.createCategory.mock.calls[0][0]).toEqual({ name: "Bags", parentId: "cat-fashion", headerImage: null, attributeKeys: [], isActive: true });
    created.unmount();

    api.updateCategory.mockResolvedValue({ data: {} });
    const men = current().categories.find((category) => category.id === "cat-men")!;
    render(<CategoryForm category={men} defaultParentId={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Category name"), { target: { value: "Menswear" } });
    fireEvent.click(screen.getByRole("button", { name: "Save category" }));
    await waitFor(() => expect(api.updateCategory).toHaveBeenCalledTimes(1));
    expect(api.updateCategory).toHaveBeenCalledWith("cat-men", {
      name: "Menswear", parentId: "cat-fashion", headerImage: null, attributeKeys: [], isActive: true, expectedUpdatedAt: FIXTURE_VERSION,
    });
  });

  it("after someone else saved the category, says so and offers to reload it; other refusals offer no reload", async () => {
    const men = current().categories.find((category) => category.id === "cat-men")!;
    api.updateCategory.mockRejectedValueOnce(apiError(409, { error: "A category with this name already exists under that parent" }));
    api.updateCategory.mockRejectedValueOnce(apiError(409, { error: CATEGORY_CHANGED, code: "CATEGORY_CHANGED" }));
    const onReload = vi.fn();
    render(<CategoryForm category={men} defaultParentId={null} onClose={vi.fn()} onSaved={vi.fn()} onReload={onReload} />);
    fireEvent.change(screen.getByLabelText("Category name"), { target: { value: "Shirts" } });
    fireEvent.click(screen.getByRole("button", { name: "Save category" }));
    expect((await screen.findByRole("alert")).textContent).toBe("A category with this name already exists under that parent");
    expect(screen.queryByRole("button", { name: "Reload category" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save category" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(CATEGORY_CHANGED));
    fireEvent.click(screen.getByRole("button", { name: "Reload category" }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Reloading…" }).hasAttribute("disabled")).toBe(true);
  });

  it("after a save raced another at the same moment, offers to reload the category", async () => {
    const men = current().categories.find((category) => category.id === "cat-men")!;
    api.updateCategory.mockRejectedValueOnce(apiError(409, { error: RACED, code: "CATALOG_CHANGED" }));
    const onReload = vi.fn();
    render(<CategoryForm category={men} defaultParentId={null} onClose={vi.fn()} onSaved={vi.fn()} onReload={onReload} />);
    fireEvent.click(screen.getByRole("button", { name: "Save category" }));
    expect((await screen.findByRole("alert")).textContent).toBe(RACED);
    fireEvent.click(screen.getByRole("button", { name: "Reload category" }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

describe("products list filters in the address", () => {
  const status = () => screen.getByLabelText("Filter products by status");
  const readiness = () => screen.getByLabelText("Filter products by readiness");
  const pill = () => screen.getByRole("button", { name: /^Needs images \(\d+\)$/ });
  /** The product cards shown, by their open buttons (the list follows its "N of M products" line). */
  const listed = () => within(screen.getByText(/^\d+ of \d+ products?$/).nextElementSibling as HTMLElement)
    .queryAllByRole("button", { name: /^Edit / }).map((button) => button.getAttribute("aria-label"));

  it("keeps status, readiness and category in the address, changing them with a replace", () => {
    render(<CatalogManager canWrite showToast={vi.fn()} />);
    const length = window.history.length;
    fireEvent.change(status(), { target: { value: "hidden" } });
    expect(window.location.hash).toBe("#/admin/catalog/products?status=hidden");
    expect(listed()).toEqual(["Edit Hidden Draft Jacket", "Edit Ready Wool Coat"]);
    fireEvent.change(readiness(), { target: { value: "ready" } });
    expect(window.location.hash).toBe("#/admin/catalog/products?status=hidden&readiness=ready");
    expect(listed()).toEqual(["Edit Ready Wool Coat"]);
    expect(screen.getByText("1 of 6 products")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Filter products by category"), { target: { value: "cat-men" } });
    expect(window.location.hash).toBe("#/admin/catalog/products?status=hidden&readiness=ready&category=cat-men");
    // The pill is the needs-images readiness filter, with the count of every product needing images.
    expect(pill().textContent).toBe("Needs images (3)");
    fireEvent.click(pill());
    expect(window.location.hash).toBe("#/admin/catalog/products?status=hidden&readiness=needs-images&category=cat-men");
    expect(pill().getAttribute("aria-pressed")).toBe("true");
    expect((readiness() as HTMLSelectElement).value).toBe("needs-images");
    expect(listed()).toEqual(["Edit Hidden Draft Jacket"]);
    fireEvent.click(pill());
    fireEvent.change(status(), { target: { value: "all" } });
    expect(window.location.hash).toBe("#/admin/catalog/products?category=cat-men");
    expect(window.history.length).toBe(length);
    // The search text stays on this screen.
    fireEvent.change(screen.getByRole("textbox", { name: "Search products" }), { target: { value: "polo" } });
    expect(window.location.hash).toBe("#/admin/catalog/products?category=cat-men");
  });

  it("opens a product on the same filtered list: closing it returns to that list", async () => {
    window.history.replaceState(null, "", "#/admin/catalog/products?status=hidden");
    render(<CatalogManager canWrite showToast={vi.fn()} />);
    const length = window.history.length;
    fireEvent.click(screen.getByRole("button", { name: "Edit Ready Wool Coat" }));
    expect(window.location.hash).toBe("#/admin/catalog/products?status=hidden&product=prod-ready");
    expect(window.history.length).toBe(length + 1);
    const editor = await screen.findByRole("dialog", { name: "Edit product" });
    fireEvent.click(within(editor).getByRole("button", { name: "Close product editor" }));
    expect(window.location.hash).toBe("#/admin/catalog/products?status=hidden");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit product" })).toBeNull());
  });

  it("drops unknown filter values and categories from the address in place, never applying them", async () => {
    window.history.replaceState(null, "", "#/admin/catalog/products?status=all&readiness=no-active-option&category=cat-missing");
    const first = render(<CatalogManager canWrite showToast={vi.fn()} />);
    await waitFor(() => expect(window.location.hash).toBe("#/admin/catalog/products"));
    expect(screen.getByText("6 of 6 products")).toBeTruthy();
    first.unmount();
    window.history.replaceState(null, "", "#/admin/catalog/products?status=hidden&category=cat-missing&product=prod-ready");
    render(<CatalogManager canWrite showToast={vi.fn()} />);
    await waitFor(() => expect(window.location.hash).toBe("#/admin/catalog/products?status=hidden&product=prod-ready"));
    expect(await screen.findByRole("dialog", { name: "Edit product" })).toBeTruthy();
  });

  it("labels each card with its visibility and open checks in words, and offers its preview", () => {
    render(<CatalogManager canWrite={false} showToast={vi.fn()} />);
    const card = (name: string) => screen.getByRole("button", { name: `View ${name}` }).closest("li")!;
    const labels = (name: string) => [...card(name).querySelectorAll("button > span:last-child > span:last-child > span")].map((label) => label.textContent);
    expect(labels("Hidden Draft Jacket")).toEqual(["Hidden (draft)", "Needs images", "Out of stock"]);
    expect(labels("Ready Wool Coat")).toEqual(["Hidden (draft)", "Ready to publish"]);
    expect(labels("Demo Smartphone")).toEqual(["Visible to shoppers", "Needs images", "Demo listing", "Sample image"]);
    expect(labels("Linen Short-Sleeve Shirt")).toEqual(["Visible to shoppers", "Featured"]);
    for (const [name, id] of [["Hidden Draft Jacket", "prod-hidden"], ["Linen Short-Sleeve Shirt", "prod-linen-shirt"]]) {
      expect(within(card(name)).getByRole("link", { name: `Preview ${name}` }).getAttribute("href")).toBe(`#/admin/catalog/preview?product=${id}`);
    }
  });

  it("reads a category hidden above the product as an open check, on the card and in the filter", () => {
    catalog.publish(staffCatalog(["cat-men"]));
    window.history.replaceState(null, "", "#/admin/catalog/products?readiness=category-hidden");
    render(<CatalogManager canWrite showToast={vi.fn()} />);
    expect(listed()).toEqual(["Edit Linen Short-Sleeve Shirt", "Edit Cotton Polo Shirt", "Edit Oxford Shirt Without Images", "Edit Hidden Draft Jacket", "Edit Ready Wool Coat"]);
    expect(within(screen.getByRole("button", { name: "Edit Ready Wool Coat" })).getByText("Category hidden")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: "Edit Ready Wool Coat" })).queryByText("Ready to publish")).toBeNull();
  });
});

describe("product editor: versions, conflicts and the checklist", () => {
  const save = () => fireEvent.click(screen.getByRole("button", { name: "Save product" }));
  const checklist = () => screen.getByText("Before publishing").closest("details")!;
  const checks = () => within(checklist()).getAllByRole("listitem").map((item) => item.querySelector("p")?.textContent);

  it("saves against the version it opened, even after the catalog reloads behind it", async () => {
    api.updateProduct.mockResolvedValue({ data: {} });
    const opened = staffRecord(linenShirt);
    const view = render(<ProductEditor product={opened} canWrite onClose={vi.fn()} onSaved={vi.fn()} />);
    // Another editor saved meanwhile; a background reload hands this editor the newer record.
    view.rerender(<ProductEditor product={{ ...opened, price: 1500, updatedAt: NEWER }} canWrite onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "My own new description of this shirt" } });
    save();
    await waitFor(() => expect(api.updateProduct).toHaveBeenCalledTimes(1));
    expect(api.updateProduct.mock.calls[0][1]).toMatchObject({ price: 1000, expectedUpdatedAt: FIXTURE_VERSION });
  });

  it("after someone else saved the product, shows the server's message and offers to reload it", async () => {
    api.updateProduct.mockRejectedValueOnce(apiError(409, { error: "On-hand quantity cannot be lower than reserved units", code: "STOCK_RESERVED" }));
    api.updateProduct.mockRejectedValueOnce(apiError(409, { error: PRODUCT_CHANGED, code: "PRODUCT_CHANGED" }));
    const onReload = vi.fn();
    render(<ProductEditor product={staffRecord(linenShirt)} canWrite onClose={vi.fn()} onSaved={vi.fn()} onReload={onReload} />);
    save();
    expect((await screen.findByRole("alert")).textContent).toBe("On-hand quantity cannot be lower than reserved units");
    expect(screen.queryByRole("button", { name: "Reload product" })).toBeNull();
    save();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(PRODUCT_CHANGED));
    fireEvent.click(screen.getByRole("button", { name: "Reload product" }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Reloading…" }).hasAttribute("disabled")).toBe(true);
  });

  it("after a save raced another at the same moment, offers to reload the product; a new product has nothing to reload", async () => {
    api.updateProduct.mockRejectedValueOnce(apiError(409, { error: RACED, code: "CATALOG_CHANGED" }));
    const onReload = vi.fn();
    const edited = render(<ProductEditor product={staffRecord(linenShirt)} canWrite onClose={vi.fn()} onSaved={vi.fn()} onReload={onReload} />);
    save();
    expect((await screen.findByRole("alert")).textContent).toBe(RACED);
    fireEvent.click(screen.getByRole("button", { name: "Reload product" }));
    expect(onReload).toHaveBeenCalledTimes(1);
    edited.unmount();

    api.createProduct.mockRejectedValueOnce(apiError(409, { error: RACED, code: "CATALOG_CHANGED" }));
    render(<ProductEditor product={null} canWrite onClose={vi.fn()} onSaved={vi.fn()} onReload={onReload} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Racing tee" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "A tee saved at the same moment as another." } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Price (KES)" }), { target: { value: "1500" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Category" }), { target: { value: "cat-shirts" } });
    save();
    await waitFor(() => expect(api.createProduct).toHaveBeenCalledTimes(1));
    expect((await screen.findByRole("alert")).textContent).toBe(RACED);
    expect(screen.queryByRole("button", { name: "Reload product" })).toBeNull();
  });

  it("lists each check as passed or open with its next step, follows the form and never blocks saving", async () => {
    catalog.publish(staffCatalog(["cat-men"]));
    api.updateProduct.mockResolvedValue({ data: {} });
    const onShowCategory = vi.fn();
    const draft = staffRecord({ ...hiddenJacket, images: [sample] });
    render(<ProductEditor product={draft} canWrite onClose={vi.fn()} onSaved={vi.fn()} onShowCategory={onShowCategory} />);
    expect(checklist().open).toBe(true);
    expect(within(checklist()).getByText("3 open")).toBeTruthy();
    expect(checks()).toEqual(["Open Needs images", "Passed Has an active option", "Open Out of stock", "Open Category hidden"]);
    fireEvent.click(within(checklist()).getByRole("button", { name: "Go to Images" }));
    expect(document.activeElement?.textContent).toBe("Images");
    expect(within(checklist()).getByRole("link", { name: "Open Stock for Shirts" }).getAttribute("href")).toBe("#/admin/catalog/stock?category=cat-shirts");
    fireEvent.click(within(checklist()).getByRole("button", { name: "Show Men in the tree" }));
    expect(onShowCategory).toHaveBeenCalledWith("cat-men");
    // The checklist follows the form: a real photo passes "Needs images", and turning the option off opens "No active option".
    fireEvent.click(screen.getByRole("checkbox", { name: "Image 1 is a sample image" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Variant 1 active" }));
    expect(checks()).toEqual(["Passed Has real photos", "Open No active option", "Open Out of stock", "Open Category hidden"]);
    fireEvent.click(within(checklist()).getAllByRole("button", { name: "Go to Variants" })[0]);
    expect(document.activeElement?.textContent).toBe("Variants (sellable SKUs)");
    // Warnings never block: the save goes through with checks still open.
    fireEvent.click(screen.getByRole("checkbox", { name: "Variant 1 active" }));
    save();
    await waitFor(() => expect(api.updateProduct).toHaveBeenCalledTimes(1));
  });

  it("says a visible product's publishing checks passed, apart from the field errors that block its save", () => {
    render(<ProductEditor product={staffRecord({ ...readyCoat, isActive: true })} canWrite onClose={vi.fn()} onSaved={vi.fn()} />);
    const summary = () => checklist().querySelector("summary")!.textContent;
    expect(summary()).toBe("Before publishingPublishing checks passed");
    expect(within(checklist()).queryByText("All checks passed")).toBeNull();
    // A field error keeps its own status on its field; the checklist speaks only for publishing.
    fireEvent.change(screen.getByLabelText("Compare-at price (optional)"), { target: { value: "1" } });
    expect(screen.getByLabelText("Compare-at price (optional)").getAttribute("aria-invalid")).toBe("true");
    expect(summary()).toBe("Before publishingPublishing checks passed");
  });

  it("calls a hidden product with every check passed ready to publish, and starts collapsed", () => {
    render(<ProductEditor product={staffRecord(readyCoat)} canWrite onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(checklist().open).toBe(false);
    expect(within(checklist()).getByText("Ready to publish")).toBeTruthy();
    expect(checks()).toEqual(["Passed Has real photos", "Passed Has an active option", "Passed Has units to sell", "Passed Category visible to shoppers"]);
  });

  it("names visibility for its effect, previews a saved product, and starts a new product hidden", () => {
    const saved = render(<ProductEditor product={staffRecord(hiddenJacket)} canWrite onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText("Hidden (draft)")).toBeTruthy();
    const visible = screen.getByRole("checkbox", { name: "Visible to shoppers" }) as HTMLInputElement;
    expect(visible.checked).toBe(false);
    expect(describedBy(visible)).toContain("hidden draft that only staff can see");
    expect(screen.getByRole("link", { name: "Preview" }).getAttribute("href")).toBe("#/admin/catalog/preview?product=prod-hidden");
    saved.unmount();
    render(<ProductEditor product={null} canWrite onClose={vi.fn()} onSaved={vi.fn()} />);
    expect((screen.getByRole("checkbox", { name: "Visible to shoppers" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("link", { name: "Preview" })).toBeNull();
    // A new product's stock is set in Variants: there are none of its SKUs on the Stock tab yet.
    expect(within(checklist()).queryByRole("link", { name: /^Open Stock/ })).toBeNull();
    expect(checks()).toEqual(["Open Needs images", "Passed Has an active option", "Open Out of stock", "Open Category hidden"]);
  });
});

describe("from the editor back to the list", () => {
  it("the Category hidden step closes the editor and focuses that category's Show button in the tree", async () => {
    catalog.publish(staffCatalog(["cat-men"]));
    window.history.replaceState(null, "", "#/admin/catalog/products?status=hidden&product=prod-ready");
    render(<CatalogManager canWrite showToast={vi.fn()} />);
    const editor = await screen.findByRole("dialog", { name: "Edit product" });
    fireEvent.click(within(editor).getByRole("button", { name: "Show Men in the tree" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit product" })).toBeNull());
    expect(window.location.hash).toBe("#/admin/catalog/products?status=hidden");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Show Men" })));
  });

  it("after a conflict, Reload product reopens the editor from the reloaded catalog and saves against its version", async () => {
    window.history.replaceState(null, "", "#/admin/catalog/products?product=prod-linen-shirt");
    api.updateProduct.mockRejectedValueOnce(apiError(409, { error: PRODUCT_CHANGED, code: "PRODUCT_CHANGED" }));
    api.updateProduct.mockResolvedValueOnce({ data: {} });
    render(<CatalogManager canWrite showToast={vi.fn()} />);
    const editor = await screen.findByRole("dialog", { name: "Edit product" });
    fireEvent.change(within(editor).getByRole("textbox", { name: "Name" }), { target: { value: "My stale rename" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Save product" }));
    fireEvent.click(await within(editor).findByRole("button", { name: "Reload product" }));
    expect(catalog.reload).toHaveBeenCalledTimes(1);
    act(() => catalog.publish({
      ...current(),
      products: current().products.map((product) => (product.id === "prod-linen-shirt" ? { ...product, name: "Renamed elsewhere", updatedAt: NEWER } : product)),
    }));
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("Renamed elsewhere"));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save product" }));
    await waitFor(() => expect(api.updateProduct).toHaveBeenCalledTimes(2));
    expect(api.updateProduct.mock.calls[1][1]).toMatchObject({ name: "Renamed elsewhere", expectedUpdatedAt: NEWER });
  });
});
