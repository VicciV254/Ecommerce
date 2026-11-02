import { isCancel } from "axios";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { describeApiError } from "../api/errors";
import {
  paymentsAPI,
  staffPaymentsAPI,
  type PaymentAttempt,
  type PaymentOrderSummary,
  type PaymentOverview,
} from "../api/mpesa";
import { newIdempotencyKey } from "./checkoutModel";
import {
  AUTO_CHECK_HORIZON_MS,
  PHONE_HINT,
  attemptStage,
  autoCheckDelay,
  classifyPromptFailure,
  clearPaymentIntent,
  currentAttempt,
  hasNewAttempt,
  isWatchedAttempt,
  normalizeMpesaPhone,
  parsePaymentAttempt,
  parsePaymentOverview,
  paymentView,
  readPaymentIntent,
  savePaymentIntent,
  withAttempt,
  type PaymentIntent,
  type PromptFailure,
} from "./paymentModel";

/** `watching` is an automatic check: it blocks other requests but is not announced. */
export type PaymentBusy = "loading" | "sending" | "checking" | "watching";
/** Errors are announced as alerts; warnings and information are polite status updates. */
export type PaymentNotice = { tone: "info" | "warning" | "error"; text: string };

type Gateway = {
  getOverview: (orderId: string) => Promise<PaymentOverview>;
  checkAttempt: (attempt: PaymentAttempt) => Promise<PaymentAttempt>;
};

const customerGateway: Gateway = {
  getOverview: async (orderId) => parsePaymentOverview((await paymentsAPI.getOverview(orderId)).data, orderId),
  checkAttempt: async (attempt) =>
    parsePaymentAttempt((await paymentsAPI.checkAttempt(attempt.id)).data, { id: attempt.id, orderId: attempt.orderId }),
};

const staffGateway: Gateway = {
  getOverview: async (orderId) => parsePaymentOverview((await staffPaymentsAPI.getOverview(orderId)).data, orderId),
  checkAttempt: async (attempt) =>
    parsePaymentAttempt((await staffPaymentsAPI.checkAttempt(attempt.id)).data, { id: attempt.id, orderId: attempt.orderId }),
};

const LOAD_FAILED = "Payment status could not be loaded.";
const CHECK_FAILED = "The payment status could not be checked.";
const CHECKED = "Payment status checked just now.";
const PROMPT_SENT = "M-Pesa prompt requested. Check your phone and enter your PIN there.";
const UNSAVED_MESSAGE =
  "This browser could not save your payment request, so no prompt was sent. Check that site storage is available and try again.";

const ignoreOverview = () => undefined;

