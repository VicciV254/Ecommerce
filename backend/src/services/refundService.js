import prisma from '../config/database.js';
import { httpError } from './catalogService.js';
import { customerOrderWhere, lockOrderInventory, orderTransaction } from './inventoryService.js';
import { dispatchNotifications, enqueueNotification } from './notificationService.js';
import { Decimal, decimal, moneyNumber, sumMoney } from '../utils/money.js';

/** Every status that can still lead to money being sent; only CANCELLED releases the reserved balance. */
export const ACTIVE_REFUND_STATUSES = ['REQUESTED', 'APPROVED', 'PROCESSING', 'FAILED', 'UNRESOLVED', 'CONFIRMED'];
/** Payment states in which the order's money was received; refunds are capped by what remains. */
export const SETTLED_PAYMENT_STATUSES = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'];
const REFERENCE = /^[A-Z0-9]{8,32}$/;

const formatKes = (amount) => `KES ${moneyNumber(amount).toLocaleString('en-KE')}`;
const tracking = (order, description, actor, reason = null) => ({
  status: order.status, description, location: actor.type === 'STAFF' ? 'Staff portal' : 'Refund service',
  actorType: actor.type, actorId: actor.id ?? null, reason,
});

/** Refunds against the order's settled payment share one pool; other confirmed payments have their own. */
export function inOrderPool(order, refund) {
  return refund.source !== 'PAYMENT_REVIEW' || (order.settledPaymentId && refund.paymentId === order.settledPaymentId);
}

export async function refundBalance(db, order, paymentId = null) {
  const refunds = await db.refund.findMany({ where: { orderId: order.id, status: { in: ACTIVE_REFUND_STATUSES } } });
  if (!paymentId || paymentId === order.settledPaymentId) {
    const paid = SETTLED_PAYMENT_STATUSES.includes(order.paymentStatus) ? decimal(order.total) : decimal(0);
    return paid.minus(sumMoney(refunds.filter((refund) => inOrderPool(order, refund)).map((refund) => refund.amount)));
  }
  const payment = await db.mpesaPayment.findFirst({ where: { id: paymentId, orderId: order.id, confirmedAt: { not: null } } });
  if (!payment) return decimal(0);
  return decimal(payment.amount).minus(sumMoney(refunds.filter((refund) => refund.paymentId === paymentId).map((refund) => refund.amount)));
}

async function nextRefundNumber(db, order) {
  const count = await db.refund.count({ where: { orderId: order.id } });
  return `RF-${order.orderNumber}-${count + 1}`;
}

/**
 * Creates a REQUESTED refund inside the caller's order-locked transaction.
 * The amount is whole KES, capped at the pool's remaining refundable balance.
 */
export async function createRefundInTransaction(db, order, {
  source, amount, paymentId = null, returnRequestId = null, includesDeliveryFee = false, actor, reason = null, dedupeKey,
}) {
  const balance = await refundBalance(db, order, source === 'PAYMENT_REVIEW' ? paymentId : null);
  const requested = decimal(amount).toDecimalPlaces(0, Decimal.ROUND_UP);
  const value = requested.greaterThan(balance) ? balance.toDecimalPlaces(0, Decimal.ROUND_DOWN) : requested;
  if (value.lessThanOrEqualTo(0)) return null;
  if (includesDeliveryFee && await db.refund.count({
    where: { orderId: order.id, includesDeliveryFee: true, status: { in: ACTIVE_REFUND_STATUSES } },
  })) includesDeliveryFee = false;
  const refund = await db.refund.create({ data: {
    number: await nextRefundNumber(db, order), orderId: order.id,
    paymentId: paymentId ?? order.settledPaymentId ?? null, returnRequestId, dedupeKey, source,
    amount: value, requestedAmount: value, includesDeliveryFee, reason,
    requestedByType: actor.type, requestedById: actor.id ?? null,
  } });
  await db.trackingEvent.create({ data: {
    orderId: order.id, ...tracking(order, `Refund ${refund.number} of ${formatKes(value)} requested; no money has been sent yet.`, actor, reason),
  } });
  return refund;
}

const TRANSITIONS = {
  approve: { from: ['REQUESTED'], to: 'APPROVED' },
  start: { from: ['APPROVED'], to: 'PROCESSING' },
  confirm: { from: ['PROCESSING', 'UNRESOLVED'], to: 'CONFIRMED' },
  fail: { from: ['PROCESSING', 'UNRESOLVED'], to: 'FAILED' },
  unresolved: { from: ['PROCESSING'], to: 'UNRESOLVED' },
  retry: { from: ['FAILED'], to: 'APPROVED' },
  cancel: { from: ['REQUESTED', 'APPROVED', 'FAILED'], to: 'CANCELLED' },
};
export const REFUND_ACTIONS = Object.keys(TRANSITIONS);

