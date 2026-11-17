import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import prisma from '../../src/config/database.js';
import { startServer } from '../../src/server.js';
import { generateToken } from '../../src/config/auth.js';
import defaults from '../../src/data/storefront-defaults.json' with { type: 'json' };
import examples from '../storefront-claim-examples.json' with { type: 'json' };

/*
 * P8.3: every publication is kept as a revision with its publisher and time; staff see who published and can restore an
 * earlier version into the draft (never straight to shoppers). Section headings may not claim unmeasured rankings.
 */
const KEY = 'storefront-v2';
const CLAIM = (title) => `Section "${title}": headings can't claim a ranking or popularity the store doesn't measure, such as "best sellers", "top rated" or "trending". Use a heading such as "Featured" or "Staff picks".`;
const copy = (value) => JSON.parse(JSON.stringify(value));

let base, close, staff, tokens, category, product, sequence = 0;

before(async () => {
  const roles = { alice: 'ADMIN', bob: 'SUPER_ADMIN', viewer: 'VIEWER' };
  staff = Object.fromEntries(await Promise.all(Object.entries(roles).map(async ([name, role]) => [name, await prisma.admin.create({ data: {
    email: `history-${name}@example.test`, username: `history-${name}`, password: 'fixture-not-for-login', role,
  } })])));
  tokens = Object.fromEntries(Object.entries(staff).map(([name, admin]) => [name, generateToken({ adminId: admin.id })]));
  const started = await startServer({ host: '127.0.0.1', port: 0 });
  close = started.close;
  base = `http://127.0.0.1:${started.server.address().port}/api`;
  category = await created('/categories', { name: 'History department' });
  product = await createProduct('History linen shirt');
});
after(async () => { await close?.(); });

