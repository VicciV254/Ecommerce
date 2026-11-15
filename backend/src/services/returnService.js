import { createHash } from 'node:crypto';
import prisma from '../config/database.js';
import { checkoutPolicy } from '../config/checkoutPolicy.js';
import { returnPolicy, reasonAllowed, allowedReasons } from '../config/returnPolicy.js';
import { httpError } from './catalogService.js';
import { customerOrderWhere, lockOrderInventory, orderTransaction, restockReturnedItems } from './inventoryService.js';
import { dispatchNotifications, enqueueNotification } from './notificationService.js';
import { ACTIVE_REFUND_STATUSES, createRefundInTransaction } from './refundService.js';
import { Decimal, decimal, moneyNumber, sumMoney } from '../utils/money.js';
import { orderInclude } from '../utils/orderDto.js';

const DAY_MS = 86_400_000;
const COUNTED_STATUSES = ['REQUESTED', 'APPROVED', 'RECEIVED'];
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** The rule recorded at purchase; orders created before return snapshots use STANDARD. */
export const itemReturnRule = (item) => item.pricingSnapshot?.returnRule ?? 'STANDARD';

function windowFor(order, policy) {
  const windowDays = order.pricingSnapshot?.returnPolicy?.windowDays ?? policy.windowDays;
  return { windowDays, endsAt: order.deliveredAt ? new Date(order.deliveredAt.getTime() + windowDays * DAY_MS) : null };
}

function claimedQuantities(order) {
  const claimed = new Map();
  for (const request of order.returnRequests ?? []) {
    if (!COUNTED_STATUSES.includes(request.status)) continue;
    for (const line of request.lines ?? []) {
      const quantity = request.status === 'RECEIVED' ? line.receivedQuantity ?? 0 : line.quantity;
      claimed.set(line.orderItemId, (claimed.get(line.orderItemId) ?? 0) + quantity);
    }
  }
  return claimed;
}

/** Customer-visible eligibility from the order snapshot, delivery time and earlier requests. */
export function returnEligibility(order, now = new Date(), policy = returnPolicy()) {
  const { windowDays, endsAt } = windowFor(order, policy);
  const terms = {
    windowDays, deliveryFeeRefund: order.pricingSnapshot?.returnPolicy?.deliveryFeeRefund ?? policy.deliveryFeeRefund,
    refundRounding: policy.refundRounding, resolutions: policy.resolutions, refundMethod: policy.refundMethod,
  };
  const claimed = claimedQuantities(order);
  const lines = (order.items ?? []).map((item) => {
    const rule = itemReturnRule(item);
    return {
      orderItemId: item.id, productName: item.productName, purchased: item.quantity,
      requested: claimed.get(item.id) ?? 0, returnableQuantity: Math.max(0, item.quantity - (claimed.get(item.id) ?? 0)),
      returnRule: rule, allowedReasons: allowedReasons(rule),
    };
  });
  let reasonCode = null;
  if (order.status !== 'DELIVERED' || !order.deliveredAt) reasonCode = 'NOT_DELIVERED';
  else if (!['PAID', 'PARTIALLY_REFUNDED'].includes(order.paymentStatus)) reasonCode = 'NOT_PAID';
  else if (now > endsAt) reasonCode = 'WINDOW_CLOSED';
  else if (!lines.some((line) => line.returnableQuantity > 0)) reasonCode = 'NOTHING_RETURNABLE';
  return {
    eligible: reasonCode === null, reasonCode, windowEndsAt: endsAt?.toISOString() ?? null, policy: terms,
    lines: reasonCode === null ? lines : lines.map((line) => ({ ...line, returnableQuantity: 0 })),
  };
}

const ELIGIBILITY_ERRORS = {
  NOT_DELIVERED: [409, 'Returns open after the order is delivered or collected.'],
  NOT_PAID: [409, 'There is no paid amount left to return on this order.'],
  WINDOW_CLOSED: [409, 'The return window for this order has closed.', 'RETURN_WINDOW_CLOSED'],
  NOTHING_RETURNABLE: [409, 'Every item on this order already has a return request.'],
};

async function nextReturnNumber(db, order) {
  return `RMA-${order.orderNumber}-${await db.returnRequest.count({ where: { orderId: order.id } }) + 1}`;
}

