import { useId, useState } from "react";
import { summaryRows, summaryTotal, type CheckoutFigures, type SummaryRow } from "../store/checkoutSummary";
import { formatKES } from "../utils/format";

/** One item as the summary lists it: the cart's lines before reserving, the order's items after. */
export type SummaryLine = { key: string; name: string; detail: string; quantity: number };

const PENDING = "Pending";

/** Labelled amounts, top to bottom; an amount not known yet reads "Pending", never 0 or free. */
export function FigureRows({ rows }: { rows: readonly SummaryRow[] }) {
  return (
    <dl className="space-y-2 text-sm tabular-nums">
      {rows.map((row) => (
        <div key={row.label} className={`flex flex-wrap items-baseline justify-between gap-x-3 ${row.tone === "total" ? "border-t border-divider pt-2 text-base font-semibold text-navy-900" : ""}`}>
          <dt className={row.tone === "total" ? "" : "text-navy-800"}>{row.label}</dt>
          <dd className={row.amount === null ? "font-semibold text-muted" : row.tone === "total" ? "" : "text-navy-900"}>
            {row.amount === null ? PENDING : row.tone === "saving" ? `−${formatKES(row.amount)}` : formatKES(row.amount)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * What the order holds and costs. On phones it is a disclosure above the step, closed at first and showing the total
 * (or "Total pending"); from 768px it is always open as a column beside the step. Fees the server has not quoted read
 * "Pending" with the reason, never 0 or free.
 */
export function CheckoutSummary({ lines, figures, className = "" }: {
  lines: readonly SummaryLine[];
  figures: CheckoutFigures;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const total = summaryTotal(figures);
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const rows = summaryRows(figures);
  return (
    <section aria-label="Order summary" className={`min-w-0 rounded-lg bg-surface shadow-card ${className}`}>
      <h2 className="md:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-[48px] w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg px-4 py-2 text-left"
        >
          <span className="flex min-w-0 items-center gap-2 font-semibold text-navy-900">
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`size-5 shrink-0 transition-transform duration-(--motion-feedback) ${open ? "rotate-180" : ""}`}>
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
            </svg>
            {open ? "Hide order summary" : "Show order summary"}
          </span>
          <span className="font-semibold tabular-nums text-navy-900">{total === null ? "Total pending" : formatKES(total)}</span>
        </button>
      </h2>
      <h2 className="type-h3 hidden px-5 pt-5 text-navy-900 md:block">Order summary</h2>
      <div id={bodyId} className={`${open ? "block" : "hidden"} border-t border-divider px-4 pb-4 pt-3 md:block md:border-0 md:px-5 md:pb-5`}>
        <p className="text-sm text-muted">{count} {count === 1 ? "item" : "items"}</p>
        <ul aria-label="Items in this order" className="mt-2 divide-y divide-divider text-sm">
          {lines.map((line) => (
            <li key={line.key} className="flex justify-between gap-3 py-2 [overflow-wrap:anywhere]">
              <span className="min-w-0">
                <span className="block font-medium text-navy-900">{line.name}</span>
                {line.detail && <span className="block text-muted">{line.detail}</span>}
              </span>
              <span className="shrink-0 tabular-nums text-navy-800">× {line.quantity}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 border-t border-divider pt-3"><FigureRows rows={rows} /></div>
        {figures.kind === "pending" && (
          <p className="mt-3 rounded-md bg-surface-soft p-3 text-sm text-navy-800">
            {figures.reason}
            {figures.excluded > 0 && ` The estimate leaves out ${figures.excluded} unavailable ${figures.excluded === 1 ? "item" : "items"}.`}
          </p>
        )}
      </div>
    </section>
  );
}
