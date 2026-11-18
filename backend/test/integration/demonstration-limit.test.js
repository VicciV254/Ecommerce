import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, mock, test } from 'node:test';
import prisma from '../../src/config/database.js';
import { generateToken } from '../../src/config/auth.js';
import { startServer } from '../../src/server.js';
import { mailer } from '../../src/services/notificationService.js';

/*
 * P8.6 §2 daily limit: one account may create at most DEMO_ORDER_DAILY_LIMIT sample orders (default 10) in 24 hours,
 * through either creation route. A replay creates nothing and uses no quota; concurrent creates cannot both pass.
 */
let base, close, category, sequence = 0, barrier = null;
prisma.$use(async (params, next) => {
  if (barrier && params.model === 'Order' && params.action === 'count') await barrier();
  return next(params);
});

before(async () => {
  mock.method(mailer, 'send', async () => ({ provider: 'test', messageId: 'test-message' }));
  process.env.ENABLE_ORDER_RESERVATIONS = 'true';
  process.env.DEMONSTRATION_STORE = 'true';
  category = await prisma.category.create({ data: { name: 'Limit', slug: 'limit' } });
  const started = await startServer({ host: '127.0.0.1', port: 0 });
  close = started.close;
  base = `http://127.0.0.1:${started.server.address().port}/api`;
});
beforeEach(() => {
  barrier = null;
  process.env.DEMONSTRATION_STORE = 'true';
  delete process.env.DEMO_ORDER_DAILY_LIMIT;
});
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

function product(isDemo = true) {
  const slug = `limit-${++sequence}`;
  return prisma.product.create({
    data: {
      name: slug, slug, description: 'Daily limit fixture', price: 1000, isActive: true, isDemo, category: { connect: { id: category.id } },
      variants: { create: { sku: slug.toUpperCase(), attributes: { size: 'One' }, stock: { create: { quantity: 100, minThreshold: 0, status: 'IN_STOCK' } } } },
    },
    include: { variants: true },
  });
}

async function customer() {
  const tag = `limit-${++sequence}`;
  const user = await prisma.user.create({
    data: {
      email: `${tag}@example.test`, password: 'fixture-not-for-login', firstName: 'Limit', lastName: tag,
      addresses: { create: { street: `${tag} street`, city: 'Mombasa', county: 'Mombasa' } },
    },
    include: { addresses: true },
  });
  return { ...user, token: generateToken({ userId: user.id }) };
}

async function quote(person, item) {
  const quoted = await call('/orders/quotes', { method: 'POST', token: person.token, body: {
    items: [{ productId: item.id, variantId: item.variants[0].id, quantity: 1 }],
    addressId: person.addresses[0].id, deliveryMethod: 'STANDARD', couponCode: null, notes: null,
  } });
  assert.equal(quoted.status, 201, JSON.stringify(quoted.data));
  return quoted.data;
}

/** Quotes one unit and asks for the order on `route` ('/orders' or '/orders/checkout'). */
async function place(person, item, { route = '/orders', key = randomUUID() } = {}) {
  const { id } = await quote(person, item);
  return { ...(await call(route, { method: 'POST', token: person.token, key, body: { quoteId: id } })), key, quoteId: id };
}

const sampleOrders = (person) => prisma.order.count({ where: { userId: person.id, isDemo: true } });
const reserved = async (item) => (await prisma.stock.findUnique({ where: { variantId: item.variants[0].id } })).reserved;

test('the 10th sample order in 24 hours is accepted and the 11th refused with 429 on both routes, reserving nothing', async () => {
  const [person, item] = await Promise.all([customer(), product()]);
  for (let index = 1; index <= 10; index++) {
    const placed = await place(person, item, { route: index % 2 ? '/orders' : '/orders/checkout' });
    assert.equal(placed.status, 201, `order ${index}: ${JSON.stringify(placed.data)}`);
  }
  for (const route of ['/orders', '/orders/checkout']) {
    const refused = await place(person, item, { route });
    assert.deepEqual([refused.status, refused.data.code], [429, 'DEMO_ORDER_LIMIT'], route);
    assert.equal((await prisma.checkoutQuote.findUnique({ where: { id: refused.quoteId } })).consumedAt, null);
  }
  assert.equal(await sampleOrders(person), 10);
  assert.equal(await reserved(item), 10);

  // Another account has its own quota, and an order older than 24 hours no longer counts.
  assert.equal((await place(await customer(), item)).status, 201);
  const oldest = await prisma.order.findFirst({ where: { userId: person.id }, orderBy: { createdAt: 'asc' } });
  await prisma.order.update({ where: { id: oldest.id }, data: { createdAt: new Date(Date.now() - 24 * 3_600_000 - 60_000) } });
  assert.equal((await place(person, item, { route: '/orders/checkout' })).status, 201);
  assert.deepEqual([(await place(person, item)).status, await sampleOrders(person)], [429, 11]);

  // Live orders are not sample orders and are not limited.
  const live = await product(false);
  process.env.DEMONSTRATION_STORE = 'false';
  const plain = await place(person, live);
  assert.deepEqual([plain.status, plain.data.isDemo], [201, false]);
});

