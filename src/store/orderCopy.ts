import { isAxiosError } from "axios";
import type { AttentionItem, RefundAction, StaffAction } from "../api/admin";
import type { User } from "../api/auth";
import type { CatalogReturnPolicy } from "../api/catalog";
import { apiErrorCode, describeApiError } from "../api/errors";
import type {
  ActorType,
  CustomerOrder,
  DeliveryFeeRefund,
  Order,
  OrderRefund,
  OrderReturn,
  OrderStatus,
  PaymentStatus,
  RefundSource,
  RefundStatus,
  ReturnEligibility,
  ReturnPolicyTerms,
  ReturnReason,
  ReturnRule,
  ReturnStatus,
} from "../api/orders";
import { formatDateTime, formatKES } from "../utils/format";
import { isRecord } from "../utils/storage";

/* ------------------------------------------------------------------ */
/* Orders and payments                                                 */
/* ------------------------------------------------------------------ */

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  READY_FOR_PICKUP: "Ready for pickup",
  SHIPPED: "Dispatched",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

/** A delivered store-pickup order was collected at handover. */
export function orderStatusLabel(order: Pick<Order, "status" | "deliveryMethod">) {
  return order.status === "DELIVERED" && order.deliveryMethod === "STORE_PICKUP" ? "Collected" : ORDER_STATUS_LABELS[order.status];
}

/** What a pending order waits for, by payment state; money already refunded is neither awaited nor ready to prepare. */
const SHOPPER_PENDING_LABELS: Record<PaymentStatus, string> = {
  PENDING: "Awaiting payment",
  FAILED: "Awaiting payment",
  PAID: "Waiting to be prepared",
  PARTIALLY_REFUNDED: ORDER_STATUS_LABELS.PENDING,
  REFUNDED: ORDER_STATUS_LABELS.PENDING,
};

/** The status shoppers read: a pending order says whether it awaits payment or preparation. Staff keep `orderStatusLabel`. */
export function shopperOrderStatusLabel(order: Pick<Order, "status" | "deliveryMethod" | "paymentStatus">) {
  return order.status === "PENDING" ? SHOPPER_PENDING_LABELS[order.paymentStatus] : orderStatusLabel(order);
}

/** Semantic text-on-tint pairs from the design system (each at least 4.5:1); gold never stands for progress. */
export const ORDER_STATUS_TONES: Record<OrderStatus, string> = {
  PENDING: "bg-warning-tint text-warning",
  PROCESSING: "bg-info-tint text-info",
  READY_FOR_PICKUP: "bg-info-tint text-info",
  SHIPPED: "bg-info-tint text-info",
  DELIVERED: "bg-success-tint text-success",
  CANCELLED: "bg-error-tint text-error",
};

/**
 * The badge tone shoppers see, matching `shopperOrderStatusLabel`: a paid order waiting to be prepared is progress (the
 * in-progress tone), so only an order that needs something from the shopper keeps the warning tone.
 */
export function shopperOrderStatusTone(order: Pick<Order, "status" | "paymentStatus">) {
  return order.status === "PENDING" && order.paymentStatus === "PAID" ? ORDER_STATUS_TONES.PROCESSING : ORDER_STATUS_TONES[order.status];
}

/** `REFUNDED` and `PARTIALLY_REFUNDED` are set only by refunds confirmed as sent. */
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: "pending",
  PAID: "paid",
  FAILED: "failed",
  REFUNDED: "refunded",
  PARTIALLY_REFUNDED: "partially refunded",
};

export function customerName(user: Pick<User, "firstName" | "lastName"> | null) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Customer";
}

export function deliveryAddress(order: Pick<Order, "address">) {
  return order.address ? `${order.address.street}, ${order.address.city}, ${order.address.county}` : "Not provided";
}

export function paymentLabel(order: Pick<Order, "paymentMethod" | "paymentStatus">) {
  const method = order.paymentMethod === "MPESA" ? "M-Pesa" : order.paymentMethod.replace(/_/g, " ").toLowerCase();
  return `${method} (${PAYMENT_STATUS_LABELS[order.paymentStatus]})`;
}

/**
 * What cancelling does with money received: the server requests whatever was paid and not yet refunded.
 * `full` and `remaining` record a refund request; `settled` means everything was already refunded.
 */
