import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { catalogAdminAPI, type AdminCatalogCategory, type AdminCatalogProduct, type CatalogDesigner } from "../../api/catalog";
import { apiStatus, describeApiError } from "../../api/errors";
import { ConfirmModal } from "../../components/Modal";
import { ResponsiveImage } from "../../components/ui";
import { Link, navigate, useRoute } from "../../router";
import { primaryImage, productStock, type CategoryTree } from "../../store/catalogModel";
import { formatKES } from "../../utils/format";
import { useAdminCatalog } from "./AdminCatalogContext";
import {
  NEW_PRODUCT,
  parseProductListParams,
  parseProductParam,
  productPreviewRoute,
  productsRoute,
  type ProductListFilters,
  type ProductReadinessFilter,
  type ProductStatusFilter,
} from "./adminRoutes";
import { useCarriedNotice } from "./carriedNotice";
import { CategoryForm, DesignerForm } from "./CatalogForms";
import { matchesReadiness, needsImages, productReadiness, readinessLabels, visibilityLabel, type Readiness } from "./catalogReadiness";
import { ProductEditor } from "./ProductEditor";
import { Feedback, Panel, WrappingSelect, categoryOptions, dangerButtonClass, descendantIds, inputClass, primaryButtonClass, smallButtonClass } from "./shared";

/** "1 product", "2 products". */
const productCount = (count: number) => `${count} ${count === 1 ? "product" : "products"}`;

/** The status filter's choices; "all" stands for no filter (the address leaves it out). */
const STATUS_OPTIONS: readonly { value: ProductStatusFilter | "all"; label: string }[] = [
  { value: "all", label: "All products" },
  { value: "visible", label: "Visible to shoppers" },
  { value: "hidden", label: "Hidden (draft)" },
  { value: "demo", label: "Demo records" },
  { value: "sample-images", label: "Sample images" },
];
/** The readiness filter's choices; "any" stands for no filter. */
const READINESS_OPTIONS: readonly { value: ProductReadinessFilter | "any"; label: string }[] = [
  { value: "any", label: "Any readiness" },
  { value: "ready", label: "Ready to publish" },
  { value: "needs-images", label: "Needs images" },
  { value: "out-of-stock", label: "Out of stock" },
  { value: "category-hidden", label: "Category hidden" },
];
const PRODUCT_LIMIT = 120;
/**
 * Rendered width of a product tile image inside its 1px border: 2/3/4/5 columns with `gap-3` in a list with 4px
 * right padding, inside the Panel (20 then 24px padding) and the shell's content area (16/24/32px padding; from 1280px
 * it sits beside the 240px navigation column and has no maximum width). Tiles use the card renditions (up to 960px).
 */
const PRODUCT_TILE_SIZES =
  "(min-width: 80em) calc(20vw - 82.8px), (min-width: 64em) calc(25vw - 40px), (min-width: 40em) calc(33.34vw - 43px), calc(50vw - 46px)";
/** Filter controls: 44px tall, a full row each on phones. */
const filterClass = `min-h-[44px] min-w-0 ${inputClass}`;
const treeButtonClass = `${smallButtonClass} min-h-[44px] min-w-[44px]`;
const treeDangerClass = `${dangerButtonClass} min-h-[44px] min-w-[44px]`;

type PendingDelete =
  | { kind: "product"; item: AdminCatalogProduct }
  | { kind: "category"; item: AdminCatalogCategory }
  | { kind: "designer"; item: CatalogDesigner };

function matchesStatus(product: AdminCatalogProduct, filter: ProductStatusFilter | null) {
  switch (filter) {
    case "visible": return product.isActive;
    case "hidden": return !product.isActive;
    case "demo": return product.isDemo;
    case "sample-images": return product.images.some((image) => image.isPlaceholder);
    default: return true;
  }
}

export const PRODUCT_NOT_FOUND = "That product wasn't found.";
const ADD_NOT_AVAILABLE = "Adding products is not available for your role.";

const LABEL_TONES = {
  visible: "border-success/40 bg-success-tint",
  hidden: "border-control/40 bg-surface-soft",
  open: "border-warning/50 bg-warning-tint",
  info: "border-ocean-blue/30 bg-ocean-blue/10",
  ready: "border-success/60 bg-success-tint font-semibold",
} as const;

