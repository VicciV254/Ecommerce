import prisma from '../config/database.js';
import { customerOrderWhere } from './inventoryService.js';
import { openPaymentReviews } from './refundService.js';

const LIMIT = 50;
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };
const REFUND_SEVERITY = { FAILED: 'high', UNRESOLVED: 'high', REQUESTED: 'medium', APPROVED: 'medium', PROCESSING: 'medium' };

/*
 * What counts as open work, shared by this feed and the dashboard's current counts (which add their own scope).
 * The order steps are the staff Orders queues ("Needs action"), as `GET /orders/admin/all` filters them.
 */
export const ORDER_STEP_FILTERS = Object.freeze({
  awaitingStart: { status: 'PENDING', paymentStatus: 'PAID' },
  processing: { status: 'PROCESSING' },
  readyForPickup: { status: 'READY_FOR_PICKUP' },
  dispatched: { status: 'SHIPPED' },
});
/** Returns waiting for a staff decision (REQUESTED) or for the goods to arrive (APPROVED). */
export const OPEN_RETURN_STATUSES = Object.freeze(['REQUESTED', 'APPROVED']);
/** Refunds not yet confirmed as sent or cancelled. */
export const OPEN_REFUND_STATUSES = Object.freeze(Object.keys(REFUND_SEVERITY));

/** Payments under review in `orderScope` whose order has no confirmed refund settling the review, oldest first. */
export async function paymentsNeedingReview(orderScope, { take } = {}) {
  const reviewed = await prisma.mpesaPayment.findMany({
    where: { reviewCode: { not: null }, status: { not: 'FAILED' }, order: { is: orderScope } },
    select: { id: true, orderId: true, reviewCode: true, updatedAt: true, order: { select: { orderNumber: true } } },
    orderBy: { updatedAt: 'asc' }, ...(take !== undefined && { take }),
  });
  const open = await openPaymentReviews(prisma, [...new Set(reviewed.map((payment) => payment.orderId))]);
  return reviewed.filter((payment) => open.has(payment.orderId));
}

/**
 * Derived from canonical records each time; read state is per staff member and never
 * resolves the underlying order, payment, return, refund or message.
 */
export async function attentionItems(adminId) {
  const orderScope = customerOrderWhere();
  const [awaiting, reviewed, returns, refunds, messages, reads] = await Promise.all([
    prisma.order.findMany({
      where: { ...orderScope, ...ORDER_STEP_FILTERS.awaitingStart, reservationStatus: 'COMMITTED' },
      select: { id: true, orderNumber: true, updatedAt: true }, orderBy: { updatedAt: 'asc' }, take: LIMIT,
    }),
    paymentsNeedingReview(orderScope, { take: LIMIT }),
    prisma.returnRequest.findMany({
      where: { status: { in: OPEN_RETURN_STATUSES }, order: { is: orderScope } },
      select: { id: true, number: true, status: true, orderId: true, updatedAt: true, order: { select: { orderNumber: true } } },
      orderBy: { updatedAt: 'asc' }, take: LIMIT,
    }),
    prisma.refund.findMany({
      where: { status: { in: OPEN_REFUND_STATUSES }, order: { is: orderScope } },
      select: { id: true, number: true, status: true, amount: true, orderId: true, updatedAt: true, order: { select: { orderNumber: true } } },
      orderBy: { updatedAt: 'asc' }, take: LIMIT,
    }),
    prisma.notification.findMany({
      where: { status: { in: ['FAILED', 'DEAD'] } },
      select: { id: true, type: true, status: true, attempts: true, lastErrorCode: true, orderId: true, updatedAt: true },
      orderBy: { updatedAt: 'asc' }, take: LIMIT,
    }),
    prisma.staffAlertRead.findMany({ where: { adminId }, select: { alertKey: true } }),
  ]);
  const orderNumbers = new Map((await prisma.order.findMany({
    where: { id: { in: [...new Set(messages.map((message) => message.orderId).filter(Boolean))] }, ...orderScope },
    select: { id: true, orderNumber: true },
  })).map((order) => [order.id, order.orderNumber]));
  const read = new Set(reads.map((entry) => entry.alertKey));
  const items = [
    ...awaiting.map((order) => ({
      key: `order-fulfil:${order.id}`, type: 'ORDER_AWAITING_FULFILMENT', severity: 'medium',
      title: `Order ${order.orderNumber} is paid and awaiting preparation`, detail: 'Start processing when stock is ready.',
      orderId: order.id, orderNumber: order.orderNumber, entityId: order.id, since: order.updatedAt,
    })),
    ...reviewed.map((payment) => ({
      key: `payment-review:${payment.id}:${payment.reviewCode}`, type: 'PAYMENT_REVIEW', severity: 'high',
      title: `Payment on ${payment.order.orderNumber} needs review`, detail: `Review reason: ${payment.reviewCode}.`,
      orderId: payment.orderId, orderNumber: payment.order.orderNumber, entityId: payment.id, since: payment.updatedAt,
    })),
    ...returns.map((request) => ({
      key: `return:${request.id}:${request.status}`,
      type: request.status === 'REQUESTED' ? 'RETURN_AWAITING_DECISION' : 'RETURN_AWAITING_RECEIPT',
      severity: request.status === 'REQUESTED' ? 'medium' : 'low',
      title: request.status === 'REQUESTED' ? `Return ${request.number} awaits a decision` : `Return ${request.number} awaits receipt`,
      detail: request.status === 'REQUESTED' ? 'Approve or decline the request.' : 'Record received quantities and inspection.',
      orderId: request.orderId, orderNumber: request.order.orderNumber, entityId: request.id, since: request.updatedAt,
    })),
    ...refunds.map((refund) => ({
      key: `refund:${refund.id}:${refund.status}`, type: 'REFUND_ACTION', severity: REFUND_SEVERITY[refund.status],
      title: `Refund ${refund.number} is ${refund.status.toLowerCase()}`,
      detail: refund.status === 'FAILED' || refund.status === 'UNRESOLVED'
        ? 'Confirm whether money was sent before taking another action.' : 'Continue the refund; approval alone does not send money.',
      orderId: refund.orderId, orderNumber: refund.order.orderNumber, entityId: refund.id, since: refund.updatedAt,
    })),
    ...messages.filter((message) => !message.orderId || orderNumbers.has(message.orderId)).map((message) => ({
      key: `notification:${message.id}:${message.status}:${message.attempts}`, type: 'NOTIFICATION_FAILED',
      severity: message.status === 'DEAD' ? 'high' : 'low',
      title: `${message.type.replaceAll('_', ' ').toLowerCase()} email ${message.status === 'DEAD' ? 'stopped retrying' : 'failed'}`,
      detail: `Last error: ${message.lastErrorCode ?? 'unknown'}.`, orderId: message.orderId,
      orderNumber: orderNumbers.get(message.orderId) ?? null, entityId: message.id, since: message.updatedAt,
    })),
  ];
  return items
    .map((item) => ({ ...item, since: item.since.toISOString(), read: read.has(item.key) }))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.since.localeCompare(b.since));
}

export async function markAttentionRead(adminId, keys) {
  await prisma.$transaction(keys.map((alertKey) => prisma.staffAlertRead.upsert({
    where: { adminId_alertKey: { adminId, alertKey } }, create: { adminId, alertKey }, update: { readAt: new Date() },
  })));
  return { read: keys.length };
}
