import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, mock, test } from 'node:test';
import prisma from '../../src/config/database.js';
import { generateToken } from '../../src/config/auth.js';
import { startServer } from '../../src/server.js';
import { createPendingOrder, createQuote } from '../../src/services/checkoutService.js';
import { cancelOrderReservation, expireReservations } from '../../src/services/inventoryService.js';
import { reconcileDuePayments } from '../../src/services/paymentService.js';
import provider, { DarajaError } from '../../src/services/mpesaService.js';
import autoStageService from '../../src/services/autoStageService.js';
import { TEST_MPESA_ENV, callbackBody } from '../mpesa-fixtures.js';

let base, close, staffToken, viewerToken, sequence = 0;
let initiateHook = null, queryHook = null, failWrite = null;
const sent = [], queried = [], responses = new Map();
prisma.$use(async (params, next) => {
  if (failWrite?.(params)) throw new Error('Synthetic private storage failure');
  return next(params);
});

before(async () => {
  Object.assign(process.env, TEST_MPESA_ENV);
  process.env.ALLOW_DEMO_CATALOG = 'true';
  process.env.ALLOW_DEMO_ORDERS = 'true';
  process.env.ENABLE_ORDER_RESERVATIONS = 'true';
  for (const role of ['ADMIN', 'VIEWER']) {
    const staff = await prisma.admin.create({ data: {
      email: `${role.toLowerCase()}-payments@example.test`, username: `payment-${role}`, password: 'fixture-not-for-login', role,
    } });
    if (role === 'ADMIN') staffToken = generateToken({ adminId: staff.id });
    else viewerToken = generateToken({ adminId: staff.id });
  }
  mock.method(provider, 'initiate', async (config, request) => {
    const ids = { accepted: true, checkoutRequestId: `ws_TEST_${sent.length}`, merchantRequestId: `mr_TEST_${sent.length}` };
    sent.push({ ...request, ...ids, environment: config.environment });
    responses.set(ids.checkoutRequestId, { ...ids, resultCode: 0 });
    return initiateHook ? initiateHook(config, request, ids) : ids;
  });
  mock.method(provider, 'query', async (config, id) => {
    queried.push(id);
    return queryHook ? queryHook(config, id) : responses.get(id);
  });
  const started = await startServer({ host: '127.0.0.1', port: 0 });
  close = started.close;
  base = `http://127.0.0.1:${started.server.address().port}`;
});

beforeEach(() => {
  initiateHook = null; queryHook = null; failWrite = null;
  Object.assign(process.env, TEST_MPESA_ENV);
});
after(async () => { failWrite = null; mock.restoreAll(); await close?.(); });

