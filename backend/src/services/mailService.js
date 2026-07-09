import 'dotenv/config';
import axios from 'axios';
import nodemailer from 'nodemailer';
import prisma from '../config/database.js';

const smtpRequired = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
const gmailRequired = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'];

const emailColorPresets = {
  default: { primary: '#1a1a1a', secondary: '#e8a838', accent: '#b8915c', lightPink: '#FAD4DC', offWhite: '#faf8f5', charcoal: '#2c3e50' },
  ocean: { primary: '#0f172a', secondary: '#38bdf8', accent: '#0ea5e9', lightPink: '#bae6fd', offWhite: '#f0f9ff', charcoal: '#334155' },
  rose: { primary: '#1c1917', secondary: '#e11d48', accent: '#be123c', lightPink: '#fecdd3', offWhite: '#fff1f2', charcoal: '#292524' },
  emerald: { primary: '#14532d', secondary: '#22c55e', accent: '#16a34a', lightPink: '#bbf7d0', offWhite: '#f0fdf4', charcoal: '#14532d' },
  midnight: { primary: '#1e1b4b', secondary: '#a78bfa', accent: '#8b5cf6', lightPink: '#ddd6fe', offWhite: '#f5f3ff', charcoal: '#1e1b4b' },
};

function configured(keys) {
  return keys.every((key) => process.env[key] && !String(process.env[key]).startsWith('your_'));
}

function base64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function stripHtml(html = '') {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeHtml(value = '') {
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

async function getEmailTheme() {
  try {
    const setting = await prisma.siteSetting.findUnique({ where: { key: 'theme' } });
    const theme = setting?.value;
    if (theme?.colorId === 'custom' && theme?.customColors) {
      return { ...emailColorPresets.default, ...theme.customColors };
    }
    return emailColorPresets[theme?.colorId] || emailColorPresets.default;
  } catch {
    return emailColorPresets.default;
  }
}

function brandMark(colors) {
  const frontendUrl = process.env.FRONTEND_URL?.replace(/\/$/, '');
  const logoUrl = process.env.EMAIL_LOGO_URL || (frontendUrl ? `${frontendUrl}/images/logo.png` : '');
  if (logoUrl) {
    return `<img src="${escapeHtml(logoUrl)}" alt="No Maneno Bazaar" width="64" style="display:block;border:0;max-width:64px;height:auto;" />`;
  }

  return `<div style="width:52px;height:52px;border-radius:14px;background:${colors.secondary};color:${colors.primary};display:inline-flex;align-items:center;justify-content:center;font-weight:800;letter-spacing:0.08em;font-size:15px;line-height:52px;text-align:center;">NM</div>`;
}

async function brandedEmail({ eyebrow, title, intro, body, cta, footerNote }) {
  const colors = await getEmailTheme();
  const ctaHtml = cta
    ? `<tr><td style="padding-top:26px;"><a href="${escapeHtml(cta.href)}" style="display:inline-block;background:${colors.primary};color:#ffffff;text-decoration:none;border-radius:6px;padding:14px 22px;font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;">${escapeHtml(cta.label)}</a></td></tr>`
    : '';

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${colors.offWhite};font-family:Arial,Helvetica,sans-serif;color:${colors.charcoal};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${colors.offWhite};padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid rgba(0,0,0,0.08);border-radius:14px;overflow:hidden;">
            <tr>
              <td style="background:${colors.lightPink};padding:26px 28px;border-bottom:4px solid ${colors.secondary};">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="width:64px;vertical-align:middle;">${brandMark(colors)}</td>
                    <td style="vertical-align:middle;padding-left:14px;">
                      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.18em;font-weight:800;color:${colors.accent};">${escapeHtml(eyebrow)}</div>
                      <div style="font-size:22px;line-height:1.2;font-weight:800;color:${colors.primary};margin-top:5px;">No Maneno Bazaar</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:34px 28px 30px;">
                <h1 style="margin:0 0 12px;font-size:28px;line-height:1.2;color:${colors.primary};font-weight:800;">${escapeHtml(title)}</h1>
                <p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:${colors.charcoal};">${escapeHtml(intro)}</p>
                ${body}
                <table role="presentation" cellspacing="0" cellpadding="0">${ctaHtml}</table>
              </td>
            </tr>
            <tr>
              <td style="background:${colors.primary};padding:18px 28px;color:#ffffff;font-size:12px;line-height:1.6;">
                ${escapeHtml(footerNote || 'Thank you for being part of No Maneno Bazaar.')}
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
  const provider = (process.env.EMAIL_PROVIDER || 'smtp').toLowerCase();
  return provider === 'gmail-api' ? configured(gmailRequired) : configured(smtpRequired);
}

export function createMailTransporter() {
  const missing = smtpRequired.filter((key) => !process.env[key] || String(process.env[key]).startsWith('your_'));
  if (missing.length > 0) {
    const error = new Error(`Missing email configuration: ${missing.join(', ')}`);
    error.statusCode = 503;
    throw error;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT || 15000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT || 10000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT || 20000),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function getGmailAccessToken() {
  const missing = gmailRequired.filter((key) => !process.env[key] || String(process.env[key]).startsWith('your_'));
  if (missing.length > 0) {
    const error = new Error(`Missing Gmail API configuration: ${missing.join(', ')}`);
    error.statusCode = 503;
    throw error;
  }

  const { data } = await axios.post(
    'https://oauth2.googleapis.com/token',
    new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: Number(process.env.GMAIL_API_TIMEOUT || 20000),
    }
  );

  return data.access_token;
}

function buildMimeMessage({ from, to, replyTo, subject, text, html }) {
  const boundary = `nmb_${Date.now().toString(36)}`;
  const plainText = text || stripHtml(html);
  const htmlText = html || text || '';
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    replyTo ? `Reply-To: ${replyTo}` : null,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    plainText,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    '',
    htmlText,
    '',
    `--${boundary}--`,
  ];

  return lines.filter((line) => line !== null).join('\r\n');
}

async function sendWithGmailApi(message) {
  const accessToken = await getGmailAccessToken();
  const from = message.from || process.env.GMAIL_FROM || process.env.SMTP_USER || process.env.SMTP_FROM;
  const raw = base64Url(buildMimeMessage({ ...message, from }));

  const { data } = await axios.post(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    { raw },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: Number(process.env.GMAIL_API_TIMEOUT || 20000),
    }
  );

  return { success: true, provider: 'gmail-api', messageId: data.id, threadId: data.threadId };
}

