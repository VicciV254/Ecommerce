import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer } from '../../src/server.js';

/*
 * Only the account's own password changes it: naming an address is never enough. The template's reset endpoints
 * answered a reset token to anyone who named an address, and that token set a new password.
 */
let base, close;

before(async () => {
  const started = await startServer({ host: '127.0.0.1', port: 0 });
  close = started.close;
  base = `http://127.0.0.1:${started.server.address().port}/api`;
});
after(async () => { await close?.(); });

async function call(path, body) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}

test('naming an address is not enough to change its password', async () => {
  const email = 'reset-owner@example.test';
  const password = 'original horse battery';
  assert.equal((await call('/auth/register', { email, password, firstName: 'Owner', lastName: 'Account' })).status, 201);
  const asked = await call('/auth/forgot-password', { email });
  assert.equal(asked.data.token, undefined, `a reset token was handed out: ${JSON.stringify(asked.data)}`);
  const reset = await call('/auth/reset-password', { token: asked.data.token ?? 'not-a-token', password: 'attacker chosen password' });
  assert.notEqual(reset.status, 200, JSON.stringify(reset.data));
  assert.equal((await call('/auth/login', { email, password })).status, 200, 'the owner still signs in with their own password');
});