/** Overview loading, checks and one-request-at-a-time state shared by the customer and staff panels. */
function usePaymentRecord(gateway: Gateway, orderId: string, onLoaded: (overview: PaymentOverview) => void) {
  const [overview, setOverview] = useState<PaymentOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<PaymentBusy | null>(null);
  const [notice, setNotice] = useState<PaymentNotice | null>(null);
  const alive = useRef(false);
  const busyRef = useRef<PaymentBusy | null>(null);
  const overviewRef = useRef<PaymentOverview | null>(null);
  const loads = useRef(0);
  const loaded = useRef(onLoaded);
  useLayoutEffect(() => {
    loaded.current = onLoaded;
  });

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const show = useCallback((next: PaymentOverview) => {
    overviewRef.current = next;
    setOverview(next);
  }, []);

  /** Fetches the overview; an answer overtaken by a newer load, or arriving after unmount, is dropped. */
  const load = useCallback(async () => {
    const ticket = ++loads.current;
    const data = await gateway.getOverview(orderId);
    if (!alive.current || ticket !== loads.current) return;
    show(data);
    setLoadError(null);
    loaded.current(data);
  }, [gateway, orderId, show]);

  /** One request at a time: actions arriving while another runs are ignored, never queued. */
  const exclusive = useCallback(async <T,>(kind: PaymentBusy, task: () => Promise<T>): Promise<T | undefined> => {
    if (busyRef.current) return undefined;
    busyRef.current = kind;
    setBusy(kind);
    try {
      return await task();
    } finally {
      busyRef.current = null;
      if (alive.current) setBusy(null);
    }
  }, []);

  /** Shows a failed request beside the last known status, or in place of a status that never loaded. */
  const report = useCallback((error: unknown, fallback: string, tone: PaymentNotice["tone"] = "error") => {
    if (isCancel(error) || !alive.current) return;
    const text = describeApiError(error, fallback);
    if (overviewRef.current) setNotice({ tone, text });
    else setLoadError(text);
  }, []);

  /** Reloads within an operation that already holds the request slot; `true` when it succeeded. */
  const reload = useCallback(async () => {
    try {
      await load();
      return true;
    } catch (error) {
      report(error, LOAD_FAILED);
      return false;
    }
  }, [load, report]);

  /** Reloads the overview; `announce` confirms completion of a check the user asked for. */
  const refresh = useCallback((announce = false) => exclusive("loading", async () => {
    setNotice(null);
    if (await reload() && announce && alive.current) setNotice({ tone: "info", text: CHECKED });
  }), [exclusive, reload]);

  /**
   * Asks the server to check an attempt with M-Pesa only when the attempt allows it (`canReconcile`);
   * otherwise, and afterwards, reloads the overview, which also reflects later callback recovery and the
   * order summary, including cancellation/expiry independent of the attempt. Never sends a request key.
   */
  const check = useCallback((attempt: PaymentAttempt, quiet = false) => exclusive(quiet ? "watching" : "checking", async () => {
    if (!quiet) setNotice(null);
    try {
      if (attempt.canReconcile) {
        const updated = await gateway.checkAttempt(attempt);
        if (!alive.current) return;
        if (overviewRef.current) show(withAttempt(overviewRef.current, updated));
      }
      await load();
      if (!quiet && alive.current) setNotice({ tone: "info", text: CHECKED });
    } catch (error) {
      report(error, CHECK_FAILED, quiet ? "warning" : "error");
    }
  }), [exclusive, gateway, load, report, show]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { overview, loadError, busy, notice, setNotice, alive, busyRef, overviewRef, show, reload, exclusive, refresh, check };
}

const subscribeVisibility = (onChange: () => void) => {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
};
const documentVisible = () => document.visibilityState !== "hidden";
const alwaysVisible = () => true;

/** Staff view: the overview and checks, with no way to start a payment. */
export function useStaffPayment(orderId: string) {
  const { overview, loadError, busy, notice, refresh, check } = usePaymentRecord(staffGateway, orderId, ignoreOverview);
  return { overview, loadError, busy, notice, refresh, check };
}

/**
 * Customer view of one order's payments. A prompt is requested only by an explicit `send`. Its intent
 * (key and phone) is saved before sending; an unknown outcome is settled from the server's record, or
 * sent again with the same key when the customer asks, and never replaced by a new key.
 */
export function useCustomerPayment(ownerId: string, orderId: string, onOrderChange?: (summary: PaymentOrderSummary) => void) {
  const [intent, setIntent] = useState<PaymentIntent | null>(() => readPaymentIntent(ownerId, orderId));
  /** The server's record was read after the intent was saved and holds no attempt for it. */
  const [intentChecked, setIntentChecked] = useState(false);
  /** Key of a request whose first send is in flight: the form stays in place until its outcome is known. */
  const [firstSend, setFirstSend] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [autoStopped, setAutoStopped] = useState<string | null>(null);
  const intentRef = useRef(intent);
  const watchStarts = useRef(new Map<string, number>());
  const orderChanged = useRef(onOrderChange);
  useLayoutEffect(() => {
    orderChanged.current = onOrderChange;
  });

  const remember = useCallback((next: PaymentIntent | null) => {
    intentRef.current = next;
    setIntent(next);
    setIntentChecked(false);
  }, []);

  const settleIntent = useCallback((data: PaymentOverview) => {
    const active = intentRef.current;
    if (active && hasNewAttempt(data, active)) {
      clearPaymentIntent(active);
      remember(null);
    } else if (active) {
      setIntentChecked(true);
    }
    orderChanged.current?.(data.order);
  }, [remember]);

  const { overview, loadError, busy, notice, setNotice, alive, busyRef, overviewRef, show, reload, exclusive, refresh, check } =
    usePaymentRecord(customerGateway, orderId, settleIntent);

  /** Sends a saved request; returns "phone" when the server refused the number. */
  const submit = useCallback(async (active: PaymentIntent): Promise<"phone" | null> => {
    let failure: PromptFailure;
    try {
      const { data } = await paymentsAPI.requestPrompt(active.orderId, active.phone, active.idempotencyKey);
      const attempt = parsePaymentAttempt(data, { orderId: active.orderId });
      if (!alive.current) return null;
      // The server recorded this request: its attempt, not the browser, now carries the outcome.
      clearPaymentIntent(active);
      remember(null);
      if (overviewRef.current) show(withAttempt(overviewRef.current, attempt));
      if (attemptStage(attempt) === "waiting") setNotice({ tone: "info", text: PROMPT_SENT });
      await reload();
      return null;
    } catch (error) {
      failure = classifyPromptFailure(error);
    }
    if (failure.kind === "cancelled" || !alive.current) return null;
    if (failure.kind === "rejected") {
      clearPaymentIntent(active);
      remember(null);
      if (failure.field === "phone") setPhoneError(failure.message);
      else setNotice({ tone: "error", text: failure.message });
    } else {
      setNotice({ tone: "warning", text: failure.message });
    }
    // Settles an unknown request from the server's record, or refreshes availability after a refusal.
    await reload();
    return failure.kind === "rejected" && failure.field === "phone" ? "phone" : null;
  }, [alive, overviewRef, reload, remember, setNotice, show]);

  /** Requests a prompt for the saved order total once the customer confirms; returns "phone" when the number needs attention. */
  const send = useCallback(async (phoneInput: string): Promise<"phone" | null> => {
    const current = overviewRef.current;
    if (busyRef.current || intentRef.current || !current || paymentView(current, null).kind !== "payable") return null;
    const phone = normalizeMpesaPhone(phoneInput);
    if (!phone) {
      setPhoneError(PHONE_HINT);
      return "phone";
    }
    setPhoneError(null);
    setNotice(null);
    const next: PaymentIntent = {
      ownerId, orderId, idempotencyKey: newIdempotencyKey(), phone,
      priorAttemptIds: current.attempts.map((attempt) => attempt.id), createdAt: new Date().toISOString(),
    };
    if (!savePaymentIntent(next)) {
      // Another tab may hold an unresolved request for this order: settle that one instead of starting another.
      const existing = readPaymentIntent(ownerId, orderId);
      if (existing) {
        remember(existing);
        await refresh();
      } else {
        setNotice({ tone: "error", text: UNSAVED_MESSAGE });
      }
      return null;
    }
    remember(next);
    setFirstSend(next.idempotencyKey);
    try {
      return (await exclusive("sending", () => submit(next))) ?? null;
    } finally {
      if (alive.current) setFirstSend(null);
    }
  }, [alive, busyRef, exclusive, orderId, overviewRef, ownerId, refresh, remember, setNotice, submit]);

  /** Sends the saved request again with its original key, only once the server showed no record of it. */
  const retry = useCallback(async () => {
    const active = intentRef.current;
    if (!active || !intentChecked) return;
    await exclusive("sending", () => submit(active));
  }, [exclusive, intentChecked, submit]);

  const editPhone = useCallback(() => setPhoneError(null), []);

  // Bounded automatic checks: one at a time, only while the page is visible, for a limited time per attempt.
  // Each finished check schedules the next from the latest attempt, independent of render timing.
  const visible = useSyncExternalStore(subscribeVisibility, documentVisible, alwaysVisible);
  const shown = overview ? currentAttempt(overview) : null;
  const watchedId = shown && !intent && isWatchedAttempt(shown) ? shown.id : null;
  useEffect(() => {
    if (!watchedId || !visible || autoStopped === watchedId) return;
    const started = watchStarts.current.get(watchedId) ?? Date.now();
    watchStarts.current.set(watchedId, started);
    const latest = () => {
      const current = overviewRef.current ? currentAttempt(overviewRef.current) : null;
      return current?.id === watchedId && !intentRef.current && isWatchedAttempt(current) ? current : null;
    };
    let active = true;
    let timer: number | undefined;
    const schedule = () => {
      const attempt = latest();
      if (!active || !attempt) return;
      const remaining = AUTO_CHECK_HORIZON_MS - (Date.now() - started);
      if (remaining <= 0) {
        setAutoStopped(watchedId);
        return;
      }
      timer = window.setTimeout(() => {
        const due = latest();
        if (active && due) void check(due, true).then(schedule);
      }, Math.min(autoCheckDelay(attempt), remaining));
    };
    schedule();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [watchedId, visible, autoStopped, check, overviewRef]);

  const unresolved = intent && intent.idempotencyKey !== firstSend ? { checked: intentChecked } : null;
  const view = overview ? paymentView(overview, unresolved) : null;
  return {
    overview, view, loadError, busy, notice, phoneError,
    autoStopped: shown !== null && autoStopped === shown.id,
    send, retry, refresh, check, editPhone,
  };
}
