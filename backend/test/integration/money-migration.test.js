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
const migrationName = '20261031213000_checkout_quotes';

async function legacyDatabase(price, verify) {
  const base = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  const database = `apex_test_${randomBytes(12).toString('hex')}`;
  const url = new URL(base);
  url.pathname = `/${database}`;
  url.search = '';
  const owner = new PrismaClient({ datasources: { db: { url: base.href } } });
  const db = new PrismaClient({ datasources: { db: { url: url.href } } });
  const scratch = mkdtempSync(join(tmpdir(), 'apex-pricing-migration-'));
  let created = false;
  const deploy = () => spawnSync(process.execPath, [
    join(backend, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', join(scratch, 'schema.prisma'),
  ], {
    cwd: backend, env: { ...process.env, DATABASE_URL: url.href, DIRECT_URL: url.href },
    encoding: 'utf8', timeout: 30_000,
  });
  try {
    await owner.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    created = true;
    cpSync(join(backend, 'prisma/schema.prisma'), join(scratch, 'schema.prisma'));
    mkdirSync(join(scratch, 'migrations'));
    const source = join(backend, 'prisma/migrations');
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (entry.name === 'migration_lock.toml' || (entry.isDirectory() && entry.name < migrationName)) {
        cpSync(join(source, entry.name), join(scratch, 'migrations', entry.name), { recursive: true });
      }
    }
    const baseline = deploy();
    assert.ifError(baseline.error);
    assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
    await db.$executeRaw`INSERT INTO "User" (id, email, password, "firstName", "lastName", "updatedAt")
      VALUES ('migration-user', 'migration@example.test', 'fixture-not-for-login', 'Test', 'Migration', NOW())`;
    await db.$executeRaw`INSERT INTO "Address" (id, "userId", street, city, county, "updatedAt")
      VALUES ('migration-address', 'migration-user', 'Original street', 'Mombasa', 'Mombasa', NOW())`;
    await db.$executeRaw`INSERT INTO "Category" (id, name, slug, "updatedAt")
      VALUES ('migration-category', 'Migration category', 'migration-category', NOW())`;
    await db.$executeRaw`INSERT INTO "Product" (id, name, slug, description, price, "categoryId", tags, "updatedAt")
      VALUES ('migration-product', 'Migration product', 'migration-product', 'A preserved fixture', ${price}, 'migration-category', ARRAY[]::text[], NOW())`;
    await db.$executeRaw`INSERT INTO "ProductVariant" (id, "productId", sku, "updatedAt")
      VALUES ('migration-variant', 'migration-product', 'MIGRATION-SKU', NOW())`;
    await db.$executeRaw`INSERT INTO "Stock" (id, "variantId", quantity, "updatedAt")
      VALUES ('migration-stock', 'migration-variant', 5, NOW())`;
    await db.$executeRaw`INSERT INTO "Order" (id, "orderNumber", "userId", "addressId", subtotal, tax, "shippingCost", total, "paymentMethod", "updatedAt")
      VALUES ('migration-order', 'NM-PRESERVED', 'migration-user', 'migration-address', 1000.25, 160.04, 200, 1360.29, 'MPESA', NOW())`;
    cpSync(join(source, migrationName), join(scratch, 'migrations', migrationName), { recursive: true });
    const migration = deploy();
    assert.ifError(migration.error);
    await verify(db, migration);
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

test('the money migration preserves existing cents, physical stock and the current address snapshot', async () => {
  await legacyDatabase(1000.25, async (db, result) => {
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const [product] = await db.$queryRaw`SELECT price::text AS price FROM "Product" WHERE id = 'migration-product'`;
    assert.equal(product.price, '1000.25');
    const [stock] = await db.$queryRaw`SELECT quantity, reserved FROM "Stock" WHERE id = 'migration-stock'`;
    assert.deepEqual(stock, { quantity: 5, reserved: 0 });
    await db.$executeRaw`UPDATE "Address" SET street = 'Changed later' WHERE id = 'migration-address'`;
    const [order] = await db.$queryRaw`SELECT total::text AS total, "reservationStatus", "addressSnapshot"
      FROM "Order" WHERE id = 'migration-order'`;
    assert.equal(order.total, '1360.29');
    assert.equal(order.reservationStatus, 'COMMITTED');
    assert.equal(order.addressSnapshot.street, 'Original street');
  });
});

test('the money migration refuses excess precision before changing data or schema', async () => {
  await legacyDatabase(1000.251, async (db, result) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /Existing money needs review before conversion/);
    const [product] = await db.$queryRaw`SELECT price::text AS price FROM "Product" WHERE id = 'migration-product'`;
    assert.equal(product.price, '1000.251');
    const [column] = await db.$queryRaw`SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Product' AND column_name = 'price'`;
    assert.equal(column.data_type, 'double precision');
    const [quote] = await db.$queryRaw`SELECT to_regclass('public."CheckoutQuote"')::text AS name`;
    assert.equal(quote.name, null);
    const [stock] = await db.$queryRaw`SELECT count(*)::int AS count FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Stock' AND column_name = 'reserved'`;
    assert.equal(stock.count, 0);
  });
});
