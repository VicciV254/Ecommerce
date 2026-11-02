import { isAxiosError, isCancel } from "axios";
import { apiErrorCode, apiStatus, describeApiError } from "../api/errors";
import type {
  PaymentAttempt,
  PaymentAttemptStatus,
  PaymentEnvironment,
  PaymentOrderSummary,
  PaymentOverview,
} from "../api/mpesa";
import type { Order } from "../api/orders";
import { STORAGE_NAMESPACE, isRecord, readStoredJson, writeStoredJson } from "../utils/storage";
import { isMoney } from "./catalogModel";
import { isIdempotencyKey, isOrderStatus, isPaymentStatus, isReservationStatus } from "./checkoutModel";

/* ------------------------------------------------------------------ */
/* Boundary validation: a malformed payment answer is never trusted   */
/* ------------------------------------------------------------------ */

export class PaymentFormatError extends Error {
  constructor(detail: string) {
    super(`The payment response was not in the expected format (${detail}).`);
    this.name = "PaymentFormatError";
  }
}

const MAX_TEXT = 1000;
const MAX_CODE = 64;
/** Display bound; the server allows far fewer attempts per order. */
const MAX_ATTEMPTS = 20;

const isString = (value: unknown): value is string => typeof value === "string";
const isId = (value: unknown): value is string => isString(value) && value !== "" && value.length <= MAX_CODE * 2;
const isText = (value: unknown, max = MAX_TEXT): value is string => isString(value) && value.length <= max;
const isNullableText = (value: unknown, max = MAX_TEXT): value is string | null => value === null || isText(value, max);
const isTimestamp = (value: unknown): value is string => isString(value) && !Number.isNaN(Date.parse(value));
const isNullableTimestamp = (value: unknown): value is string | null => value === null || isTimestamp(value);

const ATTEMPT_STATUSES: readonly PaymentAttemptStatus[] = ["INITIATING", "PENDING", "UNKNOWN", "REVIEW", "SUCCEEDED", "FAILED"];
const ENVIRONMENTS: readonly PaymentEnvironment[] = ["sandbox", "production"];
const isAttemptStatus = (value: unknown): value is PaymentAttemptStatus => ATTEMPT_STATUSES.some((status) => status === value);
const isEnvironment = (value: unknown): value is PaymentEnvironment => ENVIRONMENTS.some((environment) => environment === value);

function isAttempt(value: unknown): value is PaymentAttempt {
  return isRecord(value) && isId(value.id) && isId(value.orderId) && isAttemptStatus(value.status) &&
    isEnvironment(value.environment) && isMoney(value.amount) && Number.isInteger(value.amount) && value.amount > 0 &&
    isText(value.phoneMasked, MAX_CODE) && isNullableText(value.receiptNumber, MAX_CODE) &&
    isNullableTimestamp(value.confirmedAt) && typeof value.reviewRequired === "boolean" &&
    isNullableText(value.reasonCode, MAX_CODE) && isText(value.message) && isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt) && isNullableTimestamp(value.nextCheckAt) && typeof value.canReconcile === "boolean";
}

/** Validates an attempt from a prompt request or status check, and that it is the attempt asked about. */
export function parsePaymentAttempt(data: unknown, expected: { id?: string; orderId?: string } = {}): PaymentAttempt {
  if (!isAttempt(data)) throw new PaymentFormatError("attempt");
  if ((expected.id !== undefined && data.id !== expected.id) || (expected.orderId !== undefined && data.orderId !== expected.orderId)) {
    throw new PaymentFormatError("attempt identity");
  }
  return data;
}

function isOrderSummary(value: unknown): value is PaymentOrderSummary {
  return isRecord(value) && isId(value.id) && isText(value.orderNumber, MAX_CODE) && isMoney(value.total) &&
    isOrderStatus(value.status) && isPaymentStatus(value.paymentStatus) && isReservationStatus(value.reservationStatus) &&
    isNullableTimestamp(value.reservationExpiresAt) && typeof value.isDemo === "boolean";
}

