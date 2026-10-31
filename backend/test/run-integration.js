import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { assertTestDatabaseUrl } from '../src/config/databaseSafety.js';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const available = readdirSync(new URL('./integration/', import.meta.url)).filter((name) => name.endsWith('.test.js')).sort();
const requested = process.argv.slice(2);
const files = requested.length ? requested : available;
let client;
try {
  if (!files.length || files.some((name) => !available.includes(name))) throw new Error('Choose an existing integration test filename');
  const base = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  const { PrismaClient } = await import('@prisma/client');
  client = new PrismaClient({ datasources: { db: { url: base.href } } });
  for (const file of files) {
    const database = `apex_test_${randomBytes(12).toString('hex')}`;
    const target = new URL(base.href);
    target.pathname = `/${database}`;
    target.search = '';
    const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: target.href, DIRECT_URL: target.href, TEST_DATABASE_URL: target.href };
    let created = false;
    try {
      await client.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
      created = true;
      const cli = fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url));
      const migrate = spawnSync(process.execPath, [cli, 'migrate', 'deploy'], {
        cwd, env, encoding: 'utf8', timeout: 60_000,
      });
      if (migrate.error) throw migrate.error;
      if (migrate.status !== 0) {
        console.error(migrate.stdout, migrate.stderr);
        throw new Error(`Integration database migration failed for ${file}`);
      }
      console.log(`Migrations applied to a fresh isolated database for ${file}`);
      const tests = spawnSync(process.execPath, ['--import', './test/setup-env.js', '--test', `test/integration/${file}`], {
        cwd, env, stdio: 'inherit', timeout: 60_000,
      });
      if (tests.error) throw tests.error;
      if (tests.status !== 0) process.exitCode = 1;
    } finally {
      if (created) await client.$executeRawUnsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
    }
  }
} catch (error) {
  console.error(`Integration checks refused or failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (client) {
    try {
      await client.$disconnect();
    } catch (error) {
      console.error(`Integration database cleanup failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
