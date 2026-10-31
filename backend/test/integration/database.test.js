import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import prisma from '../../src/config/database.js';
import { startServer } from '../../src/server.js';
import { generateToken, generateRefreshToken } from '../../src/config/auth.js';
import emailService from '../../src/services/emailService.js';
import defaults from '../../src/data/storefront-defaults.json' with { type: 'json' };
import { STOREFRONT_KEY } from '../../src/utils/catalogValidation.js';

test('migrations and API reads use the isolated database and shutdown releases the listener', async (t) => {
  const migrations = await prisma.$queryRaw`
    SELECT migration_name, finished_at, rolled_back_at
    FROM "_prisma_migrations" ORDER BY migration_name
  `;
  const expected = readdirSync(new URL('../../prisma/migrations/', import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.deepEqual(migrations.map((entry) => entry.migration_name), expected);
  assert.ok(migrations.every((entry) => entry.finished_at !== null && entry.rolled_back_at === null));
  const theme = { fontId: 'default', colorId: 'default' };
  await prisma.siteSetting.create({ data: { key: 'theme', value: theme } });
  const { server, close } = await startServer({ port: 0, host: '127.0.0.1' });
  t.after(close);
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
  const response = await fetch(`${base}/api/settings/storefront`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).settings, defaults);
  assert.equal((await fetch(`${base}/api/settings/theme`)).status, 410);
  const rejected = await fetch(`${base}/api/settings/storefront/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ colorId: 'changed-without-auth' }),
  });
  assert.equal(rejected.status, 401);
  assert.deepEqual((await prisma.siteSetting.findUnique({ where: { key: 'theme' } })).value, theme);
  await close();
  assert.equal(server.listening, false);
});

test('database-cart checkout creates a pending order with an image and decrements local stock', async (t) => {
  t.mock.method(emailService, 'sendOrderConfirmation', async () => ({ success: true }));
  const user = await prisma.user.create({
    data: {
      email: 'checkout@example.test',
      password: 'fixture-not-used-for-login',
      firstName: 'Test',
      lastName: 'Customer',
      addresses: { create: { street: 'Test Street', city: 'Test City', county: 'Test County' } },
    },
    include: { addresses: true },
  });
  const product = await prisma.product.create({
    data: {
      name: 'Test product',
      slug: 'test-product',
      description: 'An isolated checkout fixture',
      price: 1000,
      isActive: true,
      tags: [],
      category: { create: { name: 'Test category', slug: 'test-category' } },
      images: { create: { url: 'https://example.invalid/test-product.jpg', isMain: true } },
      variants: { create: { sku: 'TEST-CHECKOUT-SKU', attributes: { size: 'M' }, stock: { create: { quantity: 2 } } } },
    },
    include: { variants: true },
  });
  await prisma.cart.create({
    data: {
      userId: user.id,
      subtotal: 1000,
      total: 1000,
      items: { create: { productId: product.id, variantId: product.variants[0].id, quantity: 1, price: 1000 } },
    },
  });
  const { server, close } = await startServer({ port: 0, host: '127.0.0.1' });
  t.after(close);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${generateToken({ userId: user.id })}` },
    body: JSON.stringify({
      addressId: user.addresses[0].id,
      paymentMethod: 'MPESA',
      paymentStatus: 'PAID',
      status: 'DELIVERED',
      deliveryMethod: 'STANDARD',
    }),
  });
  assert.equal(response.status, 201);
  const order = await response.json();
  assert.equal(order.status, 'PENDING');
  assert.equal(order.paymentStatus, 'PENDING');
  assert.equal(order.user.id, user.id);
  assert.deepEqual(Object.keys(order.user).sort(), ['email', 'firstName', 'id', 'lastName', 'phone', 'profileImage']);
  assert.equal(order.items[0].productImage, 'https://example.invalid/test-product.jpg');
  assert.equal(order.items[0].variantId, product.variants[0].id);
  assert.equal(order.items[0].sku, 'TEST-CHECKOUT-SKU');
  assert.deepEqual(order.items[0].variantAttributes, { size: 'M' });
  assert.equal((await prisma.trackingEvent.findFirst({ where: { orderId: order.id } })).status, 'PENDING');
  assert.equal((await prisma.stock.findUnique({ where: { variantId: product.variants[0].id } })).quantity, 1);
  assert.equal(await prisma.cartItem.count(), 0);
});

