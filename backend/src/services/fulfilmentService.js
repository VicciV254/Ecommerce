import prisma from '../config/database.js';
import { httpError } from './catalogService.js';
import {
  actorLocation, customerOrderWhere, demonstrationOrderWhere, lockOrderInventory, orderTransaction, releaseOrderStock,
} from './inventoryService.js';
import { dispatchNotifications, enqueueNotification } from './notificationService.js';
import { SETTLED_PAYMENT_STATUSES, createRefundInTransaction, openPaymentReviews } from './refundService.js';
import { orderInclude } from '../utils/orderDto.js';

const DELIVERY = ['STANDARD', 'SAME_DAY'];
export const STAFF_ACTIONS = {
  START_PROCESSING: { from: ['PENDING'], to: 'PROCESSING', stamp: 'processingAt', description: 'Order accepted and being prepared' },
  MARK_READY_FOR_PICKUP: {
    from: ['PROCESSING'], to: 'READY_FOR_PICKUP', methods: ['STORE_PICKUP'], stamp: 'readyForPickupAt',
    description: 'Ready for pickup; bring your order number', notification: 'ORDER_READY_FOR_PICKUP',
  },
  DISPATCH: {
    from: ['PROCESSING'], to: 'SHIPPED', methods: DELIVERY, stamp: 'shippedAt',
    description: 'Dispatched for delivery', notification: 'ORDER_DISPATCHED',
  },
  CONFIRM_DELIVERY: {
    from: ['SHIPPED'], to: 'DELIVERED', methods: DELIVERY, stamp: 'deliveredAt',
    description: 'Delivered', notification: 'ORDER_DELIVERED',
  },
  CONFIRM_PICKUP: {
    from: ['READY_FOR_PICKUP'], to: 'DELIVERED', methods: ['STORE_PICKUP'], stamp: 'deliveredAt',
    description: 'Collected by the customer at handover', notification: 'ORDER_PICKED_UP',
  },
  CANCEL: { from: ['PENDING', 'PROCESSING', 'READY_FOR_PICKUP'], to: 'CANCELLED' },
};
const CUSTOMER_CANCELLABLE = ['PENDING', 'PROCESSING'];

const isPaidAndCommitted = (order) => order.paymentStatus === 'PAID' && order.reservationStatus === 'COMMITTED';

/** Staff actions that the server would accept now, given payment, method and review state. */
export function allowedStaffActions(order, paymentReviewOpen = false) {
  return Object.entries(STAFF_ACTIONS).filter(([action, rule]) => {
    if (!rule.from.includes(order.status)) return false;
    if (rule.methods && !rule.methods.includes(order.deliveryMethod)) return false;
    if (action === 'CANCEL') return !SETTLED_PAYMENT_STATUSES.includes(order.paymentStatus) || !paymentReviewOpen;
    return isPaidAndCommitted(order) && !paymentReviewOpen;
  }).map(([action]) => action);
}

export const customerCanCancel = (order) => CUSTOMER_CANCELLABLE.includes(order.status);

async function cancelInTransaction(db, order, { actor, reason, allowedStatuses, location }) {
  if (order.status === 'CANCELLED') return { order, changed: false, notificationIds: [] };
  if (!allowedStatuses.includes(order.status)) {
    throw httpError(409, 'This order cannot be cancelled at this stage. Request a return after delivery instead.', 'ACTION_NOT_ALLOWED');
  }
  const now = new Date();
  const expired = order.reservationStatus === 'HELD' && order.reservationExpiresAt && order.reservationExpiresAt <= now;
  const reservationStatus = await releaseOrderStock(db, order, expired);
  const description = expired ? 'Inventory reservation expired before payment'
    : reason ? `Order cancelled - ${reason}` : 'Order cancelled by customer';
  let updated = await db.order.update({
    where: { id: order.id },
    data: {
      status: 'CANCELLED', reservationStatus, cancelledAt: now, cancellationReason: expired ? description : reason || null,
      trackingHistory: { create: {
        status: 'CANCELLED', description, location: expired ? 'Reservation service' : location,
        actorType: expired ? 'SYSTEM' : actor.type, actorId: actor.id ?? null, reason: reason || null,
      } },
    },
    include: orderInclude,
  });
  let refund = null;
  // Requests whatever was received and not yet refunded; nothing when the balance is zero.
  if (SETTLED_PAYMENT_STATUSES.includes(updated.paymentStatus)) {
    refund = await createRefundInTransaction(db, updated, {
      source: 'CANCELLATION', amount: updated.total, includesDeliveryFee: true, actor, reason: reason || null,
      dedupeKey: `cancel:${updated.id}`,
    });
    updated = await db.order.findUnique({ where: { id: order.id }, include: orderInclude });
  }
  const notification = expired ? null : await enqueueNotification(db, {
    type: 'ORDER_CANCELLED', order: updated, refundId: refund?.id ?? null, dedupeKey: `order-cancelled:${order.id}`,
  });
  return { order: updated, changed: true, notificationIds: notification ? [notification.id] : [] };
}

