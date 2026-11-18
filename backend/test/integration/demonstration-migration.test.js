import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, test } from 'node:test';
import prisma from '../../src/config/database.js';

/*
 * P8.6 §2 migrations: `PaymentMethod` gains DEMONSTRATION, and a confirmed refund needs its confirmation time and an
 * M-Pesa reference, unless it is a demonstration refund that belongs to no M-Pesa payment. References stay unique.
 */
let order, payment, sequence = 0;

before(async () => {
  const user = await prisma.user.create({ data: {
    email: 'refund-check@example.test', password: 'fixture-not-for-login', firstName: 'Refund', lastName: 'Check',
    addresses: { create: { street: 'Check street', city: 'Mombasa', county: 'Mombasa' } },
  }, include: { addresses: true } });
  order = await prisma.order.create({ data: {
    orderNumber: 'AC-REFUND-CHECK', userId: user.id, addressId: user.addresses[0].id, subtotal: 1000, tax: 160,
    shippingCost: 200, total: 1360, paymentMethod: 'DEMONSTRATION', paymentStatus: 'PAID', isDemo: true,
  } });
  payment = await prisma.mpesaPayment.create({ data: {
    orderId: order.id, phone: '254700000000', amount: 1360, status: 'SUCCEEDED', confirmedAt: new Date(),
    receiptNumber: 'CHECK00001', environment: 'sandbox', idempotencyKey: randomUUID(), requestHash: 'fixture',
    merchantIdentity: 'fixture-merchant', merchantShortcode: '174379', callbackKeyHash: '0'.repeat(64), reference: 'AC-CHECK-1',
  } });
});

/** Creates one refund with the given fields; resolves to 'accepted', or to why the database refused it. */
function refund(fields) {
  return prisma.refund.create({ data: {
    number: `RF-CHECK-${++sequence}`, orderId: order.id, source: 'CANCELLATION', amount: 100, requestedAmount: 100,
    requestedByType: 'CUSTOMER', ...fields,
  } }).then(() => 'accepted', (error) => {
    if (/Refund_confirmation_check/.test(error.message)) return 'check';
    if (error.code === 'P2002') return 'duplicate';
    throw error;
  });
}

const confirmed = { status: 'CONFIRMED', confirmedAt: new Date() };

test('the payment method enum has DEMONSTRATION', async () => {
  const [{ values }] = await prisma.$queryRaw`SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS values
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'PaymentMethod'`;
  assert.deepEqual(values, ['MPESA', 'CARD', 'BANK_TRANSFER', 'COD', 'DEMONSTRATION']);
  assert.equal((await prisma.order.findUnique({ where: { id: order.id } })).paymentMethod, 'DEMONSTRATION');
});

test('the database confirms a refund without a reference only for a demonstration refund with no M-Pesa payment', async () => {
  assert.equal(await refund({ ...confirmed, method: 'DEMONSTRATION' }), 'accepted');
  assert.equal(await refund({ status: 'CONFIRMED', method: 'DEMONSTRATION' }), 'check', 'confirmation time is still required');
  assert.equal(await refund({ ...confirmed }), 'check', 'an M-Pesa refund needs its reference');
  assert.equal(await refund({ ...confirmed, method: 'MPESA_MANUAL' }), 'check');
  assert.equal(await refund({ ...confirmed, method: 'DEMONSTRATION', paymentId: payment.id }), 'check', 'never for an M-Pesa payment');
  assert.equal(await refund({ ...confirmed, method: 'demonstration' }), 'check', 'the method is matched exactly');
  assert.equal(await refund({ ...confirmed, providerReference: 'CHECKREF01' }), 'accepted');
  assert.equal(await refund({ ...confirmed, method: 'DEMONSTRATION', providerReference: 'CHECKREF01' }), 'duplicate', 'references stay unique');
  assert.equal(await refund({ status: 'REQUESTED' }), 'accepted');

  // The same rule applies when an existing refund is confirmed.
  const requested = await prisma.refund.create({ data: {
    number: 'RF-CHECK-UPDATE', orderId: order.id, source: 'RETURN', amount: 50, requestedAmount: 50, requestedByType: 'CUSTOMER',
  } });
  await assert.rejects(prisma.refund.update({ where: { id: requested.id }, data: confirmed }), /Refund_confirmation_check/);
  await prisma.refund.update({ where: { id: requested.id }, data: { method: 'DEMONSTRATION' } });
  const done = await prisma.refund.update({ where: { id: requested.id }, data: confirmed });
  assert.deepEqual([done.status, done.providerReference], ['CONFIRMED', null]);
});
