import { useEffect, useSyncExternalStore } from "react";

/**
 * Whether the page on screen has its own content ready: loaded, and not an error or "not found". Browsing pages report
 * it and the welcome dialog waits for it. One page shows at a time, so one flag suffices: a page sets it while ready and
 * clears it when it leaves.
 */
let ready = false;
const listeners = new Set<() => void>();

function set(value: boolean) {
  ready = value;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Called by a page with whether its own content is ready. */
export function usePageReady(isReady: boolean) {
  useEffect(() => {
    if (!isReady) return;
    set(true);
    return () => set(false);
  }, [isReady]);
}

export function usePageIsReady(): boolean {
  return useSyncExternalStore(subscribe, () => ready, () => false);
}
