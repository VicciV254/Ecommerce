import assert from 'node:assert/strict';
import { test } from 'node:test';
import prisma from '../../src/config/database.js';
import { startServer } from '../../src/server.js';
import { generateToken } from '../../src/config/auth.js';
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
      deliveryMethod: 'STANDARD',
    }),
  });
  assert.equal(response.status, 201);
  const order = await response.json();
  assert.equal(order.status, 'PENDING');
  assert.equal(order.paymentStatus, 'PENDING');
  assert.equal(order.items[0].productImage, 'https://example.invalid/test-product.jpg');
  assert.equal((await prisma.trackingEvent.findFirst({ where: { orderId: order.id } })).status, 'PENDING');
  assert.equal((await prisma.stock.findUnique({ where: { productId: product.id } })).quantity, 1);
  assert.equal(await prisma.cartItem.count(), 0);
});