type CancellationRefund = "full" | "remaining" | "settled" | null;
export function cancellationRefund(paymentStatus: PaymentStatus): CancellationRefund {
  if (paymentStatus === "PAID") return "full";
  if (paymentStatus === "PARTIALLY_REFUNDED") return "remaining";
  return paymentStatus === "REFUNDED" ? "settled" : null;
}
export const cancellationRequestsRefund = (paymentStatus: PaymentStatus) => {
  const scope = cancellationRefund(paymentStatus);
  return scope === "full" || scope === "remaining";
};

export const ACTOR_LABELS: Record<ActorType, string> = {
  CUSTOMER: "Customer",
  STAFF: "Staff",
  SYSTEM: "Automatic",
  PROVIDER: "M-Pesa",
};

/* ------------------------------------------------------------------ */
/* Return rules and policy                                             */
/* ------------------------------------------------------------------ */

export const RETURN_REASON_LABELS: Record<ReturnReason, string> = {
  CHANGED_MIND: "Changed my mind",
  FAULTY: "Faulty or not working",
  DAMAGED: "Arrived damaged",
  WRONG_ITEM: "Wrong item sent",
  OTHER: "Another reason",
};

/** Reasons that put the fault with the store; staff confirm them on receipt. */
export const FAULT_REASONS: readonly ReturnReason[] = ["FAULTY", "DAMAGED", "WRONG_ITEM"];
export const isFaultReason = (reason: ReturnReason) => FAULT_REASONS.includes(reason);

/** One line per ordered item: which returns its rule accepts. */
export function returnRuleText(rule: ReturnRule, windowDays: number) {
  switch (rule) {
    case "FAULT_ONLY":
      return "Returnable only if faulty, damaged or wrong.";
    case "UNOPENED_OR_FAULT":
      return "Returnable if unopened, or if faulty, damaged or wrong.";
    default:
      return `Returnable for any reason within ${windowDays} days of delivery or collection.`;
  }
}

const DELIVERY_FEE_FACT: Record<DeliveryFeeRefund, string> = {
  MERCHANT_FAULT_ONLY: "delivery fee refunded only for faulty, damaged or wrong items",
  ALWAYS: "delivery fee included in return refunds",
  NEVER: "delivery fee not refunded on returns",
};

/** The product page's short returns fact, from the product's rule and the catalog's current terms. */
export function productReturnFact(rule: ReturnRule, policy: Pick<CatalogReturnPolicy, "windowDays" | "deliveryFeeRefund">) {
  const days = policy.windowDays;
  const window = rule === "FAULT_ONLY" ? `Returnable only if faulty, damaged or wrong — within ${days} days.`
    : rule === "UNOPENED_OR_FAULT" ? `Returnable within ${days} days if unopened, or if faulty, damaged or wrong.`
    : `Returns within ${days} days of delivery.`;
  return { window, refunds: `Refunds by M-Pesa; ${DELIVERY_FEE_FACT[policy.deliveryFeeRefund]}.` };
}

/** How a return refund treats the delivery fee, per rule; also stated on the Returns and refunds page. */
export const DELIVERY_FEE_TERMS: Record<DeliveryFeeRefund, string> = {
  MERCHANT_FAULT_ONLY: "The delivery fee is refunded only if staff confirm an item was faulty, damaged or wrong.",
  ALWAYS: "The delivery fee is included in your first accepted return refund.",
  NEVER: "The delivery fee is not refunded for returns.",
};

/** The order's return terms, as recorded when it was bought. */
export function returnPolicyTerms(policy: ReturnPolicyTerms): string[] {
  return [
    "Returns are refunded; exchanges and store credit are not offered.",
    "Refunds are sent by M-Pesa after staff receive and check the items. We will email you when your refund is sent.",
    DELIVERY_FEE_TERMS[policy.deliveryFeeRefund],
    "Refund amounts are rounded up to the nearest whole shilling and never exceed what you paid.",
  ];
}

/** Where the order stands with returns, or `null` when there is nothing to say yet. */
export function returnWindowText(eligibility: ReturnEligibility): string | null {
  const { windowEndsAt, policy } = eligibility;
  switch (eligibility.reasonCode) {
    case null:
      return windowEndsAt ? `Returns can be requested until ${formatDateTime(windowEndsAt)}.` : null;
    case "WINDOW_CLOSED":
      return windowEndsAt ? `The return window closed on ${formatDateTime(windowEndsAt)}.` : "The return window has closed.";
    case "NOTHING_RETURNABLE":
      return "Every item on this order already has a return request.";
    case "NOT_PAID":
      return "There is no paid amount left to return on this order.";
    default:
      return `Returns open for ${policy.windowDays} days after delivery or collection.`;
  }
}

