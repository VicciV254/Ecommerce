import { z } from 'zod';
import { isMoneyInput } from './money.js';

export const STOREFRONT_KEY = 'storefront-v2';
export const idSchema = z.string().trim().min(1).max(180);
const slugSchema = z.string().trim().min(1).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const text = (max) => z.string().trim().max(max);
const optionalText = (max) => text(max).nullable().optional();
const money = z.number().finite().positive().max(1_000_000_000).refine(isMoneyInput, 'Amounts support at most two decimal places');
const unique = (items) => new Set(items).size === items.length;

export const MEDIA_UPLOAD_FORMATS = ['jpg', 'png', 'webp', 'avif'];
/** The Cloudinary account's per-image limit (Free plan). */
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
/** Uploads are resized on arrival to fit this box, which still leaves detail for zoom. */
export const MEDIA_MAX_DIMENSION = 3000;

/** Whitespace or control characters could add extra srcset candidates or break markup. */
const hasUnsafeCharacters = (value) => /\s/.test(value) || [...value].some((char) => char.codePointAt(0) < 0x20 || char.codePointAt(0) === 0x7f);

export const imageUrlSchema = z.string().max(2048).refine((value) => {
  if (hasUnsafeCharacters(value)) return false;
  try {
    const url = new URL(value, 'https://local.invalid');
    if (url.username || url.password || value.includes('\\')) return false;
    if (value.startsWith('/')) return value.startsWith('/images/') && !value.includes('..') && url.origin === 'https://local.invalid';
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}, 'Images must use one HTTPS URL without credentials or spaces, or a local /images/ path');

const attributes = z.record(z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/), text(80).min(1))
  .refine((value) => Object.keys(value).length <= 8, 'At most eight variant attributes are supported');
const specifications = z.record(text(60).min(1), text(500).min(1))
  .refine((value) => Object.keys(value).length <= 32, 'At most 32 specifications are supported');

export const catalogStockSchema = z.object({
  quantity: z.number().int().min(0).max(1_000_000),
  maxStock: z.number().int().min(0).max(1_000_000).optional(),
  minThreshold: z.number().int().min(0).max(1_000_000).optional(),
}).strict();

/** The result of a signed direct upload, as returned by Cloudinary to the browser. */
const cloudinaryUploadSchema = z.object({
  publicId: z.string().max(255).regex(/^[a-z0-9-]+(?:\/[a-z0-9-]+)+$/),
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  signature: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i),
  format: z.enum(MEDIA_UPLOAD_FORMATS),
  bytes: z.number().int().positive().max(MEDIA_MAX_BYTES),
}).strict();

export const mediaSchema = z.object({
  id: idSchema.optional(),
  url: imageUrlSchema.optional(),
  cloudinary: cloudinaryUploadSchema.optional(),
  variantId: idSchema.nullable().optional(),
  alt: optionalText(240),
  isMain: z.boolean().optional(),
  order: z.number().int().min(0).max(100).optional(),
  width: z.number().int().positive().max(20_000).nullable().optional(),
  height: z.number().int().positive().max(20_000).nullable().optional(),
  isPlaceholder: z.boolean().optional(),
  sourceUrl: imageUrlSchema.nullable().optional(),
  license: optionalText(240),
  credit: optionalText(240),
}).strict().superRefine((value, ctx) => {
  const issue = (message, field) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, ...(field && { path: [field] }) });
  // Retained images may omit stored attribution; the merged result is checked when the product is written.
  if (!value.id && value.isPlaceholder && (!value.sourceUrl || !value.license)) issue('Placeholder media needs its source and reuse license');
  if (value.cloudinary && value.url !== undefined) issue('Send either an image address or an upload, not both', 'url');
  if (!value.id && !value.cloudinary && value.url === undefined) issue('A new image needs an HTTPS address or an upload', 'url');
  if (value.id && value.cloudinary) issue('To replace an image, remove it and add the new upload', 'cloudinary');
  const fits = (size) => size > 0 && size <= MEDIA_MAX_DIMENSION;
  if (value.cloudinary && !(fits(value.width) && fits(value.height))) {
    issue(`Uploaded images need their width and height, up to ${MEDIA_MAX_DIMENSION} pixels`, 'width');
  }
});

