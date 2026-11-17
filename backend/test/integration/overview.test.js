import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import prisma from '../../src/config/database.js';
import { generateToken } from '../../src/config/auth.js';
import { startServer } from '../../src/server.js';

/*
 * P8.1: Nairobi-time days and periods for the staff order list, the sales report and the dashboard. Boundaries are
 * computed here independently of the code under test: East Africa Time is UTC+3 all year. Run under TZ=UTC as well, as
 * on Vercel, where the server's own midnight is 03:00 in Nairobi.
 */
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const EAT_OFFSET_MS = 3 * HOUR_MS;
const PERIODS = ['today', 'week', 'month', 'year'];

let base, close, adminToken, viewerToken, shopper, category, sequence = 0;

before(async () => {
  const [admin, viewer] = await Promise.all(['ADMIN', 'VIEWER'].map((role) => prisma.admin.create({ data: {
    email: `overview-${role.toLowerCase()}@example.test`, username: `overview-${role.toLowerCase()}`,
    password: 'fixture-not-for-login', role,
  } })));
  adminToken = generateToken({ adminId: admin.id });
  viewerToken = generateToken({ adminId: viewer.id });
  shopper = await customer();
  category = await prisma.category.create({ data: { name: 'Overview', slug: 'overview' } });
  const started = await startServer({ host: '127.0.0.1', port: 0 });
  close = started.close;
  base = `http://127.0.0.1:${started.server.address().port}/api`;
});
after(async () => { await close?.(); });

async function call(path, { token = adminToken } = {}) {
  const response = await fetch(`${base}${path}`, { headers: { ...(token && { Authorization: `Bearer ${token}` }) } });
  return { status: response.status, data: await response.json() };
}

async function customer() {
  const tag = `overview-${++sequence}`;
  return prisma.user.create({
    data: {
      email: `${tag}@example.test`, password: 'fixture-not-for-login', firstName: 'Overview', lastName: tag,
      addresses: { create: { street: `${tag} street`, city: 'Nairobi', county: 'Nairobi' } },
    },
    include: { addresses: true },
  });
}

/** An order record as checkout leaves it, placed at an exact instant. */
function placeOrder(number, createdAt, { total = 1000, status = 'PENDING', paymentStatus = 'PENDING', isDemo = false } = {}) {
  return prisma.order.create({ data: {
    orderNumber: number, userId: shopper.id, addressId: shopper.addresses[0].id, subtotal: total, tax: 0, shippingCost: 0,
    total, paymentMethod: 'MPESA', paymentStatus, status, isDemo, createdAt,
  } });
}

/** A refund on `order` in `status`; a confirmed one carries its M-Pesa reference, as the service requires. */
function refund(order, status, amount, suffix = 1) {
  return prisma.refund.create({ data: {
    number: `RF-${order.orderNumber}-${suffix}`, orderId: order.id, source: 'RETURN', status, amount, requestedAmount: amount,
    requestedByType: 'STAFF', ...(status === 'CONFIRMED' && { confirmedAt: new Date(), providerReference: `OV${++sequence}REF${suffix}`.toUpperCase().padEnd(10, '0') }),
  } });
}

function returnRequest(order, status) {
  return prisma.returnRequest.create({ data: {
    number: `RMA-${order.orderNumber}-1`, orderId: order.id, userId: shopper.id, status, reason: 'CHANGED_MIND',
    idempotencyKey: `overview-return-${++sequence}`, requestHash: 'fixture',
  } });
}

/** A received M-Pesa payment flagged for review, linked to `order` with the fields an order-linked payment needs. */
function reviewedPayment(order) {
  const tag = String(++sequence).padStart(6, '0');
  return prisma.mpesaPayment.create({ data: {
    orderId: order.id, phone: '254700000000', amount: order.total, status: 'REVIEW', reviewCode: 'AMOUNT_MISMATCH',
    environment: 'sandbox', idempotencyKey: `overview-payment-${tag}`, requestHash: 'fixture', merchantIdentity: 'fixture-merchant',
    merchantShortcode: '174379', callbackKeyHash: '0'.repeat(64), reference: `OVR-${tag}`,
  } });
}

