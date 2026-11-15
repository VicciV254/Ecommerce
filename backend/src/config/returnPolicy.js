import { createHash } from 'node:crypto';
import { z } from 'zod';

export const RETURN_REASONS = ['CHANGED_MIND', 'FAULTY', 'DAMAGED', 'WRONG_ITEM', 'OTHER'];
export const MERCHANT_FAULT_REASONS = ['FAULTY', 'DAMAGED', 'WRONG_ITEM'];
export const RETURN_RULES = ['STANDARD', 'FAULT_ONLY', 'UNOPENED_OR_FAULT'];

const policySchema = z.object({
  version: z.number().int().positive(),
  windowDays: z.number().int().min(1).max(365),
  deliveryFeeRefund: z.enum(['MERCHANT_FAULT_ONLY', 'ALWAYS', 'NEVER']),
  partialReturns: z.boolean(),
  refundRounding: z.literal('UP_TO_WHOLE_KES'),
  resolutions: z.array(z.literal('REFUND')).min(1).max(1),
  refundMethod: z.literal('MPESA_MANUAL'),
}).strict();

/** User-approved on 2026-11-14; merchant confirmation of final wording remains a release gate. */
export const DEFAULT_RETURN_POLICY = {
  version: 1, windowDays: 7, deliveryFeeRefund: 'MERCHANT_FAULT_ONLY', partialReturns: true,
  refundRounding: 'UP_TO_WHOLE_KES', resolutions: ['REFUND'], refundMethod: 'MPESA_MANUAL',
};

const configError = (message, cause) => Object.assign(new Error(message, { cause }), { statusCode: 503, code: 'RETURN_POLICY_INVALID' });

export function returnPolicy(env = process.env) {
  let input = DEFAULT_RETURN_POLICY;
  if (env.RETURN_POLICY_JSON !== undefined && env.RETURN_POLICY_JSON !== '') {
    if (env.RETURN_POLICY_JSON.length > 4096) throw configError('RETURN_POLICY_JSON exceeds the supported size');
    try { input = JSON.parse(env.RETURN_POLICY_JSON); } catch (error) { throw configError('RETURN_POLICY_JSON must contain valid JSON', error); }
  }
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) throw configError('Return policy configuration is invalid', parsed.error);
  return { ...parsed.data, hash: createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex') };
}

/** The policy terms recorded on an order and shown to customers. */
export const policySnapshot = ({ version, hash, windowDays, deliveryFeeRefund, partialReturns, refundRounding }) =>
  ({ version, hash, windowDays, deliveryFeeRefund, partialReturns, refundRounding });

/** Nearest explicit rule on the category path (root first); defaults to STANDARD. */
export function effectiveReturnRule(path = []) {
  for (let index = path.length - 1; index >= 0; index--) {
    if (RETURN_RULES.includes(path[index]?.returnRule)) return path[index].returnRule;
  }
  return 'STANDARD';
}

export const isMerchantFaultReason = (reason) => MERCHANT_FAULT_REASONS.includes(reason);

/** Whether a reason may be used for an item with this rule; unopened items are verified on receipt. */
export function reasonAllowed(rule, reason, unopenedDeclared = false) {
  if (!RETURN_REASONS.includes(reason)) return false;
  if (isMerchantFaultReason(reason) || rule === 'STANDARD') return true;
  return rule === 'UNOPENED_OR_FAULT' && unopenedDeclared === true;
}

export const allowedReasons = (rule) => rule === 'FAULT_ONLY' ? [...MERCHANT_FAULT_REASONS] : [...RETURN_REASONS];
