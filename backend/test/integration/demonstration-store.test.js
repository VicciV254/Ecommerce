import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, mock, test } from 'node:test';
import prisma from '../../src/config/database.js';
import { generateToken } from '../../src/config/auth.js';
import { startServer } from '../../src/server.js';
import { mailer } from '../../src/services/notificationService.js';

/*
 * P8.6 §1 on a real database: with DEMONSTRATION_STORE=true every orderable product is a sample. Staff-created products
 * and discounts are stamped as samples, the storefront shows and sells only samples, and sample orders can be tracked.
 */
let base, close, staffToken, category, sample, live, sequence = 0;

before(async () => {
  mock.method(mailer, 'send', async () => ({ provider: 'test', messageId: 'test-message' }));
  process.env.ENABLE_ORDER_RESERVATIONS = 'true';
  process.env.DEMONSTRATION_STORE = 'true';
  const admin = await prisma.admin.create({ data: {
    email: 'demonstration-store@example.test', username: 'demonstration-store', password: 'fixture-not-for-login', role: 'ADMIN',
  } });
  staffToken = generateToken({ adminId: admin.id });
  category = await prisma.category.create({ data: { name: 'Demonstration', slug: 'demonstration' } });
  [sample, live] = await Promise.all([product('store-sample', true), product('store-live', false)]);
  const started = await startServer({ host: '127.0.0.1', port: 0 });
  close = started.close;
  base = `http://127.0.0.1:${started.server.address().port}/api`;
});
after(async () => { process.env.DEMONSTRATION_STORE = 'false'; mock.restoreAll(); await close?.(); });

function product(slug, isDemo) {
  return prisma.product.create({
    data: {
      name: slug, slug, description: 'Demonstration store fixture', price: 1000, isActive: true, isDemo,
      category: { connect: { id: category.id } },
      variants: { create: { sku: slug.toUpperCase(), attributes: { size: 'One' }, stock: { create: { quantity: 50, minThreshold: 0, status: 'IN_STOCK' } } } },
    },
    include: { variants: true },
  });
}

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

async function customer() {
  const tag = `store-${++sequence}`;
  const user = await prisma.user.create({
    data: {
      email: `${tag}@example.test`, password: 'fixture-not-for-login', firstName: 'Store', lastName: tag,
      addresses: { create: { street: `${tag} street`, city: 'Mombasa', county: 'Mombasa' } },
    },
    include: { addresses: true },
  });
  return { ...user, token: generateToken({ userId: user.id }) };
}

const quote = (person, products) => call('/orders/quotes', { method: 'POST', token: person.token, body: {
  items: products.map((item) => ({ productId: item.id, variantId: item.variants[0].id, quantity: 1 })),
  addressId: person.addresses[0].id, deliveryMethod: 'STANDARD', couponCode: null, notes: null,
} });

/** Runs `check` with DEMONSTRATION_STORE switched off, restoring the switch afterwards. */
async function switchedOff(check) {
  process.env.DEMONSTRATION_STORE = 'false';
  try {
    return await check();
  } finally {
    process.env.DEMONSTRATION_STORE = 'true';
  }
}

test('on a demonstration store staff-created products and discounts are samples, whatever the request says', async () => {
  const body = { name: 'Created sample', description: 'Created on a demonstration store', price: 500, categoryId: category.id, isActive: true };
  const created = await call('/products', { method: 'POST', token: staffToken, body });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.isDemo, true);
  assert.equal((await prisma.product.findUnique({ where: { id: created.data.id } })).isDemo, true);
  const count = await prisma.product.count();
  const forged = await call('/products', { method: 'POST', token: staffToken, body: { ...body, name: 'Forged live product', isDemo: false } });
  assert.equal(forged.status, 400);
  assert.equal(await prisma.product.count(), count);

  // A sample designer can present a new sample product; without the switch new products are live and cannot use one.
  const designer = await prisma.designer.create({ data: {
    designerId: 'sample-designer', fullName: 'Sample Designer', specialty: 'Samples', location: '', isDemo: true,
  } });
  const designed = await call('/products', { method: 'POST', token: staffToken, body: { ...body, name: 'Designed sample', designerId: designer.id } });
  assert.equal(designed.status, 201, JSON.stringify(designed.data));
  assert.equal(designed.data.isDemo, true);
  await switchedOff(async () => {
    const plain = await call('/products', { method: 'POST', token: staffToken, body: { ...body, name: 'Live created' } });
    assert.deepEqual([plain.status, plain.data.isDemo], [201, false]);
    const refused = await call('/products', { method: 'POST', token: staffToken, body: { ...body, name: 'Live designed', designerId: designer.id } });
    assert.equal(refused.status, 400);
  });

  const offer = { name: 'Sample offer', type: 'PERCENTAGE', value: 10, applyTo: 'ALL', startDate: new Date().toISOString(), isActive: false };
  const discount = await call('/admin/discounts', { method: 'POST', token: staffToken, body: offer });
  assert.equal(discount.status, 201, JSON.stringify(discount.data));
  assert.equal(discount.data.isDemo, true);
  assert.equal((await prisma.discount.findUnique({ where: { id: discount.data.id } })).isDemo, true);
});

