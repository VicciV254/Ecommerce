import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import prisma from '../../src/config/database.js';
import { startServer } from '../../src/server.js';
import { generateToken } from '../../src/config/auth.js';
import { initializeDemo } from '../../src/services/demoInitializer.js';
import { buildDemoCatalog } from '../../src/data/demoCatalog.js';
import { categoryContext } from '../../src/services/catalogService.js';
import defaults from '../../src/data/storefront-defaults.json' with { type: 'json' };
import emailService from '../../src/services/emailService.js';

const initEnv = {
  ...process.env, ALLOW_DEMO_INITIALIZATION: 'true',
  ADMIN_EMAIL: 'catalog-staff@example.test', ADMIN_USERNAME: 'catalog-staff',
  ADMIN_PASSWORD: 'test-only-admin-password-not-for-use',
};
let base, close, staffToken, viewerToken, user, customerToken, realProduct, singleProduct;
const rows = buildDemoCatalog();
const firstDemo = rows.products[0];
const firstRoot = rows.categories.find((item) => !item.parentId);
const copy = (value) => JSON.parse(JSON.stringify(value));

before(async () => {
  mock.method(emailService, 'sendOrderConfirmation', async () => ({ success: true }));
  process.env.ALLOW_DEMO_CATALOG = 'true';
  const started = await startServer({ host: '127.0.0.1', port: 0 });
  close = started.close;
  base = `http://127.0.0.1:${started.server.address().port}/api`;
});
after(async () => { process.env.ALLOW_DEMO_CATALOG = 'false'; mock.restoreAll(); await close?.(); });

async function call(path, { method = 'GET', body, token = staffToken } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

test('fresh initialization supports a no-write dry run and creates exactly the approved scaffold', async () => {
  assert.equal((await call('/admin/init', { method: 'POST', body: { email: 'unapproved@example.test', password: 'not-used', username: 'unapproved' }, token: null })).status, 410);
  assert.equal(await prisma.admin.count(), 0);
  const dry = await initializeDemo({ dryRun: true, env: { ...initEnv, ADMIN_PASSWORD: undefined } });
  assert.equal(dry.wouldCreate.categories, 291);
  assert.equal(dry.wouldCreate.products, 230);
  assert.equal(dry.wouldCreateAdmin, true);
  assert.equal(await prisma.product.count(), 0);
  assert.equal(await prisma.admin.count(), 0);
  const result = await initializeDemo({ env: initEnv });
  assert.equal(result.created.categories, 291);
  assert.equal(result.created.products, 230);
  assert.equal(result.created.variants, 231);
  assert.equal(result.createdAdmin, true);
  const categories = await prisma.category.findMany();
  const parents = new Set(categories.map((item) => item.parentId).filter(Boolean));
  assert.equal(categories.filter((item) => !item.parentId).length, 14);
  assert.equal(categories.filter((item) => item.parentId && parents.has(item.id)).length, 47);
  assert.equal(categories.filter((item) => !parents.has(item.id)).length, 230);
  assert.equal(new Set(categories.map((item) => item.slug)).size, 291);
  const admin = await prisma.admin.findUnique({ where: { email: initEnv.ADMIN_EMAIL } });
  staffToken = generateToken({ adminId: admin.id });
  const dashboard = await call('/admin/analytics/dashboard');
  assert.equal(dashboard.data.products.total, 0);
  assert.equal(dashboard.data.products.active, 0);
  const inventory = await call('/admin/analytics/inventory');
  assert.equal(inventory.data.reduce((sum, category) => sum + category.totalValue, 0), 0);
  const viewer = await prisma.admin.create({ data: { email: 'catalog-viewer@example.test', username: 'catalog-viewer', password: 'not-used-for-login', role: 'VIEWER' } });
  viewerToken = generateToken({ adminId: viewer.id });
  user = await prisma.user.create({
    data: { email: 'catalog-customer@example.test', password: 'not-used-for-login', firstName: 'Test', lastName: 'Customer', addresses: { create: { street: 'Test street', city: 'Test city', county: 'Test county' } } },
    include: { addresses: true },
  });
  customerToken = generateToken({ userId: user.id });
});

test('public catalog, paging and department filters use the same database-backed products', async () => {
  const snapshot = await call('/catalog', { token: null });
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.data.version, 2);
  assert.equal(snapshot.data.mode, 'demo');
  assert.equal(snapshot.data.products.length, 230);
  const ids = new Set();
  for (let page = 1; page <= 3; page++) {
    const response = await call(`/products?page=${page}&limit=100`, { token: null });
    assert.equal(response.status, 200);
    assert.equal(response.data.pagination.total, 230);
    assert.equal(response.data.pagination.pages, 3);
    response.data.products.forEach((product) => ids.add(product.id));
  }
  assert.equal(ids.size, 230);
  const root = snapshot.data.categories.find((item) => item.id === firstRoot.id);
  const filtered = await call(`/products?category=${root.slug}&limit=100`, { token: null });
  assert.equal(filtered.data.pagination.total, root.productCount);
  assert.ok(filtered.data.products.every((product) => product.categoryPath.includes(root.id)));
  assert.equal((await call('/products/mens-fashion-1', { token: null })).status, 404);
  assert.equal((await call('/products?category=retired-category', { token: null })).status, 404);
  assert.equal((await call('/products?limit=101', { token: null })).status, 400);
  assert.equal((await call('/products?active=false', { token: null })).status, 400);
});

