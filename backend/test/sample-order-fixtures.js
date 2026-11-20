import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock } from 'node:test';
import prisma from '../src/config/database.js';
import { generateToken } from '../src/config/auth.js';
import { DEFAULT_CHECKOUT_POLICY } from '../src/config/checkoutPolicy.js';
import { startServer } from '../src/server.js';
import { mailer } from '../src/services/notificationService.js';

/*
 * Shared by the sample-order retention integration tests: real API calls for placing and playing sample orders, and
 * direct reads of what the deletion touches. `fixtureState.base` is the started server's API address.
 */
export const DAY_MS = 86_400_000;
export const PURGE_LOG = 'sample-order-purge';
export const fixtureState = { base: null, sequence: 0, receipts: 0 };

export async function call(path, { method = 'GET', body, token, key } = {}) {
  const response = await fetch(`${fixtureState.base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }),
      ...(key && { 'Idempotency-Key': key }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

let created = null;
/** The one category every fixture product is in, created once (concurrent upserts would race on its slug). */
const category = () => (created ??= prisma.category.create({ data: { name: 'Retention', slug: 'retention' } }));

/** A product with one variant per size, 1,000 of each in stock. */
export async function product(slug, sizes = ['One'], isDemo = true) {
  const { id } = await category();
  const created = await prisma.product.create({
    data: {
      name: slug, slug, description: 'Sample retention fixture', price: 1000, isActive: true, isDemo, category: { connect: { id } },
      variants: { create: sizes.map((size) => ({
        sku: `${slug}-${size}`.toUpperCase(), attributes: { size },
        stock: { create: { quantity: 1000, minThreshold: 0, status: 'IN_STOCK' } },
      })) },
    },
    include: { variants: true },
  });
  return Object.fromEntries(created.variants.map((variant) => [variant.attributes.size, variant]));
}

export async function createCatalog() {
  const [shirt, mug, live] = await Promise.all([product('retention-shirt', ['S', 'M']), product('retention-mug'), product('retention-live', ['One'], false)]);
  return { S: shirt.S, M: shirt.M, mug: mug.One, live: live.One };
}

export async function customer() {
  const tag = `retention-${++fixtureState.sequence}`;
  const user = await prisma.user.create({
    data: {
      email: `${tag}@example.test`, password: 'fixture-not-for-login', firstName: 'Retention', lastName: tag,
      addresses: { create: { street: `${tag} street`, city: 'Mombasa', county: 'Mombasa' } },
    },
    include: { addresses: true },
  });
  return { ...user, token: generateToken({ userId: user.id }) };
}

/** The policy from before Store pickup was turned off, under which pickup orders already placed are still fulfilled. */
const PICKUP_POLICY = JSON.stringify({ ...DEFAULT_CHECKOUT_POLICY, version: 1, delivery: {
  ...DEFAULT_CHECKOUT_POLICY.delivery, STORE_PICKUP: { fee: 200, freeAbove: null, counties: [] },
} });

/** Places a pending order for `lines` ([variant, quantity] pairs); its stock is held. */
export async function place(person, lines, { deliveryMethod = 'STANDARD' } = {}) {
  if (deliveryMethod === 'STORE_PICKUP') process.env.CHECKOUT_POLICY_JSON = PICKUP_POLICY;
  try {
    const quoted = await call('/orders/quotes', { method: 'POST', token: person.token, body: {
      items: lines.map(([variant, quantity]) => ({ productId: variant.productId, variantId: variant.id, quantity })),
      addressId: person.addresses[0].id, deliveryMethod, couponCode: null, notes: null,
    } });
    assert.equal(quoted.status, 201, JSON.stringify(quoted.data));
    const created = await call('/orders', { method: 'POST', token: person.token, key: randomUUID(), body: { quoteId: quoted.data.id } });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    return created.data;
  } finally {
    delete process.env.CHECKOUT_POLICY_JSON;
  }
}

/** Places a sample order and pays it with a demonstration payment (its stock is committed). */
export async function paidSample(person, lines, options) {
  const placed = await place(person, lines, options);
  const paid = await call(`/orders/${placed.id}/demonstration-payment`, { method: 'POST', token: person.token, body: {} });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  return paid.data;
}

export async function play(person, orderId, steps) {
  for (const [action, expectedStatus] of steps) {
    const result = await call(`/orders/${orderId}/demonstration-actions`, { method: 'POST', token: person.token, body: { action, expectedStatus } });
    assert.equal(result.status, 200, `${action}: ${JSON.stringify(result.data)}`);
  }
}
export const DELIVER = [['START_PROCESSING', 'PENDING'], ['DISPATCH', 'PROCESSING'], ['CONFIRM_DELIVERY', 'SHIPPED']];
export const COLLECT = [['START_PROCESSING', 'PENDING'], ['MARK_READY_FOR_PICKUP', 'PROCESSING'], ['CONFIRM_PICKUP', 'READY_FOR_PICKUP']];

/** Requests a return of `quantity` units of the order's first item; `receive` approves and receives it as the demonstration. */
export async function returned(person, order, quantity, { reason = 'CHANGED_MIND', receive = true } = {}) {
  const requested = await call(`/orders/${order.id}/returns`, { method: 'POST', token: person.token, key: randomUUID(), body: {
    reason, lines: [{ orderItemId: order.items[0].id, quantity }],
  } });
  assert.equal(requested.status, 201, JSON.stringify(requested.data));
  const { id } = requested.data.returnRequest;
  if (!receive) return id;
  for (const [step, expectedStatus] of [['demonstration-approve', 'REQUESTED'], ['demonstration-receive', 'APPROVED']]) {
    const result = await call(`/orders/${order.id}/returns/${id}/${step}`, { method: 'POST', token: person.token, body: { expectedStatus } });
    assert.equal(result.status, 200, `${step}: ${JSON.stringify(result.data)}`);
  }
  return id;
}

/** Moves orders' placing time back by `days` (plus `ms`) from `from`. */
export const age = (orders, days, { from = Date.now(), ms = 0 } = {}) => prisma.order.updateMany({
  where: { id: { in: orders.map((order) => order.id) } }, data: { createdAt: new Date(from - days * DAY_MS - ms) },
});
/** Makes orders young again, so a test leaves nothing due for the next one. */
export const rejuvenate = (orders) => age(orders, 0);

export const stockOf = async (variant) => {
  const { quantity, reserved } = await prisma.stock.findUnique({ where: { variantId: variant.id } });
  return { quantity, reserved };
};
export const purgeLogs = async (variant) => prisma.stockLog.findMany({
  where: { action: PURGE_LOG, stock: { variantId: variant.id } }, orderBy: { createdAt: 'asc' },
});
export const exists = async (order) => Boolean(await prisma.order.findUnique({ where: { id: order.id }, select: { id: true } }));

/** Every row the deletion removes, counted for the given orders. */
export async function orderRows(orders) {
  const orderId = { in: orders.map((order) => order.id) };
  const returns = await prisma.returnRequest.findMany({ where: { orderId }, select: { id: true } });
  const refunds = await prisma.refund.findMany({ where: { orderId }, select: { id: true } });
  const quotes = orders.map((order) => order.quoteId).filter(Boolean);
  return {
    orders: await prisma.order.count({ where: { id: orderId } }),
    items: await prisma.orderItem.count({ where: { orderId } }),
    tracking: await prisma.trackingEvent.count({ where: { orderId } }),
    returns: returns.length,
    returnLines: await prisma.returnLine.count({ where: { returnRequestId: { in: returns.map((item) => item.id) } } }),
    refunds: refunds.length,
    notifications: await prisma.notification.count({ where: { OR: [
      { orderId }, { returnRequestId: { in: returns.map((item) => item.id) } }, { refundId: { in: refunds.map((item) => item.id) } },
    ] } }),
    quotes: await prisma.checkoutQuote.count({ where: { id: { in: quotes } } }),
  };
}
export const NO_ROWS = { orders: 0, items: 0, tracking: 0, returns: 0, returnLines: 0, refunds: 0, notifications: 0, quotes: 0 };

/** Adds refunds of a demonstration payment directly, one per status (none carries money evidence). */
export async function demonstrationRefunds(order, statuses) {
  for (const status of statuses) {
    await prisma.refund.create({ data: {
      number: `RF-${order.orderNumber}-${status}`, orderId: order.id, source: 'CANCELLATION', status, amount: 1, requestedAmount: 1,
      method: 'DEMONSTRATION', requestedByType: 'CUSTOMER', ...(status === 'CONFIRMED' && { confirmedAt: new Date() }),
    } });
  }
}

/** A linked M-Pesa attempt as the payment service records one (no provider is contacted). */
export const mpesaAttempt = (order, data = {}) => {
  const id = String(++fixtureState.receipts).padStart(7, '0');
  return prisma.mpesaPayment.create({ data: {
    orderId: order.id, orderNumber: order.orderNumber, phone: '254708374149', amount: 100, environment: 'sandbox',
    idempotencyKey: randomUUID(), requestHash: 'fixture', merchantIdentity: 'fixture-merchant', merchantShortcode: '174379',
    callbackKeyHash: '0'.repeat(64), reference: `RET${id}`, status: 'FAILED', ...data,
  } });
};

/**
 * A demonstration store with reservations, sample-order emails (mail is replaced, nothing is sent) and no daily limit
 * in the way, plus a staff account, the fixture catalog and a running API. Returns them with `close`.
 */
export async function startRetentionStore() {
  process.env.ENABLE_ORDER_RESERVATIONS = 'true';
  process.env.DEMONSTRATION_STORE = 'true';
  process.env.DEMO_ORDER_DAILY_LIMIT = '1000';
  process.env.DEMO_NOTIFICATIONS_ENABLED = 'true';
  mock.method(mailer, 'send', async () => ({ provider: 'test', messageId: `test-${randomUUID()}` }));
  const admin = await prisma.admin.create({ data: {
    email: 'sample-retention@example.test', username: 'sample-retention', password: 'fixture-not-for-login', role: 'ADMIN',
  } });
  admin.token = generateToken({ adminId: admin.id });
  const catalog = await createCatalog();
  const started = await startServer({ host: '127.0.0.1', port: 0 });
  fixtureState.base = `http://127.0.0.1:${started.server.address().port}/api`;
  return { admin, catalog, close: started.close };
}

/** Before each test: the demonstration store on, the default retention period and delivery policy. */
export function resetRetentionSettings() {
  process.env.DEMONSTRATION_STORE = 'true';
  delete process.env.SAMPLE_ORDER_RETENTION_DAYS;
  delete process.env.CHECKOUT_POLICY_JSON;
}

/** After the file: the store switched off, settings restored, mocks removed and the API closed. */
export async function stopRetentionStore(close) {
  process.env.DEMONSTRATION_STORE = 'false';
  delete process.env.SAMPLE_ORDER_RETENTION_DAYS;
  delete process.env.DEMO_ORDER_DAILY_LIMIT;
  mock.restoreAll();
  await close?.();
}
