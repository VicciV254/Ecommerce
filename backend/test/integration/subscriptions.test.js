import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import nodemailer from 'nodemailer';
import prisma from '../../src/config/database.js';
import { generateToken } from '../../src/config/auth.js';
import { startServer } from '../../src/server.js';
import { lockAddress } from '../../src/services/subscriptionService.js';

/*
 * P8.4 newsletter: one subscription per address (trimmed, lowercase), the sign-up consent, account toggles that follow
 * the subscription list, public answers that reveal nothing about who is subscribed, and per-recipient unsubscribe links.
 */
const PASSWORD = 'newsletter-fixture-password';
const SUBSCRIBED = { message: 'Subscribed. Every email has a link to unsubscribe.' };
const EMAIL_INVALID = { error: 'Enter a valid email address.', code: 'SUBSCRIPTION_EMAIL_INVALID' };
const LINK_INVALID = { error: "This unsubscribe link isn't valid.", code: 'UNSUBSCRIBE_LINK_INVALID' };
const UNAVAILABLE = { error: "We couldn't update email preferences just now. Try again.", code: 'SUBSCRIPTION_UNAVAILABLE' };

let base, close, staffToken, accountCount = 0;
/** When set, the next query on the named model fails with this error (inside transactions too). */
let injected = null;
prisma.$use(async (params, next) => {
  if (injected && params.model === injected.model) {
    const { error } = injected;
    injected = null;
    throw error;
  }
  return next(params);
});

before(async () => {
  const admin = await prisma.admin.create({ data: {
    email: 'newsletter-staff@example.test', username: 'newsletter-staff', password: 'fixture-not-for-login', role: 'ADMIN',
  } });
  staffToken = generateToken({ adminId: admin.id });
  const started = await startServer({ host: '127.0.0.1', port: 0 });
  close = started.close;
  base = `http://127.0.0.1:${started.server.address().port}/api`;
});
after(async () => { await close?.(); });

async function call(path, { method = 'GET', body, token, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }), ...headers },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return { status: response.status, headers: response.headers, data: await response.json() };
}

const register = (email, extra = {}) => call('/auth/register', {
  method: 'POST', body: { email, password: PASSWORD, firstName: 'Wanjiku', lastName: 'Kamau', ...extra },
});
const subscribe = (body) => call('/subscriptions/subscribe', { method: 'POST', body });
const unsubscribe = (body) => call('/subscriptions/unsubscribe', { method: 'POST', body });
const staff = (path, options = {}) => call(`/subscriptions${path}`, { token: staffToken, ...options });
/** Every subscription row whose address is `email` in any case (exact lower() match, no wildcards). */
const subscriptionsFor = (email) =>
  prisma.$queryRaw`SELECT "id", "email", "isActive", "unsubscribeToken" FROM "Subscription" WHERE lower(btrim("email")) = lower(btrim(${email}))`;
/** What the account shows: the sign-up answer, `/auth/me` and the stored preference. */
async function shownPreference(answer) {
  const me = await call('/auth/me', { token: answer.data.token });
  const stored = await prisma.user.findUnique({ where: { id: answer.data.user.id }, select: { promotionalEmails: true } });
  return [answer.data.user.promotionalEmails, me.data.promotionalEmails, stored.promotionalEmails];
}
/** An account with this exact address (not normalised: `User.email` keeps its case), and its session token. */
async function account(email, promotionalEmails = false) {
  accountCount += 1;
  const user = await prisma.user.create({ data: {
    email, password: 'not-used-for-login', firstName: 'Amina', lastName: `Otieno ${accountCount}`, promotionalEmails,
  } });
  return { ...user, token: generateToken({ userId: user.id }) };
}
const preferenceOf = async (user) => (await prisma.user.findUnique({ where: { id: user.id } })).promotionalEmails;

test('sign-up with the box ticked subscribes the address once, in lowercase, and the new account shows it on', async () => {
  const answer = await register('Signup.Ticked@Example.TEST', { promotionalEmails: true });
  assert.equal(answer.status, 201, JSON.stringify(answer.data));
  const rows = await subscriptionsFor('signup.ticked@example.test');
  assert.deepEqual(rows.map(({ email, isActive }) => ({ email, isActive })), [{ email: 'signup.ticked@example.test', isActive: true }],
    'the ticked sign-up consent was dropped: no active subscription for the new address');
  assert.deepEqual(await shownPreference(answer), [true, true, true]);
});

