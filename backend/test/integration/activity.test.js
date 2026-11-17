import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import prisma from '../../src/config/database.js';
import { startServer } from '../../src/server.js';
import { generateToken } from '../../src/config/auth.js';
import { activityRecorder } from '../../src/services/activityService.js';

/*
 * P8.3 staff activity: each successful staff change without a history of its own records one entry (who, what, which
 * record, a display name or count); refused writes record nothing; the list is for SUPER_ADMIN and ADMIN only.
 */
const PASSWORD = 'activity-fixture-password';
const USER_AGENT = 'ActivityFixtureBrowser/1.0';

let base, close, admin, chief, viewer, tokens, sequence = 0;

before(async () => {
  const hash = await bcrypt.hash(PASSWORD, 4);
  [admin, chief, viewer] = await Promise.all([['alice', 'ADMIN'], ['chief', 'SUPER_ADMIN'], ['viewer', 'VIEWER']].map(([name, role]) =>
    prisma.admin.create({ data: { email: `activity-${name}@example.test`, username: `activity-${name}`, password: hash, role } })));
  tokens = { admin: generateToken({ adminId: admin.id }), chief: generateToken({ adminId: chief.id }), viewer: generateToken({ adminId: viewer.id }) };
  const started = await startServer({ host: '127.0.0.1', port: 0 });
  close = started.close;
  base = `http://127.0.0.1:${started.server.address().port}/api`;
});
after(async () => { await close?.(); });

async function call(path, { method = 'GET', body, token = tokens.admin, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

/** Runs one staff request; returns its answer and the activity entries it wrote, oldest first. */
async function recorded(request) {
  const seen = new Set((await prisma.activityLog.findMany({ select: { id: true } })).map((row) => row.id));
  const response = await request();
  const entries = (await prisma.activityLog.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }))
    .filter((row) => !seen.has(row.id))
    .map(({ adminId, action, targetType, targetId, details }) => ({ adminId, action, targetType, targetId, details }));
  return { response, entries };
}

/**
 * Expects `request` to answer `status` and to record exactly one entry: `entry`, or `entry(body)` when it names the
 * record the answer created. The actor is alice unless `adminId` is given.
 */
async function expectEntry(request, status, entry) {
  const { response, entries } = await recorded(request);
  assert.equal(response.status, status, JSON.stringify(response.data));
  const expected = typeof entry === 'function' ? entry(response.data) : entry;
  assert.deepEqual(entries, [{ adminId: admin.id, targetType: null, targetId: null, details: '', ...expected }]);
  return response.data;
}

const version = async (model, id) => ({ expectedUpdatedAt: (await prisma[model].findUnique({ where: { id } })).updatedAt.toISOString() });
const productBody = (name, categoryId) => {
  const tag = `ACT-${++sequence}`;
  return {
    name, description: `${name}, for the staff activity checks`, price: 2500, categoryId, isActive: true,
    variants: [{ sku: `${tag}-M`, attributes: { size: 'M' }, stock: { quantity: 2 } }],
  };
};

