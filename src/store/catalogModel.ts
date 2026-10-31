import type {
  CatalogCategory,
  CatalogDesigner,
  CatalogDiscount,
  CatalogProduct,
  CatalogSnapshot,
  CatalogVariant,
  MediaAsset,
} from "../api/catalog";
import { isRecord } from "../utils/storage";

/* ------------------------------------------------------------------ */
/* Boundary validation: malformed catalog data is an error, not empty  */
/* ------------------------------------------------------------------ */

export class CatalogFormatError extends Error {
  constructor(detail: string) {
    super(`The catalog response was not in the expected format (${detail}).`);
    this.name = "CatalogFormatError";
  }
}

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isNullableString = (value: unknown) => value === null || isString(value);
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
const isStringRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every(isString);

function isMediaAsset(value: unknown): value is MediaAsset {
  return isRecord(value) && isString(value.id) && isString(value.url) && typeof value.isPlaceholder === "boolean" &&
    typeof value.isMain === "boolean" && isNumber(value.order) && isNullableString(value.alt);
}

function isVariant(value: unknown): value is CatalogVariant {
  return isRecord(value) && isString(value.id) && isString(value.sku) && isStringRecord(value.attributes) &&
    isNumber(value.price) && isNumber(value.stock) && isNumber(value.minThreshold) && typeof value.isActive === "boolean";
}

export function isCatalogProduct(value: unknown): value is CatalogProduct {
  return isRecord(value) && isString(value.id) && isString(value.name) && isString(value.description) &&
    isNumber(value.price) && (value.comparePrice === null || isNumber(value.comparePrice)) &&
    isString(value.categoryId) && isString(value.categoryName) && isStringArray(value.categoryPath) &&
    isNullableString(value.designerId) && isStringArray(value.tags) && isNullableString(value.collection) &&
    isStringRecord(value.specifications) && typeof value.isActive === "boolean" &&
    typeof value.isFeatured === "boolean" && typeof value.isDemo === "boolean" &&
    Array.isArray(value.images) && value.images.every(isMediaAsset) &&
    Array.isArray(value.variants) && value.variants.every(isVariant) &&
    isNumber(value.rating) && isNumber(value.reviewsCount);
}

function isCategory(value: unknown): value is CatalogCategory {
  return isRecord(value) && isString(value.id) && isString(value.name) && isString(value.slug) &&
    isNullableString(value.parentId) && isNumber(value.order) && isNullableString(value.image) &&
    isStringArray(value.attributeKeys) && typeof value.isActive === "boolean" && isNumber(value.productCount);
}

function isDesigner(value: unknown): value is CatalogDesigner {
  return isRecord(value) && isString(value.id) && isString(value.slug) && isString(value.name) &&
    isString(value.specialty) && isNullableString(value.image) && typeof value.isActive === "boolean" &&
    typeof value.isDemo === "boolean";
}

function isDiscount(value: unknown): value is CatalogDiscount {
  return isRecord(value) && isString(value.id) && isString(value.name) &&
    (value.type === "PERCENTAGE" || value.type === "FIXED") && isNumber(value.value) &&
    (value.applyTo === "ALL" || value.applyTo === "CATEGORY" || value.applyTo === "SELECTED") &&
    isStringArray(value.targetIds) && isString(value.startDate) && isNullableString(value.endDate) &&
    typeof value.isActive === "boolean" && typeof value.isDemo === "boolean";
}

/** Validates a snapshot from `/catalog` or `/admin/catalog`; throws rather than returning partial data. */
export function parseCatalogSnapshot(data: unknown, modes: readonly CatalogSnapshot["mode"][]): CatalogSnapshot {
  if (!isRecord(data) || data.version !== 2) throw new CatalogFormatError("unsupported version");
  const mode = data.mode;
  if (mode !== "live" && mode !== "demo" && mode !== "admin") throw new CatalogFormatError("unknown mode");
  if (!modes.includes(mode)) throw new CatalogFormatError(`unexpected ${mode} mode`);
  const { products, categories, designers, discounts } = data;
  if (!Array.isArray(products) || !products.every(isCatalogProduct)) throw new CatalogFormatError("products");
  if (!Array.isArray(categories) || !categories.every(isCategory)) throw new CatalogFormatError("categories");
  if (!Array.isArray(designers) || !designers.every(isDesigner)) throw new CatalogFormatError("designers");
  if (!Array.isArray(discounts) || !discounts.every(isDiscount)) throw new CatalogFormatError("discounts");
  return { version: 2, mode, products, categories, designers, discounts };
}

