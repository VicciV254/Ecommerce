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
const target = '20261114120000_fulfilment_returns_refunds';

/** Builds a database at the migration before Phase 5, seeds it, then applies Phase 5. */
async function legacyDatabase(seed, verify) {
  const base = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  const database = `apex_test_${randomBytes(12).toString('hex')}`;
  const url = new URL(base);
  url.pathname = `/${database}`;
  url.search = '';
  const owner = new PrismaClient({ datasources: { db: { url: base.href } } });
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  const scratch = mkdtempSync(join(tmpdir(), 'apex-fulfilment-migration-'));
  const prisma = (...args) => spawnSync(process.execPath, [
    join(backend, 'node_modules/prisma/build/index.js'), ...args, '--schema', join(scratch, 'schema.prisma'),
  ], { cwd: backend, env: { ...process.env, DATABASE_URL: url.href, DIRECT_URL: url.href }, encoding: 'utf8', timeout: 30_000 });
  const deploy = () => prisma('migrate', 'deploy');
  let created = false;
  try {
    await owner.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    created = true;
    cpSync(join(backend, 'prisma/schema.prisma'), join(scratch, 'schema.prisma'));
    mkdirSync(join(scratch, 'migrations'));
    const source = join(backend, 'prisma/migrations');
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (entry.name === 'migration_lock.toml' || (entry.isDirectory() && entry.name < target)) {
        cpSync(join(source, entry.name), join(scratch, 'migrations', entry.name), { recursive: true });
      }
    }
    const baseline = deploy();
    assert.ifError(baseline.error);
    assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
    await db.$executeRaw`INSERT INTO "User" (id, email, password, "firstName", "lastName", "updatedAt")
      VALUES ('legacy-user', 'legacy@example.test', 'fixture-not-for-login', 'Legacy', 'Customer', NOW())`;
    await db.$executeRaw`INSERT INTO "Address" (id, "userId", street, city, county, "updatedAt")
      VALUES ('legacy-address', 'legacy-user', 'Legacy street', 'Mombasa', 'Mombasa', NOW())`;
    await seed(db);
    cpSync(join(source, target), join(scratch, 'migrations', target), { recursive: true });
    const result = deploy();
    assert.ifError(result.error);
    await verify(db, result, { deploy, prisma });
  } finally {
    try {
      await db.$disconnect();
    } finally {
      try {
        if (created) await owner.$executeRawUnsafe(`DROP DATABASE "${database}" WITH (FORCE)`);
      } finally {
        await owner.$disconnect();
        rmSync(scratch, { recursive: true, force: true });
      }
    }
  }
}

const legacyOrder = (db, id, status, paymentStatus = 'PENDING', total = 1360) => db.$executeRawUnsafe(
  `INSERT INTO "Order" (id, "orderNumber", "userId", "addressId", subtotal, tax, "shippingCost", total, "paymentMethod", status, "paymentStatus", "updatedAt")
   VALUES ($1, $2, 'legacy-user', 'legacy-address', 1000, 160, 200, $3, 'MPESA', $4::"OrderStatus", $5::"PaymentStatus", NOW())`,
  id, `NM-${id}`, total, status, paymentStatus,
);

test('combined legacy refund states stop the migration until staff resolve them explicitly', async () => {
  await legacyDatabase(async (db) => {
    await legacyOrder(db, 'awaiting-refund', 'AWAITING_REFUND', 'PAID');
  }, async (db, result, { deploy, prisma }) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /AWAITING_REFUND\/RETURNED/);
    const [{ refund }] = await db.$queryRaw`SELECT to_regclass('"Refund"')::text AS refund`;
    assert.equal(refund, null);
    const [order] = await db.$queryRaw`SELECT status::text AS status FROM "Order" WHERE id = 'awaiting-refund'`;
    assert.equal(order.status, 'AWAITING_REFUND');
    // Recovery: record an explicit decision, mark the failed attempt rolled back, then deploy again.
    await db.$executeRaw`UPDATE "Order" SET status = 'CANCELLED' WHERE id = 'awaiting-refund'`;
    const resolved = prisma('migrate', 'resolve', '--rolled-back', target);
    assert.equal(resolved.status, 0, resolved.stdout + resolved.stderr);
    const retried = deploy();
    assert.equal(retried.status, 0, retried.stdout + retried.stderr);
    const [{ refundTable }] = await db.$queryRaw`SELECT to_regclass('"Refund"')::text AS "refundTable"`;
    assert.equal(refundTable, '"Refund"');
  });
});

test('the migration links settled payments, maps approved return rules and enforces refund invariants', async () => {
  await legacyDatabase(async (db) => {
    await legacyOrder(db, 'paid-order', 'DELIVERED', 'PAID');
    for (const [id, amount, confirmed] of [['confirmed-payment', 1360, true], ['pending-payment', 1360, false]]) {
      await db.$executeRawUnsafe(
        `INSERT INTO "MpesaPayment" (id, "orderId", phone, amount, status, "confirmedAt", environment, "idempotencyKey", "requestHash",
           "merchantIdentity", "merchantShortcode", "callbackKeyHash", reference, "receiptNumber", "updatedAt")
         VALUES ($1, 'paid-order', '254700000000', $2, $3, $4, 'sandbox', $1, 'fixture', 'fixture-merchant', '174379', $5, $1, $6, NOW())`,
        id, amount, confirmed ? 'SUCCEEDED' : 'PENDING', confirmed ? new Date() : null, '0'.repeat(64), confirmed ? 'LEGACY0001' : null,
      );
    }
    for (const [id, slug, parent] of [['groceries', 'groceries', null], ['dairy', 'dairy', 'groceries'], ['beauty', 'health-beauty', null],
      ['hair-tools', 'hair-tools', 'beauty'], ['electronics', 'electronics', null]]) {
      await db.$executeRawUnsafe(`INSERT INTO "Category" (id, name, slug, "parentId", "updatedAt") VALUES ($1, $1, $2, $3, NOW())`, id, slug, parent);
    }
  }, async (db, result) => {
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const [order] = await db.$queryRaw`SELECT "settledPaymentId" FROM "Order" WHERE id = 'paid-order'`;
    assert.equal(order.settledPaymentId, 'confirmed-payment');
    const rules = Object.fromEntries((await db.$queryRaw`SELECT slug, "returnRule"::text AS rule FROM "Category"`).map((row) => [row.slug, row.rule]));
    assert.deepEqual(rules, { groceries: null, dairy: 'FAULT_ONLY', 'health-beauty': 'UNOPENED_OR_FAULT', 'hair-tools': 'STANDARD', electronics: null });
    const refund = (suffix, amount, requested, status = 'REQUESTED', reference = null) => db.$executeRawUnsafe(
      `INSERT INTO "Refund" (id, number, "orderId", source, status, amount, "requestedAmount", "requestedByType", "providerReference", "updatedAt")
       VALUES ($1, $1, 'paid-order', 'RETURN', $2::"RefundStatus", $3, $4, 'STAFF', $5, NOW())`,
      `refund-${suffix}`, status, amount, requested, reference,
    );
    for (const invalid of [() => refund('cents', 10.5, 11), () => refund('raised', 20, 10), () => refund('unproven', 10, 10, 'CONFIRMED')]) {
      await assert.rejects(invalid(), /check constraint/i);
    }
    await refund('valid', 10, 10);
  });
});
