import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import prisma from '../../src/config/database.js';
import { verifySessionRole } from '../../src/config/deploymentDatabase.js';

/*
 * The development deployment's role check on a real PostgreSQL session: a role that only reads and writes rows
 * passes; the database owner and roles that may create objects, own a table or manage roles are refused. Each probe
 * role lives inside a transaction that is rolled back, so nothing outlives the test.
 */
const ROLLED_BACK = new Error('rolled back on purpose');

async function inRolledBackTransaction(work) {
  let result;
  await prisma.$transaction(async (tx) => {
    result = await work(tx).then((value) => ({ value }), (error) => ({ error }));
    throw ROLLED_BACK;
  }, { timeout: 30_000 }).catch((error) => {
    if (error !== ROLLED_BACK) throw error;
  });
  if (result.error) throw result.error;
  return result.value;
}

const probeRole = () => `apex_role_probe_${randomBytes(6).toString('hex')}`;
const [{ name: database }] = await prisma.$queryRaw`SELECT current_database()::text AS name`;

/** Runs the check as a fresh role that may read and write rows, after `grant` gives it anything more. */
function checkAs(grant = () => []) {
  const role = probeRole();
  return inRolledBackTransaction(async (tx) => {
    for (const statement of [
      `CREATE ROLE ${role} NOLOGIN`,
      `GRANT USAGE ON SCHEMA public TO ${role}`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
      ...grant(role),
      `SET LOCAL ROLE ${role}`,
    ]) await tx.$executeRawUnsafe(statement);
    await verifySessionRole((sql) => tx.$queryRaw(sql), { role, database });
  });
}

test.after(() => prisma.$disconnect());

test('a role that only reads and writes rows passes', async () => {
  await checkAs();
});

test('the database owner and roles with more than row access are refused', async () => {
  const [{ name: owner }] = await prisma.$queryRaw`SELECT current_user::text AS name`;
  await assert.rejects(verifySessionRole((sql) => prisma.$queryRaw(sql), { role: owner, database }), /administrative/);
  await assert.rejects(checkAs((role) => [`GRANT CREATE ON SCHEMA public TO ${role}`]), /can create objects/);
  await assert.rejects(checkAs((role) => [`GRANT CREATE ON DATABASE "${database}" TO ${role}`]), /can create objects/);
  await assert.rejects(checkAs((role) => [`ALTER TABLE "Product" OWNER TO ${role}`]), /owns tables/);
  await assert.rejects(checkAs((role) => [`ALTER ROLE ${role} CREATEROLE`]), /administrative/);
  // Without inheriting, a member still gains its role's powers with SET ROLE.
  await assert.rejects(checkAs((role) => {
    const privileged = probeRole();
    return [`CREATE ROLE ${privileged} NOLOGIN`, `GRANT CREATE ON SCHEMA public TO ${privileged}`,
      `ALTER ROLE ${role} NOINHERIT`, `GRANT ${privileged} TO ${role}`];
  }), /belongs to other roles/);
  const [{ remaining }] = await prisma.$queryRaw`SELECT count(*)::int AS remaining FROM pg_roles WHERE rolname LIKE 'apex_role_probe_%'`;
  assert.equal(remaining, 0, 'probe roles never outlive their transaction');
});
