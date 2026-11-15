import '../config/environment.js';
import axios from 'axios';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';

const BRAND_NAME = 'Apex Cart';
const DEFAULT_FOOTER_NOTE = `This email was sent by ${BRAND_NAME}.`;
const smtpRequired = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
const gmailRequired = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'];
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const DEFAULT_TIMEOUT_MS = Object.freeze({
  SMTP_CONNECTION_TIMEOUT: 15000,
  SMTP_GREETING_TIMEOUT: 10000,
  SMTP_SOCKET_TIMEOUT: 20000,
  SMTP_SEND_TIMEOUT: 20000,
  GMAIL_API_TIMEOUT: 20000,
});
const MAIL_ERRORS = Object.freeze({
  MAIL_NOT_CONFIGURED: { statusCode: 503, message: 'Email delivery is not configured.' },
  MAIL_TIMEOUT: { statusCode: 504, message: 'The email provider did not respond in time.' },
  MAIL_PROVIDER_ERROR: { statusCode: 502, message: 'The email provider could not send the message.' },
});
const PROVIDER_TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ECONNABORTED', 'ESOCKETTIMEDOUT']);
const SAFE_PROVIDER_CODE = /^[A-Z][A-Z0-9_]{1,39}$/;
const HTML_ENTITIES = Object.freeze({ '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' });

// Fixed Apex Cart email palette: every text pairing is at least 6.8:1; gold is never text on white (2.4:1).
export const emailPalette = Object.freeze({
  navy: '#0b1f3a',
  gold: '#c9a227',
  canvas: '#f4f5f7',
  surface: '#ffffff',
  panel: '#f8f6ef',
  border: '#e5e7eb',
  ink: '#1f2937',
  muted: '#4b5563',
  onNavy: '#d1d5db',
});

function isSet(key) {
  const value = process.env[key];
  return Boolean(value) && !String(value).startsWith('your_');
}

function emailProvider() {
  return (process.env.EMAIL_PROVIDER || 'smtp').toLowerCase() === 'gmail-api' ? 'gmail-api' : 'smtp';
}

function missingSettings(provider) {
  return (provider === 'gmail-api' ? gmailRequired : smtpRequired).filter((key) => !isSet(key));
}

function timeoutMs(name) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS[name];
}

function mailError(code, details = {}) {
  const { statusCode, message } = MAIL_ERRORS[code];
  return Object.assign(new Error(message), { code, statusCode, ...details });
}

// Keeps only diagnostics that cannot carry credentials, recipients or provider response text.
function providerDiagnostics(error) {
  const diagnostics = {};
  if (typeof error?.code === 'string' && SAFE_PROVIDER_CODE.test(error.code)) diagnostics.providerCode = error.code;
  const status = error?.response?.status ?? error?.responseCode;
  if (Number.isInteger(status) && status >= 100 && status <= 599) diagnostics.providerStatus = status;
  return diagnostics;
}

function normalizeSendError(error, provider) {
  if (Object.hasOwn(MAIL_ERRORS, error?.code ?? '')) return error;
  const code = PROVIDER_TIMEOUT_CODES.has(error?.code) ? 'MAIL_TIMEOUT' : 'MAIL_PROVIDER_ERROR';
  return mailError(code, { provider, ...providerDiagnostics(error) });
}