/** A short status in words (never colour alone); wraps inside narrow cards. */
function StatusLabel({ tone, children }: { tone: keyof typeof LABEL_TONES; children: ReactNode }) {
  return (
    <span className={`min-w-0 max-w-full rounded-sm border px-1.5 py-0.5 text-[0.6875rem] leading-tight text-navy-900 [overflow-wrap:break-word] ${LABEL_TONES[tone]}`}>
      {children}
    </span>
  );
}

/** A card's labels: its visibility, then open checks, "Demo listing" or "Ready to publish", then the existing flags. */
function ProductLabels({ product, readiness, sampleCover }: { product: AdminCatalogProduct; readiness: Readiness; sampleCover: boolean }) {
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      <StatusLabel tone={product.isActive ? "visible" : "hidden"}>{visibilityLabel(product.isActive)}</StatusLabel>
      {readinessLabels(readiness).map((label) => (
        <StatusLabel key={label} tone={label === "Ready to publish" ? "ready" : label === "Demo listing" ? "info" : "open"}>{label}</StatusLabel>
      ))}
      {product.isFeatured && <StatusLabel tone="info">Featured</StatusLabel>}
      {sampleCover && <StatusLabel tone="open">Sample image</StatusLabel>}
    </span>
  );
}

/**
 * Moves a category one place among its siblings. At either end it stays focusable with `aria-disabled`, and its
 * description gives the reason.
 */
function MoveButton({ category, direction, reasonId, atEnd, onMove }: {
  category: AdminCatalogCategory;
  direction: "up" | "down";
  /** The id of the hidden reason text shared by every button at that end. */
  reasonId: string;
  atEnd: boolean;
  onMove: () => void;
}) {
  return (
    <button
      type="button"
      data-move={`${category.id}:${direction}`}
      aria-label={`Move ${category.name} ${direction}`}
      aria-disabled={atEnd}
      aria-describedby={atEnd ? reasonId : undefined}
      onClick={() => { if (!atEnd) onMove(); }}
      className={`${treeButtonClass} aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-brand-primary`}
    >
      <span aria-hidden="true">{direction === "up" ? "↑ " : "↓ "}</span>{direction === "up" ? "Up" : "Down"}
    </button>
  );
}

/** The element under `root` whose `data-<name>` equals `value` (ids from the API are never quoted into a selector). */
function byData(root: HTMLElement | null, name: string, value: string) {
  return [...(root?.querySelectorAll<HTMLElement>(`[data-${name}]`) ?? [])].find((element) => element.getAttribute(`data-${name}`) === value) ?? null;
}

/** Runs `then` once a catalog reload requested now has delivered a newer snapshot (with the fresh category tree). */
function useAfterReload(data: unknown, categories: CategoryTree<AdminCatalogCategory>, reload: () => void) {
  const pending = useRef<{ from: unknown; then: (tree: CategoryTree<AdminCatalogCategory>) => void } | null>(null);
  useEffect(() => {
    const waiting = pending.current;
    if (!waiting || data === waiting.from) return;
    pending.current = null;
    waiting.then(categories);
  }, [data, categories]);
  return useCallback((then: (tree: CategoryTree<AdminCatalogCategory>) => void) => {
    pending.current = { from: data, then };
    reload();
  }, [data, reload]);
}

/**
 * Products, categories and designers. The open product lives in the address (`product=<id>`, or `new` for "Add
 * product"), beside the list's status, readiness and category filters, so refresh and Back reopen or close it on the
 * same filtered list. Roles that cannot write see read-only rows and product details.
 */
