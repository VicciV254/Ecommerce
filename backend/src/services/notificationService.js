import { randomUUID } from 'node:crypto';
import prisma from '../config/database.js';
import { returnPolicy } from '../config/returnPolicy.js';
import { sendMail } from './mailService.js';
import { customerOrderWhere } from './inventoryService.js';
import { renderNotification } from './notificationTemplates.js';
import { moneyNumber } from '../utils/money.js';

export const NOTIFICATION_TYPES = [
  'ORDER_RECEIVED', 'PAYMENT_CONFIRMED', 'ORDER_CANCELLED', 'ORDER_READY_FOR_PICKUP', 'ORDER_DISPATCHED',
  'ORDER_DELIVERED', 'ORDER_PICKED_UP', 'RETURN_REQUESTED', 'RETURN_APPROVED', 'RETURN_REJECTED',
  'RETURN_RECEIVED', 'REFUND_CONFIRMED',
];
export const MAX_NOTIFICATION_ATTEMPTS = 6;
const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000];
const LEASE_MS = 120_000;
const SAFE_CODES = new Set(['MAIL_NOT_CONFIGURED', 'MAIL_TIMEOUT', 'MAIL_PROVIDER_ERROR', 'UNKNOWN_NOTIFICATION_TYPE']);
const PERMANENT_RENDER_CODES = ['UNKNOWN_NOTIFICATION_TYPE', 'INVALID_NOTIFICATION_CONTEXT'];

/** Indirection so tests replace delivery without real SMTP/Gmail access. */
export const mailer = { send: (message) => sendMail(message) };

const demoNotificationsEnabled = () =>
  process.env.NODE_ENV !== 'production' && process.env.DEMO_NOTIFICATIONS_ENABLED === 'true';

function frontendUrl() {
  try {
    const url = new URL(process.env.FRONTEND_URL);
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : null;
  } catch { return null; }
}

/**
 * Records one customer email inside the caller's business transaction.
 * The dedupe key makes replays and retries produce at most one message per event.
 */
export async function enqueueNotification(db, { type, order, dedupeKey, returnRequestId = null, refundId = null }) {
  if (!NOTIFICATION_TYPES.includes(type)) throw Object.assign(new Error('Unknown notification type'), { code: 'UNKNOWN_NOTIFICATION_TYPE' });
  if (order.isDemo && !demoNotificationsEnabled()) return null;
  const user = order.user?.email ? order.user : await db.user.findUnique({ where: { id: order.userId }, select: { email: true } });
  if (!user?.email) return null;
  return db.notification.upsert({
    where: { dedupeKey },
    create: { type, orderId: order.id, userId: order.userId, returnRequestId, refundId, recipient: user.email, dedupeKey },
    update: {},
  });
}

async function notificationContext(notification) {
  const order = notification.orderId ? await prisma.order.findUnique({
    where: { id: notification.orderId },
    include: { items: { orderBy: { id: 'asc' } }, user: { select: { firstName: true } } },
  }) : null;
  if (!order) throw Object.assign(new Error('Notification order is unavailable'), { code: 'RENDER_ERROR' });
  const returnRequest = notification.returnRequestId ? await prisma.returnRequest.findUnique({
    where: { id: notification.returnRequestId },
    include: { lines: { include: { orderItem: { select: { productName: true } } }, orderBy: { id: 'asc' } } },
  }) : null;
  const refund = notification.refundId ? await prisma.refund.findUnique({ where: { id: notification.refundId } }) : null;
  const windowDays = order.pricingSnapshot?.returnPolicy?.windowDays ?? returnPolicy().windowDays;
  const site = frontendUrl();
  return {
    brand: { name: 'Apex Cart', siteUrl: site },
    recipient: { firstName: order.user?.firstName ?? null },
    order: {
      orderNumber: order.orderNumber, createdAt: order.createdAt.toISOString(), deliveryMethod: order.deliveryMethod,
      status: order.status, paymentStatus: order.paymentStatus,
      subtotal: moneyNumber(order.subtotal), discount: moneyNumber(order.discount), tax: moneyNumber(order.tax),
      vatRate: order.pricingSnapshot?.vatRate ?? null, shippingCost: moneyNumber(order.shippingCost), total: moneyNumber(order.total),
      trackingNumber: order.trackingNumber, reservationExpiresAt: order.reservationExpiresAt?.toISOString() ?? null,
      returnWindowEndsAt: order.deliveredAt ? new Date(order.deliveredAt.getTime() + windowDays * 86_400_000).toISOString() : null,
      items: order.items.map((item) => ({
        productName: item.productName, attributes: item.variantAttributes ?? {}, quantity: item.quantity, lineTotal: moneyNumber(item.subtotal),
      })),
    },
    ...(returnRequest && { returnRequest: {
      number: returnRequest.number, status: returnRequest.status, reason: returnRequest.reason,
      // Rejections explain the decision; receipts explain the inspection outcome. Both notes are customer-visible.
      decisionNote: (notification.type === 'RETURN_RECEIVED' ? returnRequest.inspectionNote : returnRequest.decisionNote) ?? null,
      lines: returnRequest.lines.map((line) => ({
        productName: line.orderItem.productName, quantity: line.quantity,
        receivedQuantity: line.receivedQuantity, refundableQuantity: line.refundableQuantity,
      })),
    } }),
    ...(refund && { refund: {
      number: refund.number, amount: moneyNumber(refund.amount), includesDeliveryFee: refund.includesDeliveryFee,
      providerReference: refund.status === 'CONFIRMED' ? refund.providerReference : null, source: refund.source,
    } }),
    links: { order: site ? `${site}/#/account/orders` : null },
  };
}