function htmlToText(html = '') {
  return html
    .replace(/<(head|style|script)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|lt|gt|quot|#39|amp);/g, (entity) => HTML_ENTITIES[entity])
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\/\S+$/i.test(value);
}

export function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractEmail(value = '') {
  const match = String(value).match(/<([^>]+)>/);
  return (match?.[1] || value).trim();
}

function isPlaceholderDomain(value = '') {
  return /@(no-?maneno|nomaneno|nomanenobazaar|nomanenobazar)\./i.test(value);
}

function resolveContactRecipient() {
  const configuredTo = process.env.CONTACT_TO;
  if (configuredTo && !isPlaceholderDomain(configuredTo)) return configuredTo;
  return extractEmail(process.env.GMAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || configuredTo || '');
}

function brandMark() {
  const logoUrl = process.env.EMAIL_LOGO_URL?.trim();
  if (isHttpUrl(logoUrl)) {
    return `<img src="${escapeHtml(logoUrl)}" alt="${BRAND_NAME}" height="40" style="display:block;border:0;height:40px;width:auto;max-width:200px;color:${emailPalette.surface};font-size:22px;font-weight:800;" />`;
  }
  return `<div style="font-size:24px;line-height:1.2;font-weight:800;letter-spacing:0.02em;color:${emailPalette.surface};">${BRAND_NAME}</div>`;
}

// `body` is trusted HTML built by the caller; every other field is escaped here.
export function brandedEmail({ eyebrow, title, intro, body = '', cta, footerNote } = {}) {
  const { navy, gold, canvas, surface, border, ink, onNavy } = emailPalette;
  const eyebrowHtml = eyebrow
    ? `<div style="margin-top:10px;font-size:12px;line-height:1.4;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:${gold};">${escapeHtml(eyebrow)}</div>`
    : '';
  const introHtml = intro ? `<p style="margin:0 0 22px;font-size:16px;line-height:1.6;color:${ink};">${escapeHtml(intro)}</p>` : '';
  const ctaHtml = cta && isHttpUrl(cta.href)
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:26px;"><tr><td style="background:${navy};border-radius:6px;"><a href="${escapeHtml(cta.href)}" style="display:inline-block;padding:14px 22px;font-size:15px;line-height:1.2;font-weight:700;color:${surface};text-decoration:none;">${escapeHtml(cta.label)}</a></td></tr></table>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background:${canvas};font-family:Arial,Helvetica,sans-serif;color:${ink};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${canvas};padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:${surface};border:1px solid ${border};border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:${navy};padding:24px 28px;border-bottom:4px solid ${gold};">
                ${brandMark()}
                ${eyebrowHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:32px 28px 30px;">
                <h1 style="margin:0 0 14px;font-size:26px;line-height:1.25;font-weight:800;color:${navy};">${escapeHtml(title)}</h1>
                ${introHtml}
                ${body}
                ${ctaHtml}
              </td>
            </tr>
            <tr>
              <td style="background:${navy};padding:18px 28px;font-size:13px;line-height:1.6;color:${onNavy};">
                ${escapeHtml(footerNote || DEFAULT_FOOTER_NOTE)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function isMailConfigured() {
  return missingSettings(emailProvider()).length === 0;
}

export function createMailTransporter() {
  const missing = missingSettings('smtp');
  if (missing.length > 0) throw mailError('MAIL_NOT_CONFIGURED', { provider: 'smtp', missingSettings: missing });

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true',
    connectionTimeout: timeoutMs('SMTP_CONNECTION_TIMEOUT'),
    greetingTimeout: timeoutMs('SMTP_GREETING_TIMEOUT'),
    socketTimeout: timeoutMs('SMTP_SOCKET_TIMEOUT'),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendWithGmailApi(message) {
  const timeout = timeoutMs('GMAIL_API_TIMEOUT');
  const { data: token } = await axios.post(
    GOOGLE_TOKEN_URL,
    new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout,
    }
  );
  if (!token?.access_token) throw mailError('MAIL_PROVIDER_ERROR', { provider: 'gmail-api' });

  // MailComposer encodes headers, so CR/LF in a subject cannot inject extra headers into the raw message.
  const from = process.env.GMAIL_FROM || process.env.SMTP_USER || process.env.SMTP_FROM;
  const mime = await new MailComposer({ from, ...message }).compile().build();
  const { data } = await axios.post(
    GMAIL_SEND_URL,
    { raw: mime.toString('base64url') },
    {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
      },
      timeout,
    }
  );

  return data?.id;
}

async function sendWithSmtp(message) {
  const transporter = createMailTransporter();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(mailError('MAIL_TIMEOUT', { provider: 'smtp' })), timeoutMs('SMTP_SEND_TIMEOUT'));
  });

  try {
    const info = await Promise.race([
      transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, ...message }),
      deadline,
    ]);
    return info?.messageId;
  } finally {
    clearTimeout(timer);
  }
}

