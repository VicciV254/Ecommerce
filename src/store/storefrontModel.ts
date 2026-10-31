import type {
  Campaign,
  CatalogCategory,
  CatalogProduct,
  MediaAsset,
  PublishedStorefront,
  StorefrontSettings,
} from "../api/catalog";
import { isRecord } from "../utils/storage";
import type { CategoryTree } from "./catalogModel";
import { COLOR_SLOTS } from "./storefrontTheme";

export const DEFAULT_BRAND_NAME = "Apex Cart";
/** Products rendered per merchandising section on the storefront. */
export const SECTION_PRODUCT_LIMIT = 8;

export class StorefrontFormatError extends Error {
  constructor(detail: string) {
    super(`Storefront settings were not in the expected format (${detail}).`);
    this.name = "StorefrontFormatError";
  }
}

type Section = StorefrontSettings["sections"][number];
const SECTION_TYPES: readonly Section["type"][] = ["departments", "featured", "products", "campaign"];
const CTA_TARGETS: readonly Campaign["cta"]["target"][] = ["shop", "category", "product"];
const LAYOUTS: readonly Campaign["layout"][] = ["split", "overlay", "banner"];

const isString = (value: unknown): value is string => typeof value === "string";
const isNullableString = (value: unknown): value is string | null => value === null || isString(value);
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
const isPercent = (value: unknown) => typeof value === "number" && value >= 0 && value <= 100;
const isFocal = (value: unknown) => isRecord(value) && isPercent(value.x) && isPercent(value.y);
const oneOf = <T extends string>(options: readonly T[], value: unknown): value is T =>
  options.some((option) => option === value);

function isSection(value: unknown): value is Section {
  return isRecord(value) && isString(value.id) && oneOf(SECTION_TYPES, value.type) && isString(value.title) &&
    typeof value.enabled === "boolean" && isStringArray(value.productIds) && isStringArray(value.categoryIds) &&
    isNullableString(value.campaignId);
}

function isCampaign(value: unknown): value is Campaign {
  if (!isRecord(value) || !isRecord(value.cta)) return false;
  return isString(value.id) && isString(value.title) && isString(value.body) && isString(value.conditions) &&
    isString(value.cta.label) && oneOf(CTA_TARGETS, value.cta.target) && isNullableString(value.cta.targetId) &&
    isNullableString(value.desktopMediaId) && isNullableString(value.mobileMediaId) &&
    isFocal(value.desktopFocal) && isFocal(value.mobileFocal) && oneOf(LAYOUTS, value.layout);
}

export function isMedia(value: unknown): value is MediaAsset {
  return isRecord(value) && isString(value.id) && isString(value.url) && isNullableString(value.alt) &&
    typeof value.isPlaceholder === "boolean";
}

export function isStorefrontSettings(value: unknown): value is StorefrontSettings {
  if (!isRecord(value) || !isRecord(value.brand) || !isRecord(value.theme) || !isRecord(value.theme.colors)) return false;
  const colors = value.theme.colors;
  return isString(value.brand.name) && isString(value.brand.tagline) &&
    isNullableString(value.brand.logoMediaId) && isNullableString(value.brand.faviconMediaId) &&
    isString(value.theme.fontId) && COLOR_SLOTS.every((slot) => isString(colors[slot.key])) &&
    Array.isArray(value.sections) && value.sections.every(isSection) &&
    Array.isArray(value.campaigns) && value.campaigns.every(isCampaign);
}

export function parsePublishedStorefront(data: unknown): PublishedStorefront {
  if (!isRecord(data) || typeof data.version !== "number") throw new StorefrontFormatError("version");
  if (!isNullableString(data.publishedAt)) throw new StorefrontFormatError("publication time");
  if (!isStorefrontSettings(data.settings)) throw new StorefrontFormatError("settings");
  if (!Array.isArray(data.media) || !data.media.every(isMedia)) throw new StorefrontFormatError("media");
  return { version: data.version, publishedAt: data.publishedAt, settings: data.settings, media: data.media };
}

/* ------------------------------------------------------------------ */
/* Reference resolution: unknown IDs are reported, never substituted   */
/* ------------------------------------------------------------------ */

export type CatalogLookup = {
  productsById: ReadonlyMap<string, CatalogProduct>;
  products: readonly CatalogProduct[];
  categories: CategoryTree;
};

export type Resolved<T> = { items: T[]; missing: string[] };

export function sectionCategories(section: Section, catalog: CatalogLookup): Resolved<CatalogCategory> {
  if (!section.categoryIds.length) return { items: catalog.categories.roots, missing: [] };
  const items: CatalogCategory[] = [];
  const missing: string[] = [];
  for (const id of section.categoryIds) {
    const category = catalog.categories.byId.get(id);
    if (category) items.push(category);
    else missing.push(id);
  }
  return { items, missing };
}

export function sectionProducts(section: Section, catalog: CatalogLookup): Resolved<CatalogProduct> {
  if (section.type === "featured" && !section.productIds.length) {
    return { items: catalog.products.filter((product) => product.isFeatured).slice(0, SECTION_PRODUCT_LIMIT), missing: [] };
  }
  const items: CatalogProduct[] = [];
  const missing: string[] = [];
  for (const id of section.productIds) {
    const product = catalog.productsById.get(id);
    if (product) items.push(product);
    else missing.push(id);
  }
  return { items: items.slice(0, SECTION_PRODUCT_LIMIT), missing };
}

export type ResolvedCampaign = {
  campaign: Campaign;
  desktop: MediaAsset | null;
  mobile: MediaAsset | null;
  mediaProblems: string[];
  /** Route for the call to action, or null when its target is unavailable. */
  ctaRoute: string | null;
  ctaProblem: string | null;
};

function campaignRoute(cta: Campaign["cta"], catalog: CatalogLookup): string | null {
  if (cta.target === "shop") return "/shop";
  if (cta.targetId === null) return null;
  if (cta.target === "category") {
    const category = catalog.categories.byId.get(cta.targetId);
    return category ? `/shop?cat=${encodeURIComponent(category.slug)}` : null;
  }
  const product = catalog.productsById.get(cta.targetId);
  return product ? `/product/${encodeURIComponent(product.id)}` : null;
}

export function resolveCampaign(
  campaign: Campaign, mediaById: ReadonlyMap<string, MediaAsset>, catalog: CatalogLookup,
): ResolvedCampaign {
  const mediaProblems: string[] = [];
  const media = (id: string | null, label: string) => {
    if (id === null) return null;
    const asset = mediaById.get(id);
    if (!asset) mediaProblems.push(`${label} image ${id} is unavailable`);
    return asset ?? null;
  };
  const ctaRoute = campaignRoute(campaign.cta, catalog);
  return {
    campaign,
    desktop: media(campaign.desktopMediaId, "Desktop"),
    mobile: media(campaign.mobileMediaId, "Mobile"),
    mediaProblems,
    ctaRoute,
    ctaProblem: ctaRoute ? null : `Call-to-action ${campaign.cta.target} ${campaign.cta.targetId ?? "(none)"} is unavailable`,
  };
}
