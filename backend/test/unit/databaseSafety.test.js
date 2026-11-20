import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertDemoInitialization, assertLocalDatabaseReset, assertLocalDatabaseUrl, assertTestDatabaseUrl,
} from '../../src/config/databaseSafety.js';

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

/*
 * The development deployment's own hosted database is the one remote target the demo initializer may reach: only
 * when its host is approved, through the approved restricted role, over TLS, for a development run, and with no
 * setting that could redirect the connection or change its role.
 */
const hosted = 'postgresql://apex_runtime:runtime_only@ep-dev-123.c-1.us-east-1.aws.neon.tech/apex_development'
  + '?sslmode=require&channel_binding=require&connect_timeout=30';
const hostedEnv = {
  NODE_ENV: 'development',
  ALLOW_DEMO_INITIALIZATION: 'true',
  APPROVED_DATABASE_HOSTS: 'ep-dev-123.c-1.us-east-1.aws.neon.tech, EP-DEV-123-POOLER.c-1.us-east-1.aws.neon.tech',
  APPROVED_DATABASE_ROLE: 'apex_runtime',
  DATABASE_URL: hosted,
  DIRECT_URL: hosted,
};
const both = (value) => ({ DATABASE_URL: value, DIRECT_URL: value });

test('demo initialization reaches the approved development database only as its role, over TLS, in development', () => {
  assert.equal(assertDemoInitialization(hostedEnv).app.hostname, 'ep-dev-123.c-1.us-east-1.aws.neon.tech');
  assert.equal(assertDemoInitialization({ ...hostedEnv, ALLOW_DEMO_INITIALIZATION: undefined }, true).direct.pathname, '/apex_development');
  const refused = (changes, pattern) => assert.throws(() => assertDemoInitialization({ ...hostedEnv, ...changes }), pattern);
  refused({ NODE_ENV: 'test' }, /only with NODE_ENV=development/);
  refused({ NODE_ENV: 'production' }, /NODE_ENV=development or test/);
  refused({ ALLOW_DEMO_INITIALIZATION: undefined }, /explicit/);
  refused({ APPROVED_DATABASE_HOSTS: undefined }, /loopback/);
  refused({ APPROVED_DATABASE_HOSTS: 'other.example.com' }, /loopback/);
  refused({ APPROVED_DATABASE_ROLE: undefined }, /approved runtime role/);
  refused(both(hosted.replace('apex_runtime:', 'apex_owner:')), /approved runtime role/);
  refused(both(hosted.replace('/apex_development', '/apex_production')), /apex_development database/);
  refused(both(hosted.replace('sslmode=require', 'sslmode=disable')), /TLS/);
  refused(both(hosted.replace('sslmode=require&', '')), /TLS/);
  refused({ DIRECT_URL: hosted.replace('ep-dev-123.', 'ep-dev-123-pooler.') }, /same approved development database/);
  for (const setting of ['host=db.example.com', 'hostaddr=203.0.113.9', 'options=-c%20role%3Dapex_owner', 'port=6543',
    'user=apex_owner', 'schema=other', 'pgbouncer=true', 'sslmode=require']) {
    refused(both(`${hosted}&${setting}`), /not allowed/);
  }
});

test('a hosted database never satisfies the reset guard, approved or not', () => {
  assert.throws(() => assertLocalDatabaseReset({ ...hostedEnv, ALLOW_LOCAL_DATABASE_RESET: 'true' }), /loopback/);
});

test('test schemas and loopback address variants remain usable', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const value = local.replace('127.0.0.1', host) + '?schema=apex_test_123abc';
    assert.equal(assertTestDatabaseUrl(value).searchParams.get('schema'), 'apex_test_123abc');
  }
});
