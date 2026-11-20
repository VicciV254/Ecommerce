import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, mock, test } from 'node:test';
import prisma from '../../src/config/database.js';
import { applyDemonstrationAction, cancelOrderForCustomer } from '../../src/services/fulfilmentService.js';
import { lockOrderInventory } from '../../src/services/inventoryService.js';
import { purgeSampleOrders } from '../../src/services/sampleOrderRetentionService.js';
import {
  DAY_MS, DELIVER, PURGE_LOG, age, customer, exists, mpesaAttempt, paidSample, place, play, purgeLogs, resetRetentionSettings,
  startRetentionStore, stockOf, stopRetentionStore,
} from '../sample-order-fixtures.js';

/*
 * Section A under failure and concurrency: a failure after the stock writes rolls the whole order back; a retried
 * transaction is counted once; two runs, or a run and a visitor's or customer's step on the same order, give stock back
 * exactly once; an order that gains M-Pesa evidence while the run waits is left alone; a run takes 200 orders at most.
 */
let close, catalog, inject = null;
prisma.$use(async (params, next) => {
  const failure = inject?.matches(params) ? inject.make() : null;
  if (failure) throw failure;
  return next(params);
});

before(async () => { ({ close, catalog } = await startRetentionStore()); });
beforeEach(() => { inject = null; resetRetentionSettings(); process.env.DEMO_NOTIFICATIONS_ENABLED = 'true'; });
after(() => { inject = null; return stopRetentionStore(close); });

const deletesOrder = (params) => params.model === 'Order' && params.action === 'delete';

test('a failure after the stock and log writes rolls the order back whole; the next run deletes it and counts it once', async () => {
  const person = await customer();
  const order = await paidSample(person, [[catalog.S, 2]]);
  await play(person, order.id, DELIVER);
  const before = await stockOf(catalog.S);
  const tracking = await prisma.trackingEvent.count({ where: { orderId: order.id } });
  const emails = await prisma.notification.count({ where: { orderId: order.id } });
  await age([order], 8);
  inject = { matches: deletesOrder, make: () => new Error('Synthetic storage failure with private detail') };
  const warn = mock.method(console, 'warn', () => {});
  try {
    assert.deepEqual(await purgeSampleOrders(), { deleted: 0, unchanged: 0, failed: { SAMPLE_ORDER_DELETION_FAILED: 1 } });
    assert.equal(JSON.stringify(warn.mock.calls.map((entry) => entry.arguments)).includes('private detail'), false);
  } finally {
    warn.mock.restore();
  }
  inject = null;
  assert.deepEqual(await stockOf(catalog.S), before);
  assert.equal((await purgeLogs(catalog.S)).length, 0);
  assert.ok(await exists(order));
  assert.deepEqual([await prisma.trackingEvent.count({ where: { orderId: order.id } }), await prisma.notification.count({ where: { orderId: order.id } })],
    [tracking, emails]);

  assert.deepEqual(await purgeSampleOrders(), { deleted: 1, unchanged: 0, failed: {} });
  assert.deepEqual(await stockOf(catalog.S), { quantity: before.quantity + 2, reserved: before.reserved });
  assert.equal((await purgeLogs(catalog.S)).length, 1);
});

test('a write conflict after the stock writes is retried within the run and the order is counted, and given back, once', async () => {
  const person = await customer();
  const order = await paidSample(person, [[catalog.mug, 3]]);
  const before = await stockOf(catalog.mug);
  await age([order], 8);
  let attempts = 0;
  inject = {
    matches: deletesOrder,
    make: () => (++attempts === 1 ? Object.assign(new Error('Synthetic write conflict'), { code: 'P2034' }) : null),
  };
  assert.deepEqual(await purgeSampleOrders(), { deleted: 1, unchanged: 0, failed: {} });
  assert.equal(attempts, 2);
  assert.deepEqual(await stockOf(catalog.mug), { quantity: before.quantity + 3, reserved: before.reserved });
  assert.equal((await purgeLogs(catalog.mug)).length, 1);
  assert.equal(await exists(order), false);
});

test('two runs at once delete each order once and give its stock back once', async () => {
  const person = await customer();
  const orders = [];
  for (let index = 0; index < 3; index++) orders.push(await paidSample(person, [[catalog.M, 1]]));
  for (let index = 0; index < 3; index++) orders.push(await place(person, [[catalog.M, 2]]));
  const before = await stockOf(catalog.M);
  await age(orders, 8);
  const runs = await Promise.all([purgeSampleOrders(), purgeSampleOrders()]);
  assert.equal(runs[0].deleted + runs[1].deleted, orders.length, JSON.stringify(runs));
  assert.deepEqual(runs.map((run) => run.failed), [{}, {}]);
  assert.deepEqual(await stockOf(catalog.M), { quantity: before.quantity + 3, reserved: before.reserved - 6 });
  assert.equal((await purgeLogs(catalog.M)).length, orders.length);
  for (const order of orders) assert.equal(await exists(order), false);
});

