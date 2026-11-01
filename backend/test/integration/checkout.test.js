import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, mock, test } from 'node:test';
import bcrypt from 'bcryptjs';
import prisma from '../../src/config/database.js';
import { generateToken } from '../../src/config/auth.js';
import { startServer } from '../../src/server.js';
import { DEFAULT_CHECKOUT_POLICY } from '../../src/config/checkoutPolicy.js';
import { commitOrderReservation, expireReservations } from '../../src/services/inventoryService.js';
import emailService from '../../src/services/emailService.js';

let base, close, staffToken, sequence = 0;
let failCartId = null;
prisma.$use(async (params, next) => {
  if (failCartId && params.model === 'Cart' && params.action === 'update' && params.args.where.id === failCartId) {
    throw new Error('Injected cart write failure');
  }
  return next(params);
});
before(async () => {
  mock.method(emailService, 'sendOrderConfirmation', async () => ({ success: true }));
  mock.method(emailService, 'sendOrderCancellation', async () => ({ success: true }));
  process.env.ENABLE_ORDER_RESERVATIONS = 'true';
  const staff = await prisma.admin.create({ data: {
    email: 'quote-staff@example.test', username: 'quote-staff', password: 'fixture-not-for-login', role: 'ADMIN',
  } });
  staffToken = generateToken({ adminId: staff.id });
  const started = await startServer({ host: '127.0.0.1', port: 0 });
  close = started.close;
  base = `http://127.0.0.1:${started.server.address().port}/api`;
});
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

async function fixture({ quantity = 5, discount = 0, isDemo = false } = {}) {
  const tag = `quote-${++sequence}`;
  const people = await Promise.all(['one', 'two'].map((suffix) => prisma.user.create({
    data: {
      email: `${tag}-${suffix}@example.test`, password: 'fixture-not-for-login', firstName: 'Quote', lastName: suffix,
      addresses: { create: { street: `${tag} Original street`, city: 'Mombasa', county: 'Mombasa' } },
    },
    include: { addresses: true },
  })));
  const [user, other] = people.map((person) => ({ ...person, token: generateToken({ userId: person.id }) }));
  const product = await prisma.product.create({
    data: {
      name: `${tag} Product`, slug: tag, description: 'An isolated pricing fixture', price: 1000, isActive: true, isDemo,
      category: { create: { name: `${tag} category`, slug: `${tag}-category` } },
      images: { create: { url: 'https://example.test/product.jpg', isMain: true } },
      variants: { create: [
        { sku: `${tag}-M`, attributes: { size: 'M' }, stock: { create: { quantity, minThreshold: 0, status: quantity ? 'IN_STOCK' : 'OUT_OF_STOCK' } } },
        { sku: `${tag}-L`, attributes: { size: 'L' }, stock: { create: { quantity: 7, minThreshold: 0, status: 'IN_STOCK' } } },
      ] },
    },
    include: { variants: { orderBy: { sku: 'desc' } } },
  });
  const variant = product.variants.find((item) => item.sku.endsWith('-M'));
  const sibling = product.variants.find((item) => item.sku.endsWith('-L'));
  if (discount) await prisma.discount.create({ data: {
    name: `${tag} offer`, type: 'PERCENTAGE', value: discount, applyTo: 'SELECTED', targetIds: [product.id],
    startDate: new Date('2020-01-01'), isDemo,
  } });
  return { tag, user, other, product, variant, sibling };
}

function request(f, person = f.user, quantity = 1) {
  return {
    items: [{ productId: f.product.id, variantId: f.variant.id, quantity }],
    addressId: person.addresses[0].id, deliveryMethod: 'STANDARD', couponCode: null, notes: null,
  };
}
const quote = (f, person = f.user, quantity = 1, extra = {}) =>
  call('/orders/quotes', { method: 'POST', token: person.token, body: { ...request(f, person, quantity), ...extra } });
const place = (quoteId, person, key = randomUUID(), path = '/orders') =>
  call(path, { method: 'POST', token: person.token, key, body: { quoteId } });
const stock = (variantId) => prisma.stock.findUnique({ where: { variantId } });

