import { useLayoutEffect, useState, type RefObject } from "react";

/** Read by the root's `scroll-padding-top` in index.css, so focus and scroll-into-view stop below the sticky chrome. */
const HEIGHT_VARIABLE = "--sticky-header-height";
/** The brand row's height: where a sticky search row below it docks. */
const BRAND_VARIABLE = "--sticky-brand-height";
/** On viewports this short (phones in landscape) only the brand row stays sticky. */
const SHORT_VIEWPORT_QUERY = "(max-height: 560px)";
/** The sticky chrome may cover at most this share of the viewport before the search row stops sticking. */
const STICKY_SHARE = 0.25;

/**
 * Publishes the sticky chrome's height on the document root and keeps it in step with every change: breakpoints,
 * the shop's department strip, wrapping at larger text sizes and rotation. The brand row always sticks; the phone
 * search row below it sticks too unless that would cover more than a quarter of a short or zoomed viewport, in which
 * case this returns `true` (compact) and the search row scrolls with the page.
 *
 * Mark every element that is sticky at the time with `data-sticky-header`, so focus inside it never scrolls the page.
 */
export function useStickyHeaderOffset(brand: RefObject<HTMLElement | null>, search?: RefObject<HTMLElement | null>) {
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const brandRow = brand.current;
    if (!brandRow) return;
    const searchRow = search?.current ?? null;
    const root = document.documentElement.style;
    const short = window.matchMedia(SHORT_VIEWPORT_QUERY);
    const publish = () => {
      const brandHeight = Math.ceil(brandRow.getBoundingClientRect().height);
      // A hidden search row (tablet and desktop, where search sits in the brand row) measures 0.
      const searchHeight = searchRow ? Math.ceil(searchRow.getBoundingClientRect().height) : 0;
      const overBudget = searchHeight > 0 && (short.matches || brandHeight + searchHeight > window.innerHeight * STICKY_SHARE);
      setCompact(overBudget);
      root.setProperty(BRAND_VARIABLE, `${brandHeight}px`);
      root.setProperty(HEIGHT_VARIABLE, `${brandHeight + (overBudget ? 0 : searchHeight)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(brandRow);
    if (searchRow) observer.observe(searchRow);
    window.addEventListener("resize", publish);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publish);
      root.removeProperty(HEIGHT_VARIABLE);
      root.removeProperty(BRAND_VARIABLE);
    };
  }, [brand, search]);
  return compact;
}
