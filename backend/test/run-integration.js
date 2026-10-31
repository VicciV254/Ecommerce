import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assertTestDatabaseUrl } from '../src/config/databaseSafety.js';

let cleanup;
try {
  const base = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  const database = `apex_test_${randomBytes(12).toString('hex')}`;
  const target = new URL(base.href);
  target.pathname = `/${database}`;
  target.search = '';
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: target.href,
    DIRECT_URL: target.href,
    TEST_DATABASE_URL: target.href,
  };
  const { PrismaClient } = await import('@prisma/client');
  const client = new PrismaClient({ datasources: { db: { url: base.href } } });
  cleanup = () => client.$disconnect();
  await client.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
  cleanup = async () => {
    try {
      await client.$executeRawUnsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
    } finally {
      await client.$disconnect();
    }
  };
  const cli = fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url));
  const migrate = spawnSync(process.execPath, [cli, 'migrate', 'deploy'], {
    env,
    stdio: 'inherit',
    timeout: 60_000,
  });
  if (migrate.error) throw migrate.error;
  if (migrate.status !== 0) throw new Error('Integration database migration failed');
  const tests = spawnSync(process.execPath, ['--import', './test/setup-env.js', '--test', 'test/integration/database.test.js'], {
    env,
    stdio: 'inherit',
    timeout: 60_000,
  });
  if (tests.error) throw tests.error;
  process.exitCode = tests.status ?? 1;
} catch (error) {
  console.error(`Integration checks refused or failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (cleanup) {
    try {
      await cleanup();
    } catch (error) {
      console.error(`Integration database cleanup failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
