export const TEST_MPESA_ENV = {
  NODE_ENV: 'test', ENABLE_MPESA: 'true', MPESA_ENVIRONMENT: 'sandbox',
  MPESA_CONSUMER_KEY: 'fixture-consumer-key', MPESA_CONSUMER_SECRET: 'fixture-consumer-secret',
  MPESA_SHORTCODE: '174379', MPESA_PASSKEY: 'fixture-passkey-not-for-use',
  MPESA_CALLBACK_URL: 'https://merchant.example.test/api/mpesa/callback',
  MPESA_TRANSACTION_TYPE: 'CustomerPayBillOnline', MPESA_MAX_AMOUNT: '5000',
  MPESA_SANDBOX_ALLOWED_PHONES: '0700000000,0110000000',
  MPESA_ALLOW_DEMO_SANDBOX: 'true', MPESA_LIVE_PAYMENTS_ENABLED: 'false',
  MPESA_SANDBOX_SIMULATE: 'false',
};

export function callbackBody({ checkoutRequestId, merchantRequestId, amount = 1244, phone = '254700000000', receiptNumber = 'TESTPAY001', resultCode = 0 } = {}) {
  return {
    Body: { stkCallback: {
      CheckoutRequestID: checkoutRequestId, MerchantRequestID: merchantRequestId,
      ResultCode: resultCode, ResultDesc: resultCode ? 'Synthetic provider failure' : 'Synthetic payment success',
      ...(resultCode === 0 && { CallbackMetadata: { Item: [
        { Name: 'Amount', Value: amount },
        { Name: 'PhoneNumber', Value: Number(phone) },
        { Name: 'MpesaReceiptNumber', Value: receiptNumber },
        { Name: 'TransactionDate', Value: 20261102140000 },
      ] } }),
    } },
  };
}
