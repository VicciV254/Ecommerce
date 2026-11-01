import { z } from 'zod';
import { idSchema } from './catalogValidation.js';

export const couponCodeSchema = z.string().trim().toUpperCase().min(3).max(40).regex(/^[A-Z0-9_-]+$/);
export const quoteInputSchema = z.object({
  items: z.array(z.object({
    productId: idSchema,
    variantId: idSchema,
    quantity: z.number().int().min(1).max(1_000_000),
  }).strict()).min(1).max(100).refine((items) => new Set(items.map((item) => item.variantId)).size === items.length, 'Each variant must appear once'),
  addressId: idSchema,
  deliveryMethod: z.enum(['STANDARD', 'SAME_DAY', 'STORE_PICKUP']).default('STANDARD'),
  couponCode: couponCodeSchema.nullable().default(null),
  notes: z.string().trim().max(1000).nullable().default(null),
}).strict();
export const orderInputSchema = z.object({ quoteId: idSchema }).strict();
export const idempotencyKeySchema = z.string().min(16).max(128).regex(/^[A-Za-z0-9:_-]+$/);
export const cancellationSchema = z.object({ reason: z.string().trim().max(1000).optional() }).strict();
