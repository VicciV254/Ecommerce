import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { startBackgroundJobs } from '../../src/services/backgroundJobs.js';
import autoStageService from '../../src/services/autoStageService.js';
import refundNotificationService from '../../src/services/refundNotificationService.js';
import inventoryService from '../../src/services/inventoryService.js';
import paymentService from '../../src/services/paymentService.js';

function configure(t, environment, enabled) {
  const old = { environment: process.env.NODE_ENV, enabled: process.env.BACKGROUND_JOBS_ENABLED };
  process.env.NODE_ENV = environment;
  process.env.BACKGROUND_JOBS_ENABLED = enabled;
  t.after(() => {
    process.env.NODE_ENV = old.environment;
    process.env.BACKGROUND_JOBS_ENABLED = old.enabled;
  });
}

test('test mode refuses background work even when explicitly enabled', (t) => {
  configure(t, 'test', 'true');
  const intervals = t.mock.method(globalThis, 'setInterval', () => { throw new Error('Unexpected timer'); });
  startBackgroundJobs()();
  assert.equal(intervals.mock.callCount(), 0);
});

test('disabled jobs and malformed settings do not create timers', (t) => {
  configure(t, 'development', 'false');
  const intervals = t.mock.method(globalThis, 'setInterval', () => { throw new Error('Unexpected timer'); });
  startBackgroundJobs()();
  process.env.BACKGROUND_JOBS_ENABLED = 'yes';
  assert.throws(() => startBackgroundJobs(), /must be true or false/);
  assert.equal(intervals.mock.callCount(), 0);
});

test('enabled jobs retain their cadence and stop cleanly', async (t) => {
  configure(t, 'development', 'true');
  t.mock.timers.enable({ apis: ['setInterval'] });
  const stages = t.mock.method(autoStageService, 'processAutoStages', async () => {});
  const refunds = t.mock.method(refundNotificationService, 'processPendingRefundNotifications', async () => {});
  const reservations = t.mock.method(inventoryService, 'expireReservations', async () => {});
  const payments = t.mock.method(paymentService, 'reconcileDuePayments', async () => {});
  const stop = startBackgroundJobs();
  t.after(stop);
  t.mock.timers.tick(10_000);
  await setImmediate();
  assert.equal(stages.mock.callCount(), 1);
  assert.equal(refunds.mock.callCount(), 0);
  assert.equal(reservations.mock.callCount(), 0);
  assert.equal(payments.mock.callCount(), 0);
  t.mock.timers.tick(50_000);
  await setImmediate();
  assert.equal(refunds.mock.callCount(), 1);
  assert.equal(reservations.mock.callCount(), 1);
  assert.ok(payments.mock.callCount() >= 1);
  stop();
  const counts = [stages.mock.callCount(), refunds.mock.callCount(), reservations.mock.callCount(), payments.mock.callCount()];
  t.mock.timers.tick(60_000);
  await setImmediate();
  assert.deepEqual([stages.mock.callCount(), refunds.mock.callCount(), reservations.mock.callCount(), payments.mock.callCount()], counts);
});

test('a slow job cannot overlap its next scheduled run', async (t) => {
  configure(t, 'development', 'true');
  t.mock.timers.enable({ apis: ['setInterval'] });
  let finish;
  const stages = t.mock.method(autoStageService, 'processAutoStages', () => new Promise((resolve) => { finish = resolve; }));
  const stop = startBackgroundJobs();
  t.after(stop);
  t.mock.timers.tick(20_000);
  assert.equal(stages.mock.callCount(), 1);
  finish();
  await setImmediate();
  stop();
});
