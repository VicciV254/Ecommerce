import type {
  BestSellers,
  Campaign,
  CatalogCategory,
  CatalogProduct,
  MediaAsset,
  PublishedStorefront,
  StorefrontRevision,
  StorefrontRevisionPage,
  StorefrontSettings,
} from "../api/catalog";
import { isRecord } from "../utils/storage";
import { hasValidLaterMediaFields, inCategory, withMediaDefaults, type CategoryTree } from "./catalogModel";
import { isPagination } from "./orderModel";
import { COLOR_SLOTS } from "./storefrontTheme";

export const DEFAULT_BRAND_NAME = "Apex Cart";
/** Products a merchandising section shows as a grid (4, 6 then 8 by breakpoint). */
export const SECTION_PRODUCT_LIMIT = 8;
/** Products a section shows as a row shoppers scroll. */
export const RAIL_PRODUCT_LIMIT = 12;
/** The measured best sellers' heading, fixed by the API. */
export const BEST_SELLERS_TITLE = "Best sellers";
/**
 * The API's best sellers rules (`backend/src/services/bestSellersService.js`), mirrored for the staff explanations; the
 * shopper's page shows the section only when at least `minProducts` ranked products are in its catalog.
 */
export const BEST_SELLERS_RULES = { windowDays: 30, minBuyers: 2, minProducts: 4 } as const;

export class StorefrontFormatError extends Error {
  constructor(detail: string) {
    super(`Storefront settings were not in the expected format (${detail}).`);
    this.name = "StorefrontFormatError";
  }
}

type Section = StorefrontSettings["sections"][number];
export type SectionLayout = NonNullable<Section["layout"]>;
const SECTION_TYPES: readonly Section["type"][] = ["departments", "featured", "products", "campaign", "category", "promises", "bestSellers"];
/** The kinds with a grid or row layout, and the layout each shows when none is set (as before layouts existed). */
const DEFAULT_LAYOUTS = { departments: "rail", featured: "grid", products: "grid", category: "rail" } as const satisfies Partial<Record<Section["type"], SectionLayout>>;
export type LayoutKind = keyof typeof DEFAULT_LAYOUTS;
const SECTION_LAYOUTS: readonly SectionLayout[] = ["grid", "rail"];
const CTA_TARGETS: readonly Campaign["cta"]["target"][] = ["shop", "category", "product"];
const LAYOUTS: readonly Campaign["layout"][] = ["split", "overlay", "banner"];

const isString = (value: unknown): value is string => typeof value === "string";
const isNullableString = (value: unknown): value is string | null => value === null || isString(value);
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
const isPercent = (value: unknown) => typeof value === "number" && value >= 0 && value <= 100;
const isFocal = (value: unknown) => isRecord(value) && isPercent(value.x) && isPercent(value.y);
const oneOf = <T extends string>(options: readonly T[], value: unknown): value is T =>
  options.some((option) => option === value);

const LAYOUT_KINDS: ReadonlySet<string> = new Set(Object.keys(DEFAULT_LAYOUTS));
export const takesLayout = (type: Section["type"]): type is LayoutKind => LAYOUT_KINDS.has(type);

/** How a section shows: its own layout, or its kind's default (departments and department rows as rows, products as grids). */
export function sectionLayout(section: Pick<Section, "layout"> & { type: LayoutKind }): SectionLayout {
  return section.layout ?? DEFAULT_LAYOUTS[section.type];
}

function isSection(value: unknown): value is Section {
  if (!isRecord(value) || !oneOf(SECTION_TYPES, value.type)) return false;
  const layout = value.layout === undefined || (takesLayout(value.type) && oneOf(SECTION_LAYOUTS, value.layout));
  return isString(value.id) && isString(value.title) && layout &&
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
    typeof value.isPlaceholder === "boolean" && hasValidLaterMediaFields(value);
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

/**
 * Settings without the sections of a kind this version doesn't know, so a kind added later (or kept after a rollback)
 * is not shown instead of failing the whole page. Only shoppers' storefront reads this way; staff drafts stay strict,
 * so an editor never drops a section it doesn't understand.
 */
function withKnownSections(settings: unknown): unknown {
  if (!isRecord(settings) || !Array.isArray(settings.sections)) return settings;
  const unknownKind = (section: unknown) => isRecord(section) && isString(section.type) && !oneOf(SECTION_TYPES, section.type);
  return { ...settings, sections: settings.sections.filter((section) => !unknownKind(section)) };
}

export function parsePublishedStorefront(data: unknown): PublishedStorefront {
  if (!isRecord(data) || typeof data.version !== "number") throw new StorefrontFormatError("version");
  if (!isNullableString(data.publishedAt)) throw new StorefrontFormatError("publication time");
  const settings = withKnownSections(data.settings);
  if (!isStorefrontSettings(settings)) throw new StorefrontFormatError("settings");
  if (!Array.isArray(data.media) || !data.media.every(isMedia)) throw new StorefrontFormatError("media");
  return { version: data.version, publishedAt: data.publishedAt, settings, media: data.media.map(withMediaDefaults) };
}

function isRevision(value: unknown): value is StorefrontRevision {
  return isRecord(value) && Number.isInteger(value.version) && Number(value.version) > 0 &&
    isString(value.publishedAt) && !Number.isNaN(Date.parse(value.publishedAt)) &&
    isNullableString(value.publishedBy) && typeof value.live === "boolean";
}

/** A page of the publication history as the API sends it, or null when it is not in that shape. */
export function parseRevisionPage(data: unknown): StorefrontRevisionPage | null {
  if (!isRecord(data) || !Array.isArray(data.revisions) || !data.revisions.every(isRevision) || !isPagination(data.pagination)) return null;
  return { revisions: data.revisions, pagination: data.pagination };
}

/** The best sellers answer, or null when it is not exactly in the API's shape (the section then stays hidden). */
export function parseBestSellers(data: unknown): BestSellers | null {
  if (!isRecord(data) || !Number.isInteger(data.windowDays) || Number(data.windowDays) <= 0 || !isStringArray(data.productIds)) return null;
  return { windowDays: Number(data.windowDays), productIds: data.productIds };
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

/** Up to `limit` products for a featured or selected-products section; featured without choices shows Featured products. */
export function sectionProducts(section: Section, catalog: CatalogLookup, limit = SECTION_PRODUCT_LIMIT): Resolved<CatalogProduct> {
  if (section.type === "featured" && !section.productIds.length) {
    return { items: catalog.products.filter((product) => product.isFeatured).slice(0, limit), missing: [] };
  }
  const items: CatalogProduct[] = [];
  const missing: string[] = [];
  for (const id of section.productIds) {
    const product = catalog.productsById.get(id);
    if (product) items.push(product);
    else missing.push(id);
  }
  return { items: items.slice(0, limit), missing };
}

/**
 * A department row: its category and every product in it or below it, in catalog order (the order of page 1 of the
 * category's listing); the category is null when the catalog doesn't show it.
 */
export function departmentRow(section: Section, catalog: CatalogLookup): { category: CatalogCategory | null; products: CatalogProduct[] } {
  const category = catalog.categories.byId.get(section.categoryIds[0] ?? "") ?? null;
  return { category, products: category ? catalog.products.filter((product) => inCategory(product, category.id)) : [] };
}

/** The ranked products the catalog shows, in the API's order, at most a row's worth. */
export function bestSellerProducts(productIds: readonly string[], catalog: CatalogLookup): CatalogProduct[] {
  return productIds.flatMap((id) => catalog.productsById.get(id) ?? []).slice(0, RAIL_PRODUCT_LIMIT);
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
