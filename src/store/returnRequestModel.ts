import { isAxiosError, isCancel } from "axios";
import { apiErrorCode, apiStatus, describeApiError } from "../api/errors";
import type { ReturnEligibility, ReturnEligibilityLine, ReturnReason, ReturnRequestBody } from "../api/orders";
import { STORAGE_NAMESPACE, isRecord, readStoredJson, writeStoredJson } from "../utils/storage";
import { isIdempotencyKey } from "./checkoutModel";
import { RETURN_REASONS, isReturnReason } from "./orderModel";
import { isFaultReason } from "./orderCopy";

/* ------------------------------------------------------------------ */
/* Choosing items, quantities and a reason                            */
/* ------------------------------------------------------------------ */

/** Units chosen per order item; absent or 0 means the item is not being returned. */
type ReturnSelection = Readonly<Record<string, number>>;

export const MAX_RETURN_COMMENT = 1000;

/** Lines the customer has chosen, in the order's own line order. */
export function selectedLines(eligibility: ReturnEligibility, selection: ReturnSelection): ReturnEligibilityLine[] {
  return eligibility.lines.filter((line) => (selection[line.orderItemId] ?? 0) > 0);
}

/** A quantity kept within 0 and the units still returnable on this line. */
export function clampReturnQuantity(line: ReturnEligibilityLine, value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(line.returnableQuantity, Math.max(0, Math.trunc(value)));
}

/**
 * Reasons accepted by every selected line (each line's `allowedReasons`). Before anything is chosen, the
 * reasons any returnable line accepts are offered.
 */
export function reasonChoices(eligibility: ReturnEligibility, selection: ReturnSelection): ReturnReason[] {
  const chosen = selectedLines(eligibility, selection);
  const lines = chosen.length ? chosen : eligibility.lines.filter((line) => line.returnableQuantity > 0);
  if (!lines.length) return [];
  return RETURN_REASONS.filter((reason) => chosen.length
    ? lines.every((line) => line.allowedReasons.includes(reason))
    : lines.some((line) => line.allowedReasons.includes(reason)));
}

/** Unopened-or-fault items returned for a non-fault reason need the customer's unopened declaration. */
export function needsUnopenedDeclaration(lines: readonly ReturnEligibilityLine[], reason: ReturnReason | null): boolean {
  return reason !== null && !isFaultReason(reason) && lines.some((line) => line.returnRule === "UNOPENED_OR_FAULT");
}

type ReturnForm = {
  selection: ReturnSelection;
  reason: ReturnReason | null;
  unopened: boolean;
  comment: string;
};

export type ReturnFormProblem = "items" | "reason" | "unopened" | "comment";

/** The first thing stopping this form from being sent, checked in the order the fields appear. */
export function returnFormProblem(eligibility: ReturnEligibility, form: ReturnForm): ReturnFormProblem | null {
  const lines = selectedLines(eligibility, form.selection);
  if (!lines.length) return "items";
  if (!form.reason || !reasonChoices(eligibility, form.selection).includes(form.reason)) return "reason";
  if (needsUnopenedDeclaration(lines, form.reason) && !form.unopened) return "unopened";
  if (form.comment.trim().length > MAX_RETURN_COMMENT) return "comment";
  return null;
}

/** The exact request body; an empty comment is omitted because the server refuses blank notes. */
export function returnRequestBody(eligibility: ReturnEligibility, form: ReturnForm & { reason: ReturnReason }): ReturnRequestBody {
  const lines = selectedLines(eligibility, form.selection);
  const comment = form.comment.trim();
  return {
    reason: form.reason,
    ...(comment && { comment }),
    ...(needsUnopenedDeclaration(lines, form.reason) && form.unopened && { unopenedDeclared: true }),
    lines: lines.map((line) => ({ orderItemId: line.orderItemId, quantity: clampReturnQuantity(line, form.selection[line.orderItemId] ?? 0) })),
  };
}

/* ------------------------------------------------------------------ */
/* Request intent: saved before sending, so a lost answer is retried   */
/* with the same key instead of creating a second request              */
/* ------------------------------------------------------------------ */

export type ReturnIntent = {
  ownerId: string;
  orderId: string;
  idempotencyKey: string;
  body: ReturnRequestBody;
  createdAt: string;
};

const MAX_LINES = 100;

export function returnIntentKey(ownerId: string, orderId: string) {
  return `${STORAGE_NAMESPACE}:return-intent:${encodeURIComponent(ownerId)}:${encodeURIComponent(orderId)}`;
}

function isRequestBody(value: unknown): value is ReturnRequestBody {
  if (!isRecord(value) || !isReturnReason(value.reason)) return false;
  if (value.comment !== undefined && !(typeof value.comment === "string" && value.comment.trim() && value.comment.length <= MAX_RETURN_COMMENT)) return false;
  if (value.unopenedDeclared !== undefined && value.unopenedDeclared !== true) return false;
  return Array.isArray(value.lines) && value.lines.length > 0 && value.lines.length <= MAX_LINES &&
    value.lines.every((line: unknown) => isRecord(line) && typeof line.orderItemId === "string" && line.orderItemId !== "" &&
      Number.isInteger(line.quantity) && Number(line.quantity) > 0);
}

