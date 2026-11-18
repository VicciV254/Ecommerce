import { useId, useLayoutEffect, useRef, useState, type FocusEvent, type FormEvent, type ReactNode } from "react";
import type { PaymentAttempt, PaymentEnvironment, PaymentOrderSummary } from "../api/mpesa";
import type { OrderStatus } from "../api/orders";
import { useAuth } from "../contexts/AuthContext";
import { paymentMethodLabel } from "../store/orderCopy";
import { attemptStage, isDemonstrationPaid, isOpenAttempt, staffGuidance, type AttemptStage } from "../store/paymentModel";
import { useCustomerPayment, useStaffPayment, type PaymentBusy, type PaymentNotice } from "../store/useOrderPayment";
import { formatDateTime, formatKES } from "../utils/format";

type HeadingLevel = 2 | 3 | 4;

const labelClass = "block text-sm font-semibold text-navy-900";
const fieldClass = "mt-1 min-h-[44px] w-full min-w-0 rounded-sm border border-control bg-surface px-3 py-2 text-navy-900 aria-[invalid=true]:border-2 aria-[invalid=true]:border-error";
const primaryClass = "min-h-[48px] w-full rounded-sm bg-navy-900 px-5 py-3 text-sm font-bold uppercase tracking-[0.12em] text-white transition-colors duration-(--motion-feedback) hover:bg-gold-500 hover:text-navy-900 aria-disabled:cursor-not-allowed aria-disabled:bg-surface-soft aria-disabled:text-muted";
const secondaryClass = "min-h-[44px] rounded-sm border border-navy-900 px-4 py-2 text-sm font-semibold text-navy-900 transition-colors duration-(--motion-feedback) hover:bg-surface-soft aria-disabled:cursor-not-allowed aria-disabled:border-control aria-disabled:text-muted";
const columnsClass = "mt-4 grid grid-cols-1 gap-4 @lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] @lg:items-start @lg:gap-6";

const BUSY_TEXT: Record<PaymentBusy, string> = {
  loading: "Checking payment status…",
  sending: "Requesting your M-Pesa prompt…",
  checking: "Checking this payment with M-Pesa…",
  watching: "",
  paying: "Recording the demonstration payment…",
};

/** Returns focus to the panel heading when an update removes the control that had it, and only then. */
function useFocusRescue() {
  const heading = useRef<HTMLHeadingElement>(null);
  const lastFocused = useRef<Element | null>(null);
  useLayoutEffect(() => {
    const last = lastFocused.current;
    if (!last || last.isConnected) return;
    lastFocused.current = null;
    const active = document.activeElement;
    if (!active || active === document.body || active.tagName === "DIALOG") heading.current?.focus();
  });
  return {
    heading,
    onFocus: (event: FocusEvent<HTMLElement>) => { lastFocused.current = event.target; },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      const left = event.target;
      // A control the user moved away from, rather than one an update removed, needs no rescue.
      queueMicrotask(() => { if (lastFocused.current === left && left.isConnected) lastFocused.current = null; });
    },
  };
}

/**
 * Labelled region with alert and status areas that stay mounted, so updates are announced where they happen. Framed,
 * it is a card of its own; unframed, a section in the flow of the card around it (a hairline, not a card in a card).
 */
function PanelFrame({ title, level, framed = true, busy, notice, children }: {
  title: string;
  level: HeadingLevel;
  framed?: boolean;
  busy: PaymentBusy | null;
  notice: PaymentNotice | null;
  children: ReactNode;
}) {
  const titleId = useId();
  const focus = useFocusRescue();
  const Heading = `h${level}` as const;
  const status = busy ? BUSY_TEXT[busy] : notice && notice.tone !== "error" ? notice.text : "";
  return (
    <section aria-labelledby={titleId} onFocus={focus.onFocus} onBlur={focus.onBlur}
      className={`@container text-left text-navy-800 [overflow-wrap:anywhere] ${framed
        ? "rounded-lg border border-divider bg-surface p-4 shadow-card sm:p-6" : "border-t border-divider pt-5"}`}>
      <Heading id={titleId} ref={focus.heading} tabIndex={-1} className="type-h3 text-navy-900">
        {title}
      </Heading>
      {children}
      {notice?.tone === "error" && (
        <p role="alert" className="mt-3 rounded-md border border-error/40 bg-error-tint p-3 font-semibold text-error">{notice.text}</p>
      )}
      <p role="status" className={`text-sm text-navy-800 ${status ? "mt-3" : ""}`}>{status}</p>
    </section>
  );
}

