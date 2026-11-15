import { useMemo, useState } from "react";
import { catalogAdminAPI, type CatalogCategory, type CatalogDesigner, type CatalogProduct } from "../../api/catalog";
import { describeApiError } from "../../api/errors";
import { ConfirmModal } from "../../components/Modal";
import { ResponsiveImage } from "../../components/ui";
import { primaryImage, productStock } from "../../store/catalogModel";
import { formatKES } from "../../utils/format";
import { useAdminCatalog } from "./AdminCatalogContext";
import { CategoryForm, DesignerForm } from "./CatalogForms";
import { ProductEditor } from "./ProductEditor";
import { Feedback, Panel, canEditCatalog, categoryOptions, dangerButtonClass, descendantIds, inputClass, primaryButtonClass, smallButtonClass } from "./shared";

const STATUS_FILTERS = [
  { value: "all", label: "All products" },
  { value: "visible", label: "Visible" },
  { value: "hidden", label: "Hidden" },
  { value: "demo", label: "Demo records" },
  { value: "sample-images", label: "Sample images" },
] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];
const PRODUCT_LIMIT = 120;
/**
 * Rendered width of a product tile image inside its 1px border: 2/3/4/5 columns with `gap-3` in a list with 4px
 * right padding, inside the Panel (20 then 24px padding) and the admin Container (16/24/32px, 1440px at most).
 * Tiles reach ~298px, so they use the card renditions (up to 960px) for 2x screens.
 */
const PRODUCT_TILE_SIZES =
  "(min-width: 1440px) 254px, (min-width: 1280px) calc(20vw - 34.8px), (min-width: 1024px) calc(25vw - 40px), (min-width: 640px) calc(33.34vw - 43px), calc(50vw - 46px)";

type PendingDelete =
  | { kind: "product"; item: CatalogProduct }
  | { kind: "category"; item: CatalogCategory }
  | { kind: "designer"; item: CatalogDesigner };

function matchesStatus(product: CatalogProduct, filter: StatusFilter) {
  switch (filter) {
    case "visible": return product.isActive;
    case "hidden": return !product.isActive;
    case "demo": return product.isDemo;
    case "sample-images": return product.images.some((image) => image.isPlaceholder);
    default: return true;
  }
}

/** No images at all, or only sample/placeholder images: real photography is still needed. */
const needsImages = (product: CatalogProduct) => product.images.every((image) => image.isPlaceholder);