test('cross-origin order submission allows the required idempotency header without widening origins', async () => {
  const origin = 'http://127.0.0.1:4173';
  const response = await fetch(`${base}/orders`, { method: 'OPTIONS', headers: {
    Origin: origin, 'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key',
  } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.ok(response.headers.get('access-control-allow-headers').toLowerCase().split(',').includes('idempotency-key'));
});

test('fresh login supplies the saved checkout addresses without requiring a profile reload', async () => {
  const f = await fixture();
  const password = 'test-only-login-password';
  await prisma.user.update({ where: { id: f.user.id }, data: { password: await bcrypt.hash(password, 4) } });
  const login = await call('/auth/login', { method: 'POST', body: { email: f.user.email, password } });
  assert.equal(login.status, 200);
  assert.deepEqual(login.data.user.addresses, [{
    id: f.user.addresses[0].id, street: f.user.addresses[0].street,
    city: 'Mombasa', county: 'Mombasa', postalCode: null, isDefault: false,
  }]);
  assert.equal('password' in login.data.user, false);
  assert.equal('otpCode' in login.data.user, false);
  assert.equal('userId' in login.data.user.addresses[0], false);
  const profile = await call('/auth/me', { token: login.data.token });
  assert.deepEqual(login.data.user.addresses, profile.data.addresses);
});

test('quotes use the same catalog price, calculate 16% VAT, and reject authoritative client fields', async () => {
  const f = await fixture({ discount: 10 });
  const product = await call(`/products/${f.product.id}`);
  assert.equal(typeof product.data.price, 'number');
  assert.equal(product.data.variants.find((item) => item.id === f.variant.id).pricing.price, 900);
  const result = await quote(f, f.user, 2);
  assert.equal(result.status, 201);
  assert.deepEqual([result.data.subtotal, result.data.discount, result.data.tax, result.data.shippingCost, result.data.total], [2000, 200, 288, 200, 2288]);
  assert.equal(result.data.lines[0].unitPrice, 900);
  assert.equal(result.data.lines[0].total, 1800);
  assert.equal(result.data.version, 1);
  assert.equal(result.data.reservationsEnabled, true);
  assert.equal((await call(`/orders/quotes/${result.data.id}`, { token: f.other.token })).status, 404);
  const before = await prisma.checkoutQuote.count();
  for (const field of ['total', 'tax', 'paymentStatus', 'userId']) {
    const invalid = await call('/orders/quotes', { method: 'POST', token: f.user.token, body: { ...request(f), [field]: 'PAID' } });
    assert.equal(invalid.status, 400);
  }
  assert.equal(await prisma.checkoutQuote.count(), before);
});

test('both creation routes persist pending snapshots, ignore stale cart prices, and never report a reservation as revenue', async () => {
  const f = await fixture({ discount: 10 });
  await prisma.cart.create({ data: {
    userId: f.user.id, subtotal: 1, total: 1,
    items: { create: { productId: f.product.id, variantId: f.variant.id, price: 1, quantity: 1 } },
  } });
  const quoted = await quote(f);
  const key = randomUUID();
  const created = await place(quoted.data.id, f.user, key, '/orders/checkout');
  assert.equal(created.status, 201);
  assert.deepEqual([created.data.status, created.data.paymentStatus, created.data.reservationStatus], ['PENDING', 'PENDING', 'HELD']);
  assert.equal(created.data.total, 1244);
  assert.equal(created.data.items[0].productPrice, 900);
  assert.equal(created.data.items[0].subtotal, 900);
  assert.equal(created.data.items[0].pricingSnapshot.discount, 100);
  assert.match(created.data.orderNumber, /^NM-\d{6}-[A-F0-9]{20}$/);
  assert.deepEqual(Object.keys(created.data.user).sort(), ['email', 'firstName', 'id', 'lastName', 'phone', 'profileImage']);
  assert.equal((await stock(f.variant.id)).quantity, 5);
  assert.equal((await stock(f.variant.id)).reserved, 1);
  assert.equal((await stock(f.sibling.id)).reserved, 0);
  assert.equal(await prisma.cartItem.count({ where: { cart: { userId: f.user.id } } }), 0);
  await prisma.address.update({ where: { id: f.user.addresses[0].id }, data: { street: 'Changed after order creation' } });
  await prisma.product.update({ where: { id: f.product.id }, data: { price: 2000, name: 'Renamed after order creation' } });
  const read = await call(`/orders/${created.data.id}`, { token: f.user.token });
  assert.equal(read.data.address.street, f.user.addresses[0].street);
  assert.equal(read.data.items[0].productName, f.product.name);
  assert.equal(read.data.total, 1244);
  const replayed = await place(quoted.data.id, f.user, key);
  assert.equal(replayed.status, 200);
  assert.equal(replayed.data.id, created.data.id);
  assert.equal((await stock(f.variant.id)).reserved, 1);
  const metrics = await call('/admin/analytics/dashboard', { token: staffToken });
  assert.equal(metrics.status, 200);
  assert.equal(metrics.data.sales.total, 0);
  assert.equal((await call(`/orders/admin/${created.data.id}/status`, { method: 'PUT', token: staffToken, body: { status: 'SHIPPED' } })).status, 409);
  assert.equal((await call(`/orders/${created.data.id}/pickup`, { method: 'POST', token: f.user.token, body: {} })).status, 409);
});

test('concurrent identical requests replay one order and keys are bound to actor and contents', async () => {
  const f = await fixture({ quantity: 10 });
  const quoted = await quote(f);
  const key = randomUUID();
  const results = await Promise.all([place(quoted.data.id, f.user, key), place(quoted.data.id, f.user, key)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 201]);
  assert.equal(results[0].data.id, results[1].data.id);
  assert.equal((await stock(f.variant.id)).reserved, 1);
  assert.equal(await prisma.order.count({ where: { quoteId: quoted.data.id } }), 1);
  const different = await quote(f);
  const conflict = await place(different.data.id, f.user, key);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.code, 'IDEMPOTENCY_CONFLICT');
  const otherQuote = await quote(f, f.other);
  assert.equal((await place(otherQuote.data.id, f.other, key)).status, 201);
  assert.equal((await stock(f.variant.id)).reserved, 2);
});

test('two buyers of the last unit create at most one order and leave no partial writes', async () => {
  const f = await fixture({ quantity: 1 });
  const [one, two] = await Promise.all([quote(f), quote(f, f.other)]);
  assert.equal(one.status, 201); assert.equal(two.status, 201);
  const results = await Promise.all([place(one.data.id, f.user), place(two.data.id, f.other)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  const current = await stock(f.variant.id);
  assert.equal(current.quantity, 1);
  assert.equal(current.reserved, 1);
  assert.equal(await prisma.order.count({ where: { items: { some: { variantId: f.variant.id } } } }), 1);
  assert.equal(await prisma.stockLog.count({ where: { stockId: current.id, action: 'reserve' } }), 1);
});

test('a failure after stock and cart changes rolls back every write and the same request can retry', async (t) => {
  const f = await fixture();
  const cart = await prisma.cart.create({ data: {
    userId: f.user.id, subtotal: 1000, total: 1000,
    items: { create: { productId: f.product.id, variantId: f.variant.id, quantity: 1, price: 1000 } },
  } });
  const quoted = await quote(f);
  const key = randomUUID();
  t.after(() => { failCartId = null; });
  failCartId = cart.id;
  assert.equal((await place(quoted.data.id, f.user, key)).status, 500);
  failCartId = null;
  assert.equal(await prisma.order.count({ where: { quoteId: quoted.data.id } }), 0);
  assert.equal((await stock(f.variant.id)).reserved, 0);
  assert.equal(await prisma.stockLog.count({ where: { stockId: (await stock(f.variant.id)).id } }), 0);
  assert.equal(await prisma.cartItem.count({ where: { cartId: cart.id } }), 1);
  assert.equal((await prisma.checkoutQuote.findUnique({ where: { id: quoted.data.id } })).consumedAt, null);
  const retried = await place(quoted.data.id, f.user, key);
  assert.equal(retried.status, 201);
  assert.equal((await stock(f.variant.id)).reserved, 1);
  assert.equal(await prisma.cartItem.count({ where: { cartId: cart.id } }), 0);
});

test('staff stock edits cannot steal held inventory and release preserves a later on-hand adjustment', async () => {
  const f = await fixture();
  const quoted = await quote(f, f.user, 3);
  const created = await place(quoted.data.id, f.user);
  const invalidStock = await call(`/admin/stock/${f.variant.id}`, { method: 'PUT', token: staffToken, body: { quantity: 2 } });
  assert.equal(invalidStock.status, 409);
  assert.equal(invalidStock.data.code, 'STOCK_RESERVED');
  const invalidProduct = await call(`/products/${f.product.id}`, {
    method: 'PUT', token: staffToken, body: { variants: [{ id: f.variant.id, stock: { quantity: 2 } }] },
  });
  assert.equal(invalidProduct.status, 409);
  assert.equal((await prisma.productVariant.findUnique({ where: { id: f.sibling.id } })).isActive, true);
  const adjusted = await call(`/admin/stock/${f.variant.id}`, { method: 'PUT', token: staffToken, body: { quantity: 4 } });
  assert.equal(adjusted.status, 200);
  assert.deepEqual([adjusted.data.quantity, adjusted.data.reserved, adjusted.data.available], [4, 3, 1]);
  const cancelled = await call(`/orders/${created.data.id}/cancel`, { method: 'POST', token: f.user.token, body: {} });
  assert.equal(cancelled.status, 200);
  assert.equal((await stock(f.variant.id)).quantity, 4);
  assert.equal((await stock(f.variant.id)).reserved, 0);
});

test('customer and staff cancellation release only the held units and retries do not restock twice', async () => {
  const f = await fixture({ quantity: 4 });
  const quoted = await quote(f, f.user, 2);
  const created = await place(quoted.data.id, f.user);
  const cancel = () => call(`/orders/${created.data.id}/cancel`, { method: 'POST', token: f.user.token, body: { reason: 'Changed my mind' } });
  const results = await Promise.all([cancel(), cancel()]);
  assert.ok(results.every((result) => result.status === 200));
  assert.equal((await cancel()).status, 200);
  assert.equal((await stock(f.variant.id)).quantity, 4);
  assert.equal((await stock(f.variant.id)).reserved, 0);
  assert.equal((await stock(f.sibling.id)).quantity, 7);
  assert.equal(await prisma.trackingEvent.count({ where: { orderId: created.data.id, status: 'CANCELLED' } }), 1);
  const another = await quote(f);
  const next = await place(another.data.id, f.user);
  const staffCancel = await call(`/orders/admin/${next.data.id}/status`, { method: 'PUT', token: staffToken, body: { status: 'CANCELLED' } });
  assert.equal(staffCancel.status, 200);
  assert.equal((await stock(f.variant.id)).reserved, 0);
  assert.equal(staffCancel.data.trackingHistory[0].location, 'Staff portal');
});

test('expiry releases inventory once and late settlement cannot silently acquire it again', async () => {
  const f = await fixture({ quantity: 2 });
  const quoted = await quote(f);
  const key = randomUUID();
  const created = await place(quoted.data.id, f.user, key);
  await prisma.order.update({ where: { id: created.data.id }, data: { reservationExpiresAt: new Date(Date.now() - 1000) } });
  const catalog = await call('/catalog');
  assert.equal(catalog.status, 200);
  assert.equal(catalog.data.products.find((product) => product.id === f.product.id).variants.find((variant) => variant.id === f.variant.id).stock, 2);
  await expireReservations();
  const order = await prisma.order.findUnique({ where: { id: created.data.id } });
  assert.equal(order.reservationStatus, 'EXPIRED');
  assert.equal(order.status, 'CANCELLED');
  assert.equal(order.paymentStatus, 'PENDING');
  await assert.rejects(prisma.$transaction((db) => commitOrderReservation(db, order.id)), (error) => error.code === 'RESERVATION_EXPIRED');
  assert.equal((await stock(f.variant.id)).quantity, 2);
  assert.equal((await stock(f.variant.id)).reserved, 0);
  assert.equal(await prisma.trackingEvent.count({ where: { orderId: order.id, status: 'CANCELLED' } }), 1);
  const retry = await place(quoted.data.id, f.user, key);
  assert.equal(retry.status, 200);
  assert.equal(retry.data.id, order.id);
  assert.equal(retry.data.reservationStatus, 'EXPIRED');
});

test('changed prices, addresses, delivery policy and expired quotes require a new reviewed quote', async (t) => {
  t.after(() => { delete process.env.CHECKOUT_POLICY_JSON; });
  for (const change of ['price', 'address', 'policy', 'expiry']) {
    const f = await fixture();
    const quoted = await quote(f);
    if (change === 'price') await prisma.product.update({ where: { id: f.product.id }, data: { price: 1200 } });
    if (change === 'address') await prisma.address.update({ where: { id: f.user.addresses[0].id }, data: { county: 'Nairobi' } });
    if (change === 'policy') process.env.CHECKOUT_POLICY_JSON = JSON.stringify({ ...DEFAULT_CHECKOUT_POLICY, version: 2 });
    if (change === 'expiry') await prisma.checkoutQuote.update({ where: { id: quoted.data.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const result = await place(quoted.data.id, f.user);
    assert.equal(result.status, 409, change);
    assert.equal(result.data.code, change === 'expiry' ? 'QUOTE_EXPIRED' : 'QUOTE_CHANGED', change);
    assert.equal((await stock(f.variant.id)).reserved, 0);
    assert.equal(await prisma.order.count({ where: { quoteId: quoted.data.id } }), 0);
    delete process.env.CHECKOUT_POLICY_JSON;
  }
});

test('coupons remain private to staff, apply once, and expiration cannot be bypassed with an old quote', async () => {
  const f = await fixture({ discount: 10 });
  const code = `SAVE${sequence}`;
  const coupon = await prisma.discount.create({ data: {
    name: `${f.tag} coupon`, couponCode: code, type: 'FIXED', value: 150,
    applyTo: 'SELECTED', targetIds: [f.product.id], startDate: new Date('2020-01-01'),
  } });
  const quoted = await quote(f, f.user, 1, { couponCode: code.toLowerCase() });
  assert.equal(quoted.status, 201);
  assert.equal(quoted.data.couponCode, code);
  assert.equal(quoted.data.discountedSubtotal, 850);
  assert.equal(quoted.data.tax, 136);
  assert.equal(quoted.data.total, 1186);
  const catalog = await call('/catalog');
  assert.equal(catalog.data.discounts.some((discount) => discount.id === coupon.id), false);
  await prisma.discount.update({ where: { id: coupon.id }, data: { endDate: new Date(Date.now() - 1000) } });
  const rejected = await place(quoted.data.id, f.user);
  assert.equal(rejected.status, 400);
  assert.equal(rejected.data.code, 'COUPON_INVALID');
  assert.equal((await stock(f.variant.id)).reserved, 0);
});

test('database cart mutations preserve the coupon and share the quote merchandise calculation', async () => {
  const f = await fixture({ discount: 10 });
  const code = `CART${sequence}`;
  await prisma.discount.create({ data: {
    name: `${f.tag} cart coupon`, couponCode: code, type: 'FIXED', value: 500,
    applyTo: 'SELECTED', targetIds: [f.product.id], startDate: new Date('2020-01-01'),
  } });
  const added = await call('/cart/items', { method: 'POST', token: f.user.token, body: {
    productId: f.product.id, variantId: f.variant.id, quantity: 2,
  } });
  assert.equal(added.status, 200);
  assert.equal(added.data.total, 1800);
  const applied = await call('/cart/coupon', { method: 'POST', token: f.user.token, body: { code } });
  assert.equal(applied.status, 200);
  assert.equal(applied.data.total, 1500);
  const changed = await call(`/cart/items/${added.data.items[0].id}`, { method: 'PUT', token: f.user.token, body: { quantity: 3 } });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.couponCode, code);
  assert.equal(changed.data.total, 2500);
  const quoted = await quote(f, f.user, 3, { couponCode: changed.data.couponCode });
  assert.equal(quoted.data.discountedSubtotal, changed.data.total);
  assert.equal(quoted.data.total, 3100);
  const removed = await call('/cart/coupon', { method: 'DELETE', token: f.user.token });
  assert.equal(removed.status, 200);
  assert.equal(removed.data.couponCode, null);
  assert.equal(removed.data.total, 2700);
});

test('ordering is explicitly gated and demo mode cannot be selected by a client or enabled in production', async (t) => {
  t.after(() => {
    process.env.NODE_ENV = 'test'; process.env.ALLOW_DEMO_CATALOG = 'false';
    process.env.ALLOW_DEMO_ORDERS = 'false'; process.env.ENABLE_ORDER_RESERVATIONS = 'true';
  });
  const real = await fixture();
  process.env.ENABLE_ORDER_RESERVATIONS = 'false';
  const quoted = await quote(real);
  assert.equal(quoted.data.reservationsEnabled, false);
  assert.equal((await place(quoted.data.id, real.user)).status, 503);
  process.env.ENABLE_ORDER_RESERVATIONS = 'true';
  const forged = await call('/orders/checkout', { method: 'POST', token: real.user.token, key: randomUUID(), body: { quoteId: quoted.data.id, paymentStatus: 'PAID', total: 1 } });
  assert.equal(forged.status, 400);
  const demo = await fixture({ isDemo: true });
  process.env.ALLOW_DEMO_CATALOG = 'true';
  assert.equal((await quote(demo)).data.code, 'DEMO_ORDER_UNAVAILABLE');
  process.env.ALLOW_DEMO_ORDERS = 'true';
  const demoQuote = await quote(demo);
  assert.equal(demoQuote.status, 201);
  assert.equal(demoQuote.data.mode, 'demo');
  const demoOrder = await place(demoQuote.data.id, demo.user);
  assert.equal(demoOrder.status, 201);
  assert.equal(demoOrder.data.isDemo, true);
  process.env.NODE_ENV = 'production';
  assert.equal((await quote(demo)).status, 409);
  assert.equal((await call(`/orders/${demoOrder.data.id}`, { token: demo.user.token })).status, 404);
});