/** One SKU whose stored stock status is `status`. */
function sku(name, status, { isDemo = false, isActive = true } = {}) {
  const quantity = status === 'OUT_OF_STOCK' ? 0 : status === 'LOW_STOCK' ? 2 : 50;
  return prisma.product.create({ data: {
    name, slug: name, description: 'Overview fixture', price: 1000, isActive: true, isDemo, category: { connect: { id: category.id } },
    variants: { create: { sku: name.toUpperCase(), isActive, stock: { create: { quantity, minThreshold: 5, status } } } },
  } });
}

/** The first instant of the current Nairobi month. */
function nairobiMonthStart(now) {
  const local = new Date(now.getTime() + EAT_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - EAT_OFFSET_MS);
}

/** An instant just inside the current Nairobi month (at most 00:30 EAT on the 1st, and never in the future). */
function justInsideMonth(now) {
  const start = nairobiMonthStart(now);
  return new Date(start.getTime() + Math.min(30 * MINUTE_MS, Math.floor((now - start) / 2)));
}

const orderNumbers = (page, prefix) => page.orders.map((order) => order.orderNumber).filter((number) => number.startsWith(prefix)).sort();

test('the staff order list keeps whole Nairobi days, inclusive at both ends, across the UTC boundary', async () => {
  const seeds = {
    'DAYS-1-last-minute-of-31-october': '2026-10-31T20:59:00.000Z',
    'DAYS-2-0030-on-1-november': '2026-10-31T21:30:00.000Z',
    'DAYS-3-1405-on-17-november': '2026-11-17T11:05:00.000Z',
    'DAYS-4-last-millisecond-of-17-november': '2026-11-17T20:59:59.999Z',
    'DAYS-5-midnight-starting-18-november': '2026-11-17T21:00:00.000Z',
  };
  for (const [number, createdAt] of Object.entries(seeds)) await placeOrder(number, new Date(createdAt));
  const listed = async (query) => {
    const result = await call(`/orders/admin/all?limit=100&${query}`);
    assert.equal(result.status, 200, `${query}: ${JSON.stringify(result.data)}`);
    return orderNumbers(result.data, 'DAYS-');
  };
  assert.deepEqual(await listed('orderedDay=2026-11-01'), ['DAYS-2-0030-on-1-november']);
  assert.deepEqual(await listed('orderedDay=2026-10-31'), ['DAYS-1-last-minute-of-31-october']);
  assert.deepEqual(await listed('orderedFrom=2026-11-01&orderedTo=2026-11-17'),
    ['DAYS-2-0030-on-1-november', 'DAYS-3-1405-on-17-november', 'DAYS-4-last-millisecond-of-17-november']);
  assert.deepEqual(await listed('orderedFrom=2026-11-17&orderedTo=2026-11-17'),
    ['DAYS-3-1405-on-17-november', 'DAYS-4-last-millisecond-of-17-november']);
  assert.deepEqual(await listed('orderedFrom=2026-11-17'),
    ['DAYS-3-1405-on-17-november', 'DAYS-4-last-millisecond-of-17-november', 'DAYS-5-midnight-starting-18-november']);
  assert.deepEqual(await listed('orderedTo=2026-10-31'), ['DAYS-1-last-minute-of-31-october']);
  // Status and the date range combine.
  assert.deepEqual(await listed('orderedFrom=2026-11-01&orderedTo=2026-11-17&status=CANCELLED'), []);
});

