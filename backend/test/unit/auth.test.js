import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import jwt from 'jsonwebtoken';
import {
  assertAuthConfigured, generateToken, generateRefreshToken, verifyToken, verifyRefreshToken,
  isCustomerToken, isAdminToken,
} from '../../src/config/auth.js';

const accessSecret = process.env.JWT_SECRET;
const refreshSecret = process.env.JWT_REFRESH_SECRET;
afterEach(() => {
  process.env.JWT_SECRET = accessSecret;
  process.env.JWT_REFRESH_SECRET = refreshSecret;
});

test('access and refresh tokens are not interchangeable', () => {
  const access = generateToken({ userId: 'customer' });
  const refresh = generateRefreshToken({ userId: 'customer' });
  assert.equal(verifyToken(access).userId, 'customer');
  assert.equal(verifyRefreshToken(refresh).userId, 'customer');
  assert.equal(verifyToken(refresh), null);
  assert.equal(verifyRefreshToken(access), null);
});

test('malformed, expired, premature and unsupported-algorithm tokens are rejected', () => {
  for (const token of [
    undefined, '', 'not-a-token',
    jwt.sign({ userId: 'customer' }, accessSecret, { expiresIn: -1 }),
    jwt.sign({ userId: 'customer' }, accessSecret, { notBefore: '1h' }),
    jwt.sign({ userId: 'customer' }, accessSecret, { algorithm: 'HS384' }),
  ]) assert.equal(verifyToken(token), null);
});

test('missing, placeholder, short and reused signing secrets fail as configuration errors', () => {
  for (const value of ['', 'short', 'your_placeholder_signing_secret_not_for_use', refreshSecret]) {
    process.env.JWT_SECRET = value;
    assert.throws(assertAuthConfigured, { statusCode: 503 });
    assert.throws(() => generateToken({ userId: 'customer' }), { statusCode: 503 });
    assert.throws(() => verifyToken('invalid'), { statusCode: 503 });
  }
  process.env.JWT_SECRET = accessSecret;
  delete process.env.JWT_REFRESH_SECRET;
  assert.throws(assertAuthConfigured, { statusCode: 503 });
});

test('identity claims require exactly one actor with a nonempty string identifier', () => {
  assert.equal(isCustomerToken({ userId: 'customer' }), true);
  assert.equal(isAdminToken({ adminId: 'staff' }), true);
  for (const payload of [null, 'customer', {}, { userId: '' }, { userId: 1 }, { adminId: '' }, { adminId: 1 }, { userId: 'customer', adminId: 'staff' }]) {
    assert.equal(isCustomerToken(payload), false);
    assert.equal(isAdminToken(payload), false);
  }
  assert.equal(isAdminToken({ userId: 'customer' }), false);
  assert.equal(isCustomerToken({ adminId: 'staff' }), false);
});