function isReturnIntent(value: unknown, ownerId: string, orderId: string): value is ReturnIntent {
  return isRecord(value) && value.ownerId === ownerId && value.orderId === orderId && isIdempotencyKey(value.idempotencyKey) &&
    isRequestBody(value.body) && typeof value.createdAt === "string" && !Number.isNaN(Date.parse(value.createdAt));
}

/** The unresolved request for this customer and order. An entry that cannot be used is removed. */
export function readReturnIntent(ownerId: string, orderId: string): ReturnIntent | null {
  const key = returnIntentKey(ownerId, orderId);
  try {
    const stored = readStoredJson(key);
    if (isReturnIntent(stored, ownerId, orderId)) return stored;
    localStorage.removeItem(key);
  } catch {
    // Storage is unavailable: nothing can be resumed, and saving a new request is refused.
  }
  return null;
}

/** Saves a new request and confirms it reads back before it is sent; `false` means it must not be sent. */
export function saveReturnIntent(intent: ReturnIntent): boolean {
  const key = returnIntentKey(intent.ownerId, intent.orderId);
  try {
    if (localStorage.getItem(key) !== null) return false;
    writeStoredJson(key, intent);
    const saved = readStoredJson(key);
    return isReturnIntent(saved, intent.ownerId, intent.orderId) && saved.idempotencyKey === intent.idempotencyKey;
  } catch {
    return false;
  }
}

/** Forgets a request whose outcome is known; another request saved under the same key is kept. */
export function clearReturnIntent(intent: ReturnIntent) {
  const key = returnIntentKey(intent.ownerId, intent.orderId);
  try {
    const stored = readStoredJson(key);
    if (isRecord(stored) && stored.idempotencyKey !== intent.idempotencyKey) return;
    localStorage.removeItem(key);
  } catch {
    // Left in place, it is retried with the same key on the next visit.
  }
}

/* ------------------------------------------------------------------ */
/* Failures                                                            */
/* ------------------------------------------------------------------ */

type ReturnFailure =
  /** The customer session changed; the answer belongs to nobody on screen. */
  | { kind: "cancelled" }
  /** No reliable answer, or the server asked for a retry: keep the request and resend it with the same key. */
  | { kind: "unresolved"; message: string }
  /** Definitely refused: nothing was created. `refresh` when the order's return state may have changed. */
  | { kind: "rejected"; code?: string; message: string; refresh: boolean };

export const UNRESOLVED_RETURN_MESSAGE =
  "We could not confirm whether your return request was received. Retry the same request; it will not be submitted twice.";
export const UNSAVED_RETURN_MESSAGE =
  "This browser could not save your return request, so it was not sent. Check that site storage is available and try again.";
const RETRY_MESSAGE = "The order was busy, so your request was not saved yet. Retry the same request; it will not be submitted twice.";

const REJECTIONS: Record<string, { message: string; refresh: boolean; detail?: boolean }> = {
  RETURN_WINDOW_CLOSED: { message: "The return window for this order has closed, so a return can no longer be requested.", refresh: true },
  RETURN_NOT_ELIGIBLE: { message: "This order cannot be returned right now.", refresh: true, detail: true },
  RETURN_QUANTITY_INVALID: {
    message: "Some of those quantities can no longer be returned. Your order has been refreshed; check the quantities and try again.",
    refresh: true, detail: true,
  },
  RETURN_REASON_NOT_ALLOWED: { message: "That reason does not apply to one of the selected items.", refresh: false, detail: true },
  IDEMPOTENCY_CONFLICT: {
    message: "This return request could not be matched safely, so nothing was submitted. Check your choices and submit again.",
    refresh: false,
  },
  IDEMPOTENCY_KEY_REQUIRED: { message: "This request could not be sent safely, so nothing was submitted. Reload the page and try again.", refresh: false },
  ORDER_NOT_FOUND: { message: "This order could not be found. Reload your orders and try again.", refresh: false },
};

const REQUEST_TIMEOUT = 408;
const SERVER_ERROR = 500;

function serverDetail(error: unknown): string | null {
  if (!isAxiosError(error)) return null;
  const body: unknown = error.response?.data;
  return isRecord(body) && typeof body.error === "string" && body.error.trim() ? body.error.trim() : null;
}

export function classifyReturnFailure(error: unknown): ReturnFailure {
  if (isCancel(error)) return { kind: "cancelled" };
  if (!isAxiosError(error)) return { kind: "unresolved", message: UNRESOLVED_RETURN_MESSAGE };
  const status = apiStatus(error);
  const code = apiErrorCode(error);
  if (status === undefined || status === REQUEST_TIMEOUT || status >= SERVER_ERROR) {
    return { kind: "unresolved", message: UNRESOLVED_RETURN_MESSAGE };
  }
  if (code === "ORDER_RETRY") return { kind: "unresolved", message: RETRY_MESSAGE };
  const known = code ? REJECTIONS[code] : undefined;
  if (!known) return { kind: "rejected", code, message: describeApiError(error, "The return request could not be sent."), refresh: false };
  const detail = known.detail ? serverDetail(error) : null;
  return { kind: "rejected", code, message: detail ? `${known.message} ${detail}` : known.message, refresh: known.refresh };
}
