import { useLayoutEffect, useRef, useState } from "react";
import type { CatalogCategory } from "../api/catalog";
import { Link } from "../router";
import { listingRoute } from "../store/listingQuery";
import { MissingImage, ResponsiveImage, SectionTitle } from "./ui";

/** Each Previous/Next press moves about this share of the visible rail, so the next tiles keep some context. */
const PAGE_SHARE = 0.85;
/** Sub-pixel scroll positions at either end still count as the end. */
const EDGE_TOLERANCE = 1;
/** Tile width: at least 9rem, else 42% of the rail on phones (a third tile peeks in), 22% from 768px, 15% from 1280px. */
const TILE_WIDTH = "basis-[max(42%,9rem)] md:basis-[max(22%,9rem)] xl:basis-[max(15%,9rem)]";
/** The tile widths above as image slot sizes (the 9rem floor only matters on the narrowest phones). */
export const DEPARTMENT_TILE_SIZES = "(min-width: 90em) 208px, (min-width: 80em) 15vw, (min-width: 48em) 22vw, 42vw";

const railButton =
  "flex size-[44px] items-center justify-center rounded-full border border-navy-900 text-navy-900 transition-colors duration-(--motion-feedback) hover:bg-navy-900 hover:text-white";

/**
 * Departments in a rail the shopper scrolls themselves (swipe, scroll or Tab), with Previous/Next buttons shown only
 * when the rail can move that way. Nothing moves on its own and every tile is a single tab stop.
 */
export function DepartmentRail({ title, items }: { title: string; items: readonly CatalogCategory[] }) {
  const rail = useRef<HTMLUListElement>(null);
  const previous = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const focusedControl = useRef<"previous" | "next" | null>(null);
  const [edges, setEdges] = useState({ canPrevious: false, canNext: false });

  useLayoutEffect(() => {
    const element = rail.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      const canPrevious = element.scrollLeft > EDGE_TOLERANCE;
      const canNext = element.scrollLeft + element.clientWidth < element.scrollWidth - EDGE_TOLERANCE;
      setEdges((current) => (current.canPrevious === canPrevious && current.canNext === canNext ? current : { canPrevious, canNext }));
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    element.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [items]);

  // A button that disappears while focused (the rail reached that end) hands focus to the one that remains.
  useLayoutEffect(() => {
    if (focusedControl.current === "next" && !edges.canNext) previous.current?.focus({ preventScroll: true });
    else if (focusedControl.current === "previous" && !edges.canPrevious) next.current?.focus({ preventScroll: true });
  }, [edges]);

  const move = (direction: 1 | -1) => {
    const element = rail.current;
    if (!element) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollBy({ left: direction * element.clientWidth * PAGE_SHARE, behavior: reduced ? "auto" : "smooth" });
  };
  const track = (control: "previous" | "next") => ({
    onFocus: () => { focusedControl.current = control; },
    onBlur: () => { focusedControl.current = null; },
  });

  return (
    <>
      <SectionTitle action={
        <div className="flex items-center gap-2">
          <Link to="/departments" className="inline-flex min-h-[44px] items-center px-1 font-semibold text-link underline underline-offset-4 hover:text-link-hover">
            All departments
          </Link>
          {edges.canPrevious && (
            <button ref={previous} type="button" aria-label="Previous departments" onClick={() => move(-1)} {...track("previous")} className={railButton}>
              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="size-5"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
            </button>
          )}
          {edges.canNext && (
            <button ref={next} type="button" aria-label="Next departments" onClick={() => move(1)} {...track("next")} className={railButton}>
              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="size-5"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
            </button>
          )}
        </div>
      }>
        {title}
      </SectionTitle>
      {/* An intentional horizontal scroller: the partly shown last tile signals that more follow. */}
      <ul ref={rail} aria-label={title} className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-1">
        {items.map((category) => (
          <li key={category.id} className={`shrink-0 snap-start ${TILE_WIDTH}`}>
            <DepartmentTile category={category} />
          </li>
        ))}
      </ul>
    </>
  );
}

function DepartmentTile({ category }: { category: CatalogCategory }) {
  return (
    <Link to={listingRoute({ cat: category.slug })} className="group relative block aspect-[4/5] overflow-hidden rounded-lg bg-surface-warm">
      {category.image ? (
        <ResponsiveImage
          url={category.image}
          preset="card"
          sizes={DEPARTMENT_TILE_SIZES}
          alt=""
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
        />
      ) : (
        <span className="absolute inset-0"><MissingImage label="No department image" iconOnly /></span>
      )}
      {/*
        The caption has its own dim band, so it stays legible over any artwork, plain white included. Its minimum height
        fits a two-line name, so the bands line up along the rail whether a name takes one line or two.
      */}
      <span className="absolute inset-x-0 bottom-0 flex min-h-[4.75rem] flex-col justify-end bg-navy-950/85 px-3 py-2.5 md:min-h-[5.75rem] md:px-4 md:py-3">
        <span className="block break-words font-display text-sm uppercase tracking-wider text-white sm:text-base">{category.name}</span>
        <span className="mt-0.5 block text-xs text-on-navy-muted">
          {category.productCount} {category.productCount === 1 ? "product" : "products"}
        </span>
      </span>
    </Link>
  );
}

/** The rail's shape while the catalog loads. */
export function DepartmentRailSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mb-5 h-8 w-64 max-w-full rounded-sm bg-surface-soft" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className={`aspect-[4/5] shrink-0 rounded-lg bg-surface-soft ${TILE_WIDTH}`} />
        ))}
      </div>
    </div>
  );
}