test('staff CRUD persists canonical products with real variant identity and no default stock invention', async () => {
  const group = await call('/categories', { method: 'POST', body: { name: 'Merchant group', parentId: firstRoot.id } });
  assert.equal(group.status, 201);
  const leaf = await call('/categories', { method: 'POST', body: { name: 'Accessories', parentId: group.data.id, attributeKeys: ['Material'] } });
  assert.equal(leaf.status, 201);
  const designer = await call('/designers', { method: 'POST', body: { designerId: 'merchant-studio', fullName: 'Merchant studio', specialty: 'Merchant products' } });
  assert.equal(designer.status, 201);
  const input = {
    name: 'Merchant product', description: 'A merchant-authored catalog record', price: 1000,
    categoryId: leaf.data.id, designerId: designer.data.id, isActive: true,
    specifications: { Material: 'Merchant specification' },
    variants: [
      { sku: 'MERCHANT-S', attributes: { size: 'S', color: 'Navy' }, stock: { quantity: 3, maxStock: 10, minThreshold: 1 } },
      { sku: 'MERCHANT-L', attributes: { size: 'L', color: 'Gold' }, price: 1250, stock: { quantity: 2, maxStock: 10, minThreshold: 1 } },
    ],
    images: [{ url: 'https://example.test/merchant.jpg', alt: 'Merchant supplied image' }],
  };
  assert.equal((await call('/products', { method: 'POST', body: input, token: viewerToken })).status, 403);
  const created = await call('/products', { method: 'POST', body: input });
  assert.equal(created.status, 201);
  realProduct = created.data;
  assert.equal(realProduct.isDemo, false);
  assert.equal(realProduct.stock, 5);
  assert.deepEqual(realProduct.variants.map((variant) => variant.price), [1000, 1250]);
  assert.equal((await call(`/products/${realProduct.id}`, { token: null })).data.name, input.name);
  const renamed = await call(`/products/${realProduct.id}`, { method: 'PUT', body: { name: 'Merchant product revised' } });
  assert.equal(renamed.data.slug, realProduct.slug);
  assert.deepEqual(renamed.data.variants.map((variant) => variant.id), realProduct.variants.map((variant) => variant.id));
  const defaultProduct = await call('/products', { method: 'POST', body: {
    name: 'Single SKU product', description: 'A product with one default SKU', price: 1500, categoryId: leaf.data.id, isActive: true,
  } });
  assert.equal(defaultProduct.status, 201);
  singleProduct = defaultProduct.data;
  assert.equal(singleProduct.variants.length, 1);
  assert.equal(singleProduct.variants[0].stock, 0);
  assert.equal((await call(`/products/${realProduct.id}`, { method: 'PUT', body: { isDemo: true } })).status, 400);
  const before = await prisma.product.count();
  const conflict = await call('/products', { method: 'POST', body: { ...input, name: 'Conflicting SKU product' } });
  assert.equal(conflict.status, 409);
  assert.equal(await prisma.product.count(), before);
  const ambiguous = await call(`/products/${realProduct.id}`, { method: 'PUT', body: {
    variants: [{ id: realProduct.variants[0].id, attributes: {} }, { id: realProduct.variants[1].id, attributes: {} }],
  } });
  assert.equal(ambiguous.status, 400);
  const foreignImage = await prisma.productImage.findFirst({ where: { productId: firstDemo.id } });
  const forbiddenImage = await call(`/products/${realProduct.id}`, { method: 'PUT', body: {
    name: 'Must not be retained', images: [{ id: foreignImage.id, url: 'https://example.test/foreign.jpg' }],
  } });
  assert.equal(forbiddenImage.status, 400);
  assert.equal((await prisma.product.findUnique({ where: { id: realProduct.id } })).name, 'Merchant product revised');
});

