import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, mock, test } from 'node:test';
import prisma from '../../src/config/database.js';
import { generateToken } from '../../src/config/auth.js';
import { startServer } from '../../src/server.js';
import { createPendingOrder, createQuote } from '../../src/services/checkoutService.js';
import { expireReservations, lockOrderInventory } from '../../src/services/inventoryService.js';
import { mailer } from '../../src/services/notificationService.js';
import provider from '../../src/services/mpesaService.js';
import { TEST_MPESA_ENV, callbackBody } from '../mpesa-fixtures.js';

/*
 * P8.6 §2 on a real database: a sample order paid with a demonstration payment, which takes no money. It creates no
 * M-Pesa record, calls no provider and sends no payment email; every competing payment path stays safe.
 */
const DEMONSTRATION_EVENT = 'Demonstration payment recorded; no money was taken. Awaiting fulfilment.';
let base, close, staffToken, sequence = 0, failWrite = null;
const sent = [], queried = [], responses = new Map();
prisma.$use(async (params, next) => {
  if (failWrite?.(params)) throw new Error('Synthetic storage failure');
  return next(params);
});

const demonstrationEnv = () => {
  Object.assign(process.env, TEST_MPESA_ENV);
  process.env.DEMONSTRATION_STORE = 'true';
  process.env.MPESA_ALLOW_DEMO_SANDBOX = 'false';
};

before(async () => {
  demonstrationEnv();
  process.env.ENABLE_ORDER_RESERVATIONS = 'true';
  // Sample-order emails are on, so their absence for demonstration payments is the payment path's own doing.
  process.env.DEMO_NOTIFICATIONS_ENABLED = 'true';
  mock.method(mailer, 'send', async () => ({ provider: 'test', messageId: 'test-message' }));
  mock.method(provider, 'initiate', async (config, request) => {
    const ids = { accepted: true, checkoutRequestId: `ws_DEMO_${sent.length}`, merchantRequestId: `mr_DEMO_${sent.length}` };
    sent.push({ ...request, ...ids });
    responses.set(ids.checkoutRequestId, { ...ids, resultCode: 0 });
    return ids;
  });
  mock.method(provider, 'query', async (_config, id) => {
    queried.push(id);
    return responses.get(id);
  });
  const admin = await prisma.admin.create({ data: {
    email: 'demonstration-payments@example.test', username: 'demonstration-payments', password: 'fixture-not-for-login', role: 'ADMIN',
  } });
  staffToken = generateToken({ adminId: admin.id });
  const started = await startServer({ host: '127.0.0.1', port: 0 });
  close = started.close;
  base = `http://127.0.0.1:${started.server.address().port}/api`;
});
beforeEach(() => { failWrite = null; demonstrationEnv(); });
after(async () => { failWrite = null; process.env.DEMONSTRATION_STORE = 'false'; mock.restoreAll(); await close?.(); });