test('catalog and discount changes each record one entry with the staff member, the record and its display name', async () => {
  const department = await expectEntry(() => call('/categories', { method: 'POST', body: { name: 'Activity Linen' } }), 201,
    (body) => ({ action: 'CATEGORY_CREATED', targetType: 'category', targetId: body.id, details: 'Activity Linen' }));
  const shirts = (await call('/categories', { method: 'POST', body: { name: 'Shirts', parentId: department.id } })).data;
  const trousers = (await call('/categories', { method: 'POST', body: { name: 'Trousers', parentId: department.id } })).data;
  await expectEntry(async () => call(`/categories/${department.id}`, { method: 'PUT', body: { name: 'Activity Linen Wear', ...await version('category', department.id) } }), 200,
    { action: 'CATEGORY_UPDATED', targetType: 'category', targetId: department.id, details: 'Activity Linen Wear' });
  await expectEntry(() => call('/categories/reorder', { method: 'POST', body: { parentId: department.id, orderedIds: [trousers.id, shirts.id] } }), 200,
    { action: 'CATEGORIES_REORDERED', targetType: 'category', targetId: department.id, details: 'Activity Linen Wear' });
  const roots = await prisma.category.findMany({ where: { parentId: null, deletedAt: null }, orderBy: { order: 'desc' } });
  await expectEntry(() => call('/categories/reorder', { method: 'POST', body: { parentId: null, orderedIds: roots.map((item) => item.id) } }), 200,
    { action: 'CATEGORIES_REORDERED', targetType: 'category', targetId: null, details: 'departments' });
  await expectEntry(() => call(`/categories/${trousers.id}`, { method: 'DELETE' }), 200,
    { action: 'CATEGORY_DELETED', targetType: 'category', targetId: trousers.id, details: 'Trousers' });

  const shirt = await expectEntry(() => call('/products', { method: 'POST', body: productBody('Linen Shirt', shirts.id), token: tokens.chief }), 201,
    (body) => ({ adminId: chief.id, action: 'PRODUCT_CREATED', targetType: 'product', targetId: body.id, details: 'Linen Shirt' }));
  // An update records the product's new name.
  await expectEntry(async () => call(`/products/${shirt.id}`, { method: 'PUT', body: { name: 'Linen Shirt, short sleeve', ...await version('product', shirt.id) } }), 200,
    { action: 'PRODUCT_UPDATED', targetType: 'product', targetId: shirt.id, details: 'Linen Shirt, short sleeve' });
  await expectEntry(() => call(`/products/${shirt.id}`, { method: 'DELETE' }), 200,
    { action: 'PRODUCT_DELETED', targetType: 'product', targetId: shirt.id, details: 'Linen Shirt, short sleeve' });

  const designer = await expectEntry(() => call('/designers', { method: 'POST', body: { designerId: 'activity-amina', fullName: 'Amina Weaver', specialty: 'Handwoven linen' } }), 201,
    (body) => ({ action: 'DESIGNER_CREATED', targetType: 'designer', targetId: body.id, details: 'Amina Weaver' }));
  await expectEntry(() => call(`/designers/${designer.id}`, { method: 'PUT', body: { fullName: 'Amina Weaver Studio' } }), 200,
    { action: 'DESIGNER_UPDATED', targetType: 'designer', targetId: designer.id, details: 'Amina Weaver Studio' });
  await expectEntry(() => call(`/designers/${designer.id}`, { method: 'DELETE' }), 200,
    { action: 'DESIGNER_DELETED', targetType: 'designer', targetId: designer.id, details: 'Amina Weaver Studio' });

  const offer = { name: 'Linen week', type: 'PERCENTAGE', value: 10, applyTo: 'ALL', targetIds: [], startDate: '2026-11-01T00:00:00.000Z' };
  const discount = await expectEntry(() => call('/admin/discounts', { method: 'POST', body: offer }), 201,
    (body) => ({ action: 'DISCOUNT_CREATED', targetType: 'discount', targetId: body.id, details: 'Linen week' }));
  await expectEntry(() => call(`/admin/discounts/${discount.id}`, { method: 'PUT', body: { ...offer, name: 'Linen fortnight' } }), 200,
    { action: 'DISCOUNT_UPDATED', targetType: 'discount', targetId: discount.id, details: 'Linen fortnight' });
  // Removing a live discount deletes it; removing a demo discount only stops it.
  await expectEntry(() => call(`/admin/discounts/${discount.id}`, { method: 'DELETE' }), 200,
    { action: 'DISCOUNT_DELETED', targetType: 'discount', targetId: discount.id, details: 'Linen fortnight' });
  assert.equal(await prisma.discount.findUnique({ where: { id: discount.id } }), null);
  const demo = await prisma.discount.create({ data: { name: 'Demo opening offer', value: 5, startDate: new Date('2026-10-01T00:00:00Z'), isDemo: true } });
  await expectEntry(() => call(`/admin/discounts/${demo.id}`, { method: 'DELETE' }), 200,
    { action: 'DISCOUNT_STOPPED', targetType: 'discount', targetId: demo.id, details: 'Demo opening offer' });
  assert.equal((await prisma.discount.findUnique({ where: { id: demo.id } })).isActive, false);
});

let customerCount = 0;
const customer = (overrides = {}) => {
  customerCount += 1;
  return prisma.user.create({ data: {
    email: `activity.customer.${customerCount}@example.test`, password: 'not-used-for-login', firstName: 'Wanjiku',
    lastName: `Kamau ${customerCount}`, phone: `07120000${String(customerCount).padStart(2, '0')}`, ...overrides,
  } });
};