test('category cycles, inherited visibility and stock validation cannot corrupt catalog state', async () => {
  const firstLeaf = await prisma.category.findUnique({ where: { id: firstDemo.categoryId } });
  const cycle = await call(`/categories/${firstRoot.id}`, { method: 'PUT', body: { parentId: firstLeaf.id } });
  assert.equal(cycle.status, 400);
  assert.equal((await prisma.category.findUnique({ where: { id: firstRoot.id } })).parentId, null);
  assert.equal((await call(`/categories/${firstRoot.id}`, { method: 'DELETE' })).status, 409);
  assert.equal((await call(`/categories/${firstRoot.id}`, { method: 'PUT', body: { isActive: false } })).status, 200);
  assert.equal((await call(`/products/${firstDemo.id}`, { token: null })).status, 404);
  assert.ok((await call('/catalog', { token: null })).data.products.every((product) => !product.categoryPath.includes(firstRoot.id)));
  assert.equal((await call(`/categories/${firstRoot.id}`, { method: 'PUT', body: { isActive: true } })).status, 200);
  const a = (await call('/categories', { method: 'POST', body: { name: 'Cycle test A', parentId: firstRoot.id } })).data;
  const b = (await call('/categories', { method: 'POST', body: { name: 'Cycle test B', parentId: firstRoot.id } })).data;
  const concurrent = await Promise.all([
    call(`/categories/${a.id}`, { method: 'PUT', body: { parentId: b.id } }),
    call(`/categories/${b.id}`, { method: 'PUT', body: { parentId: a.id } }),
  ]);
  assert.equal(concurrent.filter((result) => result.status === 200).length, 1);
  assert.ok(concurrent.some((result) => [400, 409].includes(result.status)));
  const categories = await prisma.category.findMany();
  assert.doesNotThrow(() => categoryContext(categories));
  const variant = singleProduct.variants[0];
  assert.equal((await call(`/admin/stock/${variant.id}`, { method: 'PUT', body: { quantity: -1 } })).status, 400);
  const stock = await call(`/admin/stock/${variant.id}`, { method: 'PUT', body: { quantity: 5, minThreshold: 0 } });
  assert.equal(stock.status, 200);
  assert.equal(stock.data.quantity, 5);
  assert.equal(stock.data.minThreshold, 0);
  const before = stock.data.quantity;
  const bulk = await call('/admin/stock/bulk', { method: 'POST', body: { updates: [
    { variantId: variant.id, quantity: 2 }, { variantId: 'missing-variant', quantity: 4 },
  ] } });
  assert.equal(bulk.status, 404);
  assert.equal((await prisma.stock.findUnique({ where: { variantId: variant.id } })).quantity, before);
});