async function call(path, { method = 'GET', body, token, key } = {}) {
  const response = await fetch(`${base}/api${path}`, {
    method, headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(key && { 'Idempotency-Key': key }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

async function fixture({ price = 900, demo = true } = {}) {
  const id = ++sequence;
  const user = await prisma.user.create({ data: {
    email: `payer-${id}@example.test`, password: 'fixture-not-for-login', firstName: 'Payment', lastName: 'Tester',
    addresses: { create: { street: 'Synthetic street', city: 'Mombasa', county: 'Mombasa' } },
  }, include: { addresses: true } });
  const other = await prisma.user.create({ data: {
    email: `other-payer-${id}@example.test`, password: 'fixture-not-for-login', firstName: 'Other', lastName: 'Tester',
  } });
  const product = await prisma.product.create({ data: {
    name: `Payment product ${id}`, slug: `payment-product-${id}`, description: 'Synthetic payment fixture',
    price, isActive: true, isDemo: demo,
    category: { create: { name: `Payment category ${id}`, slug: `payment-category-${id}` } },
    variants: { create: { sku: `PAYMENT-SKU-${id}`, stock: { create: { quantity: 3, minThreshold: 0, status: 'IN_STOCK' } } } },
  }, include: { variants: true } });
  const quote = await createQuote(user.id, {
    items: [{ productId: product.id, variantId: product.variants[0].id, quantity: 1 }],
    addressId: user.addresses[0].id, deliveryMethod: 'STANDARD',
  });
  const result = await createPendingOrder(user.id, { quoteId: quote.id }, randomUUID());
  return {
    user, other, product, order: result.order, variantId: product.variants[0].id,
    token: generateToken({ userId: user.id }), otherToken: generateToken({ userId: other.id }),
  };
}
const initiate = (f, key = randomUUID(), body = {}) => call('/mpesa/stk-push', {
  method: 'POST', token: f.token, key, body: { orderId: f.order.id, phone: '0700000000', ...body },
});
const inventory = (f) => prisma.stock.findUnique({ where: { variantId: f.variantId } });
const savedOrder = (f) => prisma.order.findUnique({ where: { id: f.order.id } });
async function ready(id) {
  await prisma.mpesaPayment.update({ where: { id }, data: { nextReconcileAt: new Date(0) } });
}
async function reconcile(id, token) {
  await ready(id);
  return call(`/mpesa/payments/${id}/query`, { method: 'POST', token });
}
async function callback(request, extra = {}) {
  const path = new URL(request.callbackUrl).pathname;
  const response = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(callbackBody({ ...request, receiptNumber: `TEST${String(sequence).padStart(6, '0')}`, ...extra })),
  });
  return { status: response.status, data: await response.json() };
}

test('an accepted STK prompt stores one unpaid attempt and same-key concurrent retries cannot send another', async () => {
  const f = await fixture();
  const key = randomUUID(), beforeSent = sent.length;
  const results = await Promise.all([initiate(f, key), initiate(f, key)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 201]);
  assert.equal(results[0].data.id, results[1].data.id);
  assert.equal(sent.length, beforeSent + 1);
  assert.equal(sent.at(-1).amount, f.order.total.toNumber());
  assert.equal(sent.at(-1).phone, '254700000000');
  assert.equal(sent.at(-1).accountReference.length, 12);
  assert.equal((await savedOrder(f)).paymentStatus, 'PENDING');
  assert.equal((await inventory(f)).reserved, 1);
  assert.equal((await inventory(f)).quantity, 3);
  assert.equal((await initiate(f)).data.code, 'PAYMENT_EXISTS');
  assert.equal((await initiate(f, key, { phone: '0110000000' })).data.code, 'IDEMPOTENCY_CONFLICT');
  const safe = JSON.stringify(results[0].data);
  for (const secret of ['254700000000', 'callbackKeyHash', 'callbackUrl', 'ws_TEST', TEST_MPESA_ENV.MPESA_CONSUMER_SECRET]) assert.equal(safe.includes(secret), false);
});

test('only matching callback plus authenticated successful query pays and commits inventory once without fulfilment', async () => {
  const f = await fixture();
  const attempt = await initiate(f), request = sent.at(-1);
  assert.equal((await callback(request)).status, 200);
  assert.equal((await savedOrder(f)).paymentStatus, 'PENDING');
  assert.equal((await inventory(f)).quantity, 3);
  const verified = await reconcile(attempt.data.id, f.token);
  assert.equal(verified.status, 200);
  assert.equal(verified.data.status, 'SUCCEEDED');
  assert.ok(verified.data.receiptNumber);
  const order = await savedOrder(f);
  assert.equal(order.paymentStatus, 'PAID');
  assert.equal(order.status, 'PENDING');
  assert.equal(order.autoStageEnabled, false);
  assert.equal(order.autoStagePaused, true);
  assert.equal(order.reservationStatus, 'COMMITTED');
  assert.equal((await inventory(f)).quantity, 2);
  assert.equal((await inventory(f)).reserved, 0);
  await prisma.order.update({ where: { id: order.id }, data: { status: 'SHIPPED' } });
  await callback(request);
  await reconcile(attempt.data.id, f.token);
  assert.equal((await savedOrder(f)).status, 'SHIPPED');
  assert.equal((await inventory(f)).quantity, 2);
  assert.equal(await prisma.trackingEvent.count({ where: { orderId: order.id, location: 'Payment verification' } }), 1);
  assert.equal(await prisma.stockLog.count({ where: { stockId: (await inventory(f)).id, action: 'commit' } }), 1);
  assert.equal(await prisma.mpesaPaymentEvent.count({ where: { paymentId: attempt.data.id, source: 'CALLBACK' } }), 1);
});

test('callback-before-response and a lost initiation reply recover through persisted evidence after a restart', async () => {
  const f = await fixture(), key = randomUUID();
  initiateHook = async (_config, request, ids) => {
    assert.equal((await callback({ ...request, ...ids })).status, 200);
    throw new DarajaError('PROVIDER_OUTCOME_UNKNOWN', true);
  };
  const attempt = await initiate(f, key);
  assert.equal(attempt.status, 201);
  assert.equal(attempt.data.status, 'UNKNOWN');
  assert.equal((await savedOrder(f)).paymentStatus, 'PENDING');
  const beforeSent = sent.length;
  assert.equal((await initiate(f, key)).status, 200);
  assert.equal(sent.length, beforeSent);
  await ready(attempt.data.id);
  await prisma.$disconnect();
  await prisma.$connect();
  await reconcileDuePayments();
  const recovered = await call(`/mpesa/payments/${attempt.data.id}`, { token: f.token });
  assert.equal(recovered.data.status, 'SUCCEEDED');
  assert.equal((await savedOrder(f)).paymentStatus, 'PAID');
  assert.equal((await inventory(f)).quantity, 2);
});

test('provider timeout without identifiers remains unknown, blocks a new prompt and preserves the hold', async () => {
  const f = await fixture();
  initiateHook = async () => { throw new DarajaError('PROVIDER_OUTCOME_UNKNOWN', true); };
  const key = randomUUID(), attempt = await initiate(f, key), beforeSent = sent.length;
  assert.equal(attempt.data.status, 'UNKNOWN');
  assert.equal((await initiate(f)).data.code, 'PAYMENT_EXISTS');
  assert.equal((await initiate(f, key)).data.id, attempt.data.id);
  const checked = await reconcile(attempt.data.id, f.token);
  assert.equal(checked.data.status, 'UNKNOWN');
  assert.equal(checked.data.reasonCode, 'PROVIDER_REFERENCE_PENDING');
  assert.equal(checked.data.canReconcile, false);
  assert.equal(sent.length, beforeSent);
  assert.equal((await savedOrder(f)).paymentStatus, 'PENDING');
  assert.equal((await inventory(f)).reserved, 1);
});

test('an authenticated query success without receipt evidence remains review and cannot invent a receipt', async () => {
  const f = await fixture();
  const attempt = await initiate(f), request = sent.at(-1);
  const before = await reconcile(attempt.data.id, f.token);
  assert.equal(before.data.status, 'REVIEW');
  assert.equal(before.data.reasonCode, 'RECEIPT_PENDING');
  assert.equal(before.data.receiptNumber, null);
  assert.equal((await savedOrder(f)).paymentStatus, 'PENDING');
  await callback(request);
  assert.equal((await reconcile(attempt.data.id, f.token)).data.status, 'SUCCEEDED');
});

test('incomplete callback evidence can be completed without substituting an amount or receipt', async () => {
  const f = await fixture(), attempt = await initiate(f), request = sent.at(-1);
  const incomplete = callbackBody(request);
  incomplete.Body.stkCallback.CallbackMetadata.Item = [];
  const stored = await fetch(`${base}${new URL(request.callbackUrl).pathname}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(incomplete),
  });
  assert.equal(stored.status, 200);
  const pending = await reconcile(attempt.data.id, f.token);
  assert.equal(pending.data.reasonCode, 'RECEIPT_PENDING');
  assert.equal((await savedOrder(f)).paymentStatus, 'PENDING');
  await callback(request);
  assert.equal((await reconcile(attempt.data.id, f.token)).data.status, 'SUCCEEDED');
});

test('cancelled, insufficient-funds and timeout failures require provider confirmation before an explicit new attempt', async () => {
  for (const resultCode of [1032, 1, 1037]) {
    const f = await fixture();
    const attempt = await initiate(f), request = sent.at(-1);
    await callback(request, { resultCode });
    assert.equal((await savedOrder(f)).paymentStatus, 'PENDING');
    assert.equal((await initiate(f)).data.code, 'PAYMENT_EXISTS');
    responses.set(request.checkoutRequestId, { ...request, resultCode });
    const confirmed = await reconcile(attempt.data.id, f.token);
    assert.equal(confirmed.data.status, 'FAILED');
    assert.equal((await savedOrder(f)).paymentStatus, 'PENDING');
    await prisma.mpesaPayment.update({ where: { id: attempt.data.id }, data: { createdAt: new Date(Date.now() - 31_000) } });
    assert.equal((await call(`/mpesa/orders/${f.order.id}/payments`, { token: f.token })).data.available, true);
    const next = await initiate(f);
    assert.equal(next.status, 201);
    assert.equal((await inventory(f)).reserved, 1);
    assert.equal((await inventory(f)).quantity, 3);
  }
});

test('unrecognized query codes and transient query errors stay unknown and cannot allow another charge', async () => {
  const f = await fixture();
  const attempt = await initiate(f), request = sent.at(-1);
  responses.set(request.checkoutRequestId, { ...request, resultCode: 9999 });
  assert.equal((await reconcile(attempt.data.id, f.token)).data.status, 'UNKNOWN');
  queryHook = async () => { throw new DarajaError('PROVIDER_QUERY_UNAVAILABLE', true); };
  const transient = await reconcile(attempt.data.id, f.token);
  assert.equal(transient.data.status, 'UNKNOWN');
  assert.equal(transient.data.reasonCode, 'PROVIDER_QUERY_UNAVAILABLE');
  assert.equal((await initiate(f)).data.code, 'PAYMENT_EXISTS');
  assert.equal((await inventory(f)).quantity, 3);
});

test('callback amount, phone and provider-ID mismatches cannot mark an order paid', async () => {
  for (const extra of [{ amount: 1 }, { phone: '254110000000' }, { checkoutRequestId: 'ws_other' }, { merchantRequestId: 'mr_other' }]) {
    const f = await fixture();
    const attempt = await initiate(f), request = sent.at(-1);
    assert.equal((await callback(request, extra)).status, 200);
    const reconciled = await reconcile(attempt.data.id, f.token);
    assert.equal(reconciled.data.status, 'REVIEW');
    assert.equal((await savedOrder(f)).paymentStatus, 'PENDING');
    assert.equal((await inventory(f)).quantity, 3);
    assert.equal((await inventory(f)).reserved, 1);
  }
});

test('forged, malformed and oversized callbacks never receive a success acknowledgement', async () => {
  const f = await fixture(), attempt = await initiate(f), request = sent.at(-1);
  const invalidPath = new URL(request.callbackUrl).pathname.replace(/[a-f0-9]{64}$/, '0'.repeat(64));
  const fake = await fetch(`${base}${invalidPath}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(callbackBody(request)) });
  assert.equal(fake.status, 404);
  const url = `${base}${new URL(request.callbackUrl).pathname}`;
  const malformed = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(malformed.status, 400);
  const oversized = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ noise: 'x'.repeat(40_000) }) });
  assert.equal(oversized.status, 413);
  const bad = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Body: { stkCallback: { ResultCode: 0 } } }) });
  assert.equal(bad.status, 400);
  assert.equal(await prisma.mpesaPaymentEvent.count({ where: { paymentId: attempt.data.id, source: 'CALLBACK' } }), 0);
  assert.equal((await savedOrder(f)).paymentStatus, 'PENDING');
});

