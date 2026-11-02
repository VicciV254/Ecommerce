import { useId, useLayoutEffect, useRef, useState, type FocusEvent, type FormEvent, type ReactNode } from "react";
import type { PaymentAttempt, PaymentEnvironment, PaymentOrderSummary } from "../api/mpesa";
import type { OrderStatus } from "../api/orders";
import { useAuth } from "../contexts/AuthContext";
import { attemptStage, isOpenAttempt, staffGuidance, type AttemptStage } from "../store/paymentModel";
import { useCustomerPayment, useStaffPayment, type PaymentBusy, type PaymentNotice } from "../store/useOrderPayment";
import { formatDateTime, formatKES } from "../utils/format";

type HeadingLevel = 2 | 3 | 4;

const labelClass = "block text-[11px] font-bold uppercase tracking-[0.12em] text-brand-primary";
const fieldClass = "mt-1.5 min-h-11 w-full min-w-0 rounded-sm border border-light-gray bg-off-white px-3 py-2.5 text-base focus:border-brand-secondary aria-[invalid=true]:border-error";
const primaryClass = "min-h-11 w-full rounded-sm bg-brand-primary px-5 py-3 text-xs font-bold uppercase tracking-[0.12em] text-white hover:bg-brand-secondary hover:text-brand-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-60";
const secondaryClass = "min-h-11 rounded-sm border border-brand-primary px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-primary hover:bg-brand-primary hover:text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
const columnsClass = "mt-4 grid grid-cols-1 gap-4 @lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] @lg:items-start @lg:gap-6";