test('an impossible or reversed date is a plain 400, not a list of every order', async () => {
  for (const [query, parameter] of [
    ['orderedDay=2026-13-01', 'orderedDay'], ['orderedDay=2026-02-30', 'orderedDay'], ['orderedDay=17-11-2026', 'orderedDay'],
    ['orderedFrom=2026-02-29', 'orderedFrom'], ['orderedFrom=2026-11-01&orderedTo=2026-11-31', 'orderedTo'],
  ]) {
    const result = await call(`/orders/admin/all?${query}`);
    assert.equal(result.status, 400, `${query}: ${result.status}, ${result.data.pagination?.total ?? 0} orders listed`);
    assert.equal(result.data.error, `${parameter} must be a real date written as YYYY-MM-DD.`);
  }
  const reversed = await call('/orders/admin/all?orderedFrom=2026-11-17&orderedTo=2026-11-01');
  assert.equal(reversed.status, 400);
  assert.equal(reversed.data.error, 'orderedFrom must not be later than orderedTo.');
  const both = await call('/orders/admin/all?orderedDay=2026-11-01&orderedTo=2026-11-17');
  assert.equal(both.status, 400);
  assert.equal(both.data.error, 'Use orderedDay or orderedFrom/orderedTo, not both.');
});

test('the sales report month starts at midnight in Nairobi, not at midnight UTC', async () => {
  const now = new Date();
  await placeOrder('MONTH-1-just-inside', justInsideMonth(now));
  await placeOrder('MONTH-2-last-minute-before', new Date(nairobiMonthStart(now).getTime() - MINUTE_MS));
  const report = await call('/admin/analytics/sales?period=month');
  assert.equal(report.status, 200, JSON.stringify(report.data));
  assert.deepEqual(orderNumbers(report.data, 'MONTH-'), ['MONTH-1-just-inside']);
});

async function dashboard(period, token = adminToken) {
  const result = await call(`/admin/analytics/dashboard${period ? `?period=${period}` : ''}`, { token });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data;
}

/** The sales report's figures under the dashboard's names; the report has no refund count. */
async function reportFigures(period) {
  const result = await call(`/admin/analytics/sales?period=${period}`);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const report = result.data;
  return {
    range: report.range, orders: report.orders,
    figures: {
      netSales: report.totalRevenue, paidOrders: report.paidOrders, ordersPlaced: report.totalOrders,
      cancelledOrders: report.cancelledOrders, refundedAmount: report.refundedValue,
    },
  };
}
const comparable = ({ refunds, ...figures }) => ({ ...figures, refundedAmount: refunds.amount });

test('the dashboard\'s period figures equal the sales report\'s: Nairobi month, no demo orders, no earlier month\'s cancellations or refunds', async () => {
  const before = (await dashboard('month')).figures;
  const now = new Date();
  const monthStart = nairobiMonthStart(now);
  const inside = await placeOrder('FIG-1-paid-just-inside', justInsideMonth(now), { total: 2000, paymentStatus: 'PARTIALLY_REFUNDED' });
  await refund(inside, 'CONFIRMED', 500);
  await placeOrder('FIG-2-paid-last-minute-before', new Date(monthStart.getTime() - MINUTE_MS), { total: 3000, paymentStatus: 'PAID' });
  await placeOrder('FIG-3-demo-paid', now, { total: 999_999, paymentStatus: 'PAID', isDemo: true });
  await placeOrder('FIG-4-cancelled', now, { total: 500, status: 'CANCELLED' });
  const earlier = await placeOrder('FIG-5-paid-earlier-month', new Date(monthStart.getTime() - 10 * DAY_MS), {
    total: 4000, paymentStatus: 'PARTIALLY_REFUNDED',
  });
  // Confirmed now, on an order placed before this month: not this month's refund.
  await refund(earlier, 'CONFIRMED', 1000);
  // Cancelled, but placed before this month: not this month's cancellation.
  await placeOrder('FIG-6-cancelled-earlier-month', new Date(monthStart.getTime() - 10 * DAY_MS), { total: 700, status: 'CANCELLED' });
  await refund(inside, 'APPROVED', 200, 2);

  const month = await dashboard();
  assert.equal(month.range.period, 'month');
  assert.equal(month.range.timeZone, 'Africa/Nairobi');
  assert.equal(month.range.start, monthStart.toISOString());
  assert.ok(Date.parse(month.range.end) <= Date.parse(month.generatedAt));
  assert.deepEqual(month.figures, {
    netSales: before.netSales + 2000 - 500,
    paidOrders: before.paidOrders + 1,
    ordersPlaced: before.ordersPlaced + 2,
    cancelledOrders: before.cancelledOrders + 1,
    refunds: { count: before.refunds.count + 1, amount: before.refunds.amount + 500 },
  });
  assert.ok(month.recentOrders.every((order) => !order.isDemo && order.orderNumber !== 'FIG-3-demo-paid'));

  for (const period of PERIODS) {
    const shown = await dashboard(period);
    const report = await reportFigures(period);
    assert.deepEqual(comparable(shown.figures), report.figures, period);
    assert.deepEqual([shown.range.period, shown.range.start, shown.range.timeZone], [report.range.period, report.range.start, report.range.timeZone]);
    assert.ok(!report.orders.some((order) => order.orderNumber === 'FIG-3-demo-paid'), `${period}: demo order listed`);
  }
  const monthReport = await reportFigures('month');
  assert.deepEqual(orderNumbers(monthReport, 'FIG-'), ['FIG-1-paid-just-inside', 'FIG-4-cancelled']);
  // The earlier month's order (and its refund) belongs to the year so far exactly when it was placed this Nairobi year.
  const local = new Date(now.getTime() + EAT_OFFSET_MS);
  const yearStart = new Date(Date.UTC(local.getUTCFullYear(), 0, 1) - EAT_OFFSET_MS);
  assert.equal(orderNumbers(await reportFigures('year'), 'FIG-').includes('FIG-5-paid-earlier-month'), earlier.createdAt >= yearStart);
});