test('customer and subscriber changes record the account only, never contact details', async () => {
  const [kept, removed] = [await customer(), await customer()];
  const subscriber = await prisma.subscription.create({ data: { email: 'activity.reader@example.test' } });
  const entries = [];
  const track = async (...args) => { const { response, entries: written } = await recorded(args[0]); assert.equal(response.status, args[1], JSON.stringify(response.data)); entries.push(...written); return written; };

  assert.deepEqual(await track(() => call(`/admin/users/${kept.id}/disabled`, { method: 'PUT', body: { disabled: true } }), 200), [
    { adminId: admin.id, action: 'CUSTOMER_DISABLED', targetType: 'customer', targetId: kept.id, details: '' },
  ]);
  assert.deepEqual(await track(() => call(`/admin/users/${kept.id}/disabled`, { method: 'PUT', body: { disabled: false }, token: tokens.chief }), 200), [
    { adminId: chief.id, action: 'CUSTOMER_ENABLED', targetType: 'customer', targetId: kept.id, details: '' },
  ]);
  assert.deepEqual(await track(() => call(`/admin/users/${removed.id}`, { method: 'DELETE' }), 200), [
    { adminId: admin.id, action: 'CUSTOMER_DELETED', targetType: 'customer', targetId: removed.id, details: '' },
  ]);
  assert.equal(await prisma.user.findUnique({ where: { id: removed.id } }), null);
  assert.deepEqual(await track(() => call(`/subscriptions/admin/${subscriber.id}`, { method: 'DELETE' }), 200), [
    { adminId: admin.id, action: 'SUBSCRIBER_REMOVED', targetType: 'subscriber', targetId: subscriber.id, details: '' },
  ]);
  const text = JSON.stringify(entries);
  for (const value of [kept.email, kept.phone, kept.firstName, kept.lastName, removed.email, removed.phone, subscriber.email]) {
    assert.equal(text.includes(value), false, `an entry holds ${value}`);
  }
});

test('refused or failed writes record nothing', async () => {
  const department = (await call('/categories', { method: 'POST', body: { name: 'Activity Refusals' } })).data;
  const child = (await call('/categories', { method: 'POST', body: { name: 'Refusal child', parentId: department.id } })).data;
  const product = (await call('/products', { method: 'POST', body: productBody('Refusal tee', child.id) })).data;
  const stale = (await prisma.product.findUnique({ where: { id: product.id } })).updatedAt.toISOString();
  await call(`/products/${product.id}`, { method: 'PUT', body: { name: 'Refusal tee, renamed', expectedUpdatedAt: stale } });
  const disabled = await customer({ isDisabled: true });
  // A customer with an order is refused deletion from inside the transaction, which therefore commits: nothing may be in it.
  const buyer = await customer();
  await prisma.order.create({ data: {
    orderNumber: 'APX-ACTIVITY-REFUSAL', user: { connect: { id: buyer.id } }, subtotal: 1000, tax: 160, shippingCost: 0, total: 1160,
    paymentMethod: 'MPESA', address: { create: { user: { connect: { id: buyer.id } }, street: 'Moi Avenue', city: 'Mombasa', county: 'Mombasa' } },
  } });
  const refusals = [
    ['invalid product', 400, () => call('/products', { method: 'POST', body: { name: 'x' } })],
    ['viewer product', 403, () => call('/products', { method: 'POST', body: productBody('Viewer tee', child.id), token: tokens.viewer })],
    ['stale product update', 409, () => call(`/products/${product.id}`, { method: 'PUT', body: { name: 'Stale rename', expectedUpdatedAt: stale } })],
    ['category with children', 409, () => call(`/categories/${department.id}`, { method: 'DELETE' })],
    ['reorder with a missing child', 409, () => call('/categories/reorder', { method: 'POST', body: { parentId: department.id, orderedIds: ['category-not-here'] } })],
    ['unknown designer', 404, () => call('/designers/designer-not-here', { method: 'DELETE' })],
    ['unknown discount', 404, () => call('/admin/discounts/discount-not-here', { method: 'DELETE' })],
    ['viewer discount', 403, () => call('/admin/discounts', { method: 'POST', token: tokens.viewer, body: { name: 'Viewer offer', type: 'PERCENTAGE', value: 5, applyTo: 'ALL', startDate: '2026-11-01T00:00:00.000Z' } })],
    ['unknown customer disabled', 404, () => call('/admin/users/user-not-here/disabled', { method: 'PUT', body: { disabled: true } })],
    ['unknown customer deleted', 404, () => call('/admin/users/user-not-here', { method: 'DELETE' })],
    ['customer with orders', 400, () => call(`/admin/users/${buyer.id}`, { method: 'DELETE' })],
    ['verification for a disabled account', 400, () => call(`/admin/users/${disabled.id}/verify`, { method: 'POST', body: {} })],
    ['unknown subscriber', 404, () => call('/subscriptions/admin/subscription-not-here', { method: 'DELETE' })],
    ['promotion without a subject', 400, () => call('/subscriptions/admin/send-promotional', { method: 'POST', body: { content: '<p>Hi</p>' } })],
    ['failed sign-in', 401, () => call('/admin/login', { method: 'POST', token: null, body: { email: admin.email, password: 'not-the-password' } })],
  ];
  for (const [label, status, request] of refusals) {
    const { response, entries } = await recorded(request);
    assert.equal(response.status, status, `${label}: ${JSON.stringify(response.data)}`);
    assert.deepEqual(entries, [], label);
  }
  assert.ok(await prisma.user.findUnique({ where: { id: buyer.id } }), 'the customer with an order was deleted');
});

