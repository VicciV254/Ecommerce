import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const cwd = fileURLToPath(new URL('../../', import.meta.url));

for (const script of ['scripts/reset-database.js', 'prisma/seed.js']) {
  test(`${script} refuses to run without explicit local-reset consent`, () => {
    const result = spawnSync(process.execPath, [script], {
      cwd,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ALLOW_LOCAL_DATABASE_RESET: 'false',
        DATABASE_URL: 'postgresql://test:local_only@127.0.0.1:1/apex_test',
        DIRECT_URL: 'postgresql://test:local_only@127.0.0.1:1/apex_test',
      },
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /explicit ALLOW_LOCAL_DATABASE_RESET=true/);
  });
}
