import { useCallback, useMemo, useRef, useState } from "react";
import type { AdminData, Discount, CustomDesigner } from "./StoreContext";
import type { Product, Category } from "../data/products";

/**
 * Manages an editable DRAFT copy of admin data (stock + discounts) with
 * undo/redo history. Nothing affects the live store until `getDraft()` is
 * committed by the caller (via commitAdmin).
 */
export function useAdminDraft(committed: AdminData, onCommit?: (data: AdminData) => void) {
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
      onCommit?.(clone(next));
    },
    [cursor, onCommit]
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

  /* ---------- Tag mutations ---------- */
  const setTags = useCallback(
    (id: string, tags: string[]) => {
      push({ ...draft, tagOverrides: { ...draft.tagOverrides, [id]: tags } });
    },
    [draft, push]
  );

  /* ---------- Custom product mutations ---------- */
  const addProduct = useCallback(
    (p: Product) => {
      push({
        ...draft,
        customProducts: [...draft.customProducts, p],
        stock: { ...draft.stock, [p.id]: p.stock },
      });
    },
    [draft, push]
  );

  const removeProduct = useCallback(
    (id: string) => {
      const isCustom = draft.customProducts.some((p) => p.id === id);
      if (isCustom) {
        push({ ...draft, customProducts: draft.customProducts.filter((p) => p.id !== id) });
        return;
      }

      push({
        ...draft,
        deletedProductIds: draft.deletedProductIds.includes(id)
          ? draft.deletedProductIds
          : [...draft.deletedProductIds, id],
      });
    },
    [draft, push]
  );

  /** Edit an existing product (base OR custom). Stores a partial override. */
  const editProduct = useCallback(
    (id: string, patch: Partial<Product>) => {
      const isCustom = draft.customProducts.some((p) => p.id === id);
      if (isCustom) {
        push({
          ...draft,
          customProducts: draft.customProducts.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        });
      } else {
        push({
          ...draft,
          productOverrides: {
            ...draft.productOverrides,
            [id]: { ...(draft.productOverrides[id] ?? {}), ...patch },
          },
        });
      }
    },
    [draft, push]
  );

  /* ---------- Categories & designers ---------- */
  const addCategory = useCallback(
    (c: { name: string; slug: string; image: string }) => {
      if (draft.customCategories.some((x) => x.slug === c.slug)) return;
      push({ ...draft, customCategories: [...draft.customCategories, c] });
    },
    [draft, push]
  );

  const editCategory = useCallback(
    (slug: string, patch: Partial<Category>) => {
      const isCustom = draft.customCategories.some((c) => c.slug === slug);
      if (isCustom) {
        push({
          ...draft,
          customCategories: draft.customCategories.map((c) => (c.slug === slug ? { ...c, ...patch } : c)),
        });
      } else {
        push({
          ...draft,
          categoryOverrides: {
            ...draft.categoryOverrides,
            [slug]: { ...(draft.categoryOverrides[slug] ?? {}), ...patch },
          },
        });
      }
    },
    [draft, push]
  );

  const addDesigner = useCallback(
    (d: CustomDesigner) => {
      if (draft.customDesigners.some((x) => x.id === d.id)) return;
      push({ ...draft, customDesigners: [...draft.customDesigners, d] });
    },
    [draft, push]
  );

  const editDesigner = useCallback(
    (id: string, patch: Partial<CustomDesigner>) => {
      const isCustom = draft.customDesigners.some((d) => d.id === id);
      if (isCustom) {
        push({
          ...draft,
          customDesigners: draft.customDesigners.map((d) => (d.id === id ? { ...d, ...patch } : d)),
        });
      } else {
        push({
          ...draft,
          designerOverrides: {
            ...draft.designerOverrides,
            [id]: { ...(draft.designerOverrides[id] ?? {}), ...patch },
          },
        });
      }
    },
    [draft, push]
  );

  const removeCategory = useCallback(
    (slug: string) => {
      const isCustom = draft.customCategories.some((c) => c.slug === slug);
      if (isCustom) {
        push({ ...draft, customCategories: draft.customCategories.filter((c) => c.slug !== slug) });
        return;
      }

      push({
        ...draft,
        deletedCategorySlugs: draft.deletedCategorySlugs.includes(slug)
          ? draft.deletedCategorySlugs
          : [...draft.deletedCategorySlugs, slug],
      });
    },
    [draft, push]
  );

  const removeDesigner = useCallback(
    (id: string) => {
      const isCustom = draft.customDesigners.some((d) => d.id === id);
      if (isCustom) {
        push({ ...draft, customDesigners: draft.customDesigners.filter((d) => d.id !== id) });
        return;
      }

      push({
        ...draft,
        deletedDesignerIds: draft.deletedDesignerIds.includes(id)
          ? draft.deletedDesignerIds
          : [...draft.deletedDesignerIds, id],
      });
    },
    [draft, push]
  );

  /* ---------- Undo / Redo ---------- */
  const undo = useCallback(() => {
    setCursor((c) => {
      const next = Math.max(0, c - 1);
      const nextDraft = history[next];
      onCommit?.(clone(nextDraft));
      return next;
    });
  }, [history, onCommit]);

  const redo = useCallback(() => {
    setCursor((c) => {
      const next = Math.min(history.length - 1, c + 1);
      const nextDraft = history[next];
      onCommit?.(clone(nextDraft));
      return next;
    });
  }, [history, onCommit]);
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
    setTags,
    addProduct,
    removeProduct,
    editProduct,
    addCategory,
    editCategory,
    addDesigner,
    editDesigner,
    removeCategory,
    removeDesigner,
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
