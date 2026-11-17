import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { assertTestDatabaseUrl } from '../../src/config/databaseSafety.js';

const backend = fileURLToPath(new URL('../../', import.meta.url));
const target = '20261117200000_storefront_history_and_activity';
const PUBLISHED_AT = new Date('2026-11-14T06:12:00.000Z');
const LAST_EDIT = new Date('2026-11-10T08:00:00.000Z');

/** Each starting state before the history migration, set on a copy of a database migrated up to the one before it. */
const SCENARIOS = {
  published: `UPDATE "SiteSetting" SET
    "publishedValue" = jsonb_set("publishedValue", '{brand,name}', '"Live store at migration"'),
    "value" = jsonb_set("value", '{brand,name}', '"Unpublished draft name"'),
    "publishedVersion" = 7, "version" = 9, "publishedAt" = '${PUBLISHED_AT.toISOString()}'
    WHERE "key" = 'storefront-v2'`,
  noPublicationTime: `UPDATE "SiteSetting" SET "publishedAt" = NULL, "updatedAt" = '${LAST_EDIT.toISOString()}'
    WHERE "key" = 'storefront-v2'`,
  nothingPublished: `UPDATE "SiteSetting" SET "publishedValue" = NULL, "publishedVersion" = 0, "publishedAt" = NULL
    WHERE "key" = 'storefront-v2'`,
};

const revisions = (db) => db.$queryRaw`SELECT "settingKey", "version", "value", "publishedAt", "publishedById" FROM "StorefrontRevision"`;
const storefront = async (db) => (await db.$queryRaw`SELECT "publishedValue" FROM "SiteSetting" WHERE "key" = 'storefront-v2'`)[0];

test('the history migration seeds the live storefront as one revision with no publisher, and nothing when nothing is published', async () => {
  const base = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  const urlOf = (database) => {
    const url = new URL(base);
    url.pathname = `/${database}`;
    url.search = '';
    return url;
  };
  const prefix = `apex_test_${randomBytes(8).toString('hex')}`;
  const template = `${prefix}_before`;
  const owner = new PrismaClient({ datasources: { db: { url: base.href } } });
  const scratch = mkdtempSync(join(tmpdir(), 'apex-history-migration-'));
  // The scratch folder holds the schema and the chosen migrations, so the CLI reads no project environment file.
  const deploy = (database) => spawnSync(process.execPath, [
    join(backend, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(scratch, 'schema.prisma'),
  ], { cwd: scratch, env: { ...process.env, DATABASE_URL: urlOf(database).href, DIRECT_URL: urlOf(database).href }, encoding: 'utf8', timeout: 30_000 });
  const copy = (filter) => {
    const source = join(backend, 'prisma/migrations');
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (filter(entry)) cpSync(join(source, entry.name), join(scratch, 'migrations', entry.name), { recursive: true });
    }
  };
  const created = [];
  const clients = {};
  try {
    cpSync(join(backend, 'prisma/schema.prisma'), join(scratch, 'schema.prisma'));
    mkdirSync(join(scratch, 'migrations'));
    copy((entry) => entry.name === 'migration_lock.toml' || (entry.isDirectory() && entry.name < target));
    await owner.$executeRawUnsafe(`CREATE DATABASE "${template}"`);
    created.push(template);
    const before = deploy(template);
    assert.equal(before.status, 0, before.stdout + before.stderr);
    for (const name of Object.keys(SCENARIOS)) {
      // A template must have no open connections; the CLI that just migrated it may still be closing its own.
      await owner.$executeRawUnsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${template}'`);
      await owner.$executeRawUnsafe(`CREATE DATABASE "${prefix}_${name.toLowerCase()}" TEMPLATE "${template}"`);
      created.push(`${prefix}_${name.toLowerCase()}`);
    }
    for (const [name, setup] of Object.entries(SCENARIOS)) {
      const database = `${prefix}_${name.toLowerCase()}`;
      clients[name] = new PrismaClient({ datasources: { db: { url: urlOf(database).href } } });
      await clients[name].$executeRawUnsafe(setup);
      assert.deepEqual(await clients[name].$queryRaw`SELECT to_regclass('"StorefrontRevision"') IS NULL AS missing`, [{ missing: true }]);
    }
    copy((entry) => entry.isDirectory() && entry.name >= target);
    for (const name of Object.keys(SCENARIOS)) {
      const after = deploy(`${prefix}_${name.toLowerCase()}`);
      assert.equal(after.status, 0, `${name}: ${after.stdout}${after.stderr}`);
    }

    // The live document (not the draft), at its own version and time; nobody recorded the publisher.
    const live = await storefront(clients.published);
    assert.equal(live.publishedValue.brand.name, 'Live store at migration');
    assert.deepEqual(await revisions(clients.published), [
      { settingKey: 'storefront-v2', version: 7, value: live.publishedValue, publishedAt: PUBLISHED_AT, publishedById: null },
    ]);
    // Without a recorded publication time, the setting's last change stands in for it.
    const [untimed] = await revisions(clients.noPublicationTime);
    assert.equal(untimed.version, 1);
    assert.equal(untimed.publishedById, null);
    assert.deepEqual(untimed.publishedAt, LAST_EDIT);
    assert.equal((await revisions(clients.noPublicationTime)).length, 1);
    assert.deepEqual(await revisions(clients.nothingPublished), []);
  } finally {
    for (const client of Object.values(clients)) await client.$disconnect();
    for (const database of created.reverse()) await owner.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await owner.$disconnect();
    rmSync(scratch, { recursive: true, force: true });
  }
});
