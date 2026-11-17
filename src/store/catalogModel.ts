import type {
  AdminCatalogSnapshot,
  CatalogCategory,
  CatalogDesigner,
  CatalogDiscount,
  CatalogProduct,
  CatalogReturnPolicy,
  CatalogSnapshot,
  CatalogVariant,
  MediaAsset,
  VariantPricing,
} from "../api/catalog";
import type { DeliveryFeeRefund, ReturnRule } from "../api/orders";
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
const isCount = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0;
/** A field that older payloads omit: absent or null, or well formed when present. */
const isOptional = (value: unknown, check: (value: unknown) => boolean) => value === undefined || value === null || check(value);

/** Largest amount the API serializes. */
const MAX_MONEY = 999_999_999_999.99;
const MONEY_TEXT = /^\d+(\.\d{1,2})?$/;
const MAX_PERCENT = 100;

/** A server amount: finite, non-negative, bounded and at most two decimal places. */
export function isMoney(value: unknown): value is number {
  return isNumber(value) && value >= 0 && value <= MAX_MONEY && MONEY_TEXT.test(String(value));
}

export const RETURN_RULES: readonly ReturnRule[] = ["STANDARD", "FAULT_ONLY", "UNOPENED_OR_FAULT"];
const DELIVERY_FEE_REFUNDS: readonly DeliveryFeeRefund[] = ["MERCHANT_FAULT_ONLY", "ALWAYS", "NEVER"];
/** The server accepts return windows of 1 to 365 days. */
const MAX_RETURN_WINDOW_DAYS = 365;

export const isReturnRule = (value: unknown): value is ReturnRule => RETURN_RULES.some((rule) => rule === value);
export const isDeliveryFeeRefund = (value: unknown): value is DeliveryFeeRefund =>
  DELIVERY_FEE_REFUNDS.some((rule) => rule === value);
export const isReturnWindowDays = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 1 && Number(value) <= MAX_RETURN_WINDOW_DAYS;

function isCatalogReturnPolicy(value: unknown): value is CatalogReturnPolicy {
  return isRecord(value) && Number.isInteger(value.version) && Number(value.version) > 0 &&
    isReturnWindowDays(value.windowDays) && isDeliveryFeeRefund(value.deliveryFeeRefund) &&
    typeof value.partialReturns === "boolean" && value.refundRounding === "UP_TO_WHOLE_KES";
}

/** Media fields added after the first catalog revision; payloads from before them omit them. */
export function hasValidLaterMediaFields(value: Record<string, unknown>) {
  return isOptional(value.variantId, isString) && isOptional(value.format, isString) && isOptional(value.bytes, isCount) &&
    isOptional(value.width, isNumber) && isOptional(value.height, isNumber);
}

/** Reads fields an older payload omits as null, so `null` always means "not set". */
export function withMediaDefaults(asset: MediaAsset): MediaAsset {
  return {
    ...asset,
    variantId: asset.variantId ?? null,
    format: asset.format ?? null,
    bytes: asset.bytes ?? null,
    width: asset.width ?? null,
    height: asset.height ?? null,
  };
}

export function withProductMediaDefaults<T extends CatalogProduct>(product: T): T {
  return { ...product, images: product.images.map(withMediaDefaults) };
}

function isMediaAsset(value: unknown): value is MediaAsset {
  return isRecord(value) && isString(value.id) && isString(value.url) && typeof value.isPlaceholder === "boolean" &&
    typeof value.isMain === "boolean" && isNumber(value.order) && isNullableString(value.alt) && hasValidLaterMediaFields(value);
}

function isPricing(value: unknown): value is VariantPricing {
  return isRecord(value) && isMoney(value.price) && isMoney(value.originalPrice) &&
    (value.comparePrice === null || isMoney(value.comparePrice)) &&
    isNumber(value.discountPercent) && value.discountPercent >= 0 && value.discountPercent <= MAX_PERCENT &&
    isNullableString(value.discountId);
}

function isVariant(value: unknown): value is CatalogVariant {
  return isRecord(value) && isString(value.id) && isString(value.sku) && isStringRecord(value.attributes) &&
    isNumber(value.price) && isPricing(value.pricing) &&
    isCount(value.onHand) && isCount(value.reserved) && isCount(value.stock) &&
    isNumber(value.minThreshold) && typeof value.isActive === "boolean";
}

