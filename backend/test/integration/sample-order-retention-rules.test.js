import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, mock, test } from 'node:test';
import prisma from '../../src/config/database.js';
import { purgeSampleOrders } from '../../src/services/sampleOrderRetentionService.js';
import {
  DAY_MS, DELIVER, age, customer, exists, mpesaAttempt, paidSample, place, play, product, purgeLogs, rejuvenate,
  resetRetentionSettings, returned, startRetentionStore, stockOf, stopRetentionStore
} from '../sample-order-fixtures.js';

/*
 * Section A: what is kept (younger than the period, any M-Pesa attempt or money evidence, non-sample orders) and what
 * is refused for review (inconsistent allocations), by code and without clamping. Each test leaves no order due.
 */
let close, catalog;

before(async () => { ({ close, catalog } = await startRetentionStore()); });
beforeEach(resetRetentionSettings);
after(() => stopRetentionStore(close));

test('orders younger than the period, with any M-Pesa attempt or money evidence, and non-sample orders are kept', async () => {
  const person = await customer();
  const { S, live } = catalog;
  const now = new Date();
  const atCutoff = await paidSample(person, [[S, 1]]);
  const justOlder = await paidSample(person, [[S, 1]]);
  await age([atCutoff], 7, { from: now.getTime() });
  await age([justOlder], 7, { from: now.getTime(), ms: 1 });

  const failedAttempt = await place(person, [[S, 1]]);
  await mpesaAttempt(failedAttempt, { status: 'FAILED' });
  const inReview = await place(person, [[S, 1]]);
  await mpesaAttempt(inReview, { status: 'REVIEW', reviewCode: 'AMOUNT_MISMATCH' });
  // An attempt linked by id alone (its order number is optional) is evidence too.
  const linkedById = await place(person, [[S, 1]]);
  await mpesaAttempt(linkedById, { orderNumber: null });
  // Payments recorded before attempts were linked by id name the order by number only.
  const legacy = await place(person, [[S, 1]]);
  await prisma.mpesaPayment.create({ data: { orderNumber: legacy.orderNumber, phone: '254708374149', amount: 100, status: 'FAILED' } });
  const settled = await paidSample(person, [[S, 1]]);
  await prisma.order.update({ where: { id: settled.id }, data: { settledPaymentId: 'payment-recorded-elsewhere' } });
  const other = await place(person, [[S, 1]]);
  const otherPayment = await mpesaAttempt(other, { status: 'SUCCEEDED', confirmedAt: new Date(), receiptNumber: 'RETOTHER01' });
  const refundEvidence = {
    paymentId: { paymentId: otherPayment.id },
    providerReference: { providerReference: 'RETREF0001', status: 'CONFIRMED', confirmedAt: new Date() },
    mpesaMethod: { method: 'MPESA_MANUAL' },
    paymentReview: { source: 'PAYMENT_REVIEW' },
  };
  const withRefund = {};
  for (const [name, data] of Object.entries(refundEvidence)) {
    withRefund[name] = await paidSample(person, [[S, 1]]);
    await prisma.refund.create({ data: {
      number: `RF-${withRefund[name].orderNumber}-1`, orderId: withRefund[name].id, source: 'CANCELLATION', amount: 1, requestedAmount: 1,
      method: 'DEMONSTRATION', requestedByType: 'STAFF', ...data,
    } });
  }
  // A settled payment status by any method but the demonstration's (here M-Pesa with no attempt row) is money evidence.
  const settledByMpesa = [];
  for (const paymentStatus of ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']) {
    const order = await paidSample(person, [[S, 1]]);
    await prisma.order.update({ where: { id: order.id }, data: { paymentMethod: 'MPESA', paymentStatus } });
    settledByMpesa.push(order);
  }
  process.env.DEMONSTRATION_STORE = 'false';
  const liveOrder = await place(person, [[live, 1]]);
  process.env.DEMONSTRATION_STORE = 'true';

  const kept = [failedAttempt, inReview, linkedById, legacy, settled, other, ...Object.values(withRefund), ...settledByMpesa, liveOrder];
  await age(kept, 30, { from: now.getTime() });
  const before = await stockOf(S);
  assert.deepEqual(await purgeSampleOrders({ now }), { deleted: 1, unchanged: 0, failed: {} });
  assert.equal(await exists(justOlder), false);
  for (const order of [atCutoff, ...kept]) assert.ok(await exists(order), order.orderNumber);
  assert.deepEqual(await stockOf(S), { quantity: before.quantity + 1, reserved: before.reserved });
  assert.equal(await prisma.mpesaPayment.count({ where: { OR: [{ orderId: { in: kept.map((order) => order.id) } }, { orderNumber: legacy.orderNumber }] } }), 5);
  await rejuvenate([atCutoff]);
});

