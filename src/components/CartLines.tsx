import { Fragment, useCallback, useLayoutEffect, useRef, useState } from "react";
import { Link } from "../router";
import { lineKey, type CartEstimate, type CartLineView } from "../store/cartModel";
import { useStore, type CartLine } from "../store/StoreContext";
import { formatKES } from "../utils/format";
import { QuantityStepper } from "./ProductPurchase";
import { DemoBadge, MissingImage, ResponsiveImage, SampleImageLabel } from "./ui";

type Removal = { owner: string | null; line: CartLine; index: number; name: string };

/** How a line is named once its product has left the catalog. */
const MISSING_NAME = "Item no longer in the catalog";

/**
 * Removal with Undo for one cart view. Removing a line keeps one Undo (a later removal replaces it); Undo puts the
 * line back where it was with the same quantity. Focus moves to the Undo button, and back to the restored line's
 * Remove button after Undo, so it is never lost. An Undo recorded for another owner is dropped, never applied.
 */
export function useCartUndo() {
  const { state, removeFromCart, restoreLine } = useStore();
  const [removal, setRemoval] = useState<Removal | null>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const focusUndo = useRef(false);
  const restored = useRef<string | null>(null);
  const current = removal && removal.owner === state.personalOwner ? removal : null;

  useLayoutEffect(() => {
    if (!focusUndo.current || !current) return;
    focusUndo.current = false;
    undoButton.current?.focus();
  }, [current]);

  const remove = useCallback((view: CartLineView<CartLine>) => {
    removeFromCart(view.index);
    focusUndo.current = true;
    setRemoval({ owner: state.personalOwner, line: view.line, index: view.index, name: view.product?.name ?? MISSING_NAME });
  }, [removeFromCart, state.personalOwner]);

  const undo = useCallback(() => {
    if (!current) return;
    restoreLine(current.line, current.index, current.owner);
    restored.current = lineKey(current.line);
    setRemoval(null);
  }, [current, restoreLine]);

  return { removal: current, remove, undo, undoButton, restored };
}

export type CartUndo = ReturnType<typeof useCartUndo>;

const PROBLEM_TEXT = {
  unavailable: "No longer available. Remove it to continue.",
  "out-of-stock": "Out of stock. Remove it to continue.",
} as const;

function LineImage({ view, name }: { view: CartLineView<CartLine>; name: string }) {
  if (!view.image) return <MissingImage iconOnly />;
  return (
    <>
      <ResponsiveImage url={view.image.url} preset="thumbnail" sizes="64px" width={view.image.width} height={view.image.height} alt={view.image.alt || name} className="h-full w-full object-cover" />
      {view.image.isPlaceholder && <SampleImageLabel />}
    </>
  );
}

