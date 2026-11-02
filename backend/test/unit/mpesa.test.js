import assert from 'node:assert/strict';
import { test } from 'node:test';
import axios from 'axios';
import { normalizePhone, readMpesaConfig, validateMpesaAmount, validatePaymentMode } from '../../src/config/mpesa.js';
import { parseCallback } from '../../src/utils/mpesaValidation.js';
import { DarajaError, queryStk, requestStkPush } from '../../src/services/mpesaService.js';
import { TEST_MPESA_ENV, callbackBody } from '../mpesa-fixtures.js';

test('Kenyan mobile normalization accepts only bounded supported forms', () => {
  for (const phone of ['0700000000', '700000000', '254700000000', '+254 700-000-000', '(0700) 000 000']) {
    assert.equal(normalizePhone(phone), '254700000000');
  }
  assert.equal(normalizePhone('0110000000'), '254110000000');
  for (const phone of [700000000, null, 'garbage254700000000', '254200000000', '0700', '++254700000000', '+447000000000']) {
    assert.throws(() => normalizePhone(phone), (error) => error.code === 'PHONE_INVALID');
  }
});

test('M-Pesa config fails closed without explicit enablement, sandbox scope and live consent', () => {
  assert.throws(() => readMpesaConfig({}), /not enabled/);
  assert.throws(() => readMpesaConfig({ ...TEST_MPESA_ENV, MPESA_SANDBOX_SIMULATE: 'true' }), /simulator/);
  assert.throws(() => readMpesaConfig({ ...TEST_MPESA_ENV, MPESA_ENVIRONMENT: 'live' }), /supported/);
  assert.throws(() => readMpesaConfig({ ...TEST_MPESA_ENV, MPESA_ENVIRONMENT: 'production' }), /production enablement/);
  for (const value of ['', 'https://example.test/?secret=a', 'http://example.test/api/mpesa/callback', 'https://user:password@example.test/api/mpesa/callback', 'https://127.0.0.1/api/mpesa/callback']) {
    assert.throws(() => readMpesaConfig({ ...TEST_MPESA_ENV, MPESA_CALLBACK_URL: value }));
  }
  assert.throws(() => readMpesaConfig({ ...TEST_MPESA_ENV, MPESA_SANDBOX_ALLOWED_PHONES: '' }));
  assert.throws(() => readMpesaConfig({ ...TEST_MPESA_ENV, MPESA_MAX_AMOUNT: '5.5' }));
  const live = readMpesaConfig({ ...TEST_MPESA_ENV, NODE_ENV: 'production', MPESA_ENVIRONMENT: 'production', MPESA_LIVE_PAYMENTS_ENABLED: 'true' });
  assert.equal(live.baseUrl, 'https://api.safaricom.co.ke');
  assert.equal(live.allowDemo, false);
});

test('the saved order amount is exact and demo data cannot be used for commercial payments', () => {
  const config = readMpesaConfig(TEST_MPESA_ENV);
  assert.equal(validateMpesaAmount('1244.00', config.maxAmount), 1244);
  for (const amount of ['1244.16', 0, -10]) assert.throws(() => validateMpesaAmount(amount, 5000), /not be rounded/);
  assert.throws(() => validateMpesaAmount(5001, 5000), /transaction limit/);
  assert.doesNotThrow(() => validatePaymentMode({ isDemo: true }, config));
  assert.throws(() => validatePaymentMode({ isDemo: false }, config), /demo order/);
  assert.throws(() => validatePaymentMode({ isDemo: true }, { ...config, environment: 'production' }), /live payments/);
});

test('callback parsing rejects duplicate or malformed metadata and keeps only required evidence', () => {
  const body = callbackBody({ checkoutRequestId: 'ws_TEST', merchantRequestId: 'mr_TEST' });
  assert.equal(parseCallback(body).receiptNumber, 'TESTPAY001');
  assert.equal(parseCallback(body).phone, '254700000000');
  body.Body.stkCallback.CallbackMetadata.Item.push({ Name: 'Amount', Value: 1 });
  assert.throws(() => parseCallback(body), /Duplicate/);
  assert.throws(() => parseCallback({ Body: { stkCallback: { ResultCode: 0 } } }), /Invalid/);
  const failed = parseCallback(callbackBody({ checkoutRequestId: 'ws_TEST', merchantRequestId: 'mr_TEST', resultCode: 1032 }));
  assert.equal(failed.resultCode, 1032);
  assert.equal(failed.receiptNumber, null);
});

