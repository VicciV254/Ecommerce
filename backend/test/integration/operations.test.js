import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, mock, test } from 'node:test';
import prisma from '../../src/config/database.js';
import { generateToken } from '../../src/config/auth.js';
import { DEFAULT_CHECKOUT_POLICY } from '../../src/config/checkoutPolicy.js';
import { startServer } from '../../src/server.js';
import { commitOrderReservation } from '../../src/services/inventoryService.js';
import { MAX_NOTIFICATION_ATTEMPTS, deliverNotification, enqueueNotification, mailer } from '../../src/services/notificationService.js';
import { returnEligibility } from '../../src/services/returnService.js';
import { orderInclude } from '../../src/utils/orderDto.js';

let base, close, adminToken, viewerToken, adminId, catalog, sequence = 0, receipts = 0, failMail = null, sendHook = null;
const DAY_MS = 86_400_000;

before(async () => {
  process.env.ENABLE_ORDER_RESERVATIONS = 'true';
  mock.method(mailer, 'send', async (message) => {
    if (sendHook) await sendHook(message);
    if (failMail) throw failMail;
    return { provider: 'test', messageId: `test-${randomUUID()}` };
  });
  const [admin, viewer] = await Promise.all(['ADMIN', 'VIEWER'].map((role) => prisma.admin.create({ data: {
    email: `${role.toLowerCase()}-operations@example.test`, username: `operations-${role.toLowerCase()}`,
    password: 'fixture-not-for-login', role,
  } })));
  adminId = admin.id;
  adminToken = generateToken({ adminId: admin.id });
  viewerToken = generateToken({ adminId: viewer.id });
  catalog = await createCatalog();
  const started = await startServer({ host: '127.0.0.1', port: 0 });
  close = started.close;
  base = `http://127.0.0.1:${started.server.address().port}/api`;
});
beforeEach(() => { failMail = null; sendHook = null; });
after(async () => { mock.restoreAll(); await close?.(); });

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

async function createCatalog() {
  const root = await prisma.category.create({ data: { name: 'Operations', slug: 'operations' } });
  const child = (slug, returnRule) => prisma.category.create({ data: { name: slug, slug, parentId: root.id, returnRule } });
  const [dairy, care] = await Promise.all([child('operations-dairy', 'FAULT_ONLY'), child('operations-care', 'UNOPENED_OR_FAULT')]);
  const product = (slug, category, price) => prisma.product.create({
    data: {
      name: slug, slug, description: 'Operations fixture', price, isActive: true, category: { connect: { id: category.id } },
      variants: { create: { sku: slug.toUpperCase(), attributes: { size: 'One' }, stock: { create: { quantity: 1000, minThreshold: 0, status: 'IN_STOCK' } } } },
    },
    include: { variants: true },
  });
  const [mug, milk, cream] = await Promise.all([
    product('ops-mug', root, 1000), product('ops-milk', dairy, 150), product('ops-cream', care, 1012.5),
  ]);
  return { root, dairy, care, mug, milk, cream };
}

async function customer() {
  const tag = `ops-${++sequence}`;
  const user = await prisma.user.create({
    data: {
      email: `${tag}@example.test`, password: 'fixture-not-for-login', firstName: 'Ops', lastName: tag,
      addresses: { create: { street: `${tag} street`, city: 'Mombasa', county: 'Mombasa' } },
    },
    include: { addresses: true },
  });
  return { ...user, token: generateToken({ userId: user.id }) };
}

/** Records verified money the way payment finalization does, without contacting a provider. */
async function pay(orderId) {
  await prisma.$transaction(async (db) => {
    await commitOrderReservation(db, orderId);
    const current = await db.order.findUnique({ where: { id: orderId } });
    const sequenceId = String(++receipts).padStart(7, '0');
    const payment = await db.mpesaPayment.create({ data: {
      orderId, phone: '254700000000', amount: current.total, status: 'SUCCEEDED', confirmedAt: new Date(),
      receiptNumber: `OPS${sequenceId}`, environment: 'sandbox', idempotencyKey: randomUUID(), requestHash: 'fixture',
      merchantIdentity: 'fixture-merchant', merchantShortcode: '174379', callbackKeyHash: '0'.repeat(64), reference: `OPS-${sequenceId}`,
    } });
    await db.order.update({ where: { id: orderId }, data: { paymentStatus: 'PAID', settledPaymentId: payment.id } });
  });
}

