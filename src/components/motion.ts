import { useCallback, useEffect, useRef, useState } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
/** How long an add-to-cart button shows its check. */
const ADDED_MS = 1500;

/**
 * Whether the shopper asked for less motion. CSS animations and transitions already stop under it (`index.css`);
 * motion driven from script (rotation, reveals, pops) checks this itself.
 */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches;
}

/** Calls `onChange` with the new answer whenever the shopper's reduced-motion setting changes; returns the unsubscriber. */
export function watchReducedMotion(onChange: (reduce: boolean) => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(REDUCED_MOTION);
  const listener = (event: { matches: boolean }) => onChange(event.matches);
  query.addEventListener?.("change", listener);
  return () => query.removeEventListener?.("change", listener);
}

/** `prefersReducedMotion`, kept current while the component is mounted. */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(prefersReducedMotion);
  useEffect(() => {
    setReduce(prefersReducedMotion());
    return watchReducedMotion(setReduce);
  }, []);
  return reduce;
}

/** A short scale pop for feedback (a cart count rising, a saved heart); nothing under reduced motion. */
export function pop(element: Element | null) {
  if (!element || typeof element.animate !== "function" || prefersReducedMotion()) return;
  element.animate([{ transform: "scale(1)" }, { transform: "scale(1.3)" }, { transform: "scale(1)" }], { duration: 320, easing: "ease-out" });
}

/**
 * A button's brief "added" state: true for about 1.5 s after `confirm()`, restarting on each call. The button keeps its
 * label and name meanwhile (the mini cart announces the addition), so it can be pressed again at once.
 */
export function useAddedFeedback(): [boolean, () => void] {
  const [added, setAdded] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const confirm = useCallback(() => {
    window.clearTimeout(timer.current);
    setAdded(true);
    timer.current = window.setTimeout(() => setAdded(false), ADDED_MS);
  }, []);
  return [added, confirm];
}