async function sendWithSmtp(message) {
  const transporter = createMailTransporter();
  const sendTimeout = Number(process.env.SMTP_SEND_TIMEOUT || 20000);
  return Promise.race([
    transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      ...message,
    }),
    new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error('Email provider timed out. Check SMTP credentials and network access.');
        error.statusCode = 504;
        reject(error);
      }, sendTimeout);
    }),
  ]);
}

export async function sendMail(message) {
  const provider = (process.env.EMAIL_PROVIDER || 'smtp').toLowerCase();
  if (provider === 'gmail-api') {
    return sendWithGmailApi(message);
  }
  return sendWithSmtp(message);
}

export async function sendVerificationEmail(user, token) {
  if (!isMailConfigured()) return false;

  const frontendUrl = process.env.FRONTEND_URL || process.env.CORS_ORIGIN?.split(',')?.[0] || 'http://localhost:5173';
  const verifyUrl = `${frontendUrl.replace(/\/$/, '')}/#/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(user.email)}`;
  const html = await brandedEmail({
    eyebrow: 'Account verification',
    title: `Welcome, ${user.firstName}`,
    intro: 'Please confirm your email address so your account stays secure and ready for checkout.',
    body: `<p style="margin:0;font-size:14px;line-height:1.7;color:#52616b;">This link expires in 24 hours. After verification, you will be taken back to the sign-in page.</p>`,
    cta: { href: verifyUrl, label: 'Verify email' },
    footerNote: 'If you did not create this account, you can safely ignore this email.',
  });

  await sendMail({
    to: user.email,
    subject: 'Verify your No Maneno Bazaar account',
    text: `Hi ${user.firstName}, verify your account here: ${verifyUrl}`,
    html,
  });

  return true;
}

export async function sendOtpVerificationEmail(user, otp) {
  if (!isMailConfigured()) return false;

  const html = await brandedEmail({
    eyebrow: 'Email verification',
    title: 'Your verification code',
    intro: `Hi ${user.firstName}, enter this 6-digit code to verify your No Maneno Bazaar account.`,
    body: `
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:22px;text-align:center;">
        <div style="font-size:34px;letter-spacing:0.28em;font-weight:900;color:#111827;">${escapeHtml(otp)}</div>
      </div>
      <p style="margin:18px 0 0;font-size:14px;line-height:1.7;color:#52616b;">This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>
    `,
    footerNote: 'Keep this code private. No Maneno Bazaar staff will never ask for it.',
  });

  await sendMail({
    to: user.email,
    subject: 'Your No Maneno Bazaar verification code',
    text: `Hi ${user.firstName}, your No Maneno Bazaar verification code is ${otp}. It expires in 10 minutes.`,
    html,
  });

  return true;
}

export async function sendContactEmail(data) {
  const to = resolveContactRecipient();
  const html = await brandedEmail({
    eyebrow: 'Contact request',
    title: 'New message from the website',
    intro: `${data.name} sent a message through the No Maneno Bazaar contact form.`,
    body: `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f8fafc;border-radius:10px;overflow:hidden;">
        <tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:13px;"><strong>Name:</strong> ${escapeHtml(data.name)}</td></tr>
        <tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:13px;"><strong>Email:</strong> ${escapeHtml(data.email)}</td></tr>
        <tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:13px;"><strong>Phone:</strong> ${escapeHtml(data.phone || 'Not provided')}</td></tr>
        <tr><td style="padding:16px;font-size:14px;line-height:1.7;">${escapeHtml(data.message).replace(/\n/g, '<br>')}</td></tr>
      </table>
    `,
    footerNote: 'Reply to this email to respond directly to the customer.',
  });

  await sendMail({
    to,
    replyTo: data.email,
    subject: `No Maneno Bazaar contact: ${data.name}`,
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
