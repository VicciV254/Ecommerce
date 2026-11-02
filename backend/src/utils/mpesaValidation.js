import { z } from 'zod';
import { normalizePhone, paymentError } from '../config/mpesa.js';
import { idSchema } from './catalogValidation.js';

const code = z.union([z.number().int().min(0).max(999999), z.string().regex(/^\d{1,6}$/)]).transform(Number);
const providerId = z.string().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/);
const description = z.string().max(1000);
export const initiatePaymentSchema = z.object({ orderId: idSchema, phone: z.string().min(1).max(32) }).strict();

export const initiationResponseSchema = z.object({
  ResponseCode: code,
  MerchantRequestID: providerId.optional(),
  CheckoutRequestID: providerId.optional(),
  ResponseDescription: description.optional(),
  CustomerMessage: description.optional(),
}).passthrough().superRefine((value, ctx) => {
  if (value.ResponseCode === 0 && (!value.MerchantRequestID || !value.CheckoutRequestID)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Accepted initiation is missing provider identifiers' });
  }
});

export const queryResponseSchema = z.object({
  ResponseCode: code,
  MerchantRequestID: providerId,
  CheckoutRequestID: providerId,
  ResultCode: code,
  ResultDesc: description,
}).passthrough();

const callbackSchema = z.object({
  Body: z.object({
    stkCallback: z.object({
      MerchantRequestID: providerId,
      CheckoutRequestID: providerId,
      ResultCode: code,
      ResultDesc: description,
      CallbackMetadata: z.object({
        Item: z.array(z.object({
          Name: z.string().min(1).max(80),
          Value: z.union([z.string().max(256), z.number().finite()]).optional(),
        }).strict()).max(20),
      }).strict().optional(),
    }).strict(),
  }).strict(),
}).strict();

export function parseCallback(body) {
  const parsed = callbackSchema.safeParse(body);
  if (!parsed.success) throw paymentError(400, 'CALLBACK_INVALID', 'Invalid M-Pesa callback payload.');
  const value = parsed.data.Body.stkCallback;
  const items = value.CallbackMetadata?.Item ?? [];
  if (new Set(items.map((item) => item.Name)).size !== items.length) {
    throw paymentError(400, 'CALLBACK_INVALID', 'Duplicate M-Pesa callback metadata.');
  }
  const metadata = Object.fromEntries(items.map((item) => [item.Name, item.Value]));
  let phone = null;
  if (metadata.PhoneNumber !== undefined) {
    try { phone = normalizePhone(String(metadata.PhoneNumber)); } catch {
      throw paymentError(400, 'CALLBACK_INVALID', 'Invalid callback phone format.');
    }
  }
  const amount = metadata.Amount;
  if (amount !== undefined && (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0)) {
    throw paymentError(400, 'CALLBACK_INVALID', 'Invalid callback amount.');
  }
  const receipt = metadata.MpesaReceiptNumber;
  if (receipt !== undefined && (typeof receipt !== 'string' || !/^[A-Z0-9]{8,32}$/.test(receipt))) {
    throw paymentError(400, 'CALLBACK_INVALID', 'Invalid receipt format.');
  }
  const transactionDate = metadata.TransactionDate;
  if (transactionDate !== undefined && !/^\d{14}$/.test(String(transactionDate))) {
    throw paymentError(400, 'CALLBACK_INVALID', 'Invalid transaction date.');
  }
  return {
    checkoutRequestId: value.CheckoutRequestID, merchantRequestId: value.MerchantRequestID,
    resultCode: value.ResultCode, amount: amount ?? null, phone,
    receiptNumber: receipt ?? null, transactionDate: transactionDate === undefined ? null : String(transactionDate),
  };
}