export function CatalogManager({ role, showToast }: { role: string; showToast: (message: string) => void }) {
  const { data, categories, reload } = useAdminCatalog();
  const products = useMemo(() => data?.snapshot.products ?? [], [data]);
  const designers = data?.snapshot.designers ?? [];
  const options = useMemo(() => categoryOptions(categories), [categories]);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [onlyNeedingImages, setOnlyNeedingImages] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<CatalogProduct | "new" | null>(null);
  const [categoryForm, setCategoryForm] = useState<{ category: CatalogCategory | null; parentId: string | null } | null>(null);
  const [designerForm, setDesignerForm] = useState<{ designer: CatalogDesigner | null } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const list = useMemo(() => {
    const term = search.trim().toLowerCase();
    const scope = categoryFilter ? new Set([categoryFilter, ...descendantIds(categories, categoryFilter)]) : null;
    return products.filter((product) =>
      (!scope || scope.has(product.categoryId)) && matchesStatus(product, statusFilter) && (!onlyNeedingImages || needsImages(product)) &&
      (!term || product.name.toLowerCase().includes(term) || product.tags.some((tag) => tag.toLowerCase().includes(term))));
  }, [products, search, categoryFilter, statusFilter, onlyNeedingImages, categories]);
  const needingImages = useMemo(() => products.filter(needsImages).length, [products]);

  const editingProduct = editing && editing !== "new" ? products.find((product) => product.id === editing.id) ?? editing : null;

  const toggleCategory = async (category: CatalogCategory) => {
    setBusy(category.id);
    setError("");
    try {
      await catalogAdminAPI.updateCategory(category.id, { isActive: !category.isActive });
      showToast(category.isActive ? `Hid "${category.name}" and everything below it` : `"${category.name}" is visible again`);
      reload();
    } catch (reason) {
      setError(describeApiError(reason, "The category visibility could not be changed."));
    } finally {
      setBusy("");
    }
  };

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

  const renderCategory = (category: CatalogCategory, depth: number) => (
    <li key={category.id}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-light-gray/60 py-1.5" style={{ paddingLeft: `${depth * 16}px` }}>
        <span className="text-xs">
          <span className={category.isActive ? "font-semibold text-brand-primary" : "text-gray-500 line-through"}>{category.name}</span>
          <span className="ml-2 text-[10px] text-gray-500">{category.productCount} products · /{category.slug}</span>
          {!category.isActive && <span className="ml-2 rounded-sm bg-gray-100 px-1 text-[9px] font-bold uppercase text-gray-600">Hidden</span>}
        </span>
        <span className="flex gap-1">
          <button type="button" onClick={() => setCategoryForm({ category, parentId: category.parentId })} className={smallButtonClass} aria-label={`Edit ${category.name}`}>Edit</button>
          <button type="button" onClick={() => setCategoryForm({ category: null, parentId: category.id })} className={smallButtonClass} aria-label={`Add a sub-category to ${category.name}`}>+ Sub</button>
          <button type="button" disabled={busy === category.id} onClick={() => void toggleCategory(category)} className={smallButtonClass}>{category.isActive ? "Hide" : "Show"}</button>
          <button type="button" disabled={busy === category.id} onClick={() => setPendingDelete({ kind: "category", item: category })} className={dangerButtonClass} aria-label={`Delete ${category.name}`}>Delete</button>
        </span>
      </div>
      {categories.children(category.id).length > 0 && (
        <ul>{categories.children(category.id).map((child) => renderCategory(child, depth + 1))}</ul>
      )}
    </li>
  );

  return (
    <div className="space-y-6">
      <Feedback message={error} tone="error" />

      <Panel
        title="Products"
        description="Products are saved straight to the catalog. Hidden products and demo records never become real inventory through this screen."
        actions={<button type="button" onClick={() => setEditing("new")} className={primaryButtonClass}>Add Product</button>}
      >
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input aria-label="Search products" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or tag…" className={`min-w-0 basis-full md:flex-1 md:basis-48 ${inputClass}`} />
          <select aria-label="Filter products by category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className={`min-w-0 basis-full sm:flex-1 sm:basis-0 md:w-56 md:flex-none ${inputClass}`}>
            <option value="">All categories</option>
            {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <select aria-label="Filter products by status" value={statusFilter} onChange={(event) => setStatusFilter(STATUS_FILTERS.find((item) => item.value === event.target.value)?.value ?? "all")} className={`min-w-0 basis-full sm:flex-1 sm:basis-0 md:w-44 md:flex-none ${inputClass}`}>
            {STATUS_FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <button
            type="button"
            aria-pressed={onlyNeedingImages}
            onClick={() => setOnlyNeedingImages((value) => !value)}
            className={`min-h-[44px] shrink-0 rounded-full border px-4 text-[11px] font-bold uppercase tracking-wider ${
              onlyNeedingImages ? "border-warning bg-warning text-white" : "border-warning/60 bg-white text-warning hover:bg-warning/10"
            }`}
          >
            Needs images ({needingImages})
          </button>
        </div>
        <p className="mb-3 text-[11px] text-gray-600">{list.length} of {products.length} products</p>
        <ul className="grid max-h-[640px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {list.slice(0, PRODUCT_LIMIT).map((product) => {
            const image = primaryImage(product);
            const stock = productStock(product);
            return (
              <li key={product.id} className="flex flex-col overflow-hidden rounded-md border border-light-gray bg-white">
                <button type="button" onClick={() => setEditing(product)} className="flex-1 text-left" aria-label={`Edit ${product.name}`}>
                  <span className="relative block aspect-square overflow-hidden bg-warm-beige">
                    {image
                      ? <ResponsiveImage url={image.url} preset="card" sizes={PRODUCT_TILE_SIZES} width={image.width} height={image.height} alt="" className="h-full w-full object-cover" />
                      : <span className="flex h-full items-center justify-center p-2 text-center text-[10px] font-bold uppercase text-warning">Needs images</span>}
                  </span>
                  <span className="block p-2">
                    <span className="block truncate text-xs font-medium text-brand-primary">{product.name}</span>
                    <span className="block text-[10px] text-gray-600">{formatKES(product.price)} · {stock.quantity} available</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {!product.isActive && <span className="rounded-sm bg-gray-100 px-1 text-[9px] font-bold uppercase text-gray-600">Hidden</span>}
                      {product.isDemo && <span className="rounded-sm bg-ocean-blue/15 px-1 text-[9px] font-bold uppercase text-ocean-blue">Demo</span>}
                      {product.isFeatured && <span className="rounded-sm bg-brand-secondary/20 px-1 text-[9px] font-bold uppercase text-brand-accent">Featured</span>}
                      {image?.isPlaceholder && <span className="rounded-sm bg-warning/15 px-1 text-[9px] font-bold uppercase text-warning">Sample image</span>}
                    </span>
                  </span>
                </button>
                <button type="button" disabled={busy === product.id} onClick={() => setPendingDelete({ kind: "product", item: product })} className="border-t border-light-gray px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-error hover:bg-error hover:text-white disabled:opacity-50">
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
        {!list.length && <p className="py-10 text-center text-xs text-gray-500">No products match.</p>}
        {list.length > PRODUCT_LIMIT && <p className="mt-3 text-xs text-gray-600">Showing the first {PRODUCT_LIMIT}. Narrow the filters to find others.</p>}
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Panel
          title="Categories"
          description="Deleting a category that still has sub-categories or products is refused; move or delete those first, or hide it instead."
          actions={<button type="button" onClick={() => setCategoryForm({ category: null, parentId: null })} className={smallButtonClass}>+ Department</button>}
        >
          <ul className="max-h-[520px] overflow-y-auto">{categories.roots.map((root) => renderCategory(root, 0))}</ul>
          {!categories.roots.length && <p className="py-6 text-center text-xs text-gray-500">No categories yet.</p>}
        </Panel>

        <Panel title="Designers" actions={<button type="button" onClick={() => setDesignerForm({ designer: null })} className={smallButtonClass}>+ Designer</button>}>
          <ul className="space-y-1.5">
            {designers.map((designer) => (
              <li key={designer.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-light-gray/60 py-1.5 text-xs">
                <span>
                  <span className={designer.isActive ? "font-semibold text-brand-primary" : "text-gray-500 line-through"}>{designer.name}</span>
                  {designer.isDemo && <span className="ml-1.5 rounded-sm bg-ocean-blue/15 px-1 text-[9px] font-bold uppercase text-ocean-blue">Demo</span>}
                </span>
                <span className="flex gap-1">
                  <button type="button" onClick={() => setDesignerForm({ designer })} className={smallButtonClass} aria-label={`Edit ${designer.name}`}>Edit</button>
                  <button type="button" disabled={busy === designer.id} onClick={() => setPendingDelete({ kind: "designer", item: designer })} className={dangerButtonClass} aria-label={`Delete ${designer.name}`}>Delete</button>
                </span>
              </li>
            ))}
          </ul>
          {!designers.length && <p className="py-6 text-center text-xs text-gray-500">No designers yet.</p>}
        </Panel>
      </div>

      {editing && (
        <ProductEditor
          key={editing === "new" ? "new" : editing.id}
          product={editingProduct}
          canWrite={canEditCatalog(role)}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            showToast(message);
            reload();
          }}
          onDelete={editingProduct ? () => {
            setEditing(null);
            setPendingDelete({ kind: "product", item: editingProduct });
          } : undefined}
        />
      )}
      {categoryForm && (
        <CategoryForm
          category={categoryForm.category}
          defaultParentId={categoryForm.parentId}
          onClose={() => setCategoryForm(null)}
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