/** Customer cancellation before dispatch; a paid order opens a refund request, not a refund claim. */
export async function cancelOrderForCustomer(userId, orderId, reason) {
  const result = await orderTransaction(async (db) => {
    await lockOrderInventory(db, orderId);
    const order = await db.order.findFirst({ where: { id: orderId, userId, ...customerOrderWhere() }, include: orderInclude });
    if (!order) throw httpError(404, 'Order not found', 'ORDER_NOT_FOUND');
    if (SETTLED_PAYMENT_STATUSES.includes(order.paymentStatus) && (await openPaymentReviews(db, [order.id])).size) {
      throw httpError(409, 'This payment is under review. Contact support before cancelling.', 'PAYMENT_REVIEW_REQUIRED');
    }
    return cancelInTransaction(db, order, {
      actor: { type: 'CUSTOMER', id: userId }, reason, allowedStatuses: CUSTOMER_CANCELLABLE, location: 'Customer self-service',
    });
  });
  await dispatchNotifications(result.notificationIds);
  return result;
}

/**
 * Applies one validated fulfilment action; a stale expectedStatus is rejected rather than replayed. `where` narrows the
 * orders it may act on (a demonstration control binds the caller's own sample order).
 */
export async function applyStaffAction(orderId, { action, expectedStatus, reason, trackingNumber }, actor, where = {}) {
  const rule = STAFF_ACTIONS[action];
  if (!rule) throw httpError(400, 'Unknown order action.', 'ACTION_UNKNOWN');
  const result = await orderTransaction(async (db) => {
    await lockOrderInventory(db, orderId);
    const order = await db.order.findFirst({ where: { AND: [{ id: orderId, ...customerOrderWhere() }, where] }, include: orderInclude });
    if (!order) throw httpError(404, 'Order not found', 'ORDER_NOT_FOUND');
    if (order.status !== expectedStatus) throw httpError(409, 'This order changed. Reload it before acting.', 'ORDER_CHANGED');
    const reviewOpen = (await openPaymentReviews(db, [order.id])).has(order.id);
    if (!allowedStaffActions(order, reviewOpen).includes(action)) {
      if (reviewOpen) throw httpError(409, 'Resolve the payment review before changing fulfilment.', 'PAYMENT_REVIEW_REQUIRED');
      throw httpError(409, 'That action is not allowed for this order now.', 'ACTION_NOT_ALLOWED');
    }
    if (action === 'CANCEL') {
      if (!reason) throw httpError(400, 'Record why the order is cancelled.', 'REASON_REQUIRED');
      return cancelInTransaction(db, order, { actor, reason, allowedStatuses: rule.from, location: 'Staff portal' });
    }
    const now = new Date();
    const data = {
      status: rule.to, [rule.stamp]: now,
      ...(action === 'CONFIRM_PICKUP' && { pickedUpAt: now }),
      ...(action === 'DISPATCH' && trackingNumber && { trackingNumber }),
      trackingHistory: { create: {
        status: rule.to, description: rule.description, location: actorLocation(actor, 'Staff portal'),
        actorType: actor.type, actorId: actor.id, reason: reason || null,
      } },
    };
    const updated = await db.order.update({ where: { id: order.id }, data, include: orderInclude });
    const notification = rule.notification ? await enqueueNotification(db, {
      type: rule.notification, order: updated, dedupeKey: `${rule.notification.toLowerCase()}:${order.id}`,
    }) : null;
    return { order: updated, changed: true, notificationIds: notification ? [notification.id] : [] };
  });
  await dispatchNotifications(result.notificationIds);
  return result;
}

/** Store-side steps a visitor may play for their own sample order: each staff step except cancelling. */
export const DEMONSTRATION_ORDER_ACTIONS = Object.keys(STAFF_ACTIONS).filter((action) => action !== 'CANCEL');

/** A visitor's store-side step for their own paid sample order, exactly as staff could take it, never cancelling. */
export function applyDemonstrationAction(userId, orderId, { action, expectedStatus }) {
  if (!DEMONSTRATION_ORDER_ACTIONS.includes(action)) throw httpError(400, 'Unknown order action.', 'ACTION_UNKNOWN');
  const scope = demonstrationOrderWhere(userId);
  if (!scope) throw httpError(404, 'Order not found', 'ORDER_NOT_FOUND');
  return applyStaffAction(orderId, { action, expectedStatus }, { type: 'DEMONSTRATION', id: userId }, scope);
}

export async function orderReviewState(orderIds) {
  return openPaymentReviews(prisma, orderIds);
}
