import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import prisma from '../../src/config/database.js';
import { startServer } from '../../src/server.js';

/*
 * P8.7: GET /api/settings/storefront/best-sellers ranks real sales only: orders that are not samples, sold (paid or
 * partly refunded, not cancelled), settled through their `settledPaymentId` by a production M-Pesa payment and placed in
 * the last 30 days. Units are what buyers kept after received returns. A product is listed only when the public catalog
 * shows it and at least two different accounts bought it; fewer than four such products answer an empty list. The answer
 * carries product ids only.
 */
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const WINDOW_DAYS = 30;

let base, close, department, sequence = 0;

before(async () => {
  department = await prisma.category.create({ data: { name: 'Ranked', slug: 'ranked' } });
  const started = await startServer({ host: '127.0.0.1', port: 0 });
  close = started.close;
  base = `http://127.0.0.1:${started.server.address().port}/api`;
});
after(async () => { await close?.(); });

/** Each test starts with no orders, so the ranking holds only what the test sold. */
beforeEach(async () => {
  await prisma.returnRequest.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.mpesaPayment.deleteMany();
  await prisma.order.deleteMany();
});

/** A product shoppers can see, with one SKU, unless the overrides hide it. */
function product(name, { variantActive = true, ...overrides } = {}) {
  const tag = ++sequence;
  return prisma.product.create({
    data: {
      name, slug: `ranked-${tag}`, description: 'Best sellers fixture', price: 1000, isActive: true, categoryId: department.id, ...overrides,
      variants: { create: { sku: `RANKED-${tag}`, isActive: variantActive, stock: { create: { quantity: 1000 } } } },
    },
    include: { variants: true },
  });
}

function buyer() {
  const tag = `ranked-${++sequence}`;
  return prisma.user.create({
    data: {
      email: `${tag}@example.test`, password: 'fixture-not-for-login', firstName: 'Ranked', lastName: tag,
      addresses: { create: { street: `${tag} street`, city: 'Nairobi', county: 'Nairobi' } },
    },
    include: { addresses: true },
  });
}

/** An order-linked M-Pesa payment with every field such a payment must have. */
function payment(order, environment) {
  const tag = String(++sequence).padStart(6, '0');
  return prisma.mpesaPayment.create({ data: {
    orderId: order.id, phone: '254700000000', amount: order.total, status: 'SUCCEEDED', environment,
    receiptNumber: `RANKED${tag}`, idempotencyKey: `ranked-${tag}`, requestHash: 'fixture', merchantIdentity: 'fixture-merchant',
    merchantShortcode: '174379', callbackKeyHash: '0'.repeat(64), reference: `RANKED-${tag}`,
  } });
}

/**
 * One order by `who` for `lines` ([product, quantity] pairs), stored as a paid M-Pesa order is: placed a day ago and
 * settled (`settledPaymentId`) by a payment in `environment`. `settled: false` leaves the payment unattributed.
 */
async function sale(who, lines, {
  environment = 'production', settled = true, paymentStatus = 'PAID', status = 'PROCESSING', isDemo = false,
  placedAt = new Date(Date.now() - DAY_MS), shippingCost = 0,
} = {}) {
  const subtotal = lines.reduce((sum, [, quantity]) => sum + 1000 * quantity, 0);
  const order = await prisma.order.create({
    data: {
      orderNumber: `RANKED-${++sequence}`, userId: who.id, addressId: who.addresses[0].id, subtotal, tax: 0, shippingCost,
      total: subtotal + shippingCost, paymentMethod: 'MPESA', paymentStatus, status, isDemo, createdAt: placedAt,
      items: { create: lines.map(([item, quantity]) => ({
        productId: item.id, variantId: item.variants[0].id, sku: item.variants[0].sku, productName: item.name,
        productPrice: 1000, quantity, subtotal: 1000 * quantity,
      })) },
    },
    include: { items: true },
  });
  const paid = await payment(order, environment);
  if (settled) await prisma.order.update({ where: { id: order.id }, data: { settledPaymentId: paid.id } });
  return order;
}

/** A return of `quantity` units of `item` from `order`; RECEIVED (the default) records them all as received. */
function returned(order, item, quantity, status = 'RECEIVED') {
  const line = order.items.find((entry) => entry.productId === item.id);
  return prisma.returnRequest.create({ data: {
    number: `RMA-RANKED-${++sequence}`, orderId: order.id, userId: order.userId, status, reason: 'CHANGED_MIND',
    idempotencyKey: `ranked-return-${sequence}`, requestHash: 'fixture',
    lines: { create: { orderItemId: line.id, quantity, returnRule: 'STANDARD', ...(status === 'RECEIVED' && { receivedQuantity: quantity, restockQuantity: quantity, refundableQuantity: quantity }) } },
  } });
}

async function ranking() {
  const response = await fetch(`${base}/settings/storefront/best-sellers`);
  return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
}
async function rankedIds() {
  const result = await ranking();
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body.productIds;
}
/** Product ids in the order a tie leaves them: ascending, by code unit. */
const sortedIds = (items) => items.map((item) => item.id).sort();
/** Sells each product to both buyers, once each, in one order per buyer. */
async function soldToBoth([first, second], items) {
  await sale(first, items.map((item) => [item, 1]));
  await sale(second, items.map((item) => [item, 1]));
}

