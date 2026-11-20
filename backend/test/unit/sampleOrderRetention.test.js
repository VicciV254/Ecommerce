import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { publicSampleOrderRetentionDays, sampleOrderRetentionDays } from '../../src/config/checkoutPolicy.js';
import { startBackgroundJobs } from '../../src/services/backgroundJobs.js';
import { maintenanceTasks, runMaintenance } from '../../src/services/maintenanceService.js';

/*
 * Section A of the P8 open items: visitors' sample orders are deleted SAMPLE_ORDER_RETENTION_DAYS (default 7) after
 * they are placed. The setting is read when the step runs; an invalid value stops only that step, by a stable code.
 */

/** Sets environment values (undefined removes one) for the rest of the test. */
function setEnv(t, values) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const apply = (entries) => {
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(values);
  t.after(() => apply(saved));
}

const isRetentionConfigurationError = (error) => error.statusCode === 503 && error.code === 'SAMPLE_RETENTION_CONFIGURATION' &&
  !/\d/.test(error.message.replace('1 to 3650', ''));

test('the retention period is a whole number of days from 1 to 3650, 7 by default; anything else is refused by code', () => {
  assert.equal(sampleOrderRetentionDays({}), 7);
  for (const [value, days] of [['1', 1], ['7', 7], ['30', 30], ['3650', 3650]]) {
    assert.equal(sampleOrderRetentionDays({ SAMPLE_ORDER_RETENTION_DAYS: value }), days, value);
  }
  for (const value of ['', '0', '-1', '1.5', 'seven', ' 7', '7 ', '1e3', '07', '+7', '3651', '10000', '99999999999999999999']) {
    assert.throws(() => sampleOrderRetentionDays({ SAMPLE_ORDER_RETENTION_DAYS: value }), isRetentionConfigurationError, JSON.stringify(value));
  }
});

test('visitors are told the period only while sample orders are enabled and the setting is valid', (t) => {
  setEnv(t, { DEMONSTRATION_STORE: 'true', ALLOW_DEMO_ORDERS: 'false', SAMPLE_ORDER_RETENTION_DAYS: undefined });
  assert.equal(publicSampleOrderRetentionDays(), 7);
  process.env.SAMPLE_ORDER_RETENTION_DAYS = '30';
  assert.equal(publicSampleOrderRetentionDays(), 30);
  for (const value of ['0', 'thirty', '3651']) {
    process.env.SAMPLE_ORDER_RETENTION_DAYS = value;
    assert.equal(publicSampleOrderRetentionDays(), null, value);
  }
  process.env.SAMPLE_ORDER_RETENTION_DAYS = '30';
  process.env.DEMONSTRATION_STORE = 'false';
  assert.equal(publicSampleOrderRetentionDays(), null);
  // Development sample orders count too.
  process.env.ALLOW_DEMO_ORDERS = 'true';
  assert.equal(publicSampleOrderRetentionDays(), 30);
});

test('an invalid period, read when the step runs, stops only the sample-order deletion and reports its code', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const name of ['payments', 'reservations', 'notifications']) t.mock.method(maintenanceTasks, name, async () => ({ ran: name }));
  setEnv(t, { DEMONSTRATION_STORE: 'true', SAMPLE_ORDER_RETENTION_DAYS: 'a week' });
  // Starting the optional worker does not read it either.
  setEnv(t, { NODE_ENV: 'development', BACKGROUND_JOBS_ENABLED: 'false' });
  startBackgroundJobs()();
  assert.deepEqual(await runMaintenance(), {
    reservations: { ran: 'reservations' }, payments: { ran: 'payments' }, notifications: { ran: 'notifications' },
    sampleOrders: { error: 'SAMPLE_RETENTION_CONFIGURATION' },
  });
});

test('where sample orders are off the step deletes nothing and says why', async (t) => {
  setEnv(t, { DEMONSTRATION_STORE: 'false', ALLOW_DEMO_ORDERS: 'false', SAMPLE_ORDER_RETENTION_DAYS: undefined });
  assert.deepEqual(await runMaintenance(['sampleOrders']), { sampleOrders: { skipped: 'SAMPLE_ORDERS_DISABLED' } });
});

test('the optional worker runs the sample-order step once an hour, apart from the other steps', async (t) => {
  setEnv(t, { NODE_ENV: 'development', BACKGROUND_JOBS_ENABLED: 'true' });
  t.mock.timers.enable({ apis: ['setInterval'] });
  const steps = Object.fromEntries(['payments', 'reservations', 'notifications', 'sampleOrders']
    .map((name) => [name, t.mock.method(maintenanceTasks, name, async () => ({}))]));
  const stop = startBackgroundJobs();
  t.after(stop);
  t.mock.timers.tick(3_599_999);
  await setImmediate();
  assert.equal(steps.sampleOrders.mock.callCount(), 0);
  assert.equal(steps.reservations.mock.callCount(), 1);
  t.mock.timers.tick(1);
  await setImmediate();
  assert.equal(steps.sampleOrders.mock.callCount(), 1);
  stop();
});