/** Validates a payment overview, and that it describes the order that was asked about. */
export function parsePaymentOverview(data: unknown, orderId: string): PaymentOverview {
  if (!isRecord(data) || !isOrderSummary(data.order) || data.order.id !== orderId) throw new PaymentFormatError("order");
  if (typeof data.available !== "boolean" || !(data.environment === null || isEnvironment(data.environment)) ||
    !isNullableText(data.reasonCode, MAX_CODE) || !isNullableText(data.message)) {
    throw new PaymentFormatError("availability");
  }
  if (!Array.isArray(data.attempts) || data.attempts.length > MAX_ATTEMPTS ||
    !data.attempts.every((attempt: unknown) => isAttempt(attempt) && attempt.orderId === orderId)) {
    throw new PaymentFormatError("attempts");
  }
  return {
    order: data.order, available: data.available, environment: data.environment,
    reasonCode: data.reasonCode, message: data.message,
    attempts: data.attempts.map((attempt: unknown) => parsePaymentAttempt(attempt, { orderId })),
  };
}

/* ------------------------------------------------------------------ */
/* Phone numbers: the server's rules, so mistakes are caught early    */
/* ------------------------------------------------------------------ */

const PHONE_TEXT = /^\+?[\d ()-]+$/;
const MAX_PHONE_TEXT = 32;
const NATIONAL_NUMBER = /^[17]\d{8}$/;
const MPESA_NUMBER = /^254[17]\d{8}$/;

export const PHONE_HINT = "Enter a Kenyan mobile number beginning with 07, 01 or +254.";

/** The server's normalized form (2547… or 2541…) of a Kenyan mobile number, or `null` when it cannot be one. */
export function normalizeMpesaPhone(input: string): string | null {
  const text = input.trim();
  if (!text || text.length > MAX_PHONE_TEXT || !PHONE_TEXT.test(text)) return null;
  let digits = text.replace(/[ ()-]/g, "").replace(/^\+/, "");
  if (digits.startsWith("0")) digits = `254${digits.slice(1)}`;
  else if (NATIONAL_NUMBER.test(digits)) digits = `254${digits}`;
  return MPESA_NUMBER.test(digits) ? digits : null;
}

/* ------------------------------------------------------------------ */
/* Prompt request intent: saved before sending, settled, then removed */
/* ------------------------------------------------------------------ */

/**
 * A prompt request saved before it is sent, so a lost response is settled with the same key rather
 * than a new one. Scoped to one customer and one order; removed once the outcome is known.
 */
export type PaymentIntent = {
  ownerId: string;
  orderId: string;
  idempotencyKey: string;
  /** Normalized number, kept only until the outcome is known so that a retry is identical. */
  phone: string;
  /** Attempts the order already had, so the server's record of this request can be recognised. */
  priorAttemptIds: string[];
  createdAt: string;
};

export function paymentIntentKey(ownerId: string, orderId: string) {
  return `${STORAGE_NAMESPACE}:payment-intent:${encodeURIComponent(ownerId)}:${encodeURIComponent(orderId)}`;
}

function isPaymentIntent(value: unknown, ownerId: string, orderId: string): value is PaymentIntent {
  return isRecord(value) && value.ownerId === ownerId && value.orderId === orderId && isIdempotencyKey(value.idempotencyKey) &&
    isString(value.phone) && MPESA_NUMBER.test(value.phone) && Array.isArray(value.priorAttemptIds) &&
    value.priorAttemptIds.length <= MAX_ATTEMPTS && value.priorAttemptIds.every(isId) && isTimestamp(value.createdAt);
}

/** The saved request for this customer and order. An entry that cannot be used is removed. */
export function readPaymentIntent(ownerId: string, orderId: string): PaymentIntent | null {
  const key = paymentIntentKey(ownerId, orderId);
  try {
    const stored = readStoredJson(key);
    if (isPaymentIntent(stored, ownerId, orderId)) return stored;
    localStorage.removeItem(key);
  } catch {
    // Storage is unavailable: nothing can be resumed, and saving a new request is refused.
  }
  return null;
}

