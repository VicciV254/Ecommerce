import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import prisma from '../config/database.js';
import { normalizePhone, paymentError, readMpesaConfig, validateMpesaAmount, validatePaymentMode } from '../config/mpesa.js';
import { moneyNumber } from '../utils/money.js';
import { idempotencyKeySchema } from '../utils/checkoutValidation.js';
import { initiatePaymentSchema, parseCallback } from '../utils/mpesaValidation.js';
import { commitOrderReservation, expireOrderReservation, isInventoryConflict, lockOrderInventory as lockOrder } from './inventoryService.js';
import provider, { DarajaError } from './mpesaService.js';

const UNSETTLED = ['INITIATING', 'PENDING', 'UNKNOWN', 'REVIEW', 'SUCCEEDED'];
const MAX_ATTEMPTS = 5;
const MAX_AUTOMATIC_CHECKS = 20;
const RETRY_DELAY = 30_000;
const LEASE_MS = 60_000;
const FINAL_FAILURE_CODES = new Set([1, 1032, 1037, 2001]);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const evidenceHash = (source, details) => hash(JSON.stringify({ source, details }));

async function transaction(operation) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await prisma.$transaction(operation, { isolationLevel: 'Serializable', timeout: 20_000 }); }
    catch (error) {
      if (!isInventoryConflict(error)) throw error;
      if (attempt === 2) throw paymentError(409, 'PAYMENT_RETRY', 'Payment data changed concurrently. Check status and retry the same request.');
    }
  }
}

async function recordEvent(db, paymentId, source, details) {
  const fingerprint = evidenceHash(source, details);
  await db.mpesaPaymentEvent.upsert({
    where: { paymentId_fingerprint: { paymentId, fingerprint } },
    create: { paymentId, source, fingerprint, details }, update: {},
  });
}

function statusMessage(payment) {
  if (payment.confirmedAt && payment.reviewCode) return 'Payment was received, but the order requires staff review. Do not pay again.';
  if (payment.status === 'SUCCEEDED') return 'M-Pesa payment confirmed.';
  if (payment.status === 'FAILED') {
    if (payment.resultCode === 1032) return 'The M-Pesa request was cancelled.';
    if (payment.resultCode === 1) return 'M-Pesa reported insufficient funds.';
    if (payment.resultCode === 1037) return 'M-Pesa reported that the request timed out.';
    return 'M-Pesa confirmed that this attempt did not complete.';
  }
  if (payment.status === 'REVIEW') return 'This payment needs verification or staff review. Do not pay again.';
  if (payment.status === 'UNKNOWN') return 'The provider outcome is unknown. Check this attempt instead of sending another prompt.';
  if (payment.status === 'INITIATING') return 'The payment request is being submitted. No payment has been confirmed.';
  return 'Check your phone for the M-Pesa prompt. Payment has not been confirmed yet.';
}

export function paymentDto(payment) {
  if (payment.status === 'INITIATING' && Date.now() - payment.createdAt.getTime() >= LEASE_MS) {
    payment = { ...payment, status: 'UNKNOWN', lastErrorCode: 'PROVIDER_REFERENCE_PENDING' };
  }
  return {
    id: payment.id, orderId: payment.orderId, status: payment.status, environment: payment.environment,
    amount: moneyNumber(payment.amount), phoneMasked: `+254 *** ${payment.phone.slice(-4)}`,
    receiptNumber: payment.confirmedAt ? payment.receiptNumber : null,
    confirmedAt: payment.confirmedAt?.toISOString() ?? null,
    reviewRequired: Boolean(payment.reviewCode), reasonCode: payment.reviewCode ?? payment.lastErrorCode ?? null,
    message: statusMessage(payment), createdAt: payment.createdAt.toISOString(), updatedAt: payment.updatedAt.toISOString(),
    nextCheckAt: payment.nextReconcileAt?.toISOString() ?? null,
    canReconcile: !payment.confirmedAt && payment.status !== 'FAILED' &&
      !(payment.status === 'REVIEW' && !payment.nextReconcileAt) &&
      Boolean(payment.checkoutRequestId || payment.rawCallback?.checkoutRequestId),
  };
}

