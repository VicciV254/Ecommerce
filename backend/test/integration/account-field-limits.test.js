import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import prisma from '../../src/config/database.js';
import { generateToken } from '../../src/config/auth.js';
import { startServer } from '../../src/server.js';

/*
 * What a shopper types into an address, the sign-up form or the profile is bounded on the server too, at the lengths
 * the forms allow (src/store/addressModel.ts and the name and phone fields): a longer value is refused with 400 and
 * nothing is stored.
 */
const LIMITS = { street: 200, city: 100, county: 100, postalCode: 20, firstName: 100, lastName: 100, phone: 20 };
const text = (length) => 'x'.repeat(length);
let base, close, accounts = 0;

before(async () => {
  const started = await startServer({ host: '127.0.0.1', port: 0 });
  close = started.close;
  base = `http://127.0.0.1:${started.server.address().port}/api`;
});
after(async () => { await close?.(); });

async function call(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

async function account() {
  accounts += 1;
  const user = await prisma.user.create({ data: {
    email: `limits-${accounts}@example.test`, password: 'not-used-for-login', firstName: 'Achieng', lastName: 'Odhiambo', emailVerified: true,
  } });
  return { user, token: generateToken({ userId: user.id }) };
}

const refusedField = (answer, field) => {
  assert.equal(answer.status, 400, JSON.stringify(answer.data).slice(0, 200));
  assert.ok(answer.data.details?.some((detail) => detail.path === field), `${field} is named: ${JSON.stringify(answer.data.details)}`);
};

test('an address is stored at the form limits and refused one character past any of them', async () => {
  const { user, token } = await account();
  const full = { street: text(LIMITS.street), city: text(LIMITS.city), county: text(LIMITS.county), postalCode: text(LIMITS.postalCode) };
  const stored = await call('/auth/addresses', { method: 'POST', token, body: full });
  assert.equal(stored.status, 201, JSON.stringify(stored.data).slice(0, 200));
  for (const field of ['street', 'city', 'county', 'postalCode']) {
    refusedField(await call('/auth/addresses', { method: 'POST', token, body: { ...full, [field]: text(LIMITS[field] + 1) } }), field);
    refusedField(await call(`/auth/addresses/${stored.data.id}`, { method: 'PUT', token, body: { [field]: text(LIMITS[field] + 1) } }), field);
  }
  const addresses = await prisma.address.findMany({ where: { userId: user.id } });
  assert.deepEqual(addresses.map(({ street, city, county, postalCode }) => ({ street, city, county, postalCode })), [full]);
});

test('sign-up is refused for a name or phone past the form limits, and no account is opened', async () => {
  const signUp = (email, extra) => call('/auth/register', {
    method: 'POST', body: { email, password: 'correct horse battery', firstName: 'Achieng', lastName: 'Odhiambo', ...extra },
  });
  assert.equal((await signUp('limits-at@example.test', { firstName: text(LIMITS.firstName), lastName: text(LIMITS.lastName), phone: text(LIMITS.phone) })).status, 201);
  for (const field of ['firstName', 'lastName', 'phone']) {
    const email = `limits-past-${field.toLowerCase()}@example.test`;
    refusedField(await signUp(email, { [field]: text(LIMITS[field] + 1) }), field);
    assert.equal(await prisma.user.count({ where: { email } }), 0);
  }
});

test('a profile change past the form limits, or of the wrong type, is refused and changes nothing', async () => {
  const { user, token } = await account();
  const changed = await call('/auth/profile', { method: 'PUT', token, body: { firstName: text(LIMITS.firstName), lastName: 'Odhiambo', phone: text(LIMITS.phone) } });
  assert.equal(changed.status, 200, JSON.stringify(changed.data).slice(0, 200));
  for (const [field, value] of [['firstName', text(LIMITS.firstName + 1)], ['lastName', text(LIMITS.lastName + 1)], ['phone', text(LIMITS.phone + 1)], ['firstName', { name: 'x' }]]) {
    refusedField(await call('/auth/profile', { method: 'PUT', token, body: { [field]: value } }), field);
  }
  const after = await prisma.user.findUnique({ where: { id: user.id }, select: { firstName: true, lastName: true, phone: true } });
  assert.deepEqual(after, { firstName: text(LIMITS.firstName), lastName: 'Odhiambo', phone: text(LIMITS.phone) });
});
