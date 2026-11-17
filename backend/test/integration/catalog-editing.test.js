import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import prisma from '../../src/config/database.js';
import { startServer } from '../../src/server.js';
import { generateToken } from '../../src/config/auth.js';

/*
 * P8.2: two staff editors cannot silently overwrite each other. Each editor sends back the `updatedAt` it loaded from
 * the staff catalog as `expectedUpdatedAt`; a save made against an older version is refused before anything is written.
 * Also the category order: `POST /categories/reorder` and new categories after their last sibling.
 */
const PRODUCT_CHANGED = 'Someone else changed this product after you opened it. Reload it to see their changes, then make yours again.';
const CATEGORY_CHANGED = 'Someone else changed this category after you opened it. Reload it to see their changes, then make yours again.';
const SIBLINGS_CHANGED = 'The categories here changed after you opened them. Reload and try again.';

let base, close, staffToken, viewerToken, category, otherCategory, sequence = 0;

before(async () => {
  const [admin, viewer] = await Promise.all(['ADMIN', 'VIEWER'].map((role) => prisma.admin.create({ data: {
    email: `editing-${role.toLowerCase()}@example.test`, username: `editing-${role.toLowerCase()}`,
    password: 'fixture-not-for-login', role,
  } })));
  staffToken = generateToken({ adminId: admin.id });
  viewerToken = generateToken({ adminId: viewer.id });
  const started = await startServer({ host: '127.0.0.1', port: 0 });
  close = started.close;
  base = `http://127.0.0.1:${started.server.address().port}/api`;
  category = await createCategory('Editing department');
  otherCategory = await createCategory('Other department');
});
after(async () => { await close?.(); });

