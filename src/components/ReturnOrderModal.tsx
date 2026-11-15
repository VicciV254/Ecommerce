import { useId, useRef, useState, type FormEvent } from "react";
import { ordersAPI, type CustomerOrder, type ReturnEligibilityLine, type ReturnReason, type ReturnRequestResult } from "../api/orders";
import { newIdempotencyKey } from "../store/checkoutModel";
import { OrderFormatError, isReturnReason, parseReturnRequestResult } from "../store/orderModel";
import { RETURN_REASON_LABELS, returnPolicyTerms, returnRuleText, returnWindowText } from "../store/orderCopy";
import {
  MAX_RETURN_COMMENT,
  UNRESOLVED_RETURN_MESSAGE,
  UNSAVED_RETURN_MESSAGE,
  clampReturnQuantity,
  classifyReturnFailure,
  clearReturnIntent,
  needsUnopenedDeclaration,
  reasonChoices,
  readReturnIntent,
  returnFormProblem,
  returnRequestBody,
  saveReturnIntent,
  selectedLines,
  type ReturnFormProblem,
  type ReturnIntent,
} from "../store/returnRequestModel";
import { formatDateTime } from "../utils/format";
import { ModalDialog } from "./Modal";

const PROBLEM_MESSAGES: Record<ReturnFormProblem, string> = {
  items: "Choose at least one item and how many of it to return.",
  reason: "Choose a reason that applies to every selected item.",
  unopened: "Confirm the items are unopened, or choose faulty, damaged or wrong item as the reason.",
  comment: `Keep the comment to ${MAX_RETURN_COMMENT} characters or fewer.`,
};

const fieldClass = "min-h-11 w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-base text-charcoal focus:border-brand-secondary aria-[invalid=true]:border-error";
const labelClass = "block text-[11px] font-bold uppercase tracking-[0.12em] text-brand-primary";
// Touch targets are sized in CSS px so the stepper still fits a 360px screen when text is enlarged.
const stepClass = "flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-sm border border-light-gray text-lg text-brand-primary hover:border-brand-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-40";
const secondaryClass = "min-h-11 flex-1 rounded-sm border border-light-gray px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-charcoal hover:bg-off-white sm:flex-none";
const primaryClass = "min-h-11 flex-1 rounded-sm bg-brand-primary px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-60 sm:flex-none";

const names = (lines: readonly ReturnEligibilityLine[]) => lines.map((line) => line.productName).join(", ");

/**
 * Return request for selected items. The request and its key are saved before sending; when the answer
 * is lost, only the same request (same key) can be retried, so it is never submitted twice.
 */
