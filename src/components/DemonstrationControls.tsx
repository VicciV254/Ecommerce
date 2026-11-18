import { useId, useLayoutEffect, useRef, useState } from "react";
import { ordersAPI, type CustomerOrder, type DemonstrationAction } from "../api/orders";
import { apiStatus, describeApiError } from "../api/errors";
import { DEMONSTRATION_ACTION_LABELS, demonstrationOutcome, demonstrationRecord } from "../store/orderCopy";
import { OrderFormatError, parseCustomerOrder } from "../store/orderModel";

const CONFLICT = 409;
const buttonClass = "inline-flex min-h-[44px] w-full items-center justify-center rounded-sm border border-navy-900 px-4 py-2 text-sm font-semibold text-navy-900 transition-colors duration-(--motion-feedback) hover:bg-surface-soft aria-disabled:cursor-not-allowed aria-disabled:opacity-60 sm:w-auto";

type Outcome = { tone: "info" | "error"; text: string };

const refreshText = (refreshed: boolean) =>
  (refreshed ? "The order has been refreshed." : "We could not refresh it; reload the page to see its current status.");

/**
 * The store's side of a sample order, played by its owner: one button per step the server lists, each sending the
 * status it was shown with. A refusal because the order changed reloads it. Every outcome is reported where focus
 * then moves, so focus stays in the region even when the last step leaves no buttons.
 */
export default function DemonstrationControls({ order, onOrderChange, onRefresh }: {
  order: CustomerOrder;
  onOrderChange: (order: CustomerOrder) => void;
  /** Reloads the order; resolves `false` when it could not be reloaded. */
  onRefresh: () => Promise<boolean>;
}) {
  const headingId = useId();
  const outcomeRef = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [reports, setReports] = useState(0);

  useLayoutEffect(() => {
    if (reports) outcomeRef.current?.focus();
  }, [reports]);

  if (order.demonstrationActions.length === 0 && !outcome) return null;

  const play = async (step: DemonstrationAction) => {
    if (busy) return;
    setBusy(true);
    setOutcome(null);
    let next: Outcome;
    try {
      const { data } = await ordersAPI.playDemonstration(order.id, step);
      const updated = parseCustomerOrder(data, order.id);
      onOrderChange(updated);
      next = { tone: "info", text: demonstrationOutcome(step, updated) };
    } catch (error) {
      if (error instanceof OrderFormatError) {
        next = { tone: "error", text: `The step was sent, but its result could not be read. ${refreshText(await onRefresh())}` };
      } else if (apiStatus(error) === CONFLICT) {
        next = { tone: "error", text: `This order changed since it was shown, so that step was not recorded. ${refreshText(await onRefresh())}` };
      } else {
        next = { tone: "error", text: describeApiError(error, "That step could not be recorded. Try again.") };
      }
    }
    setBusy(false);
    setOutcome(next);
    setReports((count) => count + 1);
  };

  return (
    // A section of the order dialog under a hairline, not a card inside the dialog's card.
    <section aria-labelledby={headingId} className="border-t border-divider pt-5 text-left text-navy-800">
      {/* A soft hyphen lets the long word break as "Demon-stration" on a narrow phone with enlarged text; Chromium won't
          hyphenate a capitalised word by itself. Screen readers and accessible names ignore it. */}
      <h3 id={headingId} className="type-h3 text-navy-900">Demon&shy;stration controls</h3>
      <p className="mt-1 text-sm">You play the store&apos;s part here. Nothing is shipped and no money moves.</p>
      {order.demonstrationActions.length > 0 && (
        <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap">
          {order.demonstrationActions.map((step) => {
            const record = demonstrationRecord(step, order);
            return (
              <button key={JSON.stringify(step)} type="button" aria-disabled={busy} onClick={() => void play(step)} className={buttonClass}>
                {DEMONSTRATION_ACTION_LABELS[step.action]}
                {record && <span className="sr-only"> {record.number}</span>}
              </button>
            );
          })}
        </div>
      )}
      <p ref={outcomeRef} tabIndex={-1} role="status"
        className={outcome?.tone === "error" ? "mt-3 rounded-md border border-error/40 bg-error-tint p-3 text-sm font-semibold text-error"
          : `text-sm text-navy-800 ${busy || outcome ? "mt-3" : ""}`}>
        {busy ? "Recording this step…" : outcome?.text ?? ""}
      </p>
    </section>
  );
}