test('unknown variants, demo orders and legacy input paths fail before commercial side effects', async () => {
  const demo = (await call(`/products/${firstDemo.id}`, { token: null })).data;
  assert.equal((await call('/cart/items', { method: 'POST', token: customerToken, body: { productId: demo.id, variantId: 'unknown', quantity: 1 } })).status, 404);
  const added = await call('/cart/items', { method: 'POST', token: customerToken, body: { productId: demo.id, variantId: demo.variants[0].id, quantity: 1 } });
  assert.equal(added.status, 200);
  const before = await prisma.order.count();
  const rejected = await call('/orders', { method: 'POST', token: customerToken, body: {
    addressId: user.addresses[0].id, paymentMethod: 'MPESA', deliveryMethod: 'STANDARD', isDemo: false,
  } });
  assert.equal(rejected.status, 409);
  assert.equal(await prisma.order.count(), before);
  assert.equal((await call('/admin/orders/import-local', { method: 'POST', body: { receipts: [{ paymentStatus: 'PAID' }] } })).status, 410);
  assert.equal((await call('/settings/admin-data', { method: 'PUT', body: { admin: { customProducts: [{ id: 'legacy' }] } } })).status, 410);
  assert.equal((await call('/mpesa/stk-push', { method: 'POST', token: customerToken, body: { phone: '254700000000', amount: 1, orderNumber: 'demo' } })).status, 503);
  assert.equal((await call('/mpesa/callback', { method: 'POST', token: null, body: { Body: { stkCallback: { ResultCode: 0 } } } })).status, 503);
  assert.equal(await prisma.mpesaPayment.count(), 0);
  assert.equal((await call('/cart', { method: 'DELETE', token: customerToken })).status, 200);
});

test('production visibility and real analytics exclude demo data even when the preview flag is set', async () => {
  const dashboard = (await call('/admin/analytics/dashboard')).data;
  const demoOrder = await prisma.order.create({ data: {
    orderNumber: 'DEMO-REPORT-ONLY', userId: user.id, addressId: user.addresses[0].id,
    subtotal: 999999, tax: 0, shippingCost: 0, total: 999999,
    paymentMethod: 'MPESA', paymentStatus: 'PAID', isDemo: true,
  } });
  const after = (await call('/admin/analytics/dashboard')).data;
  assert.equal(after.sales.total, dashboard.sales.total);
  assert.equal(after.orders.total, dashboard.orders.total);
  assert.equal((await call(`/orders/${demoOrder.id}`, { token: customerToken })).status, 404);
  assert.equal((await call(`/orders/track/${demoOrder.orderNumber}`, { token: null })).status, 404);
  assert.ok((await call('/orders', { token: customerToken })).data.orders.every((item) => !item.isDemo));
  assert.equal((await call('/orders/admin/auto-stage/bulk', { method: 'POST', body: { orderIds: [demoOrder.id], enabled: false } })).status, 200);
  assert.equal((await prisma.order.findUnique({ where: { id: demoOrder.id } })).autoStageEnabled, demoOrder.autoStageEnabled);
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    const publicCatalog = await call('/catalog?demo=true', { token: null });
    assert.equal(publicCatalog.data.mode, 'live');
    assert.ok(publicCatalog.data.products.every((product) => !product.isDemo));
    assert.ok(publicCatalog.data.discounts.every((discount) => !discount.isDemo));
    assert.equal((await call(`/products/${firstDemo.id}`, { token: null })).status, 404);
  } finally { process.env.NODE_ENV = previous; }
});

