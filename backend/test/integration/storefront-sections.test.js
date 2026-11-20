import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import prisma from '../../src/config/database.js';
import { startServer } from '../../src/server.js';
import { generateToken } from '../../src/config/auth.js';
import defaults from '../../src/data/storefront-defaults.json' with { type: 'json' };

/*
 * P8.7 over HTTP: the new section kinds and layouts are saved, published and read back as stored; documents stored
 * before them still read and restore unchanged; each new rule is refused on save without writing; a department row's
 * category follows the reference rules of every other section.
 */
const KEY = 'storefront-v2';
const copy = (value) => JSON.parse(JSON.stringify(value));
const CLAIM = (title) => `Section "${title}": headings can't claim a ranking or popularity the store doesn't measure, such as "best sellers", "top rated" or "trending". Use a heading such as "Featured" or "Staff picks".`;

let base, close, token, fashion, shirts, product, sequence = 0;

before(async () => {
  const admin = await prisma.admin.create({ data: {
    email: 'sections-admin@example.test', username: 'sections-admin', password: 'fixture-not-for-login', role: 'ADMIN',
  } });
  token = generateToken({ adminId: admin.id });
  const started = await startServer({ host: '127.0.0.1', port: 0 });
  close = started.close;
  base = `http://127.0.0.1:${started.server.address().port}/api`;
  fashion = await created('/categories', { name: 'Sections fashion' });
  shirts = await created('/categories', { name: 'Sections shirts', parentId: fashion.id });
  product = await created('/products', {
    name: 'Sections linen shirt', description: 'A shirt for the section checks', price: 1500, categoryId: shirts.id, isActive: true,
    variants: [{ sku: `SECT-${++sequence}`, attributes: { size: 'M' }, stock: { quantity: 4 } }],
  });
});
after(async () => { await close?.(); });

