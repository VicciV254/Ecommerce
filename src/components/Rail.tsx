import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useRevealRow } from "./reveal";

/** Each Previous/Next press moves about this share of the visible rail, so the next items keep some context. */
const PAGE_SHARE = 0.85;
/** Sub-pixel scroll positions at either end still count as the end. */
const EDGE_TOLERANCE = 1;

const railButton =
  "flex size-[44px] shrink-0 items-center justify-center rounded-full border border-navy-900 text-navy-900 transition-colors duration-(--motion-feedback) hover:bg-navy-900 hover:text-white";

type Control = "previous" | "next";

/**
 * A row shoppers scroll themselves (swipe, scroll or Tab). Nothing moves on its own: Previous and Next appear only when
 * the row can move that way, and under reduced motion a press moves it at once. When the focused control disappears,
 * focus goes to the one that remains or, when neither does (the row no longer overflows), to the row's own link.
 * `items` re-measures the row when its content changes.
 */
export function useRail(items: unknown) {
  const rail = useRef<HTMLUListElement>(null);
  const previous = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const link = useRef<HTMLAnchorElement>(null);
  const focusedControl = useRef<Control | null>(null);
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

  // Only focus lost with its control moves: wherever else the person has moved focus, it stays.
  useLayoutEffect(() => {
    const control = focusedControl.current;
    const lost = !document.activeElement || document.activeElement === document.body;
    const gone = control === "next" ? !edges.canNext : control === "previous" && !edges.canPrevious;
    if (!control || !lost || !gone) return;
    const other = control === "next" ? (edges.canPrevious ? previous : null) : (edges.canNext ? next : null);
    if (other) {
      other.current?.focus({ preventScroll: true });
    } else {
      focusedControl.current = null;
      link.current?.focus({ preventScroll: true });
    }
  }, [edges]);

  const move = (direction: 1 | -1) => {
    const element = rail.current;
    if (!element) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollBy({ left: direction * element.clientWidth * PAGE_SHARE, behavior: reduced ? "auto" : "smooth" });
  };
  const track = (control: Control) => ({
    onFocus: () => { focusedControl.current = control; },
    onBlur: () => { focusedControl.current = null; },
  });

  // The row is also watched for its scroll reveal (its cards show together as it scrolls into view).
  const revealRow = useRevealRow<HTMLUListElement>();
  const list = useCallback((element: HTMLUListElement | null) => {
    rail.current = element;
    const stop = revealRow(element);
    return () => {
      rail.current = null;
      stop?.();
    };
  }, [revealRow]);
  return { rail, list, previous, next, link, edges, move, track };
}

type Rail = ReturnType<typeof useRail>;

/** A rail's Previous and Next buttons, each shown only while the rail can move that way. */
export function RailControls({ rail, previousLabel, nextLabel }: { rail: Rail; previousLabel: string; nextLabel: string }) {
  return (
    <>
      {rail.edges.canPrevious && (
        <button ref={rail.previous} type="button" aria-label={previousLabel} onClick={() => rail.move(-1)} {...rail.track("previous")} className={railButton}>
          <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="size-5"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
        </button>
      )}
      {rail.edges.canNext && (
        <button ref={rail.next} type="button" aria-label={nextLabel} onClick={() => rail.move(1)} {...rail.track("next")} className={railButton}>
          <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="size-5"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
        </button>
      )}
    </>
  );
}
