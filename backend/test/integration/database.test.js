import assert from 'node:assert/strict';
import { test } from 'node:test';
import prisma from '../../src/config/database.js';
import { startServer } from '../../src/server.js';
import { generateToken, generateRefreshToken } from '../../src/config/auth.js';
import emailService from '../../src/services/emailService.js';

test('migrations and API reads use the isolated database and shutdown releases the listener', async (t) => {
  const theme = { fontId: 'default', colorId: 'default' };
  await prisma.siteSetting.create({ data: { key: 'theme', value: theme } });
  const { server, close } = await startServer({ port: 0, host: '127.0.0.1' });
  t.after(close);
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
  const response = await fetch(`${base}/api/settings/theme`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), theme);
  const rejected = await fetch(`${base}/api/settings/theme`, {
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
      tags: [],
      category: { create: { name: 'Test category', slug: 'test-category' } },
      images: { create: { url: 'https://example.invalid/test-product.jpg', isMain: true } },
      stock: { create: { quantity: 2 } },
    },
  });
  await prisma.cart.create({
    data: {
      userId: user.id,
      subtotal: 1000,
      total: 1000,
      items: { create: { productId: product.id, quantity: 1, price: 1000 } },
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
  assert.equal((await prisma.trackingEvent.findFirst({ where: { orderId: order.id } })).status, 'PENDING');
  assert.equal((await prisma.stock.findUnique({ where: { productId: product.id } })).quantity, 1);
  assert.equal(await prisma.cartItem.count(), 0);
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
  const forbidden = await fetch(`${base}/api/settings/theme`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ colorId: 'unauthorized-write' }),
  });
  assert.equal(forbidden.status, 403);
  assert.equal((await prisma.siteSetting.findUnique({ where: { key: 'theme' } })).value.colorId, 'default');
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
