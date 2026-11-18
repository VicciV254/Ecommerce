import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { checkoutPolicy, DEFAULT_CHECKOUT_POLICY, offeredDelivery, reservationsEnabled } from '../../src/config/checkoutPolicy.js';
import { decimal, isMoneyInput, moneyJsonReplacer, moneyNumber } from '../../src/utils/money.js';
import { countyKey, priceBasket, unitPrice } from '../../src/services/pricingService.js';

const now = new Date('2026-10-31T12:00:00Z');
const address = { county: 'Mombasa' };
const product = { id: 'product', price: 1000, compareAtPrice: null, isDemo: false, name: 'Product', images: [] };
const variant = { id: 'variant', price: 1000, sku: 'SKU-ONE', attributes: {} };
const entry = { product, variant, quantity: 1, categoryPath: ['root', 'leaf'] };
const offer = {
  id: 'offer', name: 'Ten percent', type: 'PERCENTAGE', value: 10, applyTo: 'ALL', targetIds: [],
  isDemo: false, isActive: true, couponCode: null, startDate: new Date('2026-01-01'), endDate: null,
};
const policy = checkoutPolicy({});
const quote = (entries = [entry], discounts = [offer], coupon = null, rules = policy) =>
  priceBasket(entries, discounts, coupon, 'STANDARD', address, rules, now);

test('decimal arithmetic and JSON preserve bounded cents without floating-point calculations', () => {
  assert.equal(moneyNumber(decimal('0.1').plus('0.2')), 0.3);
  assert.equal(moneyNumber('999999999999.99'), 999999999999.99);
  assert.throws(() => moneyNumber('1000000000000'), /supported monetary range/);
  assert.equal(isMoneyInput(12.34), true);
  assert.equal(isMoneyInput(12.345), false);
  assert.deepEqual(JSON.parse(JSON.stringify({
    total: new Prisma.Decimal('1244.16'), date: now, nested: [new Prisma.Decimal('0.01')],
  }, moneyJsonReplacer)), { total: 1244.16, date: now.toISOString(), nested: [0.01] });
});

test('one discount produces KES 900 and 16% VAT is calculated on the discounted merchandise', () => {
  const price = unitPrice(product, variant, [offer], entry.categoryPath, policy, now);
  assert.equal(price.price, 900);
  assert.equal(price.originalPrice, 1000);
  assert.equal(price.discountPercent, 10);
  const priced = quote();
  assert.deepEqual([priced.subtotal, priced.discount, priced.discountedSubtotal, priced.tax, priced.shippingCost, priced.total], [1000, 100, 900, 144, 200, 1244]);
  assert.equal(priced.lines[0].unitPrice, 900);
  assert.equal(priced.lines[0].total, 900);
});

test('catalog offers are not compounded and fixed offers cannot create negative prices', () => {
  assert.equal(quote([entry], [offer, { ...offer, id: 'other', value: 5 }]).discountedSubtotal, 900);
  assert.equal(quote([entry], [{ ...offer, type: 'FIXED', value: 250 }]).discountedSubtotal, 750);
  assert.equal(quote([entry], [{ ...offer, type: 'FIXED', value: 2000 }]).discountedSubtotal, 0);
  assert.equal(quote([entry], [{ ...offer, isDemo: true }]).discount, 0);
  assert.equal(quote([entry], [{ ...offer, applyTo: 'CATEGORY', targetIds: ['root'] }]).discount, 100);
  assert.equal(quote([entry], [{ ...offer, endDate: new Date('2026-10-30') }]).discount, 0);
});

test('a coupon replaces offers only when its complete eligible basket saves more', () => {
  const coupon = { ...offer, id: 'coupon', value: 20, couponCode: 'SAVE20' };
  const better = quote([entry], [offer, coupon], 'SAVE20');
  assert.equal(better.couponApplied, true);
  assert.equal(better.discountedSubtotal, 800);
  assert.equal(better.tax, 128);
  assert.equal(better.total, 1128);
  const worse = quote([entry], [offer, { ...coupon, value: 5 }], 'SAVE20');
  assert.equal(worse.couponApplied, false);
  assert.equal(worse.discountedSubtotal, 900);
  assert.match(worse.couponMessage, /not stacked/);
  const fixed = quote([{ ...entry, quantity: 3 }], [offer, { ...coupon, type: 'FIXED', value: 500 }], 'SAVE20');
  assert.equal(fixed.discount, 500);
  assert.equal(fixed.discountedSubtotal, 2500);
  assert.equal(fixed.lines[0].couponDiscount, 500);
});