test('live orders in the last 24 hours do not use the sample-order quota', async () => {
  const [person, item, live] = await Promise.all([customer(), product(), product(false)]);
  process.env.DEMO_ORDER_DAILY_LIMIT = '1';
  // Where sample orders are enabled beside the live catalog (development), one account can place both kinds.
  process.env.DEMONSTRATION_STORE = 'false';
  process.env.ALLOW_DEMO_ORDERS = 'true';
  process.env.ALLOW_DEMO_CATALOG = 'true';
  try {
    for (let index = 0; index < 2; index++) assert.equal((await place(person, live)).status, 201);
    const sample = await place(person, item);
    assert.deepEqual([sample.status, sample.data.isDemo], [201, true], JSON.stringify(sample.data));
    const refused = await place(person, item);
    assert.deepEqual([refused.data.code, refused.data.error],
      ['DEMO_ORDER_LIMIT', 'You can place up to 1 sample order in 24 hours. Try again later.']);
  } finally {
    process.env.ALLOW_DEMO_ORDERS = 'false';
    process.env.ALLOW_DEMO_CATALOG = 'false';
  }
});

test('a replay at the limit returns the existing order with 200 and uses no quota', async () => {
  const [person, item] = await Promise.all([customer(), product()]);
  process.env.DEMO_ORDER_DAILY_LIMIT = '2';
  assert.equal((await place(person, item)).status, 201);
  const last = await place(person, item, { route: '/orders/checkout' });
  assert.equal(last.status, 201);
  for (const route of ['/orders', '/orders/checkout']) {
    const replay = await call(route, { method: 'POST', token: person.token, key: last.key, body: { quoteId: last.quoteId } });
    assert.deepEqual([replay.status, replay.data.id], [200, last.data.id], route);
  }
  assert.equal(await sampleOrders(person), 2);
  assert.equal((await place(person, item)).data.code, 'DEMO_ORDER_LIMIT');
});

test('two sample orders created at once at the boundary cannot both pass', async () => {
  const [person, first, second] = await Promise.all([customer(), product(), product()]);
  process.env.DEMO_ORDER_DAILY_LIMIT = '3';
  for (let index = 0; index < 2; index++) assert.equal((await place(person, first)).status, 201);
  const quotes = [await quote(person, first), await quote(person, second)];
  // Both requests count this account's orders before either creates one.
  let arrived = 0, open;
  const together = new Promise((resolve) => { open = resolve; });
  barrier = async () => {
    arrived += 1;
    if (arrived === 2) open();
    await Promise.race([together, new Promise((resolve) => setTimeout(resolve, 5000))]);
  };
  const results = await Promise.all(quotes.map(({ id }) => call('/orders', { method: 'POST', token: person.token, key: randomUUID(), body: { quoteId: id } })));
  barrier = null;
  assert.ok(arrived >= 2, 'both requests reached the count');
  const statuses = results.map((result) => result.status).sort();
  assert.equal(statuses[0], 201, JSON.stringify(results.map((result) => result.data)));
  assert.ok([409, 429].includes(statuses[1]), JSON.stringify(results.map((result) => result.data)));
  assert.equal(await sampleOrders(person), 3);
  assert.equal((await reserved(first)) + (await reserved(second)), 3);
});

test('an invalid DEMO_ORDER_DAILY_LIMIT refuses sample orders as a configuration error, creating nothing', async () => {
  const [person, item] = await Promise.all([customer(), product()]);
  for (const value of ['0', 'ten', '']) {
    process.env.DEMO_ORDER_DAILY_LIMIT = value;
    const refused = await place(person, item);
    assert.deepEqual([refused.status, refused.data.code], [503, 'CHECKOUT_CONFIGURATION_INVALID'], JSON.stringify(value));
  }
  assert.equal(await sampleOrders(person), 0);
  assert.equal(await reserved(item), 0);
});
