import { createHash } from 'node:crypto';
import { z } from 'zod';
import { isMoneyInput } from '../utils/money.js';

const amount = z.number().finite().nonnegative().max(999_999_999_999.99).refine(isMoneyInput, 'Amounts support at most two decimal places');
const deliveryRule = z.object({
  fee: amount,
  freeAbove: amount.nullable(),
  counties: z.array(z.string().trim().min(1).max(100)).max(100),
}).strict();

const policySchema = z.object({
  version: z.number().int().positive(),
  currency: z.literal('KES'),
  vatRate: z.literal(16),
  discountStep: z.union([z.literal(0.01), z.literal(1), z.literal(10)]),
  quoteSeconds: z.number().int().min(30).max(1800),
  reservationSeconds: z.number().int().min(60).max(3600),
  delivery: z.object({
    STANDARD: deliveryRule,
    SAME_DAY: deliveryRule,
    STORE_PICKUP: deliveryRule,
  }).strict(),
}).strict();

export const DEFAULT_CHECKOUT_POLICY = {
  version: 1, currency: 'KES', vatRate: 16, discountStep: 10,
  quoteSeconds: 600, reservationSeconds: 900,
  delivery: {
    STANDARD: { fee: 200, freeAbove: null, counties: [] },
    SAME_DAY: { fee: 500, freeAbove: null, counties: [] },
    STORE_PICKUP: { fee: 200, freeAbove: null, counties: [] },
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

function flag(name) {
  const value = process.env[name] ?? 'false';
  if (!['true', 'false'].includes(value)) {
    throw Object.assign(new Error(`${name} must be true or false`), { statusCode: 503, code: 'CHECKOUT_CONFIGURATION_INVALID' });
  }
  return value === 'true';
}

export const reservationsEnabled = () => flag('ENABLE_ORDER_RESERVATIONS');
export const demoOrdersEnabled = () =>
  ['development', 'test'].includes(process.env.NODE_ENV) && flag('ALLOW_DEMO_ORDERS');
