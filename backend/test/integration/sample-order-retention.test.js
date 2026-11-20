import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import prisma from '../../src/config/database.js';
import { expireReservations } from '../../src/services/inventoryService.js';
import { purgeSampleOrders } from '../../src/services/sampleOrderRetentionService.js';
import {
  COLLECT, DELIVER, NO_ROWS, age, call, customer, demonstrationRefunds, exists, orderRows, paidSample, place, play,
  purgeLogs, resetRetentionSettings, returned, startRetentionStore, stockOf, stopRetentionStore
} from '../sample-order-fixtures.js';

/*
 * P8 open items, section A, on a real database: visitors' sample orders are deleted SAMPLE_ORDER_RETENTION_DAYS (7)
 * after they are placed, giving back the stock they still hold. This file: committed, held, expired and cancelled
 * orders. Each test ages only its own orders and leaves none due, so every run's counts are its own.
 */
let close, admin, catalog;

before(async () => { ({ close, admin, catalog } = await startRetentionStore()); });
beforeEach(resetRetentionSettings);
after(() => stopRetentionStore(close));

test('committed sample orders give back what they still hold, Q − R per variant, and every record of theirs is deleted', async () => {
  const person = await customer();
  const { S, M, mug } = catalog;
  // A young unpaid order keeps 4 of S on hold throughout: the deletion must not touch reservations of others.
  const young = await place(person, [[S, 4]]);

  const pending = await paidSample(person, [[S, 2]]);
  const processing = await paidSample(person, [[S, 1]]);
  await play(person, processing.id, DELIVER.slice(0, 1));
  const shipped = await paidSample(person, [[S, 1]]);
  await play(person, shipped.id, DELIVER.slice(0, 2));
  const delivered = await paidSample(person, [[S, 3]]);
  await play(person, delivered.id, DELIVER);
  const pickup = await paidSample(person, [[S, 1]], { deliveryMethod: 'STORE_PICKUP' });
  await play(person, pickup.id, COLLECT);
  const partial = await paidSample(person, [[S, 3]]);
  await play(person, partial.id, DELIVER);
  const partialReturn = await returned(person, partial, 1);
  const full = await paidSample(person, [[S, 2]]);
  await play(person, full.id, DELIVER);
  await returned(person, full, 2);
  const twice = await paidSample(person, [[S, 3]]);
  await play(person, twice.id, DELIVER);
  await returned(person, twice, 1);
  await returned(person, twice, 1);
  // Faulty units are received but not put back on sale (R = 0); an unreceived return restocks nothing yet.
  const faulty = await paidSample(person, [[S, 2]]);
  await play(person, faulty.id, DELIVER);
  await returned(person, faulty, 1, { reason: 'FAULTY' });
  const unreceived = await paidSample(person, [[S, 2]]);
  await play(person, unreceived.id, DELIVER);
  await returned(person, unreceived, 1, { receive: false });
  const refunded = await paidSample(person, [[S, 1]]);
  await play(person, refunded.id, DELIVER);
  await demonstrationRefunds(refunded, ['REQUESTED', 'APPROVED', 'PROCESSING', 'CONFIRMED', 'FAILED', 'UNRESOLVED', 'CANCELLED']);
  // Two lines on one variant are given back as one entry: 1 + 2 units.
  const doubled = await paidSample(person, [[S, 1]]);
  await prisma.$transaction([
    prisma.orderItem.create({ data: {
      orderId: doubled.id, productId: S.productId, variantId: S.id, productName: 'retention-shirt', productPrice: 1000, quantity: 2, subtotal: 2000,
    } }),
    prisma.stock.update({ where: { variantId: S.id }, data: { quantity: { decrement: 2 } } }),
  ]);
  const mixed = await paidSample(person, [[S, 1], [mug, 2]]);
  const purged = [pending, processing, shipped, delivered, pickup, partial, full, twice, faulty, unreceived, refunded, doubled, mixed];
  const expected = { S: 2 + 1 + 1 + 3 + 1 + (3 - 1) + (2 - 2) + (3 - 2) + 2 + 2 + 1 + (1 + 2) + 1, mug: 2 };

  // Soft references: staff read-state for the order, its return, refund and email; a near-miss key and the young
  // order's key stay. An activity entry and restock history about the order are kept.
  const refund = await prisma.refund.findFirstOrThrow({ where: { orderId: partial.id } });
  const email = await prisma.notification.findFirstOrThrow({ where: { orderId: partial.id } });
  const keys = [`order-fulfil:${partial.id}`, `return:${partialReturn}:REQUESTED`, `refund:${refund.id}:REQUESTED`, `notification:${email.id}:DEAD:6`];
  const kept = [`order-fulfil:${young.id}`, `return:${partialReturn}0:REQUESTED`, `order-fulfil:${partial.id}x`];
  await prisma.staffAlertRead.createMany({ data: [...keys, ...kept].map((alertKey) => ({ adminId: admin.id, alertKey })) });
  await prisma.activityLog.create({ data: { adminId: admin.id, action: 'ORDER_NOTE', targetType: 'order', targetId: partial.id, details: 'fixture' } });
  const stock = await prisma.stock.findUniqueOrThrow({ where: { variantId: S.id } });
  await prisma.restockHistory.create({ data: { stockId: stock.id, quantity: 1, reason: 'fixture', adminId: admin.id } });
  assert.ok((await orderRows(purged)).notifications > 0, 'sample-order emails were recorded');

  const before = { S: await stockOf(S), M: await stockOf(M), mug: await stockOf(mug) };
  const logsBefore = await prisma.stockLog.count();
  await age(purged, 8);
  assert.deepEqual(await purgeSampleOrders(), { deleted: purged.length, unchanged: 0, failed: {} });

  assert.deepEqual(await stockOf(S), { quantity: before.S.quantity + expected.S, reserved: before.S.reserved });
  assert.equal(before.S.reserved, 4);
  assert.deepEqual(await stockOf(mug), { quantity: before.mug.quantity + expected.mug, reserved: before.mug.reserved });
  assert.deepEqual(await stockOf(M), before.M);
  // One entry per order and variant with something to give back (not the fully returned order); earlier logs stay.
  const logs = await purgeLogs(S);
  assert.equal(logs.length, purged.length - 1);
  assert.equal(logs.reduce((sum, log) => sum + log.newStock - log.previousStock, 0), expected.S);
  assert.equal((await purgeLogs(mug)).length, 1);
  assert.equal(await prisma.stockLog.count(), logsBefore + purged.length);

  assert.deepEqual(await orderRows(purged), NO_ROWS);
  assert.equal(await prisma.staffAlertRead.count({ where: { alertKey: { in: keys } } }), 0);
  assert.deepEqual((await prisma.staffAlertRead.findMany({ where: { alertKey: { in: kept } } })).map((row) => row.alertKey).sort(), [...kept].sort());
  assert.equal(await prisma.activityLog.count({ where: { targetId: partial.id } }), 1);
  assert.equal(await prisma.restockHistory.count({ where: { stockId: stock.id } }), 1);
  assert.equal(await prisma.user.count({ where: { id: person.id } }), 1);
  assert.equal(await prisma.address.count({ where: { userId: person.id } }), 1);
  assert.ok(await exists(young));
  assert.deepEqual(await purgeSampleOrders(), { deleted: 0, unchanged: 0, failed: {} });
});