/**
 * Saves a new request and confirms it reads back before the caller sends it. `false` means it was not
 * saved, or another request for this order (perhaps from another tab) is still unresolved.
 */
export function savePaymentIntent(intent: PaymentIntent): boolean {
  const key = paymentIntentKey(intent.ownerId, intent.orderId);
  try {
    if (localStorage.getItem(key) !== null) return false;
    writeStoredJson(key, intent);
    const saved = readStoredJson(key);
    return isPaymentIntent(saved, intent.ownerId, intent.orderId) &&
      saved.idempotencyKey === intent.idempotencyKey && saved.phone === intent.phone;
  } catch {
    return false;
  }
}

/** Forgets a request whose outcome is known; a different request saved under the same key is kept. */
export function clearPaymentIntent(intent: PaymentIntent) {
  const key = paymentIntentKey(intent.ownerId, intent.orderId);
  try {
    const stored = readStoredJson(key);
    if (isRecord(stored) && stored.idempotencyKey !== intent.idempotencyKey) return;
    localStorage.removeItem(key);
  } catch {
    // Left in place, it is settled against the server again on the next visit.
  }
}

/** Whether the order has an attempt that did not exist when the request was saved: the server's record of it. */
export function hasNewAttempt(overview: PaymentOverview, intent: PaymentIntent): boolean {
  return overview.attempts.some((attempt) => !intent.priorAttemptIds.includes(attempt.id));
}

/* ------------------------------------------------------------------ */
/* Prompt request failures                                            */
/* ------------------------------------------------------------------ */

export type PromptFailure =
  /** The customer session changed or the request was abandoned; the result belongs to nobody on screen. */
  | { kind: "cancelled" }
  /** No reliable answer: an attempt may exist. Keep the request and settle it from the server's record. */
  | { kind: "unknown"; message: string }
  /** Definitely refused: this request created nothing. */
  | { kind: "rejected"; code?: string; message: string; field: "phone" | null };

const REQUEST_TIMEOUT = 408;
const SERVER_ERROR = 500;
/** Answers that leave the outcome open; only the same request (same key) may be sent again. */
const OPEN_CODES = new Set(["PAYMENT_PERSISTENCE_UNKNOWN", "PAYMENT_STORAGE_ERROR", "PAYMENT_RETRY"]);
/** Configuration refusals raised before anything is recorded or sent to M-Pesa. */
const SWITCHED_OFF_CODES = new Set(["MPESA_DISABLED", "MPESA_CONFIGURATION", "MPESA_LIVE_DISABLED"]);
const PHONE_CODES = new Set(["PHONE_INVALID", "SANDBOX_PHONE_NOT_ALLOWED"]);

export const UNKNOWN_PROMPT_MESSAGE =
  "We could not confirm whether your M-Pesa prompt was requested. Do not start another payment while this is checked.";

export function classifyPromptFailure(error: unknown): PromptFailure {
  if (isCancel(error)) return { kind: "cancelled" };
  if (!isAxiosError(error)) return { kind: "unknown", message: UNKNOWN_PROMPT_MESSAGE };
  const status = apiStatus(error);
  const code = apiErrorCode(error);
  const open = code !== undefined && OPEN_CODES.has(code);
  const switchedOff = code !== undefined && SWITCHED_OFF_CODES.has(code);
  if (status === undefined || status === REQUEST_TIMEOUT || open || (status >= SERVER_ERROR && !switchedOff)) {
    return { kind: "unknown", message: UNKNOWN_PROMPT_MESSAGE };
  }
  return {
    kind: "rejected",
    code,
    field: code !== undefined && PHONE_CODES.has(code) ? "phone" : null,
    message: describeApiError(error, "The M-Pesa prompt could not be requested."),
  };
}

/* ------------------------------------------------------------------ */
/* What the customer sees                                             */
/* ------------------------------------------------------------------ */

export type AttemptStage =
  | "submitting"
  | "waiting"
  /** The provider outcome is unknown: check this attempt, never pay again. */
  | "unconfirmed"
  /** Needs verification or staff review; no money has been confirmed. */
  | "verifying"
  /** Money arrived, but staff must review the order before fulfilment or refund. */
  | "received-review"
  | "paid"
  | "failed";

