import 'dotenv/config';
import axios from 'axios';

function baseUrl() {
  return process.env.MPESA_ENVIRONMENT === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

function requireMpesaConfig() {
  const required = ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_SHORTCODE', 'MPESA_PASSKEY', 'MPESA_CALLBACK_URL'];
  const missing = required.filter((key) => !process.env[key] || String(process.env[key]).startsWith('your_'));
  if (missing.length > 0 || process.env.ENABLE_MPESA !== 'true') {
    const error = new Error(
      process.env.ENABLE_MPESA !== 'true'
        ? 'M-Pesa is disabled. Set ENABLE_MPESA=true.'
        : `Missing M-Pesa configuration: ${missing.join(', ')}`
    );
    error.statusCode = 503;
    throw error;
  }
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function normalizePhone(phone) {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits;
}

export async function getAccessToken() {
  requireMpesaConfig();
  const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
  const { data } = await axios.get(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
    timeout: 20000,
  });
  return data.access_token;
}

export async function requestStkPush({ phone, amount, accountReference, transactionDesc }) {
  if (process.env.MPESA_ENVIRONMENT === 'sandbox' && process.env.MPESA_SANDBOX_SIMULATE === 'true') {
    const id = `ws_CO_${Date.now()}`;
    return {
      MerchantRequestID: `sandbox_${Date.now()}`,
      CheckoutRequestID: id,
      ResponseCode: '0',
      ResponseDescription: 'Sandbox simulation accepted',
      CustomerMessage: 'Sandbox simulation accepted. No real STK prompt is sent.',
    };
  }

  const token = await getAccessToken();
  const ts = timestamp();
  const shortcode = process.env.MPESA_SHORTCODE;
  const password = Buffer.from(`${shortcode}${process.env.MPESA_PASSKEY}${ts}`).toString('base64');

  const { data } = await axios.post(
    `${baseUrl()}/mpesa/stkpush/v1/processrequest`,
    {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: ts,
      TransactionType: process.env.MPESA_TRANSACTION_TYPE || 'CustomerPayBillOnline',
      Amount: Math.max(1, Math.round(Number(amount))),
      PartyA: normalizePhone(phone),
      PartyB: shortcode,
      PhoneNumber: normalizePhone(phone),
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: accountReference || 'No Maneno',
      TransactionDesc: transactionDesc || 'No Maneno Bazaar order',
    },
    {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30000,
    }
  );

  return data;
}

export async function queryStk(checkoutRequestId) {
  if (process.env.MPESA_ENVIRONMENT === 'sandbox' && process.env.MPESA_SANDBOX_SIMULATE === 'true') {
    return {
      ResponseCode: '0',
      ResponseDescription: 'Sandbox simulation query accepted',
      MerchantRequestID: `sandbox_${Date.now()}`,
      CheckoutRequestID: checkoutRequestId,
      ResultCode: '0',
      ResultDesc: 'Sandbox simulation complete',
    };
  }

  const token = await getAccessToken();
  const ts = timestamp();
  const shortcode = process.env.MPESA_SHORTCODE;
  const password = Buffer.from(`${shortcode}${process.env.MPESA_PASSKEY}${ts}`).toString('base64');

  const { data } = await axios.post(
    `${baseUrl()}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: ts,
      CheckoutRequestID: checkoutRequestId,
    },
    {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30000,
    }
  );

  return data;
}
