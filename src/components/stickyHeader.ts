import { useLayoutEffect, type RefObject } from "react";

/** Read by the root's `scroll-padding-top` in index.css, so focus and scroll-into-view stop below the sticky header. */
const HEIGHT_VARIABLE = "--sticky-header-height";

/**
 * Publishes the sticky header's current height on the document root and keeps it in step with every change:
 * breakpoints, the shop's department strip, and wrapping at larger text sizes. Mark the same element with
 * `data-sticky-header` so focus inside it never scrolls the page.
 */
export function useStickyHeaderOffset(header: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const element = header.current;
    if (!element) return;
    const root = document.documentElement.style;
    const publish = () => root.setProperty(HEIGHT_VARIABLE, `${Math.ceil(element.getBoundingClientRect().height)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.removeProperty(HEIGHT_VARIABLE);
    };
  }, [header]);
}
