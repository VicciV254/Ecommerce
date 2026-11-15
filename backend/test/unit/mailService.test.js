import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspect } from 'node:util';
import axios from 'axios';
import nodemailer from 'nodemailer';
import {
  brandedEmail,
  createMailTransporter,
  escapeHtml,
  isMailConfigured,
  sendContactEmail,
  sendMail,
  sendOtpVerificationEmail,
  sendVerificationEmail,
} from '../../src/services/mailService.js';

const MAIL_ENV_KEYS = [
  'EMAIL_PROVIDER', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_SECURE', 'SMTP_SEND_TIMEOUT',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GMAIL_FROM', 'GMAIL_API_TIMEOUT',
  'CONTACT_TO', 'EMAIL_LOGO_URL', 'FRONTEND_URL',
];
const RECIPIENT = 'customer.fixture@example.test';
const SMTP_PASSWORD = 'smtp-password-fixture-9f2c';
const CLIENT_SECRET = 'client-secret-fixture-71ab';
const REFRESH_TOKEN = 'refresh-token-fixture-55cd';
const ACCESS_TOKEN = 'access-token-fixture-0d9e';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SMTP_ENV = {
  EMAIL_PROVIDER: 'smtp',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '2525',
  SMTP_USER: 'mailer@example.test',
  SMTP_PASS: SMTP_PASSWORD,
  SMTP_FROM: 'Apex Cart <mailer@example.test>',
};
const GMAIL_CREDENTIALS = {
  EMAIL_PROVIDER: 'gmail-api',
  GOOGLE_CLIENT_ID: 'client-id-fixture.example.test',
  GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
  GOOGLE_REFRESH_TOKEN: REFRESH_TOKEN,
};
const GMAIL_ENV = { ...GMAIL_CREDENTIALS, GMAIL_FROM: 'Apex Cart <orders@example.test>' };
const MESSAGE = { to: RECIPIENT, subject: 'Order update', text: 'Plain body', html: '<p>HTML body</p>' };

