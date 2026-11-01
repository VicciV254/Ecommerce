import { z } from 'zod';
import { isMoneyInput } from './money.js';

export const STOREFRONT_KEY = 'storefront-v2';
export const idSchema = z.string().trim().min(1).max(180);
const slugSchema = z.string().trim().min(1).max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const text = (max) => z.string().trim().max(max);
const optionalText = (max) => text(max).nullable().optional();
const money = z.number().finite().positive().max(1_000_000_000).refine(isMoneyInput, 'Amounts support at most two decimal places');
const unique = (items) => new Set(items).size === items.length;

export const imageUrlSchema = z.string().max(2048).refine((value) => {
  try {
    const url = new URL(value, 'https://local.invalid');
    if (url.username || url.password || value.includes('\\')) return false;
    if (value.startsWith('/')) return value.startsWith('/images/') && !value.includes('..') && url.origin === 'https://local.invalid';
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}, 'Images must use an HTTPS URL without credentials, or a local /images/ path');

const attributes = z.record(z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/), text(80).min(1))
  .refine((value) => Object.keys(value).length <= 8, 'At most eight variant attributes are supported');
const specifications = z.record(text(60).min(1), text(500).min(1))
  .refine((value) => Object.keys(value).length <= 32, 'At most 32 specifications are supported');

export const catalogStockSchema = z.object({
  quantity: z.number().int().min(0).max(1_000_000),
  maxStock: z.number().int().min(0).max(1_000_000).optional(),
  minThreshold: z.number().int().min(0).max(1_000_000).optional(),
}).strict();

export const mediaSchema = z.object({
  id: idSchema.optional(),
  url: imageUrlSchema,
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
  if (value.isPlaceholder && (!value.sourceUrl || !value.license)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Placeholder media needs its source and reuse license' });
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
  order: z.number().int().min(0).max(10_000).optional(),
  headerImage: imageUrlSchema.nullable().optional(),
  attributeKeys: z.array(text(60).min(1)).max(32).refine(unique, 'Specification keys must be unique').optional(),
  isActive: z.boolean().optional(),
}).strict();
export const catalogCategoryPatchSchema = catalogCategorySchema.partial();

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
const sectionSchema = z.object({
  id: slugSchema,
  type: z.enum(['departments', 'featured', 'products', 'campaign']),
  title: text(180).min(1),
  enabled: z.boolean(),
  productIds: z.array(idSchema).max(24).refine(unique),
  categoryIds: z.array(idSchema).max(30).refine(unique),
  campaignId: reference,
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
  campaigns: z.array(campaignSchema).max(8),
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
  }
});

export const storefrontDraftSchema = z.object({
  version: z.number().int().positive(),
  settings: storefrontSchema,
}).strict();
export const versionSchema = z.object({ version: z.number().int().positive() }).strict();

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
