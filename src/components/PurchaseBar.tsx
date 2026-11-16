import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { PriceView } from "../store/catalogModel";
import { PriceLine } from "./ProductPurchase";

/** Published on the document root: `index.css` pads the page and the focus scroll area by the bar's height. */
const HEIGHT_VARIABLE = "--purchase-bar-height";
/** Read from the root: the sticky header covers this much of the top of the viewport. */
const HEADER_VARIABLE = "--sticky-header-height";

/** Whether `element` is wholly outside what the shopper can see: above the sticky header or below the viewport. */
function offScreen(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const header = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(HEADER_VARIABLE)) || 0;
  return rect.bottom <= header || rect.top >= window.innerHeight;
}

/**
 * The phone purchase bar (product pages below 1024px): the price excluding VAT and one action, shown only while the
 * page's own Add button is completely off screen. It is never shown on short viewports or while a dialog is open
 * (see `index.css`), sits above the bottom safe area, and the page reserves its height so focus is never hidden behind it.
 */
export function PurchaseBar({ inlineAction, price, canAdd, onAdd, onChooseOptions }: {
  inlineAction: RefObject<HTMLElement | null>;
  price: PriceView | null;
  canAdd: boolean;
  onAdd: () => void;
  onChooseOptions: () => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const target = inlineAction.current;
    if (!target) return;
    let frame = 0;
    const check = () => setShown(offScreen(target));
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [inlineAction]);

  useLayoutEffect(() => {
    const element = bar.current;
    if (!element) return;
    const root = document.documentElement.style;
    // A bar that is not displayed (wide or short viewports) measures 0, so nothing is reserved for it.
    const publish = () => root.setProperty(HEIGHT_VARIABLE, `${Math.ceil(element.getBoundingClientRect().height)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    window.addEventListener("resize", publish);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publish);
      root.removeProperty(HEIGHT_VARIABLE);
    };
  }, []);

  return (
    <div
      ref={bar}
      data-purchase-bar
      data-shown={shown ? "" : undefined}
      className={`on-light fixed inset-x-0 bottom-0 z-40 border-t border-divider bg-surface px-4 pt-2 shadow-overlay transition-[translate,visibility] duration-(--motion-overlay) pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-6 lg:hidden ${
        shown ? "visible translate-y-0" : "invisible translate-y-full"
      }`}
    >
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="min-w-0"><PriceLine price={price} /></div>
        <button
          type="button"
          onClick={canAdd ? onAdd : onChooseOptions}
          className="inline-flex min-h-[44px] items-center justify-center rounded-sm bg-navy-900 px-5 text-sm font-bold uppercase tracking-[0.12em] text-white transition-colors duration-(--motion-feedback) hover:bg-gold-500 hover:text-navy-900"
        >
          {canAdd ? "Add to cart" : "Choose options"}
        </button>
      </div>
    </div>
  );
}
