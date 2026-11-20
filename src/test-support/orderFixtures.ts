/**
 * Server-shaped fulfilment, return and refund views shared by unit and browser tests. Shapes and the
 * permitted-action tables mirror the backend (`orderViews.js`, `fulfilmentService.js`, `refundService.js`,
 * `returnService.js`); tests pass explicit overrides for anything they assert on.
 */
import type { AttentionItem, RefundAction, StaffAction, StaffOrder, StaffRefund, StaffReturn } from "../api/admin";
import type {
  CustomerOrder,
  Order,
  OrderFulfilment,
  OrderRefund,
  OrderReturn,
  RefundStatus,
  ReturnEligibility,
  ReturnPolicyTerms,
  ReturnReason,
  ReturnRule,
} from "../api/orders";

const DAY_MS = 86_400_000;
const ALL_REASONS: ReturnReason[] = ["CHANGED_MIND", "FAULTY", "DAMAGED", "WRONG_ITEM", "OTHER"];
const FAULT_REASONS: ReturnReason[] = ["FAULTY", "DAMAGED", "WRONG_ITEM"];

const fixturePolicyTerms: ReturnPolicyTerms = {
  windowDays: 7, deliveryFeeRefund: "MERCHANT_FAULT_ONLY", refundRounding: "UP_TO_WHOLE_KES",
  resolutions: ["REFUND"], refundMethod: "MPESA_MANUAL",
};

export const noFulfilment: OrderFulfilment = {
  processingAt: null, readyForPickupAt: null, shippedAt: null, deliveredAt: null, pickedUpAt: null, cancelledAt: null,
};

const allowedReasonsFor = (rule: ReturnRule) => (rule === "FAULT_ONLY" ? [...FAULT_REASONS] : [...ALL_REASONS]);

/** What the server reports before delivery: nothing is returnable yet. */
function fixtureEligibility(order: Order, overrides: Partial<ReturnEligibility> = {}): ReturnEligibility {
  return {
    eligible: false, reasonCode: "NOT_DELIVERED", windowEndsAt: null, policy: fixturePolicyTerms,
    lines: order.items.map((item) => ({
      orderItemId: item.id, productName: item.productName, purchased: item.quantity, requested: 0, returnableQuantity: 0,
      returnRule: "STANDARD", allowedReasons: allowedReasonsFor("STANDARD"),
    })),
    ...overrides,
  };
}

/** A customer view with no returns or refunds; customers may cancel only while pending or processing. */
export function fixtureCustomerOrder(order: Order, overrides: Partial<CustomerOrder> = {}): CustomerOrder {
  return {
    ...order,
    trackingHistory: order.trackingHistory ?? [],
    fulfilment: noFulfilment,
    returns: [],
    refunds: [],
    returnEligibility: fixtureEligibility(order),
    customerActions: order.status === "PENDING" || order.status === "PROCESSING" ? ["CANCEL"] : [],
    demonstrationActions: [],
    scheduledForDeletion: false,
    ...overrides,
  };
}

/**
 * A paid order delivered `deliveredAt` (default: yesterday), every unit returnable within the 7-day window.
 * `rules` sets an item's return rule by order item ID; anything else is STANDARD.
 */
export function fixtureDeliveredOrder(
  order: Order,
  { rules = {}, deliveredAt = new Date(Date.now() - DAY_MS).toISOString() }: { rules?: Record<string, ReturnRule>; deliveredAt?: string } = {},
  overrides: Partial<CustomerOrder> = {},
): CustomerOrder {
  const delivered = Date.parse(deliveredAt);
  const paid: Order = { ...order, status: "DELIVERED", paymentStatus: "PAID", reservationStatus: "COMMITTED", reservationExpiresAt: null };
  return fixtureCustomerOrder(paid, {
    fulfilment: {
      ...noFulfilment,
      processingAt: new Date(delivered - 2 * 3_600_000).toISOString(),
      shippedAt: new Date(delivered - 3_600_000).toISOString(),
      deliveredAt,
    },
    returnEligibility: {
      eligible: true, reasonCode: null, windowEndsAt: new Date(delivered + fixturePolicyTerms.windowDays * DAY_MS).toISOString(),
      policy: fixturePolicyTerms,
      lines: order.items.map((item) => {
        const rule = rules[item.id] ?? "STANDARD";
        return {
          orderItemId: item.id, productName: item.productName, purchased: item.quantity, requested: 0,
          returnableQuantity: item.quantity, returnRule: rule, allowedReasons: allowedReasonsFor(rule),
        };
      }),
    },
    customerActions: ["REQUEST_RETURN"],
    ...overrides,
  });
}