export const variantSchema = z.object({
  id: idSchema.optional(),
  sku: text(80).min(3).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).optional(),
  attributes: attributes.optional(),
  price: money.nullable().optional(),
  isActive: z.boolean().optional(),
  stock: catalogStockSchema.optional(),
}).strict();

export const catalogProductSchema = z.object({
  name: text(180).min(3),
  slug: slugSchema.optional(),
  description: text(10_000).min(10),
  price: money,
  compareAtPrice: money.nullable().optional(),
  categoryId: idSchema,
  designerId: idSchema.nullable().optional(),
  tags: z.array(text(60).min(1)).max(30).optional(),
  collection: optionalText(100),
  specifications: specifications.optional(),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  variants: z.array(variantSchema).min(1).max(50).optional(),
  images: z.array(mediaSchema).max(16).optional(),
}).strict();
export const catalogProductPatchSchema = catalogProductSchema.partial();

export const catalogCategorySchema = z.object({
  name: text(120).min(2),
  slug: slugSchema.optional(),
  parentId: idSchema.nullable().optional(),
  headerImage: imageUrlSchema.nullable().optional(),
  attributeKeys: z.array(text(60).min(1)).max(32).refine(unique, 'Specification keys must be unique').optional(),
  isActive: z.boolean().optional(),
}).strict();
export const catalogCategoryPatchSchema = catalogCategorySchema.partial();

/** More siblings than one parent can hold in this catalog; a longer list is malformed. */
const MAX_REORDERED_SIBLINGS = 1000;
/** Category order changes only here: every sibling of `parentId` (null for departments), in their new order. */
export const categoryReorderSchema = z.object({
  parentId: idSchema.nullable(),
  orderedIds: z.array(idSchema).min(1).max(MAX_REORDERED_SIBLINGS),
}).strict();

/**
 * A staff edit's concurrency token: exactly the `updatedAt` the editor loaded (the server issues `Date#toISOString()`),
 * as a Date, or null when it is missing or malformed. Offsets, other precisions and impossible dates are malformed.
 */
export function readVersionToken(value) {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isNaN(time) || new Date(time).toISOString() !== value ? null : new Date(time);
}

/** Splits an edit request into its token (null when missing or malformed) and the changes to validate. */
export function splitVersionedEdit(body) {
  const { expectedUpdatedAt, ...changes } = body !== null && typeof body === 'object' && !Array.isArray(body) ? body : {};
  return { expected: readVersionToken(expectedUpdatedAt), changes };
}

export const catalogDesignerSchema = z.object({
  designerId: slugSchema,
  fullName: text(120).min(2),
  specialty: text(240).min(2),
  location: text(160).optional(),
  profileImage: imageUrlSchema.nullable().optional(),
  spotlightHeading: optionalText(180),
  spotlightText: optionalText(1000),
  isActive: z.boolean().optional(),
}).strict();
export const catalogDesignerPatchSchema = catalogDesignerSchema.partial();

