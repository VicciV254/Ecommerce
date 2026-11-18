import { DELIVERY_METHOD_LABELS } from '../config/checkoutPolicy.js';
import { Decimal, decimal, moneyNumber, roundMoney, sumMoney } from '../utils/money.js';

const pricingError = (message, code = 'PRICING_INVALID') =>
  Object.assign(new Error(message), { statusCode: 400, code });

/** Apostrophe-like marks people type inside county names (Murang'a): removed before anything else. */
const APOSTROPHES = /['\u2018\u2019\u02BC`\u00B4\u2032]/gu;
const IGNORED_COUNTY_WORDS = new Set(['county', 'city']);

/**
 * A county name reduced for matching, so "Nairobi City County", "nairobi" and "Murang’a" compare as people mean them:
 * no apostrophes, accents or case; other punctuation and spacing as single spaces; the words "county" and "city" ignored.
 */
export function countyKey(name) {
  return String(name ?? '')
    .replace(APOSTROPHES, '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}]+/gu, ' ')
    .split(' ')
    .filter((word) => word !== '' && !IGNORED_COUNTY_WORDS.has(word))
    .join(' ');
}

/** Whether `county` is one of `counties`; a name with no letters left matches nothing. */
function coversCounty(counties, county) {
  const key = countyKey(county);
  return key !== '' && counties.some((name) => countyKey(name) === key);
}

/** "A", "A and B", "A, B and C". */
const joinNames = (names) => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

export function discountApplies(discount, product, categoryPath, now) {
  if (!discount.isActive || new Date(discount.startDate) > now || (discount.endDate && new Date(discount.endDate) < now)) return false;
  if (discount.isDemo && !product.isDemo) return false;
  return discount.applyTo === 'ALL' ||
    (discount.applyTo === 'CATEGORY' && discount.targetIds.some((id) => categoryPath.includes(id))) ||
    (discount.applyTo === 'SELECTED' && discount.targetIds.includes(product.id));
}

export function unitPrice(product, variant, discounts, categoryPath, policy, now = new Date()) {
  const original = decimal(variant.price ?? product.price);
  let price = original;
  let applied = null;
  for (const discount of discounts) {
    if (discount.couponCode || !discountApplies(discount, product, categoryPath, now)) continue;
    const value = decimal(discount.value);
    const reduction = discount.type === 'PERCENTAGE' ? original.mul(value).div(100) : value;
    const candidate = Decimal.max(0, original.minus(reduction))
      .div(policy.discountStep).toDecimalPlaces(0).mul(policy.discountStep);
    if (candidate.lessThan(price)) {
      price = candidate;
      applied = discount.id;
    }
  }
  const compare = !price.equals(original) ? original
    : product.compareAtPrice !== null && product.compareAtPrice !== undefined &&
      original.equals(product.price) && decimal(product.compareAtPrice).greaterThan(original)
      ? decimal(product.compareAtPrice) : null;
  return {
    price: moneyNumber(price), originalPrice: moneyNumber(original),
    comparePrice: compare === null ? null : moneyNumber(compare),
    discountPercent: original.isZero() ? 0 : moneyNumber(original.minus(price).div(original).mul(100)),
    discountId: applied,
  };
}

function allocateDiscount(amount, weights) {
  const total = sumMoney(weights);
  if (total.isZero()) return weights.map(() => decimal(0));
  const target = roundMoney(Decimal.min(amount, total));
  const shares = weights.map((weight, index) => {
    const exact = target.mul(weight).div(total);
    const floor = exact.toDecimalPlaces(2, Decimal.ROUND_DOWN);
    return { index, amount: floor, remainder: exact.minus(floor), weight };
  });
  let cents = target.minus(sumMoney(shares.map((share) => share.amount))).mul(100).toNumber();
  for (const share of [...shares].sort((a, b) => b.remainder.comparedTo(a.remainder) || a.index - b.index)) {
    if (cents > 0 && share.amount.plus('0.01').lessThanOrEqualTo(share.weight)) {
      share.amount = share.amount.plus('0.01');
      cents--;
    }
  }
  if (cents !== 0) throw new Error('Coupon allocation did not balance');
  return shares.map((share) => share.amount);
}

/**
 * The picture kept with a cart or order line: the purchased variant's first image, otherwise the
 * product cover, preferring images that are not tied to some other variant. Images arrive ordered.
 */
export function variantImage(images, variantId) {
  const general = images.filter((image) => !image.variantId);
  return images.find((image) => variantId && image.variantId === variantId)
    ?? general.find((image) => image.isMain) ?? general[0]
    ?? images.find((image) => image.isMain) ?? images[0] ?? null;
}

export function priceMerchandise(entries, discounts, couponCode, policy, now = new Date()) {
  const lines = entries.map(({ product, variant, quantity, categoryPath }) => {
    const pricing = unitPrice(product, variant, discounts, categoryPath, policy, now);
    return {
      productId: product.id, variantId: variant.id, productName: product.name,
      sku: variant.sku, attributes: variant.attributes, quantity,
      productImage: variantImage(product.images, variant.id)?.url ?? null,
      originalUnitPrice: pricing.originalPrice, unitPrice: pricing.price,
      total: decimal(pricing.price).mul(quantity), couponDiscount: decimal(0),
      discountId: pricing.discountId,
    };
  });
  let couponApplied = false;
  if (couponCode) {
    const coupon = discounts.find((discount) => discount.couponCode === couponCode);
    if (!coupon) throw pricingError('Coupon is invalid or unavailable', 'COUPON_INVALID');
    const eligible = entries.map(({ product, categoryPath }) => discountApplies(coupon, product, categoryPath, now));
    if (!eligible.some(Boolean)) throw pricingError('Coupon is expired or does not apply to these items', 'COUPON_INVALID');
    const weights = lines.map((line, index) => eligible[index] ? decimal(line.originalUnitPrice).mul(line.quantity) : decimal(0));
    const eligibleTotal = sumMoney(weights);
    const reduction = coupon.type === 'PERCENTAGE'
      ? eligibleTotal.mul(coupon.value).div(100) : decimal(coupon.value);
    const allocations = allocateDiscount(Decimal.max(0, reduction), weights);
    const candidateTotals = lines.map((line, index) => eligible[index] ? weights[index].minus(allocations[index]) : line.total);
    if (sumMoney(candidateTotals).lessThan(sumMoney(lines.map((line) => line.total)))) {
      couponApplied = true;
      lines.forEach((line, index) => {
        if (!eligible[index]) return;
        line.unitPrice = line.originalUnitPrice;
        line.total = candidateTotals[index];
        line.couponDiscount = allocations[index];
        line.discountId = coupon.id;
      });
    }
  }
  const subtotal = sumMoney(lines.map((line) => decimal(line.originalUnitPrice).mul(line.quantity)));
  const discountedSubtotal = sumMoney(lines.map((line) => line.total));
  const discount = subtotal.minus(discountedSubtotal);
  return {
    couponCode, couponApplied,
    couponMessage: couponCode && !couponApplied ? 'Existing offers provide an equal or better saving; discounts are not stacked.' : null,
    lines: lines.map((line) => ({
      ...line, total: moneyNumber(line.total), couponDiscount: moneyNumber(line.couponDiscount),
      discount: moneyNumber(decimal(line.originalUnitPrice).mul(line.quantity).minus(line.total)),
    })),
    subtotal: moneyNumber(subtotal), discount: moneyNumber(discount),
    discountedSubtotal: moneyNumber(discountedSubtotal),
  };
}

export function priceBasket(entries, discounts, couponCode, deliveryMethod, address, policy, now = new Date()) {
  const merchandise = priceMerchandise(entries, discounts, couponCode, policy, now);
  const rule = policy.delivery[deliveryMethod];
  const label = DELIVERY_METHOD_LABELS[deliveryMethod];
  if (!rule) throw pricingError(`${label} isn't offered. Choose another delivery method.`, 'DELIVERY_UNAVAILABLE');
  if (rule.counties.length && !coversCounty(rule.counties, address.county)) {
    throw pricingError(`${label} is available only in ${joinNames(rule.counties)}. Choose another delivery method or address.`, 'DELIVERY_UNAVAILABLE');
  }
  const discountedSubtotal = decimal(merchandise.discountedSubtotal);
  const tax = roundMoney(discountedSubtotal.mul(policy.vatRate).div(100));
  const shippingCost = rule.freeAbove !== null && discountedSubtotal.greaterThanOrEqualTo(rule.freeAbove) ? decimal(0) : decimal(rule.fee);
  return {
    ...merchandise, currency: policy.currency, policyVersion: policy.version, policyHash: policy.hash,
    vatRate: policy.vatRate, deliveryMethod, tax: moneyNumber(tax), shippingCost: moneyNumber(shippingCost),
    total: moneyNumber(discountedSubtotal.plus(tax).plus(shippingCost)),
  };
}
