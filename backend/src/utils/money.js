import { Prisma } from '@prisma/client';

export const Decimal = Prisma.Decimal.clone({ precision: 40, rounding: Prisma.Decimal.ROUND_HALF_UP });
export const MAX_MONEY = new Decimal('999999999999.99');
export const decimal = (value) => new Decimal(value);
export const roundMoney = (value) => decimal(value).toDecimalPlaces(2);
export const sumMoney = (values) => values.reduce((sum, value) => sum.plus(value), decimal(0));

export function moneyNumber(value) {
  const amount = roundMoney(value);
  if (!amount.isFinite() || amount.abs().greaterThan(MAX_MONEY)) {
    throw Object.assign(new Error('Amount exceeds the supported monetary range'), { statusCode: 400, code: 'AMOUNT_OUT_OF_RANGE' });
  }
  const result = amount.toNumber();
  if (!decimal(result).equals(amount)) throw new Error('Money cannot be represented safely in the API response');
  return result;
}

export function isMoneyInput(value) {
  return typeof value === 'number' && Number.isFinite(value) && decimal(value).decimalPlaces() <= 2;
}

export function moneyJsonReplacer(key, value) {
  const original = this[key];
  return Prisma.Decimal.isDecimal(original) ? moneyNumber(original) : value;
}
