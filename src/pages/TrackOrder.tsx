import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { apiStatus, describeApiError } from "../api/errors";
import { ordersAPI, type CustomerOrder, type OrderStatus, type OrderTracking } from "../api/orders";
import { textLinkClass } from "../components/checkout";
import { OrderStatusBadge } from "../components/OrderRecords";
import { Breadcrumb, Container } from "../components/ui";
import { useAuth } from "../contexts/AuthContext";
import { Link, parseRoute, useEntryFocus } from "../router";
import { isOrderStatus } from "../store/checkoutModel";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONES } from "../store/orderCopy";
import { OrderFormatError, parseCustomerOrderPage, parseOrderTracking } from "../store/orderModel";
import { formatDateTime } from "../utils/format";

const ACTIVE_ORDER_LIMIT = 100;
const COPIED_FEEDBACK_MS = 2000;
/** Longest order number the form accepts; issued numbers are far shorter. */
const MAX_ORDER_NUMBER = 64;
/** Orders that need no further tracking. */
const FINISHED: readonly OrderStatus[] = ["DELIVERED", "CANCELLED"];

const cardClass = "rounded-lg bg-surface p-4 shadow-card sm:p-6";
const primaryButton =
  "inline-flex min-h-[48px] items-center justify-center rounded-sm bg-navy-900 px-6 text-sm font-bold uppercase tracking-[0.12em] text-white transition-colors duration-(--motion-feedback) hover:bg-gold-500 hover:text-navy-900";
const outlineButton =
  "inline-flex min-h-[44px] items-center justify-center rounded-sm border border-navy-900 px-4 text-sm font-semibold text-navy-900 transition-colors duration-(--motion-feedback) hover:bg-surface-soft";

/** One lookup by order number; only what the tracking API returned is ever shown. */
type Lookup =
  | { status: "idle" }
  | { status: "searching"; number: string }
  | { status: "found"; tracking: OrderTracking }
  | { status: "not-found"; number: string }
  | { status: "error"; number: string; message: string };

type ActiveOrders =
  | { status: "loading" }
  | { status: "ready"; orders: CustomerOrder[] }
  | { status: "error"; message: string };

function formatStatus(status: string) {
  return isOrderStatus(status) ? ORDER_STATUS_LABELS[status] : status.replace(/_/g, " ");
}

/** The newest step's fixed phrase (e.g. "Collected" for pickups) when it describes the current status. */
function publicStatus(tracking: OrderTracking) {
  const latest = tracking.trackingHistory[0];
  return latest?.status === tracking.status && latest.description ? latest.description : formatStatus(tracking.status);
}

const describeLoadError = (error: unknown, fallback: string) =>
  error instanceof OrderFormatError ? `${error.message} Try again shortly.` : describeApiError(error, fallback);

/**
 * Order tracking. Anyone can look up an order number; signed-in shoppers also see their orders still in progress. The
 * status and every step's time come from the tracking API as recorded: nothing is estimated or filled in.
 */