export function attemptStage(attempt: PaymentAttempt): AttemptStage {
  if (attempt.confirmedAt) return attempt.status === "SUCCEEDED" ? "paid" : "received-review";
  switch (attempt.status) {
    case "INITIATING":
      return "submitting";
    case "PENDING":
      return "waiting";
    case "UNKNOWN":
      return "unconfirmed";
    case "FAILED":
      return "failed";
    default:
      // REVIEW, or a success without confirmation evidence: never presented as paid.
      return "verifying";
  }
}

const OPEN_STAGES: readonly AttemptStage[] = ["submitting", "waiting", "unconfirmed", "verifying"];
const WATCHED_STAGES: readonly AttemptStage[] = ["submitting", "waiting", "unconfirmed"];

/**
 * Outcome still open, so its status is worth reading again. Whether the server may also ask M-Pesa is
 * the attempt's own `canReconcile`, never inferred from its status.
 */
export const isOpenAttempt = (attempt: PaymentAttempt) => OPEN_STAGES.includes(attemptStage(attempt));
/** Outcome still open and expected to change soon: checked automatically for a bounded time. */
export const isWatchedAttempt = (attempt: PaymentAttempt) => WATCHED_STAGES.includes(attemptStage(attempt));

/** The attempt that decides what is shown: money received on any attempt outranks newer ones. */
export function currentAttempt(overview: PaymentOverview): PaymentAttempt | null {
  return overview.attempts.find((attempt) => attempt.confirmedAt !== null) ?? overview.attempts[0] ?? null;
}

export type PaymentView =
  /** A request was saved but its outcome is unknown; `retryable` once the server shows no record of it. */
  | { kind: "unresolved"; retryable: boolean }
  | { kind: "attempt"; attempt: PaymentAttempt; stage: Exclude<AttemptStage, "failed"> }
  /** A new prompt may be requested; `failed` is the previous attempt when it did not complete. */
  | { kind: "payable"; failed: PaymentAttempt | null }
  /** No prompt can be requested; `waiting` when a short wait after a failure is the only reason. */
  | { kind: "unavailable"; failed: PaymentAttempt | null; message: string; waiting: boolean };

const UNAVAILABLE_MESSAGE = "M-Pesa payment is not available for this order right now.";
const FRACTIONAL_MESSAGE = "This order total cannot be collected through M-Pesa without rounding, so no prompt can be sent.";

const isWholeKes = (amount: number) => Number.isInteger(amount) && amount > 0;

export function paymentView(overview: PaymentOverview, intent: { checked: boolean } | null): PaymentView {
  if (intent) return { kind: "unresolved", retryable: intent.checked };
  const attempt = currentAttempt(overview);
  const stage = attempt ? attemptStage(attempt) : null;
  if (attempt && stage && stage !== "failed") return { kind: "attempt", attempt, stage };
  if (overview.available) {
    return isWholeKes(overview.order.total)
      ? { kind: "payable", failed: attempt }
      : { kind: "unavailable", failed: attempt, message: FRACTIONAL_MESSAGE, waiting: false };
  }
  return {
    kind: "unavailable", failed: attempt, message: overview.message ?? UNAVAILABLE_MESSAGE,
    waiting: overview.reasonCode === "PAYMENT_COOLDOWN",
  };
}

/** The overview with one attempt replaced, or added as the newest, from a newer server answer. */
export function withAttempt(overview: PaymentOverview, attempt: PaymentAttempt): PaymentOverview {
  const index = overview.attempts.findIndex((item) => item.id === attempt.id);
  const attempts = index < 0 ? [attempt, ...overview.attempts] : overview.attempts.map((item, i) => (i === index ? attempt : item));
  return { ...overview, attempts };
}