export const RETURN_STATUS_TEXT: Record<ReturnStatus, string> = {
  REQUESTED: "Awaiting review",
  APPROVED: "Approved — staff will arrange the return",
  REJECTED: "Not approved",
  CANCELLED: "Withdrawn",
  RECEIVED: "Received and checked",
};

export const STAFF_RETURN_STATUS: Record<ReturnStatus, string> = {
  REQUESTED: "Awaiting decision",
  APPROVED: "Approved — awaiting receipt",
  REJECTED: "Rejected",
  CANCELLED: "Withdrawn by the customer",
  RECEIVED: "Received and inspected",
};

/* ------------------------------------------------------------------ */
/* Refunds: only CONFIRMED means money was sent                        */
/* ------------------------------------------------------------------ */

const REFUND_STATUS_TEXT: Record<RefundStatus, string> = {
  REQUESTED: "Requested — not sent yet",
  APPROVED: "Approved — not sent yet",
  PROCESSING: "In progress — not confirmed as sent yet",
  CONFIRMED: "Sent by M-Pesa",
  FAILED: "Not sent — staff will follow up",
  UNRESOLVED: "Being checked — not confirmed as sent",
  CANCELLED: "Withdrawn — not sent",
};

export const REFUND_SOURCE_TEXT: Record<RefundSource, string> = {
  CANCELLATION: "Cancelled order",
  RETURN: "Returned items",
  PAYMENT_REVIEW: "Payment under review",
};

/** Customer wording; the M-Pesa reference appears only once the refund is confirmed as sent. */
export function refundStatusText(refund: Pick<OrderRefund, "status" | "confirmedAt" | "providerReference">) {
  if (refund.status !== "CONFIRMED") return REFUND_STATUS_TEXT[refund.status];
  const when = refund.confirmedAt ? ` on ${formatDateTime(refund.confirmedAt)}` : "";
  const reference = refund.providerReference ? ` · M-Pesa reference ${refund.providerReference}` : "";
  return `${REFUND_STATUS_TEXT.CONFIRMED}${when}${reference}`;
}

const refundLine = (refund: OrderRefund) => `Refund of ${formatKES(refund.amount)}: ${refundStatusText(refund)}.`;

/**
 * The customer's confirmation after cancelling, from the records the server returned. A replayed
 * cancellation returns the order as it is now, so its refund may already have moved on or been sent.
 */
export function cancellationNotice(order: Pick<CustomerOrder, "orderNumber" | "refunds">): string {
  const refund = order.refunds.find((item) => item.source === "CANCELLATION" && item.status !== "CANCELLED");
  if (!refund) return `Order ${order.orderNumber} cancelled.`;
  const followUp = refund.status === "CONFIRMED" ? "" : " We will email you when it is sent.";
  return `Order ${order.orderNumber} cancelled. ${refundLine(refund)}${followUp}`;
}

const hasRefundableUnits = (request: OrderReturn) => request.lines.some((line) => (line.refundableQuantity ?? 0) > 0);

/**
 * The customer's confirmation after a return request, from the request's current status: a retry with the
 * saved key returns the request as staff have handled it since, not as it was first sent.
 */
export function returnNotice(request: OrderReturn, order: Pick<CustomerOrder, "returns" | "refunds">): string {
  if (request.status === "REQUESTED") {
    return `Return ${request.number} requested. We will email you when staff have reviewed it. Nothing is refunded until the items are received and checked.`;
  }
  const status = `Return ${request.number}: ${RETURN_STATUS_TEXT[request.status]}.`;
  if (request.status !== "RECEIVED") return status;
  if (!hasRefundableUnits(request)) return `${status} No refund is due for it.`;
  // Customer refunds do not name their return, so one is described only when it cannot belong to another return.
  const refundable = order.returns.filter((item) => item.status === "RECEIVED" && hasRefundableUnits(item));
  const refunds = order.refunds.filter((item) => item.source === "RETURN" && item.status !== "CANCELLED");
  if (refundable.length === 1 && refunds.length === 1) return `${status} ${refundLine(refunds[0])}`;
  return `${status} Its refund is listed under Refunds with its current status.`;
}

export const STAFF_REFUND_STATUS: Record<RefundStatus, string> = {
  REQUESTED: "Requested — awaiting approval",
  APPROVED: "Approved — not sent yet",
  PROCESSING: "Sending — record the M-Pesa reference when it completes",
  CONFIRMED: "Sent — M-Pesa reference recorded",
  FAILED: "Failed — not sent",
  UNRESOLVED: "Unresolved — check M-Pesa before acting",
  CANCELLED: "Cancelled — not sent",
};

