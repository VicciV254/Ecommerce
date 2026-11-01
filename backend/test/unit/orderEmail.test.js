import assert from 'node:assert/strict';
import { test } from 'node:test';
import nodemailer from 'nodemailer';
import { Prisma } from '@prisma/client';

test('pending-order email is explicitly unpaid and includes the stored discount without contacting SMTP', async (t) => {
  const sendMail = t.mock.fn(async () => ({ messageId: 'local-template-test' }));
  t.mock.method(nodemailer, 'createTransport', () => ({ sendMail }));
  const { default: emailService } = await import('../../src/services/emailService.js?pending-template-test');
  await emailService.sendOrderConfirmation({
    orderNumber: 'NM-TEMPLATE', createdAt: new Date(), paymentStatus: 'PENDING', paymentMethod: 'MPESA',
    reservationExpiresAt: new Date('2030-01-01T12:00:00Z'),
    subtotal: new Prisma.Decimal(1000), discount: new Prisma.Decimal(100),
    tax: new Prisma.Decimal(144), shippingCost: new Prisma.Decimal(200), total: new Prisma.Decimal(1244),
    items: [{ productName: 'Test product', quantity: 1, productPrice: new Prisma.Decimal(900), subtotal: new Prisma.Decimal(900) }],
  }, { email: 'recipient@example.test', firstName: 'Test' });
  assert.equal(sendMail.mock.callCount(), 1);
  const message = sendMail.mock.calls[0].arguments[0];
  assert.match(message.subject, /payment pending/);
  assert.match(message.html, /no payment has been received/);
  assert.match(message.html, /unpaid reservation can expire/);
  assert.match(message.html, /-KES 100/);
});
