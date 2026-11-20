import { useId, useRef, useState, type FormEvent, type ReactNode, type Ref } from "react";
import { adminAPI, type RefundAction, type StaffAction, type StaffOrder, type StaffRefund } from "../../api/admin";
import { ModalDialog } from "../../components/Modal";
import {
  REFUND_ACTION_LABELS,
  STAFF_ACTION_LABELS,
  STAFF_ACTION_RESULTS,
  cancellationRefund,
  describeStaffFailure,
  isDemonstrationOrder,
  type StaffFailure,
} from "../../store/orderCopy";
import { OrderFormatError, parseRefundResult, parseStaffOrder } from "../../store/orderModel";
import { formatKES } from "../../utils/format";
import { Feedback, inputClass } from "./shared";

/** What a dialog reports back: the server's updated order, or a stale record the caller must reload. */
export type ActionOutcome =
  | { kind: "done"; order: StaffOrder; message: string }
  | { kind: "stale"; message: string };

const MAX_REASON = 500;
const MAX_TRACKING = 100;
const TRACKING_NUMBER = /^[\w .:#/-]+$/;
const MPESA_REFERENCE = /^[A-Z0-9]{8,32}$/;
const UNREADABLE = "The change was sent, but the updated order could not be read. It has been reloaded; check it before acting again.";

const backClass = "min-h-11 rounded-sm border border-light-gray px-4 py-2 text-[0.6875rem] font-bold uppercase tracking-wider text-charcoal hover:bg-off-white aria-disabled:opacity-50";
const confirmClass = "min-h-11 rounded-sm bg-brand-primary px-4 py-2 text-[0.6875rem] font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-60";
const destructiveClass = "min-h-11 rounded-sm bg-error px-4 py-2 text-[0.6875rem] font-bold uppercase tracking-wider text-white hover:bg-red-700 aria-disabled:cursor-not-allowed aria-disabled:opacity-60";
const labelClass = "mb-1 block text-[0.625rem] font-bold uppercase tracking-wider text-gray-600";

function failureOf(error: unknown, fallback: string): StaffFailure {
  return error instanceof OrderFormatError ? { message: UNREADABLE, reload: true } : describeStaffFailure(error, fallback);
}

/** Confirmation frame: description first, fields, then an error that stays inside the dialog. */
function ActionDialogFrame({ title, description, submitLabel, destructive = false, busy, error, onClose, onSubmit, children }: {
  title: string;
  description: ReactNode;
  submitLabel: string;
  destructive?: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: () => void;
  children?: ReactNode;
}) {
  const titleId = useId();
  const close = () => {
    if (!busy) onClose();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy) onSubmit();
  };
  return (
    <ModalDialog open label={title} onClose={close}>
      <form noValidate onSubmit={submit} aria-labelledby={titleId}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-lg bg-white p-5 text-charcoal shadow-2xl [overflow-wrap:anywhere] sm:p-6">
        <h3 id={titleId} className="font-display text-lg text-brand-primary">{title}</h3>
        <div className="mt-2 space-y-2 text-sm">{description}</div>
        {children && <div className="mt-4 space-y-4">{children}</div>}
        {error && <div className="mt-4"><Feedback message={error} tone="error" /></div>}
        <p role="status" className="sr-only">{busy ? "Saving…" : ""}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={close} aria-disabled={busy} className={backClass}>Back</button>
          <button type="submit" aria-disabled={busy} className={destructive ? destructiveClass : confirmClass}>{busy ? "Saving…" : submitLabel}</button>
        </div>
      </form>
    </ModalDialog>
  );
}

