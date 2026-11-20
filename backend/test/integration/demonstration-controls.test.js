import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, mock, test } from 'node:test';
import prisma from '../../src/config/database.js';
import { generateToken } from '../../src/config/auth.js';
import { DEFAULT_CHECKOUT_POLICY } from '../../src/config/checkoutPolicy.js';
import { startServer } from '../../src/server.js';
import { commitOrderReservation } from '../../src/services/inventoryService.js';
import { mailer } from '../../src/services/notificationService.js';

/*
 * P8.6 §3 on a real database: the visitor plays the store's part for their own paid sample order. Each control binds
 * the caller, the order in the address, sample status and the switch, and child records to that order; bodies can
 * set nothing but the action and the status the visitor saw. Refunds of demonstration payments move no money.
 */
let base, close, adminToken, catalog, sequence = 0, receipts = 0;

before(async () => {
  process.env.ENABLE_ORDER_RESERVATIONS = 'true';
  process.env.DEMONSTRATION_STORE = 'true';
  // Sample-order emails are on, so the absence of refund emails is the demonstration path's own doing.
  process.env.DEMO_NOTIFICATIONS_ENABLED = 'true';
  mock.method(mailer, 'send', async () => ({ provider: 'test', messageId: `test-${randomUUID()}` }));
  const admin = await prisma.admin.create({ data: {
    email: 'demonstration-controls@example.test', username: 'demonstration-controls', password: 'fixture-not-for-login', role: 'ADMIN',
  } });
  adminToken = generateToken({ adminId: admin.id });
  catalog = await createCatalog();
  const started = await startServer({ host: '127.0.0.1', port: 0 });
  close = started.close;
  base = `http://127.0.0.1:${started.server.address().port}/api`;
});
beforeEach(() => { process.env.DEMONSTRATION_STORE = 'true'; delete process.env.CHECKOUT_POLICY_JSON; });
after(async () => { process.env.DEMONSTRATION_STORE = 'false'; mock.restoreAll(); await close?.(); });

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
  const root = await prisma.category.create({ data: { name: 'Controls', slug: 'controls' } });
  const child = (slug, returnRule) => prisma.category.create({ data: { name: slug, slug, parentId: root.id, returnRule } });
  const dairy = await child('controls-dairy', 'FAULT_ONLY');
  const product = (slug, category, price, isDemo = true) => prisma.product.create({
    data: {
      name: slug, slug, description: 'Demonstration controls fixture', price, isActive: true, isDemo, category: { connect: { id: category.id } },
      variants: { create: { sku: slug.toUpperCase(), attributes: { size: 'One' }, stock: { create: { quantity: 1000, minThreshold: 0, status: 'IN_STOCK' } } } },
    },
    include: { variants: true },
  });
  const [mug, milk, liveMug] = await Promise.all([
    product('controls-mug', root, 1000), product('controls-milk', dairy, 150), product('controls-live-mug', root, 1000, false),
  ]);
  return { mug, milk, liveMug };
}