export default function ReturnOrderModal({ order, ownerId, onClose, onReturned, onRefresh }: {
  order: CustomerOrder;
  /** The signed-in customer; saved requests are scoped to them. */
  ownerId: string;
  onClose: () => void;
  /** Called with the server's request and refreshed order; the caller closes the dialog. */
  onReturned: (result: ReturnRequestResult) => void;
  /** Reloads the order after a refusal that may reflect changed return state. */
  onRefresh: () => void;
}) {
  const eligibility = order.returnEligibility;
  const [intent, setIntent] = useState<ReturnIntent | null>(() => readReturnIntent(ownerId, order.id));
  const [selection, setSelection] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<ReturnReason | null>(null);
  const [unopened, setUnopened] = useState(false);
  const [comment, setComment] = useState("");
  const [problem, setProblem] = useState<ReturnFormProblem | null>(null);
  const [error, setError] = useState(() => (intent ? UNRESOLVED_RETURN_MESSAGE : ""));
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);
  const firstQuantity = useRef<HTMLInputElement>(null);
  const reasonField = useRef<HTMLSelectElement>(null);
  const unopenedField = useRef<HTMLInputElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const errorId = `${id}-error`;

  // Quantities stay within what the latest order allows, even after a refresh lowers them.
  const current: Record<string, number> = {};
  for (const line of eligibility.lines) current[line.orderItemId] = clampReturnQuantity(line, selection[line.orderItemId] ?? 0);
  const choices = reasonChoices(eligibility, current);
  const effectiveReason = reason && choices.includes(reason) ? reason : null;
  const chosen = selectedLines(eligibility, current);
  const faultOnly = chosen.filter((line) => line.returnRule === "FAULT_ONLY");
  const unopenedLines = chosen.filter((line) => line.returnRule === "UNOPENED_OR_FAULT");
  const declarationNeeded = needsUnopenedDeclaration(chosen, effectiveReason);

  const close = () => {
    if (!busy.current) onClose();
  };

  const setQuantity = (line: ReturnEligibilityLine, value: number) => {
    setSelection((previous) => ({ ...previous, [line.orderItemId]: clampReturnQuantity(line, value) }));
    setProblem(null);
    setError("");
  };

  const send = async (pending: ReturnIntent) => {
    busy.current = true;
    setSubmitting(true);
    setError("");
    try {
      const { data } = await ordersAPI.requestReturn(order.id, pending.body, pending.idempotencyKey);
      const result = parseReturnRequestResult(data, order.id);
      clearReturnIntent(pending);
      onReturned(result);
    } catch (failure) {
      // An unreadable answer is not proof that nothing was created: keep the key for a retry.
      const outcome = failure instanceof OrderFormatError
        ? { kind: "unresolved" as const, message: UNRESOLVED_RETURN_MESSAGE }
        : classifyReturnFailure(failure);
      if (outcome.kind === "cancelled") return;
      if (outcome.kind === "unresolved") {
        setIntent(pending);
        setError(outcome.message);
        return;
      }
      clearReturnIntent(pending);
      setIntent(null);
      setError(outcome.message);
      if (outcome.refresh) onRefresh();
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) return;
    if (intent) {
      void send(intent);
      return;
    }
    const form = { selection: current, reason: effectiveReason, unopened, comment };
    const found = returnFormProblem(eligibility, form);
    setProblem(found);
    if (found || !form.reason) {
      setError(PROBLEM_MESSAGES[found ?? "reason"]);
      if (found === "items") firstQuantity.current?.focus();
      else if (found === "unopened") unopenedField.current?.focus();
      else reasonField.current?.focus();
      return;
    }
    const pending: ReturnIntent = {
      ownerId, orderId: order.id, idempotencyKey: newIdempotencyKey(),
      body: returnRequestBody(eligibility, { ...form, reason: form.reason }), createdAt: new Date().toISOString(),
    };
    if (!saveReturnIntent(pending)) {
      // Another tab may have saved an unresolved request for this order; resume it rather than start over.
      const saved = readReturnIntent(ownerId, order.id);
      setIntent(saved);
      setError(saved ? UNRESOLVED_RETURN_MESSAGE : UNSAVED_RETURN_MESSAGE);
      return;
    }
    void send(pending);
  };

  const lineById = new Map(eligibility.lines.map((line) => [line.orderItemId, line]));
  const windowText = eligibility.windowEndsAt ? `Request by ${formatDateTime(eligibility.windowEndsAt)}.` : null;
  const blocked = !intent && !eligibility.eligible;

  return (
    <ModalDialog open label="Request a return" placement="sheet" onClose={close}>
      <form noValidate onSubmit={submit} aria-labelledby={titleId}
        className="flex h-full w-full flex-col bg-white text-charcoal shadow-2xl md:h-auto md:max-h-[calc(100dvh-2rem)] md:max-w-2xl md:rounded-lg">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-light-gray px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-xl text-brand-primary">Request a return</h2>
            <p className="font-mono text-xs text-gray-600 [overflow-wrap:anywhere]">Order {order.orderNumber}</p>
          </div>
          <button type="button" onClick={close} aria-disabled={submitting} className="min-h-11 rounded-sm px-3 text-xs font-bold uppercase tracking-wider text-gray-600 hover:text-brand-primary aria-disabled:opacity-50">
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 [overflow-wrap:anywhere] sm:px-6">
          {intent ? (
            <section aria-label="Saved return request" className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              <p className="font-semibold text-brand-primary">Your earlier request is saved on this device.</p>
              <ul className="list-disc space-y-1 pl-5">
                {intent.body.lines.map((line) => (
                  <li key={line.orderItemId}>{line.quantity} × {lineById.get(line.orderItemId)?.productName ?? "Item from this order"}</li>
                ))}
              </ul>
              <p>Reason: {RETURN_REASON_LABELS[intent.body.reason]}{intent.body.unopenedDeclared ? " · declared unopened" : ""}</p>
              {intent.body.comment && <p>Comment: {intent.body.comment}</p>}
            </section>
          ) : blocked ? (
            <p className="rounded-md bg-off-white p-3 text-sm">{returnWindowText(eligibility) ?? "This order cannot be returned right now."}</p>
          ) : (
            <>
              {windowText && <p className="text-sm font-semibold text-brand-primary">{windowText}</p>}
              <fieldset aria-describedby={problem === "items" ? errorId : undefined}>
                <legend className={labelClass}>Items to return</legend>
                <ul className="mt-2 space-y-3">
                  {eligibility.lines.map((line, index) => {
                    const quantity = current[line.orderItemId] ?? 0;
                    const nameId = `${id}-item-${index}`;
                    const ruleId = `${id}-rule-${index}`;
                    const max = line.returnableQuantity;
                    return (
                      <li key={line.orderItemId} className="rounded-md border border-light-gray p-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0 flex-1 basis-48">
                            <p id={nameId} className="font-semibold text-brand-primary">{line.productName}</p>
                            <p id={ruleId} className="text-xs text-gray-600">
                              {max > 0 ? `Up to ${max} of ${line.purchased} can be returned. ` : "Already in a return request. "}
                              {returnRuleText(line.returnRule, eligibility.policy.windowDays)}
                            </p>
                          </div>
                          {max > 0 && (
                            <div role="group" aria-labelledby={nameId} className="flex items-center gap-1">
                              <button type="button" aria-label={`Return one fewer ${line.productName}`} aria-disabled={quantity <= 0}
                                onClick={() => { if (quantity > 0) setQuantity(line, quantity - 1); }} className={stepClass}>−</button>
                              <input
                                ref={index === eligibility.lines.findIndex((item) => item.returnableQuantity > 0) ? firstQuantity : undefined}
                                type="number" inputMode="numeric" min={0} max={max} step={1} value={quantity}
                                aria-label={`Quantity of ${line.productName} to return`} aria-describedby={ruleId}
                                aria-invalid={problem === "items" || undefined}
                                onChange={(event) => setQuantity(line, event.target.value === "" ? 0 : Number(event.target.value))}
                                className="h-[44px] w-[64px] rounded-sm border border-light-gray bg-off-white text-center text-base aria-[invalid=true]:border-error"
                              />
                              <button type="button" aria-label={`Return one more ${line.productName}`} aria-disabled={quantity >= max}
                                onClick={() => { if (quantity < max) setQuantity(line, quantity + 1); }} className={stepClass}>+</button>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>

              <div>
                <label htmlFor={`${id}-reason`} className={labelClass}>Reason for return</label>
                <select
                  ref={reasonField} id={`${id}-reason`} value={effectiveReason ?? ""}
                  aria-invalid={problem === "reason" || undefined} aria-describedby={faultOnly.length ? `${id}-reason-hint` : undefined}
                  onChange={(event) => { setReason(isReturnReason(event.target.value) ? event.target.value : null); setProblem(null); setError(""); }}
                  className={`mt-1.5 ${fieldClass}`}
                >
                  <option value="">Choose a reason</option>
                  {choices.map((choice) => <option key={choice} value={choice}>{RETURN_REASON_LABELS[choice]}</option>)}
                </select>
                {faultOnly.length > 0 && (
                  <p id={`${id}-reason-hint`} className="mt-1 text-xs text-gray-600">
                    {names(faultOnly)} can be returned only if faulty, damaged or wrong.
                  </p>
                )}
              </div>

              {declarationNeeded && (
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-light-gray p-3 text-sm">
                  <input ref={unopenedField} type="checkbox" checked={unopened} aria-invalid={problem === "unopened" || undefined}
                    onChange={(event) => { setUnopened(event.target.checked); setProblem(null); setError(""); }}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-brand-primary" />
                  <span>
                    I confirm {names(unopenedLines)} {unopenedLines.length === 1 ? "is" : "are"} unopened.
                    Staff check this when the return arrives.
                  </span>
                </label>
              )}

              <div>
                <label htmlFor={`${id}-comment`} className={labelClass}>Comment (optional)</label>
                <textarea id={`${id}-comment`} value={comment} maxLength={MAX_RETURN_COMMENT} rows={3}
                  onChange={(event) => setComment(event.target.value)} className={`mt-1.5 ${fieldClass}`} />
              </div>
            </>
          )}

          <section aria-labelledby={`${id}-terms`} className="rounded-md bg-off-white p-3 text-xs">
            <h3 id={`${id}-terms`} className="font-body text-[11px] font-bold uppercase tracking-[0.12em] text-brand-primary">Return terms</h3>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {windowText && <li>{windowText}</li>}
              {returnPolicyTerms(eligibility.policy).map((line) => <li key={line}>{line}</li>)}
            </ul>
          </section>
        </div>

        <footer className="shrink-0 space-y-2 border-t border-light-gray bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
          {error && <p id={errorId} role="alert" className="rounded-md border border-error/30 bg-error/5 p-2 text-sm font-semibold text-error">{error}</p>}
          <p role="status" className="sr-only">{submitting ? "Sending your return request…" : ""}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={close} aria-disabled={submitting} className={secondaryClass}>Cancel</button>
            {!blocked && (
              <button type="submit" aria-disabled={submitting} className={primaryClass}>
                {submitting ? "Sending…" : intent ? "Retry the same request" : "Submit return request"}
              </button>
            )}
          </div>
        </footer>
      </form>
    </ModalDialog>
  );
}