function ReasonField({ id, label, hint, value, invalid, fieldRef, onChange }: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  invalid: boolean;
  fieldRef?: Ref<HTMLTextAreaElement>;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{label}</label>
      <textarea ref={fieldRef} id={id} rows={3} maxLength={MAX_REASON} value={value} aria-invalid={invalid || undefined}
        aria-describedby={hint ? `${id}-hint` : undefined} onChange={(event) => onChange(event.target.value)}
        className={`${inputClass} min-h-11 text-base aria-[invalid=true]:border-error`} />
      {hint && <p id={`${id}-hint`} className="mt-1 text-[0.6875rem] text-gray-600">{hint}</p>}
    </div>
  );
}

function orderActionDescription(order: StaffOrder, action: StaffAction) {
  const days = order.returnEligibility.policy.windowDays;
  switch (action) {
    case "START_PROCESSING":
      return "Accept this paid order and start preparing it. The customer can still cancel while it is processing.";
    case "MARK_READY_FOR_PICKUP":
      return "Tell the customer the order is ready to collect. We email them to bring their order number.";
    case "DISPATCH":
      return "Record that the order has left for delivery. We email the customer. Add the courier tracking number if there is one.";
    case "CONFIRM_DELIVERY":
      return `Confirm the customer has received the order. This starts the ${days}-day return window and emails the customer.`;
    case "CONFIRM_PICKUP":
      return `Confirm the customer collected the order at handover. This starts the ${days}-day return window and emails the customer.`;
    default: {
      // A demonstration-paid order's refund is a demonstration refund, which never sends money.
      const refundNote = isDemonstrationOrder(order) ? "Its refund will be a demonstration refund: no money is sent." : "No money is sent until that refund is confirmed.";
      switch (cancellationRefund(order.paymentStatus)) {
        case "full":
          return `Cancel this order and release or restock its items. It is paid, so a refund request for the full ${formatKES(order.total)} (including delivery) is recorded. ${refundNote}`;
        case "remaining":
          return `Cancel this order and release or restock its items. Part of the payment was already refunded, so a refund request for the remaining paid balance is recorded. ${refundNote}`;
        case "settled":
          return "Cancel this order and release or restock its items. The payment was already refunded, so no further refund is requested.";
        default:
          return "Cancel this order and release its reserved items. The customer is emailed.";
      }
    }
  }
}