export const productQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  category: idSchema.optional(),
  designer: idSchema.optional(),
  search: text(120).optional(),
  q: text(120).optional(),
  featured: z.enum(['true', 'false']).optional(),
  active: z.enum(['true', 'false']).optional(),
}).strict();

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const colors = z.object({
  primary: color, secondary: color, accent: color, warmBeige: color,
  oceanBlue: color, oceanBlueDark: color, coral: color, success: color,
  warning: color, error: color, charcoal: color, offWhite: color,
  lightGray: color, lightPink: color,
}).strict();
const focal = z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) }).strict();
const reference = idSchema.nullable();
const campaignSchema = z.object({
  id: slugSchema,
  title: text(180).min(1),
  body: text(1200),
  conditions: text(800),
  cta: z.object({ label: text(80).min(1), target: z.enum(['shop', 'category', 'product']), targetId: reference }).strict(),
  desktopMediaId: reference,
  mobileMediaId: reference,
  desktopFocal: focal,
  mobileFocal: focal,
  layout: z.enum(['split', 'overlay', 'banner']),
}).strict().superRefine((value, ctx) => {
  if (value.cta.target !== 'shop' && !value.cta.targetId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A catalog CTA requires its target ID' });
  }
  if (value.cta.target === 'shop' && value.cta.targetId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'The shop CTA does not take a target ID' });
  }
  if (value.mobileMediaId && !value.desktopMediaId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Mobile artwork requires desktop artwork as the supported fallback' });
  }
});
/** Section kinds; a department row (`category`) shows one category's products, `promises` the shopping facts strip. */
const SECTION_TYPES = ['departments', 'featured', 'products', 'campaign', 'category', 'promises', 'bestSellers', 'carousel'];
/** The kinds that may set `layout`; without one, each shows in its established default (decided when rendering). */
const LAYOUT_TYPES = new Set(['departments', 'featured', 'products', 'category']);
/** The measured best sellers' heading, fixed by the app: the ranking is measured, so its heading is not a staff claim. */
const BEST_SELLERS_TITLE = 'Best sellers';
/** Campaigns a storefront may hold; a hero carousel's list can never be longer. */
const MAX_CAMPAIGNS = 8;
/** Slides a hero carousel shows, in the order listed. */
const CAROUSEL_SLIDES = { min: 1, max: 5 };
const sectionSchema = z.object({
  id: slugSchema,
  type: z.enum(SECTION_TYPES),
  title: text(180).min(1),
  enabled: z.boolean(),
  productIds: z.array(idSchema).max(24).refine(unique),
  categoryIds: z.array(idSchema).max(30).refine(unique),
  campaignId: reference,
  layout: z.enum(['grid', 'rail']).optional(),
  /** A hero carousel's campaigns, in slide order; absent on every other kind (never an empty list there). */
  campaignIds: z.array(idSchema).max(MAX_CAMPAIGNS).optional(),
}).strict();

export const storefrontSchema = z.object({
  brand: z.object({
    name: text(100).min(1), tagline: text(180),
    logoMediaId: reference, faviconMediaId: reference,
  }).strict(),
  theme: z.object({
    fontId: z.enum(['default', 'playfair', 'cormorant', 'cinzel', 'dm-serif', 'lora']),
    colors,
  }).strict(),
  sections: z.array(sectionSchema).max(12),
  campaigns: z.array(campaignSchema).max(MAX_CAMPAIGNS),
}).strict().superRefine((value, ctx) => {
  if (!unique(value.sections.map((item) => item.id)) || !unique(value.campaigns.map((item) => item.id))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Section and campaign IDs must be unique' });
  }
  const campaigns = new Set(value.campaigns.map((item) => item.id));
  for (const section of value.sections) {
    if (section.type === 'products' && !section.productIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A product section requires product references' });
    }
    if (section.type === 'campaign' && !campaigns.has(section.campaignId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A campaign section requires a valid campaign reference' });
    }
    if (section.type !== 'campaign' && section.campaignId !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only campaign sections may reference a campaign' });
    }
    if (section.layout !== undefined && !LAYOUT_TYPES.has(section.type)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only departments, featured products, selected products and department row sections have a layout' });
    }
    if (section.type === 'category' && (section.categoryIds.length !== 1 || section.productIds.length)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A department row shows exactly one category and no chosen products' });
    }
    if ((section.type === 'promises' || section.type === 'bestSellers') && (section.productIds.length || section.categoryIds.length)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Shopping facts and best sellers sections take no products or categories' });
    }
    if (section.type === 'bestSellers' && section.title !== BEST_SELLERS_TITLE) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `The best sellers section is titled "${BEST_SELLERS_TITLE}"` });
    }
    if (section.type !== 'carousel' && section.campaignIds !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only a hero carousel lists campaigns' });
    }
    if (section.type === 'carousel') {
      const listed = section.campaignIds ?? [];
      if (listed.length < CAROUSEL_SLIDES.min || listed.length > CAROUSEL_SLIDES.max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `A hero carousel shows ${CAROUSEL_SLIDES.min} to ${CAROUSEL_SLIDES.max} campaigns` });
      }
      if (!unique(listed)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A hero carousel lists each campaign once' });
      if (listed.some((id) => !campaigns.has(id))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A hero carousel requires valid campaign references' });
      }
      if (section.productIds.length || section.categoryIds.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A hero carousel takes no products or categories' });
      }
    }
  }
  const count = (type) => value.sections.filter((section) => section.type === type).length;
  if (count('promises') > 1 || count('bestSellers') > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A storefront has at most one shopping facts section and one best sellers section' });
  }
  if (count('carousel') > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A storefront has at most one hero carousel' });
  }
});

