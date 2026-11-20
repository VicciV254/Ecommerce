import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';

/*
 * Unsuccessful sign-ups, sign-ins and verification resends from one client address share one count (5 in 15
 * minutes), on top of the sign-up limit. Any of them may have used it up, so its refusal names no single action and
 * carries a code. These bodies are refused by validation, before any database access.
 */
let base, server;

before(async () => {
  const { default: app } = await import('../../src/app.js');
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api/auth`;
});
after(() => new Promise((resolve) => server.close(resolve)));

async function post(path, body) {
  const response = await fetch(`${base}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

test('unsuccessful sign-ups and sign-ins share one count, and its refusal fits each of them', async () => {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.equal((await post('register', { email: 'not-an-address' })).status, 400, `attempt ${attempt} is answered`);
  }
  const refusal = { error: 'Too many unsuccessful attempts from this network. Try again later.', code: 'AUTH_RATE_LIMIT' };
  assert.deepEqual(await post('register', { email: 'not-an-address' }), { status: 429, body: refusal });
  assert.deepEqual(await post('login', { email: 'not-an-address' }), { status: 429, body: refusal });
});
