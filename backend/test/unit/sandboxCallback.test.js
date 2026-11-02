import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import prisma from '../../src/config/database.js';
import { assertSandboxCallbackConfig, createSandboxCallbackApp, startSandboxCallback } from '../../src/sandboxCallbackServer.js';

const safe = {
  NODE_ENV: 'development', ENABLE_SANDBOX_CALLBACK: 'true', MPESA_ENVIRONMENT: 'sandbox',
  MPESA_LIVE_PAYMENTS_ENABLED: 'false', BACKGROUND_JOBS_ENABLED: 'false',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:55434/apex_development_mpesa_sandbox',
  DIRECT_URL: 'postgresql://test:test@127.0.0.1:55434/apex_development_mpesa_sandbox',
};
let lookups = 0;
prisma.$use(async (params) => {
  assert.equal(params.model, 'MpesaPayment');
  assert.equal(params.action, 'findFirst');
  lookups++;
  return null;
});

test('callback listener refuses live mode, hosted targets, mixed databases, jobs and missing explicit opt-in', () => {
  assert.equal(assertSandboxCallbackConfig(safe), 4285);
  for (const change of [
    { NODE_ENV: 'production' }, { ENABLE_SANDBOX_CALLBACK: 'false' }, { MPESA_ENVIRONMENT: 'production' },
    { MPESA_LIVE_PAYMENTS_ENABLED: 'true' }, { BACKGROUND_JOBS_ENABLED: 'true' }, { SANDBOX_CALLBACK_PORT: '80' },
    { DATABASE_URL: 'postgresql://test:test@remote.example.test/apex_development_mpesa_sandbox' },
    { DIRECT_URL: 'postgresql://test:test@127.0.0.1:55434/apex_development_other' },
  ]) assert.throws(() => assertSandboxCallbackConfig({ ...safe, ...change }));
});

test('the callback application rejects storefront, health, auth, staff and payment initiation routes', async (t) => {
  const server = createSandboxCallbackApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const before = lookups;
  for (const path of ['/', '/api/health', '/api/catalog', '/api/auth/login', '/api/admin', '/api/mpesa/stk-push', '/api/mpesa/orders/test/payments']) {
    for (const method of ['GET', 'POST']) assert.equal((await fetch(`${base}${path}`, { method })).status, 404);
  }
  assert.equal(lookups, before);
  const callback = `${base}/api/mpesa/callback/${'00000000-0000-0000-0000-000000000000'}/${'0'.repeat(64)}`;
  assert.equal((await fetch(callback)).status, 404);
  assert.equal((await fetch(callback, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await fetch(callback, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
  assert.equal(lookups, before + 1);
  assert.equal((await fetch(callback, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"large":"' + 'x'.repeat(40_000) + '"}' })).status, 413);
});

test('the startup entrypoint uses only the callback application, never the main API', async (t) => {
  const previous = { ...process.env };
  Object.assign(process.env, safe, { NODE_ENV: 'test', SANDBOX_CALLBACK_PORT: '0' });
  t.after(() => {
    for (const key of Object.keys(safe).concat('SANDBOX_CALLBACK_PORT')) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  t.mock.method(prisma, '$connect', async () => {});
  const { server, close } = await startSandboxCallback();
  t.after(close);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  assert.equal(response.status, 404);
  assert.equal(server.address().address, '127.0.0.1');
});
