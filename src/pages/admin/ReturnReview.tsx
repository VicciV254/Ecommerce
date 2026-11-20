import { useId, useRef, useState } from "react";
import { adminAPI, type StaffOrder, type StaffReturn, type StaffReturnLine } from "../../api/admin";
import type { DeliveryFeeRefund } from "../../api/orders";
import { RETURN_REASON_LABELS, STAFF_RETURN_STATUS, describeStaffFailure, isDemonstrationOrder, returnRuleText } from "../../store/orderCopy";
import { OrderFormatError, parseStaffOrder } from "../../store/orderModel";
import { formatDateTime, formatKES } from "../../utils/format";
import type { ActionOutcome } from "./OperationDialogs";
import { Feedback, inputClass } from "./shared";

const MAX_NOTE = 1000;
const UNREADABLE = "The change was sent, but the updated order could not be read. It has been reloaded; check it before acting again.";
const labelClass = "mb-1 block text-[0.625rem] font-bold uppercase tracking-wider text-gray-600";
const approveClass = "min-h-11 rounded-sm bg-brand-primary px-4 py-2 text-[0.6875rem] font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-60";
const rejectClass = "min-h-11 rounded-sm border border-error px-4 py-2 text-[0.6875rem] font-bold uppercase tracking-wider text-error hover:bg-error hover:text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

const FEE_ON_FAULT: Record<DeliveryFeeRefund, string> = {
  MERCHANT_FAULT_ONLY: "Confirming a fault also refunds the delivery fee, once per order.",
  ALWAYS: "The delivery fee is refunded with the first refundable return on this order.",
  NEVER: "The delivery fee is not refunded for returns on this order.",
};

function failureOf(error: unknown, fallback: string) {
  return error instanceof OrderFormatError ? { message: UNREADABLE, reload: true } : describeStaffFailure(error, fallback);
}

