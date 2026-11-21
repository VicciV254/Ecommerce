import { useSyncExternalStore } from "react";

/**
 * Whether any modal dialog is open: `ModalDialog` reports each one it opens and closes, so motion that should wait (the
 * hero carousel's rotation, the welcome dialog) can subscribe instead of watching the DOM.
 */
let openDialogs = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const anyOpen = () => openDialogs > 0;

/** Records one modal dialog as open; the returned function records it closed again. */
export function reportModalOpen(): () => void {
  openDialogs += 1;
  for (const listener of listeners) listener();
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    openDialogs -= 1;
    for (const listener of listeners) listener();
  };
}

export function useAnyModalOpen(): boolean {
  return useSyncExternalStore(subscribe, anyOpen, () => false);
}
