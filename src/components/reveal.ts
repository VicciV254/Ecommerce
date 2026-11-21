import { useCallback } from "react";
import { prefersReducedMotion, watchReducedMotion } from "./motion";

/**
 * Scroll reveals ("pop-in"). One shared IntersectionObserver watches every revealable element. At its first report an
 * element is hidden only if it lies wholly below the window, so the first screen (and anything a restored scroll
 * position shows) is never hidden; a hidden element shows, once, when its top comes into view. Elements that show
 * together are staggered by their order. Focus moving inside a hidden element shows it at once. Nothing is hidden under
 * reduced motion (and turning it on shows everything) or without IntersectionObserver; the CSS (`index.css`) also forces
 * everything visible in print and under reduced motion. The state lives in `data-reveal`, which renders never touch, so a
 * shown element never hides again.
 *
 * A row that scrolls sideways is watched as one: cards beyond its visible part never come into the window themselves
 * (the row clips them), so the row's cards hide and show together, staggered by their order, growing slightly rather
 * than rising, which would add overflow to the row.
 */
export type RevealOptions = {
  /** Staggered with the others that show at the same time (cards in a grid). */
  stagger?: boolean;
  /** "scale": a slight grow instead of a rise. */
  variant?: "rise" | "scale";
};

const STAGGER_STEP_MS = 60;
const STAGGER_MAX_MS = 300;
/** Shows elements once their top is a tenth of the window above its bottom edge, however tall they are. */
const ROOT_MARGIN = "0px 0px -10% 0px";

type Watched = { stagger: boolean; variant: "rise" | "scale"; row: boolean; reported: boolean };
const watched = new Map<HTMLElement, Watched>();
let observer: IntersectionObserver | null = null;
let stopWatchingMotion: (() => void) | null = null;

const staggerDelay = (order: number) => Math.min(order * STAGGER_STEP_MS, STAGGER_MAX_MS);

function teardown() {
  observer?.disconnect();
  observer = null;
  stopWatchingMotion?.();
  stopWatchingMotion = null;
  document.removeEventListener("focusin", onFocusIn, true);
}

function forget(element: HTMLElement) {
  if (!watched.delete(element)) return;
  observer?.unobserve(element);
  if (!watched.size) teardown();
}

/** The elements that carry the hidden or shown state: a row's cards, or the element itself. */
const targetsOf = (element: HTMLElement, state: Watched) =>
  state.row ? [...element.children].filter((child): child is HTMLElement => child instanceof HTMLElement) : [element];

function hide(element: HTMLElement, variant: Watched["variant"]) {
  if (variant === "scale") element.dataset.revealVariant = "scale";
  element.dataset.reveal = "hidden";
}

/** Shows an element: after `delay` ms when staggered, or at once (no transition) when `instant`. */
function show(element: HTMLElement, { delay, instant = false }: { delay?: number; instant?: boolean } = {}) {
  if (instant) {
    element.setAttribute("data-reveal-instant", "");
    element.style.removeProperty("--reveal-delay");
  } else if (delay !== undefined) {
    element.style.setProperty("--reveal-delay", `${delay}ms`);
  }
  element.dataset.reveal = "shown";
}

function onEntries(entries: IntersectionObserverEntry[]) {
  const appearing: HTMLElement[] = [];
  for (const entry of entries) {
    const element = entry.target as HTMLElement;
    const state = watched.get(element);
    if (!state) continue;
    if (!state.reported) {
      state.reported = true;
      if (!entry.isIntersecting && entry.boundingClientRect.top >= window.innerHeight) {
        for (const target of targetsOf(element, state)) hide(target, state.variant);
        continue;
      }
      // Already on screen, or above it: shown as it is (a row's cards keep no state at all).
      if (!state.row) show(element);
      forget(element);
      continue;
    }
    if (entry.isIntersecting) appearing.push(element);
  }
  appearing.sort((first, second) => (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  let order = 0;
  for (const element of appearing) {
    const state = watched.get(element)!;
    if (state.row) {
      // A row's cards are staggered among themselves; a card shown on focus already is left as it is.
      targetsOf(element, state).forEach((card, index) => { if (card.dataset.reveal === "hidden") show(card, { delay: staggerDelay(index) }); });
    } else {
      show(element, state.stagger ? { delay: staggerDelay(order++) } : {});
    }
    forget(element);
  }
}

/** Focus inside a hidden element (Tab, a skip link, find in page) shows it and every hidden element around it at once. */
function onFocusIn(event: FocusEvent) {
  let node = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-reveal='hidden']") : null;
  while (node) {
    show(node, { instant: true });
    if (watched.get(node)?.row === false) forget(node);
    node = node.parentElement?.closest<HTMLElement>("[data-reveal='hidden']") ?? null;
  }
}

function showEverything() {
  for (const [element, state] of [...watched]) {
    for (const target of targetsOf(element, state)) if (target.dataset.reveal === "hidden") show(target, { instant: true });
    forget(element);
  }
}

function sharedObserver() {
  if (!observer) {
    observer = new IntersectionObserver(onEntries, { threshold: 0, rootMargin: ROOT_MARGIN });
    document.addEventListener("focusin", onFocusIn, true);
    stopWatchingMotion = watchReducedMotion((reduce) => { if (reduce) showEverything(); });
  }
  return observer;
}

function watch(element: HTMLElement, state: Omit<Watched, "reported">): () => void {
  if (typeof IntersectionObserver !== "function" || prefersReducedMotion() || element.dataset.reveal === "shown") return () => undefined;
  if (!state.row && state.variant === "scale") element.dataset.revealVariant = "scale";
  watched.set(element, { ...state, reported: false });
  sharedObserver().observe(element);
  return () => forget(element);
}

/** Watches `element` for its reveal; returns the function that stops watching. */
export function watchReveal(element: HTMLElement, { stagger = false, variant = "rise" }: RevealOptions = {}): () => void {
  return watch(element, { stagger, variant, row: false });
}

/** A callback ref that reveals its element as it scrolls into view (see `watchReveal`). */
export function useReveal<T extends HTMLElement>({ stagger = false, variant = "rise" }: RevealOptions = {}) {
  return useCallback((element: T | null) => (element ? watchReveal(element, { stagger, variant }) : undefined), [stagger, variant]);
}

/** A callback ref for a row that scrolls sideways: its cards reveal together as the row scrolls into view. */
export function useRevealRow<T extends HTMLElement>() {
  return useCallback((element: T | null) => (element ? watch(element, { stagger: true, variant: "scale", row: true }) : undefined), []);
}
