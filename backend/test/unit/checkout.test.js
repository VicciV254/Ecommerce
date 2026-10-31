import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import prisma from '../../src/config/database.js';
import { createCheckoutOrder } from '../../src/controllers/orderController.js';

let databaseCalls = 0;
prisma.$use(async () => {
  databaseCalls += 1;
  return { id: 'unexpected-test-write' };
});

test('legacy checkout rejects claims before any database operation', async () => {
  for (const paymentStatus of ['PAID', 'PENDING', undefined]) {
    const req = {
      user: { id: 'test-customer' },
      body: {
        items: [{ productId: 'test-product', quantity: 1, productPrice: 1000 }],
        paymentMethod: 'card',
        paymentStatus,
      },
    };
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    const next = mock.fn();
    await createCheckoutOrder(req, res, next);
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /checkout.*unavailable/i);
    assert.equal(databaseCalls, 0);
    assert.equal(next.mock.callCount(), 0);
  }
});