test('current counts are the lists they link to, and stay out of demo records', async () => {
  const before = (await dashboard('today')).current;
  const now = new Date();
  const orders = {};
  for (const [name, status, paymentStatus] of [
    ['CUR-awaiting-1', 'PENDING', 'PAID'], ['CUR-awaiting-2', 'PENDING', 'PAID'], ['CUR-unpaid', 'PENDING', 'PENDING'],
    ['CUR-processing', 'PROCESSING', 'PAID'], ['CUR-ready', 'READY_FOR_PICKUP', 'PAID'], ['CUR-shipped', 'SHIPPED', 'PAID'],
    ['CUR-delivered-1', 'DELIVERED', 'PAID'], ['CUR-delivered-2', 'DELIVERED', 'PAID'],
    ['CUR-reviewed', 'PENDING', 'PAID'], ['CUR-reviewed-settled', 'CANCELLED', 'REFUNDED'],
  ]) orders[name] = await placeOrder(name, now, { status, paymentStatus });
  const demo = await placeOrder('CUR-demo-awaiting', now, { status: 'PENDING', paymentStatus: 'PAID', isDemo: true });
  await returnRequest(orders['CUR-delivered-1'], 'REQUESTED');
  await returnRequest(orders['CUR-delivered-2'], 'APPROVED');
  await returnRequest(demo, 'REQUESTED');
  for (const [index, status] of ['REQUESTED', 'APPROVED', 'PROCESSING', 'FAILED', 'UNRESOLVED', 'CANCELLED'].entries()) {
    await refund(orders['CUR-delivered-1'], status, 100, 10 + index);
  }
  await refund(demo, 'REQUESTED', 100, 2);
  await reviewedPayment(orders['CUR-reviewed']);
  const settled = await reviewedPayment(orders['CUR-reviewed-settled']);
  await prisma.refund.create({ data: {
    number: 'RF-CUR-reviewed-settled-1', orderId: settled.orderId, paymentId: settled.id, source: 'PAYMENT_REVIEW', status: 'CONFIRMED',
    amount: 1000, requestedAmount: 1000, requestedByType: 'STAFF', confirmedAt: now, providerReference: 'SETTLED0001',
  } });
  await reviewedPayment(demo);
  await sku('cur-low', 'LOW_STOCK');
  await sku('cur-out', 'OUT_OF_STOCK');
  await sku('cur-in', 'IN_STOCK');
  await sku('cur-demo-low', 'LOW_STOCK', { isDemo: true });
  await sku('cur-inactive-out', 'OUT_OF_STOCK', { isActive: false });

  const { current } = await dashboard('today');
  const total = async (path) => {
    const result = await call(path);
    assert.equal(result.status, 200, `${path}: ${JSON.stringify(result.data)}`);
    return result.data.pagination.total;
  };
  assert.deepEqual(current.orders, {
    awaitingStart: await total('/orders/admin/all?status=PENDING&paymentStatus=PAID'),
    processing: await total('/orders/admin/all?status=PROCESSING'),
    readyForPickup: await total('/orders/admin/all?status=READY_FOR_PICKUP'),
    dispatched: await total('/orders/admin/all?status=SHIPPED'),
  });
  for (const status of ['REQUESTED', 'APPROVED']) assert.equal(current.returns[status], await total(`/orders/admin/returns?status=${status}`), status);
  for (const status of ['REQUESTED', 'APPROVED', 'PROCESSING', 'FAILED', 'UNRESOLVED']) {
    assert.equal(current.refunds[status], await total(`/orders/admin/refunds?status=${status}`), status);
  }
  const attention = (await call('/admin/attention')).data.items;
  assert.equal(current.paymentsNeedingReview, attention.filter((item) => item.type === 'PAYMENT_REVIEW').length);
  const stocks = (await call('/admin/stock')).data.stocks.filter((row) => !row.isDemo);
  for (const status of ['LOW_STOCK', 'OUT_OF_STOCK']) assert.equal(current.stock[status], stocks.filter((row) => row.status === status).length, status);
  // Not vacuous: each seeded kind of work is counted once more than before, and the demo copies nowhere.
  const added = (latest, earlier) => Object.fromEntries(Object.entries(latest).map(([key, value]) => [key, value - earlier[key]]));
  assert.deepEqual(added(current.orders, before.orders), { awaitingStart: 3, processing: 1, readyForPickup: 1, dispatched: 1 });
  assert.equal(current.paymentsNeedingReview - before.paymentsNeedingReview, 1);
  assert.deepEqual(added(current.returns, before.returns), { REQUESTED: 1, APPROVED: 1 });
  assert.deepEqual(added(current.refunds, before.refunds), { REQUESTED: 1, APPROVED: 1, PROCESSING: 1, FAILED: 1, UNRESOLVED: 1 });
  assert.deepEqual(added(current.stock, before.stock), { LOW_STOCK: 1, OUT_OF_STOCK: 1 });
});