test('late success records received money without reopening a cancelled or expired order', async () => {
  for (const expired of [false, true]) {
    const f = await fixture();
    const attempt = await initiate(f), request = sent.at(-1);
    if (expired) {
      await prisma.order.update({ where: { id: f.order.id }, data: { reservationExpiresAt: new Date(0) } });
      await expireReservations();
    } else await cancelOrderReservation(f.user.id, f.order.id, 'Cancelled before provider result');
    const before = await savedOrder(f);
    await callback(request);
    const reconciled = await reconcile(attempt.data.id, f.token);
    assert.equal(reconciled.data.status, 'REVIEW');
    assert.ok(reconciled.data.confirmedAt);
    assert.ok(reconciled.data.receiptNumber);
    assert.equal(reconciled.data.reasonCode, 'RESERVATION_UNAVAILABLE');
    const after = await savedOrder(f);
    assert.equal(after.status, 'CANCELLED');
    assert.equal(after.reservationStatus, before.reservationStatus);
    assert.equal(after.paymentStatus, 'PAID');
    assert.equal((await inventory(f)).quantity, 3);
    assert.equal((await inventory(f)).reserved, 0);
    assert.equal((await initiate(f)).data.code, 'ORDER_NOT_PAYABLE');
  }
});

test('a repeated receipt or reordered failure cannot double-settle or regress a paid order', async () => {
  const one = await fixture();
  const first = await initiate(one), request = sent.at(-1);
  await callback(request, { receiptNumber: 'SAMERECEIPT01' });
  await reconcile(first.data.id, one.token);
  await callback(request, { resultCode: 1032 });
  const unchanged = await reconcile(first.data.id, one.token);
  assert.equal(unchanged.data.status, 'SUCCEEDED');
  assert.equal(unchanged.data.reviewRequired, true);
  assert.equal((await savedOrder(one)).paymentStatus, 'PAID');
  assert.equal((await inventory(one)).quantity, 2);
  const two = await fixture();
  const second = await initiate(two), otherRequest = sent.at(-1);
  await callback(otherRequest, { receiptNumber: 'SAMERECEIPT01' });
  const duplicate = await reconcile(second.data.id, two.token);
  assert.equal(duplicate.data.status, 'REVIEW');
  assert.equal(duplicate.data.reasonCode, 'RECEIPT_REUSED');
  assert.equal((await savedOrder(two)).paymentStatus, 'PENDING');
  assert.equal((await inventory(two)).quantity, 3);
});