test('the real transport sends the exact STK and query contracts with bounded requests and no simulation', async (t) => {
  const config = readMpesaConfig(TEST_MPESA_ENV);
  const auth = t.mock.fn(async () => ({ data: { access_token: 'fixture-access-token' } }));
  const posts = [];
  const post = t.mock.fn(async (url, body, options) => {
    posts.push({ url, body, options });
    return { data: url.includes('stkpushquery') ? {
      ResponseCode: '0', ResultCode: '0', ResultDesc: 'Success', CheckoutRequestID: 'ws_TEST', MerchantRequestID: 'mr_TEST',
    } : { ResponseCode: '0', CheckoutRequestID: 'ws_TEST', MerchantRequestID: 'mr_TEST' } };
  });
  const http = { get: auth, post };
  assert.deepEqual(await requestStkPush(config, {
    phone: '254700000000', amount: 1244, callbackUrl: `${config.callbackUrl}/attempt/secret`, accountReference: 'AC0000000001',
  }, http), { accepted: true, checkoutRequestId: 'ws_TEST', merchantRequestId: 'mr_TEST' });
  assert.equal(posts[0].body.Amount, 1244);
  assert.equal(posts[0].body.AccountReference.length, 12);
  assert.equal(posts[0].body.TransactionType, 'CustomerPayBillOnline');
  assert.equal(posts[0].body.PartyB, config.shortcode);
  assert.equal(posts[0].options.maxRedirects, 0);
  assert.equal(posts[0].options.timeout, 15000);
  const decoded = Buffer.from(posts[0].body.Password, 'base64').toString();
  assert.equal(decoded, `${config.shortcode}${config.passkey}${posts[0].body.Timestamp}`);
  assert.match(posts[0].body.Timestamp, /^\d{14}$/);
  assert.deepEqual(await queryStk(config, 'ws_TEST', http), { resultCode: 0, checkoutRequestId: 'ws_TEST', merchantRequestId: 'mr_TEST' });
  assert.equal(posts[1].body.CheckoutRequestID, 'ws_TEST');
  assert.equal('Amount' in posts[1].body, false);
  assert.equal(auth.mock.callCount(), 2);
});

test('transport timeouts and malformed acknowledgements never become a success or expose Axios secrets', async (t) => {
  const config = readMpesaConfig(TEST_MPESA_ENV);
  const get = t.mock.fn(async () => ({ data: { access_token: 'fixture-access-token' } }));
  const post = t.mock.fn(async () => {
    throw new axios.AxiosError('secret-token-and-phone', 'ECONNABORTED', { headers: { Authorization: 'secret-token' }, data: config });
  });
  const http = { get, post };
  const args = { phone: '254700000000', amount: 1244, callbackUrl: 'https://example.test/key', accountReference: 'ACTEST000001' };
  await assert.rejects(requestStkPush(config, args, http), (error) => {
    assert.ok(error instanceof DarajaError);
    assert.equal(error.uncertain, true);
    assert.equal(JSON.stringify(error).includes('secret-token'), false);
    assert.equal('config' in error, false);
    return true;
  });
  post.mock.mockImplementation(async () => ({ data: { ResponseCode: '0' } }));
  await assert.rejects(requestStkPush(config, args, http), (error) => error.code === 'PROVIDER_RESPONSE_INVALID');
  post.mock.mockImplementation(async () => ({ data: { ResponseCode: '0', ResponseDescription: 'Accepted' } }));
  await assert.rejects(queryStk(config, 'ws_TEST', http), (error) => error.code === 'PROVIDER_QUERY_PENDING');
});

test('test mode refuses the real network transport even with configured M-Pesa credentials', async () => {
  const config = readMpesaConfig(TEST_MPESA_ENV);
  await assert.rejects(requestStkPush(config, {
    phone: '254700000000', amount: 1244, callbackUrl: 'https://example.test/callback', accountReference: 'ACTEST000001',
  }), (error) => error.code === 'PROVIDER_TEST_NETWORK_BLOCKED');
  await assert.rejects(queryStk(config, 'ws_TEST'), (error) => error.code === 'PROVIDER_TEST_NETWORK_BLOCKED');
});
