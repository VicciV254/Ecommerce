import { useMemo } from "react";
import type { CatalogProduct } from "../../api/catalog";
import { ModalDialog } from "../../components/Modal";
import { formatKES } from "../../utils/format";
import { useAdminCatalog } from "./AdminCatalogContext";
import { ProductImagesSection, initialGallery } from "./ProductImages";
import { TableRegion } from "./shared";
import { useImageUploads } from "./useImageUploads";

const sectionTitle = "text-[11px] font-bold uppercase tracking-wider text-brand-primary";
const termClass = "text-xs font-semibold text-muted";
const valueClass = "text-sm text-navy-900 [overflow-wrap:anywhere]";
const ignore = () => undefined;

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-x-6 gap-y-3">
      {rows.map(([term, value]) => (
        <div key={term} className="min-w-0">
          <dt className={termClass}>{term}</dt>
          <dd className={valueClass}>{value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A product as roles without catalog writes see it: the same dialog as the editor, with every value as text and P6's
 * read-only image list. Nothing here can change the product.
 */
export function ProductDetails({ product, onClose }: { product: CatalogProduct; onClose: () => void }) {
  const { data, categories } = useAdminCatalog();
  const gallery = useMemo(() => initialGallery(product), [product]);
  // The image list needs an upload state; with no upload controls shown it never starts one.
  const uploads = useImageUploads(() => null, []);
  const designer = data?.snapshot.designers.find((item) => item.id === product.designerId);
  const optionKeys = [...new Set(product.variants.flatMap((variant) => Object.keys(variant.attributes)))];
  const specifications = Object.entries(product.specifications);

  return (
    <ModalDialog open label="Product details" onClose={onClose}>
      <div className="relative flex h-full max-h-[calc(100dvh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-light-gray px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg text-brand-primary [overflow-wrap:anywhere]">{product.name}</h2>
            {product.isDemo && <p className="text-[11px] font-semibold text-ocean-blue">Demo record: sample data, not a real listing.</p>}
          </div>
          <button type="button" aria-label="Close product details" onClick={onClose} className="flex size-[44px] shrink-0 items-center justify-center rounded-full hover:bg-warm-beige">
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="focus-scroll-room min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-5">
          <p className="text-sm text-navy-800">View only: your role can see this product but cannot change it.</p>

          <section className="space-y-3">
            <h3 className={sectionTitle}>Details</h3>
            <Facts rows={[
              ["Description", product.description],
              ["Price", formatKES(product.price)],
              ["Compare-at price", product.comparePrice != null ? formatKES(product.comparePrice) : "None"],
              ["Category", categories.path(product.categoryId).map((category) => category.name).join(" › ") || product.categoryId],
              ["Designer", designer?.name ?? "None"],
              ["Tags", product.tags.join(", ") || "None"],
              ["Collection", product.collection ?? "None"],
              ["Visible to shoppers", product.isActive ? "Yes" : "No (hidden)"],
              ["Featured", product.isFeatured ? "Yes" : "No"],
            ]} />
          </section>

          <section className="space-y-3">
            <h3 className={sectionTitle}>Specifications</h3>
            {specifications.length
              ? <Facts rows={specifications} />
              : <p className="text-sm text-muted">No specifications recorded.</p>}
          </section>

          <section className="space-y-3">
            <h3 className={sectionTitle}>Variants (sellable SKUs)</h3>
            {product.variants.length ? (
              <TableRegion label="Variants" className="-my-[6px]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-light-gray text-left text-[10px] font-bold uppercase tracking-wider text-gray-600">
                      <th className="py-2 pr-2">SKU</th>
                      {optionKeys.map((key) => <th key={key} className="pr-2">{key}</th>)}
                      <th className="pr-2">Price</th>
                      <th className="pr-2">Active</th>
                      <th>On hand</th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.variants.map((variant) => (
                      <tr key={variant.id} className="border-b border-light-gray/60">
                        <td className="py-2 pr-2"><code className="text-[11px]">{variant.sku}</code></td>
                        {optionKeys.map((key) => <td key={key} className="pr-2">{variant.attributes[key] ?? "—"}</td>)}
                        <td className="whitespace-nowrap pr-2">{formatKES(variant.price)}</td>
                        <td className="pr-2">{variant.isActive ? "Yes" : "No"}</td>
                        <td className="whitespace-nowrap text-gray-600">
                          <span className="font-semibold text-charcoal">{variant.onHand}</span>
                          <span className="block text-[10px]">{variant.reserved} reserved · {variant.stock} available</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableRegion>
            ) : <p className="text-sm text-muted">No variants.</p>}
          </section>

          <ProductImagesSection
            rows={gallery.rows}
            mainImage={gallery.cover}
            canWrite={false}
            locked={false}
            variants={product.variants}
            variantHint={null}
            uploads={uploads}
            onEdit={ignore}
            onMainChange={ignore}
            onMove={ignore}
            onRemove={ignore}
          />
        </div>
      </div>
    </ModalDialog>
  );
}