test('customers cannot read, reconcile or pay another order; staff viewer access is read-only', async () => {
  const f = await fixture(), attempt = await initiate(f);
  assert.equal((await call(`/mpesa/orders/${f.order.id}/payments`, { token: f.otherToken })).status, 404);
  assert.equal((await call(`/mpesa/payments/${attempt.data.id}`, { token: f.otherToken })).status, 404);
  assert.equal((await call(`/mpesa/payments/${attempt.data.id}/query`, { method: 'POST', token: f.otherToken })).status, 404);
  assert.equal((await call('/mpesa/stk-push', { method: 'POST', token: f.otherToken, key: randomUUID(), body: { orderId: f.order.id, phone: '0700000000' } })).status, 404);
  assert.equal((await call(`/mpesa/admin/orders/${f.order.id}/payments`, { token: f.token })).status, 401);
  assert.equal((await call(`/mpesa/admin/orders/${f.order.id}/payments`, { token: viewerToken })).status, 200);
  assert.equal((await call(`/mpesa/admin/payments/${attempt.data.id}/query`, { method: 'POST', token: viewerToken })).status, 403);
  await ready(attempt.data.id);
  assert.equal((await call(`/mpesa/admin/payments/${attempt.data.id}/query`, { method: 'POST', token: staffToken })).status, 200);
});