const MAIL_ENV = {
  EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.example.test', SMTP_PORT: '2525', SMTP_USER: 'mailer@example.test',
  SMTP_PASS: 'smtp-fixture-not-a-secret', SMTP_FROM: 'Apex Cart <mailer@example.test>',
};

/** Configures mail for one test; the SMTP transport delivers to every address except those in `failing`. */
function useMail(t, failing = []) {
  const saved = Object.fromEntries(Object.keys(MAIL_ENV).map((key) => [key, process.env[key]]));
  Object.assign(process.env, MAIL_ENV);
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const delivered = [];
  t.mock.method(nodemailer, 'createTransport', () => ({
    sendMail: async (message) => {
      if (failing.includes(message.to)) throw Object.assign(new Error('Mailbox unavailable'), { code: 'EENVELOPE', responseCode: 550 });
      delivered.push(message.to);
      return { messageId: `<${delivered.length}@example.test>` };
    },
  }));
  return delivered;
}

test('verification emails are recorded once sent, counting only the emails that went out', async (t) => {
  const [first, second, unreachable] = [await customer(), await customer(), await customer()];
  const delivered = useMail(t, [unreachable.email]);
  const entry = (count, targetId = null) => ({ action: 'CUSTOMER_VERIFICATION_SENT', targetType: 'customer', targetId, details: count });

  assert.equal((await expectEntry(() => call(`/admin/users/${first.id}/verify`, { method: 'POST', body: {} }), 200, entry('1 customer', first.id))).sent, true);
  const failed = await recorded(() => call(`/admin/users/${unreachable.id}/verify`, { method: 'POST', body: {} }));
  assert.deepEqual([failed.response.status, failed.response.data.sent, failed.entries], [200, false, []]);
  // A partly failed batch counts what was sent; a batch that sent one names its customer; one that sent none records nothing.
  const batch = await expectEntry(() => call('/admin/users/verify', { method: 'POST', body: { ids: [first.id, second.id, unreachable.id] } }), 200, entry('2 customers'));
  assert.deepEqual(batch.results.map((result) => result.sent).sort(), [false, true, true]);
  await expectEntry(() => call('/admin/users/verify', { method: 'POST', body: { ids: [unreachable.id, second.id] } }), 200, entry('1 customer', second.id));
  const none = await recorded(() => call('/admin/users/verify', { method: 'POST', body: { ids: [unreachable.id] } }));
  assert.deepEqual([none.response.status, none.entries], [200, []]);
  assert.equal(delivered.length, 4);
});