export function CatalogManager({ canWrite, showToast }: { canWrite: boolean; showToast: (message: string) => void }) {
  const { data, categories, reload, refreshing } = useAdminCatalog();
  const route = useRoute();
  const requested = parseProductParam(route);
  const products = useMemo(() => data?.snapshot.products ?? [], [data]);
  const designers = data?.snapshot.designers ?? [];
  const options = useMemo(() => categoryOptions(categories), [categories]);
  // Status, readiness and category live in the address (a change replaces the entry); the search text stays here.
  const parsed = parseProductListParams(route);
  const unknownCategory = data !== null && parsed.filters.category !== null && !categories.byId.has(parsed.filters.category);
  const { status, readiness } = parsed.filters;
  const categoryFilter = unknownCategory ? null : parsed.filters.category;
  const filters: ProductListFilters = { status, readiness, category: categoryFilter };
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const carriedNotice = useCarriedNotice();
  const [categoryForm, setCategoryForm] = useState<{ category: AdminCatalogCategory | null; parentId: string | null; round: number } | null>(null);
  const [designerForm, setDesignerForm] = useState<{ designer: CatalogDesigner | null } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [moving, setMoving] = useState(false);
  const [moveStatus, setMoveStatus] = useState("");
  /** The move button to focus once the reordered tree has rendered. */
  const focusAfterMove = useRef<string | null>(null);
  /** The category row to bring into view and focus (the editor's "Category hidden" step). */
  const [focusCategory, setFocusCategory] = useState<string | null>(null);
  /** Bumped to reopen the product editor from a fresh snapshot after a conflict. */
  const [editorRound, setEditorRound] = useState(0);
  const tree = useRef<HTMLUListElement>(null);
  const firstReasonId = useId();
  const lastReasonId = useId();
  const afterReload = useAfterReload(data, categories, reload);

  const readinessById = useMemo(
    () => new Map(products.map((product) => [product.id, productReadiness(product, categories)])),
    [products, categories],
  );
  const list = useMemo(() => {
    const term = search.trim().toLowerCase();
    const scope = categoryFilter ? new Set([categoryFilter, ...descendantIds(categories, categoryFilter)]) : null;
    return products.filter((product) => {
      const checks = readinessById.get(product.id);
      return (!scope || scope.has(product.categoryId)) && matchesStatus(product, status) &&
        (!readiness || (checks !== undefined && matchesReadiness(checks, readiness))) &&
        (!term || product.name.toLowerCase().includes(term) || product.tags.some((tag) => tag.toLowerCase().includes(term)));
    });
  }, [products, search, categoryFilter, status, readiness, categories, readinessById]);
  const needingImages = useMemo(() => products.filter(needsImages).length, [products]);

  const adding = requested.id === NEW_PRODUCT && canWrite;
  const editingProduct = requested.id && requested.id !== NEW_PRODUCT ? products.find((product) => product.id === requested.id) ?? null : null;
  // A product id that is malformed, not in the loaded catalog, or "new" for a role that cannot add: say so and drop it.
  const refusal = requested.malformed || (requested.id !== null && requested.id !== NEW_PRODUCT && data !== null && !editingProduct)
    ? PRODUCT_NOT_FOUND
    : requested.id === NEW_PRODUCT && !canWrite ? ADD_NOT_AVAILABLE : "";
  // Unknown or malformed filter values are dropped in place too, never applied; the product stays open.
  const correction = refusal || parsed.invalid || unknownCategory ? productsRoute(refusal ? null : requested.id, filters) : null;
  useEffect(() => {
    if (correction === null) return;
    if (refusal) setNotice(refusal);
    navigate(correction, { replace: true });
  }, [correction, refusal]);

  const changeFilters = (change: Partial<ProductListFilters>) => navigate(productsRoute(null, { ...filters, ...change }), { replace: true });
  // Opening adds a history entry, so Back closes the dialog on the same filtered list; closing replaces it.
  const openProduct = (id: string) => {
    setNotice("");
    navigate(productsRoute(id, filters));
  };
  const closeProduct = () => navigate(productsRoute(null, filters), { replace: true });
  // After a conflict the editor reopens from the catalog as it is now; its unsaved changes were confirmed discarded.
  const reloadProduct = () => afterReload(() => setEditorRound((round) => round + 1));
  const reloadCategory = (id: string) => afterReload((fresh) => {
    const category = fresh.byId.get(id) ?? null;
    // Only the form that asked is reopened; one closed meanwhile stays closed.
    setCategoryForm((form) => form?.category?.id !== id ? form : category ? { category, parentId: category.parentId, round: form.round + 1 } : null);
    if (!category) setError("That category no longer exists.");
  });
  const showCategory = (id: string) => {
    closeProduct();
    setFocusCategory(id);
  };

  const toggleCategory = async (category: AdminCatalogCategory) => {
    setBusy(category.id);
    setError("");
    try {
      await catalogAdminAPI.updateCategory(category.id, { isActive: !category.isActive, expectedUpdatedAt: category.updatedAt });
      showToast(category.isActive ? `Hid "${category.name}" and everything below it` : `"${category.name}" is visible again`);
      reload();
    } catch (reason) {
      setError(describeApiError(reason, "The category visibility could not be changed."));
      // Someone else changed the catalog: show what is there now.
      if (apiStatus(reason) === 409) reload();
    } finally {
      setBusy("");
    }
  };

  // One move at a time, and none while the catalog reloads: a move is computed from the order shown.
  const move = async (category: AdminCatalogCategory, siblings: AdminCatalogCategory[], direction: "up" | "down") => {
    const index = siblings.findIndex((item) => item.id === category.id);
    const target = direction === "up" ? index - 1 : index + 1;
    if (moving || refreshing || index < 0 || target < 0 || target >= siblings.length) return;
    const neighbour = siblings[target];
    const orderedIds = siblings.map((item) => item.id);
    [orderedIds[index], orderedIds[target]] = [orderedIds[target], orderedIds[index]];
    setMoving(true);
    setError("");
    setMoveStatus("");
    try {
      await catalogAdminAPI.reorderCategories(category.parentId, orderedIds);
      // The pressed button keeps focus, or its pair when the move reached an end and disabled it.
      const reachedEnd = direction === "up" ? target === 0 : target === siblings.length - 1;
      focusAfterMove.current = `${category.id}:${reachedEnd ? (direction === "up" ? "down" : "up") : direction}`;
      setMoveStatus(`Moved ${category.name} ${direction === "up" ? "above" : "below"} ${neighbour.name}`);
      reload();
    } catch (reason) {
      setError(describeApiError(reason, `${category.name} could not be moved.`));
      if (apiStatus(reason) === 409) reload();
    } finally {
      setMoving(false);
    }
  };

  // Rows may be re-inserted when the order changes, which drops focus: put it back on the intended button, once, when the
  // reload brings the new order, unless the staff member has moved on. A reload that ends without it cancels the step.
  useLayoutEffect(() => {
    const key = focusAfterMove.current;
    if (!key) return;
    focusAfterMove.current = null;
    const button = byData(tree.current, "move", key);
    const active = document.activeElement;
    if (button && (!active || active === document.body || tree.current?.contains(active))) button.focus();
  }, [categories]);
  useEffect(() => {
    if (!refreshing) focusAfterMove.current = null;
  }, [refreshing]);

  // The editor's "Category hidden" step: once the editor has closed, bring that category into view and focus it.
  useEffect(() => {
    if (focusCategory === null || requested.id !== null) return;
    setFocusCategory(null);
    const row = byData(tree.current, "category-row", focusCategory);
    const target = row?.querySelector<HTMLElement>("[data-show-category]") ?? row?.querySelector<HTMLElement>("[data-category-name]");
    target?.scrollIntoView?.({ block: "center" });
    target?.focus({ preventScroll: true });
  }, [focusCategory, requested.id]);

  const confirmDelete = async (target: PendingDelete) => {
    setPendingDelete(null);
    setBusy(target.item.id);
    setError("");
    try {
      if (target.kind === "product") await catalogAdminAPI.deleteProduct(target.item.id);
      else if (target.kind === "category") await catalogAdminAPI.deleteCategory(target.item.id);
      else await catalogAdminAPI.deleteDesigner(target.item.id);
      showToast(`Deleted "${target.item.name}"`);
      reload();
    } catch (reason) {
      setError(describeApiError(reason, `"${target.item.name}" could not be deleted.`));
    } finally {
      setBusy("");
    }
  };

  const renderCategory = (category: AdminCatalogCategory, siblings: AdminCatalogCategory[], depth: number) => {
    const index = siblings.indexOf(category);
    const children = categories.children(category.id);
    return (
      <li key={category.id} data-category-row={category.id}>
        {/* The name and the controls share a row while both fit; with less room the controls wrap below the name. */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-light-gray/60 py-1.5 pr-[6px]" style={{ paddingLeft: `${depth * 16 + 6}px` }}>
          <span data-category-name tabIndex={-1} className="min-w-0 flex-1 basis-[10rem] text-xs [overflow-wrap:break-word]">
            <span className={category.isActive ? "font-semibold text-brand-primary" : "text-gray-500 line-through"}>{category.name}</span>
            <span className="ml-2 text-[0.625rem] text-gray-500">{productCount(category.productCount)} · /{category.slug}</span>
            {!category.isActive && <span className="ml-2 rounded-sm bg-gray-100 px-1 text-[0.5625rem] font-bold uppercase text-gray-600">Hidden</span>}
          </span>
          {canWrite && (
            <span className="flex flex-wrap gap-1">
              <MoveButton category={category} direction="up" reasonId={firstReasonId} atEnd={index <= 0} onMove={() => void move(category, siblings, "up")} />
              <MoveButton category={category} direction="down" reasonId={lastReasonId} atEnd={index >= siblings.length - 1} onMove={() => void move(category, siblings, "down")} />
              <button type="button" onClick={() => setCategoryForm({ category, parentId: category.parentId, round: 0 })} className={treeButtonClass} aria-label={`Edit ${category.name}`}>Edit</button>
              <button type="button" onClick={() => setCategoryForm({ category: null, parentId: category.id, round: 0 })} className={treeButtonClass} aria-label={`Add a sub-category to ${category.name}`}>+ Sub</button>
              <button type="button" disabled={busy === category.id} onClick={() => void toggleCategory(category)} className={treeButtonClass} aria-label={`${category.isActive ? "Hide" : "Show"} ${category.name}`} data-show-category={category.isActive ? undefined : ""}>{category.isActive ? "Hide" : "Show"}</button>
              <button type="button" disabled={busy === category.id} onClick={() => setPendingDelete({ kind: "category", item: category })} className={treeDangerClass} aria-label={`Delete ${category.name}`}>Delete</button>
            </span>
          )}
        </div>
        {children.length > 0 && <ul>{children.map((child) => renderCategory(child, children, depth + 1))}</ul>}
      </li>
    );
  };

  const shownNotice = notice || carriedNotice;
  return (
    <div className="space-y-6">
      {shownNotice && <p role="status" className="rounded-md border border-warning/40 bg-warning-tint p-3 text-sm font-semibold text-navy-900">{shownNotice}</p>}
      {!canWrite && <p className="text-sm text-navy-800">View only: your role can see products, categories and designers but cannot change them.</p>}
      <Feedback message={error} tone="error" />

      <Panel
        title="Products"
        description="A hidden product is a draft only staff can see: preview it, then publish it by making it visible to shoppers. Saves go straight to the catalog; demo records never become real inventory."
        actions={canWrite ? <button type="button" onClick={() => openProduct(NEW_PRODUCT)} className={`min-h-[44px] ${primaryButtonClass}`}>Add product</button> : undefined}
      >
        {/* One filter per row on phones; side by side from 768px as room allows. */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input aria-label="Search products" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or tag…" className={`basis-full md:flex-1 md:basis-48 ${filterClass}`} />
          <WrappingSelect aria-label="Filter products by category" value={categoryFilter ?? ""} onChange={(event) => changeFilters({ category: event.target.value || null })} className={`basis-full md:w-56 md:flex-none md:basis-auto ${filterClass}`}>
            <option value="">All categories</option>
            {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </WrappingSelect>
          <WrappingSelect aria-label="Filter products by status" value={status ?? "all"} onChange={(event) => changeFilters({ status: STATUS_OPTIONS.find((item) => item.value === event.target.value && item.value !== "all")?.value as ProductStatusFilter | undefined ?? null })} className={`basis-full md:w-48 md:flex-none md:basis-auto ${filterClass}`}>
            {STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </WrappingSelect>
          <WrappingSelect aria-label="Filter products by readiness" value={readiness ?? "any"} onChange={(event) => changeFilters({ readiness: READINESS_OPTIONS.find((item) => item.value === event.target.value && item.value !== "any")?.value as ProductReadinessFilter | undefined ?? null })} className={`basis-full md:w-48 md:flex-none md:basis-auto ${filterClass}`}>
            {READINESS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </WrappingSelect>
          {/* Shrinks and wraps its words on a narrow phone with enlarged text, where a three-digit count no longer fits one line. */}
          <button
            type="button"
            aria-pressed={readiness === "needs-images"}
            onClick={() => changeFilters({ readiness: readiness === "needs-images" ? null : "needs-images" })}
            className={`min-h-[44px] max-w-full rounded-full border px-4 py-1 text-[0.6875rem] font-bold uppercase tracking-wider ${
              readiness === "needs-images" ? "border-warning bg-warning text-white" : "border-warning/60 bg-white text-warning hover:bg-warning/10"
            }`}
          >
            Needs images ({needingImages})
          </button>
        </div>
        <p className="mb-3 text-[0.6875rem] text-gray-600">{list.length} of {productCount(products.length)}</p>
        {/* Two cards per row on phones while 17rem fits (100% text); with enlarged text one per row, so names and
            labels keep whole words. From 640px the columns follow the viewport (see PRODUCT_TILE_SIZES). */}
        <div className="@container">
          <ul className="grid max-h-[640px] grid-cols-1 gap-3 overflow-y-auto pr-1 max-sm:@[17rem]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {list.slice(0, PRODUCT_LIMIT).map((product) => {
              const image = primaryImage(product);
              const stock = productStock(product);
              const checks = readinessById.get(product.id);
              return (
                <li key={product.id} className="flex min-w-0 flex-col overflow-hidden rounded-md border border-light-gray bg-white">
                  <button type="button" onClick={() => openProduct(product.id)} className="flex-1 text-left" aria-label={`${canWrite ? "Edit" : "View"} ${product.name}`}>
                    <span className="relative block aspect-square overflow-hidden bg-warm-beige">
                      {image
                        ? <ResponsiveImage url={image.url} preset="card" sizes={PRODUCT_TILE_SIZES} width={image.width} height={image.height} alt="" className="h-full w-full object-cover" />
                        : <span className="flex h-full items-center justify-center p-2 text-center text-[0.625rem] font-bold uppercase text-warning">Needs images</span>}
                    </span>
                    <span className="block p-2">
                      <span data-product-name className="block text-xs font-medium text-brand-primary [overflow-wrap:break-word]">{product.name}</span>
                      <span className="block text-[0.625rem] text-gray-600">{formatKES(product.price)} · {stock.quantity} available</span>
                      {checks && <ProductLabels product={product} readiness={checks} sampleCover={Boolean(image?.isPlaceholder)} />}
                    </span>
                  </button>
                  <span className="flex flex-wrap border-t border-light-gray">
                    <Link to={productPreviewRoute(product.id)} aria-label={`Preview ${product.name}`} className="flex min-h-[44px] flex-1 basis-[4.5rem] items-center justify-center px-2 text-[0.625rem] font-bold uppercase tracking-wider text-brand-primary hover:bg-warm-beige">
                      Preview
                    </Link>
                    {canWrite && (
                      <button type="button" disabled={busy === product.id} onClick={() => setPendingDelete({ kind: "product", item: product })} aria-label={`Delete ${product.name}`} className="min-h-[44px] flex-1 basis-[4.5rem] border-l border-light-gray px-2 text-[0.625rem] font-bold uppercase tracking-wider text-error hover:bg-error hover:text-white disabled:opacity-50">
                        Delete
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        {!list.length && <p className="py-10 text-center text-xs text-gray-500">No products match.</p>}
        {list.length > PRODUCT_LIMIT && <p className="mt-3 text-xs text-gray-600">Showing the first {PRODUCT_LIMIT}. Narrow the filters to find others.</p>}
      </Panel>

      {/* Side by side only from 1440px: below that, beside the navigation column, the tree needs the full width to keep
          its move buttons beside each name. */}
      <div className="grid grid-cols-1 gap-6 min-[1440px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel
          title="Categories"
          description="Up and Down set the order shoppers see among a category's siblings. Deleting a category that still has sub-categories or products is refused; move or delete those first, or hide it instead."
          actions={canWrite ? <button type="button" onClick={() => setCategoryForm({ category: null, parentId: null, round: 0 })} className={treeButtonClass}>+ Department</button> : undefined}
        >
          <p id={firstReasonId} hidden>Already first here.</p>
          <p id={lastReasonId} hidden>Already last here.</p>
          <p role="status" className="text-sm font-semibold text-navy-900 empty:hidden [&:not(:empty)]:mb-3">{moveStatus}</p>
          <ul ref={tree} className="relative max-h-[520px] overflow-y-auto">{categories.roots.map((root) => renderCategory(root, categories.roots, 0))}</ul>
          {!categories.roots.length && <p className="py-6 text-center text-xs text-gray-500">No categories yet.</p>}
        </Panel>

        <Panel title="Designers" actions={canWrite ? <button type="button" onClick={() => setDesignerForm({ designer: null })} className={smallButtonClass}>+ Designer</button> : undefined}>
          <ul className="space-y-1.5">
            {designers.map((designer) => (
              <li key={designer.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-light-gray/60 py-1.5 text-xs">
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <span className={designer.isActive ? "font-semibold text-brand-primary" : "text-gray-500 line-through"}>{designer.name}</span>
                  {designer.isDemo && <span className="ml-1.5 rounded-sm bg-ocean-blue/15 px-1 text-[0.5625rem] font-bold uppercase text-ocean-blue">Demo</span>}
                </span>
                {canWrite && (
                  <span className="flex flex-wrap gap-1">
                    <button type="button" onClick={() => setDesignerForm({ designer })} className={smallButtonClass} aria-label={`Edit ${designer.name}`}>Edit</button>
                    <button type="button" disabled={busy === designer.id} onClick={() => setPendingDelete({ kind: "designer", item: designer })} className={dangerButtonClass} aria-label={`Delete ${designer.name}`}>Delete</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {!designers.length && <p className="py-6 text-center text-xs text-gray-500">No designers yet.</p>}
        </Panel>
      </div>

      {(adding || editingProduct) && (
        <ProductEditor
          key={`${editingProduct?.id ?? NEW_PRODUCT}:${editorRound}`}
          product={editingProduct}
          canWrite={canWrite}
          onClose={closeProduct}
          onReload={reloadProduct}
          onShowCategory={showCategory}
          onSaved={(message) => {
            closeProduct();
            showToast(message);
            reload();
          }}
          onDelete={editingProduct && canWrite ? () => {
            closeProduct();
            setPendingDelete({ kind: "product", item: editingProduct });
          } : undefined}
        />
      )}
      {categoryForm && (
        <CategoryForm
          key={`${categoryForm.category?.id ?? "new"}:${categoryForm.round}`}
          category={categoryForm.category}
          defaultParentId={categoryForm.parentId}
          onClose={() => setCategoryForm(null)}
          onReload={categoryForm.category ? () => reloadCategory(categoryForm.category!.id) : undefined}
          onSaved={(saved) => {
            setCategoryForm(null);
            showToast(`Saved category "${saved.name}"`);
            reload();
          }}
        />
      )}
      {designerForm && (
        <DesignerForm
          designer={designerForm.designer}
          onClose={() => setDesignerForm(null)}
          onSaved={(saved) => {
            setDesignerForm(null);
            showToast(`Saved designer "${saved.name}"`);
            reload();
          }}
        />
      )}
      <ConfirmModal
        open={Boolean(pendingDelete)}
        title={pendingDelete ? `Delete this ${pendingDelete.kind}?` : "Delete?"}
        message={pendingDelete
          ? pendingDelete.kind === "product"
            ? `"${pendingDelete.item.name}" will be removed from the catalog. Existing orders keep their own records.`
            : pendingDelete.kind === "category"
            ? `"${pendingDelete.item.name}" will be deleted. This is refused while it still has sub-categories or products.`
            : `"${pendingDelete.item.name}" will be deleted.`
          : undefined}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => { if (pendingDelete) void confirmDelete(pendingDelete); }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