test('configuration, exact amount and server-owned demo eligibility reject before provider initiation', async () => {
  const fractional = await fixture({ price: 900.01 });
  const beforeSent = sent.length;
  assert.equal((await initiate(fractional)).data.code, 'MPESA_AMOUNT_UNSUPPORTED');
  const f = await fixture();
  assert.equal((await initiate(f, randomUUID(), { amount: 1 })).status, 400);
  assert.equal((await initiate(f, randomUUID(), { phone: 'not-a-phone' })).status, 400);
  assert.equal((await initiate(f, randomUUID(), { phone: '0711111111' })).data.code, 'SANDBOX_PHONE_NOT_ALLOWED');
  process.env.ENABLE_MPESA = 'false';
  assert.equal((await initiate(f)).status, 503);
  process.env.ENABLE_MPESA = 'true';
  process.env.MPESA_ENVIRONMENT = 'production';
  assert.equal((await initiate(f)).data.code, 'MPESA_LIVE_DISABLED');
  process.env.NODE_ENV = 'production'; process.env.MPESA_LIVE_PAYMENTS_ENABLED = 'true';
  assert.equal((await initiate(f)).data.code, 'MPESA_DEMO_BLOCKED');
  Object.assign(process.env, TEST_MPESA_ENV);
  const liveOrder = await fixture({ demo: false });
  assert.equal((await initiate(liveOrder)).data.code, 'MPESA_SANDBOX_ONLY');
  assert.equal(sent.length, beforeSent);
  assert.equal(await prisma.mpesaPayment.count({ where: { orderId: { in: [fractional.order.id, f.order.id, liveOrder.order.id] } } }), 0);
});

test('failed callback persistence returns an error, and replay safely restores durable evidence', async () => {
  const f = await fixture(), attempt = await initiate(f), request = sent.at(-1);
  failWrite = (params) => params.model === 'MpesaPaymentEvent' && params.action === 'upsert';
  const failed = await callback(request);
  failWrite = null;
  assert.equal(failed.status, 503);
  assert.equal(JSON.stringify(failed.data).includes('Synthetic private'), false);
  assert.equal(await prisma.mpesaPaymentEvent.count({ where: { paymentId: attempt.data.id, source: 'CALLBACK' } }), 0);
  assert.equal((await savedOrder(f)).paymentStatus, 'PENDING');
  assert.equal((await callback(request)).status, 200);
  assert.equal((await reconcile(attempt.data.id, f.token)).data.status, 'SUCCEEDED');
});