function ensurePayable(order, config) {
  validatePaymentMode(order, config);
  if (!order.quoteId || order.paymentStatus !== 'PENDING' || order.status !== 'PENDING' ||
    order.reservationStatus !== 'HELD' || !order.reservationExpiresAt || order.reservationExpiresAt <= new Date()) {
    throw paymentError(409, 'ORDER_NOT_PAYABLE', 'This order is not awaiting payment on an active reservation.');
  }
  return validateMpesaAmount(order.total, config.maxAmount);
}

export async function orderPayments(orderId, userId, staff = false) {
  let order = await prisma.order.findFirst({ where: { id: orderId, ...(!staff && { userId }) } });
  if (!order) throw paymentError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  if (order.status === 'PENDING' && order.paymentStatus === 'PENDING' &&
    order.reservationStatus === 'HELD' && order.reservationExpiresAt <= new Date()) {
    order = await transaction((db) => expireOrderReservation(db, order.id));
  }
  const payments = await prisma.mpesaPayment.findMany({ where: { orderId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  let available = false;
  let reasonCode = null;
  let message = null;
  let environment = null;
  try {
    const config = readMpesaConfig();
    environment = config.environment;
    ensurePayable(order, config);
    if (payments.some((payment) => UNSETTLED.includes(payment.status))) throw paymentError(409, 'PAYMENT_EXISTS', 'Check the existing payment attempt. Do not send another prompt.');
    if (payments.length >= MAX_ATTEMPTS) throw paymentError(409, 'PAYMENT_ATTEMPT_LIMIT', 'The payment attempt limit was reached. Contact support.');
    if (payments[0] && Date.now() - payments[0].createdAt.getTime() < RETRY_DELAY) throw paymentError(409, 'PAYMENT_COOLDOWN', 'Wait before requesting another M-Pesa prompt.');
    available = true;
  } catch (error) {
    if (!error.statusCode) throw error;
    reasonCode = error.code;
    message = error.message;
  }
  return {
    order: {
      id: order.id, orderNumber: order.orderNumber, total: moneyNumber(order.total),
      status: order.status, paymentStatus: order.paymentStatus, reservationStatus: order.reservationStatus,
      reservationExpiresAt: order.reservationExpiresAt?.toISOString() ?? null, isDemo: order.isDemo,
    },
    available, environment, reasonCode, message, attempts: payments.map(paymentDto),
  };
}

export async function getPayment(id, userId, staff = false) {
  const payment = await prisma.mpesaPayment.findFirst({
    where: { id, orderId: { not: null }, ...(!staff && { order: { is: { userId } } }) },
  });
  if (!payment) throw paymentError(404, 'PAYMENT_NOT_FOUND', 'Payment attempt not found.');
  return payment;
}

export async function initiatePayment(userId, body, key) {
  const config = readMpesaConfig();
  const input = initiatePaymentSchema.parse(body);
  const phone = normalizePhone(input.phone);
  const idempotencyKey = idempotencyKeySchema.parse(key);
  if (config.environment === 'sandbox' && !config.allowedPhones.includes(phone)) {
    throw paymentError(400, 'SANDBOX_PHONE_NOT_ALLOWED', 'Use an authorized sandbox test number.');
  }
  const requestHash = hash(JSON.stringify({ orderId: input.orderId, phone }));
  const callbackKey = randomBytes(32).toString('hex');
  const created = await transaction(async (db) => {
    await lockOrder(db, input.orderId);
    const order = await db.order.findFirst({
      where: { id: input.orderId, userId },
      include: { items: { include: { variant: { include: { product: true } } } } },
    });
    if (!order) throw paymentError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    const prior = await db.mpesaPayment.findUnique({ where: { orderId_idempotencyKey: { orderId: order.id, idempotencyKey } } });
    if (prior) {
      if (prior.requestHash !== requestHash) throw paymentError(409, 'IDEMPOTENCY_CONFLICT', 'This payment key was already used with different contents.');
      return { payment: prior, send: false };
    }
    const amount = ensurePayable(order, config);
    if (!order.items.length || order.items.some((item) =>
      !item.variant || item.variant.productId !== item.productId || !item.variant.isActive ||
      !item.variant.product.isActive || item.variant.product.deletedAt || item.variant.product.isDemo !== order.isDemo)) {
      throw paymentError(409, 'ITEM_NOT_PAYABLE', 'An ordered item is no longer eligible for payment. Contact support.');
    }
    const priorAttempts = await db.mpesaPayment.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'desc' } });
    const active = priorAttempts.find((payment) => UNSETTLED.includes(payment.status));
    if (active) throw paymentError(409, 'PAYMENT_EXISTS', 'A payment is already pending or needs review. Check it instead of sending another prompt.');
    if (priorAttempts.length >= MAX_ATTEMPTS) throw paymentError(409, 'PAYMENT_ATTEMPT_LIMIT', 'The payment attempt limit was reached. Contact support.');
    if (priorAttempts[0] && Date.now() - priorAttempts[0].createdAt.getTime() < RETRY_DELAY) {
      throw paymentError(409, 'PAYMENT_COOLDOWN', 'Wait before requesting another M-Pesa prompt.');
    }
    const payment = await db.mpesaPayment.create({ data: {
      id: randomUUID(), orderId: order.id, orderNumber: order.orderNumber, phone, amount,
      environment: config.environment, merchantShortcode: config.shortcode, merchantIdentity: config.merchantIdentity,
      idempotencyKey, requestHash, callbackKeyHash: hash(callbackKey),
      reference: `AC${randomBytes(5).toString('hex').toUpperCase()}`,
      status: 'INITIATING', nextReconcileAt: new Date(Date.now() + LEASE_MS),
    } });
    await recordEvent(db, payment.id, 'INITIATION', { state: 'RECORDED' });
    return { payment, send: true };
  });
  if (!created.send) return { payment: paymentDto(created.payment), created: false };

  let outcome;
  try {
    outcome = await provider.initiate(config, {
      phone, amount: moneyNumber(created.payment.amount),
      callbackUrl: `${config.callbackUrl}/${created.payment.id}/${callbackKey}`,
      accountReference: created.payment.reference,
    });
  } catch (error) {
    if (!(error instanceof DarajaError)) throw paymentError(503, 'PAYMENT_PERSISTENCE_UNKNOWN', 'The request may have been sent. Check this payment before retrying.');
    outcome = { accepted: false, unknown: error.uncertain, code: error.code };
  }
  try {
    const payment = await transaction(async (db) => {
      await lockOrder(db, created.payment.orderId);
      const current = await db.mpesaPayment.findUnique({ where: { id: created.payment.id } });
      await recordEvent(db, current.id, 'INITIATION', outcome);
      if (current.confirmedAt) return current;
      if (outcome.accepted) {
        const callback = current.rawCallback;
        const mismatch = callback && (callback.checkoutRequestId !== outcome.checkoutRequestId || callback.merchantRequestId !== outcome.merchantRequestId);
        return db.mpesaPayment.update({ where: { id: current.id }, data: {
          checkoutRequestId: outcome.checkoutRequestId, merchantRequestId: outcome.merchantRequestId,
          status: mismatch || current.reviewCode ? 'REVIEW' : 'PENDING',
          ...(mismatch && { reviewCode: 'PROVIDER_ID_MISMATCH' }),
          lastErrorCode: null, nextReconcileAt: new Date(Date.now() + 3000),
        } });
      }
      // A callback arriving before a lost response must not be overwritten by an initiation error.
      const hasCallback = Boolean(current.rawCallback);
      return db.mpesaPayment.update({ where: { id: current.id }, data: {
        status: current.reviewCode ? 'REVIEW' : outcome.unknown || hasCallback ? 'UNKNOWN' : 'FAILED',
        lastErrorCode: outcome.code ?? 'PROVIDER_REJECTED',
        nextReconcileAt: outcome.unknown || hasCallback ? new Date(Date.now() + RETRY_DELAY) : null,
      } });
    });
    return { payment: paymentDto(payment), created: true };
  } catch {
    // The attempt is already durable. Never repeat the upstream initiation to recover this write.
    throw paymentError(503, 'PAYMENT_PERSISTENCE_UNKNOWN', 'The provider request may have been accepted, but its result could not be saved. Check this payment; do not send another prompt.');
  }
}