export default function TrackOrder({ route }: { route: string }) {
  const prefilled = parseRoute(route).params.get("order")?.trim().slice(0, MAX_ORDER_NUMBER) ?? "";
  const { user } = useAuth();
  const [orderNumber, setOrderNumber] = useState(prefilled);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<Lookup>({ status: "idle" });
  const heading = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  /** Set when the shopper asked for a lookup, so focus moves to its outcome once it is known. */
  const focusOutcome = useRef(false);
  /** Each lookup's number; an answer to an older lookup is ignored. */
  const latestLookup = useRef(0);
  const fieldId = useId();
  useEntryFocus(heading);

  const runTrack = useCallback(async (number: string) => {
    const ticket = ++latestLookup.current;
    setLookup({ status: "searching", number });
    try {
      const { data } = await ordersAPI.track(number);
      const tracking = parseOrderTracking(data);
      if (ticket === latestLookup.current) setLookup({ status: "found", tracking });
    } catch (error) {
      if (ticket !== latestLookup.current) return;
      setLookup(apiStatus(error) === 404
        ? { status: "not-found", number }
        : { status: "error", number, message: describeLoadError(error, "Tracking is unavailable right now.") });
    }
  }, []);

  useEffect(() => {
    if (prefilled) void runTrack(prefilled);
  }, [prefilled, runTrack]);

  useLayoutEffect(() => {
    if (!focusOutcome.current || lookup.status === "idle" || lookup.status === "searching") return;
    focusOutcome.current = false;
    resultHeading.current?.focus();
  }, [lookup]);

  const track = (number: string) => {
    focusOutcome.current = true;
    void runTrack(number);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = orderNumber.trim();
    if (!trimmed) {
      setFieldError("Enter your order number.");
      field.current?.focus();
      return;
    }
    setFieldError(null);
    track(trimmed);
  };

  return (
    <Container className="py-6 md:py-8">
      <Breadcrumb items={[{ label: "Track order" }]} />
      <div className="mx-auto mt-4 max-w-2xl space-y-6">
        <section aria-labelledby="track-title" className={cardClass}>
          <h1 id="track-title" ref={heading} tabIndex={-1} className="type-h1 text-navy-900">Track your order</h1>
          <p className="mt-2 text-navy-800">
            Enter the order number from your receipt or confirmation email to see its status and each recorded step.
          </p>
          <form noValidate onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <label htmlFor={fieldId} className="block text-sm font-semibold text-navy-900">Order number</label>
              <input
                ref={field}
                id={fieldId}
                name="orderNumber"
                value={orderNumber}
                maxLength={MAX_ORDER_NUMBER}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? `${fieldId}-error` : undefined}
                onChange={(event) => {
                  setOrderNumber(event.target.value);
                  setFieldError(null);
                  // Editing the number leaves the last answer behind; an answer still on its way is ignored.
                  latestLookup.current += 1;
                  setLookup({ status: "idle" });
                }}
                className="mt-1 block min-h-[44px] w-full min-w-0 rounded-sm border border-control bg-surface px-3 py-2 font-mono uppercase text-navy-900 aria-[invalid=true]:border-2 aria-[invalid=true]:border-error"
              />
              {fieldError && <p id={`${fieldId}-error`} className="mt-1 text-sm font-semibold text-error">{fieldError}</p>}
            </div>
            <button type="submit" className={`${primaryButton} sm:mt-6`}>Track order</button>
          </form>
          <LookupOutcome lookup={lookup} headingRef={resultHeading} onRetry={track} />
        </section>

        {user && (
          <ActiveOrdersPanel key={user.id} onTrack={(number) => { setOrderNumber(number); setFieldError(null); track(number); }} />
        )}
      </div>
    </Container>
  );
}

