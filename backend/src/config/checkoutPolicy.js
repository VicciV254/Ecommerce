import { createHash } from 'node:crypto';
import { z } from 'zod';
import { isMoneyInput } from '../utils/money.js';

const amount = z.number().finite().nonnegative().max(999_999_999_999.99).refine(isMoneyInput, 'Amounts support at most two decimal places');
const deliveryRule = z.object({
  fee: amount,
  freeAbove: amount.nullable(),
  counties: z.array(z.string().trim().min(1).max(100)).max(100),
}).strict();

/** Every delivery method an order can have, in the order shoppers see the offered ones. */
export const DELIVERY_METHODS = ['STANDARD', 'SAME_DAY', 'STORE_PICKUP'];
export const DELIVERY_METHOD_LABELS = Object.freeze({
  STANDARD: 'Standard delivery',
  SAME_DAY: 'Same-day delivery',
  STORE_PICKUP: 'Store pickup',
});

const policySchema = z.object({
  version: z.number().int().positive(),
  currency: z.literal('KES'),
  vatRate: z.literal(16),
  discountStep: z.union([z.literal(0.01), z.literal(1), z.literal(10)]),
  quoteSeconds: z.number().int().min(30).max(1800),
  reservationSeconds: z.number().int().min(60).max(3600),
  // A method left out is not offered for new orders; orders that already have it keep it.
  delivery: z.object(Object.fromEntries(DELIVERY_METHODS.map((method) => [method, deliveryRule.optional()]))).strict()
    .refine((delivery) => Object.keys(delivery).length > 0, 'Offer at least one delivery method'),
}).strict();

/** Store pickup is off: Apex Cart sells online only (decided 2026-11-18). */
export const DEFAULT_CHECKOUT_POLICY = {
  version: 2, currency: 'KES', vatRate: 16, discountStep: 10,
  quoteSeconds: 600, reservationSeconds: 900,
  delivery: {
    STANDARD: { fee: 200, freeAbove: null, counties: [] },
    SAME_DAY: { fee: 500, freeAbove: null, counties: ['Nairobi'] },
  },
};

export function checkoutPolicy(env = process.env) {
  let input = DEFAULT_CHECKOUT_POLICY;
  if (env.CHECKOUT_POLICY_JSON !== undefined && env.CHECKOUT_POLICY_JSON !== '') {
    if (env.CHECKOUT_POLICY_JSON.length > 16_384) throw Object.assign(new Error('CHECKOUT_POLICY_JSON exceeds the supported size'), { statusCode: 503 });
    try {
      input = JSON.parse(env.CHECKOUT_POLICY_JSON);
    } catch (error) {
      throw Object.assign(new Error('CHECKOUT_POLICY_JSON must contain valid JSON', { cause: error }), { statusCode: 503 });
    }
  }
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) throw Object.assign(new Error('Checkout pricing policy configuration is invalid', { cause: parsed.error }), { statusCode: 503 });
  const value = parsed.data;
  return { ...value, hash: createHash('sha256').update(JSON.stringify(value)).digest('hex') };
}

/** The offered methods as shoppers may know them: fee, free-delivery threshold and covered counties (none = all Kenya). */
export const offeredDelivery = (policy) => DELIVERY_METHODS.flatMap((method) => {
  const rule = policy.delivery[method];
  return rule ? [{ method, fee: rule.fee, freeAbove: rule.freeAbove, counties: rule.counties }] : [];
});

const configurationError = (message) =>
  Object.assign(new Error(message), { statusCode: 503, code: 'CHECKOUT_CONFIGURATION_INVALID' });

function flag(name, env = process.env) {
  const value = env[name] ?? 'false';
  if (!['true', 'false'].includes(value)) throw configurationError(`${name} must be true or false`);
  return value === 'true';
}

export const reservationsEnabled = () => flag('ENABLE_ORDER_RESERVATIONS');

/**
 * The public demonstration store's switch, valid in any NODE_ENV: every orderable product is a sample, sample orders
 * are paid with a demonstration payment, and M-Pesa may use only Safaricom's sandbox. Read first by every rule that
 * uses it, so an invalid value is always refused.
 */
export const demonstrationStore = (env = process.env) => flag('DEMONSTRATION_STORE', env);
export const demoOrdersEnabled = () =>
  demonstrationStore() || (['development', 'test'].includes(process.env.NODE_ENV) && flag('ALLOW_DEMO_ORDERS'));

const DEFAULT_DEMO_ORDER_DAILY_LIMIT = 10;
/** Most sample orders one account may create in 24 hours: `DEMO_ORDER_DAILY_LIMIT`, a positive whole number. */
export function demoOrderDailyLimit(env = process.env) {
  const value = env.DEMO_ORDER_DAILY_LIMIT;
  if (value === undefined) return DEFAULT_DEMO_ORDER_DAILY_LIMIT;
  if (!/^[1-9]\d{0,8}$/.test(value)) throw configurationError('DEMO_ORDER_DAILY_LIMIT must be a positive whole number');
  return Number(value);
}