/* ------------------------------------------------------------------ */
/* Staff actions                                                       */
/* ------------------------------------------------------------------ */

export const STAFF_ACTION_LABELS: Record<StaffAction, string> = {
  START_PROCESSING: "Start processing",
  MARK_READY_FOR_PICKUP: "Mark ready for pickup",
  DISPATCH: "Dispatch",
  CONFIRM_DELIVERY: "Confirm delivery",
  CONFIRM_PICKUP: "Confirm pickup",
  CANCEL: "Cancel order",
};

export const STAFF_ACTION_RESULTS: Record<StaffAction, string> = {
  START_PROCESSING: "is now processing",
  MARK_READY_FOR_PICKUP: "is marked ready for pickup",
  DISPATCH: "is marked as dispatched",
  CONFIRM_DELIVERY: "is confirmed as delivered",
  CONFIRM_PICKUP: "is confirmed as collected",
  CANCEL: "is cancelled",
};

export const REFUND_ACTION_LABELS: Record<RefundAction, string> = {
  approve: "Approve refund",
  start: "Start sending",
  confirm: "Record M-Pesa reference",
  fail: "Mark failed",
  unresolved: "Mark unresolved",
  retry: "Ready to send again",
  cancel: "Cancel refund",
};

export const ATTENTION_TYPE_LABELS: Record<AttentionItem["type"], string> = {
  ORDER_AWAITING_FULFILMENT: "Order to prepare",
  PAYMENT_REVIEW: "Payment review",
  RETURN_AWAITING_DECISION: "Return decision",
  RETURN_AWAITING_RECEIPT: "Return receipt",
  REFUND_ACTION: "Refund",
  NOTIFICATION_FAILED: "Email failed",
};

/** What a failed staff request means and whether the record must be reloaded before trying again. */
export type StaffFailure = { code?: string; message: string; reload: boolean };

const STALE_CODES = new Set([
  "ORDER_CHANGED", "ACTION_NOT_ALLOWED", "PAYMENT_REVIEW_REQUIRED", "RETURN_CHANGED", "REFUND_CHANGED",
  "REFUND_ACTION_NOT_ALLOWED", "REFUND_EXISTS", "REFUND_NOT_AVAILABLE", "PAYMENT_NOT_REFUNDABLE",
  "NOTIFICATION_NOT_RETRYABLE", "NOTIFICATION_CHANGED",
]);

const STAFF_MESSAGES: Record<string, string> = {
  ORDER_CHANGED: "This order changed since it was loaded, so nothing was applied. It has been reloaded; check its status and try again.",
  ACTION_NOT_ALLOWED: "That action is no longer allowed for this order, so nothing was applied. It has been reloaded.",
  PAYMENT_REVIEW_REQUIRED: "Resolve the payment review before changing fulfilment. Nothing was applied.",
  REASON_REQUIRED: "Enter a reason before continuing.",
  RETURN_CHANGED: "This return changed since it was loaded, so nothing was recorded. It has been reloaded.",
  REFUND_CHANGED: "This refund changed since it was loaded, so nothing was recorded. It has been reloaded.",
  REFUND_ACTION_NOT_ALLOWED: "That refund step is no longer allowed, so nothing was recorded. It has been reloaded.",
  REFUND_AMOUNT_INVALID: "Enter a whole-KES amount greater than zero and no higher than the requested refund.",
  REFUND_REASON_REQUIRED: "Enter a reason for this refund step.",
  REFUND_REFERENCE_INVALID: "Enter the M-Pesa transaction reference: 8 to 32 letters and numbers.",
  REFUND_REFERENCE_IN_USE: "That M-Pesa reference is already recorded on another refund. Check the reference and try again.",
};

function serverText(error: unknown): string | null {
  if (!isAxiosError(error)) return null;
  const body: unknown = error.response?.data;
  return isRecord(body) && typeof body.error === "string" && body.error.trim() ? body.error.trim() : null;
}

/** Staff-facing explanation of a refused or failed request; stale records are flagged for reload. */
export function describeStaffFailure(error: unknown, fallback: string): StaffFailure {
  const code = apiErrorCode(error);
  const reload = code !== undefined && STALE_CODES.has(code);
  const known = code ? STAFF_MESSAGES[code] : undefined;
  if (known) return { code, message: known, reload };
  const detail = serverText(error);
  return { code, message: code && detail ? detail : describeApiError(error, fallback), reload };
}