test('losing the provider-acceptance write never resends STK and the later callback recovers the attempt', async () => {
  const f = await fixture(), key = randomUUID();
  failWrite = (params) => params.model === 'MpesaPayment' && params.action === 'update' && params.args.data.checkoutRequestId;
  const failed = await initiate(f, key), request = sent.at(-1), beforeSent = sent.length;
  failWrite = null;
  assert.equal(failed.status, 503);
  assert.equal(failed.data.code, 'PAYMENT_PERSISTENCE_UNKNOWN');
  const retry = await initiate(f, key);
  assert.equal(retry.status, 200);
  assert.equal(sent.length, beforeSent);
  await callback(request);
  assert.equal((await reconcile(retry.data.id, f.token)).data.status, 'SUCCEEDED');
});

test('a stock-finalization write failure rolls back payment and can be reconciled without another provider prompt', async () => {
  const f = await fixture(), attempt = await initiate(f), request = sent.at(-1);
  await callback(request);
  failWrite = (params) => params.model === 'StockLog' && params.action === 'create' && params.args.data.action === 'commit';
  const failed = await reconcile(attempt.data.id, f.token);
  failWrite = null;
  assert.equal(failed.status, 503);
  assert.equal((await savedOrder(f)).paymentStatus, 'PENDING');
  assert.equal((await inventory(f)).quantity, 3);
  assert.equal((await inventory(f)).reserved, 1);
  assert.equal((await prisma.mpesaPayment.findUnique({ where: { id: attempt.data.id } })).confirmedAt, null);
  assert.equal((await reconcile(attempt.data.id, f.token)).data.status, 'SUCCEEDED');
  assert.equal((await inventory(f)).quantity, 2);
});

test('reconciliation leases bound concurrent query calls and merchant changes cannot redirect a saved attempt', async () => {
  const f = await fixture(), attempt = await initiate(f), request = sent.at(-1);
  await callback(request);
  await ready(attempt.data.id);
  const beforeQueries = queried.length;
  const results = await Promise.all([
    call(`/mpesa/payments/${attempt.data.id}/query`, { method: 'POST', token: f.token }),
    call(`/mpesa/payments/${attempt.data.id}/query`, { method: 'POST', token: f.token }),
  ]);
  assert.ok(results.every((result) => result.status === 200));
  assert.equal(queried.length, beforeQueries + 1);
  const g = await fixture(), pending = await initiate(g);
  process.env.MPESA_SHORTCODE = '174380';
  const before = queried.length;
  const mismatch = await reconcile(pending.data.id, g.token);
  assert.equal(mismatch.data.status, 'UNKNOWN');
  assert.equal(mismatch.data.reasonCode, 'MPESA_MERCHANT_CHANGED');
  assert.equal(queried.length, before);
  assert.equal((await savedOrder(g)).paymentStatus, 'PENDING');
});

test('mismatched authenticated query IDs and contradictory callbacks stay review without payment or stock effects', async () => {
  const f = await fixture(), attempt = await initiate(f), request = sent.at(-1);
  await callback(request);
  responses.set(request.checkoutRequestId, { checkoutRequestId: 'ws_wrong', merchantRequestId: request.merchantRequestId, resultCode: 0 });
  const mismatch = await reconcile(attempt.data.id, f.token);
  assert.equal(mismatch.data.status, 'REVIEW');
  assert.equal(mismatch.data.reasonCode, 'QUERY_ID_MISMATCH');
  assert.equal((await savedOrder(f)).paymentStatus, 'PENDING');
  assert.equal((await inventory(f)).reserved, 1);

  const g = await fixture(), other = await initiate(g), next = sent.at(-1);
  await callback(next, { resultCode: 1032 });
  await callback(next, { receiptNumber: 'CONFLICT001' });
  const conflict = await reconcile(other.data.id, g.token);
  assert.equal(conflict.data.status, 'REVIEW');
  assert.equal(conflict.data.reasonCode, 'CONFLICTING_CALLBACK');
  assert.equal(conflict.data.confirmedAt, null);
  assert.equal((await savedOrder(g)).paymentStatus, 'PENDING');
  assert.equal((await inventory(g)).quantity, 3);
});