test('fixed coupon allocation balances the final cent and only affects eligible lines', () => {
  const penny = { ...offer, id: 'penny', type: 'FIXED', value: 0.01, couponCode: 'PENNY' };
  const entries = [1, 2, 3].map((id) => ({
    ...entry, product: { ...product, id: `p${id}`, price: 0.01 },
    variant: { ...variant, id: `v${id}`, price: 0.01 },
  }));
  const result = quote(entries, [penny], 'PENNY');
  assert.deepEqual(result.lines.map((line) => line.couponDiscount), [0.01, 0, 0]);
  assert.equal(result.discount, 0.01);
  assert.equal(result.discountedSubtotal, 0.02);
  assert.throws(() => quote([entry], [{ ...penny, applyTo: 'SELECTED', targetIds: ['other'] }], 'PENNY'), /does not apply/);
  assert.throws(() => quote([entry], [penny], 'MISSING'), /invalid/);
});

test('delivery thresholds use discounted merchandise and unsupported counties fail explicitly', () => {
  const free = checkoutPolicy({ CHECKOUT_POLICY_JSON: JSON.stringify({
    ...DEFAULT_CHECKOUT_POLICY,
    delivery: { ...DEFAULT_CHECKOUT_POLICY.delivery, STANDARD: { fee: 200, freeAbove: 900, counties: ['mombasa'] } },
  }) });
  assert.equal(quote([entry], [offer], null, free).shippingCost, 0);
  assert.equal(quote([{ ...entry, variant: { ...variant, price: 999 } }], [], null, free).shippingCost, 0);
  assert.equal(quote([{ ...entry, variant: { ...variant, price: 899.99 } }], [], null, free).shippingCost, 200);
  assert.throws(() => priceBasket([entry], [], null, 'STANDARD', { county: 'Nairobi' }, free, now),
    { code: 'DELIVERY_UNAVAILABLE', message: 'Standard delivery is available only in mombasa. Choose another delivery method or address.' });
  assert.notEqual(free.hash, policy.hash);
});

/** A policy offering exactly `delivery`. */
const offering = (delivery, version = DEFAULT_CHECKOUT_POLICY.version) =>
  checkoutPolicy({ CHECKOUT_POLICY_JSON: JSON.stringify({ ...DEFAULT_CHECKOUT_POLICY, version, delivery }) });
const LEGACY_DELIVERY = {
  STORE_PICKUP: { fee: 200, freeAbove: null, counties: [] },
  STANDARD: { fee: 200, freeAbove: null, counties: [] },
  SAME_DAY: { fee: 500, freeAbove: null, counties: [] },
};

test('county names match however people write them, and only the same county matches', () => {
  const written = {
    Nairobi: ['Nairobi', 'nairobi', ' Nairobi County ', 'Nairobi City County', 'NAIROBI CITY', 'Nairobi-County'],
    "Murang'a": ['Muranga', 'Murang’a County', 'Murang‘a', 'Murangʼa', 'Murang´a'],
    'Tharaka-Nithi': ['Tharaka Nithi'],
    'Elgeyo-Marakwet': ['Elgeyo Marakwet County'],
  };
  for (const [configured, names] of Object.entries(written)) {
    for (const name of names) {
      assert.equal(countyKey(name), countyKey(configured), `${JSON.stringify(name)} ~ ${configured}`);
      // Both directions: the address as configured, or the configuration as people write it.
      for (const [counties, county] of [[[configured], name], [[name], configured]]) {
        assert.equal(priceBasket([entry], [], null, 'SAME_DAY', { county }, offering({ SAME_DAY: { fee: 500, freeAbove: null, counties } }), now).shippingCost, 500);
      }
    }
  }
  assert.equal(countyKey("Murang'a"), 'muranga');
  for (const name of ['Nairobi West', 'Kiambu', 'Nai robi', '', '  ', 'County']) {
    assert.notEqual(countyKey(name), countyKey('Nairobi'), JSON.stringify(name));
    assert.throws(() => priceBasket([entry], [], null, 'SAME_DAY', { county: name }, policy, now), { code: 'DELIVERY_UNAVAILABLE' }, JSON.stringify(name));
  }
  // A name with no letters left never matches, even a configured name that also has none.
  assert.throws(() => priceBasket([entry], [], null, 'SAME_DAY', { county: 'City' }, offering({ SAME_DAY: { fee: 500, freeAbove: null, counties: ['County'] } }), now),
    { code: 'DELIVERY_UNAVAILABLE' });
});