test('a held reservation is released; expired and cancelled orders, paid or not, hold nothing more to give back', async () => {
  const person = await customer();
  const { S } = catalog;
  // HELD past the period cannot happen while reservations expire; it is simulated by ageing only the placing time.
  const held = await place(person, [[S, 2]]);
  const expired = await place(person, [[S, 1]]);
  await prisma.order.update({ where: { id: expired.id }, data: { reservationExpiresAt: new Date(Date.now() - 1000) } });
  await expireReservations();
  const unpaidCancel = await place(person, [[S, 1]]);
  const paidCancel = await paidSample(person, [[S, 1]]);
  for (const order of [unpaidCancel, paidCancel]) {
    const cancelled = await call(`/orders/${order.id}/cancel`, { method: 'POST', token: person.token, body: { reason: 'Changed plans' } });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  }
  const states = await prisma.order.findMany({ where: { id: { in: [held.id, expired.id, unpaidCancel.id, paidCancel.id] } } });
  assert.deepEqual(new Map(states.map((order) => [order.id, `${order.status}/${order.reservationStatus}`])), new Map([
    [held.id, 'PENDING/HELD'], [expired.id, 'CANCELLED/EXPIRED'], [unpaidCancel.id, 'CANCELLED/RELEASED'], [paidCancel.id, 'CANCELLED/RELEASED'],
  ]));
  assert.equal(await prisma.refund.count({ where: { orderId: paidCancel.id, method: 'DEMONSTRATION' } }), 1);

  const before = await stockOf(S);
  const logs = (await purgeLogs(S)).length;
  const orders = [held, expired, unpaidCancel, paidCancel];
  await age(orders, 8);
  assert.deepEqual(await purgeSampleOrders(), { deleted: 4, unchanged: 0, failed: {} });
  assert.deepEqual(await stockOf(S), { quantity: before.quantity, reserved: before.reserved - 2 });
  const added = (await purgeLogs(S)).slice(logs);
  assert.deepEqual(added.map((log) => log.newStock - log.previousStock), [2]);
  assert.deepEqual(await orderRows(orders), NO_ROWS);
});