/** Sends one due notification under a lease; at-least-once if a process dies after provider acceptance. */
export async function deliverNotification(id, now = new Date()) {
  // A batch can reach a message long after selecting it; never grant a lease that is already expired.
  const at = new Date(Math.max(now.getTime(), Date.now()));
  const lease = randomUUID();
  const claimed = await prisma.notification.updateMany({
    where: {
      id,
      OR: [
        { status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: at } },
        { status: 'SENDING', leaseExpiresAt: { lte: at } },
      ],
    },
    data: { status: 'SENDING', leaseId: lease, leaseExpiresAt: new Date(at.getTime() + LEASE_MS) },
  });
  if (!claimed.count) return null;
  const notification = await prisma.notification.findUnique({ where: { id } });
  let message;
  try {
    message = renderNotification(notification.type, await notificationContext(notification));
  } catch (error) {
    return recordFailure(notification, lease, PERMANENT_RENDER_CODES.includes(error.code) ? error.code : 'RENDER_ERROR', true);
  }
  try {
    const result = await mailer.send({ to: notification.recipient, ...message });
    await prisma.notification.updateMany({ where: { id, leaseId: lease }, data: {
      status: 'SENT', sentAt: new Date(), providerMessageId: result?.messageId ?? null,
      attempts: { increment: 1 }, lastErrorCode: null, leaseId: null, leaseExpiresAt: null,
    } });
    return 'SENT';
  } catch (error) {
    return recordFailure(notification, lease, SAFE_CODES.has(error?.code) ? error.code : 'MAIL_PROVIDER_ERROR', false);
  }
}

async function recordFailure(notification, lease, code, permanent) {
  const attempts = notification.attempts + 1;
  const dead = permanent || attempts >= MAX_NOTIFICATION_ATTEMPTS;
  await prisma.notification.updateMany({ where: { id: notification.id, leaseId: lease }, data: {
    status: dead ? 'DEAD' : 'FAILED', attempts, lastErrorCode: code, leaseId: null, leaseExpiresAt: null,
    nextAttemptAt: new Date(Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]),
  } });
  console.warn('Notification delivery did not complete', { notificationId: notification.id, code, attempts });
  return dead ? 'DEAD' : 'FAILED';
}

/** Best-effort delivery after a business commit; never changes the committed outcome. */
export async function dispatchNotifications(ids, { timeoutMs = 8000 } = {}) {
  const pending = [...new Set(ids.filter(Boolean))];
  if (!pending.length) return;
  let timer;
  const work = (async () => { for (const id of pending) await deliverNotification(id).catch(() => null); })();
  await Promise.race([work, new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); })]);
  clearTimeout(timer);
}

export async function processDueNotifications({ limit = 20, now = new Date() } = {}) {
  const due = await prisma.notification.findMany({
    where: { OR: [
      { status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: now } },
      { status: 'SENDING', leaseExpiresAt: { lte: now } },
    ] },
    select: { id: true }, orderBy: { nextAttemptAt: 'asc' }, take: limit,
  });
  const results = { sent: 0, failed: 0, dead: 0 };
  for (const { id } of due) {
    const outcome = await deliverNotification(id, now).catch(() => 'FAILED');
    if (outcome === 'SENT') results.sent += 1;
    else if (outcome === 'DEAD') results.dead += 1;
    else if (outcome === 'FAILED') results.failed += 1;
  }
  return results;
}

/** Staff retry for a failed or abandoned message; one further attempt per request after the limit. */
export async function retryNotification(id) {
  const notification = await prisma.notification.findUnique({ where: { id } });
  const visible = notification && (!notification.orderId ||
    await prisma.order.count({ where: { id: notification.orderId, ...customerOrderWhere() } }));
  if (!visible) throw Object.assign(new Error('Notification not found.'), { statusCode: 404, code: 'NOTIFICATION_NOT_FOUND' });
  if (!['FAILED', 'DEAD'].includes(notification.status)) {
    throw Object.assign(new Error('Only failed notifications can be retried.'), { statusCode: 409, code: 'NOTIFICATION_NOT_RETRYABLE' });
  }
  const changed = await prisma.notification.updateMany({
    where: { id, status: notification.status, attempts: notification.attempts },
    data: { status: 'PENDING', nextAttemptAt: new Date(), attempts: Math.min(notification.attempts, MAX_NOTIFICATION_ATTEMPTS - 1) },
  });
  if (!changed.count) throw Object.assign(new Error('The notification changed. Reload and retry.'), { statusCode: 409, code: 'NOTIFICATION_CHANGED' });
  await dispatchNotifications([id]);
  return notificationDto(await prisma.notification.findUnique({ where: { id } }));
}

export const notificationDto = (notification) => ({
  id: notification.id, type: notification.type, status: notification.status, orderId: notification.orderId,
  attempts: notification.attempts, lastErrorCode: notification.lastErrorCode,
  nextAttemptAt: notification.nextAttemptAt?.toISOString() ?? null, sentAt: notification.sentAt?.toISOString() ?? null,
  createdAt: notification.createdAt.toISOString(),
});

export default { processDueNotifications };