test('promotional sends are recorded with the number sent, never the subject', async (t) => {
  const readers = await Promise.all(['one', 'two', 'three'].map((name) => prisma.subscription.create({ data: { email: `promo.${name}@example.test` } })));
  await prisma.subscription.create({ data: { email: 'promo.lapsed@example.test', isActive: false } });
  const delivered = useMail(t, [readers[2].email]);
  const subject = 'Weekend offer for Wanjiku Kamau, 0712 000 001';
  const send = () => call('/subscriptions/admin/send-promotional', { method: 'POST', body: { subject, content: '<p>Linen week</p>' } });

  const answer = await expectEntry(send, 200, { action: 'PROMOTION_SENT', targetType: 'promotion', details: '2 subscribers' });
  assert.deepEqual([answer.successful, answer.failed], [2, 1]);
  assert.equal(JSON.stringify(await prisma.activityLog.findMany({ where: { action: 'PROMOTION_SENT' } })).includes('Wanjiku'), false);
  assert.equal(delivered.length, 2);
  await prisma.subscription.update({ where: { id: readers[1].id }, data: { isActive: false } });
  await expectEntry(send, 200, { action: 'PROMOTION_SENT', targetType: 'promotion', details: '1 subscriber' });
  await prisma.subscription.update({ where: { id: readers[0].id }, data: { isActive: false } });
  const none = await recorded(send);
  assert.deepEqual([none.response.status, none.response.data.successful, none.entries], [200, 0, []]);
});

test('a recording that fails after emails were sent is logged without personal data and the send result still stands', async (t) => {
  const reader = await customer();
  await prisma.subscription.updateMany({ data: { isActive: false } });
  await prisma.subscription.create({ data: { email: 'promo.after-failure@example.test' } });
  const delivered = useMail(t);
  t.mock.method(activityRecorder, 'record', async () => { throw Object.assign(new Error(`could not record for ${reader.email}`), { code: 'P1001' }); });
  const logged = t.mock.method(console, 'error', () => {});
  const subject = 'Private offer for Wanjiku';

  const verification = await recorded(() => call(`/admin/users/${reader.id}/verify`, { method: 'POST', body: {} }));
  assert.deepEqual([verification.response.status, verification.response.data.sent, verification.entries], [200, true, []]);
  const promotion = await recorded(() => call('/subscriptions/admin/send-promotional', { method: 'POST', body: { subject, content: '<p>Hi</p>' } }));
  assert.deepEqual([promotion.response.status, promotion.response.data.successful, promotion.response.data.failed, promotion.entries], [200, 1, 0, []]);
  assert.deepEqual(delivered, [reader.email, 'promo.after-failure@example.test']);
  assert.equal(activityRecorder.record.mock.callCount(), 2);
  const text = JSON.stringify(logged.mock.calls.map((call) => call.arguments));
  for (const action of ['CUSTOMER_VERIFICATION_SENT', 'PROMOTION_SENT']) assert.ok(text.includes(action), `${action} failure not logged: ${text}`);
  for (const value of [reader.email, 'promo.after-failure@example.test', subject, 'could not record']) assert.equal(text.includes(value), false, `the log holds ${value}`);
});

/** The list's types, as the contract defines them; anything else appears only under `all`. */
const TYPES = {
  signins: ['LOGIN'],
  storefront: ['STOREFRONT_PUBLISHED', 'STOREFRONT_RESTORED'],
  catalog: ['PRODUCT_CREATED', 'PRODUCT_UPDATED', 'PRODUCT_DELETED', 'CATEGORY_CREATED', 'CATEGORY_UPDATED', 'CATEGORY_DELETED',
    'CATEGORIES_REORDERED', 'DESIGNER_CREATED', 'DESIGNER_UPDATED', 'DESIGNER_DELETED'],
  discounts: ['DISCOUNT_CREATED', 'DISCOUNT_UPDATED', 'DISCOUNT_STOPPED', 'DISCOUNT_DELETED'],
  customers: ['CUSTOMER_DISABLED', 'CUSTOMER_ENABLED', 'CUSTOMER_DELETED', 'CUSTOMER_VERIFICATION_SENT'],
  promotions: ['PROMOTION_SENT', 'SUBSCRIBER_REMOVED'],
};

