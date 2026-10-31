import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { assertDemoInitialization } from '../config/databaseSafety.js';
import { buildDemoCatalog } from '../data/demoCatalog.js';
import { STOREFRONT_KEY } from '../utils/catalogValidation.js';

const adminSchema = z.object({
  email: z.string().email().max(320),
  username: z.string().trim().min(3).max(80),
  password: z.string().min(12).max(256).optional(),
});

export async function initializeDemo({ dryRun = false, env = process.env } = {}) {
  const { app } = assertDemoInitialization(env, dryRun);
  const admin = adminSchema.parse({ email: env.ADMIN_EMAIL, username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD || undefined });
  const rows = buildDemoCatalog();
  const client = new PrismaClient({ datasources: { db: { url: app.href } } });
  try {
    return await client.$transaction(async (db) => {
      if (!await db.siteSetting.findUnique({ where: { key: STOREFRONT_KEY } })) {
        throw new Error('Apply the canonical catalog migration before initialization');
      }
      if (await db.product.count({ where: { variants: { none: {} } } })) {
        throw new Error('Catalog records without variants were found. Use an approved fresh database rather than importing legacy records.');
      }
      const existingAdmin = await db.admin.findUnique({ where: { email: admin.email } });
      if (!existingAdmin && await db.admin.count()) {
        throw new Error('Staff access is already initialized; reuse its configured account rather than creating another administrator');
      }
      if (!existingAdmin && !dryRun && !admin.password) throw new Error('ADMIN_PASSWORD of at least 12 characters is required to create staff access');
      if (!existingAdmin && await db.admin.findUnique({ where: { username: admin.username } })) {
        throw new Error('ADMIN_USERNAME is already used by another staff account');
      }
      const plan = {};
      const models = { categories: 'category', designers: 'designer', products: 'product', variants: 'productVariant', stocks: 'stock', images: 'productImage', discounts: 'discount' };
      for (const [key, model] of Object.entries(models)) {
        const existing = await db[model].findMany({ where: { id: { in: rows[key].map((item) => item.id) } }, select: { id: true } });
        const ids = new Set(existing.map((item) => item.id));
        plan[key] = rows[key].filter((item) => !ids.has(item.id));
      }
      const counts = Object.fromEntries(Object.entries(plan).map(([key, value]) => [key, value.length]));
      if (dryRun) return { dryRun: true, wouldCreate: counts, wouldCreateAdmin: !existingAdmin };
      for (const [key, model] of Object.entries(models)) {
        if (plan[key].length) await db[model].createMany({ data: plan[key] });
      }
      if (!existingAdmin) {
        await db.admin.create({ data: {
          email: admin.email, username: admin.username, password: await bcrypt.hash(admin.password, 10), role: 'SUPER_ADMIN',
        } });
      }
      return { dryRun: false, created: counts, createdAdmin: !existingAdmin };
    }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 60_000 });
  } catch (error) {
    if (error.code === 'P2002' || error.code === 'P2003') {
      throw new Error('Demo identifiers conflict with existing catalog data; no initialization changes were retained', { cause: error });
    }
    throw error;
  } finally {
    await client.$disconnect();
  }
}
