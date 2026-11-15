import { z } from 'zod';
import { RETURN_REASONS } from '../config/returnPolicy.js';
import { idSchema } from './catalogValidation.js';

const ORDER_STATUSES = ['PENDING', 'PROCESSING', 'SHIPPED', 'READY_FOR_PICKUP', 'DELIVERED', 'CANCELLED'];
const REFUND_STATUSES = ['REQUESTED', 'APPROVED', 'PROCESSING', 'CONFIRMED', 'FAILED', 'UNRESOLVED', 'CANCELLED'];
const note = (max) => z.string().trim().min(1).max(max);

export const staffActionSchema = z.object({
  action: z.enum(['START_PROCESSING', 'MARK_READY_FOR_PICKUP', 'DISPATCH', 'CONFIRM_DELIVERY', 'CONFIRM_PICKUP', 'CANCEL']),
  expectedStatus: z.enum(ORDER_STATUSES),
  reason: note(500).optional(),
  trackingNumber: note(100).regex(/^[\w .:#/-]+$/, 'Use letters, numbers and simple punctuation').optional(),
}).strict();

export const returnRequestSchema = z.object({
  reason: z.enum(RETURN_REASONS),
  comment: note(1000).optional(),
  unopenedDeclared: z.boolean().default(false),
  lines: z.array(z.object({ orderItemId: idSchema, quantity: z.number().int().min(1).max(1_000_000) }).strict())
    .min(1).max(100).refine((lines) => new Set(lines.map((line) => line.orderItemId)).size === lines.length, 'Each item may appear once'),
}).strict();

export const returnDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  expectedStatus: z.literal('REQUESTED'),
  note: note(1000).optional(),
}).strict();

const quantity = z.number().int().min(0).max(1_000_000);
export const returnReceiptSchema = z.object({
  expectedStatus: z.literal('APPROVED'),
  merchantFaultConfirmed: z.boolean(),
  note: note(1000).optional(),
  lines: z.array(z.object({
    returnLineId: idSchema, receivedQuantity: quantity, restockQuantity: quantity, refundableQuantity: quantity,
  }).strict()).min(1).max(100),
}).strict();

export const refundActionSchema = z.object({
  expectedStatus: z.enum(REFUND_STATUSES),
  amount: z.number().int().positive().max(999_999_999).optional(),
  reason: note(500).optional(),
  providerReference: z.string().trim().min(8).max(32).optional(),
}).strict();

export const paymentRefundSchema = z.object({ reason: note(500) }).strict();
export const owedRefundSchema = z.object({
  source: z.enum(['CANCELLATION', 'RETURN']),
  returnId: idSchema.optional(),
  reason: note(500),
}).strict().refine((value) => (value.source === 'RETURN') === (value.returnId !== undefined), {
  message: 'returnId is required for a return refund and not allowed otherwise', path: ['returnId'],
});
export const attentionReadSchema = z.object({ keys: z.array(z.string().min(1).max(200)).min(1).max(100) }).strict();

export const listQuerySchema = (statuses) => z.object({
  status: z.enum(statuses).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const RETURN_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'RECEIVED'];
export { REFUND_STATUSES };
