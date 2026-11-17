import type {
  AttentionItem,
  ListedRefund,
  ListedReturn,
  NotificationReport,
  RefundAction,
  RefundPage,
  ReturnPage,
  StaffAction,
  StaffOrder,
  StaffOrderPage,
  StaffRefund,
} from "../api/admin";
import type {
  ActorType,
  CustomerAction,
  CustomerOrder,
  OrderReturn,
  OrderTracking,
  Pagination,
  RefundSource,
  RefundStatus,
  ReturnIneligibility,
  ReturnReason,
  ReturnRequestResult,
  ReturnStatus,
} from "../api/orders";
import { isRecord } from "../utils/storage";
import { isDeliveryFeeRefund, isMoney, isReturnRule, isReturnWindowDays } from "./catalogModel";
import { isDeliveryMethod, isOrderStatus, isPaymentStatus } from "./checkoutModel";

/* ------------------------------------------------------------------ */
/* Boundary validation: order, return and refund views are checked    */
/* before any status, amount or permitted action is shown             */
/* ------------------------------------------------------------------ */

export class OrderFormatError extends Error {
  constructor(detail: string) {
    super(`The order response was not in the expected format (${detail}).`);
    this.name = "OrderFormatError";
  }
}

type Guard<T> = (value: unknown) => value is T;

const isString = (value: unknown): value is string => typeof value === "string";
const isId = (value: unknown): value is string => isString(value) && value !== "";
const isNullableId = (value: unknown): value is string | null => value === null || isId(value);
const isNullableString = (value: unknown): value is string | null => value === null || isString(value);
const isTimestamp = (value: unknown): value is string => isString(value) && !Number.isNaN(Date.parse(value));
const isNullableTimestamp = (value: unknown): value is string | null => value === null || isTimestamp(value);
const isCount = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0;
const isNullableCount = (value: unknown): value is number | null => value === null || isCount(value);
const isQuantity = (value: unknown): value is number => Number.isInteger(value) && Number(value) > 0;
const oneOf = <T extends string>(values: readonly T[]): Guard<T> => (value: unknown): value is T =>
  values.some((item) => item === value);
const listOf = <T,>(value: unknown, guard: (item: unknown) => boolean): value is T[] => Array.isArray(value) && value.every(guard);
const uniqueListOf = <T extends string>(value: unknown, guard: Guard<T>): value is T[] =>
  listOf<T>(value, guard) && new Set(value).size === value.length;

export const RETURN_REASONS: readonly ReturnReason[] = ["CHANGED_MIND", "FAULTY", "DAMAGED", "WRONG_ITEM", "OTHER"];
export const RETURN_STATUSES: readonly ReturnStatus[] = ["REQUESTED", "APPROVED", "REJECTED", "CANCELLED", "RECEIVED"];
export const REFUND_STATUSES: readonly RefundStatus[] = [
  "REQUESTED", "APPROVED", "PROCESSING", "CONFIRMED", "FAILED", "UNRESOLVED", "CANCELLED",
];
const STAFF_ACTIONS: readonly StaffAction[] = [
  "START_PROCESSING", "MARK_READY_FOR_PICKUP", "DISPATCH", "CONFIRM_DELIVERY", "CONFIRM_PICKUP", "CANCEL",
];
const REFUND_ACTIONS: readonly RefundAction[] = ["approve", "start", "confirm", "fail", "unresolved", "retry", "cancel"];
const REFUND_SOURCES: readonly RefundSource[] = ["CANCELLATION", "RETURN", "PAYMENT_REVIEW"];
const ACTOR_TYPES: readonly ActorType[] = ["CUSTOMER", "STAFF", "SYSTEM", "PROVIDER"];
const CUSTOMER_ACTIONS: readonly CustomerAction[] = ["CANCEL", "REQUEST_RETURN"];
const INELIGIBILITY: readonly ReturnIneligibility[] = ["NOT_DELIVERED", "NOT_PAID", "WINDOW_CLOSED", "NOTHING_RETURNABLE"];
const ATTENTION_TYPES: readonly AttentionItem["type"][] = [
  "ORDER_AWAITING_FULFILMENT", "PAYMENT_REVIEW", "RETURN_AWAITING_DECISION", "RETURN_AWAITING_RECEIPT", "REFUND_ACTION",
  "NOTIFICATION_FAILED",
];
const SEVERITIES: readonly AttentionItem["severity"][] = ["high", "medium", "low"];
const NOTIFICATION_STATUSES: readonly NotificationReport["status"][] = ["PENDING", "SENDING", "SENT", "FAILED", "DEAD"];
const FULFILMENT_FIELDS = ["processingAt", "readyForPickupAt", "shippedAt", "deliveredAt", "pickedUpAt", "cancelledAt"] as const;