test('drafts, responsive media and publication references are versioned and projected safely', async () => {
  let draft = (await call('/settings/storefront/draft')).data;
  assert.equal(draft.version, 1);
  const desktop = (await call('/media', { method: 'POST', body: { url: 'https://example.test/desktop.jpg', alt: 'Desktop artwork' } })).data;
  const mobile = (await call('/media', { method: 'POST', body: { url: 'https://example.test/mobile.jpg', alt: 'Mobile artwork' } })).data;
  const settings = copy(defaults);
  settings.theme.colors.primary = '#123456';
  settings.campaigns = [{
    id: 'test-campaign', title: 'Draft-only heading', body: 'Shared offer copy', conditions: 'Same conditions on every screen',
    cta: { label: 'Browse', target: 'product', targetId: firstDemo.id },
    desktopMediaId: desktop.id, mobileMediaId: mobile.id,
    desktopFocal: { x: 50, y: 50 }, mobileFocal: { x: 70, y: 20 }, layout: 'split',
  }];
  settings.sections.push({ id: 'hero', type: 'campaign', title: 'Hero', enabled: true, productIds: [], categoryIds: [], campaignId: 'test-campaign' });
  assert.equal((await call('/settings/storefront/draft', { method: 'PUT', token: viewerToken, body: { version: 1, settings } })).status, 403);
  assert.equal((await call('/settings/storefront/draft', { method: 'PUT', body: { version: 1, settings: { ...settings, secret: 'not-real' } } })).status, 400);
  const invalid = copy(settings); invalid.campaigns[0].desktopMediaId = 'missing-image';
  assert.equal((await call('/settings/storefront/draft', { method: 'PUT', body: { version: 1, settings: invalid } })).status, 400);
  draft = (await call('/settings/storefront/draft', { method: 'PUT', body: { version: 1, settings } })).data;
  assert.equal(draft.version, 2);
  assert.equal(draft.media.length, 2);
  const reloadedDraft = await call('/settings/storefront/draft');
  assert.equal(reloadedDraft.data.media.length, 2);
  assert.deepEqual(reloadedDraft.data.unavailableMediaIds, []);
  await prisma.productImage.update({ where: { id: desktop.id }, data: { deletedAt: new Date() } });
  const staleMedia = await call('/settings/storefront/draft');
  assert.equal(staleMedia.status, 200);
  assert.deepEqual(staleMedia.data.unavailableMediaIds, [desktop.id]);
  assert.equal(staleMedia.data.settings.campaigns[0].desktopMediaId, desktop.id);
  await prisma.productImage.update({ where: { id: desktop.id }, data: { deletedAt: null } });
  const beforePublish = await call('/settings/storefront', { token: null });
  assert.equal(JSON.stringify(beforePublish.data).includes('Draft-only heading'), false);
  assert.equal((await call('/settings/storefront/draft', { method: 'PUT', body: { version: 1, settings } })).status, 409);
  const published = await call('/settings/storefront/publish', { method: 'POST', body: { version: 2 } });
  assert.equal(published.status, 200);
  assert.equal(published.data.version, 3);
  assert.equal(published.data.media.length, 2);
  assert.deepEqual(published.data.settings.campaigns[0].cta, settings.campaigns[0].cta);
  assert.equal((await call(`/products/${firstDemo.id}`, { method: 'DELETE' })).status, 409);
  assert.equal((await call(`/categories/${firstRoot.id}`, { method: 'PUT', body: { isActive: false } })).status, 409);
  settings.campaigns[0].mobileMediaId = null;
  settings.campaigns.push({ ...settings.campaigns[0], id: 'inactive-campaign', title: 'Never expose this inactive campaign' });
  settings.sections.push({ id: 'inactive', type: 'campaign', title: 'Inactive', enabled: false, productIds: [], categoryIds: [], campaignId: 'inactive-campaign' });
  const changed = await call('/settings/storefront/draft', { method: 'PUT', body: { version: 3, settings } });
  const fallback = await call('/settings/storefront/publish', { method: 'POST', body: { version: changed.data.version } });
  assert.equal(fallback.status, 200);
  assert.equal(fallback.data.media.length, 1);
  assert.equal(fallback.data.settings.campaigns[0].mobileMediaId, null);
  assert.equal(JSON.stringify(fallback.data).includes('Never expose'), false);
  const cleared = copy(defaults); cleared.theme.colors.primary = '#123456';
  const clearDraft = await call('/settings/storefront/draft', { method: 'PUT', body: { version: fallback.data.version, settings: cleared } });
  assert.equal((await call('/settings/storefront/publish', { method: 'POST', body: { version: clearDraft.data.version } })).status, 200);
});