const trackingEvent = (order, description, actor, reason = null) => ({
  orderId: order.id, status: order.status, description, location: actor.type === 'STAFF' ? 'Staff portal' : 'Customer self-service',
  actorType: actor.type, actorId: actor.id ?? null, reason,
});

/** Creates or replays one customer return request for selected items. */
export async function requestReturn(userId, orderId, input, idempotencyKey) {
  const requestHash = fingerprint({ orderId, ...input, lines: [...input.lines].sort((a, b) => a.orderItemId.localeCompare(b.orderItemId)) });
  const replay = async () => {
    const existing = await prisma.returnRequest.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
    if (!existing) return null;
    if (existing.requestHash !== requestHash) throw httpError(409, 'This request key was already used with different contents.', 'IDEMPOTENCY_CONFLICT');
    return { returnRequest: existing, created: false };
  };
  const previous = await replay();
  if (previous) return previous;
  let notificationIds = [];
  try {
    const result = await orderTransaction(async (db) => {
      await lockOrderInventory(db, orderId);
      const order = await db.order.findFirst({ where: { id: orderId, userId, ...customerOrderWhere() }, include: orderInclude });
      if (!order) throw httpError(404, 'Order not found', 'ORDER_NOT_FOUND');
      const eligibility = returnEligibility(order);
      if (!eligibility.eligible) {
        const [status, message, code] = ELIGIBILITY_ERRORS[eligibility.reasonCode];
        throw httpError(status, message, code ?? 'RETURN_NOT_ELIGIBLE');
      }
      const available = new Map(eligibility.lines.map((line) => [line.orderItemId, line]));
      const lines = input.lines.map((line) => {
        const option = available.get(line.orderItemId);
        if (!option) throw httpError(400, 'Choose items from this order.', 'RETURN_QUANTITY_INVALID');
        if (line.quantity > option.returnableQuantity) {
          throw httpError(409, `Only ${option.returnableQuantity} of ${option.productName} can be returned.`, 'RETURN_QUANTITY_INVALID');
        }
        if (!reasonAllowed(option.returnRule, input.reason, input.unopenedDeclared)) {
          throw httpError(409, option.returnRule === 'FAULT_ONLY'
            ? `${option.productName} can be returned only if it is faulty, damaged or wrong.`
            : `${option.productName} can be returned for this reason only if it is unopened.`, 'RETURN_REASON_NOT_ALLOWED');
        }
        return { orderItemId: line.orderItemId, quantity: line.quantity, returnRule: option.returnRule };
      });
      const actor = { type: 'CUSTOMER', id: userId };
      const created = await db.returnRequest.create({
        data: {
          number: await nextReturnNumber(db, order), orderId: order.id, userId, reason: input.reason,
          comment: input.comment ?? null, unopenedDeclared: input.unopenedDeclared, idempotencyKey, requestHash,
          lines: { create: lines },
        },
      });
      await db.trackingEvent.create({ data: trackingEvent(order, `Return ${created.number} requested; awaiting review.`, actor) });
      const notification = await enqueueNotification(db, {
        type: 'RETURN_REQUESTED', order, returnRequestId: created.id, dedupeKey: `return-requested:${created.id}`,
      });
      notificationIds = notification ? [notification.id] : [];
      return { returnRequest: created, created: true };
    });
    await dispatchNotifications(notificationIds);
    return result;
  } catch (error) {
    if (error.code === 'P2002') {
      const replayed = await replay();
      if (replayed) return replayed;
    }
    throw error;
  }
}

async function lockReturn(db, returnId, where = {}) {
  const located = await db.returnRequest.findFirst({ where: { id: returnId, order: { is: customerOrderWhere() }, ...where }, select: { orderId: true } });
  if (!located) throw httpError(404, 'Return request not found.', 'RETURN_NOT_FOUND');
  await lockOrderInventory(db, located.orderId);
  return db.returnRequest.findUnique({ where: { id: returnId }, include: { lines: { include: { orderItem: true } } } });
}

