import { useCallback, useMemo, useRef, useState } from "react";
import {
  catalogAdminAPI,
  type CatalogCategory,
  type CatalogDesigner,
  type CatalogProduct,
  type ProductInput,
  type VariantInput,
} from "../../api/catalog";
import { describeApiError } from "../../api/errors";
import { ModalDialog } from "../../components/Modal";
import { useAdminCatalog } from "./AdminCatalogContext";
import { NEW_PRODUCT, adminModuleRoute, parseProductParam, routePath } from "./adminRoutes";
import { CategoryForm, DesignerForm } from "./CatalogForms";
import { ProductDetails } from "./ProductDetails";
import { ProductImagesSection, buildImages, imageProblems, initialGallery, placeUpload, uploadedImageRow, type ImageRow } from "./ProductImages";
import {
  Feedback,
  Field,
  TableRegion,
  categoryOptions,
  dangerButtonClass,
  inputClass,
  primaryButtonClass,
  smallButtonClass,
} from "./shared";
import { useUnsavedChanges } from "./unsavedChanges";
import { MAX_PRODUCT_IMAGES, useImageUploads } from "./useImageUploads";

const OPTION_KEY = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX_OPTION_KEYS = 8;
const MAX_VARIANTS = 50;
const MIN_NAME = 3;
const MIN_DESCRIPTION = 10;
/** Specification bounds accepted by the catalog API. */
const MAX_SPECS = 32;
const MAX_SPEC_NAME = 60;
const MAX_SPEC_VALUE = 500;

type VariantRow = {
  rowKey: string;
  id?: string;
  sku: string;
  values: Record<string, string>;
  /** Blank means the SKU follows the product base price. */
  priceOverride: string;
  initialOverride: string;
  isActive: boolean;
  initialStock: string;
};

type SpecRow = { rowKey: string; name: string; value: string };

let rowCounter = 0;
const nextKey = () => `row-${(rowCounter += 1)}`;

function initialVariants(product: CatalogProduct | null): { keys: string[]; rows: VariantRow[] } {
  if (!product) return { keys: [], rows: [] };
  const keys: string[] = [];
  for (const variant of product.variants) {
    for (const key of Object.keys(variant.attributes)) if (!keys.includes(key)) keys.push(key);
  }
  const rows = product.variants.map((variant) => {
    const override = variant.price !== product.price ? String(variant.price) : "";
    return {
      rowKey: nextKey(), id: variant.id, sku: variant.sku, values: { ...variant.attributes },
      priceOverride: override, initialOverride: override, isActive: variant.isActive, initialStock: "",
    };
  });
  return { keys, rows };
}

function splitTags(value: string) {
  return [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))];
}

type EditorProps = {
  product: CatalogProduct | null;
  /** Roles that cannot write get the read-only product details instead of the form. */
  canWrite: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  onDelete?: () => void;
};

/** The product dialog: the editing form for roles that may write, read-only details for the rest. */
export function ProductEditor(props: EditorProps) {
  if (!props.canWrite && props.product) return <ProductDetails product={props.product} onClose={props.onClose} />;
  return <ProductForm {...props} />;
}