export function fixtureReturn(order: Order, overrides: Partial<OrderReturn> = {}): OrderReturn {
  const item = order.items[0];
  return {
    id: "return-1", number: `RMA-${order.orderNumber}-1`, status: "REQUESTED", reason: "CHANGED_MIND", comment: null,
    unopenedDeclared: false, requestedAt: new Date().toISOString(), decidedAt: null, decisionNote: null, receivedAt: null,
    merchantFaultConfirmed: null, inspectionNote: null,
    lines: [{
      id: "return-line-1", orderItemId: item.id, quantity: 1, returnRule: "STANDARD", receivedQuantity: null,
      refundableQuantity: null, productName: item.productName, purchased: item.quantity,
    }],
    ...overrides,
  };
}

export function fixtureStaffReturn(order: Order, overrides: Partial<StaffReturn> = {}): StaffReturn {
  const base = fixtureReturn(order);
  return {
    ...base, lines: base.lines.map((line) => ({ ...line, restockQuantity: null })), orderId: order.id, updatedAt: base.requestedAt,
    ...overrides,
  };
}

/** The server's refund transitions (`refundService.js`), so staff fixtures offer realistic actions. */
const REFUND_TRANSITIONS: Record<RefundAction, RefundStatus[]> = {
  approve: ["REQUESTED"], start: ["APPROVED"], confirm: ["PROCESSING", "UNRESOLVED"], fail: ["PROCESSING", "UNRESOLVED"],
  unresolved: ["PROCESSING"], retry: ["FAILED"], cancel: ["REQUESTED", "APPROVED", "FAILED"],
};
const refundActionsFor = (status: RefundStatus) =>
  (Object.keys(REFUND_TRANSITIONS) as RefundAction[]).filter((action) => REFUND_TRANSITIONS[action].includes(status));

export function fixtureRefund(overrides: Partial<OrderRefund> = {}): OrderRefund {
  return {
    id: "refund-1", number: "RF-APX-QUOTE-1-1", source: "RETURN", status: "REQUESTED", amount: 1044, includesDeliveryFee: false,
    method: "MPESA_MANUAL", requestedAt: new Date().toISOString(), approvedAt: null, confirmedAt: null, providerReference: null,
    ...overrides,
  };
}

export function fixtureStaffRefund(orderId: string, overrides: Partial<StaffRefund> = {}): StaffRefund {
  const base = fixtureRefund(overrides);
  return {
    ...base, orderId, paymentId: null, returnRequestId: null, requestedAmount: base.amount, reason: null, requestedByType: "STAFF",
    processingAt: null, failedAt: null, failureReason: null, unresolvedAt: null, unresolvedNote: null, cancelledAt: null,
    cancellationReason: null, allowedActions: refundActionsFor(base.status), updatedAt: base.requestedAt,
    ...overrides,
  };
}

/** The server's fulfilment rules (`fulfilmentService.js`): which staff actions it accepts now. */
function staffActionsFor(order: Pick<Order, "status" | "paymentStatus" | "reservationStatus" | "deliveryMethod">, reviewOpen = false): StaffAction[] {
  const pickup = order.deliveryMethod === "STORE_PICKUP";
  const ready = order.paymentStatus === "PAID" && order.reservationStatus === "COMMITTED" && !reviewOpen;
  const steps: Partial<Record<Order["status"], StaffAction[]>> = {
    PENDING: ["START_PROCESSING"],
    PROCESSING: [pickup ? "MARK_READY_FOR_PICKUP" : "DISPATCH"],
    SHIPPED: pickup ? [] : ["CONFIRM_DELIVERY"],
    READY_FOR_PICKUP: pickup ? ["CONFIRM_PICKUP"] : [],
  };
  const forward = ready ? steps[order.status] ?? [] : [];
  const cancellable = ["PENDING", "PROCESSING", "READY_FOR_PICKUP"].includes(order.status) && (order.paymentStatus !== "PAID" || !reviewOpen);
  return [...forward, ...(cancellable ? ["CANCEL" as const] : [])];
}

export function fixtureStaffOrder(order: Order, overrides: Partial<StaffOrder> = {}): StaffOrder {
  const {
    trackingHistory: _events, returns: _returns, refunds: _refunds, demonstrationActions: _ownerSteps, ...customerView
  } = fixtureCustomerOrder(order);
  return {
    ...customerView,
    user: { id: "customer-1", firstName: "Ada", lastName: "Customer", email: "ada@example.test", phone: null },
    trackingHistory: [], returns: [], refunds: [],
    allowedActions: staffActionsFor(order), refundRequestOptions: [], paymentReviewOpen: false,
    ...overrides,
  };
}

export function fixtureAttention(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    key: "order-fulfil:order-1", type: "ORDER_AWAITING_FULFILMENT", severity: "medium",
    title: "Order APX-1 is paid and awaiting preparation", detail: "Start processing when stock is ready.",
    orderId: "order-1", orderNumber: "APX-1", entityId: "order-1", since: new Date().toISOString(), read: false,
    ...overrides,
  };
}