/** Applies one permitted fulfilment action with the status the staff member saw as `expectedStatus`. */
export function OrderActionDialog({ order, action, onClose, onOutcome }: {
  order: StaffOrder;
  action: StaffAction;
  onClose: () => void;
  onOutcome: (outcome: ActionOutcome) => void;
}) {
  const [reason, setReason] = useState("");
  const [tracking, setTracking] = useState("");
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<"reason" | "tracking" | null>(null);
  const [busy, setBusy] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const trackingRef = useRef<HTMLInputElement>(null);
  const id = useId();

  const submit = async () => {
    const trimmedReason = reason.trim();
    const trimmedTracking = tracking.trim();
    if (action === "CANCEL" && !trimmedReason) {
      setInvalid("reason");
      setError("Enter a reason for cancelling. The customer sees it in their order history.");
      reasonRef.current?.focus();
      return;
    }
    if (trimmedTracking && !TRACKING_NUMBER.test(trimmedTracking)) {
      setInvalid("tracking");
      setError("Use letters, numbers, spaces and . : # / - in the tracking number.");
      trackingRef.current?.focus();
      return;
    }
    setInvalid(null);
    setError("");
    setBusy(true);
    try {
      const { data } = await adminAPI.orders.applyAction(order.id, {
        action, expectedStatus: order.status,
        ...(action === "CANCEL" && { reason: trimmedReason }),
        ...(action === "DISPATCH" && trimmedTracking && { trackingNumber: trimmedTracking }),
      });
      onOutcome({ kind: "done", order: parseStaffOrder(data, order.id), message: `Order ${order.orderNumber} ${STAFF_ACTION_RESULTS[action]}.` });
    } catch (failure) {
      const outcome = failureOf(failure, "The order could not be updated.");
      if (outcome.reload) onOutcome({ kind: "stale", message: outcome.message });
      else setError(outcome.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ActionDialogFrame
      title={`${STAFF_ACTION_LABELS[action]} · ${order.orderNumber}`}
      description={<p>{orderActionDescription(order, action)}</p>}
      submitLabel={STAFF_ACTION_LABELS[action]}
      destructive={action === "CANCEL"}
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      {action === "CANCEL" && (
        <ReasonField id={`${id}-reason`} label="Reason (required)" hint="The customer sees this reason in their order history."
          value={reason} invalid={invalid === "reason"} fieldRef={reasonRef} onChange={setReason} />
      )}
      {action === "DISPATCH" && (
        <div>
          <label htmlFor={`${id}-tracking`} className={labelClass}>Tracking number (optional)</label>
          <input ref={trackingRef} id={`${id}-tracking`} value={tracking} maxLength={MAX_TRACKING} autoComplete="off"
            aria-invalid={invalid === "tracking" || undefined} onChange={(event) => setTracking(event.target.value)}
            className={`${inputClass} min-h-11 text-base aria-[invalid=true]:border-error`} />
        </div>
      )}
    </ActionDialogFrame>
  );
}

const REFUND_DESCRIPTIONS: Record<RefundAction, string> = {
  approve: "Approval does not send money. After approving, send the refund by M-Pesa, then record its M-Pesa reference.",
  start: "Mark that you are sending this refund by M-Pesa now. It is not recorded as sent until you enter the M-Pesa reference.",
  confirm: "Record this only after M-Pesa shows the refund was sent. The customer is emailed that the refund was sent, with this reference.",
  fail: "Record that the M-Pesa refund did not go through. Nothing is recorded as sent, and the amount stays reserved for a retry.",
  unresolved: "Use this when you cannot tell whether the money was sent. Check M-Pesa before taking another step.",
  retry: "Move this failed refund back to approved so it can be sent again. This step sends no money.",
  cancel: "Withdraw this refund. Only a refund that has not been sent can be cancelled.",
};

const REASON_LABELS: Partial<Record<RefundAction, string>> = {
  fail: "Why the refund failed (required)",
  unresolved: "What is uncertain (required)",
  cancel: "Why the refund is cancelled (required)",
};

function refundResultMessage(refund: StaffRefund, action: RefundAction) {
  switch (action) {
    case "approve":
      return `Refund ${refund.number} approved for ${formatKES(refund.amount)}. It has not been sent yet.`;
    case "start":
      return `Refund ${refund.number} marked as being sent. Record the M-Pesa reference once it completes.`;
    case "confirm":
      return `Refund ${refund.number} recorded as sent by M-Pesa (reference ${refund.providerReference ?? "recorded"}).`;
    case "fail":
      return `Refund ${refund.number} marked as failed; it was not sent.`;
    case "unresolved":
      return `Refund ${refund.number} marked unresolved. Check M-Pesa before the next step.`;
    case "retry":
      return `Refund ${refund.number} is ready to be sent again. It has not been sent yet.`;
    default:
      return `Refund ${refund.number} cancelled; it was not sent.`;
  }
}

/** One permitted refund step; approval never moves money and only a recorded reference confirms a refund. */
export function RefundActionDialog({ refund, action, onClose, onOutcome }: {
  refund: StaffRefund;
  action: RefundAction;
  onClose: () => void;
  onOutcome: (outcome: ActionOutcome & { refund?: StaffRefund }) => void;
}) {
  const [amount, setAmount] = useState(String(refund.requestedAmount));
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<"amount" | "reason" | "reference" | null>(null);
  const [busy, setBusy] = useState(false);
  const fields = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});
  const id = useId();
  const reasonRequired = action === "fail" || action === "unresolved" || action === "cancel";

  const reject = (field: "amount" | "reason" | "reference", message: string) => {
    setInvalid(field);
    setError(message);
    fields.current[field]?.focus();
  };

  const submit = async () => {
    const trimmedReason = reason.trim();
    const approved = Number(amount);
    const lowered = action === "approve" && approved !== refund.requestedAmount;
    if (action === "approve" && (!Number.isInteger(approved) || approved <= 0 || approved > refund.requestedAmount)) {
      return reject("amount", `Enter a whole-KES amount from 1 to ${formatKES(refund.requestedAmount)}.`);
    }
    if ((reasonRequired || lowered) && !trimmedReason) {
      return reject("reason", lowered ? "Explain why the approved amount is lower than requested." : "Enter a reason for this step.");
    }
    const providerReference = reference.trim().toUpperCase();
    if (action === "confirm" && !MPESA_REFERENCE.test(providerReference)) {
      return reject("reference", "Enter the M-Pesa transaction reference: 8 to 32 letters and numbers.");
    }
    setInvalid(null);
    setError("");
    setBusy(true);
    try {
      const { data } = await adminAPI.refunds.act(refund.id, action, {
        expectedStatus: refund.status,
        ...(lowered && { amount: approved }),
        ...(trimmedReason && { reason: trimmedReason }),
        ...(action === "confirm" && { providerReference }),
      });
      const result = parseRefundResult(data, refund.id);
      onOutcome({ kind: "done", order: result.order, refund: result.refund, message: refundResultMessage(result.refund, action) });
    } catch (failure) {
      const outcome = failureOf(failure, "The refund could not be updated.");
      if (outcome.reload) onOutcome({ kind: "stale", message: outcome.message });
      else setError(outcome.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ActionDialogFrame
      title={`${REFUND_ACTION_LABELS[action]} · ${refund.number}`}
      description={(
        <>
          <p>{REFUND_DESCRIPTIONS[action]}</p>
          <p className="font-semibold text-brand-primary">Amount: {formatKES(refund.amount)}{refund.includesDeliveryFee ? " (includes the delivery fee)" : ""}</p>
        </>
      )}
      submitLabel={REFUND_ACTION_LABELS[action]}
      destructive={action === "cancel" || action === "fail"}
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      {action === "approve" && (
        <div>
          <label htmlFor={`${id}-amount`} className={labelClass}>Amount to approve (KES)</label>
          <input ref={(element) => { fields.current.amount = element; }} id={`${id}-amount`} type="number" inputMode="numeric"
            min={1} max={refund.requestedAmount} step={1} value={amount} aria-invalid={invalid === "amount" || undefined}
            aria-describedby={`${id}-amount-hint`} onChange={(event) => setAmount(event.target.value)}
            className={`${inputClass} min-h-11 text-base aria-[invalid=true]:border-error`} />
          <p id={`${id}-amount-hint`} className="mt-1 text-[0.6875rem] text-gray-600">
            Requested {formatKES(refund.requestedAmount)}. A lower amount needs a reason.
          </p>
        </div>
      )}
      {(reasonRequired || action === "approve") && (
        <ReasonField id={`${id}-reason`} label={REASON_LABELS[action] ?? "Reason (required for a lower amount)"}
          value={reason} invalid={invalid === "reason"} fieldRef={(element) => { fields.current.reason = element; }} onChange={setReason} />
      )}
      {action === "confirm" && (
        <div>
          <label htmlFor={`${id}-reference`} className={labelClass}>M-Pesa reference (required)</label>
          <input ref={(element) => { fields.current.reference = element; }} id={`${id}-reference`} value={reference} maxLength={32}
            autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-invalid={invalid === "reference" || undefined}
            aria-describedby={`${id}-reference-hint`} onChange={(event) => setReference(event.target.value.toUpperCase())}
            className={`${inputClass} min-h-11 font-mono text-base uppercase aria-[invalid=true]:border-error`} />
          <p id={`${id}-reference-hint`} className="mt-1 text-[0.6875rem] text-gray-600">8 to 32 letters and numbers, from the M-Pesa transaction.</p>
        </div>
      )}
    </ActionDialogFrame>
  );
}