test('new prompts respect cooldown and attempt caps while failed attempts still replay their original key', async () => {
  const f = await fixture();
  initiateHook = async () => ({ accepted: false });
  const keys = [];
  for (let i = 0; i < 5; i++) {
    const key = randomUUID();
    keys.push(key);
    const result = await initiate(f, key);
    assert.equal(result.status, 201);
    assert.equal(result.data.status, 'FAILED');
    assert.equal((await initiate(f)).data.code, i === 4 ? 'PAYMENT_ATTEMPT_LIMIT' : 'PAYMENT_COOLDOWN');
    await prisma.mpesaPayment.update({ where: { id: result.data.id }, data: { createdAt: new Date(Date.now() - 31_000 - i) } });
  }
  const before = sent.length;
  assert.equal((await initiate(f)).data.code, 'PAYMENT_ATTEMPT_LIMIT');
  assert.equal((await initiate(f, keys[0])).status, 200);
  assert.equal(sent.length, before);
});

test('a worker lease survives process loss and recovers only after its persisted expiry', async () => {
  const f = await fixture(), attempt = await initiate(f), request = sent.at(-1);
  await callback(request);
  await prisma.mpesaPayment.update({ where: { id: attempt.data.id }, data: {
    reconcileLease: 'lost-worker', leaseExpiresAt: new Date(Date.now() + 60_000), nextReconcileAt: new Date(0),
  } });
  const before = queried.length;
  await call(`/mpesa/payments/${attempt.data.id}/query`, { method: 'POST', token: f.token });
  assert.equal(queried.length, before);
  await prisma.mpesaPayment.update({ where: { id: attempt.data.id }, data: { leaseExpiresAt: new Date(0) } });
  await reconcileDuePayments();
  assert.equal((await prisma.mpesaPayment.findUnique({ where: { id: attempt.data.id } })).status, 'SUCCEEDED');
  assert.equal((await inventory(f)).quantity, 2);
});

test('stale unsent references and paused receipt reviews are visible without unbounded provider queries', async () => {
  const f = await fixture();
  failWrite = (params) => params.model === 'MpesaPayment' && params.action === 'update' && params.args.data.checkoutRequestId;
  const key = randomUUID();
  assert.equal((await initiate(f, key)).status, 503);
  failWrite = null;
  const attempt = await prisma.mpesaPayment.findFirst({ where: { orderId: f.order.id } });
  await prisma.mpesaPayment.update({ where: { id: attempt.id }, data: {
    createdAt: new Date(Date.now() - 61_000), nextReconcileAt: new Date(0),
  } });
  const overview = await call(`/mpesa/orders/${f.order.id}/payments`, { token: f.token });
  assert.equal(overview.data.attempts[0].status, 'UNKNOWN');
  assert.equal(overview.data.attempts[0].reasonCode, 'PROVIDER_REFERENCE_PENDING');
  assert.equal(overview.data.available, false);

  const g = await fixture(), pending = await initiate(g);
  const checked = await reconcile(pending.data.id, g.token);
  assert.equal(checked.data.reasonCode, 'RECEIPT_PENDING');
  assert.equal(checked.data.canReconcile, false);
  const before = queried.length;
  const repeated = await call(`/mpesa/payments/${pending.data.id}/query`, { method: 'POST', token: g.token });
  assert.equal(repeated.status, 200);
  assert.equal(queried.length, before);
});

test('database/provider failures never print or return full phone numbers, callback keys or credentials', async (t) => {
  const f = await fixture(), first = await initiate(f), original = sent.at(-1);
  const g = await fixture();
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  initiateHook = async () => ({
    accepted: true, checkoutRequestId: original.checkoutRequestId, merchantRequestId: original.merchantRequestId,
  });
  const failure = await initiate(g);
  assert.equal(failure.status, 503);
  assert.equal(failure.data.code, 'PAYMENT_PERSISTENCE_UNKNOWN');
  const callbackKey = new URL(sent.at(-1).callbackUrl).pathname.split('/').at(-1);
  const output = JSON.stringify({ errors, response: failure.data });
  for (const sensitive of ['254700000000', callbackKey, TEST_MPESA_ENV.MPESA_PASSKEY, TEST_MPESA_ENV.MPESA_CONSUMER_SECRET]) {
    assert.equal(output.includes(sensitive), false);
  }
  assert.ok(errors.some((entry) => String(entry[0]).includes('Database operation failed')));
  assert.equal((await prisma.mpesaPayment.findUnique({ where: { id: first.data.id } })).checkoutRequestId, original.checkoutRequestId);
  assert.equal((await savedOrder(g)).paymentStatus, 'PENDING');
});

