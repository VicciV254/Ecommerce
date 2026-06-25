import { useCallback, useMemo, useRef, useState } from "react";
import type { AdminData, Discount } from "./StoreContext";

/**
 * Manages an editable DRAFT copy of admin data (stock + discounts) with
 * undo/redo history. Nothing affects the live store until `getDraft()` is
 * committed by the caller (via commitAdmin).
 */
export function useAdminDraft(committed: AdminData) {
  // snapshot of the committed baseline at mount / after save
  const baselineRef = useRef<string>(JSON.stringify(committed));

  const [history, setHistory] = useState<AdminData[]>([clone(committed)]);
  const [cursor, setCursor] = useState(0);

  const draft = history[cursor];

  const push = useCallback(
    (next: AdminData) => {
      setHistory((h) => {
        const trimmed = h.slice(0, cursor + 1);
        return [...trimmed, clone(next)];
      });
      setCursor((c) => c + 1);
    },
    [cursor]
  );

  /* ---------- Stock mutations ---------- */
  const setStock = useCallback(
    (id: string, value: number) => {
      push({ ...draft, stock: { ...draft.stock, [id]: Math.max(0, value) } });
    },
    [draft, push]
  );

  const bulkStock = useCallback(
    (ids: string[], op: "add" | "sub" | "set", value: number) => {
      const stock = { ...draft.stock };
      ids.forEach((id) => {
        const cur = stock[id] ?? 0;
        if (op === "add") stock[id] = cur + value;
        else if (op === "sub") stock[id] = Math.max(0, cur - value);
        else stock[id] = Math.max(0, value);
      });
      push({ ...draft, stock });
    },
    [draft, push]
  );

  /* ---------- Discount mutations ---------- */
  const addDiscount = useCallback(
    (d: Discount) => {
      push({ ...draft, discounts: [...draft.discounts, d] });
    },
    [draft, push]
  );

  const updateDiscount = useCallback(
    (id: string, patch: Partial<Discount>) => {
      push({
        ...draft,
        discounts: draft.discounts.map((d) => (d.id === id ? { ...d, ...patch } : d)),
      });
    },
    [draft, push]
  );

  const removeDiscount = useCallback(
    (id: string) => {
      push({ ...draft, discounts: draft.discounts.filter((d) => d.id !== id) });
    },
    [draft, push]
  );

  /* ---------- Undo / Redo ---------- */
  const undo = useCallback(() => setCursor((c) => Math.max(0, c - 1)), []);
  const redo = useCallback(() => setCursor((c) => Math.min(history.length - 1, c + 1)), [history.length]);
  const canUndo = cursor > 0;
  const canRedo = cursor < history.length - 1;

  /* ---------- Save / dirty tracking ---------- */
  const dirty = useMemo(
    () => JSON.stringify(draft) !== baselineRef.current,
    [draft]
  );

  /** Call after a successful commit to reset the baseline + history. */
  const markSaved = useCallback(() => {
    baselineRef.current = JSON.stringify(draft);
    setHistory([clone(draft)]);
    setCursor(0);
  }, [draft]);

  return {
    draft,
    setStock,
    bulkStock,
    addDiscount,
    updateDiscount,
    removeDiscount,
    undo,
    redo,
    canUndo,
    canRedo,
    dirty,
    markSaved,
  };
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