export function allowedRefundActions(refund) {
  return REFUND_ACTIONS.filter((action) => TRANSITIONS[action].from.includes(refund.status));
}

async function updateOrderPaymentStatus(db, order) {
  if (!SETTLED_PAYMENT_STATUSES.includes(order.paymentStatus)) return;
  const confirmed = await db.refund.findMany({ where: { orderId: order.id, status: 'CONFIRMED' } });
  const refunded = sumMoney(confirmed.filter((refund) => inOrderPool(order, refund)).map((refund) => refund.amount));
  const paymentStatus = refunded.greaterThanOrEqualTo(order.total) ? 'REFUNDED' : refunded.greaterThan(0) ? 'PARTIALLY_REFUNDED' : 'PAID';
  if (paymentStatus !== order.paymentStatus) await db.order.update({ where: { id: order.id }, data: { paymentStatus } });
}

/** Applies one staff refund transition with stale-state protection; approval never claims money moved. */
export async function transitionRefund(refundId, action, input, actor) {
  const rule = Object.hasOwn(TRANSITIONS, action) ? TRANSITIONS[action] : null;
  if (!rule) throw httpError(404, 'Unknown refund action.', 'REFUND_ACTION_UNKNOWN');
  const notifications = [];
  const refund = await orderTransaction(async (db) => {
    const located = await db.refund.findFirst({ where: { id: refundId, order: { is: customerOrderWhere() } }, select: { orderId: true } });
    if (!located) throw httpError(404, 'Refund not found.', 'REFUND_NOT_FOUND');
    await lockOrderInventory(db, located.orderId);
    const current = await db.refund.findUnique({ where: { id: refundId } });
    const order = await db.order.findUnique({ where: { id: current.orderId }, include: { user: { select: { email: true } } } });
    if (current.status !== input.expectedStatus) throw httpError(409, 'This refund changed. Reload it before acting.', 'REFUND_CHANGED');
    if (!rule.from.includes(current.status)) throw httpError(409, 'That refund action is not allowed now.', 'REFUND_ACTION_NOT_ALLOWED');
    const now = new Date();
    const data = { status: rule.to };
    let description;
    if (action === 'approve') {
      const amount = input.amount === undefined ? decimal(current.requestedAmount) : decimal(input.amount);
      if (!amount.isInteger() || amount.lessThanOrEqualTo(0) || amount.greaterThan(current.requestedAmount)) {
        throw httpError(400, 'Approve a whole-KES amount no higher than the requested refund.', 'REFUND_AMOUNT_INVALID');
      }
      if (amount.lessThan(current.requestedAmount) && !input.reason) throw httpError(400, 'Explain why the refund is lower than requested.', 'REFUND_REASON_REQUIRED');
      Object.assign(data, { amount, approvedAt: now, approvedById: actor.id, reason: input.reason ?? current.reason });
      description = `Refund ${current.number} of ${formatKes(amount)} approved; it has not been sent yet.`;
    } else if (action === 'start') {
      Object.assign(data, { processingAt: now, processingById: actor.id });
      description = `Refund ${current.number} is being sent by M-Pesa.`;
    } else if (action === 'confirm') {
      const reference = String(input.providerReference ?? '').trim().toUpperCase();
      if (!REFERENCE.test(reference)) throw httpError(400, 'Enter the M-Pesa transaction reference for the refund.', 'REFUND_REFERENCE_INVALID');
      Object.assign(data, { providerReference: reference, confirmedAt: now, confirmedById: actor.id });
      description = `Refund ${current.number} of ${formatKes(current.amount)} sent by M-Pesa (reference ${reference}).`;
    } else if (action === 'fail') {
      if (!input.reason) throw httpError(400, 'Record why the refund failed.', 'REFUND_REASON_REQUIRED');
      Object.assign(data, { failedAt: now, failureReason: input.reason });
      description = `Refund ${current.number} could not be sent; staff will follow up.`;
    } else if (action === 'unresolved') {
      if (!input.reason) throw httpError(400, 'Record what is uncertain about this refund.', 'REFUND_REASON_REQUIRED');
      Object.assign(data, { unresolvedAt: now, unresolvedNote: input.reason });
      description = `Refund ${current.number} outcome is being verified.`;
    } else if (action === 'retry') {
      Object.assign(data, { processingAt: null, processingById: null });
      description = `Refund ${current.number} is ready to be sent again.`;
    } else {
      if (!input.reason) throw httpError(400, 'Record why the refund is cancelled.', 'REFUND_REASON_REQUIRED');
      Object.assign(data, { cancelledAt: now, cancelledById: actor.id, cancellationReason: input.reason, dedupeKey: null });
      description = `Refund ${current.number} was withdrawn.`;
    }
    let updated;
    try {
      updated = await db.refund.update({ where: { id: current.id }, data });
    } catch (error) {
      if (error.code === 'P2002') throw httpError(409, 'That M-Pesa reference is already recorded on another refund.', 'REFUND_REFERENCE_IN_USE');
      throw error;
    }
    await db.trackingEvent.create({ data: { orderId: order.id, ...tracking(order, description, actor, input.reason ?? null) } });
    if (action === 'confirm') {
      await updateOrderPaymentStatus(db, order);
      const message = await enqueueNotification(db, { type: 'REFUND_CONFIRMED', order, refundId: current.id, dedupeKey: `refund-confirmed:${current.id}` });
      if (message) notifications.push(message.id);
    }
    return updated;
  });
  await dispatchNotifications(notifications);
  return refund;
}