async function customer() {
  const tag = `controls-${++sequence}`;
  const user = await prisma.user.create({
    data: {
      email: `${tag}@example.test`, password: 'fixture-not-for-login', firstName: 'Controls', lastName: tag,
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

/** Places a pending order for `lines` ([product, quantity] pairs). */
async function place(person, lines, { deliveryMethod = 'STANDARD' } = {}) {
  if (deliveryMethod === 'STORE_PICKUP') process.env.CHECKOUT_POLICY_JSON = PICKUP_POLICY;
  try {
    const quoted = await call('/orders/quotes', { method: 'POST', token: person.token, body: {
      items: lines.map(([product, quantity]) => ({ productId: product.id, variantId: product.variants[0].id, quantity })),
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

/** Places a sample order and pays it with a demonstration payment; returns the customer's order view. */
async function paidSample(person, lines, options) {
  const placed = await place(person, lines, options);
  const paid = await call(`/orders/${placed.id}/demonstration-payment`, { method: 'POST', token: person.token, body: {} });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  return paid.data;
}

/** Settles an order as verified M-Pesa money would, without contacting a provider. */
async function payByMpesa(orderId) {
  await prisma.$transaction(async (db) => {
    await commitOrderReservation(db, orderId);
    const current = await db.order.findUnique({ where: { id: orderId } });
    const id = String(++receipts).padStart(7, '0');
    const payment = await db.mpesaPayment.create({ data: {
      orderId, phone: '254700000000', amount: current.total, status: 'SUCCEEDED', confirmedAt: new Date(),
      receiptNumber: `CTL${id}`, environment: 'sandbox', idempotencyKey: randomUUID(), requestHash: 'fixture',
      merchantIdentity: 'fixture-merchant', merchantShortcode: '174379', callbackKeyHash: '0'.repeat(64), reference: `CTL-${id}`,
    } });
    await db.order.update({ where: { id: orderId }, data: { paymentStatus: 'PAID', settledPaymentId: payment.id } });
  });
}

const act = (person, orderId, action, expectedStatus, extra = {}) =>
  call(`/orders/${orderId}/demonstration-actions`, { method: 'POST', token: person.token, body: { action, expectedStatus, ...extra } });
const approve = (person, orderId, returnId, expectedStatus = 'REQUESTED', extra = {}) =>
  call(`/orders/${orderId}/returns/${returnId}/demonstration-approve`, { method: 'POST', token: person.token, body: { expectedStatus, ...extra } });
const receive = (person, orderId, returnId, expectedStatus = 'APPROVED', extra = {}) =>
  call(`/orders/${orderId}/returns/${returnId}/demonstration-receive`, { method: 'POST', token: person.token, body: { expectedStatus, ...extra } });
const complete = (person, orderId, refundId, expectedStatus, extra = {}) =>
  call(`/orders/${orderId}/refunds/${refundId}/demonstration-complete`, { method: 'POST', token: person.token, body: { expectedStatus, ...extra } });
const requestReturn = (person, orderId, body) =>
  call(`/orders/${orderId}/returns`, { method: 'POST', token: person.token, key: randomUUID(), body });
const refundAction = (refundId, action, expectedStatus, extra = {}) =>
  call(`/orders/admin/refunds/${refundId}/${action}`, { method: 'POST', token: adminToken, body: { expectedStatus, ...extra } });
const stockOf = async (product) => (await prisma.stock.findUnique({ where: { variantId: product.variants[0].id } })).quantity;
const itemFor = (order, product) => order.items.find((item) => item.productId === product.id);
const codeOf = (result) => [result.status, result.data.code];
/** The last email sent with this subject (mail is replaced, so nothing leaves the process). */
const sentEmail = (subject) => mailer.send.mock.calls.map((entry) => entry.arguments[0]).findLast((message) => message.subject === subject);
const lastEvent = async (orderId) => prisma.trackingEvent.findFirst({ where: { orderId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });

/** Plays dispatch and delivery for a paid sample order with standard delivery. */
async function deliver(person, orderId) {
  for (const [action, expected] of [['START_PROCESSING', 'PENDING'], ['DISPATCH', 'PROCESSING'], ['CONFIRM_DELIVERY', 'SHIPPED']]) {
    const result = await act(person, orderId, action, expected);
    assert.equal(result.status, 200, `${action}: ${JSON.stringify(result.data)}`);
  }
}

/** A delivered, demonstration-paid order with one return requested for one unit of `product`. */
async function requestedReturn(person, product, reason = 'CHANGED_MIND', extra = {}) {
  const order = await paidSample(person, [[product, 2]]);
  await deliver(person, order.id);
  const requested = await requestReturn(person, order.id, { reason, lines: [{ orderItemId: itemFor(order, product).id, quantity: 1 }], ...extra });
  assert.equal(requested.status, 201, JSON.stringify(requested.data));
  return { order, returnRequest: requested.data.returnRequest };
}

test('a visitor plays each fulfilment step for their own paid sample order, exactly as staff could, as the demonstration', async () => {
  const person = await customer();
  const unpaid = await place(person, [[catalog.mug, 1]]);
  assert.deepEqual((await call(`/orders/${unpaid.id}`, { token: person.token })).data.demonstrationActions, []);
  assert.deepEqual(codeOf(await act(person, unpaid.id, 'START_PROCESSING', 'PENDING')), [409, 'ACTION_NOT_ALLOWED']);

  const order = await paidSample(person, [[catalog.mug, 1]]);
  assert.deepEqual(order.demonstrationActions, [{ action: 'START_PROCESSING', expectedStatus: 'PENDING' }]);
  for (const action of ['CANCEL', 'REFUND', 'constructor']) assert.equal((await act(person, order.id, action, 'PENDING')).status, 400, action);
  assert.equal((await act(person, order.id, 'START_PROCESSING')).status, 400);

  const started = await act(person, order.id, 'START_PROCESSING', 'PENDING', { actorId: 'someone-else', reason: 'Injected', trackingNumber: 'T-1' });
  assert.equal(started.status, 200, JSON.stringify(started.data));
  assert.deepEqual([started.data.status, Boolean(started.data.fulfilment.processingAt)], ['PROCESSING', true]);
  assert.deepEqual(started.data.demonstrationActions, [{ action: 'DISPATCH', expectedStatus: 'PROCESSING' }]);
  const recorded = await lastEvent(order.id);
  assert.deepEqual([recorded.status, recorded.description, recorded.location, recorded.actorType, recorded.actorId, recorded.reason],
    ['PROCESSING', 'Order accepted and being prepared', 'Demonstration', 'DEMONSTRATION', person.id, null]);
  assert.deepEqual(started.data.trackingHistory[0].actorType, 'DEMONSTRATION');
  assert.equal('actorId' in started.data.trackingHistory[0], false);

  assert.deepEqual(codeOf(await act(person, order.id, 'DISPATCH', 'PENDING')), [409, 'ORDER_CHANGED']);
  assert.deepEqual(codeOf(await act(person, order.id, 'CONFIRM_DELIVERY', 'PROCESSING')), [409, 'ACTION_NOT_ALLOWED']);
  const dispatches = await Promise.all([1, 2].map(() => act(person, order.id, 'DISPATCH', 'PROCESSING', { trackingNumber: 'FORGED-1' })));
  assert.deepEqual(dispatches.map((result) => result.status).sort(), [200, 409]);
  assert.equal(await prisma.trackingEvent.count({ where: { orderId: order.id, status: 'SHIPPED' } }), 1);
  assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).trackingNumber, null);

  const delivered = await act(person, order.id, 'CONFIRM_DELIVERY', 'SHIPPED');
  assert.deepEqual([delivered.data.status, Boolean(delivered.data.fulfilment.deliveredAt)], ['DELIVERED', true]);
  assert.deepEqual(delivered.data.demonstrationActions, []);
  assert.deepEqual(delivered.data.customerActions, ['REQUEST_RETURN']);

  // Pickup orders step through ready-for-pickup and collection instead.
  const pickup = await paidSample(person, [[catalog.mug, 1]], { deliveryMethod: 'STORE_PICKUP' });
  assert.equal((await act(person, pickup.id, 'START_PROCESSING', 'PENDING')).status, 200);
  assert.deepEqual(codeOf(await act(person, pickup.id, 'DISPATCH', 'PROCESSING')), [409, 'ACTION_NOT_ALLOWED']);
  assert.equal((await act(person, pickup.id, 'MARK_READY_FOR_PICKUP', 'PROCESSING')).status, 200);
  const collected = await act(person, pickup.id, 'CONFIRM_PICKUP', 'READY_FOR_PICKUP');
  assert.deepEqual([collected.data.status, Boolean(collected.data.fulfilment.pickedUpAt)], ['DELIVERED', true]);

  // Staff steps on sample orders are still recorded as the staff portal's.
  const staffed = await paidSample(person, [[catalog.mug, 1]]);
  const staffStep = await call(`/orders/admin/${staffed.id}/actions`, { method: 'POST', token: adminToken, body: { action: 'START_PROCESSING', expectedStatus: 'PENDING' } });
  assert.equal(staffStep.status, 200, JSON.stringify(staffStep.data));
  const staffEvent = await lastEvent(staffed.id);
  assert.deepEqual([staffEvent.location, staffEvent.actorType], ['Staff portal', 'STAFF']);
  assert.equal('demonstrationActions' in staffStep.data, false);
});

test('controls bind the caller, the order, sample status, the switch and each child record; anything else is not found', async () => {
  const [owner, stranger] = await Promise.all([customer(), customer()]);
  const { order, returnRequest } = await requestedReturn(owner, catalog.mug);
  const other = await requestedReturn(stranger, catalog.mug);
  // The stranger's return is received, so its refund exists too.
  assert.equal((await approve(stranger, other.order.id, other.returnRequest.id)).status, 200);
  assert.equal((await receive(stranger, other.order.id, other.returnRequest.id)).status, 200);
  const otherRefund = await prisma.refund.findFirstOrThrow({ where: { orderId: other.order.id } });
  const second = await requestedReturn(owner, catalog.mug);

  const notFound = async (result, code) => assert.deepEqual(codeOf(result), [404, code]);
  await notFound(await act(stranger, order.id, 'START_PROCESSING', 'DELIVERED'), 'ORDER_NOT_FOUND');
  await notFound(await approve(stranger, order.id, returnRequest.id), 'RETURN_NOT_FOUND');
  await notFound(await approve(owner, order.id, other.returnRequest.id), 'RETURN_NOT_FOUND');
  await notFound(await approve(owner, order.id, second.returnRequest.id), 'RETURN_NOT_FOUND');
  await notFound(await receive(owner, order.id, other.returnRequest.id, 'RECEIVED'), 'RETURN_NOT_FOUND');
  await notFound(await complete(owner, order.id, otherRefund.id, 'REQUESTED'), 'REFUND_NOT_FOUND');
  await notFound(await complete(owner, other.order.id, otherRefund.id, 'REQUESTED'), 'REFUND_NOT_FOUND');
  assert.equal((await call(`/orders/${order.id}/demonstration-actions`, { method: 'POST', body: { action: 'START_PROCESSING', expectedStatus: 'PENDING' } })).status, 401);

  // Switched off, even the owner's own sample order is not found.
  process.env.DEMONSTRATION_STORE = 'false';
  await notFound(await approve(owner, order.id, returnRequest.id), 'RETURN_NOT_FOUND');
  await notFound(await act(owner, second.order.id, 'START_PROCESSING', 'PENDING'), 'ORDER_NOT_FOUND');
  await notFound(await complete(stranger, other.order.id, otherRefund.id, 'REQUESTED'), 'REFUND_NOT_FOUND');
  process.env.DEMONSTRATION_STORE = 'true';

  // A live order, even the caller's own, has no demonstration controls, nor do its return and refund.
  process.env.DEMONSTRATION_STORE = 'false';
  const live = await place(owner, [[catalog.liveMug, 1]]);
  await payByMpesa(live.id);
  for (const [action, expected] of [['START_PROCESSING', 'PENDING'], ['DISPATCH', 'PROCESSING'], ['CONFIRM_DELIVERY', 'SHIPPED']]) {
    assert.equal((await call(`/orders/admin/${live.id}/actions`, { method: 'POST', token: adminToken, body: { action, expectedStatus: expected } })).status, 200);
  }
  const liveReturn = await requestReturn(owner, live.id, { reason: 'CHANGED_MIND', lines: [{ orderItemId: itemFor(live, catalog.liveMug).id, quantity: 1 }] });
  assert.equal(liveReturn.status, 201, JSON.stringify(liveReturn.data));
  process.env.DEMONSTRATION_STORE = 'true';
  await notFound(await act(owner, live.id, 'START_PROCESSING', 'DELIVERED'), 'ORDER_NOT_FOUND');
  await notFound(await approve(owner, live.id, liveReturn.data.returnRequest.id), 'RETURN_NOT_FOUND');
  process.env.DEMONSTRATION_STORE = 'false';
  await call(`/orders/admin/returns/${liveReturn.data.returnRequest.id}/decision`, { method: 'POST', token: adminToken, body: { decision: 'APPROVE', expectedStatus: 'REQUESTED' } });
  process.env.DEMONSTRATION_STORE = 'true';
  await notFound(await receive(owner, live.id, liveReturn.data.returnRequest.id), 'RETURN_NOT_FOUND');

  // Nothing changed for any refused request.
  const [ownReturn, strangerReturn, liveState] = await Promise.all([
    prisma.returnRequest.findUnique({ where: { id: returnRequest.id } }),
    prisma.returnRequest.findUnique({ where: { id: other.returnRequest.id } }),
    prisma.returnRequest.findUnique({ where: { id: liveReturn.data.returnRequest.id } }),
  ]);
  assert.deepEqual([ownReturn.status, strangerReturn.status, liveState.status], ['REQUESTED', 'RECEIVED', 'APPROVED']);
  assert.equal((await prisma.refund.findUnique({ where: { id: otherRefund.id } })).status, 'REQUESTED');
  assert.equal((await prisma.order.findUnique({ where: { id: live.id } })).status, 'DELIVERED');
});

test('an open payment review blocks the order steps until it is settled', async () => {
  const person = await customer();
  const order = await paidSample(person, [[catalog.mug, 1]]);
  // Money M-Pesa reported for an order that was already paid by demonstration: held for review.
  await prisma.mpesaPayment.create({ data: {
    orderId: order.id, phone: '254700000000', amount: order.total, status: 'REVIEW', reviewCode: 'EXTRA_PAYMENT', confirmedAt: new Date(),
    receiptNumber: 'CTLREVIEW1', environment: 'sandbox', idempotencyKey: randomUUID(), requestHash: 'fixture',
    merchantIdentity: 'fixture-merchant', merchantShortcode: '174379', callbackKeyHash: '0'.repeat(64), reference: 'CTL-REVIEW-1',
  } });
  const view = (await call(`/orders/${order.id}`, { token: person.token })).data;
  assert.deepEqual(view.demonstrationActions, []);
  assert.deepEqual(codeOf(await act(person, order.id, 'START_PROCESSING', 'PENDING')), [409, 'PAYMENT_REVIEW_REQUIRED']);
  assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).status, 'PENDING');
});

test('the visitor approves and receives their own return; the server derives receipt, restock, fault and refund', async () => {
  const person = await customer();
  const { order, returnRequest } = await requestedReturn(person, catalog.mug);
  assert.deepEqual((await call(`/orders/${order.id}`, { token: person.token })).data.demonstrationActions,
    [{ action: 'APPROVE', returnId: returnRequest.id, expectedStatus: 'REQUESTED' }]);
  assert.deepEqual(codeOf(await receive(person, order.id, returnRequest.id)), [409, 'RETURN_CHANGED']);
  assert.deepEqual(codeOf(await approve(person, order.id, returnRequest.id, 'APPROVED')), [409, 'RETURN_CHANGED']);
  const approved = await approve(person, order.id, returnRequest.id, 'REQUESTED', { decision: 'REJECT', note: 'Injected note' });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.deepEqual([approved.data.returns[0].status, approved.data.returns[0].decisionNote], ['APPROVED', null]);
  assert.deepEqual(approved.data.demonstrationActions, [{ action: 'RECEIVE', returnId: returnRequest.id, expectedStatus: 'APPROVED' }]);
  assert.deepEqual(codeOf(await approve(person, order.id, returnRequest.id)), [409, 'RETURN_CHANGED']);
  const decided = await prisma.returnRequest.findUnique({ where: { id: returnRequest.id } });
  assert.equal(decided.decidedById, person.id);
  const decision = await lastEvent(order.id);
  assert.deepEqual([decision.description, decision.location, decision.actorType, decision.actorId],
    [`Return ${returnRequest.number} approved in the demonstration.`, 'Demonstration', 'DEMONSTRATION', person.id]);
  assert.equal(await prisma.notification.count({ where: { returnRequestId: returnRequest.id, type: 'RETURN_APPROVED' } }), 1);
  // The development-only email says what the demonstration did, as the order page does.
  const email = sentEmail(`Return request ${returnRequest.number} approved - order ${order.orderNumber}`);
  assert.match(email.text, /has been approved in the demonstration\./);
  assert.doesNotMatch(email.text, /Our staff/);
});

test('receipt follows the return reason: faulty or damaged items are not restocked, store faults refund the delivery fee', async () => {
  // reason → [restocked units, fault confirmed, refund]: one unit of 1000 plus 16% VAT, plus the 200 fee on a store fault.
  const cases = {
    CHANGED_MIND: [catalog.mug, 1, false, 1160, false],
    OTHER: [catalog.mug, 1, false, 1160, false],
    WRONG_ITEM: [catalog.mug, 1, true, 1360, true],
    FAULTY: [catalog.milk, 0, true, 374, true],
    DAMAGED: [catalog.milk, 0, true, 374, true],
  };
  for (const [reason, [product, restocked, fault, amount, includesFee]] of Object.entries(cases)) {
    const person = await customer();
    const { order, returnRequest } = await requestedReturn(person, product, reason);
    assert.equal((await approve(person, order.id, returnRequest.id)).status, 200, reason);
    const before = await stockOf(product);
    const forged = { merchantFaultConfirmed: !fault, note: 'Injected', lines: [{ returnLineId: returnRequest.lines[0].id, receivedQuantity: 0, restockQuantity: 0, refundableQuantity: 0 }] };
    const received = await receive(person, order.id, returnRequest.id, 'APPROVED', forged);
    assert.equal(received.status, 200, `${reason}: ${JSON.stringify(received.data)}`);
    const stored = await prisma.returnRequest.findUnique({ where: { id: returnRequest.id }, include: { lines: true } });
    assert.deepEqual([stored.status, stored.merchantFaultConfirmed, stored.inspectionNote, stored.receivedById], ['RECEIVED', fault, null, person.id], reason);
    assert.deepEqual(stored.lines.map((line) => [line.receivedQuantity, line.restockQuantity, line.refundableQuantity]), [[1, restocked, 1]], reason);
    assert.equal(await stockOf(product) - before, restocked, reason);
    const refunds = await prisma.refund.findMany({ where: { orderId: order.id } });
    assert.deepEqual(refunds.map((refund) => [refund.source, refund.method, Number(refund.amount), refund.includesDeliveryFee, refund.paymentId, refund.status]),
      [['RETURN', 'DEMONSTRATION', amount, includesFee, null, 'REQUESTED']], reason);
    // The stored history says what the demonstration did; nobody inspected anything and no money will move.
    const told = (await prisma.trackingEvent.findMany({ where: { orderId: order.id, actorType: 'DEMONSTRATION' } })).map((event) => event.description);
    const kes = `KES ${amount.toLocaleString('en-KE')}`;
    assert.ok(told.includes(`Return ${returnRequest.number} marked as received in the demonstration; refund of ${kes} requested.`), `${reason}: ${told}`);
    assert.ok(told.includes(`Demonstration refund ${refunds[0].number} of ${kes} requested; no money will be sent.`), `${reason}: ${told}`);
    assert.deepEqual(received.data.demonstrationActions, [{ action: 'COMPLETE_REFUND', refundId: refunds[0].id, expectedStatus: 'REQUESTED' }], reason);
    assert.deepEqual(codeOf(await receive(person, order.id, returnRequest.id)), [409, 'RETURN_CHANGED'], reason);
  }
});

test('a demonstration refund: staff may only cancel it, and the visitor records it once without moving money', async () => {
  const dashboard = async () => (await call('/admin/analytics/dashboard?period=year', { token: adminToken })).data.figures;
  const person = await customer();
  const { order, returnRequest } = await requestedReturn(person, catalog.mug);
  await approve(person, order.id, returnRequest.id);
  await receive(person, order.id, returnRequest.id);
  const refund = await prisma.refund.findFirstOrThrow({ where: { orderId: order.id } });
  const staffView = (await call(`/orders/admin/${order.id}`, { token: adminToken })).data;
  assert.deepEqual(staffView.refunds.map((item) => [item.method, item.allowedActions]), [['DEMONSTRATION', ['cancel']]]);
  // Each money step is refused from the state where it would otherwise be allowed.
  for (const [action, status, extra] of [['approve', 'REQUESTED', {}], ['start', 'APPROVED', {}], ['confirm', 'PROCESSING', { providerReference: 'FAKEREF001' }],
    ['fail', 'PROCESSING', { reason: 'Not sent' }], ['unresolved', 'PROCESSING', { reason: 'Unclear' }], ['retry', 'FAILED', {}]]) {
    await prisma.refund.update({ where: { id: refund.id }, data: { status } });
    assert.deepEqual(codeOf(await refundAction(refund.id, action, status, extra)), [409, 'REFUND_ACTION_NOT_ALLOWED'], action);
    assert.equal((await prisma.refund.findUnique({ where: { id: refund.id } })).status, status, action);
  }
  await prisma.refund.update({ where: { id: refund.id }, data: { status: 'REQUESTED' } });
  assert.equal(await prisma.trackingEvent.count({ where: { orderId: order.id, location: 'Staff portal' } }), 0);

  const figures = await dashboard();
  assert.deepEqual(codeOf(await complete(person, order.id, refund.id, 'APPROVED')), [409, 'REFUND_CHANGED']);
  const done = await complete(person, order.id, refund.id, 'REQUESTED', { providerReference: 'FAKEREF002', amount: 1, actorId: 'someone-else' });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  const confirmed = await prisma.refund.findUnique({ where: { id: refund.id } });
  assert.deepEqual([confirmed.status, confirmed.providerReference, Number(confirmed.amount), confirmed.method], ['CONFIRMED', null, 1160, 'DEMONSTRATION']);
  assert.deepEqual([confirmed.approvedById, confirmed.processingById, confirmed.confirmedById], [person.id, person.id, person.id]);
  assert.ok(confirmed.approvedAt && confirmed.processingAt && confirmed.confirmedAt);
  assert.deepEqual([done.data.paymentStatus, done.data.refunds[0].status, done.data.refunds[0].providerReference], ['PARTIALLY_REFUNDED', 'CONFIRMED', null]);
  assert.deepEqual(done.data.demonstrationActions, []);
  const event = await lastEvent(order.id);
  assert.deepEqual([event.description, event.location, event.actorType, event.actorId],
    [`Demonstration refund ${refund.number} of KES 1,160 recorded; no money was sent.`, 'Demonstration', 'DEMONSTRATION', person.id]);
  assert.equal(await prisma.notification.count({ where: { refundId: refund.id, type: 'REFUND_CONFIRMED' } }), 0);
  assert.deepEqual(await dashboard(), figures);
  assert.deepEqual(codeOf(await complete(person, order.id, refund.id, 'CONFIRMED')), [409, 'REFUND_ACTION_NOT_ALLOWED']);
  assert.equal(await prisma.trackingEvent.count({ where: { orderId: order.id, description: { endsWith: 'recorded; no money was sent.' } } }), 1);

  // Staff can still withdraw a demonstration refund; what is still owed is then requested again as a demonstration refund.
  const again = await paidSample(person, [[catalog.mug, 1]]);
  const [owed] = (await call(`/orders/${again.id}/cancel`, { method: 'POST', token: person.token, body: {} })).data.refunds;
  const withdrawn = await refundAction(owed.id, 'cancel', 'REQUESTED', { reason: 'Recorded twice' });
  assert.deepEqual([withdrawn.status, withdrawn.data.refund.status], [200, 'CANCELLED']);
  const reopened = await call(`/orders/admin/${again.id}/refunds`, { method: 'POST', token: adminToken, body: { source: 'CANCELLATION', reason: 'Still owed' } });
  assert.deepEqual([reopened.status, reopened.data.refund.method, reopened.data.refund.allowedActions], [201, 'DEMONSTRATION', ['cancel']]);
});

test('completion runs only the remaining steps, keeps an approved lower amount, and refuses finished or M-Pesa refunds', async () => {
  const person = await customer();
  const order = await paidSample(person, [[catalog.mug, 1]]);
  const cancelled = await call(`/orders/${order.id}/cancel`, { method: 'POST', token: person.token, body: {} });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  const [refund] = cancelled.data.refunds;
  assert.deepEqual([refund.source, refund.method, refund.amount, refund.status], ['CANCELLATION', 'DEMONSTRATION', 1360, 'REQUESTED']);
  assert.deepEqual(cancelled.data.demonstrationActions, [{ action: 'COMPLETE_REFUND', refundId: refund.id, expectedStatus: 'REQUESTED' }]);
  const cancellationEmail = sentEmail(`Order ${order.orderNumber} cancelled`);
  assert.match(cancellationEmail.text, /Refunds of demonstration payments move no money\./);
  assert.doesNotMatch(cancellationEmail.text, /M-Pesa/);
  assert.equal(await prisma.trackingEvent.count({ where: {
    orderId: order.id, description: `Demonstration refund ${refund.number} of KES 1,360 requested; no money will be sent.`,
  } }), 1);

  // An earlier step left by staff tools (approved for less, with its own stamps) is kept as it is.
  const approvedAt = new Date(Date.now() - 60_000);
  await prisma.refund.update({ where: { id: refund.id }, data: {
    status: 'APPROVED', amount: 1000, approvedAt, approvedById: 'earlier-approver', reason: 'Agreed deduction',
  } });
  const done = await complete(person, order.id, refund.id, 'APPROVED');
  assert.equal(done.status, 200, JSON.stringify(done.data));
  const kept = await prisma.refund.findUnique({ where: { id: refund.id } });
  assert.deepEqual([Number(kept.amount), kept.approvedAt.getTime(), kept.approvedById, kept.processingById, kept.status],
    [1000, approvedAt.getTime(), 'earlier-approver', person.id, 'CONFIRMED']);
  assert.equal(done.data.paymentStatus, 'PARTIALLY_REFUNDED');
  const confirmedTotal = (await prisma.refund.findMany({ where: { orderId: order.id, status: 'CONFIRMED' } })).reduce((sum, item) => sum + Number(item.amount), 0);
  assert.ok(confirmedTotal <= 1360);

  // Staff record the rest; then, from PROCESSING, its sending stamps are kept and the order is fully refunded.
  const options = (await call(`/orders/admin/${order.id}`, { token: adminToken })).data.refundRequestOptions;
  assert.deepEqual(options, []);
  const second = await prisma.refund.create({ data: {
    number: `RF-${order.orderNumber}-9`, orderId: order.id, source: 'CANCELLATION', method: 'DEMONSTRATION', amount: 360, requestedAmount: 360,
    requestedByType: 'STAFF', status: 'PROCESSING', approvedAt, processingAt: approvedAt, processingById: 'earlier-sender',
  } });
  const rest = await complete(person, order.id, second.id, 'PROCESSING');
  assert.equal(rest.status, 200, JSON.stringify(rest.data));
  const sentStamps = await prisma.refund.findUnique({ where: { id: second.id } });
  assert.deepEqual([sentStamps.processingAt.getTime(), sentStamps.processingById, sentStamps.status], [approvedAt.getTime(), 'earlier-sender', 'CONFIRMED']);
  assert.equal(rest.data.paymentStatus, 'REFUNDED');

  for (const status of ['FAILED', 'UNRESOLVED', 'CANCELLED']) {
    const other = await prisma.refund.create({ data: {
      number: `RF-${order.orderNumber}-${status}`, orderId: order.id, source: 'CANCELLATION', method: 'DEMONSTRATION', amount: 1,
      requestedAmount: 1, requestedByType: 'STAFF', status,
    } });
    assert.deepEqual(codeOf(await complete(person, order.id, other.id, status)), [409, 'REFUND_ACTION_NOT_ALLOWED'], status);
  }

  // A sample order paid through the M-Pesa sandbox gets an M-Pesa refund, which only staff record.
  const mpesa = await place(person, [[catalog.mug, 1]]);
  await payByMpesa(mpesa.id);
  const mpesaCancelled = await call(`/orders/${mpesa.id}/cancel`, { method: 'POST', token: person.token, body: {} });
  const [mpesaRefund] = mpesaCancelled.data.refunds;
  assert.equal(mpesaRefund.method, 'MPESA_MANUAL');
  assert.match(sentEmail(`Order ${mpesa.orderNumber} cancelled`).text, /It will be sent to you via M-Pesa/);
  assert.equal(await prisma.trackingEvent.count({ where: {
    orderId: mpesa.id, description: `Refund ${mpesaRefund.number} of KES 1,360 requested; no money has been sent yet.`,
  } }), 1);
  assert.deepEqual(mpesaCancelled.data.demonstrationActions, []);
  assert.deepEqual(codeOf(await complete(person, mpesa.id, mpesaRefund.id, 'REQUESTED')), [409, 'REFUND_NOT_DEMONSTRATION']);
  assert.deepEqual((await call(`/orders/admin/${mpesa.id}`, { token: adminToken })).data.refunds[0].allowedActions, ['approve', 'cancel']);
  assert.equal((await refundAction(mpesaRefund.id, 'approve', 'REQUESTED')).status, 200);
  assert.equal((await refundAction(mpesaRefund.id, 'start', 'APPROVED')).status, 200);
  assert.equal((await refundAction(mpesaRefund.id, 'confirm', 'PROCESSING', { providerReference: 'CTLMPESA01' })).data.refund.status, 'CONFIRMED');

  // Money M-Pesa reported for a demonstration-paid order is refunded by M-Pesa, as a payment-review refund.
  const extra = await paidSample(person, [[catalog.mug, 1]]);
  const payment = await prisma.mpesaPayment.create({ data: {
    orderId: extra.id, phone: '254700000000', amount: extra.total, status: 'REVIEW', reviewCode: 'EXTRA_PAYMENT', confirmedAt: new Date(),
    receiptNumber: 'CTLEXTRA01', environment: 'sandbox', idempotencyKey: randomUUID(), requestHash: 'fixture',
    merchantIdentity: 'fixture-merchant', merchantShortcode: '174379', callbackKeyHash: '0'.repeat(64), reference: 'CTL-EXTRA-1',
  } });
  const review = await call(`/orders/admin/payments/${payment.id}/refunds`, { method: 'POST', token: adminToken, body: { reason: 'Paid twice' } });
  assert.equal(review.status, 201, JSON.stringify(review.data));
  assert.deepEqual([review.data.refund.method, review.data.refund.paymentId, review.data.refund.allowedActions], ['MPESA_MANUAL', payment.id, ['approve', 'cancel']]);
  assert.deepEqual(codeOf(await complete(person, extra.id, review.data.refund.id, 'REQUESTED')), [409, 'REFUND_NOT_DEMONSTRATION']);
});