function callbackAuthorized(payment, key) {
  if (!/^[a-f0-9]{64}$/.test(key) || !/^[a-f0-9]{64}$/.test(payment.callbackKeyHash ?? '')) return false;
  return timingSafeEqual(Buffer.from(hash(key), 'hex'), Buffer.from(payment.callbackKeyHash, 'hex'));
}

export async function ingestCallback(id, key, body) {
  const known = await prisma.mpesaPayment.findFirst({ where: { id, orderId: { not: null } } });
  if (!known || !callbackAuthorized(known, key)) throw paymentError(404, 'CALLBACK_NOT_FOUND', 'Callback not found.');
  const callback = parseCallback(body);
  await transaction(async (db) => {
    await lockOrder(db, known.orderId);
    const payment = await db.mpesaPayment.findUnique({ where: { id } });
    const fingerprint = evidenceHash('CALLBACK', callback);
    if (await db.mpesaPaymentEvent.findUnique({ where: { paymentId_fingerprint: { paymentId: id, fingerprint } } })) return;
    if (await db.mpesaPaymentEvent.count({ where: { paymentId: id, source: 'CALLBACK' } }) >= 20) {
      throw paymentError(429, 'CALLBACK_LIMIT', 'Callback evidence limit reached.');
    }
    await recordEvent(db, id, 'CALLBACK', callback);
    let reviewCode = payment.reviewCode === 'RECEIPT_PENDING' ? null : payment.reviewCode;
    if ((payment.checkoutRequestId && payment.checkoutRequestId !== callback.checkoutRequestId) ||
      (payment.merchantRequestId && payment.merchantRequestId !== callback.merchantRequestId)) reviewCode = 'PROVIDER_ID_MISMATCH';
    if (callback.resultCode === 0) {
      if ((callback.amount !== null && callback.amount !== moneyNumber(payment.amount)) ||
        (callback.phone !== null && callback.phone !== payment.phone)) reviewCode = 'CALLBACK_MISMATCH';
      else if (callback.amount === null || callback.phone === null || !callback.receiptNumber || !callback.transactionDate) {
        reviewCode ??= 'RECEIPT_PENDING';
      }
    }
    const previous = payment.rawCallback;
    const completesSameEvidence = previous && previous.resultCode === callback.resultCode &&
      previous.checkoutRequestId === callback.checkoutRequestId && previous.merchantRequestId === callback.merchantRequestId &&
      ['amount', 'phone', 'receiptNumber', 'transactionDate'].every((field) => previous[field] === null || previous[field] === callback[field]);
    if (previous && !completesSameEvidence && evidenceHash('CALLBACK', previous) !== fingerprint) reviewCode = 'CONFLICTING_CALLBACK';
    if (payment.status === 'FAILED' && callback.resultCode === 0) reviewCode = 'CONFLICTING_RESULT';
    if (payment.confirmedAt) {
      await db.mpesaPayment.update({ where: { id }, data: { reviewCode: reviewCode ?? payment.reviewCode } });
      return;
    }
    const keepPrevious = (previous?.resultCode === 0 && !completesSameEvidence) || (previous && reviewCode === 'PROVIDER_ID_MISMATCH');
    await db.mpesaPayment.update({ where: { id }, data: {
      rawCallback: keepPrevious ? previous : callback, reviewCode,
      status: reviewCode ? 'REVIEW' : 'PENDING', nextReconcileAt: new Date(),
    } });
  });
}