test('sign-up with the box unticked keeps an existing active subscription, and the new account shows it on', async () => {
  await prisma.subscription.create({ data: { email: 'signup.already@example.test' } });
  const answer = await register('Signup.Already@example.test');
  assert.equal(answer.status, 201, JSON.stringify(answer.data));
  assert.deepEqual((await subscriptionsFor('signup.already@example.test')).map(({ email, isActive }) => ({ email, isActive })),
    [{ email: 'signup.already@example.test', isActive: true }]);
  assert.deepEqual(await shownPreference(answer), [true, true, true]);
});

test('sign-up with the box unticked and no subscription creates none, and the account shows it off', async () => {
  await prisma.subscription.create({ data: { email: 'signup.lapsed@example.test', isActive: false } });
  for (const email of ['signup.plain@example.test', 'signup.lapsed@example.test']) {
    const answer = await register(email, { promotionalEmails: false });
    assert.equal(answer.status, 201, JSON.stringify(answer.data));
    assert.deepEqual(await shownPreference(answer), [false, false, false], email);
  }
  assert.deepEqual(await subscriptionsFor('signup.plain@example.test'), []);
  assert.deepEqual((await subscriptionsFor('signup.lapsed@example.test')).map(({ isActive }) => isActive), [false]);
});

test('account toggles change the one lowercase subscription for a mixed-case address, and answer with the synced value', async () => {
  const owner = await account('Toggle.Mixed@Example.TEST');
  // Another account for the same mailbox in other letters shows the same preference.
  const twin = await account('toggle.mixed@example.test');
  const toggle = (promotionalEmails) => call('/auth/profile', { method: 'PUT', token: owner.token, body: { promotionalEmails } });

  const on = await toggle(true);
  assert.deepEqual([on.status, on.data.promotionalEmails], [200, true]);
  const [subscribed] = await subscriptionsFor('toggle.mixed@example.test');
  assert.deepEqual([subscribed.email, subscribed.isActive], ['toggle.mixed@example.test', true]);
  assert.deepEqual([await preferenceOf(owner), await preferenceOf(twin)], [true, true]);

  const off = await toggle(false);
  assert.deepEqual([off.status, off.data.promotionalEmails], [200, false]);
  assert.deepEqual(await subscriptionsFor('toggle.mixed@example.test'), [{ ...subscribed, isActive: false }]);
  assert.deepEqual([await preferenceOf(owner), await preferenceOf(twin)], [false, false]);
  assert.equal((await call('/auth/me', { token: twin.token })).data.promotionalEmails, false);

  const refused = await toggle('yes');
  assert.deepEqual([refused.status, refused.data], [400, { error: 'promotionalEmails must be true or false' }]);
  assert.deepEqual(await subscriptionsFor('toggle.mixed@example.test'), [{ ...subscribed, isActive: false }]);
});

test('every email-preference writer waits while another writer holds the same address, so racing writes can\'t disagree', async () => {
  /*
   * Read committed lets two transactions for one address miss each other's uncommitted rows: a sign-up and a subscribe
   * at the same moment could leave the account "off" while the address is subscribed. So each writer takes the
   * address's lock first. Here a separate transaction holds that lock, as a concurrent writer would; the request must
   * finish only after the lock is released, and then succeed.
   */
  const HOLD_MS = 800;
  async function finishesAfterRelease(email, request) {
    let release;
    const released = new Promise((resolve) => { release = resolve; });
    let markLocked;
    const locked = new Promise((resolve) => { markLocked = resolve; });
    const holder = prisma.$transaction(async (db) => {
      await lockAddress(db, email);
      markLocked();
      await released;
    }, { timeout: 15_000 });
    await locked;
    let finishedAt = 0;
    const pending = request().then((answer) => { finishedAt = Date.now(); return answer; });
    await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    const releasedAt = Date.now();
    release();
    await holder;
    const answer = await pending;
    assert.ok(finishedAt >= releasedAt, `${email}: finished while another writer held the address`);
    return answer;
  }

  assert.equal((await finishesAfterRelease('race.signup@example.test', () => register('Race.Signup@Example.test'))).status, 201);
  assert.deepEqual((await finishesAfterRelease('race.subscribe@example.test', () => subscribe({ email: 'Race.Subscribe@example.test' }))).data, SUBSCRIBED);
  const [row] = await subscriptionsFor('race.subscribe@example.test');
  assert.equal((await finishesAfterRelease('race.subscribe@example.test', () => unsubscribe({ token: row.unsubscribeToken }))).status, 200);
  const owner = await account('Race.Toggle@example.test');
  const toggled = await finishesAfterRelease('race.toggle@example.test',
    () => call('/auth/profile', { method: 'PUT', token: owner.token, body: { promotionalEmails: true } }));
  assert.deepEqual([toggled.status, toggled.data.promotionalEmails], [200, true]);
  const [toggledRow] = await subscriptionsFor('race.toggle@example.test');
  assert.equal((await finishesAfterRelease('race.toggle@example.test', () => staff(`/admin/${toggledRow.id}`, { method: 'DELETE' }))).status, 200);
  assert.equal(await preferenceOf(owner), false);
});