export function isCatalogProduct(value: unknown): value is CatalogProduct {
  return isRecord(value) && isString(value.id) && isString(value.name) && isString(value.description) &&
    isNumber(value.price) && (value.comparePrice === null || isNumber(value.comparePrice)) &&
    isString(value.categoryId) && isString(value.categoryName) && isStringArray(value.categoryPath) &&
    isNullableString(value.designerId) && isStringArray(value.tags) && isNullableString(value.collection) &&
    isStringRecord(value.specifications) && typeof value.isActive === "boolean" &&
    typeof value.isFeatured === "boolean" && typeof value.isDemo === "boolean" && isReturnRule(value.returnRule) &&
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
    isNullableString(value.couponCode) &&
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
  const { products, categories, designers, discounts, returnPolicy } = data;
  if (!Array.isArray(products) || !products.every(isCatalogProduct)) throw new CatalogFormatError("products");
  if (!Array.isArray(categories) || !categories.every(isCategory)) throw new CatalogFormatError("categories");
  if (!Array.isArray(designers) || !designers.every(isDesigner)) throw new CatalogFormatError("designers");
  if (!Array.isArray(discounts) || !discounts.every(isDiscount)) throw new CatalogFormatError("discounts");
  if (!isCatalogReturnPolicy(returnPolicy)) throw new CatalogFormatError("return policy");
  return { version: 2, mode, products: products.map(withProductMediaDefaults), categories, designers, discounts, returnPolicy };
}

/** A version as the API issues it (`Date#toISOString()`); the server compares the one sent back exactly. */
const isVersion = (value: unknown): value is string =>
  isString(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;

/** Adds each raw record's version to its validated counterpart (same order), or throws. */
function withVersions<T>(items: readonly T[], raw: unknown, detail: string): (T & { updatedAt: string })[] {
  if (!Array.isArray(raw) || raw.length !== items.length) throw new CatalogFormatError(detail);
  return items.map((item, index) => {
    const source: unknown = raw[index];
    if (!isRecord(source) || !isVersion(source.updatedAt)) throw new CatalogFormatError(`${detail} version`);
    return { ...item, updatedAt: source.updatedAt };
  });
}

/** Validates the staff snapshot (`/admin/catalog`): every record also carries the version an editor saves against. */
export function parseAdminCatalogSnapshot(data: unknown): AdminCatalogSnapshot {
  const snapshot = parseCatalogSnapshot(data, ["admin"]);
  const raw = isRecord(data) ? data : {};
  return {
    ...snapshot,
    mode: "admin",
    products: withVersions(snapshot.products, raw.products, "products"),
    categories: withVersions(snapshot.categories, raw.categories, "categories"),
  };
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
/* Discount status (staff panels); prices come only from the server    */
/* ------------------------------------------------------------------ */

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

/** Display price taken verbatim from the server's per-SKU projection; quotes decide payable totals. */
export type PriceView = {
  /** Projected payable unit price after automatic offers. */
  price: number;
  /** SKU price before automatic offers. */
  originalPrice: number;
  /** Struck-through reference supplied by the server, if any. */
  comparePrice: number | null;
  discountPercent: number;
  /** True on cards when active SKU prices differ and `price` is the lowest. */
  isFromPrice: boolean;
};

export function variantPriceView(variant: CatalogVariant): PriceView {
  const { price, originalPrice, comparePrice, discountPercent } = variant.pricing;
  return { price, originalPrice, comparePrice, discountPercent, isFromPrice: false };
}

/** Card price: the cheapest active SKU's projection, or `null` when no SKU is sellable. */
export function productPriceView(product: CatalogProduct): PriceView | null {
  const variants = activeVariants(product);
  if (!variants.length) return null;
  const cheapest = variants.reduce((best, variant) => (variant.pricing.price < best.pricing.price ? variant : best));
  return {
    ...variantPriceView(cheapest),
    isFromPrice: variants.some((variant) => variant.pricing.price !== cheapest.pricing.price),
  };
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

/** Categories by id and slug, and in display order (`order`, then name) under each parent. */
export type CategoryTree<C extends CatalogCategory = CatalogCategory> = {
  byId: ReadonlyMap<string, C>;
  bySlug: ReadonlyMap<string, C>;
  roots: C[];
  children: (parentId: string) => C[];
  /** Root-to-category chain; stops at a missing parent or a cycle instead of looping. */
  path: (id: string) => C[];
};

const byOrder = (a: CatalogCategory, b: CatalogCategory) => a.order - b.order || a.name.localeCompare(b.name);

export function buildCategoryTree<C extends CatalogCategory>(categories: readonly C[]): CategoryTree<C> {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const bySlug = new Map(categories.map((category) => [category.slug, category]));
  const childMap = new Map<string, C[]>();
  const roots: C[] = [];
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
      const chain: C[] = [];
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