const BUSY_TEXT: Record<PaymentBusy, string> = {
  loading: "Checking payment status…",
  sending: "Requesting your M-Pesa prompt…",
  checking: "Checking this payment with M-Pesa…",
  watching: "",
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

/** Labelled region with alert and status areas that stay mounted, so updates are announced where they happen. */
function PanelFrame({ title, level, busy, notice, children }: {
  title: string;
  level: HeadingLevel;
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
      className="@container rounded-lg border border-light-gray bg-white p-4 text-left text-sm text-charcoal [overflow-wrap:anywhere] sm:p-5">
      <Heading id={titleId} ref={focus.heading} tabIndex={-1} className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">
        {title}
      </Heading>
      {children}
      {notice?.tone === "error" && (
        <p role="alert" className="mt-3 rounded-md border border-error/30 bg-error/5 p-3 font-semibold text-error">{notice.text}</p>
      )}
      <p role="status" className={`text-xs text-charcoal ${status ? "mt-3" : ""}`}>{status}</p>
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
      <p role="alert" className="rounded-md border border-error/30 bg-error/5 p-3 font-semibold text-error">{message}</p>
      <ActionButton busy={busy} onPress={onRetry}>Try again</ActionButton>
    </div>
  );
}

function EnvironmentLabel({ environment }: { environment: PaymentEnvironment | null }) {
  if (environment === "sandbox") {
    return (
      <p className="rounded-md border-2 border-warning bg-warning/10 px-3 py-2 text-sm font-bold text-charcoal">
        Sandbox test: real funds may be deducted
      </p>
    );
  }
  if (environment === "production") {
    return (
      <p className="inline-block rounded-full border border-success/40 bg-success/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-success">
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
      <p className="mt-1 font-display text-2xl text-brand-primary">{formatKES(amount)}</p>
      <p className="text-xs text-gray-600">The saved total for this order.</p>
    </div>
  );
}

function AttemptDetails({ attempt }: { attempt: PaymentAttempt }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
      <dt className="text-gray-600">Amount</dt>
      <dd className="font-semibold text-brand-primary">{formatKES(attempt.amount)}</dd>
      <dt className="text-gray-600">Phone</dt>
      <dd>{attempt.phoneMasked}</dd>
      {attempt.receiptNumber && (
        <>
          <dt className="text-gray-600">M-Pesa receipt</dt>
          <dd className="font-mono font-semibold">{attempt.receiptNumber}</dd>
        </>
      )}
      <dt className="text-gray-600">Requested</dt>
      <dd>{formatDateTime(attempt.createdAt)}</dd>
      {attempt.confirmedAt && (
        <>
          <dt className="text-gray-600">Confirmed</dt>
          <dd>{formatDateTime(attempt.confirmedAt)}</dd>
        </>
      )}
    </dl>
  );
}

function FailedAttempt({ attempt }: { attempt: PaymentAttempt }) {
  return (
    <div className="rounded-md border border-error/30 bg-error/5 p-3">
      <p className="font-semibold text-error">Payment not completed</p>
      <p className="mt-1">{attempt.message}</p>
      <p className="mt-1 text-xs text-gray-600">Requested {formatDateTime(attempt.createdAt)} for {attempt.phoneMasked}.</p>
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
  submitting: "border-ocean-blue/30 bg-ocean-blue/10",
  waiting: "border-ocean-blue/30 bg-ocean-blue/10",
  unconfirmed: "border-warning/40 bg-warning/10",
  verifying: "border-warning/40 bg-warning/10",
  "received-review": "border-warning/40 bg-warning/10",
  paid: "border-success/40 bg-success/10",
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

/**
 * The signed-in customer's M-Pesa payment for one order. Nothing is requested until the customer
 * confirms the amount and phone, and the PIN is only ever entered on their phone.
 */
export function PaymentPanel({ orderId, onOrderChange, headingLevel = 2 }: {
  orderId: string;
  /** Receives the server's order summary after each status load, so surrounding text never contradicts it. */
  onOrderChange?: (summary: PaymentOrderSummary) => void;
  headingLevel?: HeadingLevel;
}) {
  const { user } = useAuth();
  if (!user) return null;
  // Keyed by account and order: a request, phone number or late answer never reaches another customer.
  return (
    <CustomerPayment key={`${user.id}:${orderId}`} ownerId={user.id} orderId={orderId} defaultPhone={user.phone ?? ""}
      level={headingLevel} onOrderChange={onOrderChange} />
  );
}

function CustomerPayment({ ownerId, orderId, defaultPhone, level, onOrderChange }: {
  ownerId: string;
  orderId: string;
  defaultPhone: string;
  level: HeadingLevel;
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
  if (overview && view?.kind === "payable") {
    const [amountId, phoneId, hintId, errorId, pinId] = ["amount", "phone", "hint", "error", "pin"].map((part) => `${ids}-${part}`);
    body = (
      <div className={columnsClass}>
        <div className="space-y-3">
          <Amount id={amountId} label="Amount to pay" amount={overview.order.total} />
          <EnvironmentLabel environment={overview.environment} />
          {view.failed && <FailedAttempt attempt={view.failed} />}
        </div>
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
            <p id={hintId} className="mt-1 text-xs text-gray-600">For example 0712 345 678 or +254 712 345 678.</p>
            {payment.phoneError && <p id={errorId} role="alert" className="mt-1.5 text-xs font-semibold text-error">{payment.phoneError}</p>}
          </div>
          <p id={pinId} className="rounded-md border border-ocean-blue/30 bg-ocean-blue/10 p-3 text-xs font-semibold text-ocean-blue-dark">
            Enter your M-Pesa PIN only on your phone, in the M-Pesa prompt. Never type it on this website.
          </p>
          <button type="submit" aria-disabled={busy} aria-describedby={`${amountId} ${pinId}`} className={primaryClass}>
            {view.failed ? "Send new M-Pesa prompt" : "Send M-Pesa prompt"}
          </button>
        </form>
      </div>
    );
  } else if (overview && view?.kind === "unresolved") {
    body = (
      <div className={columnsClass}>
        <div className="space-y-3">
          <Amount label="Order total" amount={overview.order.total} />
          <EnvironmentLabel environment={overview.environment} />
        </div>
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
          <p className="font-semibold text-brand-primary">Your payment request has not been confirmed</p>
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
            <p className="font-semibold text-brand-primary">{inactive ? "Payment pending on an inactive order" : STAGE_TITLES[stage]}</p>
            <p className="mt-1">{inactive
              ? "This order is no longer awaiting payment on an active reservation. Do not approve an outstanding prompt. Check its outcome; any late payment needs staff review."
              : stageText(attempt, stage, overview.order.status)}</p>
            {stage === "paid" && attempt.reviewRequired && (
              <p className="mt-2 font-semibold">Staff need to review this payment before anything else happens. Do not pay again.</p>
            )}
          </div>
          {open && <ActionButton busy={busy} onPress={() => void payment.check(attempt)}>Check payment status</ActionButton>}
          {open && payment.autoStopped && (
            <p className="text-xs text-gray-600">Automatic checks have stopped. Use Check payment status to ask again.</p>
          )}
        </div>
      </div>
    );
  } else if (overview && view?.kind === "unavailable") {
    body = (
      <div className={columnsClass}>
        <div className="space-y-3">
          <Amount label="Order total" amount={overview.order.total} />
          <EnvironmentLabel environment={overview.environment} />
        </div>
        <div className="space-y-3">
          {view.failed && <FailedAttempt attempt={view.failed} />}
          <div className="rounded-md border border-light-gray bg-off-white p-3">
            <p className="font-semibold text-brand-primary">{view.waiting ? "Try again shortly" : "M-Pesa payment unavailable"}</p>
            <p className="mt-1">{view.message}</p>
          </div>
          {view.waiting && <ActionButton busy={busy} onPress={() => void payment.refresh(true)}>Check again</ActionButton>}
        </div>
      </div>
    );
  }

  return <PanelFrame title="Pay with M-Pesa" level={level} busy={payment.busy} notice={payment.notice}>{body}</PanelFrame>;
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
 * the attempt allows one and the role may request it. Staff cannot start, mark or refund payments here.
 */
export function StaffPaymentPanel({ orderId, canCheck, headingLevel = 4 }: { orderId: string; canCheck: boolean; headingLevel?: HeadingLevel }) {
  return <StaffPayment key={orderId} orderId={orderId} canCheck={canCheck} level={headingLevel} />;
}

function StaffPayment({ orderId, canCheck, level }: { orderId: string; canCheck: boolean; level: HeadingLevel }) {
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
          <dt className="text-gray-600">Order total</dt>
          <dd className="font-semibold">{formatKES(order.total)}</dd>
          <dt className="text-gray-600">Payment status</dt>
          <dd className="font-semibold">{order.paymentStatus}</dd>
          <dt className="text-gray-600">Reservation</dt>
          <dd>{order.reservationStatus}{order.reservationExpiresAt ? ` until ${formatDateTime(order.reservationExpiresAt)}` : ""}</dd>
          <dt className="text-gray-600">Environment</dt>
          <dd>{overview.environment ?? "Not configured"}</dd>
        </dl>
        <p className="rounded-md bg-off-white p-3 text-xs">
          {overview.available ? "The customer can request a new M-Pesa prompt." : `No new prompt: ${overview.message ?? "not available"}`}
        </p>
        {overview.attempts.length ? (
          <ol aria-label="M-Pesa attempts, newest first" className="grid gap-3 @3xl:grid-cols-2">
            {overview.attempts.map((attempt) => (
              <StaffAttempt key={attempt.id} attempt={attempt} canCheck={canCheck} busy={busy} noteId={noteId}
                onCheck={() => void payment.check(attempt)} />
            ))}
          </ol>
        ) : (
          <p>No M-Pesa attempts for this order.</p>
        )}
        {!canCheck && checkable && <p id={noteId} className="text-xs text-gray-600">Your role can view payments but cannot request M-Pesa checks.</p>}
        <ActionButton busy={busy} onPress={() => void payment.refresh(true)}>Refresh payments</ActionButton>
      </div>
    );
  }

  return <PanelFrame title="M-Pesa payments" level={level} busy={payment.busy} notice={payment.notice}>{body}</PanelFrame>;
}

function StaffAttempt({ attempt, canCheck, busy, noteId, onCheck }: {
  attempt: PaymentAttempt;
  canCheck: boolean;
  busy: boolean;
  noteId: string;
  onCheck: () => void;
}) {
  const guidance = staffGuidance(attempt);
  return (
    <li className="rounded-md border border-light-gray p-3 text-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-brand-primary">{STAFF_STAGES[attemptStage(attempt)]}</p>
        <p className="font-mono text-[11px] text-gray-600">{attempt.status} · {attempt.environment}</p>
      </div>
      {attempt.reviewRequired && <p className="mt-2 rounded-sm border border-warning/40 bg-warning/10 px-2 py-1 font-bold text-charcoal">Review required</p>}
      <div className="mt-2"><AttemptDetails attempt={attempt} /></div>
      <p className="mt-2 text-gray-600">
        Updated {formatDateTime(attempt.updatedAt)}{attempt.nextCheckAt ? ` · next check from ${formatDateTime(attempt.nextCheckAt)}` : ""}
      </p>
      {guidance && <p className="mt-2 font-semibold">{guidance}</p>}
      {attempt.canReconcile && (
        <ActionButton busy={busy || !canCheck} describedBy={canCheck ? undefined : noteId} onPress={onCheck} className={`mt-3 ${secondaryClass}`}>
          Check with M-Pesa
        </ActionButton>
      )}
    </li>
  );
}