async function call(path, { method = 'GET', body, token = staffToken } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

async function createCategory(name, parentId = null) {
  const response = await call('/categories', { method: 'POST', body: { name, ...(parentId && { parentId }) } });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data;
}

async function createProduct(name, overrides = {}) {
  const tag = `EDIT-${++sequence}`;
  const response = await call('/products', { method: 'POST', body: {
    name, description: `${name}, the original description`, price: 1000, categoryId: category.id, isActive: true,
    variants: [{ sku: `${tag}-M`, attributes: { size: 'M' }, stock: { quantity: 3, maxStock: 10, minThreshold: 1 } }],
    images: [{ url: `https://example.test/${tag.toLowerCase()}.jpg`, alt: `${name} photo` }],
    ...overrides,
  } });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data;
}

/** What a staff editor holds after opening the staff catalog: the record as listed there, with its token. */
async function open(kind, id) {
  const snapshot = (await call('/admin/catalog')).data;
  return snapshot[kind === 'product' ? 'products' : 'categories'].find((item) => item.id === id);
}

const save = (kind, id, body) => call(`/${kind === 'product' ? 'products' : 'categories'}/${id}`, { method: 'PUT', body });

/** Every row a product save can touch, so a refused save can be shown to have written nothing. */
async function productRows(id) {
  const product = await prisma.product.findUnique({
    where: { id },
    include: { variants: { include: { stock: true }, orderBy: { id: 'asc' } }, images: { orderBy: { id: 'asc' } } },
  });
  const stockLogs = await prisma.stockLog.count({ where: { stock: { variant: { productId: id } } } });
  return { product, stockLogs };
}

test('two editors: the later save made against an older version is refused and the first editor\'s price is kept', async () => {
  const product = await createProduct('Conflict jacket');
  const editorA = await open('product', product.id);
  const editorB = await open('product', product.id);

  const saveA = await save('product', product.id, { price: 1500, expectedUpdatedAt: editorA.updatedAt });
  assert.equal(saveA.status, 200, JSON.stringify(saveA.data));
  // B changes only the description, but its editor sends every field it loaded, including the old price.
  const saveB = await save('product', product.id, {
    name: editorB.name, description: 'Editor B rewrote the description', price: editorB.price,
    expectedUpdatedAt: editorB.updatedAt,
  });
  const stored = await prisma.product.findUnique({ where: { id: product.id } });
  assert.equal(Number(stored.price), 1500, `B's save (answered ${saveB.status}) silently restored the price A had replaced`);
  assert.equal(stored.description, 'Conflict jacket, the original description');
  assert.equal(saveB.status, 409);
  assert.deepEqual(saveB.data, { error: PRODUCT_CHANGED, code: 'PRODUCT_CHANGED' });

  // Reloading gives B the current version: its own change then saves and keeps A's price.
  const reloaded = await open('product', product.id);
  assert.equal(reloaded.price, 1500);
  const retried = await save('product', product.id, { description: 'Editor B rewrote the description', expectedUpdatedAt: reloaded.updatedAt });
  assert.equal(retried.status, 200, JSON.stringify(retried.data));
  assert.equal(retried.data.price, 1500);
  assert.equal(retried.data.description, 'Editor B rewrote the description');
  assert.notEqual(retried.data.updatedAt, reloaded.updatedAt);
  assert.equal(retried.data.updatedAt, (await open('product', product.id)).updatedAt);
});

/** Codes after which an editor reloads the record and tries again: someone else's save, or a write that raced it. */
const RELOAD_CODES = ['PRODUCT_CHANGED', 'CATEGORY_CHANGED', 'CATALOG_CHANGED'];

test('two saves racing with the same version: exactly one is kept, and the other is refused with a code the editor can act on', async () => {
  const outcomes = [];
  for (let round = 0; round < 6; round += 1) {
    const product = await createProduct(`Race coat ${round}`);
    const loaded = await open('product', product.id);
    const [a, b] = await Promise.all([
      save('product', product.id, { price: 1500, expectedUpdatedAt: loaded.updatedAt }),
      save('product', product.id, { name: loaded.name, description: `Racing editor rewrote round ${round}`, price: loaded.price, expectedUpdatedAt: loaded.updatedAt }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 409], `round ${round}: ${JSON.stringify([a.data, b.data])}`);
    const [winner, loser] = a.status === 200 ? ['price', b] : ['description', a];
    const stored = await prisma.product.findUnique({ where: { id: product.id } });
    // Only the winner's change is stored: the loser neither overwrote it nor merged in.
    assert.equal(Number(stored.price), winner === 'price' ? 1500 : 1000, `round ${round}`);
    assert.equal(stored.description, winner === 'price' ? `Race coat ${round}, the original description` : `Racing editor rewrote round ${round}`);
    assert.ok(RELOAD_CODES.includes(loser.data.code), `round ${round}: the refused save carried ${JSON.stringify(loser.data)}`);
    outcomes.push(loser.data.code);
  }
  console.log(`race outcomes: ${outcomes.join(', ')}`);
});

test('every staff edit moves the token: a variant-only edit, an image-only edit and a field edit', async () => {
  const product = await createProduct('Token blazer');
  for (const [label, change] of [
    ['variant-only', (record) => ({ variants: [
      { id: record.variants[0].id, isActive: true },
      { sku: `EDIT-${++sequence}-L`, attributes: { size: 'L' }, stock: { quantity: 2 } },
    ] })],
    ['image-only', (record) => ({ images: [{ id: record.images[0].id, alt: 'A new description of the photo' }] })],
    ['field', () => ({ isFeatured: true })],
  ]) {
    const record = await open('product', product.id);
    const storedBefore = (await prisma.product.findUnique({ where: { id: product.id } })).updatedAt;
    const response = await save('product', product.id, { ...change(record), expectedUpdatedAt: record.updatedAt });
    assert.equal(response.status, 200, `${label}: ${JSON.stringify(response.data)}`);
    const storedAfter = (await prisma.product.findUnique({ where: { id: product.id } })).updatedAt;
    assert.ok(storedAfter > storedBefore, `${label}: the stored version did not move (${storedBefore.toISOString()})`);
    assert.equal(response.data.updatedAt, storedAfter.toISOString(), `${label}: the response carries the new token`);
    // The version this editor opened is now stale.
    const stale = await save('product', product.id, { name: 'Must not be saved', expectedUpdatedAt: record.updatedAt });
    assert.equal(stale.status, 409, `${label}: a save with the previous token was accepted`);
  }
  assert.equal((await prisma.product.findUnique({ where: { id: product.id } })).name, 'Token blazer');
});

test('a stale hide is refused and the product stays visible to shoppers', async () => {
  const product = await createProduct('Visible scarf');
  const stale = await open('product', product.id);
  assert.equal((await save('product', product.id, { name: 'Visible scarf, renamed', expectedUpdatedAt: stale.updatedAt })).status, 200);
  const hide = await save('product', product.id, { isActive: false, expectedUpdatedAt: stale.updatedAt });
  assert.equal(hide.status, 409);
  assert.equal(hide.data.code, 'PRODUCT_CHANGED');
  assert.equal((await prisma.product.findUnique({ where: { id: product.id } })).isActive, true);
  const shopper = await call(`/products/${product.id}`, { token: null });
  assert.equal(shopper.status, 200);
  assert.equal(shopper.data.name, 'Visible scarf, renamed');
});

test('a stale category rename or visibility toggle is refused', async () => {
  const target = await createCategory('Conflict category', category.id);
  const editorA = await open('category', target.id);
  const editorB = await open('category', target.id);
  const renameA = await save('category', target.id, { name: 'Renamed by A', expectedUpdatedAt: editorA.updatedAt });
  assert.equal(renameA.status, 200, JSON.stringify(renameA.data));
  assert.notEqual(renameA.data.updatedAt, editorA.updatedAt);
  for (const body of [{ name: 'Renamed by B' }, { isActive: false }]) {
    const stale = await save('category', target.id, { ...body, expectedUpdatedAt: editorB.updatedAt });
    assert.equal(stale.status, 409, `${JSON.stringify(body)} with B's token answered ${stale.status}`);
    assert.deepEqual(stale.data, { error: CATEGORY_CHANGED, code: 'CATEGORY_CHANGED' });
  }
  const stored = await prisma.category.findUnique({ where: { id: target.id } });
  assert.deepEqual([stored.name, stored.isActive], ['Renamed by A', true]);
  // The current token toggles visibility, and the toggle moves the token too.
  const fresh = await open('category', target.id);
  const hidden = await save('category', target.id, { isActive: false, expectedUpdatedAt: fresh.updatedAt });
  assert.equal(hidden.status, 200, JSON.stringify(hidden.data));
  assert.equal(hidden.data.isActive, false);
  assert.equal((await save('category', target.id, { isActive: true, expectedUpdatedAt: fresh.updatedAt })).status, 409);
});

test('a missing or malformed token is a 400 that names the record, and nothing changes', async () => {
  const product = await createProduct('Tokenless shirt');
  const target = await createCategory('Tokenless category', category.id);
  const current = await open('product', product.id);
  for (const [kind, id, noun] of [['product', product.id, 'product'], ['category', target.id, 'category']]) {
    for (const token of [undefined, null, 12345, '', 'yesterday', '2026-13-01T00:00:00.000Z', '2026-02-30T10:00:00.000Z',
      current.updatedAt?.replace('Z', '+00:00'), current.updatedAt?.replace(/\.\d{3}Z$/, 'Z')]) {
      const response = await save(kind, id, { name: 'Must not be saved', ...(token !== undefined && { expectedUpdatedAt: token }) });
      assert.equal(response.status, 400, `${kind} with ${JSON.stringify(token)} answered ${response.status}`);
      assert.deepEqual(response.data, { error: `Reload this ${noun} and try again.`, code: 'VERSION_REQUIRED' });
    }
  }
  assert.equal((await prisma.product.findUnique({ where: { id: product.id } })).name, 'Tokenless shirt');
  assert.equal((await prisma.category.findUnique({ where: { id: target.id } })).name, 'Tokenless category');
});

test('a refused save writes nothing: no field, variant, stock, stock log, image or category change', async () => {
  const product = await createProduct('Untouched coat');
  const stale = await open('product', product.id);
  assert.equal((await save('product', product.id, { name: 'Untouched coat, current', expectedUpdatedAt: stale.updatedAt })).status, 200);
  const before = await productRows(product.id);
  const refused = await save('product', product.id, {
    name: 'Stale name', price: 2500, categoryId: otherCategory.id, isFeatured: true, isActive: false,
    variants: [
      { id: stale.variants[0].id, isActive: false, stock: { quantity: 7 } },
      { sku: `EDIT-${++sequence}-XL`, attributes: { size: 'XL' }, stock: { quantity: 9 } },
    ],
    images: [{ id: stale.images[0].id, alt: 'Stale alt text' }, { url: 'https://example.test/stale-extra.jpg' }],
    expectedUpdatedAt: stale.updatedAt,
  });
  assert.equal(refused.status, 409, JSON.stringify(refused.data));
  assert.deepEqual(await productRows(product.id), before);
});

test('staff records carry their token; shoppers\' records do not', async () => {
  const product = await createProduct('Token coverage tee');
  const created = await createCategory('Token coverage category', category.id);
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  assert.match(product.updatedAt, iso, 'the create response carries the token');
  assert.match(created.updatedAt, iso, 'the category create response carries the token');
  const staff = (await call('/admin/catalog')).data;
  assert.ok(staff.products.every((item) => iso.test(item.updatedAt)));
  assert.ok(staff.categories.every((item) => iso.test(item.updatedAt)));
  for (const response of [
    await call('/catalog', { token: null }), await call('/categories', { token: null }),
    await call(`/products/${product.id}`, { token: null }), await call('/products?limit=100', { token: null }),
  ]) {
    assert.equal(response.status, 200);
    assert.equal(JSON.stringify(response.data).includes('updatedAt'), false);
  }
});

test('new categories go after their last sibling, and a category moved to another parent goes after its new siblings', async () => {
  const parent = await createCategory('Append parent');
  const children = [];
  for (const name of ['First child', 'Second child', 'Third child']) children.push(await createCategory(name, parent.id));
  assert.deepEqual(children.map((item) => item.order), [0, 1, 2]);
  const roots = (await call('/admin/catalog')).data.categories.filter((item) => item.parentId === null);
  const root = await createCategory('Last department');
  assert.equal(root.order, Math.max(...roots.map((item) => item.order)) + 1);
  const moving = await createCategory('Moving child', otherCategory.id);
  assert.equal(moving.order, 0);
  const moved = await save('category', moving.id, { parentId: parent.id, expectedUpdatedAt: moving.updatedAt });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  assert.equal(moved.data.order, 3);
});

const reorder = (body, token = staffToken) => call('/categories/reorder', { method: 'POST', body, token });
const storedOrders = async (parentId) => (await prisma.category.findMany({ where: { parentId, deletedAt: null }, orderBy: { id: 'asc' } }))
  .map((item) => [item.id, item.order, item.updatedAt.toISOString()]);

test('a reorder writes each sibling\'s position, moves every token and is what shoppers see; only writers may reorder', async () => {
  const parent = await createCategory('Reorder parent');
  const children = [];
  for (const name of ['Alpha', 'Beta', 'Gamma']) children.push(await createCategory(name, parent.id));
  const [a, b, c] = children;
  const loaded = new Map((await call('/admin/catalog')).data.categories.map((item) => [item.id, item.updatedAt]));
  const viewer = await reorder({ parentId: parent.id, orderedIds: [c.id, a.id, b.id] }, viewerToken);
  assert.equal(viewer.status, 403);
  const moved = await reorder({ parentId: parent.id, orderedIds: [c.id, a.id, b.id] });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  assert.deepEqual(moved.data.categories.map((item) => [item.name, item.order, item.parentId]),
    [['Gamma', 0, parent.id], ['Alpha', 1, parent.id], ['Beta', 2, parent.id]]);
  for (const item of moved.data.categories) {
    assert.notEqual(item.updatedAt, loaded.get(item.id), `${item.name}: the token did not move`);
    assert.equal(item.updatedAt, (await prisma.category.findUnique({ where: { id: item.id } })).updatedAt.toISOString());
  }
  // An editor that opened Alpha before the move now holds a stale version.
  assert.equal((await save('category', a.id, { name: 'Stale rename', expectedUpdatedAt: loaded.get(a.id) })).status, 409);
  const shoppers = (await call('/catalog', { token: null })).data.categories.filter((item) => item.parentId === parent.id);
  assert.deepEqual(shoppers.map((item) => item.name), ['Gamma', 'Alpha', 'Beta']);

  // Departments (no parent) reorder the same way.
  const roots = (await call('/admin/catalog')).data.categories.filter((item) => item.parentId === null)
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
  const reversed = roots.map((item) => item.id).reverse();
  const departments = await reorder({ parentId: null, orderedIds: reversed });
  assert.equal(departments.status, 200, JSON.stringify(departments.data));
  assert.deepEqual(departments.data.categories.map((item) => item.id), reversed);
  assert.deepEqual((await storedOrders(null)).sort((left, right) => left[1] - right[1]).map(([id]) => id), reversed);
});

test('a reorder against a changed set of siblings is refused and writes nothing; malformed requests are 400', async () => {
  const parent = await createCategory('Changing parent');
  const a = await createCategory('Loaded first', parent.id);
  const b = await createCategory('Loaded second', parent.id);
  // Another editor adds a sibling between this editor loading the list and pressing Move.
  const added = await createCategory('Added meanwhile', parent.id);
  const before = await storedOrders(parent.id);
  for (const orderedIds of [
    [b.id, a.id],
    [b.id, a.id, added.id, added.id],
    // As many ids as siblings, but one repeated in place of another: the repeat must be caught, not only the count.
    [b.id, a.id, a.id],
    [b.id, a.id, added.id, otherCategory.id],
    [b.id, a.id, 'missing-category'],
  ]) {
    const refused = await reorder({ parentId: parent.id, orderedIds });
    assert.equal(refused.status, 409, `${JSON.stringify(orderedIds)} answered ${refused.status}`);
    assert.deepEqual(refused.data, { error: SIBLINGS_CHANGED, code: 'CATEGORY_SIBLINGS_CHANGED' });
  }
  assert.equal((await reorder({ parentId: 'missing-parent', orderedIds: [a.id] })).status, 409);
  assert.deepEqual(await storedOrders(parent.id), before);

  // A deleted sibling no longer counts.
  assert.equal((await call(`/categories/${added.id}`, { method: 'DELETE' })).status, 200);
  const accepted = await reorder({ parentId: parent.id, orderedIds: [b.id, a.id] });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  assert.deepEqual(accepted.data.categories.map((item) => [item.id, item.order]), [[b.id, 0], [a.id, 1]]);

  for (const body of [
    { orderedIds: [a.id] }, { parentId: parent.id }, { parentId: parent.id, orderedIds: [] },
    { parentId: parent.id, orderedIds: 'nope' }, { parentId: 7, orderedIds: [a.id] },
    { parentId: parent.id, orderedIds: [b.id, a.id], order: 1 },
  ]) {
    assert.equal((await reorder(body)).status, 400, JSON.stringify(body));
  }
});