export const storefrontDraftSchema = z.object({
  version: z.number().int().positive(),
  settings: storefrontSchema,
}).strict();
export const versionSchema = z.object({ version: z.number().int().positive() }).strict();

/**
 * Section headings may not claim a ranking or popularity the store doesn't measure: it has no rating or popularity data,
 * and staff choose what product sections show. The one exception is the best sellers section, whose heading the app
 * fixes and whose products the store measures from paid orders (`bestSellersService.js`). The editor mirrors these
 * (`src/store/storefrontClaims.ts`). Checked on writes only (save, publish, restore), never in `storefrontSchema`, so
 * documents stored earlier still load.
 */
const RANKING_CLAIMS = [
  /\b(?:best|top|hot|fast)[\s-]*sell(?:er|ers|ing)\b/,
  /\b(?:top|highest|best)[\s-]*rated\b/,
  /\bmost[\s-]+(?:popular|loved|wanted|bought|purchased|viewed|reviewed|wished)\b/,
  /\bpopular\b/,
  /\btrending\b/,
  /\b(?:customer|shopper|fan)(?:s'?|'s)?[\s-]*(?:favou?rites?|picks?|choice)\b/,
  /(?:#|\bno\.?\s*|\bnumber\s+)1\b/,
];

export const claimsUnmeasuredRanking = (title) => {
  const heading = title.toLowerCase().replace(/[‘’]/g, "'");
  return RANKING_CLAIMS.some((pattern) => pattern.test(heading));
};

export const rankingClaimMessage = (title) => `Section "${title}": headings can't claim a ranking or popularity the store doesn't measure, such as "best sellers", "top rated" or "trending". Use a heading such as "Featured" or "Staff picks".`;

/** One issue per section heading that claims an unmeasured ranking, at its path in the settings (`sections.<i>.title`). */
export function storefrontClaimIssues(settings) {
  return settings.sections.flatMap((section, index) => (section.type !== 'bestSellers' && claimsUnmeasuredRanking(section.title)
    ? [{ code: z.ZodIssueCode.custom, path: ['sections', index, 'title'], message: rankingClaimMessage(section.title) }]
    : []));
}

/** Refuses settings with a ranking claim as a validation error (400), like the schema's own issues. */
export function assertNoRankingClaims(settings) {
  const issues = storefrontClaimIssues(settings);
  if (issues.length) throw new z.ZodError(issues);
}

/** The highest page a list may be asked for; the admin's address parser uses the same limit. */
export const MAX_LIST_PAGE = 10_000;
/** The largest value of a Postgres INTEGER, the type of every stored version. */
const MAX_STORED_VERSION = 2_147_483_647;
const WHOLE_NUMBER = /^[1-9]\d*$/;

/** A page number exactly as written in a query (digits, from 1); anything else is refused, never read as page 1. */
export const pageQuery = z.string().regex(WHOLE_NUMBER, 'Use a whole page number from 1').transform(Number)
  .refine((page) => page <= MAX_LIST_PAGE, `Use a page number up to ${MAX_LIST_PAGE}`)
  .default('1');
export const revisionListQuerySchema = z.object({ page: pageQuery }).strict();
export const revisionParamsSchema = z.object({
  version: z.string().regex(WHOLE_NUMBER, 'Use a published version number').transform(Number)
    .refine((version) => version <= MAX_STORED_VERSION, 'Use a published version number'),
}).strict();

export const catalogDiscountSchema = z.object({
  name: text(180).min(2),
  type: z.enum(['PERCENTAGE', 'FIXED']),
  value: money,
  couponCode: z.string().trim().toUpperCase().min(3).max(40).regex(/^[A-Z0-9_-]+$/).nullable().optional(),
  applyTo: z.enum(['ALL', 'CATEGORY', 'SELECTED']),
  targetIds: z.array(idSchema).max(200).refine(unique).default([]),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().nullable().optional(),
  isActive: z.boolean().optional(),
}).strict();
export const catalogDiscountPatchSchema = catalogDiscountSchema.partial();
