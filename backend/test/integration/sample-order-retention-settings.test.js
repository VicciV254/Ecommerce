import assert from 'node:assert/strict';
import { after, before, beforeEach, mock, test } from 'node:test';
import { runMaintenance } from '../../src/services/maintenanceService.js';
import { purgeSampleOrders } from '../../src/services/sampleOrderRetentionService.js';
import {
  age, call, customer, exists, mpesaAttempt, paidSample, place, resetRetentionSettings, startRetentionStore,
  stopRetentionStore
} from '../sample-order-fixtures.js';

/*
 * Section A settings and views: the period is read each run (custom, largest, refused values, sample orders off), the
 * scheduled step runs it, the catalog states it and each customer order says whether it is scheduled for deletion.
 */
let close, admin, catalog;

before(async () => { ({ close, admin, catalog } = await startRetentionStore()); });
beforeEach(resetRetentionSettings);
after(() => stopRetentionStore(close));

test('the period is read each run: a custom value, the largest one, refused values by code, and nothing while sample orders are off', async () => {
  const person = await customer();
  const tenDays = await paidSample(person, [[catalog.mug, 1]]);
  const monthOld = await paidSample(person, [[catalog.mug, 1]]);
  await age([tenDays], 10);
  await age([monthOld], 31);
  process.env.SAMPLE_ORDER_RETENTION_DAYS = '30';
  assert.deepEqual(await purgeSampleOrders(), { deleted: 1, unchanged: 0, failed: {} });
  assert.deepEqual([await exists(tenDays), await exists(monthOld)], [true, false]);

  await age([tenDays], 40);
  const error = mock.method(console, 'error', () => {});
  try {
    for (const value of ['0', 'a week', '', '3651', '99999999999999999999', '-7']) {
      process.env.SAMPLE_ORDER_RETENTION_DAYS = value;
      assert.deepEqual(await runMaintenance(['sampleOrders']), { sampleOrders: { error: 'SAMPLE_RETENTION_CONFIGURATION' } }, JSON.stringify(value));
    }
  } finally {
    error.mock.restore();
  }
  process.env.SAMPLE_ORDER_RETENTION_DAYS = '3650';
  assert.deepEqual(await purgeSampleOrders(), { deleted: 0, unchanged: 0, failed: {} });
  delete process.env.SAMPLE_ORDER_RETENTION_DAYS;
  process.env.DEMONSTRATION_STORE = 'false';
  assert.deepEqual(await runMaintenance(['sampleOrders']), { sampleOrders: { skipped: 'SAMPLE_ORDERS_DISABLED' } });
  assert.ok(await exists(tenDays));
  // The scheduled step, as the daily cron and the optional worker run it, with the default of 7 days.
  process.env.DEMONSTRATION_STORE = 'true';
  assert.deepEqual(await runMaintenance(['sampleOrders']), { sampleOrders: { deleted: 1, unchanged: 0, failed: {} } });
  assert.equal(await exists(tenDays), false);
});

test('the catalog says how many days sample orders are kept, or null where none are deleted', async () => {
  const days = async (path = '/catalog', token) => {
    const response = await call(path, { token });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data.sampleOrderRetentionDays;
  };
  assert.equal(await days(), 7);
  assert.equal(await days('/admin/catalog', admin.token), 7);
  process.env.SAMPLE_ORDER_RETENTION_DAYS = '30';
  assert.equal(await days(), 30);
  for (const value of ['0', 'thirty', '3651']) {
    process.env.SAMPLE_ORDER_RETENTION_DAYS = value;
    assert.equal(await days(), null, value);
    assert.equal(await days('/admin/catalog', admin.token), null, value);
  }
  delete process.env.SAMPLE_ORDER_RETENTION_DAYS;
  process.env.DEMONSTRATION_STORE = 'false';
  assert.equal(await days(), null);
});

test('each customer order says whether it is a sample order scheduled for deletion', async () => {
  const person = await customer();
  const unpaid = await place(person, [[catalog.mug, 1]]);
  const paid = await paidSample(person, [[catalog.mug, 1]]);
  const attempted = await place(person, [[catalog.mug, 1]]);
  await mpesaAttempt(attempted, { status: 'FAILED' });
  process.env.DEMONSTRATION_STORE = 'false';
  const live = await place(person, [[catalog.live, 1]]);
  process.env.DEMONSTRATION_STORE = 'true';

  const listed = async () => {
    const response = await call('/orders?limit=100', { token: person.token });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return new Map(response.data.orders.map((order) => [order.id, order.scheduledForDeletion]));
  };
  assert.deepEqual(await listed(), new Map([[unpaid.id, true], [paid.id, true], [attempted.id, false], [live.id, false]]));
  for (const [order, scheduled] of [[unpaid, true], [attempted, false], [live, false]]) {
    assert.equal((await call(`/orders/${order.id}`, { token: person.token })).data.scheduledForDeletion, scheduled, order.orderNumber);
  }
  // The answers of actions carry it too.
  const cancelled = await call(`/orders/${unpaid.id}/cancel`, { method: 'POST', token: person.token, body: {} });
  assert.equal(cancelled.data.scheduledForDeletion, true);
  process.env.SAMPLE_ORDER_RETENTION_DAYS = '0';
  assert.deepEqual(await listed(), new Map([[unpaid.id, false], [paid.id, false], [attempted.id, false], [live.id, false]]));
  delete process.env.SAMPLE_ORDER_RETENTION_DAYS;
  process.env.DEMONSTRATION_STORE = 'false';
  assert.deepEqual(await listed(), new Map([[live.id, false]]));
});