/** Everything about an answer that could tell subscribers apart: status, body and headers, less per-request ones. */
function observable({ status, headers, data }) {
  // The date and the rate-limit counters change with every request, not with who is subscribed.
  const kept = [...headers].filter(([name]) => name !== 'date' && !name.startsWith('ratelimit-'));
  return { status, data, headers: Object.fromEntries(kept) };
}

test('subscribing answers every valid request identically, whatever the address\'s state, and never returns the record', async () => {
  await prisma.subscription.create({ data: { email: 'state.active@example.test' } });
  await prisma.subscription.create({ data: { email: 'state.inactive@example.test', isActive: false } });
  const answers = [];
  for (const email of ['state.new@example.test', 'state.active@example.test', 'state.inactive@example.test']) {
    answers.push(observable(await subscribe({ email })));
    assert.deepEqual((await subscriptionsFor(email)).map(({ isActive }) => isActive), [true], email);
  }
  assert.deepEqual(answers[0], { ...answers[0], status: 200, data: SUBSCRIBED });
  assert.deepEqual(answers[1], answers[0]);
  assert.deepEqual(answers[2], answers[0]);

  for (const body of [{}, { email: '' }, { email: 'not-an-email' }, { email: 42 }, { email: `${'a'.repeat(243)}@example.test` }, []]) {
    const refused = await subscribe(body);
    assert.deepEqual([refused.status, refused.data], [400, EMAIL_INVALID], JSON.stringify(body));
  }
  // At the limit, after trimming: 254 characters.
  assert.equal((await subscribe({ email: `  ${'b'.repeat(241)}@example.test  ` })).status, 200);
});

test('a mixed-case address reuses the canonical row, and parallel requests for a new address all succeed with one row', async () => {
  await subscribe({ email: 'canonical.reader@example.test' });
  const [row] = await subscriptionsFor('canonical.reader@example.test');
  await prisma.subscription.update({ where: { id: row.id }, data: { isActive: false } });
  assert.deepEqual(await subscribe({ email: '  Canonical.READER@Example.test ' }).then(observable), observable(await subscribe({ email: 'x.fresh@example.test' })));
  assert.deepEqual(await subscriptionsFor('canonical.reader@example.test'), [{ ...row, isActive: true }]);

  const reader = await account('Parallel.Reader@Example.test');
  const answers = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    subscribe({ email: index % 2 ? 'parallel.reader@example.test' : 'PARALLEL.reader@example.test' })));
  assert.deepEqual(answers.map(({ status, data }) => [status, data]), Array(8).fill([200, SUBSCRIBED]));
  assert.equal((await subscriptionsFor('parallel.reader@example.test')).length, 1);
  // The account with that address now shows the preference on.
  assert.equal(await preferenceOf(reader), true);
});

test('only the account with exactly that address follows a subscription: "_" and case are not wildcards', async () => {
  const [exact, lookalike] = [await account('Wild_Card@example.test'), await account('wildxcard@example.test')];
  assert.equal((await subscribe({ email: 'wild_card@example.test' })).status, 200);
  assert.deepEqual([await preferenceOf(exact), await preferenceOf(lookalike)], [true, false]);
});