test('the activity list: newest first, 25 a page, each type, staff names and roles, and no IP address, user agent or email', async () => {
  await prisma.activityLog.deleteMany();
  const signIn = await call('/admin/login', { method: 'POST', token: null, headers: { 'User-Agent': USER_AGENT }, body: { email: chief.email, password: PASSWORD } });
  assert.equal(signIn.status, 200, JSON.stringify(signIn.data));
  const [login] = await prisma.activityLog.findMany({ include: { admin: true } });
  // Sign-ins are recorded as before, with their address and browser, which the list never returns.
  assert.deepEqual([login.action, login.details, login.userAgent, Boolean(login.ipAddress)], ['LOGIN', 'Admin logged in', USER_AGENT, true]);

  // One entry per action (plus one from an older release), a minute apart, then more product edits to fill two pages.
  const actions = [...Object.values(TYPES).flat().filter((action) => action !== 'LOGIN'), 'LEGACY_IMPORT'];
  const start = Date.parse('2026-11-16T05:00:00.000Z');
  let minute = 0;
  for (const action of [...actions, ...Array(6).fill('PRODUCT_UPDATED')]) {
    minute += 1;
    await prisma.activityLog.create({ data: {
      adminId: minute % 2 ? admin.id : chief.id, action, targetType: 'product', targetId: `target-${minute}`, details: `Entry ${minute}`,
      createdAt: new Date(start + minute * 60_000),
    } });
  }
  // Two entries at the same instant are ordered too (by id, newest first).
  const tied = new Date(start + (minute + 1) * 60_000);
  await prisma.activityLog.createMany({ data: ['CUSTOMER_ENABLED', 'CUSTOMER_DISABLED'].map((action) => ({ adminId: admin.id, action, details: '', createdAt: tied })) });
  const stored = await prisma.activityLog.findMany({ include: { admin: true } });
  const newestFirst = stored.sort((left, right) => right.createdAt - left.createdAt || (left.id < right.id ? 1 : -1));
  const listed = (rows) => rows.map((row) => ({
    id: row.id, at: row.createdAt.toISOString(), action: row.action, targetType: row.targetType, targetId: row.targetId,
    details: row.details, staff: { username: row.admin.username, role: row.admin.role },
  }));
  assert.equal(newestFirst.length, 32);

  const first = await call('/admin/activity');
  assert.deepEqual(first, { status: 200, data: { entries: listed(newestFirst.slice(0, 25)), pagination: { page: 1, limit: 25, pages: 2, total: 32 } } });
  const second = await call('/admin/activity?type=all&page=2', { token: tokens.chief });
  assert.deepEqual(second.data, { entries: listed(newestFirst.slice(25)), pagination: { page: 2, limit: 25, pages: 2, total: 32 } });
  const signedIn = [...first.data.entries, ...second.data.entries].filter((entry) => entry.action === 'LOGIN');
  assert.deepEqual(signedIn, [{ ...listed([login])[0], staff: { username: 'activity-chief', role: 'SUPER_ADMIN' } }]);
  assert.deepEqual((await call('/admin/activity?page=3')).data, { entries: [], pagination: { page: 3, limit: 25, pages: 2, total: 32 } });
  for (const [type, included] of Object.entries(TYPES)) {
    const rows = newestFirst.filter((row) => included.includes(row.action));
    const response = await call(`/admin/activity?type=${type}`);
    assert.deepEqual(response.data, { entries: listed(rows), pagination: { page: 1, limit: 25, pages: 1, total: rows.length } }, type);
  }

  const text = JSON.stringify([first.data, second.data, (await call('/admin/activity?type=signins')).data]);
  for (const value of [USER_AGENT, login.ipAddress, '127.0.0.1', admin.email, chief.email, 'ipAddress', 'userAgent', 'email']) {
    assert.equal(text.includes(value), false, `the list carries ${value}`);
  }
  assert.deepEqual(await call('/admin/activity', { token: tokens.viewer }), { status: 403, data: { error: 'Not authorized' } });
  assert.equal((await call('/admin/activity', { token: null })).status, 401);
  for (const query of ['type=bogus', 'type=ALL', 'type=', 'page=0', 'page=-2', 'page=abc', 'page=1.5', 'page=01', 'page=10001',
    'limit=50', 'type=all&type=catalog', 'page=1&page=2', 'type[x]=all']) {
    const response = await call(`/admin/activity?${query}`);
    assert.equal(response.status, 400, `${query}: ${JSON.stringify(response.data)}`);
  }
});
