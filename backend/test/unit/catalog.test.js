import assert from 'node:assert/strict';
import { test } from 'node:test';
import taxonomy from '../../src/data/taxonomy.json' with { type: 'json' };
import defaults from '../../src/data/storefront-defaults.json' with { type: 'json' };
import { buildDemoCatalog } from '../../src/data/demoCatalog.js';
import { categoryContext, demoCatalogEnabled } from '../../src/services/catalogService.js';
import { storefrontSchema, catalogProductSchema } from '../../src/utils/catalogValidation.js';
import { assertDemoInitialization } from '../../src/config/databaseSafety.js';

test('taxonomy has the exact approved breadth, unique identities and valid parent paths', () => {
  const categories = taxonomy.categories.map((item) => ({ ...item, isActive: true }));
  const context = categoryContext(categories);
  const parents = new Set(categories.map((item) => item.parentId).filter(Boolean));
  assert.equal(categories.length, 291);
  assert.equal(categories.filter((item) => !item.parentId).length, 14);
  assert.equal(categories.filter((item) => item.parentId && parents.has(item.id)).length, 47);
  assert.equal(categories.filter((item) => !parents.has(item.id)).length, 230);
  assert.equal(new Set(categories.map((item) => item.slug)).size, 291);
  assert.equal(context.visible.size, 291);
});

test('category cycles and missing parents cannot become valid catalog paths', () => {
  assert.throws(() => categoryContext([{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }]), /cycle/);
  assert.throws(() => categoryContext([{ id: 'a', parentId: 'missing' }]), /parent/);
  const context = categoryContext([{ id: 'a', parentId: null, isActive: false }, { id: 'b', parentId: 'a', isActive: true }]);
  assert.equal(context.visible.has('b'), false);
});

test('demo fixtures cover every leaf without manufacturing all variant combinations', () => {
  const rows = buildDemoCatalog();
  const parents = new Set(rows.categories.map((item) => item.parentId).filter(Boolean));
  const leaves = rows.categories.filter((item) => !parents.has(item.id));
  assert.equal(rows.products.length, 230);
  assert.ok(leaves.every((leaf) => rows.products.some((product) => product.categoryId === leaf.id)));
  assert.ok(rows.products.every((product) => product.isDemo));
  assert.equal(rows.variants.length, 231);
  assert.equal(rows.stocks.length, rows.variants.length);
  assert.ok(rows.images.every((image) => image.isPlaceholder && image.sourceUrl && image.license));
  assert.ok(new Set(rows.images.map((image) => image.url)).size < rows.images.length);
});

test('publication schema excludes arbitrary/private fields and invalid responsive references', () => {
  assert.equal(storefrontSchema.safeParse(defaults).success, true);
  assert.equal(storefrontSchema.safeParse({ ...defaults, credentials: { secret: 'not-a-real-secret' } }).success, false);
  assert.equal(storefrontSchema.safeParse({ ...defaults, sections: [...defaults.sections, defaults.sections[0]] }).success, false);
  assert.equal(storefrontSchema.safeParse({
    ...defaults, sections: Array.from({ length: 13 }, (_value, index) => ({ ...defaults.sections[0], id: `section-${index}` })),
  }).success, false);
  assert.equal(catalogProductSchema.safeParse({ name: 'Test', description: 'A product fixture', price: 10, categoryId: 'category', isDemo: false }).success, false);
});

test('demo visibility cannot be enabled in production by an environment or client flag', () => {
  const nodeEnv = process.env.NODE_ENV;
  const enabled = process.env.ALLOW_DEMO_CATALOG;
  try {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEMO_CATALOG = 'true';
    assert.equal(demoCatalogEnabled(), false);
    process.env.NODE_ENV = 'test';
    assert.equal(demoCatalogEnabled(), true);
  } finally {
    process.env.NODE_ENV = nodeEnv;
    process.env.ALLOW_DEMO_CATALOG = enabled;
  }
});

test('demo initialization validates both local targets and requires consent only for writes', () => {
  const env = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/apex_test', DIRECT_URL: 'postgresql://test:test@127.0.0.1:1/apex_test' };
  assert.doesNotThrow(() => assertDemoInitialization(env, true));
  assert.throws(() => assertDemoInitialization(env), /ALLOW_DEMO_INITIALIZATION/);
  assert.doesNotThrow(() => assertDemoInitialization({ ...env, ALLOW_DEMO_INITIALIZATION: 'true' }));
  assert.throws(() => assertDemoInitialization({ ...env, NODE_ENV: 'production', ALLOW_DEMO_INITIALIZATION: 'true' }), /NODE_ENV/);
  assert.throws(() => assertDemoInitialization({ ...env, DATABASE_URL: 'postgresql://test:test@example.com/apex_test' }, true), /loopback/);
  assert.throws(() => assertDemoInitialization({ ...env, DIRECT_URL: 'postgresql://test:test@127.0.0.1:1/apex_test_other' }, true), /same local database/);
});
