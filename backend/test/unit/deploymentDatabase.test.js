import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import app from '../../src/app.js';
import { deploymentDatabaseGuard, deploymentDatabaseRule, verifySessionRole } from '../../src/config/deploymentDatabase.js';

/*
 * A development deployment (a Vercel preview) serves only from the approved development database through its
 * restricted runtime role, and refuses every request otherwise; production, local runs and tests are left alone.
 */
const host = 'ep-dev-123.c-1.us-east-1.aws.neon.tech';
const pooler = 'ep-dev-123-pooler.c-1.us-east-1.aws.neon.tech';
const preview = {
  VERCEL: '1',
  VERCEL_ENV: 'preview',
  APPROVED_DATABASE_HOSTS: `${pooler},${host}`,
  APPROVED_DATABASE_ROLE: 'apex_runtime',
  DATABASE_URL: `postgresql://apex_runtime:runtime_only@${pooler}/apex_development`
    + '?connect_timeout=30&pool_timeout=30&pgbouncer=true&sslmode=require&channel_binding=require',
  DIRECT_URL: `postgresql://apex_runtime:runtime_only@${host}/apex_development?connect_timeout=30&sslmode=require&channel_binding=require`,
};
const rule = { role: 'apex_runtime', database: 'apex_development' };
const restricted = { user: 'apex_runtime', database: 'apex_development', elevated: false, creates: false, belongsToRoles: false, ownsTables: false };
const quiet = { info: () => undefined, error: () => undefined };

test('production, local runs and tests are left alone; a preview must use the approved database and role', () => {
  assert.equal(deploymentDatabaseRule({ ...preview, VERCEL_ENV: 'production' }), null);
  assert.equal(deploymentDatabaseRule({ DATABASE_URL: 'postgresql://apex_test:local_test_only@127.0.0.1/apex_test' }), null);
  assert.deepEqual(deploymentDatabaseRule(preview), rule);
  const { VERCEL_ENV: platform, ...withoutPlatform } = preview;
  assert.equal(platform, 'preview');
  assert.deepEqual(deploymentDatabaseRule(withoutPlatform), rule, 'a configured development database is enforced on its own');
  const refused = (changes, pattern) => assert.throws(() => deploymentDatabaseRule({ ...preview, ...changes }), pattern);
  refused({ APPROVED_DATABASE_HOSTS: undefined }, /must be set outside production/);
  refused({ APPROVED_DATABASE_ROLE: ' ' }, /must be set outside production/);
  refused({ VERCEL_ENV: 'development', APPROVED_DATABASE_HOSTS: undefined, APPROVED_DATABASE_ROLE: undefined }, /must be set/);
  refused({ DATABASE_URL: preview.DATABASE_URL.replace(pooler, 'production.example.com') }, /DATABASE_URL must target an approved/);
  refused({ DIRECT_URL: preview.DIRECT_URL.replace('apex_runtime:', 'apex_owner:') }, /DIRECT_URL must connect as the approved runtime role/);
  refused({ DATABASE_URL: preview.DATABASE_URL.replace('/apex_development', '/neondb') }, /apex_development database/);
  refused({ DATABASE_URL: preview.DATABASE_URL.replace('sslmode=require', 'sslmode=prefer') }, /TLS/);
  refused({ DIRECT_URL: `${preview.DIRECT_URL}&options=-c%20role%3Dapex_owner` }, /not allowed/);
  refused({ DATABASE_URL: undefined }, /DATABASE_URL is required/);
});

test('the session must be the approved role on its database, with no administrative or schema powers', async () => {
  await assert.doesNotReject(verifySessionRole(async () => [restricted], rule));
  for (const [change, pattern] of [
    [{ user: 'apex_owner' }, /connects as apex_owner/],
    [{ database: 'neondb' }, /uses the neondb database/],
    [{ elevated: true }, /administrative/],
    [{ creates: true }, /create objects/],
    [{ belongsToRoles: true }, /belongs to other roles/],
    [{ ownsTables: true }, /owns tables/],
  ]) await assert.rejects(verifySessionRole(async () => [{ ...restricted, ...change }], rule), pattern);
  await assert.rejects(verifySessionRole(async () => [], rule), /could not be read/);
});

async function outcome(guard) {
  const sent = {};
  let passed = false;
  const res = {
    status(code) { sent.status = code; return this; },
    json(body) { sent.body = body; return this; },
  };
  await guard({}, res, () => { passed = true; });
  return passed ? 'served' : sent;
}

test('the guard checks the session once, refuses with 503 until it passes, and stays out of production', async () => {
  const answers = [new Error('connection reset'), [{ ...restricted, user: 'apex_owner' }], [restricted]];
  let queries = 0;
  const query = async () => {
    queries += 1;
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const guard = deploymentDatabaseGuard({ env: preview, query, log: quiet });
  assert.deepEqual(await outcome(guard), {
    status: 503, body: { error: 'This deployment is not connected to its approved database.', code: 'DEPLOYMENT_DATABASE_REFUSED' },
  });
  assert.equal((await outcome(guard)).status, 503, 'the owner role is refused');
  assert.equal(await outcome(guard), 'served');
  assert.equal(await outcome(guard), 'served');
  assert.equal(queries, 3, 'a verified session is not checked again');

  const production = deploymentDatabaseGuard({
    env: { ...preview, VERCEL_ENV: 'production' }, query: () => assert.fail('production is not checked'), log: quiet,
  });
  assert.equal(await outcome(production), 'served');
  const misconfigured = deploymentDatabaseGuard({
    env: { ...preview, APPROVED_DATABASE_ROLE: undefined }, query: () => assert.fail('a refused configuration is never queried'), log: quiet,
  });
  assert.equal((await outcome(misconfigured)).status, 503);
});

test('a preview pointed at an unapproved database answers 503 on every route, health included', async (t) => {
  const keys = ['VERCEL_ENV', 'APPROVED_DATABASE_HOSTS', 'APPROVED_DATABASE_ROLE'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
  // The test database's loopback address stands in for a database the preview was never approved to use.
  Object.assign(process.env, { VERCEL_ENV: 'preview', APPROVED_DATABASE_HOSTS: host, APPROVED_DATABASE_ROLE: 'apex_runtime' });
  t.mock.method(console, 'error', () => undefined);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  for (const path of ['/api/health', '/api/catalog', '/']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    assert.equal(response.status, 503, path);
    assert.equal((await response.json()).code, 'DEPLOYMENT_DATABASE_REFUSED', path);
  }
});