function configForAttempt(payment) {
  const config = readMpesaConfig();
  if (config.merchantIdentity !== payment.merchantIdentity || config.environment !== payment.environment) {
    throw paymentError(503, 'MPESA_MERCHANT_CHANGED', 'The payment belongs to a different merchant configuration; staff review is required.');
  }
  return config;
}

async function finishQuery(db, payment, result, lease) {
  if (payment.reconcileLease !== lease) return payment;
  const unlock = { reconcileLease: null, leaseExpiresAt: null };
  await recordEvent(db, payment.id, 'QUERY', result);
  const expectedCheckout = payment.checkoutRequestId ?? payment.rawCallback?.checkoutRequestId;
  const expectedMerchant = payment.merchantRequestId ?? payment.rawCallback?.merchantRequestId;
  if (result.checkoutRequestId !== expectedCheckout || result.merchantRequestId !== expectedMerchant) {
    return db.mpesaPayment.update({ where: { id: payment.id }, data: {
      ...unlock, status: payment.confirmedAt ? payment.status : 'REVIEW',
      reviewCode: 'QUERY_ID_MISMATCH', lastErrorCode: null, nextReconcileAt: null,
    } });
  }
  if (payment.confirmedAt) return db.mpesaPayment.update({ where: { id: payment.id }, data: unlock });
  const callback = payment.rawCallback;
  if (result.resultCode !== 0) {
    if (!FINAL_FAILURE_CODES.has(result.resultCode)) {
      return db.mpesaPayment.update({ where: { id: payment.id }, data: {
        ...unlock, status: payment.reviewCode ? 'REVIEW' : 'UNKNOWN', queryEvidence: result,
        lastErrorCode: 'PROVIDER_QUERY_PENDING', nextReconcileAt: new Date(Date.now() + RETRY_DELAY),
      } });
    }
    const reviewCode = payment.reviewCode ?? (callback?.resultCode === 0 ? 'CONFLICTING_RESULT' : null);
    return db.mpesaPayment.update({ where: { id: payment.id }, data: {
      ...unlock, status: reviewCode ? 'REVIEW' : 'FAILED', resultCode: result.resultCode,
      reviewCode, queryEvidence: result, lastErrorCode: null, nextReconcileAt: null,
    } });
  }
  const verified = {
    ...unlock, queryEvidence: result, resultCode: 0, providerVerifiedAt: new Date(), lastErrorCode: null,
  };
  const matchingCallback = callback?.resultCode === 0 && callback.checkoutRequestId === result.checkoutRequestId &&
    callback.merchantRequestId === result.merchantRequestId && callback.amount === moneyNumber(payment.amount) &&
    callback.phone === payment.phone && callback.receiptNumber && callback.transactionDate;
  if (!matchingCallback) {
    return db.mpesaPayment.update({ where: { id: payment.id }, data: {
      ...verified, status: 'REVIEW', reviewCode: payment.reviewCode ?? 'RECEIPT_PENDING',
      nextReconcileAt: null,
    } });
  }
  if (payment.reviewCode && payment.reviewCode !== 'RECEIPT_PENDING' && payment.reviewCode !== 'RESERVATION_UNAVAILABLE') {
    return db.mpesaPayment.update({ where: { id: payment.id }, data: {
      ...verified, status: 'REVIEW', nextReconcileAt: null,
    } });
  }
  const reused = await db.mpesaPayment.findFirst({ where: {
    id: { not: payment.id }, environment: payment.environment, receiptNumber: callback.receiptNumber,
  } });
  if (reused) return db.mpesaPayment.update({ where: { id: payment.id }, data: {
    ...verified, status: 'REVIEW', reviewCode: 'RECEIPT_REUSED', nextReconcileAt: null,
  } });

  let order = await db.order.findUnique({ where: { id: payment.orderId } });
  let reviewCode = payment.reviewCode === 'RECEIPT_PENDING' ? null : payment.reviewCode;
  if (moneyNumber(order.total) !== moneyNumber(payment.amount)) reviewCode = 'ORDER_AMOUNT_CHANGED';
  if (order.reservationStatus === 'HELD' && order.paymentStatus === 'PENDING' && order.reservationExpiresAt <= new Date()) {
    order = await expireOrderReservation(db, order.id);
  }
  if (order.paymentStatus !== 'PENDING') reviewCode ??= 'EXTRA_PAYMENT';
  if (order.status !== 'PENDING' || order.reservationStatus !== 'HELD') reviewCode ??= 'RESERVATION_UNAVAILABLE';
  if (!reviewCode) await commitOrderReservation(db, order.id);
  const canAttribute = moneyNumber(order.total) === moneyNumber(payment.amount) && order.paymentStatus === 'PENDING';
  if (canAttribute) await db.order.update({ where: { id: order.id }, data: {
    paymentStatus: 'PAID', autoStageEnabled: false, autoStagePaused: true,
    trackingHistory: { create: {
      status: order.status,
      description: reviewCode ? 'M-Pesa payment received; staff review required. No fulfilment was started.' : 'M-Pesa payment confirmed; awaiting staff fulfilment.',
      location: 'Payment verification',
    } },
  } });
  return db.mpesaPayment.update({ where: { id: payment.id }, data: {
    ...verified, status: reviewCode ? 'REVIEW' : 'SUCCEEDED',
    reviewCode, receiptNumber: callback.receiptNumber, confirmedAt: new Date(), nextReconcileAt: null,
  } });
}