test('cancellation restores only the ordered SKU once and rejects incomplete allocations atomically', async (t) => {
  t.mock.method(emailService, 'sendOrderConfirmation', async () => ({ success: true }));
  const cancellationEmail = t.mock.method(emailService, 'sendOrderCancellation', async () => ({ success: true }));
  const user = await prisma.user.create({
    data: {
      email: 'variant-cancellation@example.test', password: 'fixture-not-used-for-login',
      firstName: 'Variant', lastName: 'Customer',
      addresses: { create: { street: 'Test Street', city: 'Test City', county: 'Test County' } },
    },
    include: { addresses: true },
  });
  const product = await prisma.product.create({
    data: {
      name: 'Cancellation variants', slug: 'cancellation-variants', price: 1000,
      description: 'Isolated variant cancellation fixture', isActive: true,
      category: { create: { name: 'Cancellation category', slug: 'cancellation-category' } },
      variants: { create: [
        { sku: 'CANCEL-S', attributes: { size: 'S' }, stock: { create: { quantity: 1, minThreshold: 0, status: 'IN_STOCK' } } },
        { sku: 'CANCEL-L', attributes: { size: 'L' }, stock: { create: { quantity: 7, minThreshold: 0, status: 'IN_STOCK' } } },
      ] },
    },
    include: { variants: { include: { stock: true } } },
  });
  const selected = product.variants.find((variant) => variant.sku === 'CANCEL-S');
  const sibling = product.variants.find((variant) => variant.sku === 'CANCEL-L');
  await prisma.cart.create({ data: {
    userId: user.id, subtotal: 1000, total: 1000,
    items: { create: { productId: product.id, variantId: selected.id, quantity: 1, price: 1000 } },
  } });
  const { server, close } = await startServer({ port: 0, host: '127.0.0.1' });
  t.after(close);
  const base = `http://127.0.0.1:${server.address().port}/api/orders`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${generateToken({ userId: user.id })}` };
  const created = await fetch(base, {
    method: 'POST', headers,
    body: JSON.stringify({ addressId: user.addresses[0].id, paymentMethod: 'MPESA', deliveryMethod: 'STANDARD' }),
  });
  assert.equal(created.status, 201);
  const order = await created.json();
  const stock = (variantId) => prisma.stock.findUnique({ where: { variantId } });
  assert.equal((await stock(selected.id)).quantity, 0);
  assert.equal((await stock(selected.id)).status, 'OUT_OF_STOCK');
  const cancel = (id) => fetch(`${base}/${id}/cancel`, {
    method: 'POST', headers, body: JSON.stringify({ reason: 'Test cancellation' }),
  });
  const attempts = await Promise.all([cancel(order.id), cancel(order.id)]);
  assert.equal(attempts.filter((response) => response.status === 200).length, 1);
  assert.ok(attempts.some((response) => [400, 409].includes(response.status)));
  const cancelled = await attempts.find((response) => response.status === 200).json();
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal((await stock(selected.id)).quantity, 1);
  assert.equal((await stock(selected.id)).status, 'IN_STOCK');
  assert.equal((await stock(sibling.id)).quantity, 7);
  assert.equal(await prisma.stockLog.count({ where: { stockId: selected.stock.id, action: 'order-cancel' } }), 1);
  assert.equal(await prisma.trackingEvent.count({ where: { orderId: order.id, status: 'CANCELLED' } }), 1);
  assert.equal(cancellationEmail.mock.callCount(), 1);
  assert.equal((await cancel(order.id)).status, 400);
  assert.equal((await stock(selected.id)).quantity, 1);

  const incomplete = await prisma.order.create({ data: {
    orderNumber: 'TEST-INCOMPLETE-ALLOCATION', userId: user.id, addressId: user.addresses[0].id,
    subtotal: 2000, total: 2000, tax: 0, shippingCost: 0, paymentMethod: 'MPESA',
    items: { create: [selected.id, null].map((variantId) => ({
      productId: product.id, variantId, productName: product.name,
      productPrice: 1000, quantity: 1, subtotal: 1000,
    })) },
  } });
  assert.equal((await cancel(incomplete.id)).status, 409);
  assert.equal((await stock(selected.id)).quantity, 1);
  assert.equal((await stock(sibling.id)).quantity, 7);
  assert.equal((await prisma.order.findUnique({ where: { id: incomplete.id } })).status, 'PENDING');
  assert.equal(await prisma.trackingEvent.count({ where: { orderId: incomplete.id } }), 0);
  assert.equal(await prisma.stockLog.count({ where: { stockId: selected.stock.id, action: 'order-cancel' } }), 1);
  assert.equal(cancellationEmail.mock.callCount(), 1);
});

test('disabling an account invalidates existing access and refresh sessions', async (t) => {
  const user = await prisma.user.create({
    data: {
      email: 'disabled-session@example.test',
      password: 'fixture-not-used-for-login',
      firstName: 'Test',
      lastName: 'Session',
    },
  });
  const token = generateToken({ userId: user.id });
  const refreshToken = generateRefreshToken({ userId: user.id });
  const { server, close } = await startServer({ port: 0, host: '127.0.0.1' });
  t.after(close);
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await fetch(`${base}/api/auth/me`, { headers })).status, 200);
  await prisma.user.update({ where: { id: user.id }, data: { isDisabled: true } });
  assert.equal((await fetch(`${base}/api/auth/me`, { headers })).status, 403);
  assert.equal((await fetch(`${base}/api/orders`, { headers })).status, 403);
  const refresh = await fetch(`${base}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  assert.equal(refresh.status, 403);
  await prisma.user.update({ where: { id: user.id }, data: { isDisabled: false, emailVerified: false } });
  process.env.ENABLE_EMAIL_VERIFICATION = 'true';
  t.after(() => { process.env.ENABLE_EMAIL_VERIFICATION = 'false'; });
  assert.equal((await fetch(`${base}/api/auth/me`, { headers })).status, 403);
  const unverifiedRefresh = await fetch(`${base}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  assert.equal(unverifiedRefresh.status, 403);
});

test('customer, administrator and viewer boundaries are enforced by the API', async (t) => {
  const user = await prisma.user.create({
    data: {
      email: 'other-customer@example.test',
      password: 'fixture-not-used-for-login',
      firstName: 'Other',
      lastName: 'Customer',
    },
  });
  const admin = await prisma.admin.create({
    data: { email: 'viewer@example.test', username: 'test-viewer', password: 'fixture-password', role: 'VIEWER' },
  });
  const token = generateToken({ userId: user.id });
  const adminToken = generateToken({ adminId: admin.id });
  const order = await prisma.order.findFirst();
  assert.ok(order);
  const { server, close } = await startServer({ port: 0, host: '127.0.0.1' });
  t.after(close);
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/api/orders/${order.id}`, { headers: { Authorization: `Bearer ${token}` } })).status, 403);
  assert.equal((await fetch(`${base}/api/admin/me`, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${adminToken}` } })).status, 401);
  assert.equal((await fetch(`${base}/api/orders/admin/all`, { headers: { Authorization: `Bearer ${adminToken}` } })).status, 200);
  const forbidden = await fetch(`${base}/api/settings/storefront/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ colorId: 'unauthorized-write' }),
  });
  assert.equal(forbidden.status, 403);
  assert.deepEqual((await prisma.siteSetting.findUnique({ where: { key: STOREFRONT_KEY } })).value, defaults);
  await prisma.user.delete({ where: { id: user.id } });
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
});