export const isReturnReason = oneOf(RETURN_REASONS);
export const isReturnStatus = oneOf(RETURN_STATUSES);
export const isRefundStatus = oneOf(REFUND_STATUSES);
const isStaffAction = oneOf(STAFF_ACTIONS);
const isRefundAction = oneOf(REFUND_ACTIONS);
const isRefundSource = oneOf(REFUND_SOURCES);
const isActorType = oneOf(ACTOR_TYPES);
const isCustomerAction = oneOf(CUSTOMER_ACTIONS);
const isIneligibility = oneOf(INELIGIBILITY);

function isItem(value: unknown) {
  return isRecord(value) && isId(value.id) && isString(value.productName) && isQuantity(value.quantity) &&
    isMoney(value.productPrice) && isMoney(value.subtotal);
}

function isEvent(value: unknown, staff: boolean) {
  return isRecord(value) && isId(value.id) && isOrderStatus(value.status) && isString(value.description) &&
    (value.location === undefined || isNullableString(value.location)) && isTimestamp(value.createdAt) &&
    (value.actorType === null || isActorType(value.actorType)) &&
    (!staff || (isNullableString(value.actorId) && isNullableString(value.reason)));
}

function isFulfilment(value: unknown) {
  return isRecord(value) && FULFILMENT_FIELDS.every((field) => isNullableTimestamp(value[field]));
}

function isReturnLine(value: unknown, staff: boolean) {
  return isRecord(value) && isId(value.id) && isId(value.orderItemId) && isQuantity(value.quantity) &&
    isReturnRule(value.returnRule) && isNullableCount(value.receivedQuantity) && isNullableCount(value.refundableQuantity) &&
    isString(value.productName) && isQuantity(value.purchased) && (!staff || isNullableCount(value.restockQuantity));
}

function isReturn(value: unknown, staff: boolean) {
  return isRecord(value) && isId(value.id) && isId(value.number) && isReturnStatus(value.status) &&
    isReturnReason(value.reason) && isNullableString(value.comment) && typeof value.unopenedDeclared === "boolean" &&
    isTimestamp(value.requestedAt) && isNullableTimestamp(value.decidedAt) && isNullableString(value.decisionNote) &&
    isNullableTimestamp(value.receivedAt) && (value.merchantFaultConfirmed === null || typeof value.merchantFaultConfirmed === "boolean") &&
    isNullableString(value.inspectionNote) && listOf(value.lines, (line) => isReturnLine(line, staff)) &&
    (!staff || (isId(value.orderId) && isTimestamp(value.updatedAt)));
}

function isRefund(value: unknown, staff: boolean) {
  if (!isRecord(value) || !isId(value.id) || !isId(value.number) || !isRefundSource(value.source) ||
    !isRefundStatus(value.status) || !isMoney(value.amount) || typeof value.includesDeliveryFee !== "boolean" ||
    !isString(value.method) || !isTimestamp(value.requestedAt) || !isNullableTimestamp(value.approvedAt) ||
    !isNullableTimestamp(value.confirmedAt) || !isNullableString(value.providerReference)) return false;
  // A provider reference is evidence that money was sent; only a confirmed refund may carry one.
  if (value.status !== "CONFIRMED" && value.providerReference !== null) return false;
  if (!staff) return true;
  return isId(value.orderId) && isNullableId(value.paymentId) && isNullableId(value.returnRequestId) &&
    isMoney(value.requestedAmount) && isNullableString(value.reason) && isString(value.requestedByType) &&
    isNullableTimestamp(value.processingAt) && isNullableTimestamp(value.failedAt) && isNullableString(value.failureReason) &&
    isNullableTimestamp(value.unresolvedAt) && isNullableString(value.unresolvedNote) &&
    isNullableTimestamp(value.cancelledAt) && isNullableString(value.cancellationReason) &&
    uniqueListOf(value.allowedActions, isRefundAction) && isTimestamp(value.updatedAt);
}

