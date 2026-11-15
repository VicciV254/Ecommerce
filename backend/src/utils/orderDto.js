import { userSummarySelect } from './account.js';

export const orderInclude = {
  items: { orderBy: { id: 'asc' } },
  address: true,
  user: { select: userSummarySelect },
  trackingHistory: { orderBy: { createdAt: 'desc' } },
  returnRequests: {
    orderBy: { createdAt: 'desc' },
    include: { lines: { orderBy: { id: 'asc' }, include: { orderItem: { select: { productName: true, quantity: true } } } } },
  },
  refunds: { orderBy: { createdAt: 'desc' } },
};

/** Tracking entries for the order's owner; staff identities and staff-only reasons are omitted. */
export const customerTrackingEvent = (event) => ({
  id: event.id, status: event.status, description: event.description, location: event.location,
  createdAt: event.createdAt, actorType: event.actorType ?? null,
});

const PUBLIC_STEPS = {
  PENDING: 'Order placed', PROCESSING: 'Order is being prepared', READY_FOR_PICKUP: 'Ready for pickup',
  SHIPPED: 'Dispatched for delivery', DELIVERED: 'Delivered', CANCELLED: 'Order cancelled',
};

/**
 * Unauthenticated tracking by order number: one fixed phrase per status change, newest first.
 * Event text can hold refund amounts, M-Pesa references or staff notes, so none of it is exposed.
 * Expects events in chronological order.
 */
export function publicTrackingTimeline(order) {
  const steps = [];
  for (const event of order.trackingHistory ?? []) {
    if (!PUBLIC_STEPS[event.status] || steps.at(-1)?.status === event.status) continue;
    const description = event.status === 'DELIVERED' && order.deliveryMethod === 'STORE_PICKUP' ? 'Collected' : PUBLIC_STEPS[event.status];
    steps.push({ id: event.id, status: event.status, description, location: null, createdAt: event.createdAt, actorType: null });
  }
  return steps.reverse();
}

const INTERNAL_ORDER_FIELDS = ['addressSnapshot', 'returnRequests', 'refunds', 'settledPaymentId', 'trackingHistory'];

/** Base order shape used by checkout responses; return/refund views are composed in services/orderViews.js. */
export function orderDto(order) {
  const dto = { ...order };
  for (const field of INTERNAL_ORDER_FIELDS) delete dto[field];
  return {
    ...dto,
    address: order.addressSnapshot ?? order.address,
    ...(order.trackingHistory && { trackingHistory: order.trackingHistory.map(customerTrackingEvent) }),
  };
}
