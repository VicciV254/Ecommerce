import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import prisma from '../../src/config/database.js';

/*
 * Security review note 2: successful sign-ups count towards a per-address limit, so accounts (and their sample-order
 * quotas) can't be created in bulk. Two an hour here, behind one trusted proxy as on Vercel; both are read when the
 * app loads, so they are set before it is imported.
 */
process.env.REGISTRATION_LIMIT_PER_HOUR = '2';
process.env.TRUST_PROXY_HOPS = '1';
const { startServer } = await import('../../src/server.js');
let base, close;

before(async () => {
  const started = await startServer({ host: '127.0.0.1', port: 0 });
  close = started.close;
  base = `http://127.0.0.1:${started.server.address().port}/api`;
});
after(async () => { await close?.(); });

async function register(email, address) {
  const response = await fetch(`${base}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': address },
    body: JSON.stringify({ email, password: 'correct horse battery staple', firstName: 'Limit', lastName: 'Check' }),
  });
  return { status: response.status, data: await response.json() };
}

test('every sign-up from one address counts, successful or not; another address has its own allowance', async () => {
  assert.equal((await register('limit-one@example.test', '203.0.113.5')).status, 201);
  assert.equal((await register('limit-two@example.test', '203.0.113.5')).status, 201);
  const refused = await register('limit-three@example.test', '203.0.113.5');
  assert.deepEqual([refused.status, refused.data.code], [429, 'REGISTRATION_LIMIT']);
  assert.equal(await prisma.user.count({ where: { email: 'limit-three@example.test' } }), 0);
  assert.equal((await register('limit-four@example.test', '198.51.100.7')).status, 201);
});