test('an unsubscribe link turns its subscription off and every matching account\'s preference; a repeat is the same 200', async () => {
  const [owner, twin] = [await account('Unsub.Case@Example.test', true), await account('unsub.case@example.test', true)];
  await subscribe({ email: 'unsub.case@example.test' });
  const [row] = await subscriptionsFor('unsub.case@example.test');
  for (const token of [row.unsubscribeToken, row.unsubscribeToken.toUpperCase()]) {
    const answer = await unsubscribe({ token });
    assert.deepEqual([answer.status, answer.data], [200, { message: 'Unsubscribed.' }]);
  }
  assert.deepEqual(await subscriptionsFor('unsub.case@example.test'), [{ ...row, isActive: false }]);
  assert.deepEqual([await preferenceOf(owner), await preferenceOf(twin)], [false, false]);

  assert.deepEqual(await unsubscribe({ token: '3f2b8c1e-9d4a-4e6b-8f0a-1c2d3e4f5a6b' }).then(({ status, data }) => [status, data]), [404, LINK_INVALID]);
  for (const body of [{}, { token: '' }, { token: 'not-a-token' }, { token: 42 }, { email: 'unsub.case@example.test' },
    { token: row.unsubscribeToken, email: 'unsub.case@example.test' }]) {
    const refused = await unsubscribe(body);
    assert.deepEqual([refused.status, refused.data], [400, LINK_INVALID], JSON.stringify(body));
  }
});

test('staff see subscriptions without their tokens, and removing one turns the matching accounts\' preference off', async () => {
  const reader = await account('Removed.Reader@example.test');
  await subscribe({ email: 'removed.reader@example.test' });
  assert.equal(await preferenceOf(reader), true);
  const listed = await staff('/admin/all');
  assert.equal(listed.status, 200);
  const entry = listed.data.subscriptions.find((item) => item.email === 'removed.reader@example.test');
  assert.deepEqual(Object.keys(entry).sort(), ['createdAt', 'email', 'id', 'isActive', 'updatedAt']);
  const tokens = (await prisma.subscription.findMany()).map((item) => item.unsubscribeToken);
  assert.ok(tokens.length > 1);
  for (const token of tokens) assert.equal(JSON.stringify(listed.data).includes(token), false);

  assert.deepEqual((await staff(`/admin/${entry.id}`, { method: 'DELETE' })).data, { message: 'Subscription deleted' });
  assert.equal(await preferenceOf(reader), false);
  assert.deepEqual(await subscriptionsFor('removed.reader@example.test'), []);
  assert.deepEqual(await staff(`/admin/${entry.id}`, { method: 'DELETE' }).then(({ status, data }) => [status, data]), [404, { error: 'Record not found' }]);
});