/** The order with the payment service's latest status; the same object when nothing changed. */
export function withPaymentSummary<T extends Order>(order: T, summary: PaymentOrderSummary): T {
  if (order.id !== summary.id) return order;
  const { status, paymentStatus, reservationStatus, reservationExpiresAt } = summary;
  if (order.status === status && order.paymentStatus === paymentStatus && order.reservationStatus === reservationStatus &&
    (order.reservationExpiresAt ?? null) === reservationExpiresAt) return order;
  return { ...order, status, paymentStatus, reservationStatus, reservationExpiresAt };
}

/* ------------------------------------------------------------------ */
/* Staff guidance and automatic checks                                */
/* ------------------------------------------------------------------ */

const VERIFY = "Verify the transaction with M-Pesa before any fulfilment or refund.";
const STAFF_GUIDANCE: Record<string, string> = {
  RECEIPT_PENDING: "M-Pesa reported success, but the receipt callback has not arrived. Check again later before deciding anything.",
  PROVIDER_ID_MISMATCH: `M-Pesa identifiers did not match this attempt. ${VERIFY}`,
  QUERY_ID_MISMATCH: `M-Pesa identifiers did not match this attempt. ${VERIFY}`,
  CALLBACK_MISMATCH: `The callback amount, phone or receipt did not match this attempt. ${VERIFY}`,
  CONFLICTING_CALLBACK: `M-Pesa sent conflicting results for this attempt. ${VERIFY}`,
  CONFLICTING_RESULT: `M-Pesa sent conflicting results for this attempt. ${VERIFY}`,
  RECEIPT_REUSED: `This receipt is already linked to another attempt. ${VERIFY}`,
  RECEIPT_CONFLICT: `This receipt is already linked to another attempt. ${VERIFY}`,
  ORDER_AMOUNT_CHANGED: "Money was received, but the order total differs from the amount paid. Review before fulfilment or refund.",
  EXTRA_PAYMENT: "Money was received for an order that was no longer awaiting payment. Review whether a refund is due.",
  RESERVATION_UNAVAILABLE: "Money was received after the reservation ended or the order was cancelled. Check stock, then decide fulfilment or refund.",
  RECONCILIATION_EXHAUSTED: `Automatic checks ended without a result. ${VERIFY}`,
  MPESA_MERCHANT_CHANGED: `The M-Pesa merchant configuration changed after this attempt. ${VERIFY}`,
  PROVIDER_REFERENCE_PENDING: "M-Pesa has not returned a reference for this request yet.",
  PROVIDER_QUERY_PENDING: "M-Pesa has not reported a final result yet.",
  PROVIDER_QUERY_UNAVAILABLE: "M-Pesa could not be reached for a status check.",
  PROVIDER_AUTH_UNAVAILABLE: "M-Pesa could not be reached.",
  PROVIDER_REJECTED: "M-Pesa refused to start this request.",
  PROVIDER_OUTCOME_UNKNOWN: "M-Pesa did not confirm whether it accepted this request.",
  PROVIDER_RESPONSE_INVALID: "M-Pesa returned an unexpected answer to this request.",
  PAYMENT_WRITE_FAILED: "A verification result could not be saved. Check again.",
};

/** Actionable explanation of an attempt's reason code for staff; unknown codes are shown as they are. */
export function staffGuidance(attempt: PaymentAttempt): string | null {
  if (!attempt.reasonCode) return null;
  return STAFF_GUIDANCE[attempt.reasonCode] ?? `Reason code: ${attempt.reasonCode}.`;
}

/** Automatic checks stop this long after the panel starts watching an attempt. */
export const AUTO_CHECK_HORIZON_MS = 5 * 60 * 1000;
const AUTO_CHECK_MIN_MS = 5_000;
const AUTO_CHECK_MAX_MS = 60_000;
const AUTO_CHECK_DEFAULT_MS = 10_000;

/** Delay before the next automatic check: the server's suggested time, kept within sensible bounds. */
export function autoCheckDelay(attempt: PaymentAttempt, now = Date.now()): number {
  const due = attempt.nextCheckAt ? Date.parse(attempt.nextCheckAt) - now : AUTO_CHECK_DEFAULT_MS;
  return Math.min(Math.max(due, AUTO_CHECK_MIN_MS), AUTO_CHECK_MAX_MS);
}