async function call(path, { method = 'GET', body, token, key } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }),
      ...(key && { 'Idempotency-Key': key }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

/** A customer with one pending order for one unit of a new product (3 in stock); `demo: false` makes a live order. */
async function fixture({ price = 900, demo = true } = {}) {
  const id = ++sequence;
  const user = await prisma.user.create({ data: {
    email: `demo-payer-${id}@example.test`, password: 'fixture-not-for-login', firstName: 'Demo', lastName: 'Payer',
    addresses: { create: { street: 'Sample street', city: 'Mombasa', county: 'Mombasa' } },
  }, include: { addresses: true } });
  const other = await prisma.user.create({ data: {
    email: `demo-other-${id}@example.test`, password: 'fixture-not-for-login', firstName: 'Other', lastName: 'Payer',
  } });
  const product = await prisma.product.create({ data: {
    name: `Sample product ${id}`, slug: `sample-product-${id}`, description: 'Demonstration payment fixture',
    price, isActive: true, isDemo: demo,
    category: { create: { name: `Sample category ${id}`, slug: `sample-category-${id}` } },
    variants: { create: { sku: `SAMPLE-SKU-${id}`, stock: { create: { quantity: 3, minThreshold: 0, status: 'IN_STOCK' } } } },
  }, include: { variants: true } });
  const place = async () => {
    const quote = await createQuote(user.id, {
      items: [{ productId: product.id, variantId: product.variants[0].id, quantity: 1 }],
      addressId: user.addresses[0].id, deliveryMethod: 'STANDARD',
    });
    return (await createPendingOrder(user.id, { quoteId: quote.id }, randomUUID())).order;
  };
  const order = demo ? await place() : await switchedOff(place);
  return {
    user, product, order, variantId: product.variants[0].id,
    token: generateToken({ userId: user.id }), otherToken: generateToken({ userId: other.id }),
  };
}

/** Runs `work` with DEMONSTRATION_STORE switched off (and no development opt-in), restoring it afterwards. */
async function switchedOff(work) {
  process.env.DEMONSTRATION_STORE = 'false';
  try {
    return await work();
  } finally {
    process.env.DEMONSTRATION_STORE = 'true';
  }
}

const pay = (f, token = f.token, body = {}) => call(`/orders/${f.order.id}/demonstration-payment`, { method: 'POST', token, body });
const initiate = (f, key = randomUUID()) => call('/mpesa/stk-push', {
  method: 'POST', token: f.token, key, body: { orderId: f.order.id, phone: '0700000000' },
});
const overview = (f) => call(`/mpesa/orders/${f.order.id}/payments`, { token: f.token });
const savedOrder = (f) => prisma.order.findUnique({ where: { id: f.order.id } });
const inventory = (f) => prisma.stock.findUnique({ where: { variantId: f.variantId } });
const events = (f) => prisma.trackingEvent.findMany({ where: { orderId: f.order.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
const demonstrationEvents = async (f) => (await events(f)).filter((event) => event.actorType === 'DEMONSTRATION');
const codeOf = (result) => [result.status, result.data.code];

async function callback(request, extra = {}) {
  const path = new URL(request.callbackUrl).pathname;
  const response = await fetch(`${base.replace(/\/api$/, '')}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(callbackBody({ ...request, receiptNumber: `DEMO${String(++sequence).padStart(6, '0')}`, ...extra })),
  });
  return response.status;
}
async function query(id, token) {
  await prisma.mpesaPayment.update({ where: { id }, data: { nextReconcileAt: new Date(0) } });
  return call(`/mpesa/payments/${id}/query`, { method: 'POST', token });
}

/** Asserts the order is still unpaid on its hold, with its unit reserved and nothing recorded as a payment. */
async function assertUnpaid(f) {
  const order = await savedOrder(f);
  assert.deepEqual([order.status, order.paymentStatus, order.paymentMethod, order.reservationStatus], ['PENDING', 'PENDING', 'MPESA', 'HELD']);
  assert.deepEqual([(await inventory(f)).quantity, (await inventory(f)).reserved], [3, 1]);
  assert.deepEqual(await demonstrationEvents(f), []);
}

test('a demonstration payment settles a sample order once, with no M-Pesa record, provider call or payment email', async () => {
  const f = await fixture();
  const calls = [sent.length, queried.length];
  const before = await overview(f);
  assert.equal(before.status, 200, JSON.stringify(before.data));
  assert.equal(before.data.order.paymentMethod, 'MPESA');
  assert.deepEqual(before.data.demonstration, { available: true, reasonCode: null });

  const paid = await pay(f, f.token, { amount: 1, paymentMethod: 'MPESA', isDemo: false, actorId: 'someone-else' });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  assert.deepEqual([paid.data.id, paid.data.status, paid.data.paymentStatus, paid.data.paymentMethod, paid.data.reservationStatus],
    [f.order.id, 'PENDING', 'PAID', 'DEMONSTRATION', 'COMMITTED']);
  const order = await savedOrder(f);
  assert.deepEqual([order.paymentStatus, order.paymentMethod, order.settledPaymentId, Number(order.total)], ['PAID', 'DEMONSTRATION', null, 1244]);
  assert.deepEqual([(await inventory(f)).quantity, (await inventory(f)).reserved], [2, 0]);
  assert.equal(await prisma.stockLog.count({ where: { stockId: (await inventory(f)).id, action: 'commit' } }), 1);
  const [event] = await demonstrationEvents(f);
  assert.deepEqual([event.status, event.description, event.location, event.actorId], ['PENDING', DEMONSTRATION_EVENT, 'Demonstration', f.user.id]);
  assert.equal(await prisma.mpesaPayment.count({ where: { orderId: f.order.id } }), 0);
  assert.deepEqual([sent.length, queried.length], calls);
  assert.equal(await prisma.notification.count({ where: { orderId: f.order.id, type: 'PAYMENT_CONFIRMED' } }), 0);
  assert.equal(await prisma.notification.count({ where: { orderId: f.order.id, type: 'ORDER_RECEIVED' } }), 1);
  const own = (await call(`/orders/${f.order.id}`, { token: f.token })).data;
  const shown = own.trackingHistory.find((item) => item.actorType === 'DEMONSTRATION');
  assert.deepEqual([shown.description, shown.location, 'actorId' in shown], [DEMONSTRATION_EVENT, 'Demonstration', false]);

  // Repeating it changes nothing and says the order is paid; M-Pesa is no longer offered or sent.
  const repeat = await pay(f);
  assert.deepEqual([repeat.status, repeat.data.paymentMethod, repeat.data.paymentStatus], [200, 'DEMONSTRATION', 'PAID']);
  assert.equal((await demonstrationEvents(f)).length, 1);
  assert.equal((await savedOrder(f)).updatedAt.getTime(), order.updatedAt.getTime());
  assert.deepEqual(codeOf(await initiate(f)), [409, 'ORDER_NOT_PAYABLE']);
  assert.equal(await prisma.mpesaPayment.count({ where: { orderId: f.order.id } }), 0);
  assert.deepEqual([sent.length, queried.length], calls);
  const after = (await overview(f)).data;
  assert.deepEqual([after.order.paymentMethod, after.order.paymentStatus, after.available], ['DEMONSTRATION', 'PAID', false]);
  assert.deepEqual(after.demonstration, { available: false, reasonCode: 'ORDER_NOT_PAYABLE' });
});

test('repeating a demonstration payment after its product is retired still answers 200 and changes nothing', async () => {
  const f = await fixture();
  assert.equal((await pay(f)).status, 200);
  const paid = await savedOrder(f);
  await prisma.product.update({ where: { id: f.product.id }, data: { isActive: false, deletedAt: new Date() } });
  const repeat = await pay(f);
  assert.deepEqual([repeat.status, repeat.data.id, repeat.data.paymentStatus, repeat.data.paymentMethod], [200, f.order.id, 'PAID', 'DEMONSTRATION'],
    JSON.stringify(repeat.data));
  assert.equal((await savedOrder(f)).updatedAt.getTime(), paid.updatedAt.getTime());
  assert.equal((await demonstrationEvents(f)).length, 1);
  assert.deepEqual([(await inventory(f)).quantity, (await inventory(f)).reserved], [2, 0]);
  assert.equal(await prisma.mpesaPayment.count({ where: { orderId: f.order.id } }), 0);
});

test('demonstration payments are not found for another customer, a live order, or when sample orders are off', async () => {
  const f = await fixture();
  assert.deepEqual(codeOf(await pay(f, f.otherToken)), [404, 'ORDER_NOT_FOUND']);
  assert.equal((await pay(f, null)).status, 401);
  await switchedOff(async () => {
    assert.deepEqual(codeOf(await pay(f)), [404, 'ORDER_NOT_FOUND']);
    assert.equal((await overview(f)).data.demonstration, null);
  });
  await assertUnpaid(f);
  const live = await fixture({ demo: false });
  assert.deepEqual(codeOf(await pay(live)), [404, 'ORDER_NOT_FOUND']);
  await assertUnpaid(live);
  assert.equal((await overview(live)).data.demonstration, null);
});

test('a non-sample item, an M-Pesa payment, an open M-Pesa attempt or a cancelled order refuses the demonstration payment', async () => {
  const changed = await fixture();
  await prisma.product.update({ where: { id: changed.product.id }, data: { isDemo: false } });
  assert.deepEqual(codeOf(await pay(changed)), [409, 'ORDER_NOT_PAYABLE']);
  assert.deepEqual((await overview(changed)).data.demonstration, { available: false, reasonCode: 'ORDER_NOT_PAYABLE' });
  await assertUnpaid(changed);

  const open = await fixture();
  const attempt = await initiate(open);
  assert.equal(attempt.status, 201, JSON.stringify(attempt.data));
  assert.deepEqual(codeOf(await pay(open)), [409, 'PAYMENT_EXISTS']);
  assert.deepEqual((await overview(open)).data.demonstration, { available: false, reasonCode: 'PAYMENT_EXISTS' });
  await assertUnpaid(open);

  // Settled by M-Pesa: the demonstration payment is refused and the order keeps its M-Pesa settlement.
  assert.equal(await callback(sent.at(-1)), 200);
  assert.equal((await query(attempt.data.id, open.token)).data.status, 'SUCCEEDED');
  assert.deepEqual(codeOf(await pay(open)), [409, 'ORDER_NOT_PAYABLE']);
  const settled = await savedOrder(open);
  assert.deepEqual([settled.paymentStatus, settled.paymentMethod, settled.settledPaymentId], ['PAID', 'MPESA', attempt.data.id]);
  assert.deepEqual(await demonstrationEvents(open), []);

  const cancelled = await fixture();
  assert.equal((await call(`/orders/${cancelled.order.id}/cancel`, { method: 'POST', token: cancelled.token, body: {} })).status, 200);
  assert.deepEqual(codeOf(await pay(cancelled)), [409, 'ORDER_NOT_PAYABLE']);
  assert.deepEqual([(await inventory(cancelled)).quantity, (await inventory(cancelled)).reserved], [3, 0]);
  assert.deepEqual(await demonstrationEvents(cancelled), []);
});

test('an expired hold is expired and released inside the payment request, which is then refused', async () => {
  const f = await fixture();
  await prisma.order.update({ where: { id: f.order.id }, data: { reservationExpiresAt: new Date(Date.now() - 1000) } });
  assert.deepEqual(codeOf(await pay(f)), [409, 'ORDER_NOT_PAYABLE']);
  const order = await savedOrder(f);
  assert.deepEqual([order.status, order.reservationStatus, order.paymentStatus], ['CANCELLED', 'EXPIRED', 'PENDING']);
  assert.deepEqual([(await inventory(f)).quantity, (await inventory(f)).reserved], [3, 0]);
  const last = (await events(f)).at(-1);
  assert.deepEqual([last.status, last.actorType, last.description], ['CANCELLED', 'SYSTEM', 'Inventory reservation expired before payment']);
  assert.deepEqual(await demonstrationEvents(f), []);
});

test('M-Pesa switched off or unable to take a fractional total leaves the demonstration payment available', async () => {
  const fractional = await fixture({ price: 900.01 });
  const view = (await overview(fractional)).data;
  assert.deepEqual([view.available, view.reasonCode], [false, 'MPESA_AMOUNT_UNSUPPORTED']);
  assert.deepEqual(view.demonstration, { available: true, reasonCode: null });
  const paid = await pay(fractional);
  assert.deepEqual([paid.status, paid.data.paymentStatus, Number(paid.data.total)], [200, 'PAID', 1244.01]);

  const f = await fixture();
  process.env.ENABLE_MPESA = 'false';
  const off = (await overview(f)).data;
  assert.deepEqual([off.available, off.reasonCode, off.environment], [false, 'MPESA_DISABLED', null]);
  assert.deepEqual(off.demonstration, { available: true, reasonCode: null });
  assert.equal((await pay(f)).status, 200);
});

test('a failure after the stock write rolls the whole demonstration payment back', async () => {
  const f = await fixture();
  failWrite = (params) => params.model === 'Order' && params.action === 'update' && params.args.data?.paymentMethod === 'DEMONSTRATION';
  const failed = await pay(f);
  failWrite = null;
  assert.equal(failed.status, 500);
  await assertUnpaid(f);
  assert.equal(await prisma.stockLog.count({ where: { stockId: (await inventory(f)).id, action: 'commit' } }), 0);
  assert.equal((await pay(f)).status, 200);
  assert.deepEqual([(await inventory(f)).quantity, (await inventory(f)).reserved], [2, 0]);
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
 * Holds the order's row lock, starts each request in turn and waits until it is queued behind the lock, then releases
 * it, so the requests run in the order given (PostgreSQL grants a row lock to its waiters first come, first served).
 */
async function inLockOrder(orderId, starts) {
  let release, markLocked;
  const released = new Promise((resolve) => { release = resolve; });
  const locked = new Promise((resolve) => { markLocked = resolve; });
  const holder = prisma.$transaction(async (db) => {
    await lockOrderInventory(db, orderId);
    markLocked();
    await released;
  }, { timeout: 15_000 });
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

/** The order was settled exactly once, by the given method, with its unit committed once. */
async function assertSettledOnce(f, method) {
  const order = await savedOrder(f);
  assert.deepEqual([order.paymentStatus, order.paymentMethod, order.reservationStatus], ['PAID', method, 'COMMITTED']);
  assert.deepEqual([(await inventory(f)).quantity, (await inventory(f)).reserved], [2, 0]);
  assert.equal(await prisma.stockLog.count({ where: { stockId: (await inventory(f)).id, action: 'commit' } }), 1);
  const all = await events(f);
  assert.equal(all.filter((event) => event.actorType === 'DEMONSTRATION').length, method === 'DEMONSTRATION' ? 1 : 0);
  assert.equal(all.filter((event) => event.actorType === 'PROVIDER').length, method === 'MPESA' ? 1 : 0);
  assert.equal(order.settledPaymentId === null, method === 'DEMONSTRATION');
}

test('two demonstration payments at once settle the order once; the second is a no-op', async () => {
  const f = await fixture();
  const results = await inLockOrder(f.order.id, [() => pay(f), () => pay(f)]);
  assert.deepEqual(results.map((result) => [result.status, result.data.paymentMethod]), [[200, 'DEMONSTRATION'], [200, 'DEMONSTRATION']]);
  await assertSettledOnce(f, 'DEMONSTRATION');
});

test('a demonstration payment racing an M-Pesa prompt request: whichever is first wins, and nothing is paid twice', async () => {
  const first = await fixture();
  const calls = sent.length;
  const [paid, prompt] = await inLockOrder(first.order.id, [() => pay(first), () => initiate(first)]);
  assert.equal(paid.status, 200);
  assert.deepEqual(codeOf(prompt), [409, 'ORDER_NOT_PAYABLE']);
  assert.equal(await prisma.mpesaPayment.count({ where: { orderId: first.order.id } }), 0);
  assert.equal(sent.length, calls);
  await assertSettledOnce(first, 'DEMONSTRATION');

  const second = await fixture();
  const [requested, refused] = await inLockOrder(second.order.id, [() => initiate(second), () => pay(second)]);
  assert.equal(requested.status, 201, JSON.stringify(requested.data));
  assert.deepEqual(codeOf(refused), [409, 'PAYMENT_EXISTS']);
  await assertUnpaid(second);
  assert.equal(sent.length, calls + 1);
});

test('a demonstration payment racing an M-Pesa callback or status check never pays an order twice', async () => {
  for (const competitor of ['callback', 'query']) {
    for (const demonstrationFirst of [true, false]) {
      const f = await fixture();
      const attempt = await initiate(f);
      const request = sent.at(-1);
      if (competitor === 'query') {
        assert.equal(await callback(request), 200);
        await prisma.mpesaPayment.update({ where: { id: attempt.data.id }, data: { nextReconcileAt: new Date(0) } });
      }
      const other = competitor === 'callback'
        ? async () => ({ status: await callback(request) })
        : () => call(`/mpesa/payments/${attempt.data.id}/query`, { method: 'POST', token: f.token });
      const starts = demonstrationFirst ? [() => pay(f), other] : [other, () => pay(f)];
      const results = await inLockOrder(f.order.id, starts);
      const refused = results[demonstrationFirst ? 0 : 1];
      assert.equal(results[demonstrationFirst ? 1 : 0].status, 200, `${competitor} ${demonstrationFirst}`);
      // An open attempt refuses the demonstration payment; once M-Pesa settled the order, it is paid another way.
      assert.deepEqual(codeOf(refused), [409, competitor === 'query' && !demonstrationFirst ? 'ORDER_NOT_PAYABLE' : 'PAYMENT_EXISTS']);
      if (competitor === 'callback') assert.equal((await query(attempt.data.id, f.token)).data.status, 'SUCCEEDED');
      await assertSettledOnce(f, 'MPESA');
    }
  }
});

test('a demonstration payment racing reservation expiry or cancellation leaves one consistent outcome', async () => {
  const later = () => new Date(Date.now() + 3_600_000);
  // Expire earlier tests' held orders first: expiring them inside a race would add unrelated serializable writers,
  // and a conservative serialization failure could retry the first request behind the second.
  await expireReservations(later());
  const paidFirst = await fixture();
  const [paid] = await inLockOrder(paidFirst.order.id, [() => pay(paidFirst), () => expireReservations(later())]);
  assert.equal(paid.status, 200);
  await assertSettledOnce(paidFirst, 'DEMONSTRATION');

  const expiredFirst = await fixture();
  const [, refused] = await inLockOrder(expiredFirst.order.id, [() => expireReservations(later()), () => pay(expiredFirst)]);
  assert.deepEqual(codeOf(refused), [409, 'ORDER_NOT_PAYABLE']);
  const expired = await savedOrder(expiredFirst);
  assert.deepEqual([expired.status, expired.reservationStatus, expired.paymentStatus], ['CANCELLED', 'EXPIRED', 'PENDING']);
  assert.deepEqual([(await inventory(expiredFirst)).quantity, (await inventory(expiredFirst)).reserved], [3, 0]);

  const cancel = (f) => () => call(`/orders/${f.order.id}/cancel`, { method: 'POST', token: f.token, body: { reason: 'Changed my mind' } });
  const thenCancelled = await fixture();
  const [payment, cancellation] = await inLockOrder(thenCancelled.order.id, [() => pay(thenCancelled), cancel(thenCancelled)]);
  assert.deepEqual([payment.status, cancellation.status], [200, 200]);
  const cancelledPaid = await savedOrder(thenCancelled);
  assert.deepEqual([cancelledPaid.status, cancelledPaid.paymentStatus, cancelledPaid.paymentMethod], ['CANCELLED', 'PAID', 'DEMONSTRATION']);
  // Its unit was committed by the payment and returned to stock by the cancellation, which asks for a full refund.
  assert.deepEqual([(await inventory(thenCancelled)).quantity, (await inventory(thenCancelled)).reserved], [3, 0]);
  const refunds = await prisma.refund.findMany({ where: { orderId: thenCancelled.order.id } });
  assert.deepEqual(refunds.map((refund) => [refund.source, refund.status, Number(refund.amount), refund.paymentId, refund.method]),
    [['CANCELLATION', 'REQUESTED', 1244, null, 'DEMONSTRATION']]);

  const cancelledFirst = await fixture();
  const [, late] = await inLockOrder(cancelledFirst.order.id, [cancel(cancelledFirst), () => pay(cancelledFirst)]);
  assert.deepEqual(codeOf(late), [409, 'ORDER_NOT_PAYABLE']);
  assert.deepEqual([(await savedOrder(cancelledFirst)).status, (await inventory(cancelledFirst)).reserved], ['CANCELLED', 0]);
  assert.deepEqual(await demonstrationEvents(cancelledFirst), []);
});

test('money M-Pesa reports later for a demonstration-paid order is held for review and never settles it again', async () => {
  const f = await fixture();
  const attempt = await initiate(f);
  assert.equal(await callback(sent.at(-1)), 200);
  // An attempt that looked finished when the demonstration payment was made, then turned out to have succeeded.
  await prisma.mpesaPayment.update({ where: { id: attempt.data.id }, data: { status: 'FAILED' } });
  assert.equal((await pay(f)).status, 200);
  await prisma.mpesaPayment.update({ where: { id: attempt.data.id }, data: { status: 'PENDING' } });
  const late = await query(attempt.data.id, f.token);
  assert.deepEqual([late.data.status, late.data.reasonCode, Boolean(late.data.confirmedAt)], ['REVIEW', 'EXTRA_PAYMENT', true]);
  await assertSettledOnce(f, 'DEMONSTRATION');
  assert.equal(await prisma.notification.count({ where: { orderId: f.order.id, type: 'PAYMENT_CONFIRMED' } }), 0);
});

test('staff figures leave out a sample order paid by demonstration', async () => {
  const dashboard = async () => {
    const { data } = await call('/admin/analytics/dashboard?period=year', { token: staffToken });
    return { figures: data.figures, current: data.current, recent: data.recentOrders.map((order) => order.id) };
  };
  const f = await fixture();
  const before = await dashboard();
  assert.equal((await pay(f)).status, 200);
  assert.deepEqual(await dashboard(), before);
  assert.equal(before.recent.includes(f.order.id), false);
});