test('legacy checkout is unavailable and cannot persist customer payment claims', async (t) => {
  const user = await prisma.user.create({
    data: {
      email: 'blocked-checkout@example.test',
      password: 'fixture-not-used-for-login',
      firstName: 'Test',
      lastName: 'Checkout',
    },
  });
  const product = await prisma.product.findFirstOrThrow();
  const snapshot = () => Promise.all([
    prisma.order.count(),
    prisma.address.count(),
    prisma.orderItem.count(),
    prisma.trackingEvent.count(),
  ]);
  const before = await snapshot();
  const { server, close } = await startServer({ port: 0, host: '127.0.0.1' });
  t.after(close);
  const url = `http://127.0.0.1:${server.address().port}/api/orders/checkout`;
  for (const paymentStatus of ['PAID', 'PENDING', undefined]) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${generateToken({ userId: user.id })}` },
      body: JSON.stringify({
        items: [{ productId: product.id, productName: product.name, quantity: 1, productPrice: 1000, subtotal: 1000 }],
        subtotal: 1000,
        total: 1000,
        paymentMethod: 'card',
        paymentStatus,
        address: { street: 'Test street', city: 'Mombasa', county: 'Mombasa' },
      }),
    });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /checkout.*unavailable/i);
    assert.deepEqual(await snapshot(), before);
  }
});
