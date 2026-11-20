import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import prisma from '../../src/config/database.js';
import { startServer } from '../../src/server.js';

/*
 * Security review (P8 follow-up): a verification code can't be guessed by asking for new ones. While the last code is
 * valid and under a minute old, asking again (resend, or signing in unverified) sends nothing and gives no fresh
 * attempts; the answers stay the same for everyone. Codes come from a cryptographic generator. Mail is a fake transport.
 */
const PASSWORD = 'correct horse battery staple';
const FAKE_SMTP = {
  EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.example.test', SMTP_PORT: '2525', SMTP_USER: 'mailer@example.test',
  SMTP_PASS: 'fixture-not-a-password', SMTP_FROM: 'Apex Cart <mailer@example.test>',
};
const sent = mock.fn(async () => ({ messageId: '<guessing@example.test>' }));
let base, close;

before(async () => {
  process.env.ENABLE_EMAIL_VERIFICATION = 'true';
  Object.assign(process.env, FAKE_SMTP);
  mock.method(nodemailer, 'createTransport', () => ({ sendMail: sent }));
  const started = await startServer({ host: '127.0.0.1', port: 0 });
  close = started.close;
  base = `http://127.0.0.1:${started.server.address().port}/api`;
});
after(async () => {
  process.env.ENABLE_EMAIL_VERIFICATION = 'false';
  for (const key of Object.keys(FAKE_SMTP)) delete process.env[key];
  mock.restoreAll();
  await close?.();
});

async function post(path, body) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
const account = async (email) => prisma.user.create({ data: { email, password: await bcrypt.hash(PASSWORD, 4), firstName: 'Guess', lastName: 'Check' } });
const stored = (email) => prisma.user.findUniqueOrThrow({ where: { email }, select: { otpCode: true, otpAttempts: true } });
const answer = (result) => [result.status, result.data.error ?? result.data.message];

test('asking again for a code gives no fresh guesses while the last code is under a minute old', async () => {
  const email = 'guessing-target@example.test';
  await account(email);
  sent.mock.resetCalls();
  assert.equal((await post('/auth/login', { email, password: PASSWORD })).status, 403);
  const first = (await stored(email)).otpCode;
  const wrong = first === '000000' ? '111111' : '000000';
  for (let attempt = 0; attempt < 5; attempt++) await post('/auth/verify-otp', { email, code: wrong });

  assert.deepEqual(answer(await post('/auth/resend-verification', { email })), [200, 'If this email needs verification, a new code has been sent.']);
  assert.equal((await post('/auth/login', { email, password: PASSWORD })).status, 403);
  assert.deepEqual(answer(await post('/auth/verify-otp', { email, code: wrong })), [400, 'Too many failed attempts. Request a new code.']);
  assert.deepEqual(await stored(email), { otpCode: first, otpAttempts: 5 });
  assert.equal(sent.mock.callCount(), 1, 'only the first code was sent');

  // A minute later a new code (and a fresh set of attempts) is sent.
  await prisma.user.update({ where: { email }, data: { otpLastSentAt: new Date(Date.now() - 61_000) } });
  assert.deepEqual(answer(await post('/auth/resend-verification', { email })), [200, 'If this email needs verification, a new code has been sent.']);
  assert.equal(sent.mock.callCount(), 2);
  assert.equal((await stored(email)).otpAttempts, 0);
});

test('codes come from a cryptographic generator, not Math.random', async (t) => {
  t.mock.method(Math, 'random', () => 0);
  const codes = [];
  for (const email of ['generator-one@example.test', 'generator-two@example.test', 'generator-three@example.test']) {
    await account(email);
    assert.equal((await post('/auth/login', { email, password: PASSWORD })).status, 403);
    codes.push((await stored(email)).otpCode);
  }
  assert.ok(codes.every((code) => /^\d{6}$/.test(code)), JSON.stringify(codes));
  assert.ok(new Set(codes).size > 1, `codes follow Math.random: ${JSON.stringify(codes)}`);
});