/* ------------------------------------------------------------------ */
/* Variants                                                            */
/* ------------------------------------------------------------------ */

export type VariantSelection = Record<string, string>;
export type VariantOption = { key: string; values: string[] };

export function activeVariants(product: CatalogProduct): CatalogVariant[] {
  return product.variants.filter((variant) => variant.isActive);
}

/** Option names and values across active SKUs, in first-seen order. */
export function variantOptions(product: CatalogProduct): VariantOption[] {
  const options = new Map<string, string[]>();
  for (const variant of activeVariants(product)) {
    for (const [key, value] of Object.entries(variant.attributes)) {
      const values = options.get(key) ?? [];
      if (!values.includes(value)) values.push(value);
      options.set(key, values);
    }
  }
  return [...options].map(([key, values]) => ({ key, values }));
}

/** The active SKU whose attributes exactly equal the selection. Never substitutes a default. */
export function findVariant(product: CatalogProduct, selection: VariantSelection): CatalogVariant | undefined {
  const selected = Object.entries(selection);
  return activeVariants(product).find((variant) => {
    const attributes = Object.entries(variant.attributes);
    return attributes.length === selected.length &&
      attributes.every(([key, value]) => selection[key] === value);
  });
}

/** Whether choosing `value` for `key` can still lead to an active SKU given the other choices. */
export function optionAvailable(product: CatalogProduct, selection: VariantSelection, key: string, value: string) {
  return activeVariants(product).some((variant) =>
    variant.attributes[key] === value &&
    Object.entries(selection).every(([otherKey, otherValue]) => otherKey === key || variant.attributes[otherKey] === otherValue));
}

export function describeVariant(variant: Pick<CatalogVariant, "attributes">): string {
  return Object.entries(variant.attributes).map(([key, value]) => `${optionLabel(key)}: ${value}`).join(" · ");
}

export function optionLabel(key: string) {
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : key;
}

/* ------------------------------------------------------------------ */
/* Price preview: one best percentage, never stacked; P3 quotes decide */
/* ------------------------------------------------------------------ */

const PRICE_ROUNDING_STEP = 10;
const MAX_PERCENT = 100;

export function isDiscountActive(discount: CatalogDiscount, now: Date): boolean {
  if (!discount.isActive) return false;
  const start = Date.parse(discount.startDate);
  if (Number.isNaN(start) || now.getTime() < start) return false;
  if (discount.endDate === null) return true;
  const end = Date.parse(discount.endDate);
  return !Number.isNaN(end) && now.getTime() <= end;
}

export function discountAppliesTo(discount: CatalogDiscount, product: CatalogProduct): boolean {
  // Demo promotions never change a real product's price.
  if (discount.isDemo && !product.isDemo) return false;
  if (discount.applyTo === "ALL") return true;
  if (discount.applyTo === "CATEGORY") return discount.targetIds.some((id) => product.categoryPath.includes(id));
  return discount.targetIds.includes(product.id);
}

/** Highest active percentage for the product. Fixed-amount discounts are left to the checkout quote. */
export function bestDiscountPercent(product: CatalogProduct, discounts: readonly CatalogDiscount[], now: Date): number {
  let best = 0;
  for (const discount of discounts) {
    if (discount.type === "PERCENTAGE" && isDiscountActive(discount, now) && discountAppliesTo(discount, product)) {
      best = Math.max(best, discount.value);
    }
  }
  return Math.min(Math.max(best, 0), MAX_PERCENT);
}

export function applyPercent(price: number, percent: number) {
  if (percent <= 0) return price;
  return Math.round((price * (1 - percent / 100)) / PRICE_ROUNDING_STEP) * PRICE_ROUNDING_STEP;
}

