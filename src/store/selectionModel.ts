import type { CatalogProduct, CatalogVariant, MediaAsset } from "../api/catalog";
import {
  activeVariants,
  findVariant,
  optionLabel,
  orderedImages,
  stockLevel,
  variantOptions,
  variantPriceView,
  type PriceView,
  type StockLevel,
  type VariantSelection,
} from "./catalogModel";

/**
 * One selection model for every surface that sells a product (the product page and Quick View), so their choices,
 * messages and cart lines cannot drift apart. Pure: the hook in `useProductSelection` only holds the inputs.
 */

/** Whether a value can still be bought with the other choices: no active SKU has it, or every such SKU is sold out. */
export type ValueStatus = "available" | "unavailable" | "sold-out";
export type OptionValue = { value: string; status: ValueStatus };

/** An option with one possible value is a fact, not a choice; the others start unselected. */
export type SelectionOption =
  | { key: string; label: string; kind: "fixed"; value: string }
  | { key: string; label: string; kind: "choice"; values: OptionValue[]; chosen: string | null };

export type SelectionStatus =
  /** No active SKU: nothing can be chosen or added. */
  | { kind: "unavailable" }
  /** Some options still need a value; `missing` are their labels, in display order. */
  | { kind: "incomplete"; missing: string[] }
  /** Every option has a value, but no active SKU has this combination. */
  | { kind: "no-combination" }
  | { kind: "sold-out"; variant: CatalogVariant }
  | { kind: "ready"; variant: CatalogVariant };

export type ProductSelection = {
  options: SelectionOption[];
  /** The shopper's valid choices, without fixed values. */
  choices: VariantSelection;
  status: SelectionStatus;
  /** The exact SKU for a complete choice, sold out or not; never a default. */
  variant: CatalogVariant | undefined;
  /** Active SKUs consistent with the choices made so far (every active SKU before the first choice). */
  possible: CatalogVariant[];
  /** True once a choice has excluded some active SKUs. */
  narrowed: boolean;
  /** The chosen SKU's price, or the lowest among the possible SKUs (`isFromPrice` when they differ). */
  price: PriceView | null;
  level: StockLevel;
  /** Sellable units of the chosen SKU, or across the possible SKUs before the choice is complete. */
  stock: number;
  /** Units that may be added: 1 to the chosen SKU's stock, or 0 when nothing can be added. */
  maxQuantity: number;
  /** The requested quantity kept within 1 and `maxQuantity`. */
  quantity: number;
  canAdd: boolean;
  /** Why nothing can be added yet, for a polite status beside the action; `null` when Add is possible. */
  message: string | null;
  /** Changes whenever a choice changes, so the gallery can return to the first image of the new set. */
  choiceKey: string;
};