export async function cancelReturn(userId, orderId, returnId) {
  return orderTransaction(async (db) => {
    const request = await lockReturn(db, returnId, { orderId, userId });
    if (request.status !== 'REQUESTED') throw httpError(409, 'Only a return awaiting review can be withdrawn.', 'RETURN_CHANGED');
    const order = await db.order.findUnique({ where: { id: request.orderId } });
    await db.trackingEvent.create({ data: trackingEvent(order, `Return ${request.number} withdrawn by the customer.`, { type: 'CUSTOMER', id: userId }) });
    return db.returnRequest.update({ where: { id: returnId }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
  });
}

export async function decideReturn(returnId, { decision, expectedStatus, note }, actor) {
  let notificationIds = [];
  const result = await orderTransaction(async (db) => {
    const request = await lockReturn(db, returnId);
    if (request.status !== expectedStatus || request.status !== 'REQUESTED') throw httpError(409, 'This return changed. Reload it before acting.', 'RETURN_CHANGED');
    if (decision === 'REJECT' && !note) throw httpError(400, 'Explain why the return is not approved.', 'REASON_REQUIRED');
    const approved = decision === 'APPROVE';
    const updated = await db.returnRequest.update({ where: { id: returnId }, data: {
      status: approved ? 'APPROVED' : 'REJECTED', decidedAt: new Date(), decidedById: actor.id, decisionNote: note ?? null,
    } });
    const order = await db.order.findUnique({ where: { id: request.orderId }, include: { user: { select: { email: true } } } });
    await db.trackingEvent.create({ data: trackingEvent(order, approved
      ? `Return ${request.number} approved; staff will arrange the return.`
      : `Return ${request.number} was not approved.`, actor, note ?? null) });
    const notification = await enqueueNotification(db, {
      type: approved ? 'RETURN_APPROVED' : 'RETURN_REJECTED', order, returnRequestId: returnId, dedupeKey: `return-decision:${returnId}`,
    });
    notificationIds = notification ? [notification.id] : [];
    return updated;
  });
  await dispatchNotifications(notificationIds);
  return result;
}

/** Refund value for inspected lines: discounted units plus VAT, optional delivery fee, rounded up to whole KES. */
export function returnRefundAmount(order, receivedLines, { includeDeliveryFee }) {
  const vatRate = decimal(order.pricingSnapshot?.vatRate ?? checkoutPolicy().vatRate);
  const merchandise = sumMoney(receivedLines.map(({ item, refundableQuantity }) => {
    const lineTotal = decimal(item.pricingSnapshot?.total ?? item.subtotal);
    return lineTotal.div(item.quantity).mul(refundableQuantity);
  }));
  const value = merchandise.plus(merchandise.mul(vatRate).div(100)).plus(includeDeliveryFee ? decimal(order.shippingCost) : 0);
  return value.toDecimalPlaces(0, Decimal.ROUND_UP);
}

/**
 * Refund owed for inspected return lines under the order's snapshot terms. The delivery fee is
 * included at most once per order and only as the policy allows.
 */
export async function returnRefundTerms(db, order, received, merchantFaultConfirmed) {
  const feeRule = order.pricingSnapshot?.returnPolicy?.deliveryFeeRefund ?? returnPolicy().deliveryFeeRefund;
  const anyRefundable = received.some((entry) => entry.refundableQuantity > 0);
  const feeAlreadyRefunded = await db.refund.count({
    where: { orderId: order.id, includesDeliveryFee: true, status: { in: ACTIVE_REFUND_STATUSES } },
  });
  const includeDeliveryFee = anyRefundable && !feeAlreadyRefunded &&
    (feeRule === 'ALWAYS' || (feeRule === 'MERCHANT_FAULT_ONLY' && merchantFaultConfirmed === true));
  return { includeDeliveryFee, amount: returnRefundAmount(order, received, { includeDeliveryFee }) };
}

export async function receiveReturn(returnId, { expectedStatus, merchantFaultConfirmed, note, lines }, actor) {
  let notificationIds = [];
  const result = await orderTransaction(async (db) => {
    const request = await lockReturn(db, returnId);
    if (request.status !== expectedStatus || request.status !== 'APPROVED') throw httpError(409, 'This return changed. Reload it before acting.', 'RETURN_CHANGED');
    const inputs = new Map(lines.map((line) => [line.returnLineId, line]));
    if (inputs.size !== lines.length || inputs.size !== request.lines.length || request.lines.some((line) => !inputs.has(line.id))) {
      throw httpError(400, 'Record every line on this return exactly once.', 'RETURN_QUANTITY_INVALID');
    }
    const received = request.lines.map((line) => {
      const value = inputs.get(line.id);
      if (value.receivedQuantity > line.quantity || value.restockQuantity > value.receivedQuantity || value.refundableQuantity > value.receivedQuantity) {
        throw httpError(400, 'Received, restocked and refunded quantities must fit the request.', 'RETURN_QUANTITY_INVALID');
      }
      if (line.returnRule === 'FAULT_ONLY' && !merchantFaultConfirmed && value.refundableQuantity > 0) {
        throw httpError(409, `${line.orderItem.productName} is refundable only when a fault, damage or wrong item is confirmed.`, 'RETURN_REASON_NOT_ALLOWED');
      }
      return { line, item: line.orderItem, ...value };
    });
    for (const entry of received) {
      await db.returnLine.update({ where: { id: entry.line.id }, data: {
        receivedQuantity: entry.receivedQuantity, restockQuantity: entry.restockQuantity, refundableQuantity: entry.refundableQuantity,
      } });
    }
    await restockReturnedItems(db, received.map(({ item, restockQuantity }) => ({
      variantId: item.variantId, productId: item.productId, quantity: restockQuantity,
    })));
    const order = await db.order.findUnique({ where: { id: request.orderId }, include: { user: { select: { email: true } } } });
    const { amount, includeDeliveryFee } = await returnRefundTerms(db, order, received, merchantFaultConfirmed);
    const refund = amount.greaterThan(0) ? await createRefundInTransaction(db, order, {
      source: 'RETURN', amount, returnRequestId: request.id, includesDeliveryFee: includeDeliveryFee, actor,
      reason: note ?? null, dedupeKey: `return:${request.id}`,
    }) : null;
    const updated = await db.returnRequest.update({ where: { id: returnId }, data: {
      status: 'RECEIVED', receivedAt: new Date(), receivedById: actor.id, merchantFaultConfirmed, inspectionNote: note ?? null,
    } });
    await db.trackingEvent.create({ data: trackingEvent(order, refund
      ? `Return ${request.number} received and inspected; refund of KES ${moneyNumber(refund.amount).toLocaleString('en-KE')} requested.`
      : `Return ${request.number} received and inspected; no refund is due.`, actor, note ?? null) });
    const notification = await enqueueNotification(db, {
      type: 'RETURN_RECEIVED', order, returnRequestId: returnId, refundId: refund?.id ?? null, dedupeKey: `return-received:${returnId}`,
    });
    notificationIds = notification ? [notification.id] : [];
    return { returnRequest: updated, refund };
  });
  await dispatchNotifications(notificationIds);
  return result;
}

export function returnDto(request, staff = false) {
  const base = {
    id: request.id, number: request.number, status: request.status, reason: request.reason, comment: request.comment,
    unopenedDeclared: request.unopenedDeclared, requestedAt: request.createdAt.toISOString(),
    decidedAt: request.decidedAt?.toISOString() ?? null, decisionNote: request.decisionNote,
    receivedAt: request.receivedAt?.toISOString() ?? null, merchantFaultConfirmed: request.merchantFaultConfirmed,
    inspectionNote: request.inspectionNote,
    lines: (request.lines ?? []).map((line) => ({
      id: line.id, orderItemId: line.orderItemId, quantity: line.quantity, returnRule: line.returnRule,
      receivedQuantity: line.receivedQuantity, refundableQuantity: line.refundableQuantity,
      ...(line.orderItem && { productName: line.orderItem.productName, purchased: line.orderItem.quantity }),
      ...(staff && { restockQuantity: line.restockQuantity }),
    })),
  };
  return staff ? { ...base, orderId: request.orderId, updatedAt: request.updatedAt.toISOString() } : base;
}

export async function listReturns({ status, page = 1, limit = 20 }) {
  const where = { ...(status && { status }), order: { is: customerOrderWhere() } };
  const [requests, total] = await Promise.all([
    prisma.returnRequest.findMany({
      where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
      include: { lines: { include: { orderItem: { select: { productName: true, quantity: true } } } }, order: { select: { orderNumber: true, isDemo: true } } },
    }),
    prisma.returnRequest.count({ where }),
  ]);
  return {
    returns: requests.map((request) => ({ ...returnDto(request, true), orderNumber: request.order.orderNumber, isDemo: request.order.isDemo })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}
