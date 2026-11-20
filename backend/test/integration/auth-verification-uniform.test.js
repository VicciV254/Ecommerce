import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import prisma from '../../src/config/database.js';
import { startServer } from '../../src/server.js';

/*
 * Security review note 3: the email-verification answers don't reveal whether an account exists or is verified.
 * Registration still says "Email already registered" (hiding it needs an email-first sign-up). Mail is a fake transport.
 */
const PASSWORD = 'correct horse battery staple';
const FAKE_SMTP = {
  EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.example.test', SMTP_PORT: '2525', SMTP_USER: 'mailer@example.test',
  SMTP_PASS: 'fixture-not-a-password', SMTP_FROM: 'Apex Cart <mailer@example.test>',
};
const UNKNOWN = 'nobody-uniform@example.test';
const VERIFIED = 'verified-uniform@example.test';
const PENDING = 'pending-uniform@example.test';
let base, close;

before(async () => {
  process.env.ENABLE_EMAIL_VERIFICATION = 'true';
  const password = await bcrypt.hash(PASSWORD, 4);
  await prisma.user.create({ data: { email: VERIFIED, password, firstName: 'Done', lastName: 'Already', emailVerified: true } });
  await prisma.user.create({ data: { email: PENDING, password, firstName: 'Not', lastName: 'Yet' } });
  const started = await startServer({ host: '127.0.0.1', port: 0 });
  close = started.close;
  base = `http://127.0.0.1:${started.server.address().port}/api`;
});
after(async () => {
  process.env.ENABLE_EMAIL_VERIFICATION = 'false';
  for (const key of Object.keys(FAKE_SMTP)) process.env[key] = '';
  mock.restoreAll();
  await close?.();
});

async function post(path, body) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
const each = async (path, body) => {
  const answers = [];
  for (const email of [UNKNOWN, VERIFIED, PENDING]) answers.push(await post(path, { ...body, email }));
  return answers;
};

test('checking a code answers alike for an unknown address, a verified account and one without an active code', async () => {
  const [unknown, verified, pending] = await each('/auth/verify-otp', { code: '123456' });
  assert.equal(pending.status, 400);
  assert.deepEqual(unknown, pending);
  assert.deepEqual(verified, pending);
});

test('asking for a new code answers alike whoever asks; only an account that needs verification gets one', async () => {
  Object.assign(process.env, FAKE_SMTP);
  const sent = mock.fn(async () => ({ messageId: '<uniform@example.test>' }));
  mock.method(nodemailer, 'createTransport', () => ({ sendMail: sent }));
  const [unknown, verified, pending] = await each('/auth/resend-verification', {});
  assert.equal(pending.status, 200);
  assert.deepEqual(unknown, pending);
  assert.deepEqual(verified, pending);
  assert.equal(sent.mock.callCount(), 1);
  assert.equal(sent.mock.calls[0].arguments[0].to, PENDING);

  // Without mail settings nobody can be sent a code, and every address is told so alike.
  for (const key of Object.keys(FAKE_SMTP)) process.env[key] = '';
  const refusals = await each('/auth/resend-verification', {});
  assert.deepEqual(refusals.map((answer) => [answer.status, answer.data.code]), Array(3).fill([503, 'MAIL_NOT_CONFIGURED']));
});