/** Approve or reject a requested return; notes are shown to the customer. */
function DecisionForm({ order, item, onOutcome }: { order: StaffOrder; item: StaffReturn; onOutcome: (outcome: ActionOutcome) => void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  const decide = async (decision: "APPROVE" | "REJECT") => {
    if (busy) return;
    const trimmed = note.trim();
    if (decision === "REJECT" && !trimmed) {
      setError("Explain why the return is not approved. The customer sees this note.");
      noteRef.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { data } = await adminAPI.returns.decide(item.id, { decision, expectedStatus: "REQUESTED", ...(trimmed && { note: trimmed }) });
      onOutcome({
        kind: "done",
        order: parseStaffOrder(data, order.id),
        message: decision === "APPROVE"
          ? `Return ${item.number} approved. No refund is requested until the items are received and checked.`
          : `Return ${item.number} rejected. The customer is emailed your note.`,
      });
    } catch (failure) {
      const outcome = failureOf(failure, "The decision could not be recorded.");
      if (outcome.reload) onOutcome({ kind: "stale", message: outcome.message });
      else setError(outcome.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 border-t border-light-gray pt-3">
      <div>
        <label htmlFor={`${id}-note`} className={labelClass}>Note to the customer (required to reject)</label>
        <textarea ref={noteRef} id={`${id}-note`} rows={2} maxLength={MAX_NOTE} value={note} onChange={(event) => setNote(event.target.value)}
          aria-describedby={`${id}-hint`} className={`${inputClass} min-h-11 text-base`} />
        <p id={`${id}-hint`} className="mt-1 text-[0.6875rem] text-gray-600">The customer sees this note with your decision.</p>
      </div>
      <Feedback message={error} tone="error" />
      <p role="status" className="sr-only">{busy ? "Saving…" : ""}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-disabled={busy} onClick={() => void decide("APPROVE")} className={approveClass}>
          Approve return<span className="sr-only"> {item.number}</span>
        </button>
        <button type="button" aria-disabled={busy} onClick={() => void decide("REJECT")} className={rejectClass}>
          Reject return<span className="sr-only"> {item.number}</span>
        </button>
      </div>
    </div>
  );
}

type LineCounts = { received: string; restock: string; refundable: string };
const COUNT = /^\d+$/;
const count = (text: string) => (COUNT.test(text.trim()) ? Number(text.trim()) : null);

/** The first rule a receipt breaks, matching the server's checks, or `null`. */
function receiptProblem(lines: readonly StaffReturnLine[], values: Record<string, LineCounts>, faultConfirmed: boolean): string | null {
  for (const line of lines) {
    const entered = values[line.id];
    const received = count(entered?.received ?? "");
    const restock = count(entered?.restock ?? "");
    const refundable = count(entered?.refundable ?? "");
    if (received === null || restock === null || refundable === null) return `Enter whole numbers for ${line.productName}.`;
    if (received > line.quantity) return `${line.productName}: received cannot be more than the ${line.quantity} requested.`;
    if (restock > received) return `${line.productName}: restocked units cannot be more than received units.`;
    if (refundable > received) return `${line.productName}: refundable units cannot be more than received units.`;
    if (line.returnRule === "FAULT_ONLY" && refundable > 0 && !faultConfirmed) {
      return `${line.productName} is refundable only when you confirm it was faulty, damaged or wrong.`;
    }
  }
  return null;
}

/** Records what arrived for an approved return; the server creates any refund request and restocks once. */
function ReceiptForm({ order, item, onOutcome }: { order: StaffOrder; item: StaffReturn; onOutcome: (outcome: ActionOutcome) => void }) {
  const [values, setValues] = useState<Record<string, LineCounts>>(() =>
    Object.fromEntries(item.lines.map((line) => [line.id, { received: String(line.quantity), restock: "0", refundable: "0" }])));
  const [fault, setFault] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();
  const refundableUnits = item.lines.reduce((sum, line) => sum + (count(values[line.id]?.refundable ?? "") ?? 0), 0);

  const update = (lineId: string, field: keyof LineCounts, value: string) => {
    setValues((current) => ({ ...current, [lineId]: { ...current[lineId], [field]: value } }));
    setError("");
  };

  const submit = async () => {
    if (busy) return;
    const problem = receiptProblem(item.lines, values, fault);
    if (problem) {
      setError(problem);
      return;
    }
    const trimmed = note.trim();
    setBusy(true);
    setError("");
    try {
      const { data } = await adminAPI.returns.receive(item.id, {
        expectedStatus: "APPROVED", merchantFaultConfirmed: fault, ...(trimmed && { note: trimmed }),
        lines: item.lines.map((line) => ({
          returnLineId: line.id,
          receivedQuantity: Number(values[line.id].received.trim()),
          restockQuantity: Number(values[line.id].restock.trim()),
          refundableQuantity: Number(values[line.id].refundable.trim()),
        })),
      });
      const updated = parseStaffOrder(data, order.id);
      const refund = updated.refunds.find((entry) => entry.returnRequestId === item.id);
      onOutcome({
        kind: "done",
        order: updated,
        message: refund
          ? `Return ${item.number} received. ${refund.method === "DEMONSTRATION"
            ? `Demonstration refund ${refund.number} of ${formatKES(refund.amount)} requested; no money will be sent.`
            : `Refund ${refund.number} of ${formatKES(refund.amount)} requested; it has not been sent yet.`}`
          : `Return ${item.number} received. No refund is due.`,
      });
    } catch (failure) {
      const outcome = failureOf(failure, "The receipt could not be recorded.");
      if (outcome.reload) onOutcome({ kind: "stale", message: outcome.message });
      else setError(outcome.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 border-t border-light-gray pt-3">
      <p className="text-xs text-charcoal">Record every line. Restocked and refundable units cannot exceed the units received.</p>
      {item.lines.map((line) => (
        <fieldset key={line.id} className="rounded-md border border-light-gray p-3">
          <legend className="px-1 text-sm font-semibold text-brand-primary">{line.quantity} × {line.productName}</legend>
          <p className="text-[0.6875rem] text-gray-600">{returnRuleText(line.returnRule, order.returnEligibility.policy.windowDays, order.deliveryMethod)}</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(["received", "restock", "refundable"] as const).map((field) => (
              <div key={field} className="min-w-0">
                <label htmlFor={`${id}-${line.id}-${field}`} className={labelClass}>
                  {field === "received" ? "Received" : field === "restock" ? "Restock" : "Refundable"}
                  <span className="sr-only"> {line.productName}</span>
                </label>
                <input id={`${id}-${line.id}-${field}`} type="number" inputMode="numeric" min={0} max={line.quantity} step={1}
                  value={values[line.id]?.[field] ?? ""} onChange={(event) => update(line.id, field, event.target.value)}
                  className={`${inputClass} min-h-11 text-base`} />
              </div>
            ))}
          </div>
        </fieldset>
      ))}
      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-light-gray p-3 text-sm">
        <input type="checkbox" checked={fault} onChange={(event) => { setFault(event.target.checked); setError(""); }}
          className="mt-0.5 h-5 w-5 shrink-0 accent-brand-primary" />
        <span>
          Fault confirmed: the item was faulty, damaged or wrong.
          <span className="block text-xs text-gray-600">{FEE_ON_FAULT[order.returnEligibility.policy.deliveryFeeRefund]}</span>
        </span>
      </label>
      <div>
        <label htmlFor={`${id}-note`} className={labelClass}>Inspection note (optional; the customer sees it)</label>
        <textarea id={`${id}-note`} rows={2} maxLength={MAX_NOTE} value={note} onChange={(event) => setNote(event.target.value)}
          className={`${inputClass} min-h-11 text-base`} />
      </div>
      <p className="text-xs text-charcoal">
        {refundableUnits > 0
          ? `${refundableUnits} refundable ${refundableUnits === 1 ? "unit" : "units"}: a refund request is created for them. ${isDemonstrationOrder(order)
            ? "It will be a demonstration refund: no money is sent."
            : "No money is sent until that refund is confirmed with an M-Pesa reference."}`
          : "No refundable units: no refund will be requested."}
      </p>
      <Feedback message={error} tone="error" />
      <p role="status" className="sr-only">{busy ? "Saving…" : ""}</p>
      <button type="button" aria-disabled={busy} onClick={() => void submit()} className={approveClass}>
        Record receipt<span className="sr-only"> for {item.number}</span>
      </button>
    </div>
  );
}

/** One return with its customer details; decision and receipt forms appear only for staff who may write. */
export function StaffReturnCard({ order, item, canWrite, anchorId, onOutcome }: {
  order: StaffOrder;
  item: StaffReturn;
  canWrite: boolean;
  /** Lets the order workspace move focus to this return. */
  anchorId: string;
  onOutcome: (outcome: ActionOutcome) => void;
}) {
  return (
    <li className="rounded-md border border-light-gray p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 id={anchorId} tabIndex={-1} className="font-mono text-sm font-bold text-brand-primary">{item.number}</h4>
        <p className="text-sm font-semibold">{STAFF_RETURN_STATUS[item.status]}</p>
      </div>
      <p className="text-xs text-gray-600">
        Requested {formatDateTime(item.requestedAt)} · {RETURN_REASON_LABELS[item.reason]}
        {item.unopenedDeclared && " · customer declared the items unopened; verify on receipt"}
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {item.lines.map((line) => (
          <li key={line.id}>
            {line.quantity} × {line.productName}
            {line.receivedQuantity !== null && ` · received ${line.receivedQuantity}, restocked ${line.restockQuantity ?? 0}, refundable ${line.refundableQuantity ?? 0}`}
          </li>
        ))}
      </ul>
      {item.comment && <p className="mt-2 text-xs">Customer comment: {item.comment}</p>}
      {item.decisionNote && <p className="mt-2 text-xs">Decision note (customer-visible): {item.decisionNote}</p>}
      {item.inspectionNote && <p className="mt-2 text-xs">Inspection note (customer-visible): {item.inspectionNote}</p>}
      {item.merchantFaultConfirmed !== null && (
        <p className="mt-2 text-xs">{item.merchantFaultConfirmed ? "Fault confirmed on receipt." : "No fault confirmed on receipt."}</p>
      )}
      {canWrite && item.status === "REQUESTED" && <DecisionForm order={order} item={item} onOutcome={onOutcome} />}
      {canWrite && item.status === "APPROVED" && <ReceiptForm order={order} item={item} onOutcome={onOutcome} />}
    </li>
  );
}
