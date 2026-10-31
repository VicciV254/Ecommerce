import '../src/config/environment.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertLocalDatabaseReset } from '../src/config/databaseSafety.js';

try {
  assertLocalDatabaseReset();
  const cli = fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'migrate', 'reset', '--force', '--skip-seed'], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(`Database reset refused or failed: ${error.message}`);
  process.exitCode = 1;
}