/* ------------------------------------------------------------------ */
/* Races: each competitor blocks on the order's row lock, in a known   */
/* order, before any of them runs                                      */
/* ------------------------------------------------------------------ */

const LOCK_WAIT_LIMIT_MS = 10_000;
const POLL_MS = 20;

async function blockedOnLocks() {
  const [{ count }] = await prisma.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock'`;
  return count;
}

async function untilBlocked(count) {
  const deadline = Date.now() + LOCK_WAIT_LIMIT_MS;
  while (await blockedOnLocks() < count) {
    if (Date.now() > deadline) throw new Error(`Expected ${count} requests waiting on the order lock`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/**
 * Holds the order's row lock, starts each competitor in turn and waits until it is queued behind the lock, then runs
 * `whileLocked` and releases it, so the competitors run in the order given (PostgreSQL grants a row lock to its waiters
 * first come, first served).
 */
async function inLockOrder(orderId, starts, whileLocked = async () => {}) {
  let release, markLocked;
  const released = new Promise((resolve) => { release = resolve; });
  const locked = new Promise((resolve) => { markLocked = resolve; });
  const holder = prisma.$transaction(async (db) => {
    await lockOrderInventory(db, orderId);
    markLocked();
    await released;
    await whileLocked(db);
  }, { isolationLevel: 'Serializable', timeout: 15_000 });
  await locked;
  const running = [];
  for (const start of starts) {
    const waiting = await blockedOnLocks();
    running.push(start());
    await untilBlocked(waiting + 1);
  }
  release();
  await holder;
  return Promise.all(running);
}

/** The settled error code of a competitor that lost, or null when it went through. */
const outcome = (promise) => promise.then(() => null, (error) => error.code ?? error.message);
/** Stock-log actions written for `variant` since `since` entries, in order. */
const actionsSince = async (variant, since) => (await prisma.stockLog.findMany({
  where: { stock: { variantId: variant.id } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip: since,
})).map((log) => [log.action, log.newStock - log.previousStock]);
const logCount = (variant) => prisma.stockLog.count({ where: { stock: { variantId: variant.id } } });

/*
 * The competitors are the services' own transactions (the HTTP answer re-reads the order after commit, which a run that
 * deleted it in between turns into a 404 of its own). Sample-order emails are off here: their delivery right after the
 * competitor's commit writes the rows the run deletes, which can make the run leave the order for the next run
 * (ORDER_RETRY), a different race from the one tested.
 */
test('a run waiting behind a demonstration step deletes the order as the step left it; a step waiting behind a run finds none', async () => {
  process.env.DEMO_NOTIFICATIONS_ENABLED = 'false';
  const person = await customer();
  const stepFirst = await paidSample(person, [[catalog.S, 2]]);
  await play(person, stepFirst.id, DELIVER.slice(0, 2));
  const runFirst = await paidSample(person, [[catalog.S, 1]]);
  const before = await stockOf(catalog.S);
  const logs = await logCount(catalog.S);
  await age([stepFirst], 8);
  const [step, run] = await inLockOrder(stepFirst.id, [
    () => applyDemonstrationAction(person.id, stepFirst.id, { action: 'CONFIRM_DELIVERY', expectedStatus: 'SHIPPED' }),
    () => purgeSampleOrders(),
  ]);
  assert.equal(step.order.status, 'DELIVERED');
  assert.deepEqual(run, { deleted: 1, unchanged: 0, failed: {} });
  assert.deepEqual(await stockOf(catalog.S), { quantity: before.quantity + 2, reserved: before.reserved });

  await age([runFirst], 8);
  const [first, late] = await inLockOrder(runFirst.id, [
    () => purgeSampleOrders(),
    () => outcome(applyDemonstrationAction(person.id, runFirst.id, { action: 'START_PROCESSING', expectedStatus: 'PENDING' })),
  ]);
  assert.deepEqual(first, { deleted: 1, unchanged: 0, failed: {} });
  assert.equal(late, 'ORDER_NOT_FOUND');
  assert.deepEqual(await stockOf(catalog.S), { quantity: before.quantity + 3, reserved: before.reserved });
  assert.deepEqual(await actionsSince(catalog.S, logs), [[PURGE_LOG, 2], [PURGE_LOG, 1]]);
  assert.equal(await exists(runFirst), false);
});

test('a cancellation and a run on the same order give its stock back once, whichever goes first', async () => {
  process.env.DEMO_NOTIFICATIONS_ENABLED = 'false';
  const person = await customer();
  const cancelFirst = await paidSample(person, [[catalog.mug, 2]]);
  const runFirst = await paidSample(person, [[catalog.mug, 1]]);
  const before = await stockOf(catalog.mug);
  const logs = await logCount(catalog.mug);
  await age([cancelFirst], 8);
  const [cancelled, run] = await inLockOrder(cancelFirst.id, [
    () => cancelOrderForCustomer(person.id, cancelFirst.id, 'Race'),
    () => purgeSampleOrders(),
  ]);
  assert.deepEqual([cancelled.order.status, cancelled.order.reservationStatus], ['CANCELLED', 'RELEASED']);
  assert.deepEqual(run, { deleted: 1, unchanged: 0, failed: {} });
  assert.deepEqual(await stockOf(catalog.mug), { quantity: before.quantity + 2, reserved: before.reserved });
  assert.equal(await prisma.refund.count({ where: { orderId: cancelFirst.id } }), 0);

  await age([runFirst], 8);
  const [first, late] = await inLockOrder(runFirst.id, [
    () => purgeSampleOrders(),
    () => outcome(cancelOrderForCustomer(person.id, runFirst.id, 'Race')),
  ]);
  assert.deepEqual(first, { deleted: 1, unchanged: 0, failed: {} });
  assert.equal(late, 'ORDER_NOT_FOUND');
  assert.deepEqual(await stockOf(catalog.mug), { quantity: before.quantity + 3, reserved: before.reserved });
  // The cancellation gave the first order's units back; the run gave back only the second's.
  assert.deepEqual(await actionsSince(catalog.mug, logs), [['order-cancel', 2], [PURGE_LOG, 1]]);
});

test('an order that gains an M-Pesa attempt while the run waits for it is left alone', async () => {
  const person = await customer();
  const order = await place(person, [[catalog.mug, 1]]);
  const before = await stockOf(catalog.mug);
  const logs = (await purgeLogs(catalog.mug)).length;
  await age([order], 8);
  // As payment initiation records an attempt: under the order's lock, after reading the order and its attempts.
  const [run] = await inLockOrder(order.id, [() => purgeSampleOrders()], async (db) => {
    await db.order.findUnique({ where: { id: order.id } });
    await db.mpesaPayment.findMany({ where: { orderId: order.id } });
    await db.mpesaPayment.create({ data: {
      orderId: order.id, orderNumber: order.orderNumber, phone: '254708374149', amount: 100, environment: 'sandbox',
      idempotencyKey: randomUUID(), requestHash: 'fixture', merchantIdentity: 'fixture-merchant', merchantShortcode: '174379',
      callbackKeyHash: '0'.repeat(64), reference: 'RACE000001', status: 'INITIATING',
    } });
  });
  assert.deepEqual(run, { deleted: 0, unchanged: 1, failed: {} });
  assert.ok(await exists(order));
  assert.deepEqual(await stockOf(catalog.mug), before);
  assert.equal((await purgeLogs(catalog.mug)).length, logs);
});

test('a run deletes at most 200 orders, oldest first; the next run takes the rest', async () => {
  const person = await customer();
  const placedFrom = Date.now() - 30 * DAY_MS;
  await prisma.order.createMany({ data: Array.from({ length: 201 }, (_, index) => ({
    orderNumber: `BULK-${String(index).padStart(3, '0')}`, userId: person.id, addressId: person.addresses[0].id,
    subtotal: 100, tax: 16, shippingCost: 0, total: 116, paymentMethod: 'MPESA', paymentStatus: 'PENDING', isDemo: true,
    status: 'CANCELLED', reservationStatus: 'EXPIRED', createdAt: new Date(placedFrom + index * 1000),
  })) });
  // Kept orders older than all of them do not use up the batch.
  const kept = await place(person, [[catalog.mug, 1]]);
  await mpesaAttempt(kept, { status: 'FAILED' });
  await age([kept], 40);
  assert.deepEqual(await purgeSampleOrders(), { deleted: 200, unchanged: 0, failed: {} });
  const left = await prisma.order.findMany({ where: { orderNumber: { startsWith: 'BULK-' } }, select: { orderNumber: true } });
  assert.deepEqual(left.map((order) => order.orderNumber), ['BULK-200']);
  assert.deepEqual(await purgeSampleOrders(), { deleted: 1, unchanged: 0, failed: {} });
  assert.ok(await exists(kept));
});