// Replaces every mail-related variable for one test and restores the previous values afterwards.
function useMailEnv(t, values) {
  const saved = Object.fromEntries(MAIL_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of MAIL_ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

// SMTP transports and HTTP calls fail loudly unless a test supplies a stub.
function stubNetwork(t, { transport, post } = {}) {
  return {
    createTransport: t.mock.method(nodemailer, 'createTransport', transport ?? (() => { throw new Error('Unexpected SMTP transport'); })),
    post: t.mock.method(axios, 'post', post ?? (async () => { throw new Error('Unexpected HTTP request'); })),
  };
}

function gmailPost({ token = { access_token: ACCESS_TOKEN }, sent = { id: 'gmail-message-1', threadId: 'thread-1' } } = {}) {
  return async (url) => ({ data: url === TOKEN_URL ? token : sent });
}

function rejection(promise) {
  return promise.then(() => assert.fail('Expected the send to fail'), (error) => error);
}

function assertNoLeak(error, secrets) {
  const dump = [inspect(error, { depth: null, showHidden: true }), JSON.stringify(error), error.stack].join('\n');
  for (const secret of secrets) assert.equal(dump.includes(secret), false, `error output leaked ${secret}`);
  assert.equal(error.cause, undefined);
  assert.equal(error.response, undefined);
  assert.equal(error.config, undefined);
}

function summary(error) {
  const { code, statusCode, provider, providerCode, providerStatus } = error;
  return { code, statusCode, provider, providerCode, providerStatus };
}

test('missing SMTP settings fail as MAIL_NOT_CONFIGURED before any transport is created', async (t) => {
  useMailEnv(t, { EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.example.test', SMTP_PASS: 'your_smtp_password' });
  const network = stubNetwork(t);

  assert.equal(isMailConfigured(), false);
  const error = await rejection(sendMail(MESSAGE));

  assert.deepEqual(
    { code: error.code, statusCode: error.statusCode, provider: error.provider, missingSettings: error.missingSettings },
    { code: 'MAIL_NOT_CONFIGURED', statusCode: 503, provider: 'smtp', missingSettings: ['SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'] }
  );
  assert.equal(error.message, 'Email delivery is not configured.');
  assert.throws(() => createMailTransporter(), { code: 'MAIL_NOT_CONFIGURED', statusCode: 503 });
  assert.equal(network.createTransport.mock.callCount(), 0);
  assert.equal(network.post.mock.callCount(), 0);
});

test('missing Gmail API settings fail as MAIL_NOT_CONFIGURED before any HTTP request', async (t) => {
  useMailEnv(t, { EMAIL_PROVIDER: 'GMAIL-API', GOOGLE_CLIENT_ID: 'client-id-fixture.example.test' });
  const network = stubNetwork(t);

  const error = await rejection(sendMail(MESSAGE));

  assert.equal(error.code, 'MAIL_NOT_CONFIGURED');
  assert.equal(error.provider, 'gmail-api');
  assert.deepEqual(error.missingSettings, ['GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']);
  assert.equal(network.post.mock.callCount(), 0);
  assert.equal(network.createTransport.mock.callCount(), 0);
});

test('SMTP delivery sends only the documented fields and returns the provider and message id', async (t) => {
  useMailEnv(t, SMTP_ENV);
  const sent = t.mock.fn(async () => ({ messageId: '<fixture-id@example.test>', accepted: [RECIPIENT], response: '250 2.0.0 OK' }));
  const network = stubNetwork(t, { transport: () => ({ sendMail: sent }) });

  const result = await sendMail({
    to: RECIPIENT,
    subject: 'Order update',
    html: '<p>Tom &amp; Jerry&#39;s <b>order</b></p><p>Second line</p>',
    replyTo: 'help@example.test',
  });

  assert.deepEqual(result, { provider: 'smtp', messageId: '<fixture-id@example.test>' });
  const options = network.createTransport.mock.calls[0].arguments[0];
  assert.deepEqual(
    { host: options.host, port: options.port, secure: options.secure, connectionTimeout: options.connectionTimeout, user: options.auth.user },
    { host: 'smtp.example.test', port: 2525, secure: false, connectionTimeout: 15000, user: 'mailer@example.test' }
  );
  assert.deepEqual(sent.mock.calls[0].arguments[0], {
    from: 'Apex Cart <mailer@example.test>',
    to: RECIPIENT,
    replyTo: 'help@example.test',
    subject: 'Order update',
    text: "Tom & Jerry's order\nSecond line",
    html: '<p>Tom &amp; Jerry&#39;s <b>order</b></p><p>Second line</p>',
  });
  assert.equal(network.post.mock.callCount(), 0);
});

test('SMTP failures are normalized without credentials, recipients or provider responses', async (t) => {
  useMailEnv(t, SMTP_ENV);
  const providerResponse = `535-5.7.8 Username and Password not accepted for ${RECIPIENT}`;
  const failure = Object.assign(new Error(`Invalid login: ${providerResponse} (pass ${SMTP_PASSWORD})`), {
    code: 'EAUTH',
    responseCode: 535,
    response: providerResponse,
    command: 'AUTH PLAIN',
  });
  stubNetwork(t, { transport: () => ({ sendMail: async () => { throw failure; } }) });

  const error = await rejection(sendMail(MESSAGE));

  assert.deepEqual(summary(error), {
    code: 'MAIL_PROVIDER_ERROR', statusCode: 502, provider: 'smtp', providerCode: 'EAUTH', providerStatus: 535,
  });
  assert.equal(error.message, 'The email provider could not send the message.');
  assertNoLeak(error, [SMTP_PASSWORD, RECIPIENT, 'Username and Password', 'AUTH PLAIN']);
});

test('a stalled SMTP send and an SMTP socket timeout both fail as MAIL_TIMEOUT', async (t) => {
  useMailEnv(t, { ...SMTP_ENV, SMTP_SEND_TIMEOUT: '20' });
  const socketTimeout = Object.assign(new Error(`Connection timeout to smtp.example.test for ${RECIPIENT}`), { code: 'ETIMEDOUT' });
  const sendAttempts = [() => new Promise(() => {}), () => Promise.reject(socketTimeout)];
  stubNetwork(t, { transport: () => ({ sendMail: () => sendAttempts.shift()() }) });

  const stalled = await rejection(sendMail(MESSAGE));
  assert.deepEqual(summary(stalled), {
    code: 'MAIL_TIMEOUT', statusCode: 504, provider: 'smtp', providerCode: undefined, providerStatus: undefined,
  });

  const timedOut = await rejection(sendMail(MESSAGE));
  assert.deepEqual(summary(timedOut), {
    code: 'MAIL_TIMEOUT', statusCode: 504, provider: 'smtp', providerCode: 'ETIMEDOUT', providerStatus: undefined,
  });
  assertNoLeak(timedOut, [RECIPIENT, 'smtp.example.test']);
});

test('Gmail API delivery sends a header-safe raw message and returns the Gmail message id', async (t) => {
  useMailEnv(t, GMAIL_ENV);
  const network = stubNetwork(t, { post: gmailPost() });

  const result = await sendMail({ ...MESSAGE, subject: 'Order update\r\nBcc: attacker@example.test', replyTo: 'help@example.test' });

  assert.deepEqual(result, { provider: 'gmail-api', messageId: 'gmail-message-1' });
  assert.equal(network.createTransport.mock.callCount(), 0);
  const [tokenCall, sendCall] = network.post.mock.calls.map((call) => call.arguments);
  assert.equal(tokenCall[0], TOKEN_URL);
  assert.equal(tokenCall[1].get('refresh_token'), REFRESH_TOKEN);
  assert.equal(tokenCall[2].timeout, 20000);
  assert.equal(sendCall[0], 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  assert.equal(sendCall[2].headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
  const raw = Buffer.from(sendCall[1].raw, 'base64url').toString('utf8');
  const [headers] = raw.split('\r\n\r\n');
  assert.match(headers, /^From: Apex Cart <orders@example\.test>$/m);
  assert.match(headers, /^To: customer\.fixture@example\.test$/m);
  assert.match(headers, /^Reply-To: help@example\.test$/m);
  assert.match(headers, /^Subject: Order update Bcc: attacker@example\.test$/m);
  assert.doesNotMatch(raw, /^Bcc:/im);
  assert.match(raw, /Plain body/);
  assert.match(raw, /HTML body/);
});

test('Gmail API failures are normalized without tokens, secrets or provider response bodies', async (t) => {
  useMailEnv(t, GMAIL_ENV);
  const failure = Object.assign(new Error('Request failed with status code 401'), {
    code: 'ERR_BAD_REQUEST',
    isAxiosError: true,
    config: { data: `client_secret=${CLIENT_SECRET}&refresh_token=${REFRESH_TOKEN}`, headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } },
    response: { status: 401, data: { error: 'invalid_grant', error_description: `Token revoked for ${RECIPIENT}` } },
  });
  stubNetwork(t, { post: async () => { throw failure; } });

  const error = await rejection(sendMail(MESSAGE));

  assert.deepEqual(summary(error), {
    code: 'MAIL_PROVIDER_ERROR', statusCode: 502, provider: 'gmail-api', providerCode: 'ERR_BAD_REQUEST', providerStatus: 401,
  });
  assertNoLeak(error, [CLIENT_SECRET, REFRESH_TOKEN, ACCESS_TOKEN, RECIPIENT, 'invalid_grant']);
});

test('Gmail API timeouts fail as MAIL_TIMEOUT and a token response without an access token never sends', async (t) => {
  useMailEnv(t, { ...GMAIL_ENV, GMAIL_API_TIMEOUT: '1500' });
  const timeout = Object.assign(new Error('timeout of 1500ms exceeded'), { code: 'ECONNABORTED', config: { data: `refresh_token=${REFRESH_TOKEN}` } });
  const network = stubNetwork(t, { post: async () => { throw timeout; } });

  const timedOut = await rejection(sendMail(MESSAGE));
  assert.deepEqual(summary(timedOut), {
    code: 'MAIL_TIMEOUT', statusCode: 504, provider: 'gmail-api', providerCode: 'ECONNABORTED', providerStatus: undefined,
  });
  assert.equal(network.post.mock.calls[0].arguments[2].timeout, 1500);
  assertNoLeak(timedOut, [REFRESH_TOKEN]);

  network.post.mock.mockImplementation(gmailPost({ token: { token_type: 'Bearer' } }));
  const noToken = await rejection(sendMail(MESSAGE));
  assert.equal(noToken.code, 'MAIL_PROVIDER_ERROR');
  assert.equal(network.post.mock.callCount(), 2);
  assert.equal(network.post.mock.calls[1].arguments[0], TOKEN_URL);
});

test('the branded layout escapes text fields and uses the fixed Apex Cart palette and wordmark', (t) => {
  useMailEnv(t, {});
  const html = brandedEmail({
    eyebrow: 'Order <update>',
    title: 'Title & "quotes"',
    intro: "<script>alert('x')</script>",
    body: '<p>Trusted body</p>',
    cta: { href: 'https://shop.example.test/#/orders?id=1&tab="items"', label: 'View <order>' },
    footerNote: 'Footer <b>note</b>',
  });

  assert.match(html, />Apex Cart<\/div>/);
  assert.doesNotMatch(html, /maneno|<img|<script/i);
  assert.ok(html.includes('#0b1f3a') && html.includes('#c9a227'));
  for (const fragment of [
    'Order &lt;update&gt;',
    'Title &amp; &quot;quotes&quot;',
    '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;',
    'Footer &lt;b&gt;note&lt;/b&gt;',
    'View &lt;order&gt;',
    '<p>Trusted body</p>',
    'href="https://shop.example.test/#/orders?id=1&amp;tab=&quot;items&quot;"',
  ]) {
    assert.ok(html.includes(fragment), `missing ${fragment}`);
  }
});

test('the logo appears only for an http(s) EMAIL_LOGO_URL and non-http CTA links are dropped', (t) => {
  useMailEnv(t, { EMAIL_LOGO_URL: 'javascript:alert(1)' });
  const fallback = brandedEmail({ title: 'Hello', cta: { href: 'javascript:alert(1)', label: 'Open' } });
  assert.doesNotMatch(fallback, /<img|javascript:|>Open</);
  assert.match(fallback, />Apex Cart<\/div>/);
  assert.match(fallback, /This email was sent by Apex Cart\./);

  process.env.EMAIL_LOGO_URL = 'https://cdn.example.test/apex-cart-logo.png';
  assert.match(brandedEmail({ title: 'Hello' }), /<img src="https:\/\/cdn\.example\.test\/apex-cart-logo\.png" alt="Apex Cart"/);
});

test('escapeHtml escapes every HTML-significant character', () => {
  assert.equal(escapeHtml(`<a href="x">Tom & Jerry's</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
});

test('verification and OTP emails are skipped without mail settings and use Apex Cart copy when configured', async (t) => {
  useMailEnv(t, {});
  const sent = t.mock.fn(async () => ({ messageId: '<auth@example.test>' }));
  const network = stubNetwork(t, { transport: () => ({ sendMail: sent }) });

  assert.equal(await sendVerificationEmail({ email: RECIPIENT, firstName: 'Ann' }, 'token'), false);
  assert.equal(await sendOtpVerificationEmail({ email: RECIPIENT, firstName: 'Ann' }, '123456'), false);
  assert.equal(network.createTransport.mock.callCount(), 0);

  Object.assign(process.env, SMTP_ENV, { FRONTEND_URL: 'https://shop.example.test/' });
  assert.equal(await sendVerificationEmail({ email: RECIPIENT, firstName: '<Ann>' }, 'token value'), true);
  assert.equal(await sendOtpVerificationEmail({ email: RECIPIENT, firstName: 'Ann' }, '123456'), true);

  const [verification, otp] = sent.mock.calls.map((call) => call.arguments[0]);
  assert.equal(verification.subject, 'Verify your Apex Cart account');
  assert.ok(verification.html.includes('Welcome, &lt;Ann&gt;'));
  assert.ok(verification.html.includes('href="https://shop.example.test/#/verify-email?token=token%20value&amp;email=customer.fixture%40example.test"'));
  assert.equal(otp.subject, 'Your Apex Cart verification code');
  assert.match(otp.text, /Apex Cart verification code is 123456/);
  assert.match(otp.html, /Apex Cart staff will never ask for it/);
  for (const message of [verification, otp]) assert.doesNotMatch(JSON.stringify(message), /maneno/i);
});

test('contact messages go to the configured inbox with the visitor as reply-to and escaped content', async (t) => {
  useMailEnv(t, { ...SMTP_ENV, CONTACT_TO: 'inbox@example.test' });
  const sent = t.mock.fn(async () => ({ messageId: '<contact@example.test>' }));
  stubNetwork(t, { transport: () => ({ sendMail: sent }) });

  await sendContactEmail({ name: 'Visitor <b>', email: 'visitor@example.test', message: 'Line one\n<script>x</script>' });

  const message = sent.mock.calls[0].arguments[0];
  assert.equal(message.to, 'inbox@example.test');
  assert.equal(message.replyTo, 'visitor@example.test');
  assert.equal(message.subject, 'Apex Cart contact: Visitor <b>');
  assert.ok(message.html.includes('Line one<br>&lt;script&gt;x&lt;/script&gt;'));
  assert.match(message.text, /Phone: Not provided/);
  assert.doesNotMatch(message.html, /<script>|maneno/i);
});

test('a contact message with no inbox or sender address fails as MAIL_NOT_CONFIGURED before any HTTP request', async (t) => {
  useMailEnv(t, GMAIL_CREDENTIALS);
  const network = stubNetwork(t);

  await assert.rejects(
    sendContactEmail({ name: 'Visitor', email: 'visitor@example.test', message: 'Hello there, team' }),
    { code: 'MAIL_NOT_CONFIGURED', provider: 'gmail-api', missingSettings: ['CONTACT_TO'] }
  );
  assert.equal(network.post.mock.callCount(), 0);
});
