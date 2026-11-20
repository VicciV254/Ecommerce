import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { startBackgroundJobs } from '../../src/services/backgroundJobs.js';
import { authorizedMaintenance, maintenanceTasks, runMaintenance } from '../../src/services/maintenanceService.js';

function configure(t, environment, enabled) {
  const old = { environment: process.env.NODE_ENV, enabled: process.env.BACKGROUND_JOBS_ENABLED };
  process.env.NODE_ENV = environment;
  process.env.BACKGROUND_JOBS_ENABLED = enabled;
  t.after(() => {
    process.env.NODE_ENV = old.environment;
    process.env.BACKGROUND_JOBS_ENABLED = old.enabled;
  });
}

function mockSteps(t, overrides = {}) {
  return Object.fromEntries(['payments', 'reservations', 'notifications', 'sampleOrders'].map((name) => [
    name, t.mock.method(maintenanceTasks, name, overrides[name] ?? (async () => ({}))),
  ]));
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

test('payments reconcile every 15 seconds, other upkeep every minute, and stop cleanly', async (t) => {
  configure(t, 'development', 'true');
  t.mock.timers.enable({ apis: ['setInterval'] });
  const steps = mockSteps(t);
  const stop = startBackgroundJobs();
  t.after(stop);
  t.mock.timers.tick(15_000);
  await setImmediate();
  assert.equal(steps.payments.mock.callCount(), 1);
  assert.equal(steps.reservations.mock.callCount(), 0);
  assert.equal(steps.notifications.mock.callCount(), 0);
  t.mock.timers.tick(45_000);
  await setImmediate();
  assert.equal(steps.reservations.mock.callCount(), 1);
  assert.equal(steps.notifications.mock.callCount(), 1);
  assert.ok(steps.payments.mock.callCount() >= 2);
  stop();
  const counts = Object.values(steps).map((step) => step.mock.callCount());
  t.mock.timers.tick(60_000);
  await setImmediate();
  assert.deepEqual(Object.values(steps).map((step) => step.mock.callCount()), counts);
});

test('a slow step cannot overlap its next scheduled run', async (t) => {
  configure(t, 'development', 'true');
  t.mock.timers.enable({ apis: ['setInterval'] });
  let finish;
  const steps = mockSteps(t, { payments: () => new Promise((resolve) => { finish = resolve; }) });
  const stop = startBackgroundJobs();
  t.after(stop);
  t.mock.timers.tick(45_000);
  assert.equal(steps.payments.mock.callCount(), 1);
  finish();
  await setImmediate();
  stop();
});

test('one failing maintenance step does not block the others and reports only a code', async (t) => {
  t.mock.method(console, 'error', () => {});
  mockSteps(t, {
    reservations: async () => { throw Object.assign(new Error('connection detail'), { code: 'P1001' }); },
    payments: async () => undefined,
    notifications: async () => ({ sent: 1, failed: 0, dead: 0 }),
    sampleOrders: async () => ({ deleted: 2, unchanged: 0, failed: {} }),
  });
  assert.deepEqual(await runMaintenance(), {
    reservations: { error: 'P1001' }, payments: { ok: true }, notifications: { sent: 1, failed: 0, dead: 0 },
    sampleOrders: { deleted: 2, unchanged: 0, failed: {} },
  });
});

test('scheduled maintenance requires a configured bearer secret', () => {
  const secret = 'a'.repeat(32);
  assert.equal(authorizedMaintenance(`Bearer ${secret}`, ''), null);
  assert.equal(authorizedMaintenance('Bearer too-short', 'too-short'), null);
  assert.equal(authorizedMaintenance('Bearer has a space in it', 'has a space in it'), null);
  assert.equal(authorizedMaintenance(undefined, secret), false);
  assert.equal(authorizedMaintenance(secret, secret), false);
  assert.equal(authorizedMaintenance(`Bearer ${secret}x`, secret), false);
  assert.equal(authorizedMaintenance(`bearer ${secret}`, secret), false);
  assert.equal(authorizedMaintenance(`Bearer ${secret}`, secret), true);
});
