import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import prisma from '../../src/config/database.js';
import { startServer } from '../../src/server.js';

/*
 * P8 open item O5 (B3): the email-verification answers say "verification code", never "OTP". Mail is replaced by a fake
 * transport, so no message leaves the process.
 */
const EMAIL = 'verify-codes@example.test';
const PASSWORD = 'correct horse battery staple';
const FAKE_SMTP = {
  EMAIL_PROVIDER: 'smtp', SMTP_HOST: 'smtp.example.test', SMTP_PORT: '2525', SMTP_USER: 'mailer@example.test',
  SMTP_PASS: 'fixture-not-a-password', SMTP_FROM: 'Apex Cart <mailer@example.test>',
};
let base, close;

before(async () => {
  process.env.ENABLE_EMAIL_VERIFICATION = 'true';
  await prisma.user.create({ data: { email: EMAIL, password: await bcrypt.hash(PASSWORD, 4), firstName: 'Verify', lastName: 'Codes' } });
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
const verify = (body) => post('/auth/verify-otp', body);
const otp = async () => (await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })).otpCode;

test('every verification answer says "verification code", never OTP', async () => {
  const answers = [];
  const answer = (result) => { answers.push(result.data); return [result.status, result.data.error ?? result.data.message]; };

  const login = await post('/auth/login', { email: EMAIL, password: PASSWORD });
  assert.deepEqual(answer(login), [403, 'Please verify your email with the code we sent before signing in']);
  assert.equal(login.data.requiresOtp, true);
  assert.deepEqual(answer(await verify({ email: EMAIL })), [400, 'Email and verification code are required']);
  assert.deepEqual(answer(await verify({ email: EMAIL, code: '12345' })), [400, 'Enter the 6-digit verification code']);

  const wrong = (await otp()) === '000000' ? '111111' : '000000';
  const remaining = [];
  for (let attempt = 0; attempt < 5; attempt++) remaining.push(answer(await verify({ email: EMAIL, code: wrong })));
  assert.deepEqual(remaining.map(([, text]) => text), [
    'Invalid verification code. 4 attempts remaining.', 'Invalid verification code. 3 attempts remaining.',
    'Invalid verification code. 2 attempts remaining.', 'Invalid verification code. 1 attempt remaining.',
    'Invalid verification code. 0 attempts remaining.',
  ]);

  await prisma.user.update({ where: { email: EMAIL }, data: { otpAttempts: 0, otpExpiresAt: new Date(Date.now() - 1000) } });
  assert.deepEqual(answer(await verify({ email: EMAIL, code: wrong })), [400, 'Verification code expired. Request a new code.']);
  await prisma.user.update({ where: { email: EMAIL }, data: { otpCode: null, otpExpiresAt: null } });
  assert.deepEqual(answer(await verify({ email: EMAIL, code: wrong })), [400, "There's no active code for this email. Request a new code, or sign in if your email is already verified."]);

  // Without mail settings no code can be sent, to anyone; with a (fake) transport it is.
  assert.deepEqual(answer(await post('/auth/resend-verification', { email: EMAIL })), [503, 'Email delivery is not configured.']);
  Object.assign(process.env, FAKE_SMTP);
  const sent = mock.fn(async () => ({ messageId: '<verify@example.test>' }));
  mock.method(nodemailer, 'createTransport', () => ({ sendMail: sent }));
  assert.deepEqual(answer(await post('/auth/resend-verification', { email: EMAIL })), [200, 'If this email needs verification, a new code has been sent.']);
  assert.equal(sent.mock.callCount(), 1);

  assert.doesNotMatch(JSON.stringify(answers), /\bOTP\b/);
});
