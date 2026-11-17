import type { CatalogCategory } from "../../api/catalog";
import type { CategoryTree } from "../../store/catalogModel";
import type { ProductReadinessFilter } from "./adminRoutes";

/**
 * Whether a product is ready to publish, computed from the staff snapshot (no stored state). The products list's filter
 * and labels and the editor's "Before publishing" checklist all read these definitions. Checks warn; only the server's
 * own rule (a visible product needs an active option) ever refuses a save.
 */

/** What readiness needs from a product: its saved record, or the editor's current values. */
export type ReadinessInput = {
  isActive: boolean;
  isDemo: boolean;
  categoryId: string;
  images: readonly { isPlaceholder: boolean }[];
  /** `stock` is available units (on hand less reserved). */
  variants: readonly { isActive: boolean; stock: number }[];
};

export type ReadinessCheckId = "needs-images" | "no-active-option" | "out-of-stock" | "category-hidden";

/** The checks in the order they are listed, with the label for an open check and the text for a passed one. */
export const READINESS_CHECKS: readonly { id: ReadinessCheckId; label: string; passed: string }[] = [
  { id: "needs-images", label: "Needs images", passed: "Has real photos" },
  { id: "no-active-option", label: "No active option", passed: "Has an active option" },
  { id: "out-of-stock", label: "Out of stock", passed: "Has units to sell" },
  { id: "category-hidden", label: "Category hidden", passed: "Category visible to shoppers" },
];

export const HIDDEN_LABEL = "Hidden (draft)";
export const VISIBLE_LABEL = "Visible to shoppers";
export const DEMO_LABEL = "Demo listing";
export const READY_LABEL = "Ready to publish";

export const visibilityLabel = (isActive: boolean) => (isActive ? VISIBLE_LABEL : HIDDEN_LABEL);
export const checkLabel = (id: ReadinessCheckId) => READINESS_CHECKS.find((check) => check.id === id)!.label;

/** No images at all, or only sample or placeholder images: real photography is still needed. */
export const needsImages = (product: Pick<ReadinessInput, "images">) => product.images.every((image) => image.isPlaceholder);

export type Readiness = {
  /** Open checks, in `READINESS_CHECKS` order. */
  open: ReadinessCheckId[];
  /** With "Category hidden": the highest hidden category on the product's path, the one to show first. */
  hiddenCategory: CatalogCategory | null;
  /** Demo listings are flagged for information only. */
  demo: boolean;
  /** A hidden, non-demo product with no open check. */
  readyToPublish: boolean;
};

export function productReadiness(product: ReadinessInput, categories: Pick<CategoryTree, "path">): Readiness {
  const path = categories.path(product.categoryId);
  const hiddenCategory = path.find((category) => !category.isActive) ?? null;
  const active = product.variants.filter((variant) => variant.isActive);
  const open: ReadinessCheckId[] = [];
  if (needsImages(product)) open.push("needs-images");
  if (!active.length) open.push("no-active-option");
  if (!active.some((variant) => variant.stock > 0)) open.push("out-of-stock");
  // A category missing from the snapshot cannot be shown to shoppers either.
  if (hiddenCategory || !path.length) open.push("category-hidden");
  return { open, hiddenCategory, demo: product.isDemo, readyToPublish: !product.isActive && !product.isDemo && !open.length };
}

/** The labels a product card shows after its visibility: open checks, then "Demo listing" or "Ready to publish". */
export function readinessLabels(readiness: Readiness): string[] {
  return [
    ...readiness.open.map(checkLabel),
    ...(readiness.demo ? [DEMO_LABEL] : []),
    ...(readiness.readyToPublish ? [READY_LABEL] : []),
  ];
}

export function matchesReadiness(readiness: Readiness, filter: ProductReadinessFilter) {
  return filter === "ready" ? readiness.readyToPublish : readiness.open.includes(filter);
}
