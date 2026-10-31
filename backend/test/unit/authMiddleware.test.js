import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import prisma from '../../src/config/database.js';
import { generateToken } from '../../src/config/auth.js';
import { authenticate, optionalAuth } from '../../src/middleware/auth.js';
import { authenticateAdmin, authorize } from '../../src/middleware/adminAuth.js';

const accessSecret = process.env.JWT_SECRET;
const lookups = {};
prisma.$use((params) => {
  if (params.action !== 'findUnique' || !lookups[params.model]) {
    throw new Error(`Unmocked database operation: ${params.model}.${params.action}`);
  }
  return lookups[params.model](params.args);
});
beforeEach(() => {
  for (const model of ['User', 'Admin']) {
    lookups[model] = mock.fn(() => { throw new Error(`Unexpected ${model} lookup`); });
  }
});
afterEach(() => {
  mock.restoreAll();
  process.env.JWT_SECRET = accessSecret;
  process.env.ENABLE_EMAIL_VERIFICATION = 'false';
});

const customer = {
  id: 'customer', email: 'customer@example.test', firstName: 'Test', lastName: 'Customer',
  phone: null, profileImage: null, isDisabled: false, emailVerified: true, password: 'must-not-be-selected',
};

function selectCustomer(record) {
  lookups.User = mock.fn(async ({ select }) =>
    record && Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, record[key]])));
  return lookups.User;
}

async function run(middleware, token) {
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
  const res = {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const next = mock.fn();
  await middleware(req, res, next);
  return { req, res, next };
}

test('disabled state from the selected database fields blocks an existing token', async () => {
  selectCustomer({ ...customer, isDisabled: true });
  const { req, res, next } = await run(authenticate, generateToken({ userId: customer.id }));
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /disabled/);
  assert.equal(req.user, undefined);
  assert.equal(next.mock.callCount(), 0);
});

test('verified customer sessions include account state but never password data', async () => {
  selectCustomer(customer);
  const { req, res, next } = await run(authenticate, generateToken({ userId: customer.id }));
  assert.equal(res.statusCode, 200);
  assert.equal(req.user.id, customer.id);
  assert.equal(req.user.emailVerified, true);
  assert.equal(req.user.isDisabled, false);
  assert.equal(req.user.password, undefined);
  assert.equal(next.mock.callCount(), 1);
});

test('unverified accounts are rejected only when verification is enabled', async () => {
  selectCustomer({ ...customer, emailVerified: false });
  const token = generateToken({ userId: customer.id });
  process.env.ENABLE_EMAIL_VERIFICATION = 'true';
  const denied = await run(authenticate, token);
  assert.equal(denied.res.statusCode, 403);
  assert.equal(denied.res.body.requiresOtp, true);
  process.env.ENABLE_EMAIL_VERIFICATION = 'false';
  const permitted = await run(authenticate, token);
  assert.equal(permitted.req.user.id, customer.id);
});

test('optional authentication treats disabled, unverified and deleted customers as guests', async () => {
  process.env.ENABLE_EMAIL_VERIFICATION = 'true';
  const token = generateToken({ userId: customer.id });
  const lookup = selectCustomer(customer);
  for (const record of [{ ...customer, isDisabled: true }, { ...customer, emailVerified: false }, null]) {
    lookup.mock.mockImplementation(async ({ select }) =>
      record && Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, record[key]])));
    const { req, next } = await run(optionalAuth, token);
    assert.equal(req.user, null);
    assert.equal(next.mock.callCount(), 1);
    assert.deepEqual(next.mock.calls[0].arguments, []);
  }
});

test('wrong, mixed and missing actors are rejected before database lookup', async () => {
  const userLookup = selectCustomer(customer);
  const adminLookup = lookups.Admin;
  for (const payload of [{ adminId: 'staff' }, { userId: 'customer', adminId: 'staff' }, { userId: 1 }, {}]) {
    const token = generateToken(payload);
    assert.equal((await run(authenticate, token)).res.statusCode, 401);
    assert.equal((await run(optionalAuth, token)).req.user, null);
  }
  for (const payload of [{ userId: 'customer' }, { userId: 'customer', adminId: 'staff' }, { adminId: 1 }, {}]) {
    assert.equal((await run(authenticateAdmin, generateToken(payload))).res.statusCode, 401);
  }
  assert.equal((await run(authenticate)).res.statusCode, 401);
  assert.equal((await run(optionalAuth, 'malformed')).req.user, null);
  assert.equal(userLookup.mock.callCount(), 0);
  assert.equal(adminLookup.mock.callCount(), 0);
});

test('deleted actors are rejected, and staff permissions come from the database rather than token claims', async () => {
  selectCustomer(null);
  const adminLookup = lookups.Admin;
  adminLookup.mock.mockImplementation(async () => null);
  assert.equal((await run(authenticate, generateToken({ userId: 'deleted' }))).res.statusCode, 401);
  const token = generateToken({ adminId: 'staff', role: 'ADMIN' });
  assert.equal((await run(authenticateAdmin, token)).res.statusCode, 401);
  adminLookup.mock.mockImplementation(async () => ({ id: 'staff', role: 'VIEWER' }));
  const { req, res } = await run(authenticateAdmin, token);
  const next = mock.fn();
  authorize('ADMIN')(req, res, next);
  assert.equal(req.admin.role, 'VIEWER');
  assert.equal(res.statusCode, 403);
  assert.equal(next.mock.callCount(), 0);
});

test('datastore failures reach error middleware instead of masquerading as an invalid token or guest', async () => {
  const failure = new Error('Test datastore unavailable');
  lookups.User.mock.mockImplementation(async () => { throw failure; });
  lookups.Admin.mock.mockImplementation(async () => { throw failure; });
  for (const [middleware, payload] of [[authenticate, { userId: 'customer' }], [optionalAuth, { userId: 'customer' }], [authenticateAdmin, { adminId: 'staff' }]]) {
    const { res, next } = await run(middleware, generateToken(payload));
    assert.equal(res.body, null);
    assert.deepEqual(next.mock.calls[0].arguments, [failure]);
  }
});

test('a missing signing configuration reaches error middleware without querying a user', async () => {
  const token = generateToken({ userId: 'customer' });
  const lookup = selectCustomer(customer);
  delete process.env.JWT_SECRET;
  for (const middleware of [authenticate, optionalAuth, authenticateAdmin]) {
    const { res, next } = await run(middleware, token);
    assert.equal(res.body, null);
    assert.equal(next.mock.calls[0].arguments[0].statusCode, 503);
  }
  assert.equal(lookup.mock.callCount(), 0);
});
