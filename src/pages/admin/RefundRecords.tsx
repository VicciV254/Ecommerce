import { useId, useRef, useState, type ReactNode } from "react";
import { adminAPI, type OwedRefundInput, type RefundAction, type RefundRequestOption, type StaffOrder, type StaffRefund } from "../../api/admin";
import type { PaymentAttempt } from "../../api/mpesa";
import { StaffPaymentPanel } from "../../components/PaymentPanel";
import { REFUND_ACTION_LABELS, REFUND_SOURCE_TEXT, STAFF_REFUND_STATUS, describeStaffFailure } from "../../store/orderCopy";
import { OrderFormatError, parseRefundResult } from "../../store/orderModel";
import { formatDateTime, formatKES } from "../../utils/format";
import type { ActionOutcome } from "./OperationDialogs";
import { Feedback, inputClass } from "./shared";

const actionClass = "min-h-11 rounded-sm border border-brand-primary px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-brand-primary hover:bg-brand-primary hover:text-white";
const cautionClass = "min-h-11 rounded-sm border border-error/50 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-error hover:bg-error hover:text-white";
const DESTRUCTIVE: readonly RefundAction[] = ["fail", "cancel"];

/** One refund with its history; steps offered are exactly the refund's `allowedActions` for staff who may write. */
export function StaffRefundCard({ refund, canWrite, onAction, header, anchorId }: {
  refund: StaffRefund;
  canWrite: boolean;
  onAction: (action: RefundAction) => void;
  /** Extra context for list views, such as the order number. */
  header?: ReactNode;
  /** Lets the order workspace move focus to this refund; list copies have none, so ids stay unique. */
  anchorId?: string;
}) {
  const rows: [string, string][] = [
    ["Source", REFUND_SOURCE_TEXT[refund.source]],
    ["Requested", `${formatDateTime(refund.requestedAt)} by ${refund.requestedByType.toLowerCase()}`],
    ...(refund.amount !== refund.requestedAmount ? [["Requested amount", formatKES(refund.requestedAmount)] as [string, string]] : []),
    ...(refund.reason ? [["Reason", refund.reason] as [string, string]] : []),
    ...(refund.approvedAt ? [["Approved", formatDateTime(refund.approvedAt)] as [string, string]] : []),
    ...(refund.processingAt ? [["Sending started", formatDateTime(refund.processingAt)] as [string, string]] : []),
    ...(refund.confirmedAt ? [["Confirmed sent", formatDateTime(refund.confirmedAt)] as [string, string]] : []),
    ...(refund.providerReference ? [["M-Pesa reference", refund.providerReference] as [string, string]] : []),
    ...(refund.failedAt ? [["Failed", `${formatDateTime(refund.failedAt)}${refund.failureReason ? ` · ${refund.failureReason}` : ""}`] as [string, string]] : []),
    ...(refund.unresolvedAt ? [["Unresolved", `${formatDateTime(refund.unresolvedAt)}${refund.unresolvedNote ? ` · ${refund.unresolvedNote}` : ""}`] as [string, string]] : []),
    ...(refund.cancelledAt ? [["Cancelled", `${formatDateTime(refund.cancelledAt)}${refund.cancellationReason ? ` · ${refund.cancellationReason}` : ""}`] as [string, string]] : []),
  ];
  const actions = canWrite ? refund.allowedActions : [];
  return (
    <li className="rounded-md border border-light-gray p-3 sm:p-4">
      {header}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 id={anchorId} tabIndex={-1} className="font-mono text-sm font-bold text-brand-primary">{refund.number}</h4>
        <p className="text-sm font-semibold">{STAFF_REFUND_STATUS[refund.status]}</p>
      </div>
      <p className="mt-1 text-lg font-semibold tabular-nums text-navy-900">
        {formatKES(refund.amount)}
        {refund.includesDeliveryFee && <span className="ml-2 font-body text-xs text-gray-600">includes the delivery fee</span>}
      </p>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-gray-600">{label}</dt>
            <dd className={label === "M-Pesa reference" ? "font-mono" : undefined}>{value}</dd>
          </div>
        ))}
      </dl>
      {actions.length > 0 && (
        <>
          <p className="mt-3 text-xs font-semibold text-charcoal">
            Approval does not send money. Record the M-Pesa reference only after the refund has been sent.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {actions.map((action) => (
              <button key={action} type="button" onClick={() => onAction(action)} className={DESTRUCTIVE.includes(action) ? cautionClass : actionClass}>
                {REFUND_ACTION_LABELS[action]}<span className="sr-only"> {refund.number}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </li>
  );
}

/** Records a refund request for verified money on a payment under review; it sends nothing itself. */
function PaymentReviewRefund({ order, attempt, canWrite, onOutcome }: {
  order: StaffOrder;
  attempt: PaymentAttempt;
  canWrite: boolean;
  onOutcome: (outcome: ActionOutcome) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  if (!attempt.confirmedAt || !attempt.reviewRequired) return null;
  const existing = order.refunds.find((refund) => refund.paymentId === attempt.id && refund.source === "PAYMENT_REVIEW" && refund.status !== "CANCELLED");
  if (existing) {
    return <p className="mt-3 rounded-sm bg-off-white p-2 font-semibold">Refund {existing.number} for this payment: {STAFF_REFUND_STATUS[existing.status]}.</p>;
  }
  if (!canWrite) return null;

  const submit = async () => {
    if (busy) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("Enter why this payment is being refunded.");
      reasonRef.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { data } = await adminAPI.refunds.requestForPayment(attempt.id, trimmed);
      const result = parseRefundResult(data);
      onOutcome({ kind: "done", order: result.order, message: `Refund ${result.refund.number} of ${formatKES(result.refund.amount)} requested for this payment. It has not been sent yet.` });
    } catch (failure) {
      const outcome = failure instanceof OrderFormatError
        ? { message: "The request was sent, but the updated order could not be read. It has been reloaded.", reload: true }
        : describeStaffFailure(failure, "The refund request could not be recorded.");
      if (outcome.reload) onOutcome({ kind: "stale", message: outcome.message });
      else setError(outcome.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 border-t border-light-gray pt-3">
      <button type="button" aria-expanded={open} aria-controls={`${id}-form`} onClick={() => setOpen((value) => !value)} className={actionClass}>
        Request refund of this payment
      </button>
      <div id={`${id}-form`}>
        {open && (
          <div className="mt-3 space-y-3">
            <p>
              Records a refund request for the money received on this payment ({formatKES(attempt.amount)}, less anything already refunded
              from it). No money is sent until the refund is confirmed with an M-Pesa reference.
            </p>
            <div>
              <label htmlFor={`${id}-reason`} className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-600">Reason (required)</label>
              <textarea ref={reasonRef} id={`${id}-reason`} rows={2} maxLength={500} value={reason}
                onChange={(event) => { setReason(event.target.value); setError(""); }} className={`${inputClass} min-h-11 text-base`} />
            </div>
            <Feedback message={error} tone="error" />
            <p role="status" className="sr-only">{busy ? "Saving…" : ""}</p>
            <button type="button" aria-disabled={busy} onClick={() => void submit()} className={actionClass}>Record refund request</button>
          </div>
        )}
      </div>
    </div>
  );
}

function optionLabel(option: RefundRequestOption) {
  return option.source === "CANCELLATION"
    ? `Request remaining refund (up to ${formatKES(option.maxAmount)})`
    : `Request refund for return ${option.returnNumber} again`;
}

/** One owed amount the server says can be requested again; it records a request and sends nothing. */
function OwedRefundRequest({ order, option, onOutcome }: {
  order: StaffOrder;
  option: RefundRequestOption;
  onOutcome: (outcome: ActionOutcome) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  const submit = async () => {
    if (busy) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("Enter why this refund is being requested again.");
      reasonRef.current?.focus();
      return;
    }
    const input: OwedRefundInput = option.source === "RETURN"
      ? { source: "RETURN", returnId: option.returnId, reason: trimmed }
      : { source: "CANCELLATION", reason: trimmed };
    setBusy(true);
    setError("");
    try {
      const { data } = await adminAPI.refunds.requestOwed(order.id, input);
      const result = parseRefundResult(data);
      onOutcome({ kind: "done", order: result.order, message: `Refund ${result.refund.number} of ${formatKES(result.refund.amount)} requested. It has not been sent yet.` });
    } catch (failure) {
      const outcome = failure instanceof OrderFormatError
        ? { message: "The request was sent, but the updated order could not be read. It has been reloaded.", reload: true }
        : describeStaffFailure(failure, "The refund request could not be recorded.");
      if (outcome.reload) onOutcome({ kind: "stale", message: outcome.message });
      else setError(outcome.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
      <p className="font-semibold text-charcoal">
        {option.source === "CANCELLATION"
          ? `Money is still owed for this cancelled order: up to ${formatKES(option.maxAmount)}.`
          : `Money is still owed for return ${option.returnNumber}: up to ${formatKES(option.maxAmount)}.`}
      </p>
      <button type="button" aria-expanded={open} aria-controls={`${id}-form`} onClick={() => setOpen((value) => !value)} className={`mt-2 ${actionClass}`}>
        {optionLabel(option)}
      </button>
      <div id={`${id}-form`}>
        {open && (
          <div className="mt-3 space-y-3">
            <p>This only records a new refund request. No money is sent until it is approved, sent and confirmed.</p>
            <div>
              <label htmlFor={`${id}-reason`} className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-600">Reason (required)</label>
              <textarea ref={reasonRef} id={`${id}-reason`} rows={2} maxLength={500} value={reason}
                onChange={(event) => { setReason(event.target.value); setError(""); }} className={`${inputClass} min-h-11 text-base`} />
            </div>
            <Feedback message={error} tone="error" />
            <p role="status" className="sr-only">{busy ? "Saving…" : ""}</p>
            <button type="button" aria-disabled={busy} onClick={() => void submit()} className={actionClass}>Record refund request</button>
          </div>
        )}
      </div>
    </li>
  );
}

/** Refunds the server says can be requested again; nothing is shown to roles that cannot write. */
export function RefundRequestOptions({ order, canWrite, onOutcome }: {
  order: StaffOrder;
  canWrite: boolean;
  onOutcome: (outcome: ActionOutcome) => void;
}) {
  if (!canWrite || !order.refundRequestOptions.length) return null;
  return (
    <ul aria-label="Refunds that can be requested again" className="space-y-3">
      {order.refundRequestOptions.map((option) => (
        <OwedRefundRequest key={option.source === "RETURN" ? `return-${option.returnId}` : "cancellation"} order={order} option={option} onOutcome={onOutcome} />
      ))}
    </ul>
  );
}

/** The order's M-Pesa record, loaded only while expanded. */
export function OrderPayments({ order, canWrite, defaultOpen, onOutcome }: {
  order: StaffOrder;
  canWrite: boolean;
  defaultOpen: boolean;
  onOutcome: (outcome: ActionOutcome) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const regionId = `order-payments-${order.id}`;
  return (
    <div>
      <button type="button" aria-expanded={open} aria-controls={regionId} onClick={() => setOpen((value) => !value)}
        className="min-h-11 w-full rounded-sm border border-brand-primary px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-brand-primary hover:bg-brand-primary hover:text-white">
        M-Pesa payments<span className="sr-only"> for {order.orderNumber}</span>
      </button>
      <div id={regionId} className={open ? "mt-3" : undefined}>
        {open && (
          <StaffPaymentPanel orderId={order.id} canCheck={canWrite}
            attemptActions={(attempt) => <PaymentReviewRefund order={order} attempt={attempt} canWrite={canWrite} onOutcome={onOutcome} />} />
        )}
      </div>
    </div>
  );
}