/** A button that stays mounted (and focusable) while busy, ignoring presses until the current request ends. */
function ActionButton({ busy, onPress, className = secondaryClass, describedBy, children }: {
  busy: boolean;
  onPress: () => void;
  className?: string;
  describedBy?: string;
  children: ReactNode;
}) {
  return (
    <button type="button" aria-disabled={busy} aria-describedby={describedBy} onClick={() => { if (!busy) onPress(); }} className={className}>
      {children}
    </button>
  );
}

function LoadFailure({ message, busy, onRetry }: { message: string | null; busy: boolean; onRetry: () => void }) {
  if (!message) return null;
  return (
    <div className="mt-3 space-y-3">
      <p role="alert" className="rounded-md border border-error/40 bg-error-tint p-3 font-semibold text-error">{message}</p>
      <ActionButton busy={busy} onPress={onRetry}>Try again</ActionButton>
    </div>
  );
}

function EnvironmentLabel({ environment }: { environment: PaymentEnvironment | null }) {
  if (environment === "sandbox") {
    return (
      <p className="rounded-md border-2 border-warning bg-warning-tint px-3 py-2 text-sm font-bold text-navy-900">
        Sandbox test: real funds may be deducted
      </p>
    );
  }
  if (environment === "production") {
    return (
      <p className="inline-block rounded-full border border-success/40 bg-success-tint px-3 py-1 text-sm font-semibold text-success">
        Live M-Pesa payment
      </p>
    );
  }
  return null;
}

