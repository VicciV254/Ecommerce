import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { decimal } from '../utils/money.js';

export function paymentError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

export function normalizePhone(value) {
  if (typeof value !== 'string' || value.length > 32 || !/^\+?[\d ()-]+$/.test(value)) {
    throw paymentError(400, 'PHONE_INVALID', 'Enter a Kenyan mobile number beginning with 07, 01 or +254.');
  }
  let digits = value.replace(/[ ()-]/g, '').replace(/^\+/, '');
  if (digits.startsWith('0')) digits = `254${digits.slice(1)}`;
  else if (/^[17]\d{8}$/.test(digits)) digits = `254${digits}`;
  if (!/^254[17]\d{8}$/.test(digits)) {
    throw paymentError(400, 'PHONE_INVALID', 'Enter a valid Kenyan mobile number.');
  }
  return digits;
}

function flag(env, name) {
  const value = env[name] ?? 'false';
  if (!['true', 'false'].includes(value)) throw paymentError(503, 'MPESA_CONFIGURATION', 'M-Pesa configuration requires staff attention.');
  return value === 'true';
}

function secret(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.trim().length < 8 || value.length > 1024 || /^(your_|change.?me|placeholder)/i.test(value)) {
    throw paymentError(503, 'MPESA_CONFIGURATION', 'M-Pesa configuration requires staff attention.');
  }
  return value;
}

export function readMpesaConfig(env = process.env) {
  if (!flag(env, 'ENABLE_MPESA')) throw paymentError(503, 'MPESA_DISABLED', 'M-Pesa payments are not enabled yet.');
  if (flag(env, 'MPESA_SANDBOX_SIMULATE')) throw paymentError(503, 'MPESA_CONFIGURATION', 'The legacy M-Pesa success simulator is disabled.');
  const environment = env.MPESA_ENVIRONMENT ?? 'sandbox';
  if (!['sandbox', 'production'].includes(environment)) throw paymentError(503, 'MPESA_CONFIGURATION', 'Choose a supported M-Pesa environment.');
  if (environment === 'production' && (env.NODE_ENV !== 'production' || !flag(env, 'MPESA_LIVE_PAYMENTS_ENABLED'))) {
    throw paymentError(503, 'MPESA_LIVE_DISABLED', 'Live M-Pesa payments require explicit production enablement.');
  }
  const shortcode = env.MPESA_SHORTCODE ?? '';
  const transactionType = env.MPESA_TRANSACTION_TYPE ?? 'CustomerPayBillOnline';
  if (!/^\d{5,7}$/.test(shortcode) || !['CustomerPayBillOnline', 'CustomerBuyGoodsOnline'].includes(transactionType)) {
    throw paymentError(503, 'MPESA_CONFIGURATION', 'M-Pesa merchant configuration requires staff attention.');
  }
  const max = env.MPESA_MAX_AMOUNT ?? '';
  if (!/^[1-9]\d{0,8}$/.test(max)) throw paymentError(503, 'MPESA_CONFIGURATION', 'An explicit M-Pesa transaction limit is required.');
  let callbackUrl;
  try { callbackUrl = new URL(env.MPESA_CALLBACK_URL); }
  catch { throw paymentError(503, 'MPESA_CONFIGURATION', 'Configure a public HTTPS M-Pesa callback URL ending in /api/mpesa/callback.'); }
  if (callbackUrl.protocol !== 'https:' || callbackUrl.username || callbackUrl.password ||
    callbackUrl.search || callbackUrl.hash || callbackUrl.port || isIP(callbackUrl.hostname) ||
    !callbackUrl.hostname.includes('.') || /(^|\.)localhost$/.test(callbackUrl.hostname) ||
    !callbackUrl.pathname.endsWith('/api/mpesa/callback')) {
    throw paymentError(503, 'MPESA_CONFIGURATION', 'Configure a public HTTPS M-Pesa callback URL ending in /api/mpesa/callback.');
  }
  const rawPhones = env.MPESA_SANDBOX_ALLOWED_PHONES ?? '';
  let allowedPhones = [];
  if (environment === 'sandbox') {
    if (!rawPhones || rawPhones.length > 1000) throw paymentError(503, 'MPESA_CONFIGURATION', 'Authorized sandbox test numbers must be configured.');
    try { allowedPhones = rawPhones.split(',').map((value) => normalizePhone(value.trim())); }
    catch { throw paymentError(503, 'MPESA_CONFIGURATION', 'Authorized sandbox test numbers must be valid Kenyan mobile numbers.'); }
    if (allowedPhones.length > 20) throw paymentError(503, 'MPESA_CONFIGURATION', 'Too many sandbox test numbers are configured.');
  }
  return {
    environment, shortcode, transactionType,
    consumerKey: secret(env, 'MPESA_CONSUMER_KEY'), consumerSecret: secret(env, 'MPESA_CONSUMER_SECRET'),
    passkey: secret(env, 'MPESA_PASSKEY'),
    callbackUrl: callbackUrl.href,
    baseUrl: environment === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke',
    merchantIdentity: createHash('sha256').update(`${environment}|${shortcode}|${transactionType}`).digest('hex'),
    maxAmount: Number(max), allowedPhones,
    allowDemo: environment === 'sandbox' && ['development', 'test'].includes(env.NODE_ENV) && flag(env, 'MPESA_ALLOW_DEMO_SANDBOX'),
  };
}

export function validateMpesaAmount(value, maxAmount) {
  const amount = decimal(value);
  if (!amount.isFinite() || !amount.isInteger() || !amount.greaterThan(0)) {
    throw paymentError(409, 'MPESA_AMOUNT_UNSUPPORTED', 'M-Pesa requires a positive whole-KES total. This order will not be rounded or charged.');
  }
  if (amount.greaterThan(maxAmount)) throw paymentError(409, 'MPESA_AMOUNT_LIMIT', 'This order exceeds the configured M-Pesa transaction limit.');
  return amount.toNumber();
}

export function validatePaymentMode(order, config) {
  if (config.environment === 'sandbox') {
    if (!order.isDemo || !config.allowDemo) throw paymentError(409, 'MPESA_SANDBOX_ONLY', 'Sandbox payments require an explicitly enabled demo order.');
  } else if (order.isDemo) {
    throw paymentError(409, 'MPESA_DEMO_BLOCKED', 'Demo orders cannot initiate live payments.');
  }
}