export type PriceView = {
  /** Preview of the payable unit price after the single best percentage. */
  price: number;
  /** Resolved SKU price before any discount. */
  originalPrice: number;
  /** Struck-through reference: the pre-discount price, or the merchant's compare-at price. */
  comparePrice: number | null;
  discountPercent: number;
  /** True on cards when active SKU prices differ and `price` is the lowest. */
  isFromPrice: boolean;
};

function priceView(product: CatalogProduct, original: number, percent: number, isFromPrice: boolean): PriceView {
  const price = applyPercent(original, percent);
  const merchantCompare = original === product.price && product.comparePrice !== null && product.comparePrice > original
    ? product.comparePrice
    : null;
  return { price, originalPrice: original, comparePrice: percent > 0 ? original : merchantCompare, discountPercent: percent, isFromPrice };
}

export function variantPriceView(
  product: CatalogProduct, variant: CatalogVariant, discounts: readonly CatalogDiscount[], now: Date,
): PriceView {
  return priceView(product, variant.price, bestDiscountPercent(product, discounts, now), false);
}

/** Card price: the lowest active SKU price (or the base price when none is sellable). */
export function productPriceView(product: CatalogProduct, discounts: readonly CatalogDiscount[], now: Date): PriceView {
  const prices = activeVariants(product).map((variant) => variant.price);
  const lowest = prices.length ? Math.min(...prices) : product.price;
  return priceView(product, lowest, bestDiscountPercent(product, discounts, now), new Set(prices).size > 1);
}

/* ------------------------------------------------------------------ */
/* Stock and media                                                     */
/* ------------------------------------------------------------------ */

export type StockLevel = "in" | "low" | "out";

export function stockLevel(quantity: number, lowThreshold: number): StockLevel {
  if (quantity <= 0) return "out";
  return quantity <= lowThreshold ? "low" : "in";
}

/** Sellable units across active SKUs and the threshold that marks them low. */
export function productStock(product: CatalogProduct) {
  const variants = activeVariants(product);
  return {
    quantity: variants.reduce((sum, variant) => sum + Math.max(0, variant.stock), 0),
    lowThreshold: variants.reduce((sum, variant) => sum + variant.minThreshold, 0),
  };
}

export function orderedImages(product: Pick<CatalogProduct, "images">): MediaAsset[] {
  return [...product.images].sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.order - b.order);
}

export function primaryImage(product: Pick<CatalogProduct, "images">): MediaAsset | undefined {
  return orderedImages(product)[0];
}

/* ------------------------------------------------------------------ */
/* Category hierarchy                                                  */
/* ------------------------------------------------------------------ */

export type CategoryTree = {
  byId: ReadonlyMap<string, CatalogCategory>;
  bySlug: ReadonlyMap<string, CatalogCategory>;
  roots: CatalogCategory[];
  children: (parentId: string) => CatalogCategory[];
  /** Root-to-category chain; stops at a missing parent or a cycle instead of looping. */
  path: (id: string) => CatalogCategory[];
};

const byOrder = (a: CatalogCategory, b: CatalogCategory) => a.order - b.order || a.name.localeCompare(b.name);

export function buildCategoryTree(categories: readonly CatalogCategory[]): CategoryTree {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const bySlug = new Map(categories.map((category) => [category.slug, category]));
  const childMap = new Map<string, CatalogCategory[]>();
  const roots: CatalogCategory[] = [];
  for (const category of categories) {
    if (category.parentId === null) roots.push(category);
    else childMap.set(category.parentId, [...(childMap.get(category.parentId) ?? []), category]);
  }
  roots.sort(byOrder);
  for (const list of childMap.values()) list.sort(byOrder);
  return {
    byId,
    bySlug,
    roots,
    children: (parentId) => childMap.get(parentId) ?? [],
    path: (id) => {
      const chain: CatalogCategory[] = [];
      const seen = new Set<string>();
      let current = byId.get(id);
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        chain.unshift(current);
        current = current.parentId === null ? undefined : byId.get(current.parentId);
      }
      return chain;
    },
  };
}

export function inCategory(product: CatalogProduct, categoryId: string) {
  return product.categoryPath.includes(categoryId);
}