function isPolicyTerms(value: unknown) {
  return isRecord(value) && isReturnWindowDays(value.windowDays) && isDeliveryFeeRefund(value.deliveryFeeRefund) &&
    value.refundRounding === "UP_TO_WHOLE_KES" && value.refundMethod === "MPESA_MANUAL" &&
    Array.isArray(value.resolutions) && value.resolutions.length > 0 && value.resolutions.every((item) => item === "REFUND");
}

function isEligibilityLine(value: unknown) {
  return isRecord(value) && isId(value.orderItemId) && isString(value.productName) && isQuantity(value.purchased) &&
    isCount(value.requested) && isCount(value.returnableQuantity) && value.returnableQuantity <= value.purchased &&
    isReturnRule(value.returnRule) && uniqueListOf(value.allowedReasons, isReturnReason) && value.allowedReasons.length > 0;
}

function isEligibility(value: unknown) {
  if (!isRecord(value) || typeof value.eligible !== "boolean") return false;
  const reasonConsistent = value.reasonCode === null ? value.eligible : !value.eligible && isIneligibility(value.reasonCode);
  return reasonConsistent && isNullableTimestamp(value.windowEndsAt) && isPolicyTerms(value.policy) &&
    listOf(value.lines, isEligibilityLine);
}

function isRefundRequestOption(value: unknown) {
  if (!isRecord(value) || !isMoney(value.maxAmount) || !Number.isInteger(value.maxAmount) || value.maxAmount < 1) return false;
  if (value.source === "CANCELLATION") return true;
  return value.source === "RETURN" && isId(value.returnId) && isId(value.returnNumber);
}

/** Checks one order view; `detail` names the first part that failed. */
function orderProblem(value: unknown, staff: boolean): string | null {
  if (!isRecord(value) || !isId(value.id) || !isId(value.orderNumber) || !isTimestamp(value.createdAt)) return "order";
  if (!isOrderStatus(value.status) || !isPaymentStatus(value.paymentStatus) || !isDeliveryMethod(value.deliveryMethod) ||
    !isString(value.paymentMethod)) return "order status";
  if (![value.subtotal, value.discount, value.tax, value.shippingCost, value.total].every(isMoney)) return "order totals";
  if (!Array.isArray(value.items) || !value.items.length || !value.items.every(isItem)) return "order items";
  if (!listOf(value.trackingHistory, (event) => isEvent(event, staff))) return "tracking history";
  if (!isFulfilment(value.fulfilment)) return "fulfilment";
  if (!listOf(value.returns, (item) => isReturn(item, staff))) return "returns";
  if (!listOf(value.refunds, (item) => isRefund(item, staff))) return "refunds";
  if (!isEligibility(value.returnEligibility)) return "return eligibility";
  if (!uniqueListOf(value.customerActions, isCustomerAction)) return "customer actions";
  if (!staff) return null;
  if (!uniqueListOf(value.allowedActions, isStaffAction) || typeof value.paymentReviewOpen !== "boolean") return "staff actions";
  if (!listOf(value.refundRequestOptions, isRefundRequestOption)) return "refund request options";
  if (value.user !== undefined && value.user !== null &&
    !(isRecord(value.user) && isId(value.user.id) && isString(value.user.email))) return "customer";
  return null;
}

/** Validates a customer order view (`GET /orders/:id`, cancellation and return responses). */
export function parseCustomerOrder(data: unknown, expectedId?: string): CustomerOrder {
  const problem = orderProblem(data, false);
  if (problem) throw new OrderFormatError(problem);
  const order = data as CustomerOrder;
  if (expectedId !== undefined && order.id !== expectedId) throw new OrderFormatError("order identity");
  return order;
}

/** Validates a staff order view, including the fulfilment actions the server would accept now. */
export function parseStaffOrder(data: unknown, expectedId?: string): StaffOrder {
  const problem = orderProblem(data, true);
  if (problem) throw new OrderFormatError(problem);
  const order = data as StaffOrder;
  if (expectedId !== undefined && order.id !== expectedId) throw new OrderFormatError("order identity");
  return order;
}

export function isPagination(value: unknown): value is Pagination {
  return isRecord(value) && isQuantity(value.page) && isQuantity(value.limit) && isCount(value.total) && isCount(value.pages);
}

