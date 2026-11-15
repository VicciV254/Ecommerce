import { allowedStaffActions, customerCanCancel } from './fulfilmentService.js';
import { refundRequestOptions } from './owedRefundService.js';
import { SETTLED_PAYMENT_STATUSES, refundDto } from './refundService.js';
import { returnDto, returnEligibility } from './returnService.js';
import { orderDto } from '../utils/orderDto.js';

const fulfilmentDto = (order) => Object.fromEntries(
  ['processingAt', 'readyForPickupAt', 'shippedAt', 'deliveredAt', 'pickedUpAt', 'cancelledAt']
    .map((field) => [field, order[field]?.toISOString?.() ?? order[field] ?? null]),
);

/** Customer order with honest return/refund state and the actions the server would accept. */
export function customerOrderView(order, { reviewOpen = new Set(), now = new Date() } = {}) {
  const eligibility = returnEligibility(order, now);
  const cancellable = customerCanCancel(order) && !(SETTLED_PAYMENT_STATUSES.includes(order.paymentStatus) && reviewOpen.has(order.id));
  return {
    ...orderDto(order),
    fulfilment: fulfilmentDto(order),
    returns: (order.returnRequests ?? []).map((request) => returnDto(request)),
    refunds: (order.refunds ?? []).map((refund) => refundDto(refund)),
    returnEligibility: eligibility,
    customerActions: [...(cancellable ? ['CANCEL'] : []), ...(eligibility.eligible ? ['REQUEST_RETURN'] : [])],
  };
}

/** Staff order view: adds actor details, internal notes, permitted fulfilment actions and review state. */
export function staffOrderView(order, { reviewOpen = new Set(), now = new Date() } = {}) {
  const paymentReviewOpen = reviewOpen.has(order.id);
  return {
    ...customerOrderView(order, { reviewOpen, now }),
    trackingHistory: (order.trackingHistory ?? []).map((event) => ({
      id: event.id, status: event.status, description: event.description, location: event.location,
      createdAt: event.createdAt, actorType: event.actorType ?? null, actorId: event.actorId ?? null, reason: event.reason ?? null,
    })),
    returns: (order.returnRequests ?? []).map((request) => returnDto(request, true)),
    refunds: (order.refunds ?? []).map((refund) => refundDto(refund, true)),
    allowedActions: allowedStaffActions(order, paymentReviewOpen),
    refundRequestOptions: refundRequestOptions(order),
    paymentReviewOpen,
  };
}