test('an inconsistent allocation is skipped for review by code, never clamped, and the other orders are still deleted', async () => {
  const person = await customer();
  const [missing, ceiling, short, over, held] = await Promise.all(['missing', 'ceiling', 'short', 'over', 'held'].map((name) => product(`retention-review-${name}`)));
  const noVariant = await paidSample(person, [[missing.One, 1]]);
  await prisma.orderItem.updateMany({ where: { orderId: noVariant.id }, data: { variantId: null } });
  const aboveCeiling = await paidSample(person, [[ceiling.One, 2]]);
  await prisma.stock.update({ where: { variantId: ceiling.One.id }, data: { quantity: 999_999 } });
  const reservedBelow = await place(person, [[short.One, 3]]);
  await prisma.stock.update({ where: { variantId: short.One.id }, data: { reserved: 1 } });
  // R > Q: a second received return restocking the only unit again (written directly; the service never allows it).
  const overReturned = await paidSample(person, [[over.One, 1]]);
  await play(person, overReturned.id, DELIVER);
  await returned(person, overReturned, 1);
  await prisma.returnRequest.create({ data: {
    number: `RMA-${overReturned.orderNumber}-X`, orderId: overReturned.id, userId: person.id, status: 'RECEIVED', reason: 'CHANGED_MIND',
    idempotencyKey: randomUUID(), requestHash: 'fixture', receivedAt: new Date(),
    lines: { create: { orderItemId: overReturned.items[0].id, quantity: 1, returnRule: 'STANDARD', receivedQuantity: 1, restockQuantity: 1, refundableQuantity: 0 } },
  } });
  // Paid by the demonstration yet still holding a reservation: neither a hold to release nor stock to give back.
  const paidButHeld = await place(person, [[held.One, 1]]);
  await prisma.order.update({ where: { id: paidButHeld.id }, data: { paymentMethod: 'DEMONSTRATION', paymentStatus: 'PAID' } });
  const healthy = await paidSample(person, [[catalog.mug, 1]]);

  const variants = [missing.One, ceiling.One, short.One, over.One, held.One];
  const before = await Promise.all(variants.map(stockOf));
  const failing = [noVariant, aboveCeiling, reservedBelow, overReturned, paidButHeld];
  await age([...failing, healthy], 8);
  const warn = mock.method(console, 'warn', () => {});
  try {
    assert.deepEqual(await purgeSampleOrders(), { deleted: 1, unchanged: 0, failed: { INVENTORY_REVIEW: 5 } });
    // The log names the order and the code only.
    assert.deepEqual(warn.mock.calls.map((entry) => Object.keys(entry.arguments[1]).sort()), Array(5).fill(['code', 'orderId']));
  } finally {
    warn.mock.restore();
  }
  assert.deepEqual(await Promise.all(variants.map(stockOf)), before);
  for (const variant of variants) assert.equal((await purgeLogs(variant)).length, 0);
  for (const order of failing) assert.ok(await exists(order), order.orderNumber);
  assert.equal(await exists(healthy), false);
  await rejuvenate(failing);
});

test('orders refused for review on every run never hold back younger ones: a run scans past them, up to its limit', async () => {
  const person = await customer();
  // Paid by the demonstration yet holding a reservation: refused for review every time (as in the test above).
  const placedFrom = Date.now() - 40 * DAY_MS;
  await prisma.order.createMany({ data: Array.from({ length: 200 }, (_, index) => ({
    orderNumber: `STUCK-${String(index).padStart(3, '0')}`, userId: person.id, addressId: person.addresses[0].id,
    subtotal: 100, tax: 16, shippingCost: 0, total: 116, paymentMethod: 'DEMONSTRATION', paymentStatus: 'PAID', isDemo: true,
    status: 'PENDING', reservationStatus: 'HELD', createdAt: new Date(placedFrom + index * 1000),
  })) });
  const stuck = await prisma.order.findMany({ where: { orderNumber: { startsWith: 'STUCK-' } }, select: { id: true } });
  const younger = await paidSample(person, [[catalog.mug, 1]]);
  await age([younger], 8);
  const warn = mock.method(console, 'warn', () => {});
  try {
    assert.deepEqual(await purgeSampleOrders(), { deleted: 1, unchanged: 0, failed: { INVENTORY_REVIEW: 200 } });
    assert.equal(await exists(younger), false);
    // The scan stops at its limit, so a long backlog of refused orders bounds a run's work.
    const next = await paidSample(person, [[catalog.mug, 1]]);
    await age([next], 8);
    assert.deepEqual(await purgeSampleOrders({ scanLimit: 150 }), { deleted: 0, unchanged: 0, failed: { INVENTORY_REVIEW: 150 } });
    assert.ok(await exists(next));
    await rejuvenate([next]);
  } finally {
    warn.mock.restore();
  }
  await rejuvenate(stuck);
});