async function order(person, lines, { deliveryMethod = 'STANDARD', paid = true } = {}) {
  const quoted = await call('/orders/quotes', { method: 'POST', token: person.token, body: {
    items: lines.map(([product, quantity]) => ({ productId: product.id, variantId: product.variants[0].id, quantity })),
    addressId: person.addresses[0].id, deliveryMethod, couponCode: null, notes: null,
  } });
  assert.equal(quoted.status, 201, JSON.stringify(quoted.data));
  const created = await call('/orders', { method: 'POST', token: person.token, key: randomUUID(), body: { quoteId: quoted.data.id } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  if (paid) await pay(created.data.id);
  return created.data;
}

/** The policy before Store pickup was turned off, under which the pickup orders still being fulfilled were placed. */
const LEGACY_POLICY = {
  ...DEFAULT_CHECKOUT_POLICY, version: 1, delivery: {
    STANDARD: { fee: 200, freeAbove: null, counties: [] },
    SAME_DAY: { fee: 500, freeAbove: null, counties: [] },
    STORE_PICKUP: { fee: 200, freeAbove: null, counties: [] },
  },
};
/** Places a pickup order as one placed before pickup was turned off; the environment is restored even on failure. */
async function legacyPickupOrder(...args) {
  const previous = process.env.CHECKOUT_POLICY_JSON;
  process.env.CHECKOUT_POLICY_JSON = JSON.stringify(LEGACY_POLICY);
  try {
    return await order(...args);
  } finally {
    if (previous === undefined) delete process.env.CHECKOUT_POLICY_JSON;
    else process.env.CHECKOUT_POLICY_JSON = previous;
  }
}

const act = (orderId, action, expectedStatus, extra = {}, token = adminToken) =>
  call(`/orders/admin/${orderId}/actions`, { method: 'POST', token, body: { action, expectedStatus, ...extra } });
const stockOf = (product) => prisma.stock.findUnique({ where: { variantId: product.variants[0].id } });
const itemFor = (placed, product) => placed.items.find((item) => item.productId === product.id);
const requestReturn = (person, orderId, body, key = randomUUID()) =>
  call(`/orders/${orderId}/returns`, { method: 'POST', token: person.token, key, body });
const decide = (returnId, body, token = adminToken) =>
  call(`/orders/admin/returns/${returnId}/decision`, { method: 'POST', token, body: { expectedStatus: 'REQUESTED', ...body } });
const receive = (returnId, body) =>
  call(`/orders/admin/returns/${returnId}/receive`, { method: 'POST', token: adminToken, body: { expectedStatus: 'APPROVED', ...body } });
const refundAction = (refundId, action, expectedStatus, extra = {}) =>
  call(`/orders/admin/refunds/${refundId}/${action}`, { method: 'POST', token: adminToken, body: { expectedStatus, ...extra } });

async function deliver(orderId) {
  for (const [action, expected] of [['START_PROCESSING', 'PENDING'], ['DISPATCH', 'PROCESSING'], ['CONFIRM_DELIVERY', 'SHIPPED']]) {
    const result = await act(orderId, action, expected);
    assert.equal(result.status, 200, JSON.stringify(result.data));
  }
}

/** Requests, approves and receives one line; returns the created refund record. */
async function returnedRefund(person, placed, product, { reason = 'CHANGED_MIND', quantity = 1, faultConfirmed = false } = {}) {
  const requested = await requestReturn(person, placed.id, { reason, lines: [{ orderItemId: itemFor(placed, product).id, quantity }] });
  assert.equal(requested.status, 201, JSON.stringify(requested.data));
  const { id, lines } = requested.data.returnRequest;
  assert.equal((await decide(id, { decision: 'APPROVE' })).status, 200);
  const received = await receive(id, { merchantFaultConfirmed: faultConfirmed, lines: [
    { returnLineId: lines[0].id, receivedQuantity: quantity, restockQuantity: 0, refundableQuantity: quantity },
  ] });
  assert.equal(received.status, 200, JSON.stringify(received.data));
  return prisma.refund.findFirstOrThrow({ where: { returnRequestId: id } });
}

test('staff confirm each fulfilment step and stale, invalid or unauthorized actions change nothing', async () => {
  const person = await customer();
  const unpaid = await legacyPickupOrder(person, [[catalog.mug, 1]], { deliveryMethod: 'STORE_PICKUP', paid: false });
  assert.equal((await act(unpaid.id, 'START_PROCESSING', 'PENDING')).data.code, 'ACTION_NOT_ALLOWED');

  const pickup = await legacyPickupOrder(person, [[catalog.mug, 1]], { deliveryMethod: 'STORE_PICKUP' });
  assert.equal((await act(pickup.id, 'START_PROCESSING', 'PENDING', {}, viewerToken)).status, 403);
  assert.equal((await act(pickup.id, 'START_PROCESSING', 'PROCESSING')).data.code, 'ORDER_CHANGED');
  const started = await act(pickup.id, 'START_PROCESSING', 'PENDING');
  assert.equal(started.data.status, 'PROCESSING');
  assert.ok(started.data.fulfilment.processingAt);
  assert.deepEqual(started.data.allowedActions, ['MARK_READY_FOR_PICKUP', 'CANCEL']);
  assert.equal((await act(pickup.id, 'DISPATCH', 'PROCESSING')).data.code, 'ACTION_NOT_ALLOWED');

  const ready = await Promise.all([1, 2].map(() => act(pickup.id, 'MARK_READY_FOR_PICKUP', 'PROCESSING')));
  assert.deepEqual(ready.map((result) => result.status).sort(), [200, 409]);
  assert.equal(await prisma.trackingEvent.count({ where: { orderId: pickup.id, status: 'READY_FOR_PICKUP' } }), 1);
  assert.equal(await prisma.notification.count({ where: { orderId: pickup.id, type: 'ORDER_READY_FOR_PICKUP', status: 'SENT' } }), 1);

  const waiting = await call(`/orders/${pickup.id}`, { token: person.token });
  assert.deepEqual(waiting.data.customerActions, []);
  assert.equal((await call(`/orders/${pickup.id}/cancel`, { method: 'POST', token: person.token, body: {} })).data.code, 'ACTION_NOT_ALLOWED');
  assert.equal((await call(`/orders/${pickup.id}/pickup`, { method: 'POST', token: person.token, body: {} })).status, 404);

  const collected = await act(pickup.id, 'CONFIRM_PICKUP', 'READY_FOR_PICKUP');
  assert.equal(collected.data.status, 'DELIVERED');
  assert.ok(collected.data.fulfilment.pickedUpAt && collected.data.fulfilment.deliveredAt);
  assert.deepEqual([collected.data.trackingHistory[0].actorType, collected.data.trackingHistory[0].actorId], ['STAFF', adminId]);
  const own = await call(`/orders/${pickup.id}`, { token: person.token });
  assert.deepEqual(own.data.customerActions, ['REQUEST_RETURN']);
  assert.ok(own.data.trackingHistory.every((event) => !('actorId' in event) && !('reason' in event)));
  assert.equal('settledPaymentId' in own.data, false);
  const tracked = await call(`/orders/track/${pickup.orderNumber}`);
  assert.ok(tracked.data.trackingHistory.every((event) => !('actorId' in event)));
  assert.equal(await prisma.notification.count({ where: { orderId: pickup.id, type: 'ORDER_PICKED_UP', status: 'SENT' } }), 1);
});

test('a paid cancellation restocks once and records a full refund request without claiming money was sent', async () => {
  const person = await customer();
  const before = (await stockOf(catalog.mug)).quantity;
  const paid = await order(person, [[catalog.mug, 2]]);
  assert.equal((await stockOf(catalog.mug)).quantity, before - 2);
  assert.equal((await act(paid.id, 'START_PROCESSING', 'PENDING')).status, 200);
  const results = await Promise.all([1, 2].map(() => call(`/orders/${paid.id}/cancel`, {
    method: 'POST', token: person.token, body: { reason: 'Ordered twice' },
  })));
  assert.ok(results.every((result) => result.status === 200));
  const view = (await call(`/orders/${paid.id}`, { token: person.token })).data;
  assert.equal(view.status, 'CANCELLED');
  assert.equal(view.paymentStatus, 'PAID');
  assert.deepEqual(view.refunds.map((refund) => [refund.source, refund.status, refund.amount, refund.includesDeliveryFee, refund.providerReference]),
    [['CANCELLATION', 'REQUESTED', 2520, true, null]]);
  assert.equal((await stockOf(catalog.mug)).quantity, before);
  const notices = await prisma.notification.findMany({ where: { orderId: paid.id, type: 'ORDER_CANCELLED' } });
  assert.equal(notices.length, 1);
  assert.equal(notices[0].refundId, view.refunds[0].id);
  assert.equal((await refundAction(view.refunds[0].id, 'confirm', 'REQUESTED', { providerReference: 'ABCD1234EF' })).data.code, 'REFUND_ACTION_NOT_ALLOWED');
});

test('returns follow the purchase snapshot, the 7-day window, reason rules and remaining quantities', async () => {
  const person = await customer();
  const placed = await order(person, [[catalog.mug, 2], [catalog.milk, 1], [catalog.cream, 2]]);
  const [mug, milk, cream] = [catalog.mug, catalog.milk, catalog.cream].map((product) => itemFor(placed, product));
  const faulty = { reason: 'FAULTY', lines: [{ orderItemId: milk.id, quantity: 1 }] };
  assert.equal((await requestReturn(person, placed.id, faulty)).data.code, 'RETURN_NOT_ELIGIBLE');
  await deliver(placed.id);
  await prisma.category.update({ where: { id: catalog.dairy.id }, data: { returnRule: 'STANDARD' } });
  try {
    const view = (await call(`/orders/${placed.id}`, { token: person.token })).data;
    const rules = Object.fromEntries(view.returnEligibility.lines.map((line) => [line.orderItemId, line.returnRule]));
    assert.deepEqual([rules[mug.id], rules[milk.id], rules[cream.id]], ['STANDARD', 'FAULT_ONLY', 'UNOPENED_OR_FAULT']);
    assert.equal(view.returnEligibility.policy.windowDays, 7);
    assert.equal((await call(`/orders/${placed.id}/returns`, { method: 'POST', token: person.token, body: faulty })).data.code, 'IDEMPOTENCY_KEY_REQUIRED');
    const changedMind = (item, extra = {}) => ({ reason: 'CHANGED_MIND', lines: [{ orderItemId: item.id, quantity: 1 }], ...extra });
    assert.equal((await requestReturn(person, placed.id, changedMind(milk))).data.code, 'RETURN_REASON_NOT_ALLOWED');
    assert.equal((await requestReturn(person, placed.id, changedMind(cream))).data.code, 'RETURN_REASON_NOT_ALLOWED');
    assert.equal((await requestReturn(person, placed.id, { reason: 'CHANGED_MIND', lines: [{ orderItemId: mug.id, quantity: 3 }] })).data.code, 'RETURN_QUANTITY_INVALID');
    assert.equal((await requestReturn(await customer(), placed.id, changedMind(mug))).status, 404);

    const body = { reason: 'CHANGED_MIND', unopenedDeclared: true, lines: [{ orderItemId: mug.id, quantity: 1 }, { orderItemId: cream.id, quantity: 1 }] };
    const key = randomUUID();
    const first = await requestReturn(person, placed.id, body, key);
    assert.equal(first.status, 201);
    assert.match(first.data.returnRequest.number, /^RMA-/);
    const replay = await requestReturn(person, placed.id, body, key);
    assert.deepEqual([replay.status, replay.data.returnRequest.id], [200, first.data.returnRequest.id]);
    assert.equal((await requestReturn(person, placed.id, { ...body, comment: 'Different' }, key)).data.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await requestReturn(person, placed.id, { reason: 'FAULTY', lines: [{ orderItemId: mug.id, quantity: 2 }] })).data.code, 'RETURN_QUANTITY_INVALID');
    const withdraw = () => call(`/orders/${placed.id}/returns/${first.data.returnRequest.id}/cancel`, { method: 'POST', token: person.token, body: {} });
    assert.equal((await withdraw()).status, 200);
    assert.equal((await withdraw()).data.code, 'RETURN_CHANGED');
    const reopened = (await call(`/orders/${placed.id}`, { token: person.token })).data.returnEligibility.lines;
    assert.equal(reopened.find((line) => line.orderItemId === mug.id).returnableQuantity, 2);

    const stored = await prisma.order.findUnique({ where: { id: placed.id }, include: orderInclude });
    const endsAt = new Date(stored.deliveredAt.getTime() + 7 * DAY_MS);
    assert.equal(returnEligibility(stored, endsAt).eligible, true);
    assert.equal(returnEligibility(stored, new Date(endsAt.getTime() + 1)).reasonCode, 'WINDOW_CLOSED');
    await prisma.order.update({ where: { id: placed.id }, data: { deliveredAt: new Date(Date.now() - 7 * DAY_MS - 60_000) } });
    assert.equal((await requestReturn(person, placed.id, faulty)).data.code, 'RETURN_WINDOW_CLOSED');
  } finally {
    await prisma.category.update({ where: { id: catalog.dairy.id }, data: { returnRule: 'FAULT_ONLY' } });
  }
});

test('staff decisions and receipt restock exactly once and request a whole-KES refund without the delivery fee', async () => {
  const person = await customer();
  const placed = await order(person, [[catalog.mug, 2], [catalog.cream, 2]]);
  await deliver(placed.id);
  const [mug, cream] = [catalog.mug, catalog.cream].map((product) => itemFor(placed, product));
  const requested = await requestReturn(person, placed.id, {
    reason: 'CHANGED_MIND', unopenedDeclared: true, lines: [{ orderItemId: mug.id, quantity: 1 }, { orderItemId: cream.id, quantity: 1 }],
  });
  const returnId = requested.data.returnRequest.id;
  assert.equal((await decide(returnId, { decision: 'APPROVE' }, viewerToken)).status, 403);
  assert.equal((await decide(returnId, { decision: 'REJECT' })).data.code, 'REASON_REQUIRED');
  assert.equal((await decide(returnId, { decision: 'APPROVE' })).status, 200);
  assert.equal((await decide(returnId, { decision: 'APPROVE' })).data.code, 'RETURN_CHANGED');
  assert.equal((await call(`/orders/${placed.id}/returns/${returnId}/cancel`, { method: 'POST', token: person.token, body: {} })).data.code, 'RETURN_CHANGED');
  const listed = await call('/orders/admin/returns?status=APPROVED', { token: viewerToken });
  assert.ok(listed.data.returns.some((item) => item.id === returnId && item.orderNumber === placed.orderNumber));
  assert.equal((await call('/orders/admin/returns?status=LOST', { token: adminToken })).status, 400);

  const lineFor = (item) => requested.data.returnRequest.lines.find((line) => line.orderItemId === item.id).id;
  const line = (item, received, restock, refundable) =>
    ({ returnLineId: lineFor(item), receivedQuantity: received, restockQuantity: restock, refundableQuantity: refundable });
  assert.equal((await receive(returnId, { merchantFaultConfirmed: false, lines: [line(mug, 1, 1, 1)] })).data.code, 'RETURN_QUANTITY_INVALID');
  assert.equal((await receive(returnId, { merchantFaultConfirmed: false, lines: [line(mug, 2, 1, 1), line(cream, 1, 0, 1)] })).data.code, 'RETURN_QUANTITY_INVALID');
  assert.equal((await receive(returnId, { merchantFaultConfirmed: false, lines: [line(mug, 1, 0, 1), line(cream, 0, 1, 0)] })).data.code, 'RETURN_QUANTITY_INVALID');
  const before = await Promise.all([stockOf(catalog.mug), stockOf(catalog.cream)]);
  const full = { merchantFaultConfirmed: false, note: 'Both unopened', lines: [line(mug, 1, 1, 1), line(cream, 1, 0, 1)] };
  const results = await Promise.all([receive(returnId, full), receive(returnId, full)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const afterStock = await Promise.all([stockOf(catalog.mug), stockOf(catalog.cream)]);
  assert.deepEqual([afterStock[0].quantity - before[0].quantity, afterStock[1].quantity - before[1].quantity], [1, 0]);
  const refunds = await prisma.refund.findMany({ where: { orderId: placed.id } });
  // (1000 + 1012.50) x 1.16 = 2334.50, rounded up; no delivery fee without a confirmed fault.
  assert.deepEqual(refunds.map((refund) => [refund.source, Number(refund.amount), refund.includesDeliveryFee, refund.status]),
    [['RETURN', 2335, false, 'REQUESTED']]);
  // Staff wording in the stored history is the staff's own (the demonstration has its own wording).
  const number = requested.data.returnRequest.number;
  const told = (await prisma.trackingEvent.findMany({ where: { orderId: placed.id, actorType: 'STAFF' } })).map((event) => event.description);
  for (const sentence of [`Return ${number} approved; staff will arrange the return.`, `Return ${number} received and inspected; refund of KES 2,335 requested.`,
    `Refund ${refunds[0].number} of KES 2,335 requested; no money has been sent yet.`]) assert.ok(told.includes(sentence), `${sentence} in ${told}`);
  const own = (await call(`/orders/${placed.id}`, { token: person.token })).data;
  assert.equal(own.returns[0].status, 'RECEIVED');
  assert.equal(own.returns[0].inspectionNote, 'Both unopened');
  assert.equal('restockQuantity' in own.returns[0].lines[0], false);
  assert.equal(own.paymentStatus, 'PAID');
});

test('a confirmed fault refunds the delivery fee once and confirmations settle the payment status', async () => {
  const person = await customer();
  const placed = await order(person, [[catalog.milk, 2]]);
  await deliver(placed.id);
  const milk = itemFor(placed, catalog.milk);
  const requested = await requestReturn(person, placed.id, { reason: 'DAMAGED', lines: [{ orderItemId: milk.id, quantity: 1 }] });
  const returnId = requested.data.returnRequest.id;
  await decide(returnId, { decision: 'APPROVE' });
  const lines = [{ returnLineId: requested.data.returnRequest.lines[0].id, receivedQuantity: 1, restockQuantity: 0, refundableQuantity: 1 }];
  assert.equal((await receive(returnId, { merchantFaultConfirmed: false, lines })).data.code, 'RETURN_REASON_NOT_ALLOWED');
  assert.equal((await receive(returnId, { merchantFaultConfirmed: true, note: 'Seal broken in transit', lines })).status, 200);
  const first = await prisma.refund.findFirstOrThrow({ where: { returnRequestId: returnId } });
  const second = await returnedRefund(person, placed, catalog.milk, { reason: 'FAULTY', faultConfirmed: true });
  // 150 x 1.16 = 174, plus the 200 delivery fee only on the first fault-confirmed refund.
  assert.deepEqual([first, second].map((refund) => [Number(refund.amount), refund.includesDeliveryFee]), [[374, true], [174, false]]);
  const settle = async (refund, reference) => {
    await refundAction(refund.id, 'approve', 'REQUESTED');
    await refundAction(refund.id, 'start', 'APPROVED');
    return refundAction(refund.id, 'confirm', 'PROCESSING', { providerReference: reference });
  };
  assert.equal((await settle(first, 'FAULT00001')).data.order.paymentStatus, 'PARTIALLY_REFUNDED');
  assert.equal((await settle(second, 'FAULT00002')).data.order.paymentStatus, 'REFUNDED');
  assert.equal(await prisma.notification.count({ where: { orderId: placed.id, type: 'REFUND_CONFIRMED', status: 'SENT' } }), 2);
});

test('refund states are truthful and only confirmation changes payment status and net sales', async () => {
  const person = await customer();
  const placed = await order(person, [[catalog.mug, 1]]);
  await deliver(placed.id);
  const refund = await returnedRefund(person, placed, catalog.mug);
  assert.equal(Number(refund.amount), 1160);
  for (const inherited of ['constructor', 'toString']) {
    assert.equal((await refundAction(refund.id, inherited, 'REQUESTED')).data.code, 'REFUND_ACTION_UNKNOWN');
  }
  // Net sales for orders placed this Nairobi year (the dashboard no longer reports an all-time total); these orders are new.
  const sales = async () => Math.round((await call('/admin/analytics/dashboard?period=year', { token: adminToken })).data.figures.netSales * 100);
  const salesBefore = await sales();
  assert.equal((await refundAction(refund.id, 'approve', 'REQUESTED', { amount: 1161 })).data.code, 'REFUND_AMOUNT_INVALID');
  assert.equal((await refundAction(refund.id, 'approve', 'REQUESTED', { amount: 1000 })).data.code, 'REFUND_REASON_REQUIRED');
  const approved = await refundAction(refund.id, 'approve', 'REQUESTED');
  assert.deepEqual([approved.data.refund.status, approved.data.order.paymentStatus], ['APPROVED', 'PAID']);
  assert.equal((await refundAction(refund.id, 'approve', 'REQUESTED')).data.code, 'REFUND_CHANGED');
  assert.equal(await sales(), salesBefore);
  await refundAction(refund.id, 'start', 'APPROVED');
  assert.equal((await refundAction(refund.id, 'confirm', 'PROCESSING', { providerReference: 'bad ref!!' })).data.code, 'REFUND_REFERENCE_INVALID');
  const confirmed = await refundAction(refund.id, 'confirm', 'PROCESSING', { providerReference: 'qa12bc34de' });
  assert.deepEqual([confirmed.data.refund.providerReference, confirmed.data.order.paymentStatus], ['QA12BC34DE', 'PARTIALLY_REFUNDED']);
  assert.equal(await sales(), salesBefore - 116_000);
  assert.equal(await prisma.notification.count({ where: { refundId: refund.id, type: 'REFUND_CONFIRMED', status: 'SENT' } }), 1);
  const mine = (await call(`/orders/${placed.id}`, { token: person.token })).data.refunds[0];
  assert.equal(mine.providerReference, 'QA12BC34DE');
  assert.ok(!('failureReason' in mine) && !('requestedByType' in mine) && !('paymentId' in mine));

  const other = await customer();
  const second = await order(other, [[catalog.mug, 1]]);
  await deliver(second.id);
  const duplicate = await returnedRefund(other, second, catalog.mug);
  await refundAction(duplicate.id, 'approve', 'REQUESTED');
  await refundAction(duplicate.id, 'start', 'APPROVED');
  assert.equal((await refundAction(duplicate.id, 'confirm', 'PROCESSING', { providerReference: 'QA12BC34DE' })).data.code, 'REFUND_REFERENCE_IN_USE');
  assert.equal((await refundAction(duplicate.id, 'unresolved', 'PROCESSING', { reason: 'Statement pending' })).data.refund.status, 'UNRESOLVED');
  assert.equal((await refundAction(duplicate.id, 'confirm', 'UNRESOLVED', { providerReference: 'QA99BC34DE' })).data.refund.status, 'CONFIRMED');
});

test('a failed refund keeps its balance reserved so a retry cannot over-refund the payment', async () => {
  const person = await customer();
  const placed = await order(person, [[catalog.mug, 1]]);
  await deliver(placed.id);
  const refund = await returnedRefund(person, placed, catalog.mug);
  await refundAction(refund.id, 'approve', 'REQUESTED');
  await refundAction(refund.id, 'start', 'APPROVED');
  assert.equal((await refundAction(refund.id, 'fail', 'PROCESSING')).data.code, 'REFUND_REASON_REQUIRED');
  assert.equal((await refundAction(refund.id, 'fail', 'PROCESSING', { reason: 'Recipient line inactive' })).data.refund.status, 'FAILED');
  const stored = await prisma.order.findUnique({ where: { id: placed.id } });
  // A later dispute puts the settled payment under review while the failed refund is unresolved.
  await prisma.mpesaPayment.update({ where: { id: stored.settledPaymentId }, data: { reviewCode: 'CONFLICTING_RESULT' } });
  const review = await call(`/orders/admin/payments/${stored.settledPaymentId}/refunds`, {
    method: 'POST', token: adminToken, body: { reason: 'Customer disputes the charge' },
  });
  assert.equal(review.status, 201, JSON.stringify(review.data));
  assert.equal((await refundAction(refund.id, 'retry', 'FAILED')).data.refund.status, 'APPROVED');
  const open = await prisma.refund.findMany({ where: { orderId: placed.id, status: { not: 'CANCELLED' } } });
  const committed = open.reduce((sum, item) => sum + Number(item.amount), 0);
  assert.ok(committed <= Number(stored.total), `refunds of ${committed} exceed the ${stored.total} received`);
});

test('public tracking shows fulfilment progress only, never refund details or staff notes', async () => {
  const person = await customer();
  const placed = await order(person, [[catalog.mug, 1]]);
  const note = 'Internal: suspected duplicate account';
  assert.equal((await act(placed.id, 'CANCEL', 'PENDING', { reason: note })).status, 200);
  const [refund] = await prisma.refund.findMany({ where: { orderId: placed.id } });
  await refundAction(refund.id, 'approve', 'REQUESTED');
  await refundAction(refund.id, 'start', 'APPROVED');
  await refundAction(refund.id, 'confirm', 'PROCESSING', { providerReference: 'TRACK12345' });
  const tracked = await call(`/orders/track/${placed.orderNumber}`);
  assert.equal(tracked.status, 200);
  const text = JSON.stringify(tracked.data);
  for (const secret of [note, refund.number, 'TRACK12345', 'KES', 'Staff portal']) assert.equal(text.includes(secret), false, secret);
  assert.deepEqual(tracked.data.trackingHistory.map((event) => event.status), ['CANCELLED', 'PENDING']);
  const own = (await call(`/orders/${placed.id}`, { token: person.token })).data;
  assert.equal(own.refunds[0].providerReference, 'TRACK12345');
});

test('cancelling a partly refunded order requests the remaining balance', async () => {
  const person = await customer();
  const placed = await order(person, [[catalog.mug, 1]]);
  const stored = await prisma.order.findUnique({ where: { id: placed.id } });
  await prisma.mpesaPayment.update({ where: { id: stored.settledPaymentId }, data: { reviewCode: 'CALLBACK_MISMATCH' } });
  const review = await call(`/orders/admin/payments/${stored.settledPaymentId}/refunds`, {
    method: 'POST', token: adminToken, body: { reason: 'Customer was overcharged' },
  });
  assert.equal(review.status, 201, JSON.stringify(review.data));
  const id = review.data.refund.id;
  await refundAction(id, 'approve', 'REQUESTED', { amount: 500, reason: 'Only the overcharge is owed' });
  await refundAction(id, 'start', 'APPROVED');
  const confirmed = await refundAction(id, 'confirm', 'PROCESSING', { providerReference: 'PART123456' });
  assert.equal(confirmed.data.order.paymentStatus, 'PARTIALLY_REFUNDED');
  const cancelled = await call(`/orders/${placed.id}/cancel`, { method: 'POST', token: person.token, body: { reason: 'No longer needed' } });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  assert.deepEqual(cancelled.data.refunds.filter((item) => item.source === 'CANCELLATION').map((item) => [item.status, item.amount]),
    [['REQUESTED', 860]]);
});

test('staff actions by ID cannot change orders hidden as demo data', async () => {
  const person = await customer();
  const placed = await order(person, [[catalog.mug, 2]]);
  await deliver(placed.id);
  const refund = await returnedRefund(person, placed, catalog.mug);
  const pending = await requestReturn(person, placed.id, { reason: 'FAULTY', lines: [{ orderItemId: itemFor(placed, catalog.mug).id, quantity: 1 }] });
  assert.equal(pending.status, 201, JSON.stringify(pending.data));
  const stored = await prisma.order.findUnique({ where: { id: placed.id } });
  await prisma.mpesaPayment.update({ where: { id: stored.settledPaymentId }, data: { reviewCode: 'CONFLICTING_RESULT' } });
  const email = await prisma.notification.findFirstOrThrow({ where: { orderId: placed.id, type: 'ORDER_RECEIVED' } });
  await prisma.notification.update({ where: { id: email.id }, data: { status: 'DEAD', attempts: MAX_NOTIFICATION_ATTEMPTS, lastErrorCode: 'MAIL_TIMEOUT' } });
  await prisma.order.update({ where: { id: placed.id }, data: { isDemo: true } });

  assert.equal((await refundAction(refund.id, 'approve', 'REQUESTED')).status, 404);
  assert.equal((await decide(pending.data.returnRequest.id, { decision: 'APPROVE' })).status, 404);
  assert.equal((await call(`/orders/admin/payments/${stored.settledPaymentId}/refunds`, {
    method: 'POST', token: adminToken, body: { reason: 'Hidden order' },
  })).status, 404);
  assert.equal((await call(`/admin/notifications/${email.id}/retry`, { method: 'POST', token: adminToken, body: {} })).status, 404);
  assert.equal((await prisma.refund.findUnique({ where: { id: refund.id } })).status, 'REQUESTED');
  assert.equal((await prisma.returnRequest.findUnique({ where: { id: pending.data.returnRequest.id } })).status, 'REQUESTED');
  assert.equal(await prisma.refund.count({ where: { orderId: placed.id } }), 1);
  assert.equal((await prisma.notification.findUnique({ where: { id: email.id } })).status, 'DEAD');
  const feed = (await call('/admin/attention', { token: adminToken })).data.items;
  assert.equal(feed.some((item) => item.orderId === placed.id), false);
});

test('a delivery that starts from a stale batch clock still holds a live lease', async () => {
  const person = await customer();
  const placed = await order(person, [[catalog.mug, 1]], { paid: false });
  const stored = await prisma.order.findUnique({ where: { id: placed.id } });
  const message = await enqueueNotification(prisma, { type: 'ORDER_RECEIVED', order: stored, dedupeKey: `stale-batch:${placed.id}` });
  await prisma.notification.update({ where: { id: message.id }, data: { nextAttemptAt: new Date(Date.now() - 300_000) } });
  let concurrent;
  sendHook = async () => {
    sendHook = null;
    concurrent = await deliverNotification(message.id);
  };
  // The batch selected this message about 200 seconds before reaching it.
  assert.equal(await deliverNotification(message.id, new Date(Date.now() - 200_000)), 'SENT');
  assert.equal(concurrent, null, 'a second worker must not claim a message that is still being sent');
  const row = await prisma.notification.findUnique({ where: { id: message.id } });
  assert.deepEqual([row.status, row.attempts], ['SENT', 1]);
});

test('staff can re-request money still owed after a refund is cancelled, never twice or beyond the balance', async () => {
  const person = await customer();
  const owed = (orderId, body, token = adminToken) => call(`/orders/admin/${orderId}/refunds`, { method: 'POST', token, body });
  const options = async (orderId) => (await call(`/orders/admin/${orderId}`, { token: adminToken })).data.refundRequestOptions;
  const placed = await order(person, [[catalog.mug, 1]]);
  assert.equal((await act(placed.id, 'CANCEL', 'PENDING', { reason: 'Out of stock' })).status, 200);
  const [first] = await prisma.refund.findMany({ where: { orderId: placed.id } });
  const body = { source: 'CANCELLATION', reason: 'Customer now wants the refund' };
  assert.deepEqual(await options(placed.id), []);
  assert.equal((await owed(placed.id, body)).data.code, 'REFUND_NOT_AVAILABLE');
  await refundAction(first.id, 'cancel', 'REQUESTED', { reason: 'Customer asked us to wait' });
  assert.deepEqual(await options(placed.id), [{ source: 'CANCELLATION', maxAmount: 1360 }]);
  assert.equal((await owed(placed.id, body, viewerToken)).status, 403);
  assert.equal((await owed(placed.id, { source: 'CANCELLATION' })).status, 400);
  assert.equal((await owed(placed.id, { ...body, returnId: first.id })).status, 400);
  const results = await Promise.all([1, 2].map(() => owed(placed.id, body)));
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  const created = results.find((result) => result.status === 201).data;
  assert.deepEqual([created.refund.source, created.refund.status, created.refund.amount], ['CANCELLATION', 'REQUESTED', 1360]);
  assert.deepEqual(created.order.refundRequestOptions, []);
  // An active refund approved for less than the balance still covers the cancellation; it is not requested twice.
  await refundAction(created.refund.id, 'approve', 'REQUESTED', { amount: 1000, reason: 'Agreed deduction for opened packaging' });
  assert.deepEqual(await options(placed.id), []);
  assert.equal((await owed(placed.id, body)).data.code, 'REFUND_NOT_AVAILABLE');

  // A cancelled paid order that never had a refund record, such as after migration recovery.
  const legacy = await order(person, [[catalog.mug, 1]]);
  await prisma.order.update({ where: { id: legacy.id }, data: { status: 'CANCELLED' } });
  assert.deepEqual(await options(legacy.id), [{ source: 'CANCELLATION', maxAmount: 1360 }]);
  assert.equal((await owed(legacy.id, body)).status, 201);

  // A received return whose refund was withdrawn by mistake.
  const delivered = await order(person, [[catalog.milk, 2]]);
  await deliver(delivered.id);
  const returned = await returnedRefund(person, delivered, catalog.milk, { reason: 'DAMAGED', faultConfirmed: true });
  assert.deepEqual([Number(returned.amount), returned.includesDeliveryFee], [374, true]);
  await refundAction(returned.id, 'cancel', 'REQUESTED', { reason: 'Recorded against the wrong order' });
  const [option] = await options(delivered.id);
  assert.deepEqual([option.source, option.returnId, option.maxAmount], ['RETURN', returned.returnRequestId, 548]);
  assert.match(option.returnNumber, /^RMA-/);
  assert.equal((await owed(delivered.id, { source: 'RETURN', reason: 'Missing return' })).status, 400);
  const returnBody = { source: 'RETURN', returnId: returned.returnRequestId, reason: 'Withdrawn by mistake' };
  const again = await owed(delivered.id, returnBody);
  assert.equal(again.status, 201, JSON.stringify(again.data));
  assert.deepEqual([again.data.refund.amount, again.data.refund.includesDeliveryFee, again.data.refund.returnRequestId], [374, true, returned.returnRequestId]);
  assert.equal((await owed(delivered.id, returnBody)).data.code, 'REFUND_NOT_AVAILABLE');
  assert.equal(await prisma.refund.count({ where: { returnRequestId: returned.returnRequestId } }), 2);
});

test('notifications are deduplicated, retried with backoff, leased and retryable only by administrators', async () => {
  const person = await customer();
  const placed = await order(person, [[catalog.mug, 1]], { paid: false });
  const stored = await prisma.order.findUnique({ where: { id: placed.id } });
  const enqueue = (dedupeKey, target = stored) => enqueueNotification(prisma, { type: 'ORDER_RECEIVED', order: target, dedupeKey });
  const first = await enqueue(`dedupe:${placed.id}`);
  assert.equal((await enqueue(`dedupe:${placed.id}`)).id, first.id);
  assert.equal(await enqueue(`demo:${placed.id}`, { ...stored, isDemo: true }), null);

  failMail = Object.assign(new Error('provider detail'), { code: 'MAIL_TIMEOUT' });
  const start = new Date();
  assert.equal(await deliverNotification(first.id, start), 'FAILED');
  let row = await prisma.notification.findUnique({ where: { id: first.id } });
  assert.deepEqual([row.status, row.attempts, row.lastErrorCode], ['FAILED', 1, 'MAIL_TIMEOUT']);
  assert.ok(row.nextAttemptAt.getTime() >= start.getTime() + 59_000);
  failMail = null;
  assert.equal(await deliverNotification(first.id, start), null);
  await prisma.notification.update({ where: { id: first.id }, data: { status: 'SENDING', leaseExpiresAt: new Date(start.getTime() + 60_000) } });
  assert.equal(await deliverNotification(first.id, new Date(start.getTime() + 30_000)), null, 'an active lease blocks a second sender');
  assert.equal(await deliverNotification(first.id, new Date(start.getTime() + 180_000)), 'SENT');
  row = await prisma.notification.findUnique({ where: { id: first.id } });
  assert.deepEqual([row.status, row.attempts, row.lastErrorCode], ['SENT', 2, null]);

  const dead = await enqueue(`dead:${placed.id}`);
  await prisma.notification.update({ where: { id: dead.id }, data: { status: 'FAILED', attempts: MAX_NOTIFICATION_ATTEMPTS - 1 } });
  failMail = Object.assign(new Error('provider detail'), { code: 'SMTP_SECRET_DETAIL' });
  assert.equal(await deliverNotification(dead.id), 'DEAD');
  assert.equal((await prisma.notification.findUnique({ where: { id: dead.id } })).lastErrorCode, 'MAIL_PROVIDER_ERROR');
  failMail = null;
  const retry = (id, token = adminToken) => call(`/admin/notifications/${id}/retry`, { method: 'POST', token, body: {} });
  assert.equal((await retry(dead.id, viewerToken)).status, 403);
  assert.equal((await retry(first.id)).data.code, 'NOTIFICATION_NOT_RETRYABLE');
  const retried = await retry(dead.id);
  assert.deepEqual([retried.status, retried.data.status], [200, 'SENT']);
  assert.equal('recipient' in retried.data, false);
});

test('the attention feed derives open work and keeps read state per staff member', async () => {
  const person = await customer();
  const placed = await order(person, [[catalog.mug, 1]]);
  const feed = async (token = adminToken) => (await call('/admin/attention', { token })).data.items.filter((item) => item.orderId === placed.id);
  const [awaiting] = await feed();
  assert.deepEqual([awaiting.type, awaiting.read], ['ORDER_AWAITING_FULFILMENT', false]);
  assert.equal((await call('/admin/attention/read', { method: 'POST', token: adminToken, body: { keys: [awaiting.key] } })).status, 200);
  assert.equal((await feed())[0].read, true);
  assert.equal((await feed(viewerToken))[0].read, false);
  assert.equal((await call('/admin/attention', { token: person.token })).status, 401);
  await deliver(placed.id);
  assert.deepEqual(await feed(), []);
  const requested = await requestReturn(person, placed.id, { reason: 'FAULTY', lines: [{ orderItemId: itemFor(placed, catalog.mug).id, quantity: 1 }] });
  const [decision] = await feed();
  assert.deepEqual([decision.type, decision.read, decision.entityId], ['RETURN_AWAITING_DECISION', false, requested.data.returnRequest.id]);
  await decide(requested.data.returnRequest.id, { decision: 'APPROVE' });
  assert.deepEqual((await feed()).map((item) => item.type), ['RETURN_AWAITING_RECEIPT']);
});

test('scheduled maintenance is disabled without a secret and requires the exact bearer token', async (t) => {
  t.after(() => { process.env.CRON_SECRET = ''; });
  const run = (authorization) => fetch(`${base}/internal/maintenance`, { headers: authorization ? { Authorization: authorization } : {} });
  const disabled = await run('Bearer anything');
  assert.deepEqual([disabled.status, (await disabled.json()).code], [503, 'MAINTENANCE_DISABLED']);
  process.env.CRON_SECRET = 'test-only-maintenance-secret-0123456789';
  assert.equal((await run()).status, 401);
  assert.equal((await run('Bearer test-only-maintenance-secret-0123456780')).status, 401);
  const allowed = await run(`Bearer ${process.env.CRON_SECRET}`);
  assert.equal(allowed.status, 200);
  const body = await allowed.json();
  assert.deepEqual(Object.keys(body.results).sort(), ['notifications', 'payments', 'reservations', 'sampleOrders']);
  assert.equal(JSON.stringify(body).includes('@example.test'), false);
});