export async function reconcilePayment(id, { userId, staff = false, automatic = false } = {}) {
  const known = automatic
    ? await prisma.mpesaPayment.findFirst({ where: { id, orderId: { not: null } } })
    : await getPayment(id, userId, staff);
  if (!known) return null;
  if (known.confirmedAt || known.status === 'FAILED' || (known.status === 'REVIEW' && !known.nextReconcileAt)) return paymentDto(known);
  const now = new Date();
  if (known.status === 'INITIATING' && now - known.createdAt < LEASE_MS) return paymentDto(known);
  const candidate = known.checkoutRequestId ?? known.rawCallback?.checkoutRequestId;
  if (!candidate) {
    const count = known.reconcileCount + 1;
    const payment = await prisma.mpesaPayment.update({ where: { id }, data: {
      status: 'UNKNOWN', lastErrorCode: 'PROVIDER_REFERENCE_PENDING',
      reconcileCount: { increment: 1 },
      nextReconcileAt: count >= MAX_AUTOMATIC_CHECKS ? null : new Date(now.getTime() + 300_000),
    } });
    return paymentDto(payment);
  }
  if (known.nextReconcileAt && known.nextReconcileAt > now) return paymentDto(known);
  const lease = randomUUID();
  const claimed = await prisma.mpesaPayment.updateMany({
    where: { id, confirmedAt: null, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] },
    data: { reconcileLease: lease, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), reconcileCount: { increment: 1 }, nextReconcileAt: new Date(now.getTime() + 10_000) },
  });
  if (!claimed.count) return paymentDto(await prisma.mpesaPayment.findUnique({ where: { id } }));
  let result;
  try {
    result = await provider.query(configForAttempt(known), candidate);
  } catch (error) {
    const code = error instanceof DarajaError || error.statusCode ? error.code : 'PAYMENT_QUERY_ERROR';
    const count = known.reconcileCount + 1;
    await transaction(async (db) => {
      await lockOrder(db, known.orderId);
      const current = await db.mpesaPayment.findUnique({ where: { id } });
      if (current.reconcileLease !== lease || current.confirmedAt) return;
      await db.mpesaPayment.update({ where: { id }, data: {
        reconcileLease: null, leaseExpiresAt: null,
        status: current.reviewCode ? 'REVIEW' : 'UNKNOWN', lastErrorCode: code,
        nextReconcileAt: new Date(Date.now() + Math.min(300_000, RETRY_DELAY * 2 ** Math.min(count, 4))),
      } });
    });
    console.warn('M-Pesa reconciliation remains unresolved', { paymentId: id, code });
    return paymentDto(await prisma.mpesaPayment.findUnique({ where: { id } }));
  }
  try {
    const payment = await transaction(async (db) => {
      await lockOrder(db, known.orderId);
      return finishQuery(db, await db.mpesaPayment.findUnique({ where: { id } }), result, lease);
    });
    return paymentDto(payment);
  } catch (error) {
    // A receipt conflict must not be mistaken for a second confirmed payment.
    const code = error.code === 'P2002' ? 'RECEIPT_CONFLICT' : 'PAYMENT_WRITE_FAILED';
    try {
      await prisma.mpesaPayment.updateMany({ where: { id, reconcileLease: lease, confirmedAt: null }, data: {
        reconcileLease: null, leaseExpiresAt: null, lastErrorCode: code,
        ...(error.code === 'P2002' && { status: 'REVIEW', reviewCode: code }),
        nextReconcileAt: new Date(Date.now() + RETRY_DELAY),
      } });
    } catch { console.error('M-Pesa verification result requires persistence recovery', { paymentId: id }); }
    throw paymentError(503, code, 'Payment verification could not be saved. Check this attempt again; do not initiate another payment.');
  }
}

export async function reconcileDuePayments() {
  if (process.env.ENABLE_MPESA !== 'true') return;
  const due = await prisma.mpesaPayment.findMany({
    where: {
      orderId: { not: null }, confirmedAt: null, status: { in: ['INITIATING', 'PENDING', 'UNKNOWN', 'REVIEW'] },
      nextReconcileAt: { lte: new Date() }, reconcileCount: { lt: MAX_AUTOMATIC_CHECKS },
    },
    select: { id: true }, orderBy: { nextReconcileAt: 'asc' }, take: 5,
  });
  for (const payment of due) {
    try { await reconcilePayment(payment.id, { automatic: true }); }
    catch (error) { console.error('M-Pesa reconciliation job could not finish', { paymentId: payment.id, code: error.code ?? 'PAYMENT_JOB_ERROR' }); }
  }
}

export default { reconcileDuePayments };