function joinLabels(labels: string[]) {
  if (labels.length < 2) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** Active SKUs whose attributes agree with every choice. */
function consistentVariants(variants: readonly CatalogVariant[], choices: VariantSelection, except?: string) {
  return variants.filter((variant) =>
    Object.entries(choices).every(([key, value]) => key === except || variant.attributes[key] === value));
}

function valueStatus(variants: readonly CatalogVariant[], choices: VariantSelection, key: string, value: string): ValueStatus {
  const matching = consistentVariants(variants, choices, key).filter((variant) => variant.attributes[key] === value);
  if (!matching.length) return "unavailable";
  return matching.some((variant) => variant.stock > 0) ? "available" : "sold-out";
}

/** The lowest price among SKUs, marked as a "from" price when they differ. */
function lowestPrice(variants: readonly CatalogVariant[]): PriceView | null {
  if (!variants.length) return null;
  const cheapest = variants.reduce((best, variant) => (variant.pricing.price < best.pricing.price ? variant : best));
  return { ...variantPriceView(cheapest), isFromPrice: variants.some((variant) => variant.pricing.price !== cheapest.pricing.price) };
}

/** Requested quantities become whole numbers from 1 to `max`; anything unusable reads as 1. */
export function clampQuantity(quantity: number, max: number) {
  const whole = Number.isFinite(quantity) ? Math.floor(quantity) : 1;
  return Math.min(Math.max(1, whole), Math.max(1, max));
}

/**
 * Resolves the shopper's choices against the current catalog record. Choices that the record no longer offers are
 * dropped, single-valued options are fixed facts, and a SKU is only ever the exact match of a complete choice.
 */
export function resolveSelection(product: CatalogProduct, requested: VariantSelection, requestedQuantity: number): ProductSelection {
  const active = activeVariants(product);
  const optionList = variantOptions(product);
  const choiceKeys = optionList.filter((option) => option.values.length > 1);
  const choices: VariantSelection = {};
  for (const option of choiceKeys) {
    const value = requested[option.key];
    if (value !== undefined && option.values.includes(value)) choices[option.key] = value;
  }

  const options: SelectionOption[] = optionList.map((option) => (option.values.length === 1
    ? { key: option.key, label: optionLabel(option.key), kind: "fixed", value: option.values[0] }
    : {
      key: option.key,
      label: optionLabel(option.key),
      kind: "choice",
      chosen: choices[option.key] ?? null,
      values: option.values.map((value) => ({ value, status: valueStatus(active, choices, option.key, value) })),
    }));

  const possible = consistentVariants(active, choices);
  const narrowed = Object.keys(choices).length > 0 && possible.length < active.length;
  const missing = options.flatMap((option) => (option.kind === "choice" && option.chosen === null ? [option.label] : []));
  const full: VariantSelection = { ...choices };
  for (const option of options) if (option.kind === "fixed") full[option.key] = option.value;

  let status: SelectionStatus;
  if (!active.length) status = { kind: "unavailable" };
  else if (missing.length) status = { kind: "incomplete", missing };
  else {
    const exact = findVariant(product, full);
    if (!exact) status = { kind: "no-combination" };
    else status = exact.stock > 0 ? { kind: "ready", variant: exact } : { kind: "sold-out", variant: exact };
  }

  const variant = status.kind === "ready" || status.kind === "sold-out" ? status.variant : undefined;
  const stock = variant
    ? Math.max(0, variant.stock)
    : possible.reduce((sum, item) => sum + Math.max(0, item.stock), 0);
  const threshold = variant ? variant.minThreshold : possible.reduce((sum, item) => sum + item.minThreshold, 0);
  const maxQuantity = status.kind === "ready" ? stock : 0;
  const hasChoices = options.some((option) => option.kind === "choice");

  let message: string | null = null;
  if (status.kind === "unavailable") message = "This product is not currently available.";
  else if (status.kind === "incomplete") message = `Select ${joinLabels(status.missing.map((label) => label.toLowerCase()))} to continue.`;
  else if (status.kind === "no-combination") message = "This combination is not available. Choose different options.";
  else if (status.kind === "sold-out") {
    message = hasChoices ? "This combination is sold out. Choose different options." : "This product is sold out.";
  }

  return {
    options,
    choices,
    status,
    variant,
    possible,
    narrowed,
    price: variant ? variantPriceView(variant) : lowestPrice(possible.length ? possible : active),
    level: stockLevel(stock, threshold),
    stock,
    maxQuantity,
    quantity: status.kind === "ready" ? clampQuantity(requestedQuantity, maxQuantity) : 1,
    canAdd: status.kind === "ready",
    message,
    choiceKey: JSON.stringify(Object.entries(choices).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };
}

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

/**
 * Gallery order for the current choice. Before a choice narrows the SKUs: general images (no `variantId`) first, then
 * images of active SKUs. After it: images of the still-possible SKUs first, then general images. Images of SKUs the
 * choice excluded, or of inactive SKUs, are left out.
 */
export function galleryImages(product: Pick<CatalogProduct, "images" | "variants">, selection: Pick<ProductSelection, "possible" | "narrowed">): MediaAsset[] {
  const images = orderedImages(product);
  const general = images.filter((image) => !image.variantId);
  const shown = new Set(selection.possible.map((variant) => variant.id));
  const linked = images.filter((image) => image.variantId !== null && shown.has(image.variantId));
  return selection.narrowed ? [...linked, ...general] : [...general, ...linked];
}

/**
 * The picture for a cart line, as the server's `variantImage` chooses it for quotes and orders: the SKU's first
 * linked image, otherwise the product cover, preferring images not tied to another SKU. Images keep the API's order.
 */
export function lineImage(images: readonly MediaAsset[], variantId: string): MediaAsset | undefined {
  const ordered = [...images].sort((a, b) => a.order - b.order);
  const general = ordered.filter((image) => !image.variantId);
  return ordered.find((image) => image.variantId === variantId)
    ?? general.find((image) => image.isMain) ?? general[0]
    ?? ordered.find((image) => image.isMain) ?? ordered[0];
}