function LineRow({ view, onRemove, onNavigate }: {
  view: CartLineView<CartLine>;
  onRemove: (view: CartLineView<CartLine>) => void;
  onNavigate?: () => void;
}) {
  const { setQuantity } = useStore();
  const name = view.product?.name ?? MISSING_NAME;
  const { line, stock, problem } = view;
  return (
    <div className="flex gap-3 py-4">
      <div className="relative size-[64px] shrink-0 overflow-hidden rounded-md bg-surface-warm">
        <LineImage view={view} name={name} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 [overflow-wrap:anywhere]">
            {view.product ? (
              <Link to={`/product/${encodeURIComponent(view.product.id)}`} onClick={onNavigate} className="font-medium text-navy-900 underline-offset-4 hover:underline">
                {name}
              </Link>
            ) : (
              <p className="font-medium text-navy-900">{MISSING_NAME}</p>
            )}
            {view.product?.isDemo && <DemoBadge className="ml-2 align-middle" />}
            {view.variantLabel && <p className="mt-0.5 text-sm text-muted">{view.variantLabel}</p>}
          </div>
          {view.product ? (
            <button
              type="button"
              data-remove-key={view.key}
              aria-label={`Remove ${name} from cart`}
              onClick={() => onRemove(view)}
              className="-mr-2 -mt-2 flex size-[44px] shrink-0 items-center justify-center rounded-full text-muted transition-colors duration-(--motion-feedback) hover:bg-surface-soft hover:text-error"
            >
              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
          ) : (
            // Nothing names this line any more, so its removal is spelt out.
            <button
              type="button"
              data-remove-key={view.key}
              onClick={() => onRemove(view)}
              className="-mt-2 inline-flex min-h-[44px] shrink-0 items-center rounded-sm border border-error/40 px-3 text-sm font-semibold text-error transition-colors duration-(--motion-feedback) hover:bg-error hover:text-white"
            >
              Remove
            </button>
          )}
        </div>
        {problem === "unavailable" || problem === "out-of-stock" ? (
          <p className="mt-1 text-sm font-semibold text-error">{PROBLEM_TEXT[problem]}</p>
        ) : problem === "over-stock" ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm font-semibold text-warning">
            Only {stock} available.
            <button type="button" onClick={() => setQuantity(view.index, stock)} className="inline-flex min-h-[44px] items-center font-semibold text-link underline underline-offset-4 hover:text-link-hover">
              Change to {stock}
            </button>
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
          <QuantityStepper
            value={line.quantity}
            max={problem === "over-stock" ? line.quantity : Math.max(stock, 1)}
            disabled={problem === "unavailable"}
            name={name}
            onChange={(quantity) => setQuantity(view.index, quantity)}
          />
          {view.unitPrice !== null && view.subtotal !== null && (
            <p className="ml-auto text-right">
              <span className="block text-sm text-muted">
                {view.comparePrice !== null && <s className="mr-1"><span className="sr-only">Was </span>{formatKES(view.comparePrice)}</s>}
                {formatKES(view.unitPrice)} each excl. VAT
              </span>
              <span className="font-semibold tabular-nums text-navy-900">{formatKES(view.subtotal)}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** The estimated subtotal shown by the mini-cart and the cart page; fees not yet known are marked pending, never free. */
export function CartEstimateSummary({ estimate, pendingFees }: { estimate: CartEstimate; pendingFees: boolean }) {
  return (
    <div className="space-y-1">
      <dl className="space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <dt className="font-semibold text-navy-900">Subtotal (excl. VAT)</dt>
          <dd className="font-semibold tabular-nums text-navy-900">{formatKES(estimate.subtotal)}</dd>
        </div>
        {pendingFees && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <dt className="text-navy-800">VAT (16%) and delivery</dt>
            <dd className="text-muted">Calculated at checkout</dd>
          </div>
        )}
      </dl>
      <p className="text-xs text-muted">
        Estimated from current prices.{estimate.excluded > 0 && ` Leaves out ${estimate.excluded} unavailable ${estimate.excluded === 1 ? "item" : "items"}.`}
      </p>
    </div>
  );
}

/**
 * The cart's lines with editing, removal and Undo, identical in the mini-cart and on the cart page. The Undo row
 * takes the removed line's place.
 */
export function CartLines({ views, undo, label, onNavigate }: {
  views: CartLineView<CartLine>[];
  undo: CartUndo;
  label: string;
  /** Called before a product link navigates (the drawer closes itself). */
  onNavigate?: () => void;
}) {
  const list = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    const key = undo.restored.current;
    if (key === null) return;
    const button = [...(list.current?.querySelectorAll<HTMLButtonElement>("[data-remove-key]") ?? [])].find((item) => item.dataset.removeKey === key);
    if (!button) return;
    undo.restored.current = null;
    button.focus();
  });

  const { removal } = undo;
  const undoAt = removal ? Math.min(removal.index, views.length) : -1;
  const undoRow = removal && (
    <li key="undo" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3">
      <p className="min-w-0 text-sm text-navy-800 [overflow-wrap:anywhere]">Removed {removal.name}.</p>
      <button
        ref={undo.undoButton}
        type="button"
        aria-label={`Undo removing ${removal.name}`}
        onClick={undo.undo}
        className="inline-flex min-h-[44px] items-center rounded-sm px-2 font-semibold text-link underline underline-offset-4 hover:text-link-hover"
      >
        Undo
      </button>
    </li>
  );
  if (!views.length && !removal) return null;
  return (
    <ul ref={list} aria-label={label} className="divide-y divide-divider">
      {views.map((view, position) => (
        <Fragment key={view.key}>
          {position === undoAt && undoRow}
          <li><LineRow view={view} onRemove={undo.remove} onNavigate={onNavigate} /></li>
        </Fragment>
      ))}
      {undoAt === views.length && undoRow}
    </ul>
  );
}