/** Staff create a refund for money verified on a payment that is under review. */
export async function createPaymentReviewRefund(paymentId, reason, actor) {
  return orderTransaction(async (db) => {
    const located = await db.mpesaPayment.findFirst({ where: { id: paymentId, order: { is: customerOrderWhere() } }, select: { orderId: true } });
    if (!located?.orderId) throw httpError(404, 'Payment not found.', 'PAYMENT_NOT_FOUND');
    await lockOrderInventory(db, located.orderId);
    const payment = await db.mpesaPayment.findUnique({ where: { id: paymentId } });
    if (!payment.confirmedAt || !payment.reviewCode) {
      throw httpError(409, 'Only verified money on a payment under review can be refunded here.', 'PAYMENT_NOT_REFUNDABLE');
    }
    const order = await db.order.findUnique({ where: { id: payment.orderId } });
    const refund = await createRefundInTransaction(db, order, {
      source: 'PAYMENT_REVIEW', amount: payment.amount, paymentId, actor, reason, dedupeKey: `payment:${paymentId}`,
    }).catch((error) => {
      if (error.code === 'P2002') throw httpError(409, 'A refund already exists for this payment.', 'REFUND_EXISTS');
      throw error;
    });
    if (!refund) throw httpError(409, 'This payment has no refundable balance left.', 'REFUND_NOT_AVAILABLE');
    return refund;
  });
}

/** Payments whose review is not yet settled by a confirmed refund block fulfilment shortcuts. */
export async function openPaymentReviews(db, orderIds) {
  if (!orderIds.length) return new Set();
  const reviewed = await db.mpesaPayment.findMany({
    where: { orderId: { in: orderIds }, reviewCode: { not: null }, status: { not: 'FAILED' } },
    select: { id: true, orderId: true },
  });
  if (!reviewed.length) return new Set();
  const covered = new Set((await db.refund.findMany({
    where: { paymentId: { in: reviewed.map((payment) => payment.id) }, status: 'CONFIRMED' }, select: { paymentId: true },
  })).map((refund) => refund.paymentId));
  return new Set(reviewed.filter((payment) => !covered.has(payment.id)).map((payment) => payment.orderId));
}

export function refundDto(refund, staff = false) {
  const base = {
    id: refund.id, number: refund.number, source: refund.source, status: refund.status,
    amount: moneyNumber(refund.amount), includesDeliveryFee: refund.includesDeliveryFee, method: refund.method,
    requestedAt: refund.createdAt.toISOString(), approvedAt: refund.approvedAt?.toISOString() ?? null,
    confirmedAt: refund.confirmedAt?.toISOString() ?? null,
    providerReference: refund.status === 'CONFIRMED' ? refund.providerReference : null,
  };
  if (!staff) return base;
  return {
    ...base, orderId: refund.orderId, paymentId: refund.paymentId, returnRequestId: refund.returnRequestId,
    requestedAmount: moneyNumber(refund.requestedAmount), reason: refund.reason,
    requestedByType: refund.requestedByType, processingAt: refund.processingAt?.toISOString() ?? null,
    failedAt: refund.failedAt?.toISOString() ?? null, failureReason: refund.failureReason,
    unresolvedAt: refund.unresolvedAt?.toISOString() ?? null, unresolvedNote: refund.unresolvedNote,
    cancelledAt: refund.cancelledAt?.toISOString() ?? null, cancellationReason: refund.cancellationReason,
    allowedActions: allowedRefundActions(refund), updatedAt: refund.updatedAt.toISOString(),
  };
}

export async function listRefunds({ status, page = 1, limit = 20 }) {
  const where = { ...(status && { status }), order: { is: customerOrderWhere() } };
  const [refunds, total] = await Promise.all([
    prisma.refund.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
      include: { order: { select: { orderNumber: true, isDemo: true } } },
    }),
    prisma.refund.count({ where }),
  ]);
  return {
    refunds: refunds.map((refund) => ({ ...refundDto(refund, true), orderNumber: refund.order.orderNumber, isDemo: refund.order.isDemo })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}