test('a failure on any email-preference path leaks no token or address into the answer or the logs', async (t) => {
  const reader = await account('Leak.Check@example.test');
  await subscribe({ email: 'leak.check@example.test' });
  const [row] = await subscriptionsFor('leak.check@example.test');
  const secrets = [row.unsubscribeToken, 'leak.check@example.test', reader.email];
  const failure = () => Object.assign(
    new Error(`Unique constraint failed: unsubscribeToken ${row.unsubscribeToken}, email ${reader.email} (leak.check@example.test)`),
    { name: 'PrismaClientKnownRequestError', code: 'P2028', meta: { target: [row.unsubscribeToken] } },
  );
  const logged = [];
  for (const level of ['error', 'warn']) t.mock.method(console, level, (...args) => { logged.push(args); });

  const paths = [
    ['subscribe', 503, UNAVAILABLE, () => subscribe({ email: reader.email })],
    ['unsubscribe', 503, UNAVAILABLE, () => unsubscribe({ token: row.unsubscribeToken })],
    ['staff list', 503, UNAVAILABLE, () => staff('/admin/all')],
    ['staff delete', 503, UNAVAILABLE, () => staff(`/admin/${row.id}`, { method: 'DELETE' })],
    ['promotional send', 503, UNAVAILABLE, () => staff('/admin/send-promotional', { method: 'POST', body: { subject: 'Hi', content: '<p>Hi</p>' } })],
    ['profile toggle', 500, { error: 'Internal server error' }, () => call('/auth/profile', { method: 'PUT', token: reader.token, body: { promotionalEmails: true } })],
    ['sign-up', 500, { error: 'Internal server error' }, () => register('Leak.Signup@example.test', { promotionalEmails: true })],
  ];
  for (const [label, status, body, request] of paths) {
    injected = { model: 'Subscription', error: failure() };
    const answer = await request();
    assert.equal(injected, null, `${label}: the failure was not reached`);
    assert.deepEqual([answer.status, answer.data], [status, body], label);
    const text = JSON.stringify(answer.data) + JSON.stringify([...answer.headers]);
    for (const secret of secrets) assert.equal(text.includes(secret), false, `${label} answered with ${secret}`);
  }
  const output = logged.map((args) => args.map((value) => (typeof value === 'string' ? value : JSON.stringify(value)) + (value?.stack ?? '')).join(' ')).join('\n');
  for (const secret of [...secrets, 'Unique constraint failed']) assert.equal(output.includes(secret), false, `the log holds ${secret}`);
  assert.ok(output.includes('PrismaClientKnownRequestError') && output.includes('P2028'), output);
  // Nothing was half-written: the subscription and the sign-up are as they were.
  assert.deepEqual(await subscriptionsFor('leak.check@example.test'), [row]);
  assert.equal(await prisma.user.count({ where: { email: 'Leak.Signup@example.test' } }), 0);
});

const MAIL_ENV = {
  EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.example.test', SMTP_PORT: '2525', SMTP_USER: 'mailer@example.test',
  SMTP_PASS: 'smtp-fixture-not-a-secret', SMTP_FROM: 'Apex Cart <mailer@example.test>',
};

test('each promotional email carries its own recipient\'s unsubscribe link, in the HTML and as a plain address', async (t) => {
  const saved = Object.fromEntries(Object.keys(MAIL_ENV).map((key) => [key, process.env[key]]));
  Object.assign(process.env, MAIL_ENV);
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const sent = [];
  t.mock.method(nodemailer, 'createTransport', () => ({
    sendMail: async (message) => { sent.push(message); return { messageId: `<${sent.length}@example.test>` }; },
  }));
  await prisma.subscription.updateMany({ data: { isActive: false } });
  for (const email of ['promo.one@example.test', 'promo.two@example.test', 'promo.three@example.test']) await subscribe({ email });
  const rows = await prisma.subscription.findMany({ where: { isActive: true } });
  const tokenOf = new Map(rows.map((item) => [item.email, item.unsubscribeToken]));
  const tokens = [...tokenOf.values()];
  assert.equal(new Set(tokens).size, 3);

  const answer = await staff('/admin/send-promotional', { method: 'POST', body: { subject: 'Linen week', content: '<p>New linen</p>' } });
  assert.deepEqual([answer.status, answer.data.successful, answer.data.failed, answer.data.total], [200, 3, 0, 3]);
  for (const token of tokens) assert.equal(JSON.stringify(answer.data).includes(token), false, 'the send answer holds a token');
  assert.deepEqual(sent.map((message) => message.to).sort(), [...tokenOf.keys()].sort());
  const decode = (value) => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  for (const message of sent) {
    const own = tokenOf.get(message.to);
    const url = `http://127.0.0.1:4173/#/unsubscribe?token=${own}`;
    const anchors = [...message.html.matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map(([, href, label]) => [decode(href), label]);
    assert.deepEqual(anchors.filter(([href]) => href.includes('/#/unsubscribe')), [[url, 'Unsubscribe from these emails']], message.to);
    assert.ok(message.html.includes('You&#39;re receiving this because you subscribed to Apex Cart emails.'), message.to);
    assert.ok(message.text.includes(`Unsubscribe from these emails: ${url}`), message.text);
    assert.ok(message.text.includes("You're receiving this because you subscribed to Apex Cart emails."), message.text);
    assert.ok(message.text.includes('New linen'), message.text);
    for (const other of tokens.filter((token) => token !== own)) {
      assert.equal(message.html.includes(other) || message.text.includes(other), false, `${message.to} holds another recipient's token`);
    }
  }
});