test('the storefront shows and sells only samples: live products are hidden, unavailable in carts and refused by quotes', async () => {
  const person = await customer();
  const catalog = await call('/catalog');
  assert.equal(catalog.status, 200);
  const ids = catalog.data.products.map((item) => item.id);
  assert.ok(ids.includes(sample.id));
  assert.equal(ids.includes(live.id), false);
  assert.ok(catalog.data.products.every((item) => item.isDemo));
  assert.deepEqual([catalog.data.mode, catalog.data.demonstrationOrders], ['demo', true]);
  assert.equal((await call('/admin/catalog', { token: staffToken })).data.demonstrationOrders, true);
  assert.equal((await call(`/products/${live.id}`)).status, 404);
  assert.equal((await call(`/products/${sample.id}`)).status, 200);
  assert.ok((await call('/products?limit=100')).data.products.every((item) => item.isDemo));

  const add = (item) => call('/cart/items', { method: 'POST', token: person.token, body: { productId: item.id, variantId: item.variants[0].id, quantity: 1 } });
  assert.equal((await add(live)).status, 404);
  assert.equal((await add(sample)).status, 200);
  // A live product already in a cart, from before the switch, is shown as unavailable.
  const cart = await prisma.cart.findUnique({ where: { userId: person.id } });
  await prisma.cartItem.create({ data: { cartId: cart.id, productId: live.id, variantId: live.variants[0].id, quantity: 1, price: 1000 } });
  const items = (await call('/cart', { token: person.token })).data.items;
  assert.deepEqual(Object.fromEntries(items.map((item) => [item.productId, item.available])), { [sample.id]: true, [live.id]: false });

  for (const basket of [[live], [sample, live]]) {
    const refused = await quote(person, basket);
    assert.deepEqual([refused.status, refused.data.code], [409, 'ITEM_UNAVAILABLE']);
  }
  const accepted = await quote(person, [sample]);
  assert.deepEqual([accepted.status, accepted.data.mode], [201, 'demo']);

  // Without the switch (and no development opt-in) the storefront shows live products only and refuses samples.
  await switchedOff(async () => {
    const plain = await call('/catalog');
    assert.equal(plain.data.demonstrationOrders, false);
    assert.deepEqual([plain.data.products.some((item) => item.id === live.id), plain.data.products.some((item) => item.id === sample.id)], [true, false]);
    assert.equal((await quote(person, [sample])).data.code, 'ITEM_UNAVAILABLE');
  });
});

test('public tracking shows a sample order only where sample orders are enabled, in its fixed phrases', async () => {
  const person = await customer();
  const quoted = await quote(person, [sample]);
  const created = await call('/orders', { method: 'POST', token: person.token, key: randomUUID(), body: { quoteId: quoted.data.id } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.isDemo, true);
  const tracked = await call(`/orders/track/${created.data.orderNumber}`);
  assert.equal(tracked.status, 200, JSON.stringify(tracked.data));
  assert.deepEqual(tracked.data.trackingHistory.map((event) => [event.status, event.description, event.location]), [['PENDING', 'Order placed', null]]);
  await switchedOff(async () => assert.equal((await call(`/orders/track/${created.data.orderNumber}`)).status, 404));
});
