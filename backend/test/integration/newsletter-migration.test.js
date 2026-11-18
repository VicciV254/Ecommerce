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
const target = '20261118120000_newsletter_unsubscribe_tokens';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** What an older release could leave: one address in several letter cases and spacings, and stale account preferences. */
const BEFORE = [`
INSERT INTO "Subscription" ("id", "email", "isActive", "createdAt", "updatedAt") VALUES
  ('sub-merge-1', 'Merge.Me@Example.test', true, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('sub-merge-2', 'merge.me@example.test', false, '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z'),
  ('sub-merge-3', ' MERGE.ME@example.test ', true, '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'),
  ('sub-both-b', 'both.on@example.test', true, '2026-01-05T00:00:00Z', '2026-01-05T00:00:00Z'),
  ('sub-both-a', 'Both.On@example.test', true, '2026-01-05T00:00:00Z', '2026-01-05T00:00:00Z'),
  ('sub-solo', 'solo@example.test', true, '2026-01-07T00:00:00Z', '2026-01-07T00:00:00Z'),
  ('sub-lapsed', 'Lapsed@Example.test', false, '2026-01-08T00:00:00Z', '2026-01-08T00:00:00Z')`, `
INSERT INTO "User" ("id", "email", "password", "firstName", "lastName", "promotionalEmails", "updatedAt") VALUES
  ('user-merge', 'Merge.Me@Example.test', 'unused', 'Opted', 'Out', true, now()),
  ('user-both', 'BOTH.ON@example.test', 'unused', 'Always', 'On', false, now()),
  ('user-solo', 'Solo@Example.test', 'unused', 'Never', 'Shown', false, now()),
  ('user-lapsed', 'lapsed@example.test', 'unused', 'Long', 'Gone', true, now()),
  ('user-none', 'nobody@example.test', 'unused', 'Not', 'Subscribed', true, now())`];

test('the newsletter migration merges address variants (an opt-out wins), lowercases, adds tokens and aligns preferences', async () => {
  const base = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  const database = `apex_test_${randomBytes(8).toString('hex')}_newsletter`;
  const url = new URL(base);
  url.pathname = `/${database}`;
  url.search = '';
  const owner = new PrismaClient({ datasources: { db: { url: base.href } } });
  const scratch = mkdtempSync(join(tmpdir(), 'apex-newsletter-migration-'));
  // The scratch folder holds the schema and the chosen migrations, so the CLI reads no project environment file.
  const deploy = () => spawnSync(process.execPath, [
    join(backend, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(scratch, 'schema.prisma'),
  ], { cwd: scratch, env: { ...process.env, DATABASE_URL: url.href, DIRECT_URL: url.href }, encoding: 'utf8', timeout: 30_000 });
  const copy = (filter) => {
    const source = join(backend, 'prisma/migrations');
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (filter(entry)) cpSync(join(source, entry.name), join(scratch, 'migrations', entry.name), { recursive: true });
    }
  };
  let db = null;
  let created = false;
  try {
    cpSync(join(backend, 'prisma/schema.prisma'), join(scratch, 'schema.prisma'));
    mkdirSync(join(scratch, 'migrations'));
    copy((entry) => entry.name === 'migration_lock.toml' || (entry.isDirectory() && entry.name < target));
    await owner.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    created = true;
    const before = deploy();
    assert.equal(before.status, 0, before.stdout + before.stderr);
    db = new PrismaClient({ datasources: { db: { url: url.href } } });
    for (const statement of BEFORE) await db.$executeRawUnsafe(statement);
    copy((entry) => entry.isDirectory() && entry.name >= target);
    const after = deploy();
    assert.equal(after.status, 0, after.stdout + after.stderr);

    const rows = await db.$queryRaw`SELECT "id", "email", "isActive", "unsubscribeToken" FROM "Subscription" ORDER BY "id"`;
    // The oldest variant is kept (by creation time, then id), active only when every variant was.
    assert.deepEqual(rows.map(({ id, email, isActive }) => ({ id, email, isActive })), [
      { id: 'sub-both-a', email: 'both.on@example.test', isActive: true },
      { id: 'sub-lapsed', email: 'lapsed@example.test', isActive: false },
      { id: 'sub-merge-1', email: 'merge.me@example.test', isActive: false },
      { id: 'sub-solo', email: 'solo@example.test', isActive: true },
    ]);
    for (const { unsubscribeToken } of rows) assert.match(unsubscribeToken, UUID);
    assert.equal(new Set(rows.map((row) => row.unsubscribeToken)).size, rows.length);
    // Each account now shows whether promotional emails are sent to its address.
    const accounts = await db.$queryRaw`SELECT "id", "promotionalEmails" FROM "User" ORDER BY "id"`;
    assert.deepEqual(accounts, [
      { id: 'user-both', promotionalEmails: true },
      { id: 'user-lapsed', promotionalEmails: false },
      { id: 'user-merge', promotionalEmails: false },
      { id: 'user-none', promotionalEmails: false },
      { id: 'user-solo', promotionalEmails: true },
    ]);
    // Addresses stay lowercase, and tokens are required and unique.
    const insert = (email, token) => db.$executeRawUnsafe(
      `INSERT INTO "Subscription" ("id", "email", "unsubscribeToken", "updatedAt") VALUES ($1, $2, $3, now())`, `sub-${email}`, email, token,
    );
    await assert.rejects(insert('Mixed@Example.test', '5b0c3a8e-1f2d-4c6b-9a7e-0d1f2e3c4b5a'), (error) => error.meta?.code === '23514');
    await assert.rejects(insert('dup.token@example.test', rows[0].unsubscribeToken), (error) => error.meta?.code === '23505');
    await assert.rejects(insert('no.token@example.test', null), (error) => error.meta?.code === '23502');
    assert.equal(await insert('fine@example.test', 'c4d7e2f1-8a9b-4c3d-8e5f-6a7b8c9d0e1f'), 1);
  } finally {
    await db?.$disconnect();
    if (created) await owner.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await owner.$disconnect();
    rmSync(scratch, { recursive: true, force: true });
  }
});