function Amount({ id, label, amount }: { id?: string; label: string; amount: number }) {
  return (
    <div id={id}>
      <p className={labelClass}>{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-navy-900">{formatKES(amount)}</p>
      <p className="text-sm text-muted">The saved total for this order.</p>
    </div>
  );
}

function AttemptDetails({ attempt }: { attempt: PaymentAttempt }) {
  return (
    <dl className="grid grid-cols-[fit-content(50%)_minmax(0,1fr)] gap-x-4 gap-y-1.5">
      <dt className="text-muted">Amount</dt>
      <dd className="font-semibold text-navy-900">{formatKES(attempt.amount)}</dd>
      <dt className="text-muted">Phone</dt>
      <dd>{attempt.phoneMasked}</dd>
      {attempt.receiptNumber && (
        <>
          <dt className="text-muted">M-Pesa receipt</dt>
          <dd className="font-mono font-semibold">{attempt.receiptNumber}</dd>
        </>
      )}
      <dt className="text-muted">Requested</dt>
      <dd>{formatDateTime(attempt.createdAt)}</dd>
      {attempt.confirmedAt && (
        <>
          <dt className="text-muted">Confirmed</dt>
          <dd>{formatDateTime(attempt.confirmedAt)}</dd>
        </>
      )}
    </dl>
  );
}

function FailedAttempt({ attempt }: { attempt: PaymentAttempt }) {
  return (
    <div className="rounded-md border border-error/40 bg-error-tint p-3">
      <p className="font-semibold text-error">Payment not completed</p>
      <p className="mt-1">{attempt.message}</p>
      <p className="mt-1 text-sm text-muted">Requested {formatDateTime(attempt.createdAt)} for {attempt.phoneMasked}.</p>
    </div>
  );
}

type CustomerStage = Exclude<AttemptStage, "failed">;

const STAGE_TITLES: Record<CustomerStage, string> = {
  submitting: "Sending your payment request",
  waiting: "Approve the payment on your phone",
  unconfirmed: "Payment not confirmed yet",
  verifying: "Payment being verified",
  "received-review": "Payment received: staff review needed",
  paid: "Payment confirmed",
};

const STAGE_TONES: Record<CustomerStage, string> = {
  submitting: "border-info/30 bg-info-tint",
  waiting: "border-info/30 bg-info-tint",
  unconfirmed: "border-warning/40 bg-warning-tint",
  verifying: "border-warning/40 bg-warning-tint",
  "received-review": "border-warning/40 bg-warning-tint",
  paid: "border-success/40 bg-success-tint",
};

function stageText(attempt: PaymentAttempt, stage: CustomerStage, orderStatus: OrderStatus): string {
  switch (stage) {
    case "submitting":
      return "Your request is being sent to M-Pesa. No payment has been confirmed yet.";
    case "waiting":
      return `Check ${attempt.phoneMasked} for the M-Pesa prompt for ${formatKES(attempt.amount)} and enter your PIN there. ` +
        "This order is not paid until M-Pesa confirms the payment.";
    case "unconfirmed":
      return "M-Pesa has not confirmed the result of this request. Do not pay again; check this attempt instead.";
    case "verifying":
      return "This payment needs verification or staff review. Do not pay again.";
    case "received-review":
      return "Your payment was received, but this order needs staff review before it is fulfilled or refunded. Do not pay again.";
    case "paid":
      return orderStatus === "PENDING"
        ? "Your order is paid and awaiting fulfilment by our staff."
        : `Your order is paid. Order status: ${orderStatus.replace(/_/g, " ").toLowerCase()}.`;
  }
}

/** A demonstration payment took no money; what the order waits for next. */
const demonstrationPaidText = (orderStatus: OrderStatus) => `No money was taken. ${orderStatus === "PENDING"
  ? "Your order is waiting to be prepared."
  : `Order status: ${orderStatus.replace(/_/g, " ").toLowerCase()}.`}`;

/**
 * The signed-in customer's payment for one order. Nothing is requested until the customer confirms: a sample order
 * offers a demonstration payment (no money) first, and M-Pesa takes the amount and phone, with the PIN only ever entered
 * on the phone.
 */
export function PaymentPanel({ orderId, onOrderChange, headingLevel = 2, framed = true }: {
  orderId: string;
  /** Receives the server's order summary after each status load, so surrounding text never contradicts it. */
  onOrderChange?: (summary: PaymentOrderSummary) => void;
  headingLevel?: HeadingLevel;
  /** `false` inside another card (the order dialog): a section of it, not a card in a card. */
  framed?: boolean;
}) {
  const { user } = useAuth();
  if (!user) return null;
  // Keyed by account and order: a request, phone number or late answer never reaches another customer.
  return (
    <CustomerPayment key={`${user.id}:${orderId}`} ownerId={user.id} orderId={orderId} defaultPhone={user.phone ?? ""}
      level={headingLevel} framed={framed} onOrderChange={onOrderChange} />
  );
}

function CustomerPayment({ ownerId, orderId, defaultPhone, level, framed, onOrderChange }: {
  ownerId: string;
  orderId: string;
  defaultPhone: string;
  level: HeadingLevel;
  framed: boolean;
  onOrderChange?: (summary: PaymentOrderSummary) => void;
}) {
  const payment = useCustomerPayment(ownerId, orderId, onOrderChange);
  const ids = useId();
  const phoneRef = useRef<HTMLInputElement>(null);
  const [phone, setPhone] = useState(defaultPhone);
  const busy = payment.busy !== null;
  const { overview, view } = payment;

  const confirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if ((await payment.send(phone)) === "phone") phoneRef.current?.focus();
  };

  let body: ReactNode = <LoadFailure message={payment.loadError} busy={busy} onRetry={() => void payment.refresh(true)} />;
  if (overview && (view?.kind === "payable" || view?.kind === "unavailable")) {
    const [amountId, phoneId, hintId, errorId, pinId, noMoneyId] = ["amount", "phone", "hint", "error", "pin", "no-money"].map((part) => `${ids}-${part}`);
    const amount = <Amount id={amountId} label={view.kind === "payable" || view.demonstration ? "Amount to pay" : "Order total"} amount={overview.order.total} />;
    const mpesa = view.kind === "payable" ? (
      <form onSubmit={confirm} noValidate className="space-y-3">
        <div>
          <label htmlFor={phoneId} className={labelClass}>M-Pesa phone number</label>
          <input
            id={phoneId}
            ref={phoneRef}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            aria-invalid={Boolean(payment.phoneError)}
            aria-describedby={payment.phoneError ? `${hintId} ${errorId}` : hintId}
            onChange={(event) => { setPhone(event.target.value); payment.editPhone(); }}
            className={fieldClass}
          />
          <p id={hintId} className="mt-1 text-sm text-muted">For example 0712 345 678 or +254 712 345 678.</p>
          {payment.phoneError && <p id={errorId} role="alert" className="mt-1.5 text-sm font-semibold text-error">{payment.phoneError}</p>}
        </div>
        <p id={pinId} className="rounded-md border border-info/30 bg-info-tint p-3 text-sm font-semibold text-info">
          Enter your M-Pesa PIN only on your phone, in the M-Pesa prompt. Never type it on this website.
        </p>
        <button type="submit" aria-disabled={busy} aria-describedby={`${amountId} ${pinId}`} className={primaryClass}>
          {view.failed ? "Send new M-Pesa prompt" : "Send M-Pesa prompt"}
        </button>
      </form>
    ) : (
      <div className="space-y-3">
        <div className="rounded-md border border-divider bg-surface-page p-3">
          <p className="font-semibold text-navy-900">{view.waiting ? "Try again shortly" : "M-Pesa payment unavailable"}</p>
          <p className="mt-1">{view.message}</p>
        </div>
        {view.waiting && <ActionButton busy={busy} onPress={() => void payment.refresh(true)}>Check again</ActionButton>}
      </div>
    );
    body = view.demonstration ? (
      <>
        {/* The demonstration payment comes first; M-Pesa, for approved test numbers only, waits in a closed disclosure. */}
        <div className={columnsClass}>
          {amount}
          <div className="space-y-2">
            <ActionButton busy={busy} onPress={() => void payment.payWithDemonstration()} className={primaryClass} describedBy={`${amountId} ${noMoneyId}`}>
              {/* Soft hyphens let the uppercase word break as "DEMON-STRA-TION" at enlarged text on a narrow phone. */}
              Pay with a demon&shy;stra&shy;tion payment
            </ActionButton>
            <p id={noMoneyId} className="text-sm text-navy-800">No money is taken and no phone prompt is sent.</p>
          </div>
        </div>
        {/* A section of the panel under a hairline, not a bordered box inside it. */}
        <details className="group mt-4 border-t border-divider">
          <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 py-2 font-semibold text-navy-900 hover:text-link [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">Pay with M-Pesa sandbox instead</span>
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="size-5 shrink-0 transition-transform duration-(--motion-feedback) group-open:rotate-180 motion-reduce:transition-none">
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
            </svg>
          </summary>
          <div className="space-y-3 pt-2">
            <EnvironmentLabel environment={overview.environment} />
            {overview.environment === "sandbox" && <p className="text-sm text-navy-800">Prompts can only be sent to approved test numbers.</p>}
            {view.failed && <FailedAttempt attempt={view.failed} />}
            {mpesa}
          </div>
        </details>
      </>
    ) : (
      <div className={columnsClass}>
        <div className="space-y-3">
          {amount}
          <EnvironmentLabel environment={overview.environment} />
          {view.kind === "payable" && view.failed && <FailedAttempt attempt={view.failed} />}
        </div>
        <div className="space-y-3">
          {view.kind === "unavailable" && view.failed && <FailedAttempt attempt={view.failed} />}
          {mpesa}
        </div>
      </div>
    );
  } else if (overview && view?.kind === "demonstration-paid") {
    body = (
      <div className={columnsClass}>
        <Amount label="Order total" amount={overview.order.total} />
        <div className="space-y-3">
          <div aria-live="polite" className={`rounded-md border p-3 ${STAGE_TONES.paid}`}>
            <p className="font-semibold text-navy-900 hyphenate-long-words">Paid with a demonstration payment</p>
            <p className="mt-1">{demonstrationPaidText(overview.order.status)}</p>
          </div>
          {view.attempt && (
            <div className={`rounded-md border p-3 ${STAGE_TONES["received-review"]}`}>
              <p className="font-semibold text-navy-900">{STAGE_TITLES["received-review"]}</p>
              <p className="mt-1">{stageText(view.attempt, "received-review", overview.order.status)}</p>
              <div className="mt-2"><AttemptDetails attempt={view.attempt} /></div>
            </div>
          )}
        </div>
      </div>
    );
  } else if (overview && view?.kind === "unresolved") {
    body = (
      <div className={columnsClass}>
        <div className="space-y-3">
          <Amount label="Order total" amount={overview.order.total} />
          <EnvironmentLabel environment={overview.environment} />
        </div>
        <div className="rounded-md border border-warning/40 bg-warning-tint p-3">
          <p className="font-semibold text-navy-900">Your payment request has not been confirmed</p>
          <p className="mt-1">It may have reached M-Pesa, so do not start another payment for this order.</p>
          <p className="mt-1">
            {view.retryable
              ? "This order has no record of the request yet. Retrying sends the same request again, so it can create at most one prompt."
              : "Check this order's payments to find out what happened."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {view.retryable && <ActionButton busy={busy} onPress={() => void payment.retry()}>Retry the same request</ActionButton>}
            <ActionButton busy={busy} onPress={() => void payment.refresh(true)}>Check again</ActionButton>
          </div>
        </div>
      </div>
    );
  } else if (overview && view?.kind === "attempt") {
    const { attempt, stage } = view;
    const open = isOpenAttempt(attempt);
    const inactive = open && (overview.order.status !== "PENDING" || overview.order.reservationStatus !== "HELD" ||
      (overview.order.reservationExpiresAt !== null && Date.parse(overview.order.reservationExpiresAt) <= Date.now()));
    body = (
      <div className={columnsClass}>
        <div className="space-y-3">
          <AttemptDetails attempt={attempt} />
          <EnvironmentLabel environment={attempt.environment} />
        </div>
        <div className="space-y-3">
          <div aria-live="polite" className={`rounded-md border p-3 ${STAGE_TONES[stage]}`}>
            <p className="font-semibold text-navy-900">{inactive ? "Payment pending on an inactive order" : STAGE_TITLES[stage]}</p>
            <p className="mt-1">{inactive
              ? "This order is no longer awaiting payment on an active reservation. Do not approve an outstanding prompt. Check its outcome; any late payment needs staff review."
              : stageText(attempt, stage, overview.order.status)}</p>
            {stage === "paid" && attempt.reviewRequired && (
              <p className="mt-2 font-semibold">Staff need to review this payment before anything else happens. Do not pay again.</p>
            )}
          </div>
          {open && <ActionButton busy={busy} onPress={() => void payment.check(attempt)}>Check payment status</ActionButton>}
          {open && payment.autoStopped && (
            <p className="text-sm text-muted">Automatic checks have stopped. Use Check payment status to ask again.</p>
          )}
        </div>
      </div>
    );
  }

  // A sample order can be paid another way, so the panel is about payment, not just M-Pesa.
  const title = overview?.demonstration ? "Payment" : "Pay with M-Pesa";
  return <PanelFrame title={title} level={level} framed={framed} busy={payment.busy} notice={payment.notice}>{body}</PanelFrame>;
}

const STAFF_STAGES: Record<AttemptStage, string> = {
  submitting: "Submitting to M-Pesa",
  waiting: "Awaiting customer approval",
  unconfirmed: "Outcome unknown",
  verifying: "Needs verification",
  "received-review": "Money received, review required",
  paid: "Paid",
  failed: "Did not complete",
};

/**
 * Staff view of one order's M-Pesa attempts. Every staff role may read it; checks are offered only where
 * the attempt allows one and the role may request it. Staff cannot start or mark payments here;
 * `attemptActions` adds per-attempt controls supplied by the caller (for example, a review refund request).
 */
export function StaffPaymentPanel({ orderId, canCheck, headingLevel = 4, attemptActions }: {
  orderId: string;
  canCheck: boolean;
  headingLevel?: HeadingLevel;
  attemptActions?: (attempt: PaymentAttempt) => ReactNode;
}) {
  return <StaffPayment key={orderId} orderId={orderId} canCheck={canCheck} level={headingLevel} attemptActions={attemptActions} />;
}

function StaffPayment({ orderId, canCheck, level, attemptActions }: {
  orderId: string;
  canCheck: boolean;
  level: HeadingLevel;
  attemptActions?: (attempt: PaymentAttempt) => ReactNode;
}) {
  const payment = useStaffPayment(orderId);
  const noteId = useId();
  const busy = payment.busy !== null;
  const { overview } = payment;

  let body: ReactNode = <LoadFailure message={payment.loadError} busy={busy} onRetry={() => void payment.refresh(true)} />;
  if (overview) {
    const { order } = overview;
    const checkable = overview.attempts.some((attempt) => attempt.canReconcile);
    body = (
      <div className="mt-3 space-y-4">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 @3xl:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
          <dt className="text-muted">Order total</dt>
          <dd className="font-semibold">{formatKES(order.total)}</dd>
          <dt className="text-muted">Payment status</dt>
          <dd className="font-semibold">{order.paymentStatus}</dd>
          <dt className="text-muted">Payment method</dt>
          <dd>{paymentMethodLabel(order.paymentMethod)}</dd>
          <dt className="text-muted">Reservation</dt>
          <dd>{order.reservationStatus}{order.reservationExpiresAt ? ` until ${formatDateTime(order.reservationExpiresAt)}` : ""}</dd>
          <dt className="text-muted">Environment</dt>
          <dd>{overview.environment ?? "Not configured"}</dd>
        </dl>
        <p className="rounded-md bg-surface-page p-3 text-sm">
          {isDemonstrationPaid(order) ? "Paid with a demonstration payment: no money was taken and there is nothing to collect."
            : overview.available ? "The customer can request a new M-Pesa prompt." : `No new prompt: ${overview.message ?? "not available"}`}
        </p>
        {overview.attempts.length ? (
          <ol aria-label="M-Pesa attempts, newest first" className="grid gap-3 @3xl:grid-cols-2">
            {overview.attempts.map((attempt) => (
              <StaffAttempt key={attempt.id} attempt={attempt} canCheck={canCheck} busy={busy} noteId={noteId}
                onCheck={() => void payment.check(attempt)} extra={attemptActions?.(attempt)} />
            ))}
          </ol>
        ) : (
          <p>No M-Pesa attempts for this order.</p>
        )}
        {!canCheck && checkable && <p id={noteId} className="text-sm text-muted">Your role can view payments but cannot request M-Pesa checks.</p>}
        <ActionButton busy={busy} onPress={() => void payment.refresh(true)}>Refresh payments</ActionButton>
      </div>
    );
  }

  return <PanelFrame title="M-Pesa payments" level={level} busy={payment.busy} notice={payment.notice}>{body}</PanelFrame>;
}

function StaffAttempt({ attempt, canCheck, busy, noteId, onCheck, extra }: {
  attempt: PaymentAttempt;
  canCheck: boolean;
  busy: boolean;
  noteId: string;
  onCheck: () => void;
  extra?: ReactNode;
}) {
  const guidance = staffGuidance(attempt);
  return (
    <li className="rounded-md border border-divider p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-navy-900">{STAFF_STAGES[attemptStage(attempt)]}</p>
        <p className="font-mono text-sm text-muted">{attempt.status} · {attempt.environment}</p>
      </div>
      {attempt.reviewRequired && <p className="mt-2 rounded-sm border border-warning/40 bg-warning-tint px-2 py-1 font-bold text-navy-900">Review required</p>}
      <div className="mt-2"><AttemptDetails attempt={attempt} /></div>
      <p className="mt-2 text-muted">
        Updated {formatDateTime(attempt.updatedAt)}{attempt.nextCheckAt ? ` · next check from ${formatDateTime(attempt.nextCheckAt)}` : ""}
      </p>
      {guidance && <p className="mt-2 font-semibold">{guidance}</p>}
      {attempt.canReconcile && (
        <ActionButton busy={busy || !canCheck} describedBy={canCheck ? undefined : noteId} onPress={onCheck} className={`mt-3 ${secondaryClass}`}>
          Check with M-Pesa
        </ActionButton>
      )}
      {extra}
    </li>
  );
}