test('cancellation racing verified payment cannot double-release stock or reopen the cancelled order', async () => {
  const f = await fixture(), attempt = await initiate(f), request = sent.at(-1);
  await callback(request);
  await ready(attempt.data.id);
  const results = await Promise.all([
    call(`/mpesa/payments/${attempt.data.id}/query`, { method: 'POST', token: f.token }),
    call(`/orders/${f.order.id}/cancel`, { method: 'POST', token: f.token, body: { reason: 'Concurrent cancellation' } }),
  ]);
  assert.equal(results[0].status, 200);
  assert.ok([200, 409].includes(results[1].status));
  const payment = await prisma.mpesaPayment.findUnique({ where: { id: attempt.data.id } });
  if (!payment.confirmedAt) {
    assert.equal((await reconcile(attempt.data.id, f.token)).status, 200);
  }
  const order = await savedOrder(f), stock = await inventory(f);
  assert.equal(order.paymentStatus, 'PAID');
  assert.equal(stock.reserved, 0);
  if (order.status === 'PENDING') {
    assert.equal(order.reservationStatus, 'COMMITTED');
    assert.equal(stock.quantity, 2);
  } else {
    assert.ok(['CANCELLED', 'AWAITING_REFUND'].includes(order.status));
    assert.equal(order.reservationStatus, 'RELEASED');
    assert.equal(stock.quantity, 3);
  }
  assert.ok(await prisma.stockLog.count({ where: { stockId: stock.id, action: 'commit' } }) <= 1);
  assert.equal(await prisma.trackingEvent.count({ where: { orderId: f.order.id, location: 'Payment verification' } }), 1);
  assert.equal(order.autoStageEnabled, false);
});

test('confirmed but disputed evidence preserves payment while blocking fulfilment shortcuts', async () => {
  const f = await fixture({ demo: false });
  process.env.NODE_ENV = 'production';
  process.env.MPESA_ENVIRONMENT = 'production';
  process.env.MPESA_LIVE_PAYMENTS_ENABLED = 'true';
  const attempt = await initiate(f), request = sent.at(-1);
  assert.equal(attempt.status, 201);
  assert.equal(request.environment, 'production');
  await callback(request);
  assert.equal((await reconcile(attempt.data.id, f.token)).data.status, 'SUCCEEDED');
  await callback(request, { resultCode: 1032 });
  const status = await call(`/orders/admin/${f.order.id}/status`, {
    method: 'PUT', token: staffToken, body: { status: 'PROCESSING' },
  });
  assert.equal(status.status, 409);
  assert.equal(status.data.code, 'PAYMENT_REVIEW_REQUIRED');
  await prisma.order.update({ where: { id: f.order.id }, data: {
    autoStageEnabled: true, autoStagePaused: false, autoStageLastUpdate: new Date(Date.now() - 120_000),
  } });
  await autoStageService.processAutoStages();
  assert.equal((await savedOrder(f)).status, 'PENDING');
  assert.equal((await savedOrder(f)).paymentStatus, 'PAID');
  assert.equal((await inventory(f)).quantity, 2);
});

test('payment overviews expire overdue holds without contacting the provider or inviting another prompt', async () => {
  const f = await fixture(), attempt = await initiate(f);
  await prisma.order.update({ where: { id: f.order.id }, data: { reservationExpiresAt: new Date(0) } });
  const before = queried.length;
  const overview = await call(`/mpesa/orders/${f.order.id}/payments`, { token: f.token });
  assert.equal(overview.status, 200);
  assert.equal(overview.data.order.status, 'CANCELLED');
  assert.equal(overview.data.order.reservationStatus, 'EXPIRED');
  assert.equal(overview.data.attempts[0].id, attempt.data.id);
  assert.equal(overview.data.available, false);
  assert.equal(queried.length, before);
  assert.equal((await inventory(f)).reserved, 0);
});