async function call(path, { method = 'GET', body, auth = true } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth && { Authorization: `Bearer ${token}` }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

async function created(path, body) {
  const response = await call(path, { method: 'POST', body });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data;
}

const section = (id, type, title, extra = {}) => ({
  id, type, title, enabled: true, productIds: [], categoryIds: [], campaignId: null, ...extra,
});
const documentWith = (sections) => ({ ...copy(defaults), sections });

/** Every kind and layout P8.7 adds, beside an older section without a layout. */
const newKinds = () => documentWith([
  section('departments', 'departments', 'Shop by department', { layout: 'grid' }),
  section('facts', 'promises', 'How shopping works'),
  section('fashion', 'category', 'Sections fashion', { categoryIds: [fashion.id] }),
  section('fashion-grid', 'category', 'Fashion, all of it', { categoryIds: [fashion.id], layout: 'grid' }),
  section('best', 'bestSellers', 'Best sellers'),
  section('picks', 'products', 'Staff picks', { productIds: [product.id], layout: 'rail' }),
  section('featured', 'featured', 'Featured products'),
]);

const storefrontRow = () => prisma.siteSetting.findUnique({ where: { key: KEY } });
const draftNow = async () => (await call('/settings/storefront/draft')).data;
async function saveDraft(settings) {
  const response = await call('/settings/storefront/draft', { method: 'PUT', body: { version: (await draftNow()).version, settings } });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data;
}
async function publishNow() {
  const response = await call('/settings/storefront/publish', { method: 'POST', body: { version: (await draftNow()).version } });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data;
}

test('a document stored before the new kinds still reads, publishes and restores exactly as stored, with no layout added', async () => {
  const older = documentWith([
    section('departments', 'departments', 'Shop by department', { categoryIds: [fashion.id] }),
    section('featured', 'featured', 'Featured products'),
    section('picks', 'products', 'Staff picks', { productIds: [product.id] }),
  ]);
  // Written as an earlier version of the API stored it, without going through this version's save.
  await prisma.siteSetting.update({ where: { key: KEY }, data: { value: older, version: { increment: 1 } } });
  const draft = await draftNow();
  assert.deepEqual(draft.settings, older);
  const published = await publishNow();
  assert.deepEqual(published.settings, older);
  const shopper = await call('/settings/storefront', { auth: false });
  assert.equal(shopper.status, 200, JSON.stringify(shopper.data));
  assert.deepEqual(shopper.data.settings.sections, older.sections);

  // A newer document replaces it; restoring the older publication brings it back unchanged.
  await saveDraft(newKinds());
  await publishNow();
  const restored = await call(`/settings/storefront/revisions/${published.version}/restore`, { method: 'POST', body: { version: (await draftNow()).version } });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  assert.deepEqual(restored.data.settings, older);
  assert.deepEqual((await storefrontRow()).value, older);
});

test('saves and publishes every new kind and layout; drafts and shoppers read them back as stored', async () => {
  const settings = newKinds();
  const saved = await saveDraft(settings);
  assert.deepEqual(saved.settings, settings);
  const published = await publishNow();
  assert.deepEqual(published.settings.sections, settings.sections);
  const shopper = await call('/settings/storefront', { auth: false });
  assert.equal(shopper.status, 200, JSON.stringify(shopper.data));
  assert.deepEqual(shopper.data.settings.sections, settings.sections);
  // Hidden sections stay out of the public read, as before.
  settings.sections[1].enabled = false;
  await saveDraft(settings);
  await publishNow();
  assert.deepEqual((await call('/settings/storefront', { auth: false })).data.settings.sections.map((item) => item.id),
    ['departments', 'fashion', 'fashion-grid', 'best', 'picks', 'featured']);
});

test('each new rule is refused on save with 400, and nothing is written', async () => {
  const before = await storefrontRow();
  const refusals = [
    [[section('facts', 'promises', 'How shopping works', { layout: 'grid' })], 'Only departments, featured products, selected products and department row sections have a layout'],
    [[section('row', 'category', 'Department row')], 'A department row shows exactly one category and no chosen products'],
    [[section('row', 'category', 'Two', { categoryIds: [fashion.id, shirts.id] })], 'A department row shows exactly one category and no chosen products'],
    [[section('row', 'category', 'Chosen', { categoryIds: [fashion.id], productIds: [product.id] })], 'A department row shows exactly one category and no chosen products'],
    [[section('best', 'bestSellers', 'Best sellers', { productIds: [product.id] })], 'Shopping facts and best sellers sections take no products or categories'],
    [[section('facts', 'promises', 'One'), section('facts-2', 'promises', 'Two')], 'A storefront has at most one shopping facts section and one best sellers section'],
    [[section('best', 'bestSellers', 'Top picks')], 'The best sellers section is titled "Best sellers"'],
  ];
  for (const [sections, message] of refusals) {
    const response = await call('/settings/storefront/draft', { method: 'PUT', body: { version: before.version, settings: documentWith(sections) } });
    assert.equal(response.status, 400, message);
    assert.deepEqual(response.data.details.map((detail) => detail.message), [message]);
  }
  assert.deepEqual(await storefrontRow(), before);
});

test('only the measured best sellers section may carry the "Best sellers" heading', async () => {
  const claimed = documentWith([section('featured', 'featured', 'Best sellers')]);
  const refused = await call('/settings/storefront/draft', { method: 'PUT', body: { version: (await draftNow()).version, settings: claimed } });
  assert.equal(refused.status, 400, JSON.stringify(refused.data));
  assert.deepEqual(refused.data.details, [{ path: 'sections.0.title', message: CLAIM('Best sellers') }]);
  assert.equal((await saveDraft(documentWith([section('best', 'bestSellers', 'Best sellers')]))).settings.sections[0].title, 'Best sellers');
});

test("a department row's category must be visible to publish and cannot be hidden or deleted while published", async () => {
  const hidden = await created('/categories', { name: 'Sections hidden row', isActive: false });
  const settings = documentWith([section('row', 'category', 'Sections hidden row', { categoryIds: [hidden.id] })]);
  // A hidden category may sit in a draft; publishing needs it visible.
  await saveDraft(settings);
  const refused = await call('/settings/storefront/publish', { method: 'POST', body: { version: (await draftNow()).version } });
  assert.deepEqual(refused, { status: 400, data: { error: 'A referenced category is unavailable' } });

  const shown = await call(`/categories/${hidden.id}`, { method: 'PUT', body: { isActive: true, expectedUpdatedAt: hidden.updatedAt } });
  assert.equal(shown.status, 200, JSON.stringify(shown.data));
  await publishNow();
  const hide = await call(`/categories/${hidden.id}`, { method: 'PUT', body: { isActive: false, expectedUpdatedAt: shown.data.updatedAt } });
  assert.equal(hide.status, 409, JSON.stringify(hide.data));
  assert.match(hide.data.error, /published storefront/);
  const remove = await call(`/categories/${hidden.id}`, { method: 'DELETE' });
  assert.equal(remove.status, 409, JSON.stringify(remove.data));
});

test('this API refuses on read a stored section kind it does not know (the rollback case SETUP.md describes)', async () => {
  const live = await storefrontRow();
  const later = documentWith([section('stores', 'stores', 'Our sellers')]);
  try {
    await prisma.siteSetting.update({ where: { key: KEY }, data: { publishedValue: later, value: later } });
    assert.deepEqual(await call('/settings/storefront', { auth: false }), { status: 503, data: { error: 'Published storefront data is invalid' } });
    assert.deepEqual(await call('/settings/storefront/draft'), { status: 503, data: { error: 'Storefront draft data is invalid' } });
  } finally {
    await prisma.siteSetting.update({ where: { key: KEY }, data: { publishedValue: live.publishedValue, value: live.value } });
  }
});