// Throws only MAIL_NOT_CONFIGURED, MAIL_TIMEOUT or MAIL_PROVIDER_ERROR; a timeout means delivery is unknown.
export async function sendMail({ to, subject, text, html, replyTo } = {}) {
  const provider = emailProvider();
  const missing = missingSettings(provider);
  if (missing.length > 0) throw mailError('MAIL_NOT_CONFIGURED', { provider, missingSettings: missing });

  const message = { to, replyTo, subject, text: text || htmlToText(html), html };
  try {
    const messageId = provider === 'gmail-api' ? await sendWithGmailApi(message) : await sendWithSmtp(message);
    return { provider, messageId: messageId ?? null };
  } catch (error) {
    throw normalizeSendError(error, provider);
  }
}

export async function sendVerificationEmail(user, token) {
  if (!isMailConfigured()) return false;

  const frontendUrl = process.env.FRONTEND_URL || process.env.CORS_ORIGIN?.split(',')?.[0] || 'http://localhost:5173';
  const verifyUrl = `${frontendUrl.replace(/\/$/, '')}/#/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(user.email)}`;
  const html = brandedEmail({
    eyebrow: 'Account verification',
    title: `Welcome, ${user.firstName}`,
    intro: 'Please confirm your email address so your account stays secure and ready for checkout.',
    body: `<p style="margin:0;font-size:14px;line-height:1.7;color:${emailPalette.muted};">This link expires in 24 hours. After verification, you will be taken back to the sign-in page.</p>`,
    cta: { href: verifyUrl, label: 'Verify email' },
    footerNote: 'If you did not create this account, you can safely ignore this email.',
  });

  await sendMail({
    to: user.email,
    subject: `Verify your ${BRAND_NAME} account`,
    text: `Hi ${user.firstName}, verify your account here: ${verifyUrl}`,
    html,
  });

  return true;
}

export async function sendOtpVerificationEmail(user, otp) {
  if (!isMailConfigured()) return false;

  const { navy, panel, border, muted } = emailPalette;
  const html = brandedEmail({
    eyebrow: 'Email verification',
    title: 'Your verification code',
    intro: `Hi ${user.firstName}, enter this 6-digit code to verify your ${BRAND_NAME} account.`,
    body: `
      <div style="background:${panel};border:1px solid ${border};border-radius:12px;padding:22px;text-align:center;">
        <div style="font-size:34px;letter-spacing:0.28em;font-weight:800;color:${navy};">${escapeHtml(otp)}</div>
      </div>
      <p style="margin:18px 0 0;font-size:14px;line-height:1.7;color:${muted};">This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>
    `,
    footerNote: `Keep this code private. ${BRAND_NAME} staff will never ask for it.`,
  });

  await sendMail({
    to: user.email,
    subject: `Your ${BRAND_NAME} verification code`,
    text: `Hi ${user.firstName}, your ${BRAND_NAME} verification code is ${otp}. It expires in 10 minutes.`,
    html,
  });

  return true;
}

export async function sendContactEmail(data) {
  const to = resolveContactRecipient();
  if (!to) throw mailError('MAIL_NOT_CONFIGURED', { provider: emailProvider(), missingSettings: ['CONTACT_TO'] });

  const { panel, border, ink } = emailPalette;
  const rowStyle = `padding:12px 16px;border-bottom:1px solid ${border};font-size:14px;line-height:1.5;color:${ink};`;
  const html = brandedEmail({
    eyebrow: 'Contact request',
    title: 'New message from the website',
    intro: `${data.name} sent a message through the ${BRAND_NAME} contact form.`,
    body: `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:${panel};border-radius:10px;overflow:hidden;">
        <tr><td style="${rowStyle}"><strong>Name:</strong> ${escapeHtml(data.name)}</td></tr>
        <tr><td style="${rowStyle}"><strong>Email:</strong> ${escapeHtml(data.email)}</td></tr>
        <tr><td style="${rowStyle}"><strong>Phone:</strong> ${escapeHtml(data.phone || 'Not provided')}</td></tr>
        <tr><td style="padding:16px;font-size:14px;line-height:1.7;color:${ink};">${escapeHtml(data.message).replace(/\n/g, '<br>')}</td></tr>
      </table>
    `,
    footerNote: 'Reply to this email to respond directly to the customer.',
  });

  await sendMail({
    to,
    replyTo: data.email,
    subject: `${BRAND_NAME} contact: ${data.name}`,
    text: [
      `Name: ${data.name}`,
      `Email: ${data.email}`,
      `Phone: ${data.phone || 'Not provided'}`,
      '',
      data.message,
    ].join('\n'),
    html,
  });
}