test('refusals name the method, and the counties it covers joined naturally', () => {
  assert.throws(() => priceBasket([entry], [], null, 'STORE_PICKUP', address, policy, now),
    { code: 'DELIVERY_UNAVAILABLE', statusCode: 400, message: "Store pickup isn't offered. Choose another delivery method." });
  assert.throws(() => priceBasket([entry], [], null, 'SAME_DAY', address, policy, now),
    { code: 'DELIVERY_UNAVAILABLE', message: 'Same-day delivery is available only in Nairobi. Choose another delivery method or address.' });
  const covering = (counties) => offering({ SAME_DAY: { fee: 500, freeAbove: null, counties } });
  assert.throws(() => priceBasket([entry], [], null, 'SAME_DAY', address, covering(['Nairobi', 'Kiambu']), now),
    { message: 'Same-day delivery is available only in Nairobi and Kiambu. Choose another delivery method or address.' });
  assert.throws(() => priceBasket([entry], [], null, 'SAME_DAY', address, covering(['Nairobi', 'Kiambu', 'Machakos']), now),
    { message: 'Same-day delivery is available only in Nairobi, Kiambu and Machakos. Choose another delivery method or address.' });
});

test('the default policy offers Standard anywhere and Same-day in Nairobi; methods are optional but one is required', () => {
  assert.equal(DEFAULT_CHECKOUT_POLICY.version, 2);
  assert.deepEqual(policy.delivery, {
    STANDARD: { fee: 200, freeAbove: null, counties: [] },
    SAME_DAY: { fee: 500, freeAbove: null, counties: ['Nairobi'] },
  });
  assert.equal('STORE_PICKUP' in policy.delivery, false);
  assert.deepEqual(offeredDelivery(policy).map((option) => option.method), ['STANDARD', 'SAME_DAY']);
  // A configuration that still lists all three methods stays valid and offers them, in the shoppers' order.
  const legacy = offering(LEGACY_DELIVERY, 1);
  assert.deepEqual(offeredDelivery(legacy), [
    { method: 'STANDARD', fee: 200, freeAbove: null, counties: [] },
    { method: 'SAME_DAY', fee: 500, freeAbove: null, counties: [] },
    { method: 'STORE_PICKUP', fee: 200, freeAbove: null, counties: [] },
  ]);
  assert.equal(priceBasket([entry], [], null, 'STORE_PICKUP', address, legacy, now).shippingCost, 200);
  assert.deepEqual(Object.keys(offering({ SAME_DAY: LEGACY_DELIVERY.SAME_DAY }).delivery), ['SAME_DAY']);
  for (const delivery of [{}, { COURIER: LEGACY_DELIVERY.STANDARD }, { STANDARD: null }]) {
    assert.throws(() => offering(delivery), { statusCode: 503, message: 'Checkout pricing policy configuration is invalid' }, JSON.stringify(delivery));
  }
});

test('tax rounds once to cents and invalid policies or oversized orders are rejected', () => {
  const result = quote([{ ...entry, product: { ...product, price: 0.04 }, variant: { ...variant, price: 0.04 } }], []);
  assert.equal(result.tax, 0.01);
  assert.equal(result.total, 200.05);
  assert.throws(() => checkoutPolicy({ CHECKOUT_POLICY_JSON: '{' }), /valid JSON/);
  assert.throws(() => checkoutPolicy({ CHECKOUT_POLICY_JSON: JSON.stringify({ ...DEFAULT_CHECKOUT_POLICY, vatRate: 0 }) }));
  assert.throws(() => quote([{ ...entry, quantity: 1_000_000, variant: { ...variant, price: 1_000_000_000 } }], []), /supported monetary range/);
});

test('a malformed order-enablement flag is reported as configuration failure', (t) => {
  const previous = process.env.ENABLE_ORDER_RESERVATIONS;
  t.after(() => {
    if (previous === undefined) delete process.env.ENABLE_ORDER_RESERVATIONS;
    else process.env.ENABLE_ORDER_RESERVATIONS = previous;
  });
  process.env.ENABLE_ORDER_RESERVATIONS = 'yes';
  assert.throws(reservationsEnabled, /must be true or false/);
  process.env.ENABLE_ORDER_RESERVATIONS = 'false';
  assert.equal(reservationsEnabled(), false);
});