test('an unknown period is a plain 400, and every staff role may read the overview', async () => {
  for (const period of ['day', 'quarter', 'constructor', '']) {
    for (const path of ['dashboard', 'sales']) {
      const result = await call(`/admin/analytics/${path}?period=${period}`);
      assert.equal(result.status, 400, `${path} ${period}`);
      assert.equal(result.data.error, 'period must be today, week, month or year.');
    }
  }
  const viewed = await dashboard('week', viewerToken);
  assert.equal(viewed.range.period, 'week');
  assert.equal((await call('/admin/analytics/sales?period=today', { token: viewerToken })).status, 200);
});

test('the sales report reads date-only startDate and endDate as whole Nairobi days', async () => {
  const result = await call('/admin/analytics/sales?startDate=2026-11-01&endDate=2026-11-17');
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.deepEqual(result.data.range, {
    period: 'custom', start: '2026-10-31T21:00:00.000Z', end: '2026-11-17T20:59:59.999Z', timeZone: 'Africa/Nairobi',
  });
  assert.deepEqual(orderNumbers(result.data, 'DAYS-'),
    ['DAYS-2-0030-on-1-november', 'DAYS-3-1405-on-17-november', 'DAYS-4-last-millisecond-of-17-november']);
  assert.ok(!('salesByCategory' in result.data));
  const invalid = await call('/admin/analytics/sales?startDate=2026-02-30');
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.error, 'startDate must be a real date written as YYYY-MM-DD.');
  assert.equal((await call('/admin/analytics/sales?startDate=2026-11-17&endDate=2026-11-01')).status, 400);
});
