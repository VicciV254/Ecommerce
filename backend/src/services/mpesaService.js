import axios from 'axios';
import { initiationResponseSchema, queryResponseSchema } from '../utils/mpesaValidation.js';

export class DarajaError extends Error {
  constructor(code, uncertain) {
    super(uncertain ? 'M-Pesa did not return a confirmed outcome. Do not initiate another payment.' : 'M-Pesa could not start this request.');
    this.name = 'DarajaError';
    this.code = code;
    this.uncertain = uncertain;
  }
}

const transportOptions = {
  timeout: 15_000, maxRedirects: 0, maxContentLength: 64 * 1024, maxBodyLength: 64 * 1024,
  validateStatus: (status) => status >= 200 && status < 300,
};

function timestamp(now = new Date()) {
  return now.toISOString().replace(/\D/g, '').slice(0, 14);
}

function checkedTransport(http) {
  if (process.env.NODE_ENV === 'test' && http === axios) throw new DarajaError('PROVIDER_TEST_NETWORK_BLOCKED', false);
  return http;
}

async function accessToken(config, http) {
  try {
    const auth = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
    const { data } = await http.get(`${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      ...transportOptions, headers: { Authorization: `Basic ${auth}` },
    });
    if (typeof data?.access_token !== 'string' || data.access_token.length < 8 || data.access_token.length > 4096) throw new Error('Invalid token');
    return data.access_token;
  } catch {
    // Never retain Axios errors: they contain Authorization, passkeys and callback URLs.
    throw new DarajaError('PROVIDER_AUTH_UNAVAILABLE', false);
  }
}

function passwordFields(config) {
  const ts = timestamp();
  return { BusinessShortCode: config.shortcode, Password: Buffer.from(`${config.shortcode}${config.passkey}${ts}`).toString('base64'), Timestamp: ts };
}

export async function requestStkPush(config, { phone, amount, callbackUrl, accountReference }, transport = axios) {
  const http = checkedTransport(transport);
  const token = await accessToken(config, http);
  try {
    const { data } = await http.post(`${config.baseUrl}/mpesa/stkpush/v1/processrequest`, {
      ...passwordFields(config), TransactionType: config.transactionType,
      Amount: amount, PartyA: phone, PartyB: config.shortcode, PhoneNumber: phone,
      CallBackURL: callbackUrl, AccountReference: accountReference, TransactionDesc: 'Apex Cart',
    }, { ...transportOptions, headers: { Authorization: `Bearer ${token}` } });
    const parsed = initiationResponseSchema.safeParse(data);
    if (!parsed.success) throw new DarajaError('PROVIDER_RESPONSE_INVALID', true);
    return parsed.data.ResponseCode === 0
      ? { accepted: true, checkoutRequestId: parsed.data.CheckoutRequestID, merchantRequestId: parsed.data.MerchantRequestID }
      : { accepted: false };
  } catch (error) {
    if (error instanceof DarajaError) throw error;
    const refused = axios.isAxiosError(error) && [400, 401, 403, 404, 422].includes(error.response?.status);
    throw new DarajaError(refused ? 'PROVIDER_REJECTED' : 'PROVIDER_OUTCOME_UNKNOWN', !refused);
  }
}

export async function queryStk(config, checkoutRequestId, transport = axios) {
  const http = checkedTransport(transport);
  const token = await accessToken(config, http);
  try {
    const { data } = await http.post(`${config.baseUrl}/mpesa/stkpushquery/v1/query`, {
      ...passwordFields(config), CheckoutRequestID: checkoutRequestId,
    }, { ...transportOptions, headers: { Authorization: `Bearer ${token}` } });
    const parsed = queryResponseSchema.safeParse(data);
    if (!parsed.success || parsed.data.ResponseCode !== 0) throw new DarajaError('PROVIDER_QUERY_PENDING', true);
    return {
      checkoutRequestId: parsed.data.CheckoutRequestID,
      merchantRequestId: parsed.data.MerchantRequestID,
      resultCode: parsed.data.ResultCode,
    };
  } catch (error) {
    if (error instanceof DarajaError) throw error;
    throw new DarajaError('PROVIDER_QUERY_UNAVAILABLE', true);
  }
}

export default { initiate: requestStkPush, query: queryStk };
