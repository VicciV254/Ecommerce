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
import defaults from '../../src/data/storefront-defaults.json' with { type: 'json' };

const backend = fileURLToPath(new URL('../../', import.meta.url));
const target = '20261115170000_apex_cart_text_accent';
const accent = async (db) => {
  const [row] = await db.$queryRaw`SELECT "value" #>> '{theme,colors,accent}' AS draft, "publishedValue" #>> '{theme,colors,accent}' AS published
    FROM "SiteSetting" WHERE key = 'storefront-v2'`;
  return row;
};

test('the text-accent migration replaces only the old default colour and fresh databases start compliant', async () => {
  const base = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  const database = `apex_test_${randomBytes(12).toString('hex')}`;
  const url = new URL(base);
  url.pathname = `/${database}`;
  url.search = '';
  const owner = new PrismaClient({ datasources: { db: { url: base.href } } });
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  const scratch = mkdtempSync(join(tmpdir(), 'apex-theme-migration-'));
  const deploy = () => spawnSync(process.execPath, [
    join(backend, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(scratch, 'schema.prisma'),
  ], { cwd: backend, env: { ...process.env, DATABASE_URL: url.href, DIRECT_URL: url.href }, encoding: 'utf8', timeout: 30_000 });
  const copy = (filter) => {
    const source = join(backend, 'prisma/migrations');
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (filter(entry)) cpSync(join(source, entry.name), join(scratch, 'migrations', entry.name), { recursive: true });
    }
  };
  let created = false;
  try {
    await owner.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    created = true;
    cpSync(join(backend, 'prisma/schema.prisma'), join(scratch, 'schema.prisma'));
    mkdirSync(join(scratch, 'migrations'));
    copy((entry) => entry.name === 'migration_lock.toml' || (entry.isDirectory() && entry.name < target));
    const before = deploy();
    assert.equal(before.status, 0, before.stdout + before.stderr);
    assert.deepEqual(await accent(db), { draft: '#926d21', published: '#926d21' });
    // A staff member customised the draft accent; the published theme still uses the old default.
    await db.$executeRaw`UPDATE "SiteSetting" SET "value" = jsonb_set("value", '{theme,colors,accent}', '"#123456"') WHERE key = 'storefront-v2'`;
    copy((entry) => entry.isDirectory() && entry.name >= target);
    const after = deploy();
    assert.equal(after.status, 0, after.stdout + after.stderr);
    assert.deepEqual(await accent(db), { draft: '#123456', published: '#765619' });
    assert.equal(defaults.theme.colors.accent, '#765619');
  } finally {
    await db.$disconnect();
    if (created) await owner.$executeRawUnsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
    await owner.$disconnect();
    rmSync(scratch, { recursive: true, force: true });
  }
});
