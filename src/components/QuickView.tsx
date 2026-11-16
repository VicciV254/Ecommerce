import { useId, useRef, useState } from "react";
import type { CatalogProduct } from "../api/catalog";
import { Link } from "../router";
import { describeVariant } from "../store/catalogModel";
import { addedMessage, useProductSelection } from "../store/useProductSelection";
import { ModalDialog } from "./Modal";
import { ProductGallery, type GalleryLayout } from "./ProductGallery";
import {
  AvailabilityLine,
  OptionChoices,
  PriceLine,
  PurchaseStatus,
  QuantityStepper,
  VAT_AT_CHECKOUT,
  focusFirstOption,
} from "./ProductPurchase";
import { DemoBadge } from "./ui";

/**
 * Quick View's compact gallery: at most 18rem wide in the phone sheet, 24rem in the centred dialog from 768px, and the
 * left column of the 960px two-column dialog from 1280px. Thumbnails are 56px buttons.
 */
const QUICK_VIEW_GALLERY: GalleryLayout = {
  sizes: "(min-width: 1280px) 444px, (min-width: 768px) 384px, 288px",
  thumbnailSizes: "52px",
  thumbnails: "flex flex-wrap gap-2",
  thumbnailItem: "w-[56px]",
  stage: "mx-auto w-full max-w-[18rem] md:max-w-sm xl:max-w-none",
};

const actionClass =
  "inline-flex min-h-[44px] items-center justify-center rounded-sm px-5 text-sm font-bold uppercase tracking-[0.12em] transition-colors duration-(--motion-feedback)";

/**
 * A product preview opened from a listing card. It shares the product page's selection, gallery and Add, so both add
 * identical lines, and uses the catalog record already loaded. Adding confirms in place (no mini-cart); closing
 * returns focus to the card, and the listing's address and scroll position are untouched.
 */
export function QuickView({ product, onClose }: { product: CatalogProduct; onClose: () => void }) {
  const { selection, images, choose, setQuantity, add } = useProductSelection(product);
  const heading = useRef<HTMLHeadingElement>(null);
  const purchase = useRef<HTMLDivElement>(null);
  const statusId = useId();
  const [added, setAdded] = useState<{ key: string; text: string } | null>(null);
  const incomplete = selection.status.kind === "incomplete";
  const addedKey = `${selection.choiceKey}|${selection.quantity}`;
  const confirmation = added?.key === addedKey ? added.text : null;

  const doAdd = () => {
    const outcome = add();
    if (!outcome) return;
    const text = outcome.added > 0 && !outcome.message
      ? "Added to cart."
      : addedMessage(product.name, selection.variant ? describeVariant(selection.variant) : "", outcome);
    setAdded({ key: addedKey, text });
  };

  return (
    <ModalDialog open label={`Quick view: ${product.name}`} placement="sheet" initialFocus={heading} onClose={onClose}>
      <div className="on-light flex h-full w-full flex-col bg-surface text-navy-800 shadow-overlay animate-fade-in md:h-auto md:max-h-[min(92dvh,56rem)] md:max-w-2xl md:rounded-lg xl:max-w-[960px]">
        {/* py-2 leaves room for the close button's focus ring. */}
        <div className="flex items-center justify-between gap-3 border-b border-divider py-2 pl-5 pr-2">
          <p className="text-sm font-semibold text-muted">Quick view</p>
          <button type="button" onClick={onClose} aria-label="Close quick view" className="flex size-[44px] shrink-0 items-center justify-center rounded-full text-navy-900 hover:bg-surface-soft">
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="focus-scroll-room min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          <div className="grid items-start gap-5 xl:grid-cols-2 xl:grid-rows-[auto_1fr] xl:gap-x-8">
            <div className="min-w-0 xl:col-start-2 xl:row-start-1">
              <h2 ref={heading} tabIndex={-1} className="type-h2 break-words text-navy-900">{product.name}</h2>
              {product.isDemo && (
                <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ocean-blue-dark">
                  <DemoBadge />
                  <span>Sample listing for review, not real inventory.</span>
                </p>
              )}
              <div className="mt-3"><PriceLine price={selection.price} large /></div>
              <div className="mt-3"><AvailabilityLine selection={selection} /></div>
            </div>
            <div className="min-w-0 xl:col-start-1 xl:row-span-2 xl:row-start-1">
              <ProductGallery name={product.name} images={images} resetKey={selection.choiceKey} layout={QUICK_VIEW_GALLERY} />
            </div>
            <div ref={purchase} className="min-w-0 space-y-5 xl:col-start-2 xl:row-start-2">
              <OptionChoices selection={selection} onChoose={choose} />
              <QuantityStepper value={selection.quantity} max={selection.maxQuantity} disabled={!selection.canAdd} onChange={setQuantity} />
              <div className="space-y-3">
                <button
                  type="button"
                  disabled={!incomplete && !selection.canAdd}
                  aria-describedby={statusId}
                  onClick={incomplete ? () => focusFirstOption(purchase.current) : doAdd}
                  className={`${actionClass} w-full ${
                    incomplete || selection.canAdd ? "bg-navy-900 text-white hover:bg-gold-500 hover:text-navy-900" : "cursor-not-allowed bg-surface-soft text-muted"
                  }`}
                >
                  {incomplete ? "Choose options" : "Add to cart"}
                </button>
                <PurchaseStatus id={statusId} message={confirmation ? null : selection.message} tone="warning" />
                <div role="status" className={confirmation ? "rounded-md border border-success/30 bg-success-tint p-3" : ""}>
                  {confirmation && (
                    <>
                      <p className="font-semibold text-success">{confirmation}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Link to="/cart" className={`${actionClass} border border-navy-900 bg-surface text-navy-900 hover:bg-surface-soft`}>View cart</Link>
                        <button type="button" onClick={onClose} className={`${actionClass} border border-navy-900 bg-surface text-navy-900 hover:bg-surface-soft`}>Keep shopping</button>
                      </div>
                    </>
                  )}
                </div>
                <p className="text-sm text-muted">{VAT_AT_CHECKOUT}</p>
              </div>
              <Link to={`/product/${encodeURIComponent(product.id)}`} className="inline-flex min-h-[44px] items-center font-semibold text-link underline underline-offset-4 hover:text-link-hover">
                View full details
              </Link>
            </div>
          </div>
        </div>
      </div>
    </ModalDialog>
  );
}