/** The answer to the last lookup: in progress, found (status, last update and each step), not found, or failed. */
function LookupOutcome({ lookup, headingRef, onRetry }: {
  lookup: Lookup;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onRetry: (orderNumber: string) => void;
}) {
  const detailId = useId();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (lookup.status === "idle") return null;
  if (lookup.status === "searching") {
    return (
      <p role="status" className="mt-6 flex items-center gap-3 rounded-md bg-surface-page p-4 text-navy-800 [overflow-wrap:anywhere]">
        <span aria-hidden="true" className="size-5 shrink-0 animate-spin rounded-full border-2 border-navy-900 border-t-transparent" />
        <span>Looking up order <span className="font-mono font-semibold">{lookup.number}</span>…</span>
      </p>
    );
  }
  if (lookup.status === "not-found") {
    return (
      <div className="mt-6 rounded-md border border-warning/40 bg-warning-tint p-4 text-navy-800 [overflow-wrap:anywhere]">
        <h2 ref={headingRef} tabIndex={-1} aria-describedby={detailId} className="font-semibold text-warning">Order not found</h2>
        <p id={detailId} className="mt-1">
          No order has the number <span className="font-mono font-semibold">{lookup.number}</span>. Check the number on your
          receipt or confirmation email and try again.
        </p>
      </div>
    );
  }
  if (lookup.status === "error") {
    return (
      <div className="mt-6 rounded-md border border-error/40 bg-error-tint p-4 text-navy-800 [overflow-wrap:anywhere]">
        <h2 ref={headingRef} tabIndex={-1} aria-describedby={detailId} className="font-semibold text-error">Tracking is unavailable</h2>
        <p id={detailId} className="mt-1">{lookup.message}</p>
        <button type="button" onClick={() => onRetry(lookup.number)} className={`mt-3 ${outlineButton}`}>Try again</button>
      </div>
    );
  }

  const { tracking } = lookup;
  const steps = tracking.trackingHistory;
  const latest = steps[0];
  const copy = () => {
    navigator.clipboard?.writeText(tracking.orderNumber).then(() => setCopied(true)).catch(() => undefined);
  };
  return (
    <section aria-labelledby={detailId} className="mt-6 border-t border-divider pt-6 [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id={detailId} ref={headingRef} tabIndex={-1} className="type-h3 min-w-0 text-navy-900">
          Order <span className="font-mono">{tracking.orderNumber}</span>
        </h2>
        <button type="button" onClick={copy} className={outlineButton}>
          {copied ? "Copied" : "Copy number"}
        </button>
      </div>
      <p role="status" className="sr-only">{copied ? "Order number copied." : ""}</p>
      <dl className="mt-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <dt className="text-sm text-muted">Status</dt>
          <dd className="min-w-0">
            <span className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${ORDER_STATUS_TONES[tracking.status]}`}>
              {publicStatus(tracking)}
            </span>
          </dd>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <dt className="text-sm text-muted">Last update</dt>
          <dd className="min-w-0 text-navy-900">{latest ? <time dateTime={latest.createdAt}>{formatDateTime(latest.createdAt)}</time> : "None recorded yet"}</dd>
        </div>
      </dl>
      <h3 className="mt-6 text-sm font-semibold text-navy-900">Progress, newest first</h3>
      {steps.length ? (
        <ol aria-label="Tracking history" className="mt-3">
          {steps.map((step, index) => (
            <li key={step.id} className="relative flex gap-3 pb-5 last:pb-0">
              {index < steps.length - 1 && <span aria-hidden="true" className="absolute left-[5px] top-5 bottom-0 w-0.5 bg-divider" />}
              <span aria-hidden="true" className={`relative mt-1.5 size-3 shrink-0 rounded-full ${index === 0 ? "bg-navy-900" : "border-2 border-control bg-surface"}`} />
              <div className="min-w-0">
                <p className={index === 0 ? "font-semibold text-navy-900" : "text-navy-800"}>
                  {step.description || formatStatus(step.status)}
                  {index === 0 && <span className="sr-only"> (latest)</span>}
                </p>
                <p className="text-sm text-muted"><time dateTime={step.createdAt}>{formatDateTime(step.createdAt)}</time></p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-navy-800">No steps have been recorded for this order yet.</p>
      )}
    </section>
  );
}

/** A signed-in shopper's orders that are still on their way, each with a lookup and a link to its details. */
function ActiveOrdersPanel({ onTrack }: { onTrack: (orderNumber: string) => void }) {
  const [active, setActive] = useState<ActiveOrders>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    ordersAPI.getMyOrders({ limit: ACTIVE_ORDER_LIMIT })
      .then(({ data }) => {
        const orders = parseCustomerOrderPage(data).orders.filter((order) => !FINISHED.includes(order.status));
        if (live) setActive({ status: "ready", orders });
      })
      .catch((error: unknown) => {
        if (live) setActive({ status: "error", message: describeLoadError(error, "Your active orders could not be loaded.") });
      });
    return () => { live = false; };
  }, [attempt]);

  const retry = () => {
    setActive({ status: "loading" });
    setAttempt((count) => count + 1);
  };

  return (
    <section aria-labelledby="active-orders-title" className={cardClass}>
      <h2 id="active-orders-title" className="type-h3 text-navy-900">Your active orders</h2>
      {active.status === "loading" && <p role="status" className="mt-3 text-muted">Loading your active orders…</p>}
      {active.status === "error" && (
        <div role="alert" className="mt-3 rounded-md border border-error/40 bg-error-tint p-4 text-navy-800">
          <p>{active.message}</p>
          <button type="button" onClick={retry} className={`mt-3 ${outlineButton}`}>Try again</button>
        </div>
      )}
      {active.status === "ready" && active.orders.length === 0 && (
        <p className="mt-3 text-navy-800">
          You have no orders in progress. Delivered and cancelled orders are in{" "}
          <Link to="/account/orders" className="font-semibold text-link underline underline-offset-4 hover:text-link-hover">your orders</Link>.
        </p>
      )}
      {active.status === "ready" && active.orders.length > 0 && (
        <ul className="mt-4 space-y-3">
          {active.orders.map((order) => (
            <li key={order.id} className="rounded-md border border-divider p-4 [overflow-wrap:anywhere]">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono font-bold text-navy-900">{order.orderNumber}</p>
                  <p className="text-sm text-muted">Placed {formatDateTime(order.createdAt)}</p>
                </div>
                <OrderStatusBadge order={order} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
                <button type="button" onClick={() => onTrack(order.orderNumber)} className={outlineButton}>
                  Track<span className="sr-only"> order {order.orderNumber}</span>
                </button>
                <Link to={`/account/orders?order=${encodeURIComponent(order.id)}`} className={textLinkClass}>
                  View details<span className="sr-only"> of order {order.orderNumber}</span>
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