async function call(path, { method = 'GET', body, token = tokens.alice } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

async function created(path, body) {
  const response = await call(path, { method: 'POST', body });
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data;
}

function createProduct(name) {
  const tag = `HIST-${++sequence}`;
  return created('/products', {
    name, description: `${name}, for the publication history checks`, price: 1500, categoryId: category.id, isActive: true,
    variants: [{ sku: `${tag}-M`, attributes: { size: 'M' }, stock: { quantity: 4 } }],
  });
}

/** A valid storefront document: the defaults, renamed, plus a product section when `productId` is given. */
function documentNamed(name, productId = null) {
  const settings = copy(defaults);
  settings.brand.name = name;
  if (productId) settings.sections.push({ id: 'picks', type: 'products', title: 'Staff picks', enabled: true, productIds: [productId], categoryIds: [], campaignId: null });
  return settings;
}

const draftNow = async () => (await call('/settings/storefront/draft')).data;
async function saveDraft(settings, token = tokens.alice) {
  const { version } = await draftNow();
  const response = await call('/settings/storefront/draft', { method: 'PUT', body: { version, settings }, token });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data;
}
async function publishNow(token = tokens.alice) {
  const { version } = await draftNow();
  const response = await call('/settings/storefront/publish', { method: 'POST', body: { version }, token });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data;
}
const restore = (version, draftVersion, token = tokens.alice) =>
  call(`/settings/storefront/revisions/${version}/restore`, { method: 'POST', body: { version: draftVersion }, token });

const storefrontRow = () => prisma.siteSetting.findUnique({ where: { key: KEY } });
const storefrontEntries = (action) => prisma.activityLog.findMany({ where: { action }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
/** Everything a refused publish or restore must leave as it was. */
const written = async () => ({
  setting: await storefrontRow(),
  revisions: await prisma.storefrontRevision.findMany({ orderBy: { version: 'asc' } }),
  activity: await prisma.activityLog.count(),
});

test('publishing records one revision with its publisher and time and one activity entry; only staff see the publisher', async () => {
  const initial = await draftNow();
  assert.equal(initial.publishedVersion, 1);
  // The live version the migration found has no recorded publisher.
  assert.equal(initial.publishedBy, null);

  await saveDraft(documentNamed('History store A'));
  const before = await written();
  const response = await call('/settings/storefront/publish', { method: 'POST', body: { version: (await draftNow()).version } });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  const after = await written();
  const revision = after.revisions.at(-1);
  assert.equal(after.revisions.length, before.revisions.length + 1);
  assert.deepEqual(
    { version: revision.version, publishedById: revision.publishedById, publishedAt: revision.publishedAt, value: revision.value },
    { version: after.setting.publishedVersion, publishedById: staff.alice.id, publishedAt: after.setting.publishedAt, value: after.setting.publishedValue },
  );
  assert.equal(revision.value.brand.name, 'History store A');
  assert.equal(after.activity, before.activity + 1);
  const [entry] = await storefrontEntries('STOREFRONT_PUBLISHED');
  assert.deepEqual(
    { adminId: entry.adminId, targetType: entry.targetType, targetId: entry.targetId, details: entry.details },
    { adminId: staff.alice.id, targetType: 'storefront', targetId: String(revision.version), details: `version ${revision.version}` },
  );

  // Staff see who published; shoppers and the publish answer never carry staff identity.
  assert.equal((await call('/settings/storefront/draft', { token: tokens.viewer })).data.publishedBy, 'history-alice');
  const shopper = await call('/settings/storefront', { token: null });
  for (const [label, body] of [['publish response', response.data], ['public storefront', shopper.data]]) {
    const text = JSON.stringify(body);
    for (const identity of ['publishedBy', 'history-alice', staff.alice.email, staff.alice.id]) {
      assert.equal(text.includes(identity), false, `${label} carries ${identity}`);
    }
  }

  // The next publication names its own publisher.
  await saveDraft(documentNamed('History store B'), tokens.bob);
  await publishNow(tokens.bob);
  assert.equal((await draftNow()).publishedBy, 'history-bob');
});

test('a refused publish writes no revision and no activity entry', async () => {
  await saveDraft(documentNamed('History store C', product.id));
  const { version } = await draftNow();
  const before = await written();

  const stale = await call('/settings/storefront/publish', { method: 'POST', body: { version: version - 1 } });
  assert.deepEqual(stale, { status: 409, data: { error: 'The storefront changed. Reload before publishing.', code: 'STOREFRONT_CHANGED' } });
  assert.equal((await call('/settings/storefront/publish', { method: 'POST', body: { version }, token: tokens.viewer })).status, 403);
  // A hidden product can stay in a draft but cannot be published.
  await prisma.product.update({ where: { id: product.id }, data: { isActive: false } });
  try {
    const hidden = await call('/settings/storefront/publish', { method: 'POST', body: { version } });
    assert.equal(hidden.status, 400, JSON.stringify(hidden.data));
  } finally {
    await prisma.product.update({ where: { id: product.id }, data: { isActive: true } });
  }
  assert.deepEqual(await written(), before);

  const staleSave = await call('/settings/storefront/draft', { method: 'PUT', body: { version: version - 1, settings: documentNamed('Stale') } });
  assert.deepEqual(staleSave, { status: 409, data: { error: 'The storefront changed. Reload before saving your draft.', code: 'STOREFRONT_CHANGED' } });
  assert.deepEqual(await written(), before);
});

test('the history lists publications newest first, 20 a page, marks the live one and never returns documents', async () => {
  // The migration's revision and the two publications above, then twenty more with alternating publishers.
  assert.equal(await prisma.storefrontRevision.count(), 3);
  for (let index = 0; index < 20; index += 1) await publishNow(index % 2 ? tokens.bob : tokens.alice);
  const setting = await storefrontRow();
  const stored = await prisma.storefrontRevision.findMany({ orderBy: { version: 'desc' }, include: { publishedBy: true } });
  assert.equal(stored.length, 23);
  const expected = stored.map((row) => ({
    version: row.version, publishedAt: row.publishedAt.toISOString(), publishedBy: row.publishedBy?.username ?? null,
    live: row.version === setting.publishedVersion,
  }));

  const first = await call('/settings/storefront/revisions');
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.deepEqual(first.data, { revisions: expected.slice(0, 20), pagination: { page: 1, limit: 20, pages: 2, total: 23 } });
  const second = await call('/settings/storefront/revisions?page=2', { token: tokens.viewer });
  assert.deepEqual(second.data, { revisions: expected.slice(20), pagination: { page: 2, limit: 20, pages: 2, total: 23 } });
  // The oldest is the version live when the history began: nobody recorded its publisher.
  assert.deepEqual(second.data.revisions.at(-1), { ...expected.at(-1), version: 1, publishedBy: null, live: false });
  assert.deepEqual([...first.data.revisions, ...second.data.revisions].filter((item) => item.live).map((item) => item.version), [setting.publishedVersion]);
  assert.equal(JSON.stringify([first.data, second.data]).includes('History store'), false, 'a listed revision carried its document');

  const past = await call('/settings/storefront/revisions?page=9');
  assert.deepEqual(past, { status: 200, data: { revisions: [], pagination: { page: 9, limit: 20, pages: 2, total: 23 } } });

  // Saving the draft moves its version past the published one; "Live" still marks the published version, not the draft's.
  await saveDraft(documentNamed('History store, edited after publishing'));
  const afterSave = await call('/settings/storefront/revisions');
  assert.ok((await storefrontRow()).version > setting.publishedVersion);
  assert.deepEqual(afterSave.data.revisions.filter((item) => item.live).map((item) => item.version), [setting.publishedVersion]);

  for (const query of ['page=0', 'page=-1', 'page=abc', 'page=1.5', 'page=01', 'page=', 'page=10001', 'page=1&page=2', 'page[x]=1', 'limit=50', 'page=1&live=true']) {
    const response = await call(`/settings/storefront/revisions?${query}`);
    assert.equal(response.status, 400, `${query}: ${JSON.stringify(response.data)}`);
  }
  assert.equal((await call('/settings/storefront/revisions', { token: null })).status, 401);
});

/** Counts and sample rows of everything outside the draft that a restore must never touch, and what shoppers see. */
async function outsideTheDraft(ids) {
  return {
    counts: Object.fromEntries(await Promise.all(['product', 'productVariant', 'category', 'productImage', 'stock', 'stockLog',
      'order', 'mpesaPayment', 'refund', 'user', 'discount', 'designer'].map(async (model) => [model, await prisma[model].count()]))),
    product: await prisma.product.findUnique({ where: { id: ids.product }, include: { variants: { include: { stock: true } }, images: true } }),
    hidden: await prisma.product.findUnique({ where: { id: ids.hidden } }),
    category: await prisma.category.findUnique({ where: { id: ids.category } }),
    discount: await prisma.discount.findUnique({ where: { id: ids.discount } }),
    shopper: (await call('/settings/storefront', { token: null })).data,
  };
}

test('restoring copies an earlier publication into the draft only; shoppers keep the live version until the next publish', async () => {
  const jacket = await createProduct('History restore jacket');
  await saveDraft(documentNamed('History restore source', jacket.id));
  const source = await publishNow(tokens.bob);
  await saveDraft(documentNamed('History live store'));
  await publishNow();
  await saveDraft(documentNamed('History unpublished draft'));
  // A hidden (not deleted) product may return to a draft: only publishing needs it visible.
  await prisma.product.update({ where: { id: jacket.id }, data: { isActive: false } });
  const discount = await prisma.discount.create({ data: { name: 'History sample offer', value: 10, startDate: new Date('2026-11-01T00:00:00Z') } });
  const ids = { product: product.id, hidden: jacket.id, category: category.id, discount: discount.id };
  const before = await outsideTheDraft(ids);
  const held = await draftNow();
  const live = await storefrontRow();
  const revisions = await prisma.storefrontRevision.count();

  const response = await restore(source.version, held.version);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  const revision = await prisma.storefrontRevision.findUnique({ where: { settingKey_version: { settingKey: KEY, version: source.version } } });
  // The staff draft answer: the restored document as a new draft version; the publication fields are unchanged.
  assert.deepEqual(response.data, {
    version: held.version + 1, publishedVersion: held.publishedVersion, publishedAt: held.publishedAt, publishedBy: 'history-alice',
    settings: revision.value, media: [], unavailableMediaIds: [],
  });
  assert.equal(response.data.settings.brand.name, 'History restore source');
  assert.deepEqual(await draftNow(), response.data);
  const row = await storefrontRow();
  assert.deepEqual(
    { value: row.value, version: row.version, publishedValue: row.publishedValue, publishedVersion: row.publishedVersion, publishedAt: row.publishedAt },
    { value: revision.value, version: held.version + 1, publishedValue: live.publishedValue, publishedVersion: live.publishedVersion, publishedAt: live.publishedAt },
  );
  assert.deepEqual(await outsideTheDraft(ids), before);
  assert.equal(await prisma.storefrontRevision.count(), revisions);
  const entries = await storefrontEntries('STOREFRONT_RESTORED');
  assert.deepEqual(entries.map(({ adminId, targetType, targetId, details }) => ({ adminId, targetType, targetId, details })), [
    { adminId: staff.alice.id, targetType: 'storefront', targetId: String(source.version), details: `version ${source.version}` },
  ]);

  // Shoppers see the restored version only once it is published (with its product visible again).
  await prisma.product.update({ where: { id: jacket.id }, data: { isActive: true } });
  assert.equal(before.shopper.settings.brand.name, 'History live store');
  await publishNow();
  assert.equal((await call('/settings/storefront', { token: null })).data.settings.brand.name, 'History restore source');
});

test('every refused restore changes nothing and records nothing', async () => {
  const removed = await createProduct('History removed scarf');
  const seeded = async (version, mutate) => {
    const value = documentNamed(`History seeded ${version}`, removed.id);
    mutate?.(value);
    await prisma.storefrontRevision.create({ data: { settingKey: KEY, version, value, publishedAt: new Date('2026-11-15T07:40:00Z') } });
  };
  await seeded(900001, (value) => { value.brand.logo = 'retired-field'; });
  await seeded(900002, (value) => { value.sections[0].title = 'Best sellers'; });
  await seeded(900003);
  await seeded(900004, (value) => { value.sections[2].title = 'Customers’ picks'; });
  assert.equal((await call(`/products/${removed.id}`, { method: 'DELETE' })).status, 200);
  const { version: held } = await draftNow();
  const before = await written();
  const refusals = [
    [restore(900003, held - 1), 409, { error: 'The storefront changed. Reload before restoring.', code: 'STOREFRONT_CHANGED' }],
    // A stale editor is told to reload before anything about the version it asked for.
    [restore(424242, held - 1), 409, { error: 'The storefront changed. Reload before restoring.', code: 'STOREFRONT_CHANGED' }],
    [restore(424242, held), 404, { error: "That version isn't in the publication history.", code: 'REVISION_NOT_FOUND' }],
    [restore(900001, held), 409, { error: "Version 900001 can't be restored: it no longer matches the storefront's rules.", code: 'REVISION_INVALID' }],
    [restore(900002, held), 409, { error: `Version 900002 can't be restored: ${CLAIM('Best sellers')}`, code: 'REVISION_INVALID' }],
    [restore(900003, held), 409, { error: "Version 900003 can't be restored: a product, category or image it uses has been deleted.", code: 'REVISION_UNAVAILABLE' }],
    // A version that breaks the rules and uses a deleted product is refused for the rules first.
    [restore(900004, held), 409, { error: `Version 900004 can't be restored: ${CLAIM('Customers’ picks')}`, code: 'REVISION_INVALID' }],
    [restore(900003, held, tokens.viewer), 403, { error: 'Not authorized' }],
    [restore(900003, held, null), 401, { error: 'No token provided' }],
  ];
  for (const [pending, status, body] of refusals) assert.deepEqual(await pending, { status, data: body });
  for (const version of ['abc', '0', '-3', '1.5', '01', '2147483648', '1e3']) {
    assert.equal((await restore(version, held)).status, 400, version);
  }
  for (const body of [{}, { version: String(held) }, { version: held, revision: 900003 }, { version: 0 }, { version: held + 0.5 }]) {
    const response = await call('/settings/storefront/revisions/900003/restore', { method: 'POST', body });
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.deepEqual(await written(), before);
});

test('a restore racing a draft save with the same draft version: exactly one is kept, the other is refused as stale', async () => {
  // The version live when the history began: valid, and it uses no product a test removes.
  const target = 1;
  const restoredValue = (await prisma.storefrontRevision.findUnique({ where: { settingKey_version: { settingKey: KEY, version: target } } })).value;
  const outcomes = [];
  for (let round = 0; round < 6; round += 1) {
    const { version } = await draftNow();
    const saved = documentNamed(`History racing save ${round}`);
    const entries = (await storefrontEntries('STOREFRONT_RESTORED')).length;
    const [restored, save] = await Promise.all([
      restore(target, version),
      call('/settings/storefront/draft', { method: 'PUT', body: { version, settings: saved } }),
    ]);
    assert.deepEqual([restored.status, save.status].sort(), [200, 409], `round ${round}: ${JSON.stringify([restored.data, save.data])}`);
    const [winner, loser] = restored.status === 200 ? ['restore', save] : ['save', restored];
    assert.ok(['STOREFRONT_CHANGED', 'CATALOG_CHANGED'].includes(loser.data.code), `round ${round}: ${JSON.stringify(loser.data)}`);
    const row = await storefrontRow();
    assert.equal(row.version, version + 1, `round ${round}`);
    assert.deepEqual(row.value, winner === 'restore' ? restoredValue : saved, `round ${round}`);
    assert.equal((await storefrontEntries('STOREFRONT_RESTORED')).length, entries + (winner === 'restore' ? 1 : 0), `round ${round}`);
    outcomes.push(`${winner} won, ${loser.data.code}`);
  }
  console.log(`race outcomes: ${outcomes.join('; ')}`);
});

test('saving refuses a heading that claims an unmeasured ranking, at its path, and accepts the shared allowed headings', async () => {
  const before = await written();
  for (const title of examples.refused) {
    const settings = documentNamed('History claims');
    settings.sections[1].title = title;
    const response = await call('/settings/storefront/draft', { method: 'PUT', body: { version: before.setting.version, settings } });
    assert.equal(response.status, 400, title);
    assert.deepEqual(response.data.details, [{ path: 'sections.1.title', message: CLAIM(title) }], title);
  }
  assert.deepEqual(await written(), before);
  for (const title of examples.allowed) {
    const settings = documentNamed('History claims');
    settings.sections[1].title = title;
    assert.equal((await saveDraft(settings)).settings.sections[1].title, title);
  }
});

test('a draft stored before the rule still loads for repair, but publishing it is refused and writes nothing', async () => {
  const stored = documentNamed('History stored claim');
  stored.sections[0].title = 'Customer favourites';
  await prisma.siteSetting.update({ where: { key: KEY }, data: { value: stored } });
  const draft = await call('/settings/storefront/draft', { token: tokens.viewer });
  assert.equal(draft.status, 200, JSON.stringify(draft.data));
  assert.equal(draft.data.settings.sections[0].title, 'Customer favourites');

  const before = await written();
  const refused = await call('/settings/storefront/publish', { method: 'POST', body: { version: draft.data.version } });
  assert.equal(refused.status, 400, JSON.stringify(refused.data));
  assert.deepEqual(refused.data.details, [{ path: 'sections.0.title', message: CLAIM('Customer favourites') }]);
  assert.deepEqual(await written(), before);
});

test('shoppers still get a published document stored with a claim heading before the rule', async () => {
  const live = await storefrontRow();
  const published = copy(live.publishedValue);
  published.sections[0].title = 'Trending';
  await prisma.siteSetting.update({ where: { key: KEY }, data: { publishedValue: published } });
  const shopper = await call('/settings/storefront', { token: null });
  assert.equal(shopper.status, 200, JSON.stringify(shopper.data));
  assert.equal(shopper.data.settings.sections[0].title, 'Trending');
});