function parsePage<T>(data: unknown, key: string, parse: (item: unknown) => T): { items: T[]; pagination: Pagination } {
  if (!isRecord(data) || !Array.isArray(data[key]) || !isPagination(data.pagination)) throw new OrderFormatError(`${key} page`);
  return { items: (data[key] as unknown[]).map(parse), pagination: data.pagination };
}

export function parseCustomerOrderPage(data: unknown): { orders: CustomerOrder[]; pagination: Pagination } {
  const { items, pagination } = parsePage(data, "orders", (item) => parseCustomerOrder(item));
  return { orders: items, pagination };
}

/** Validates public tracking (`GET /orders/track/:number`): the order's status and each recorded step with its time. */
export function parseOrderTracking(data: unknown): OrderTracking {
  if (!isRecord(data) || !isId(data.orderNumber) || !isOrderStatus(data.status) ||
    !listOf(data.trackingHistory, (event) => isEvent(event, false))) {
    throw new OrderFormatError("tracking");
  }
  return data as unknown as OrderTracking;
}

export function parseStaffOrderPage(data: unknown): StaffOrderPage {
  const { items, pagination } = parsePage(data, "orders", (item) => parseStaffOrder(item));
  return { orders: items, pagination };
}

export function parseReturnPage(data: unknown): ReturnPage {
  const { items, pagination } = parsePage(data, "returns", (item) => {
    if (!isReturn(item, true) || !isRecord(item) || !isId(item.orderNumber) || typeof item.isDemo !== "boolean") {
      throw new OrderFormatError("return");
    }
    return item as unknown as ListedReturn;
  });
  return { returns: items, pagination };
}

export function parseRefundPage(data: unknown): RefundPage {
  const { items, pagination } = parsePage(data, "refunds", (item) => {
    if (!isRefund(item, true) || !isRecord(item) || !isId(item.orderNumber) || typeof item.isDemo !== "boolean") {
      throw new OrderFormatError("refund");
    }
    return item as unknown as ListedRefund;
  });
  return { refunds: items, pagination };
}

/** `POST /orders/:id/returns`: the created (or replayed) request and the refreshed order. */
export function parseReturnRequestResult(data: unknown, orderId: string): ReturnRequestResult {
  if (!isRecord(data) || !isReturn(data.returnRequest, false)) throw new OrderFormatError("return request");
  return { returnRequest: data.returnRequest as OrderReturn, order: parseCustomerOrder(data.order, orderId) };
}

/** `POST /orders/admin/refunds/:id/:action` and payment-review refunds: the refund and its refreshed order. */
export function parseRefundResult(data: unknown, refundId?: string): { refund: StaffRefund; order: StaffOrder } {
  if (!isRecord(data) || !isRefund(data.refund, true)) throw new OrderFormatError("refund");
  const refund = data.refund as StaffRefund;
  if (refundId !== undefined && refund.id !== refundId) throw new OrderFormatError("refund identity");
  return { refund, order: parseStaffOrder(data.order, refund.orderId) };
}

function isAttentionItem(value: unknown) {
  return isRecord(value) && isId(value.key) && oneOf(ATTENTION_TYPES)(value.type) && oneOf(SEVERITIES)(value.severity) &&
    isString(value.title) && isString(value.detail) && isNullableId(value.orderId) && isNullableString(value.orderNumber) &&
    isId(value.entityId) && isTimestamp(value.since) && typeof value.read === "boolean";
}

export function parseAttention(data: unknown): AttentionItem[] {
  if (!isRecord(data) || !listOf<AttentionItem>(data.items, isAttentionItem)) throw new OrderFormatError("attention items");
  return data.items;
}

export function parseNotificationReport(data: unknown, id: string): NotificationReport {
  if (!isRecord(data) || data.id !== id || !isString(data.type) || !oneOf(NOTIFICATION_STATUSES)(data.status) ||
    !isNullableId(data.orderId) || !isCount(data.attempts) || !isNullableString(data.lastErrorCode) ||
    !isNullableTimestamp(data.nextAttemptAt) || !isNullableTimestamp(data.sentAt) || !isTimestamp(data.createdAt)) {
    throw new OrderFormatError("notification");
  }
  return data as unknown as NotificationReport;
}