test('lists nothing until four products qualify, then those four, ties in product id order', async () => {
  const buyers = await Promise.all([buyer(), buyer()]);
  const items = [];
  for (const name of ['Alpha', 'Bravo', 'Charlie', 'Delta']) items.push(await product(`Threshold ${name}`));
  await soldToBoth(buyers, items.slice(0, 3));
  assert.deepEqual((await ranking()).body, { windowDays: WINDOW_DAYS, productIds: [] });
  await soldToBoth(buyers, items.slice(3));
  assert.deepEqual(await rankedIds(), sortedIds(items));
});

test('ranks by distinct paid orders, then units, then product id, and lists twelve at most', async () => {
  const [ann, ben, cara] = await Promise.all([buyer(), buyer(), buyer()]);
  const items = [];
  for (let index = 0; index < 14; index += 1) items.push(await product(`Ranked ${index}`));
  const [most, fewerUnits, moreUnits, ...tied] = items;
  await soldToBoth([ann, ben], items);
  // Five orders.
  for (let order = 0; order < 3; order += 1) await sale(cara, [[most, 1]]);
  // Four orders and five units: one of them holds the product on two lines, which is still one order.
  await sale(ann, [[fewerUnits, 1]]);
  await sale(ben, [[fewerUnits, 1], [fewerUnits, 1]]);
  // Four orders and eight units.
  await sale(ann, [[moreUnits, 3]]);
  await sale(ben, [[moreUnits, 3]]);
  assert.deepEqual(await rankedIds(), [most.id, moreUnits.id, fewerUnits.id, ...sortedIds(tied).slice(0, 9)]);
});

test('counts only real sales: production M-Pesa settlement, paid or partly refunded, not cancelled, not samples, in 30 days', async () => {
  const buyers = await Promise.all([buyer(), buyer()]);
  const counted = [];
  for (const name of ['One', 'Two', 'Three', 'Four']) counted.push(await product(`Real ${name}`));
  await soldToBoth(buyers, counted);
  const excluded = [
    ['sandbox settlement', { environment: 'sandbox' }],
    ['unattributed production payment', { settled: false }],
    ['sample order', { isDemo: true }],
    ['awaiting payment', { paymentStatus: 'PENDING' }],
    ['failed payment', { paymentStatus: 'FAILED' }],
    ['fully refunded', { paymentStatus: 'REFUNDED' }],
    ['cancelled', { status: 'CANCELLED' }],
    ['placed 30 days and a minute ago', { placedAt: new Date(Date.now() - WINDOW_DAYS * DAY_MS - MINUTE_MS) }],
  ];
  for (const [name, options] of excluded) {
    const item = await product(`Not counted: ${name}`);
    for (const who of buyers) await sale(who, [[item, 1]], options);
  }
  // A production attempt on the order that M-Pesa sandbox settled does not make it a real sale.
  const elsewhere = await product('Not counted: settled by the sandbox beside a production attempt');
  for (const who of buyers) await payment(await sale(who, [[elsewhere, 1]], { environment: 'sandbox' }), 'production');
  const edge = await product('Counted: placed a minute inside the window');
  for (const who of buyers) await sale(who, [[edge, 1]], { placedAt: new Date(Date.now() - WINDOW_DAYS * DAY_MS + MINUTE_MS) });
  const partly = await product('Counted: partly refunded');
  for (const who of buyers) await sale(who, [[partly, 1]], { paymentStatus: 'PARTIALLY_REFUNDED', status: 'DELIVERED' });

  assert.deepEqual(await rankedIds(), sortedIds([...counted, edge, partly]));
});

test('a product is listed only when two different accounts bought it', async () => {
  const buyers = await Promise.all([buyer(), buyer()]);
  const others = [];
  for (const name of ['One', 'Two', 'Three', 'Four']) others.push(await product(`Pair ${name}`));
  await soldToBoth(buyers, others);
  const single = await product('One buyer, three orders');
  for (let order = 0; order < 3; order += 1) await sale(buyers[0], [[single, 2]]);
  assert.deepEqual(await rankedIds(), sortedIds(others));
  // A second account's purchase makes it count, with all four of its orders.
  await sale(buyers[1], [[single, 1]]);
  assert.deepEqual(await rankedIds(), [single.id, ...sortedIds(others)]);
});

