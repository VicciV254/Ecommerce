import { demoOrdersEnabled } from '../config/checkoutPolicy.js';
import { DEMONSTRATION_ORDER_ACTIONS, allowedStaffActions, customerCanCancel } from './fulfilmentService.js';
import { refundRequestOptions } from './owedRefundService.js';
import { SETTLED_PAYMENT_STATUSES, refundDto } from './refundService.js';
import { returnDto, returnEligibility } from './returnService.js';
import { orderDto } from '../utils/orderDto.js';

const fulfilmentDto = (order) => Object.fromEntries(
  ['processingAt', 'readyForPickupAt', 'shippedAt', 'deliveredAt', 'pickedUpAt', 'cancelledAt']
    .map((field) => [field, order[field]?.toISOString?.() ?? order[field] ?? null]),
);

const RETURN_STEPS = { REQUESTED: 'APPROVE', APPROVED: 'RECEIVE' };
const COMPLETABLE_REFUNDS = ['REQUESTED', 'APPROVED', 'PROCESSING'];

/**
 * The store-side steps the owner may play for a sample order, exactly as the demonstration endpoints would accept them
 * now, each with the status it expects; none where sample orders are off or the order is not a sample.
 */
export function demonstrationActions(order, paymentReviewOpen) {
  if (!order.isDemo || !demoOrdersEnabled()) return [];
  return [
    ...allowedStaffActions(order, paymentReviewOpen)
      .filter((action) => DEMONSTRATION_ORDER_ACTIONS.includes(action))
      .map((action) => ({ action, expectedStatus: order.status })),
    ...(order.returnRequests ?? []).filter((request) => Object.hasOwn(RETURN_STEPS, request.status))
      .map((request) => ({ action: RETURN_STEPS[request.status], returnId: request.id, expectedStatus: request.status })),
    ...(order.refunds ?? []).filter((refund) => refund.method === 'DEMONSTRATION' && COMPLETABLE_REFUNDS.includes(refund.status))
      .map((refund) => ({ action: 'COMPLETE_REFUND', refundId: refund.id, expectedStatus: refund.status })),
  ];
}

/** The order with honest return/refund state and the actions the server would accept, shared by both views. */
function orderView(order, { reviewOpen, now }) {
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

/**
 * Customer order view, with the store-side steps the owner may play for a sample order and whether it is a sample order
 * the store deletes after the retention period (`scheduled`, from `sampleOrdersScheduledForDeletion`).
 */
export function customerOrderView(order, { reviewOpen = new Set(), now = new Date(), scheduled = new Set() } = {}) {
  return {
    ...orderView(order, { reviewOpen, now }),
    demonstrationActions: demonstrationActions(order, reviewOpen.has(order.id)),
    scheduledForDeletion: scheduled.has(order.id),
  };
}

/** Staff order view: adds actor details, internal notes, permitted fulfilment actions and review state. */
export function staffOrderView(order, { reviewOpen = new Set(), now = new Date() } = {}) {
  const paymentReviewOpen = reviewOpen.has(order.id);
  return {
    ...orderView(order, { reviewOpen, now }),
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
