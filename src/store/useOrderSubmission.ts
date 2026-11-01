import { isCancel } from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiErrorCode } from "../api/errors";
import { checkoutAPI, type Order, type Quote } from "../api/orders";
import { useAuth } from "../contexts/AuthContext";
import {
  CheckoutFormatError,
  classifyOrderFailure,
  newIdempotencyKey,
  orderHoldsItems,
  orderedLines,
  parseOrder,
  parseQuote,
  type OrderFailure,
  type OrderIntent,
} from "./checkoutModel";
import { useStore } from "./StoreContext";

export type SubmissionState =
  | { status: "idle" }
  /** Checking what happened to an earlier request before anything new can be sent. */
  | { status: "resolving" }
  /** `retry` re-sends a stored request from the resolution view rather than a newly reviewed quote. */
  | { status: "sending"; retry: boolean }
  /** The outcome is still open; only the same request (same key) may be retried. */
  | { status: "unresolved"; message: string }
  | { status: "placed"; order: Order }
  /** The order exists but no longer holds its items; the cart keeps them. */
  | { status: "lapsed"; order: Order }
  /** Nothing was created; a new quote and an explicit review are required. */
  | { status: "rejected"; code?: string; message: string; previousTotal: number; signature: string }
  /** The intent could not be saved, so nothing was sent. */
  | { status: "blocked"; message: string };

const EXPIRED_MESSAGE = "Your earlier order request was not completed before its prices expired. Nothing was reserved.";
const MISSING_MESSAGE = "Your earlier order request could not be found, so nothing was reserved.";
const OPEN_MESSAGE = "Your earlier order request has not finished. Retry it to complete that same order; it cannot create a second one.";
const UNCHECKED_MESSAGE = "We could not check your earlier order request. Check again, or retry the same request; it cannot create a second order.";
const UNSAVED_MESSAGE = "This browser could not save your order request, so it was not sent. Check that site storage is available and try again.";

/**
 * One pending-order submission per customer. The intent (quote + idempotency key) is stored before it is
 * sent; an unknown outcome is resolved from the server or retried with the same key, never replaced by a
 * new key. Results arriving after the customer changes are ignored by the store's owner check.
 */
export function useOrderSubmission() {
  const { user } = useAuth();
  const { state: store, beginOrder, endOrder, acknowledgeOrder } = useStore();
  // StoreProvider renders once after a sign-in change with the previous account's data; never act on it.
  const ownerReady = user !== null && store.personalOwner === user.id;
  const intent = ownerReady ? store.pendingOrder : null;
  const [state, setState] = useState<SubmissionState>({ status: "idle" });
  const mounted = useRef(true);
  const busy = useRef(false);
  /** Intents this view created or already began resolving; only stored, unseen intents are auto-resolved. */
  const handled = useRef(new Set<string>());

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const show = useCallback((next: SubmissionState) => {
    if (mounted.current) setState(next);
    return next;
  }, []);

  const settle = useCallback((order: Order, active: OrderIntent) => {
    if (order.quoteId !== active.quoteId) throw new CheckoutFormatError("order does not match the reviewed quote");
    if (orderHoldsItems(order)) {
      acknowledgeOrder(order.id, orderedLines(order), active.idempotencyKey);
      return show({ status: "placed", order });
    }
    endOrder(active.idempotencyKey);
    return show({ status: "lapsed", order });
  }, [acknowledgeOrder, endOrder, show]);

  const reject = useCallback((active: OrderIntent, message: string, code?: string) => {
    endOrder(active.idempotencyKey);
    return show({ status: "rejected", code, message, previousTotal: active.total, signature: active.signature });
  }, [endOrder, show]);

  const resolve = useCallback(async (active: OrderIntent): Promise<SubmissionState | null> => {
    busy.current = true;
    show({ status: "resolving" });
    try {
      const quote = parseQuote((await checkoutAPI.getQuote(active.quoteId)).data);
      if (quote.id !== active.quoteId) throw new CheckoutFormatError("quote");
      if (quote.orderId) return settle(parseOrder((await checkoutAPI.getOrder(quote.orderId)).data), active);
      // Used without a visible order is inconsistent: never conclude that nothing was reserved.
      if (quote.consumed) return show({ status: "unresolved", message: UNCHECKED_MESSAGE });
      if (quote.expired) return reject(active, EXPIRED_MESSAGE, "QUOTE_EXPIRED");
      return show({ status: "unresolved", message: OPEN_MESSAGE });
    } catch (error) {
      if (isCancel(error)) return null;
      if (apiErrorCode(error) === "QUOTE_NOT_FOUND") return reject(active, MISSING_MESSAGE, "QUOTE_NOT_FOUND");
      return show({ status: "unresolved", message: UNCHECKED_MESSAGE });
    } finally {
      busy.current = false;
    }
  }, [reject, settle, show]);

  const send = useCallback(async (active: OrderIntent, retry: boolean): Promise<SubmissionState | null> => {
    busy.current = true;
    show({ status: "sending", retry });
    let failure: OrderFailure;
    try {
      return settle(parseOrder((await checkoutAPI.placeOrder(active.quoteId, active.idempotencyKey)).data), active);
    } catch (error) {
      failure = classifyOrderFailure(error);
    } finally {
      busy.current = false;
    }
    if (failure.kind === "cancelled") return null;
    if (failure.kind === "retry") return show({ status: "unresolved", message: failure.message });
    if (failure.kind === "rejected") return reject(active, failure.message, failure.code);
    // An unknown or already-used outcome is settled from the server's record of this quote.
    return resolve(active);
  }, [reject, resolve, settle, show]);

  useEffect(() => {
    if (!ownerReady || !intent || handled.current.has(intent.idempotencyKey)) return;
    handled.current.add(intent.idempotencyKey);
    void resolve(intent);
  }, [ownerReady, intent, resolve]);

  /** Sends a new request for a reviewed quote; refused while an earlier outcome is unresolved. */
  const submit = useCallback(async (quote: Quote, signature: string): Promise<SubmissionState | null> => {
    if (!ownerReady || busy.current || store.pendingOrder) return null;
    const next: OrderIntent = {
      quoteId: quote.id, idempotencyKey: newIdempotencyKey(), signature, total: quote.total, createdAt: new Date().toISOString(),
    };
    handled.current.add(next.idempotencyKey);
    if (!beginOrder(next)) return show({ status: "blocked", message: UNSAVED_MESSAGE });
    return send(next, false);
  }, [beginOrder, ownerReady, send, show, store.pendingOrder]);

  /** Re-sends the stored request with its original key. */
  const retry = useCallback(async () => (ownerReady && intent && !busy.current ? send(intent, true) : null), [ownerReady, intent, send]);

  /** Asks the server again what happened to the stored request, without sending it. */
  const checkAgain = useCallback(async () => (ownerReady && intent && !busy.current ? resolve(intent) : null), [ownerReady, intent, resolve]);

  // A stored intent is resolved before anything else is offered.
  const status: SubmissionState = state.status === "idle" && intent ? { status: "resolving" } : state;
  return { state: status, intent, ownerReady, submit, retry, checkAgain };
}