test('received returns reduce what was sold: a product returned in full is not credited for that order', async () => {
  const [ann, ben] = await Promise.all([buyer(), buyer()]);
  const plain = [];
  for (const name of ['One', 'Two', 'Three']) plain.push(await product(`Kept ${name}`));
  await soldToBoth([ann, ben], plain);
  const [returnedInFull, keptBeside, partlyReturned, neverReturned, requestedOnly] = await Promise.all(
    ['Returned in full', 'Kept beside it', 'Partly returned', 'Never returned', 'Return only requested'].map((name) => product(name)),
  );
  // Ann's order is partly refunded: one product came back in full; the delivery fee was not refunded, so the order is
  // still sold.
  const mixed = await sale(ann, [[returnedInFull, 1], [keptBeside, 2]], { paymentStatus: 'PARTIALLY_REFUNDED', status: 'DELIVERED', shippingCost: 200 });
  await returned(mixed, returnedInFull, 1);
  await sale(ben, [[returnedInFull, 1], [keptBeside, 1]]);
  // Three bought, two received back: one unit kept, plus Ben's one.
  const partial = await sale(ann, [[partlyReturned, 3]], { paymentStatus: 'PARTIALLY_REFUNDED', status: 'DELIVERED' });
  await returned(partial, partlyReturned, 2);
  await sale(ben, [[partlyReturned, 1]]);
  // Three units kept.
  await sale(ann, [[neverReturned, 1]]);
  await sale(ben, [[neverReturned, 2]]);
  // A return that was never received changes nothing: four units.
  const requested = await sale(ann, [[requestedOnly, 2]]);
  await returned(requested, requestedOnly, 2, 'REQUESTED');
  await sale(ben, [[requestedOnly, 2]]);

  // Two orders each. Units: requested-only 4; kept-beside 3 and never-returned 3; partly returned 2, as the plain ones.
  // Returned-in-full has one buyer left, so it is not listed.
  assert.deepEqual(await rankedIds(), [
    requestedOnly.id, ...sortedIds([keptBeside, neverReturned]), ...sortedIds([...plain, partlyReturned]),
  ]);
});

test("the public catalog's own rules apply before ranking: hidden products neither count nor take a place", async () => {
  const [ann, ben, cara] = await Promise.all([buyer(), buyer(), buyer()]);
  const hiddenDepartment = await prisma.category.create({ data: { name: 'Ranked hidden department', slug: 'ranked-hidden', isActive: false } });
  const underHidden = await prisma.category.create({ data: { name: 'Ranked under hidden', slug: 'ranked-under-hidden', parentId: hiddenDepartment.id } });
  const hiddenDesigner = await prisma.designer.create({ data: { designerId: 'ranked-hidden-studio', fullName: 'Hidden Studio', specialty: 'Tests', isActive: false } });
  const hidden = [
    await product('Hidden: inactive', { isActive: false }),
    await product('Hidden: deleted', { deletedAt: new Date() }),
    await product('Hidden: sample', { isDemo: true }),
    await product('Hidden: department hidden above its category', { categoryId: underHidden.id }),
    await product('Hidden: designer hidden', { designerId: hiddenDesigner.id }),
    await product('Hidden: no active variant', { variantActive: false }),
  ];
  // The hidden products outsell everything: three buyers, five units each.
  for (const who of [ann, ben, cara]) await sale(who, hidden.map((item) => [item, 5]));
  const shown = [];
  for (let index = 0; index < 12; index += 1) shown.push(await product(`Shown ${index}`));
  await soldToBoth([ann, ben], shown.slice(0, 3));
  assert.deepEqual(await rankedIds(), []);
  await soldToBoth([ann, ben], shown.slice(3));
  assert.deepEqual(await rankedIds(), sortedIds(shown));
});

test('a demonstration store answers an empty list without querying, even with real sales recorded', async (t) => {
  const buyers = await Promise.all([buyer(), buyer()]);
  const items = [];
  for (const name of ['One', 'Two', 'Three', 'Four']) items.push(await product(`Before the switch ${name}`));
  await soldToBoth(buyers, items);
  assert.deepEqual(await rankedIds(), sortedIds(items));

  const transactions = t.mock.method(prisma, '$transaction');
  const queries = t.mock.method(prisma, '$queryRaw');
  process.env.DEMONSTRATION_STORE = 'true';
  try {
    const result = await ranking();
    assert.deepEqual({ status: result.status, body: result.body }, { status: 200, body: { windowDays: WINDOW_DAYS, productIds: [] } });
  } finally {
    process.env.DEMONSTRATION_STORE = 'false';
  }
  assert.equal(transactions.mock.callCount() + queries.mock.callCount(), 0);
});

test('answers product ids only, publicly cached for a short time; a failure is not cached', async () => {
  const buyers = await Promise.all([buyer(), buyer()]);
  const items = [];
  for (const name of ['One', 'Two', 'Three', 'Four']) items.push(await product(`Answer ${name}`));
  await soldToBoth(buyers, items);
  const result = await ranking();
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(Object.keys(result.body).sort(), ['productIds', 'windowDays']);
  assert.ok(result.body.productIds.every((id) => typeof id === 'string'));
  assert.equal(result.cache, 'public, max-age=60, s-maxage=300');

  mock.method(prisma, '$transaction', async () => { throw new Error('connection reset by the test'); });
  try {
    const failed = await ranking();
    assert.deepEqual({ status: failed.status, body: failed.body }, { status: 500, body: { error: 'Internal server error' } });
    assert.doesNotMatch(failed.cache ?? '', /public/);
  } finally {
    mock.restoreAll();
  }
});