function ProductForm({ product, canWrite, onClose, onSaved, onDelete }: EditorProps) {
  const { data, categories, reload } = useAdminCatalog();
  const designers = data?.snapshot.designers ?? [];
  const options = useMemo(() => categoryOptions(categories), [categories]);
  const variantSeed = useMemo(() => initialVariants(product), [product]);
  const gallerySeed = useMemo(() => initialGallery(product), [product]);

  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [compareAt, setCompareAt] = useState(product?.comparePrice != null ? String(product.comparePrice) : "");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const [designerId, setDesignerId] = useState(product?.designerId ?? "");
  const [tags, setTags] = useState((product?.tags ?? []).join(", "));
  const [collection, setCollection] = useState(product?.collection ?? "");
  const [isActive, setIsActive] = useState(product?.isActive ?? false);
  const [isFeatured, setIsFeatured] = useState(product?.isFeatured ?? false);
  const [specs, setSpecs] = useState<SpecRow[]>(() =>
    Object.entries(product?.specifications ?? {}).map(([specName, value]) => ({ rowKey: nextKey(), name: specName, value })));
  const [optionKeys, setOptionKeys] = useState<string[]>(variantSeed.keys);
  const [variants, setVariants] = useState<VariantRow[]>(variantSeed.rows);
  const [variantsDirty, setVariantsDirty] = useState(false);
  const [images, setImages] = useState<ImageRow[]>(gallerySeed.rows);
  const imagesRef = useRef(gallerySeed.rows);
  const [mainImage, setMainImage] = useState(gallerySeed.cover);
  const [imagesDirty, setImagesDirty] = useState(false);
  const [newOption, setNewOption] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState<"category" | "designer" | null>(null);
  // Unsaved when any value differs from what was loaded, an image changed, an upload is under way or an option name is typed.
  const formState = JSON.stringify({
    name, description, price, compareAt, categoryId, designerId, tags, collection, isActive, isFeatured, optionKeys, newOption,
    specs: specs.map((spec) => [spec.name, spec.value]),
    variants: variants.map(({ rowKey: _key, ...row }) => row),
  });
  const [loadedState] = useState(formState);
  const productKey = product?.id ?? NEW_PRODUCT;
  // Only this product's address keeps the editor open.
  const keeps = useCallback(
    (route: string) => routePath(route) === adminModuleRoute("products") && parseProductParam(route).id === productKey,
    [productKey],
  );

  const category: CatalogCategory | undefined = categories.byId.get(categoryId);
  // Suggestions come from the chosen category and every ancestor department.
  const suggestedSpecs = [...new Set(categories.path(categoryId).flatMap((item) => item.attributeKeys))]
    .filter((key) => !specs.some((spec) => spec.name.trim() === key));

  const editVariants = (update: (rows: VariantRow[]) => VariantRow[]) => {
    setVariants(update);
    setVariantsDirty(true);
  };
  const editImages = (update: (rows: ImageRow[]) => ImageRow[]) => {
    // Kept in step synchronously, so uploads finishing between renders are placed against the latest rows.
    const next = update(imagesRef.current);
    imagesRef.current = next;
    setImages(next);
    setImagesDirty(true);
  };
  const uploads = useImageUploads((target, upload) => {
    const next = placeUpload(imagesRef.current, target, uploadedImageRow(upload));
    if (!next) return `A product can have at most ${MAX_PRODUCT_IMAGES} images.`;
    editImages(() => next);
    return null;
  }, images.map((row) => row.rowKey));
  const { confirmLeave, release } = useUnsavedChanges(formState !== loadedState || imagesDirty || uploads.busy, "Product editor", keeps);

  const addOptionKey = () => {
    const key = newOption.trim();
    if (!OPTION_KEY.test(key) || optionKeys.includes(key) || optionKeys.length >= MAX_OPTION_KEYS) return;
    setOptionKeys((keys) => [...keys, key]);
    setNewOption("");
    setVariantsDirty(true);
  };
  const removeOptionKey = (key: string) => {
    setOptionKeys((keys) => keys.filter((item) => item !== key));
    editVariants((rows) => rows.map((row) => {
      const { [key]: _removed, ...values } = row.values;
      return { ...row, values };
    }));
  };
  const moveImage = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= images.length) return;
    editImages((rows) => {
      const next = [...rows];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    if (mainImage === index) setMainImage(target);
    else if (mainImage === target) setMainImage(index);
  };
  const removeImage = (index: number) => {
    editImages((rows) => rows.filter((_, position) => position !== index));
    setMainImage((current) => (current === index ? 0 : current > index ? current - 1 : current));
  };

  const problems: string[] = [];
  if (name.trim().length < MIN_NAME) problems.push(`Name needs at least ${MIN_NAME} characters.`);
  if (description.trim().length < MIN_DESCRIPTION) problems.push(`Description needs at least ${MIN_DESCRIPTION} characters.`);
  if (!(Number(price) > 0)) problems.push("Enter a base price above zero.");
  if (compareAt.trim() && !(Number(compareAt) > 0)) problems.push("Compare-at price must be above zero, or left empty.");
  if (!category) problems.push("Choose a category.");
  if (new Set(specs.map((spec) => spec.name.trim()).filter(Boolean)).size !== specs.filter((spec) => spec.name.trim()).length) {
    problems.push("Specification names must be unique.");
  }
  for (const row of variants) {
    if (row.isActive && optionKeys.some((key) => !row.values[key]?.trim())) problems.push("Every active variant needs a value for each option.");
    if (row.priceOverride.trim() && !(Number(row.priceOverride) > 0)) problems.push("Variant price overrides must be above zero.");
    if (!row.id && row.initialStock.trim() && !(Number.isInteger(Number(row.initialStock)) && Number(row.initialStock) >= 0)) {
      problems.push("Initial stock must be a whole number of zero or more.");
    }
  }
  if (isActive && variants.length > 0 && !variants.some((row) => row.isActive)) problems.push("A visible product needs at least one active variant.");
  problems.push(...imageProblems(images));
  if (uploads.busy) problems.push("Wait for image uploads to finish, or cancel them, before saving.");
  const uniqueProblems = [...new Set(problems)];

  const buildVariants = (): VariantInput[] => variants.map((row) => {
    const attributes = Object.fromEntries(optionKeys.flatMap((key) => {
      const value = row.values[key]?.trim();
      return value ? [[key, value]] : [];
    }));
    if (row.id) {
      const entry: VariantInput = { id: row.id, attributes, isActive: row.isActive };
      if (row.priceOverride.trim() !== row.initialOverride) entry.price = row.priceOverride.trim() ? Number(row.priceOverride) : null;
      return entry;
    }
    return {
      ...(row.sku.trim() ? { sku: row.sku.trim() } : {}),
      attributes,
      ...(row.priceOverride.trim() ? { price: Number(row.priceOverride) } : {}),
      isActive: row.isActive,
      stock: { quantity: row.initialStock.trim() ? Number(row.initialStock) : 0 },
    };
  });

  const save = async () => {
    if (uniqueProblems.length) {
      setError(uniqueProblems.join(" "));
      return;
    }
    setSaving(true);
    setError("");
    const fields: ProductInput = {
      name: name.trim(),
      description: description.trim(),
      price: Number(price),
      compareAtPrice: compareAt.trim() ? Number(compareAt) : null,
      categoryId,
      designerId: designerId || null,
      tags: splitTags(tags),
      collection: collection.trim() || null,
      specifications: Object.fromEntries(specs.filter((spec) => spec.name.trim() && spec.value.trim()).map((spec) => [spec.name.trim(), spec.value.trim()])),
      isActive,
      isFeatured,
    };
    try {
      if (product) {
        await catalogAdminAPI.updateProduct(product.id, {
          ...fields,
          ...(variantsDirty ? { variants: buildVariants() } : {}),
          ...(imagesDirty ? { images: buildImages(images, mainImage) } : {}),
        });
      } else {
        await catalogAdminAPI.createProduct({
          ...fields,
          ...(variants.length ? { variants: buildVariants() } : {}),
          images: buildImages(images, mainImage),
        });
      }
      release();
      onSaved(product ? `Saved "${fields.name}"` : `Created "${fields.name}"`);
    } catch (reason) {
      setError(describeApiError(reason, "The product could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalDialog open label={product ? "Edit product" : "Add product"} onClose={onClose}>
      <div className="relative flex h-full max-h-[calc(100dvh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-light-gray px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate font-display text-lg text-brand-primary">{product ? product.name : "Add product"}</h2>
            {product?.isDemo && <p className="text-[11px] font-semibold text-ocean-blue">Demo record: it stays a demo listing however it is edited.</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void save()} disabled={saving} className={primaryButtonClass}>
              {saving ? "Saving…" : "Save Product"}
            </button>
            {onDelete && <button type="button" onClick={() => confirmLeave(onDelete)} className={dangerButtonClass}>Delete</button>}
            <button type="button" aria-label="Close product editor" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-warm-beige">
              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-5">
          <Feedback message={error} tone="error" />

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-brand-primary">Details</h3>
              <Field label="Name">{(id) => <input id={id} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />}</Field>
              <Field label="Description">{(id) => <textarea id={id} rows={5} value={description} onChange={(event) => setDescription(event.target.value)} className={inputClass} />}</Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Price (KES)">{(id) => <input id={id} type="number" min={0.01} step={0.01} value={price} onChange={(event) => setPrice(event.target.value)} className={inputClass} />}</Field>
                <Field label="Compare-at price (optional)">{(id) => <input id={id} type="number" min={0.01} step={0.01} value={compareAt} onChange={(event) => setCompareAt(event.target.value)} className={inputClass} />}</Field>
              </div>
              <Field label="Category">
                {(id) => (
                  <div className="flex gap-2">
                    <select id={id} value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={`min-w-0 flex-1 ${inputClass}`}>
                      <option value="">Choose a category…</option>
                      {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </select>
                    <button type="button" aria-label="Create category" onClick={() => setCreating("category")} className={smallButtonClass}>+ New</button>
                  </div>
                )}
              </Field>
              <Field label="Designer">
                {(id) => (
                  <div className="flex gap-2">
                    <select id={id} value={designerId} onChange={(event) => setDesignerId(event.target.value)} className={`min-w-0 flex-1 ${inputClass}`}>
                      <option value="">None</option>
                      {designers.map((designer: CatalogDesigner) => (
                        <option key={designer.id} value={designer.id}>{designer.name}{designer.isDemo ? " (demo)" : ""}</option>
                      ))}
                    </select>
                    <button type="button" aria-label="Create designer" onClick={() => setCreating("designer")} className={smallButtonClass}>+ New</button>
                  </div>
                )}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tags (comma separated)">{(id) => <input id={id} value={tags} onChange={(event) => setTags(event.target.value)} className={inputClass} />}</Field>
                <Field label="Collection (optional)">{(id) => <input id={id} value={collection} onChange={(event) => setCollection(event.target.value)} className={inputClass} />}</Field>
              </div>
              <div className="flex flex-wrap gap-5">
                <label className="flex items-center gap-2 text-xs font-semibold text-brand-primary">
                  <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} className="h-4 w-4 accent-brand-secondary" />
                  Visible to shoppers
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold text-brand-primary">
                  <input type="checkbox" checked={isFeatured} onChange={(event) => setIsFeatured(event.target.checked)} className="h-4 w-4 accent-brand-secondary" />
                  Featured
                </label>
              </div>
              {!isActive && <p className="text-[11px] text-gray-600">Hidden products are saved but not shown in the store.</p>}
            </div>

            <div className="space-y-3">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-brand-primary">Specifications</h3>
              {specs.map((spec, index) => (
                <div key={spec.rowKey} className="grid grid-cols-[1fr_1.4fr_auto] gap-2">
                  <input aria-label={`Specification ${index + 1} name`} maxLength={MAX_SPEC_NAME} value={spec.name} onChange={(event) => setSpecs((rows) => rows.map((row) => row.rowKey === spec.rowKey ? { ...row, name: event.target.value } : row))} placeholder="Name" className={inputClass} />
                  <input aria-label={`Specification ${index + 1} value`} maxLength={MAX_SPEC_VALUE} value={spec.value} onChange={(event) => setSpecs((rows) => rows.map((row) => row.rowKey === spec.rowKey ? { ...row, value: event.target.value } : row))} placeholder="Value" className={inputClass} />
                  <button type="button" aria-label={`Remove specification ${index + 1}`} onClick={() => setSpecs((rows) => rows.filter((row) => row.rowKey !== spec.rowKey))} className={dangerButtonClass}>×</button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={specs.length >= MAX_SPECS} onClick={() => setSpecs((rows) => [...rows, { rowKey: nextKey(), name: "", value: "" }])} className={smallButtonClass}>+ Specification</button>
                {suggestedSpecs.map((key) => (
                  <button key={key} type="button" disabled={specs.length >= MAX_SPECS} onClick={() => setSpecs((rows) => [...rows, { rowKey: nextKey(), name: key, value: "" }])} className="rounded-full border border-light-gray px-2.5 py-1 text-[11px] text-charcoal hover:border-brand-primary disabled:opacity-50">
                    + {key}
                  </button>
                ))}
              </div>
              {!specs.length && <p className="text-[11px] text-gray-600">Only add facts you can verify for this product.</p>}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-brand-primary">Variants (sellable SKUs)</h3>
            <p className="text-[11px] text-gray-600">
              {product
                ? "On-hand stock for existing SKUs is managed on the Stock tab; reserved units are held for unpaid orders. Removing a row deactivates that SKU."
                : "Leave empty to create one default SKU with zero stock. Add only the combinations you actually sell."}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {optionKeys.map((key) => (
                <span key={key} className="flex items-center gap-1 rounded-full border border-light-gray bg-off-white px-3 py-1 text-[11px]">
                  {key}
                  <button type="button" aria-label={`Remove option ${key}`} onClick={() => removeOptionKey(key)} className="text-gray-500 hover:text-error">×</button>
                </span>
              ))}
              <input aria-label="New option name" value={newOption} onChange={(event) => setNewOption(event.target.value.toLowerCase())} placeholder="Option, e.g. size" className="w-[min(100%,10rem)] min-w-0 rounded-sm border border-light-gray bg-off-white px-2 py-1.5 text-xs" />
              <button type="button" onClick={addOptionKey} disabled={!OPTION_KEY.test(newOption.trim()) || optionKeys.includes(newOption.trim()) || optionKeys.length >= MAX_OPTION_KEYS} className={smallButtonClass}>Add option</button>
            </div>
            {variants.length > 0 && (
              <TableRegion label="Variants" className="-my-[6px]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-light-gray text-left text-[10px] font-bold uppercase tracking-wider text-gray-600">
                      <th className="py-2">SKU</th>
                      {optionKeys.map((key) => <th key={key}>{key}</th>)}
                      <th>Price override</th>
                      <th>Active</th>
                      <th>{product ? "On hand" : "Initial on hand"}</th>
                      <th><span className="sr-only">Remove</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {variants.map((row, index) => {
                      const current = product?.variants.find((variant) => variant.id === row.id);
                      return (
                        <tr key={row.rowKey} className="border-b border-light-gray/60">
                          <td className="py-2 pr-2">
                            {row.id
                              ? <code className="text-[11px]">{row.sku}</code>
                              : <input aria-label={`SKU for new variant ${index + 1}`} value={row.sku} onChange={(event) => editVariants((rows) => rows.map((item) => item.rowKey === row.rowKey ? { ...item, sku: event.target.value } : item))} placeholder="Auto" className="w-28 rounded-sm border border-light-gray px-2 py-1" />}
                          </td>
                          {optionKeys.map((key) => (
                            <td key={key} className="pr-2">
                              <input
                                aria-label={`${key} for variant ${index + 1}`}
                                value={row.values[key] ?? ""}
                                onChange={(event) => editVariants((rows) => rows.map((item) => item.rowKey === row.rowKey ? { ...item, values: { ...item.values, [key]: event.target.value } } : item))}
                                className="w-24 rounded-sm border border-light-gray px-2 py-1"
                              />
                            </td>
                          ))}
                          <td className="pr-2">
                            <input aria-label={`Price override for variant ${index + 1}`} type="number" min={0.01} step={0.01} value={row.priceOverride} placeholder="Base price" onChange={(event) => editVariants((rows) => rows.map((item) => item.rowKey === row.rowKey ? { ...item, priceOverride: event.target.value } : item))} className="w-28 rounded-sm border border-light-gray px-2 py-1" />
                          </td>
                          <td>
                            <input aria-label={`Variant ${index + 1} active`} type="checkbox" checked={row.isActive} onChange={(event) => editVariants((rows) => rows.map((item) => item.rowKey === row.rowKey ? { ...item, isActive: event.target.checked } : item))} className="h-4 w-4 accent-brand-secondary" />
                          </td>
                          <td className="pr-2">
                            {row.id ? (
                              current ? (
                                <span className="whitespace-nowrap text-gray-600">
                                  <span className="font-semibold text-charcoal">{current.onHand}</span>
                                  <span className="block text-[10px]">{current.reserved} reserved · {current.stock} available</span>
                                </span>
                              ) : <span className="text-gray-600">—</span>
                            ) : <input aria-label={`Initial on-hand stock for new variant ${index + 1}`} type="number" min={0} value={row.initialStock} placeholder="0" onChange={(event) => editVariants((rows) => rows.map((item) => item.rowKey === row.rowKey ? { ...item, initialStock: event.target.value } : item))} className="w-20 rounded-sm border border-light-gray px-2 py-1" />}
                          </td>
                          <td>
                            <button type="button" aria-label={`Remove variant ${index + 1}`} onClick={() => editVariants((rows) => rows.filter((item) => item.rowKey !== row.rowKey))} className={dangerButtonClass}>×</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableRegion>
            )}
            <button
              type="button"
              disabled={variants.length >= MAX_VARIANTS}
              onClick={() => editVariants((rows) => [...rows, { rowKey: nextKey(), sku: "", values: {}, priceOverride: "", initialOverride: "", isActive: true, initialStock: "" }])}
              className={smallButtonClass}
            >
              + Variant
            </button>
          </section>

          <ProductImagesSection
            rows={images}
            mainImage={mainImage}
            canWrite={canWrite}
            locked={saving}
            variants={product?.variants ?? []}
            variantHint={!product
              ? "Images can be linked to variants after the product is saved."
              : variants.some((row) => !row.id) ? "Images can be linked to new variants after the product is saved." : null}
            uploads={uploads}
            onEdit={editImages}
            onMainChange={(index) => {
              setMainImage(index);
              setImagesDirty(true);
            }}
            onMove={moveImage}
            onRemove={removeImage}
          />
        </div>
      </div>

      {creating === "category" && (
        <CategoryForm
          category={null}
          defaultParentId={category?.id ?? null}
          keeps={keeps}
          onClose={() => setCreating(null)}
          onSaved={(saved) => {
            setCreating(null);
            setCategoryId(saved.id);
            reload();
          }}
        />
      )}
      {creating === "designer" && (
        <DesignerForm
          designer={null}
          keeps={keeps}
          onClose={() => setCreating(null)}
          onSaved={(saved) => {
            setCreating(null);
            setDesignerId(saved.id);
            reload();
          }}
        />
      )}
    </ModalDialog>
  );
}
