import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertLocalDatabaseReset, assertLocalDatabaseUrl, assertTestDatabaseUrl } from '../../src/config/databaseSafety.js';

const local = 'postgresql://test:local_only@127.0.0.1:5432/apex_test';
const resetEnv = {
  NODE_ENV: 'test',
  ALLOW_LOCAL_DATABASE_RESET: 'true',
  DATABASE_URL: local,
  DIRECT_URL: local,
};

test('explicit reset accepts only the same local application and migration target', () => {
  assert.doesNotThrow(() => assertLocalDatabaseReset(resetEnv));
  assert.throws(() => assertLocalDatabaseReset({ ...resetEnv, DIRECT_URL: `${local}_other` }), /same local database/);
  assert.throws(() => assertLocalDatabaseReset({ ...resetEnv, DIRECT_URL: `${local}?schema=other` }), /same local database/);
});

test('remote database targets are rejected even when reset is explicitly enabled', () => {
  const remote = local.replace('127.0.0.1', 'database.example.com');
  assert.throws(() => assertLocalDatabaseUrl(remote), /loopback/);
  assert.throws(() => assertTestDatabaseUrl(remote), /loopback/);
  assert.throws(() => assertLocalDatabaseReset({ ...resetEnv, DIRECT_URL: remote }), /loopback/);
});

test('production and missing consent cannot reset even a local database', () => {
  assert.throws(() => assertLocalDatabaseReset({ ...resetEnv, NODE_ENV: 'production' }), /NODE_ENV/);
  assert.throws(() => assertLocalDatabaseReset({ ...resetEnv, ALLOW_LOCAL_DATABASE_RESET: undefined }), /explicit/);
  assert.throws(() => assertLocalDatabaseReset({ ...resetEnv, ALLOW_LOCAL_DATABASE_RESET: 'false' }), /explicit/);
});

test('unrelated local databases and connection-target overrides are rejected', () => {
  assert.throws(() => assertLocalDatabaseUrl(local.replace('apex_test', 'customer_database')), /must name/);
  assert.throws(() => assertTestDatabaseUrl(local.replace('apex_test', 'apex_development')), /apex_test database/);
  assert.throws(() => assertLocalDatabaseUrl(`${local}?host=database.example.com`), /query parameter/);
  assert.throws(() => assertLocalDatabaseUrl(`${local}?schema=public&schema=other`), /invalid schema/);
  assert.throws(() => assertLocalDatabaseUrl(`${local}?schema=bad%22name`), /invalid schema/);
  assert.throws(() => assertLocalDatabaseUrl('not-a-url'), /valid PostgreSQL URL/);
  assert.throws(() => assertLocalDatabaseUrl(local.replace('postgresql:', 'https:')), /use PostgreSQL/);
});

test('test schemas and loopback address variants remain usable', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const value = local.replace('127.0.0.1', host) + '?schema=apex_test_123abc';
    assert.equal(assertTestDatabaseUrl(value).searchParams.get('schema'), 'apex_test_123abc');
  }
});