test('reinitialization preserves customized media, deleted fixtures, new records and staff credentials', async () => {
  const photo = (await prisma.productImage.findFirst({ where: { productId: firstDemo.id } }));
  const demoVariant = await prisma.productVariant.findFirst({ where: { productId: firstDemo.id } });
  assert.equal((await call(`/admin/stock/${demoVariant.id}`, { method: 'PUT', body: { quantity: 7 } })).status, 200);
  assert.equal((await call(`/categories/${firstDemo.categoryId}`, { method: 'PUT', body: { name: 'Customized category', slug: 'customized-category' } })).status, 200);
  assert.equal((await call(`/products/${firstDemo.id}`, { method: 'PUT', body: {
    name: 'Customized demo item', price: 1777,
    images: [{ id: photo.id, url: 'https://example.test/customized.jpg', isPlaceholder: false, sourceUrl: null, license: null }],
  } })).status, 200);
  const retired = rows.products[1];
  assert.equal((await call(`/products/${retired.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call(`/products/${retired.id}`, { token: null })).status, 404);
  assert.equal((await call('/cart/items', { method: 'POST', token: customerToken, body: { productId: singleProduct.id, variantId: singleProduct.variants[0].id, quantity: 1 } })).status, 200);
  const order = await call('/orders', { method: 'POST', token: customerToken, body: {
    addressId: user.addresses[0].id, paymentMethod: 'MPESA', deliveryMethod: 'STANDARD', paymentStatus: 'PAID',
  } });
  assert.equal(order.status, 201);
  assert.equal(order.data.paymentStatus, 'PENDING');
  const admin = await prisma.admin.findUnique({ where: { email: initEnv.ADMIN_EMAIL } });
  const version = (await call('/settings/storefront/draft')).data.version;
  const userCount = await prisma.user.count(), orderCount = await prisma.order.count();
  const again = await initializeDemo({ env: { ...initEnv, ADMIN_PASSWORD: 'different-test-password-must-not-replace' } });
  assert.ok(Object.values(again.created).every((count) => count === 0));
  assert.equal(again.createdAdmin, false);
  assert.equal((await prisma.product.findUnique({ where: { id: firstDemo.id } })).price, 1777);
  assert.equal((await prisma.productImage.findUnique({ where: { id: photo.id } })).url, 'https://example.test/customized.jpg');
  assert.equal((await prisma.stock.findUnique({ where: { variantId: demoVariant.id } })).quantity, 7);
  assert.equal((await prisma.category.findUnique({ where: { id: firstDemo.categoryId } })).slug, 'customized-category');
  assert.ok((await prisma.product.findUnique({ where: { id: retired.id } })).deletedAt);
  assert.ok(await prisma.product.findUnique({ where: { id: realProduct.id } }));
  assert.equal(await prisma.user.count(), userCount);
  assert.equal(await prisma.order.count(), orderCount);
  assert.equal((await prisma.admin.findUnique({ where: { id: admin.id } })).password, admin.password);
  assert.equal((await call('/settings/storefront/draft')).data.version, version);
  assert.equal((await call('/settings/storefront', { token: null })).data.settings.theme.colors.primary, '#123456');
  const cli = spawnSync(process.execPath, ['scripts/init-demo.js', '--dry-run'], {
    env: initEnv, encoding: 'utf8', timeout: 15_000,
  });
  assert.ifError(cli.error);
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout.trim()).dryRun, true);
  assert.equal(cli.stdout.includes(initEnv.ADMIN_PASSWORD), false);
  await assert.rejects(initializeDemo({ env: { ...initEnv, ADMIN_EMAIL: 'another-admin@example.test' } }), /already initialized/);
});
