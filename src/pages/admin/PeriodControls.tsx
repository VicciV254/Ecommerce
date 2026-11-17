import { useEffect, useId, useState } from "react";
import { describeApiError } from "../../api/errors";
import { Link } from "../../router";
import { formatNairobiClock } from "../../utils/nairobiDate";
import { REPORT_PERIODS, periodRoute, type PeriodModuleId, type ReportPeriod } from "./adminRoutes";
import { OverviewFormatError, rangeInWords } from "./overviewModel";

/** How a period's figures stand: none yet, current, being refreshed, failed before any answer, or kept after a failed refresh. */
export type ReportPhase = "loading" | "ready" | "refreshing" | "failed" | "stale";
export type PeriodReport<T> = { data: T | null; phase: ReportPhase; error: string; refresh: () => void };

type Answer<T> = { period: ReportPeriod; attempt: number } & ({ data: T } | { error: string });

/**
 * Loads a period's figures, and again on `refresh`. An answer for a period no longer on screen is dropped, and the last
 * figures are shown only for their own period: a new period starts with placeholders, never another period's numbers.
 * `load` must be stable (a module-level function or a memoized callback).
 */
export function usePeriodReport<T extends { generatedAt: string }>(period: ReportPeriod, load: (period: ReportPeriod) => Promise<T>, fallback: string): PeriodReport<T> {
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<Answer<T> | null>(null);
  const [last, setLast] = useState<{ period: ReportPeriod; data: T } | null>(null);
  useEffect(() => {
    let current = true;
    load(period)
      .then((data) => {
        if (!current) return;
        setLast({ period, data });
        setAnswer({ period, attempt, data });
      })
      .catch((error: unknown) => {
        if (!current) return;
        const message = error instanceof OverviewFormatError ? `${error.message} Try again shortly.` : describeApiError(error, fallback);
        setAnswer({ period, attempt, error: message });
      });
    return () => { current = false; };
  }, [period, attempt, load, fallback]);

  const data = last?.period === period ? last.data : null;
  const settled = answer?.period === period && answer.attempt === attempt ? answer : null;
  const error = settled && "error" in settled ? settled.error : "";
  const phase: ReportPhase = !settled ? (data ? "refreshing" : "loading") : error ? (data ? "stale" : "failed") : "ready";
  return { data, phase, error, refresh: () => setAttempt((value) => value + 1) };
}

/** Four 44px links choosing the period, marking the current one; each replaces the address, so Back leaves the screen. */
export function PeriodChoice({ module, current }: { module: PeriodModuleId; current: ReportPeriod }) {
  return (
    <div className="@container">
      <div role="group" aria-label="Period" className="grid grid-cols-1 gap-2 @min-[17rem]:grid-cols-2 @min-[36rem]:grid-cols-4">
        {REPORT_PERIODS.map((period) => {
          const chosen = period.id === current;
          return (
            <Link
              key={period.id}
              to={periodRoute(module, period.id)}
              replace
              aria-current={chosen ? "true" : undefined}
              className={`flex min-h-[44px] min-w-0 items-center justify-center rounded-sm border px-[12px] py-[8px] text-center text-sm font-semibold transition-colors duration-(--motion-feedback) [overflow-wrap:break-word] ${
                chosen ? "border-navy-900 bg-navy-900 text-white" : "border-control bg-surface text-navy-900 hover:bg-surface-soft"
              }`}
            >
              {period.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

const actionClass =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm border border-navy-900 px-[14px] text-sm font-semibold text-navy-900 transition-colors duration-(--motion-feedback) hover:bg-surface-soft";

/**
 * The exact range in words with its time zone, then when the figures were made and a way to refresh them; or why they
 * are missing or old, with Retry.
 */
export function RangeLine<T extends { generatedAt: string; range: { start: string; end: string } }>({ report, what }: {
  report: PeriodReport<T>;
  /** What failed to load, for the first-load error ("The figures"). */
  what: string;
}) {
  const statusId = useId();
  const { data, phase, error, refresh } = report;
  const updated = data ? formatNairobiClock(data.generatedAt) : "";
  return (
    <div className="space-y-2 text-sm">
      {data ? (
        <p className="font-semibold text-navy-900 [overflow-wrap:break-word]">{rangeInWords(data.range)}</p>
      ) : (
        <p aria-hidden="true" className="h-[20px] w-[min(100%,18rem)] animate-pulse rounded-sm bg-surface-soft motion-reduce:animate-none" />
      )}
      {phase === "loading" && <p role="status" className="text-muted">Loading figures…</p>}
      {phase === "failed" && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-error/30 bg-error-tint p-3 text-error">
          <span className="min-w-0 flex-[1_1_14rem] [overflow-wrap:break-word]">{what} couldn't be loaded. {error}</span>
          <button type="button" onClick={refresh} className={actionClass}>Retry</button>
        </div>
      )}
      {phase === "stale" && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning-tint p-3 text-navy-900">
          <span className="min-w-0 flex-[1_1_14rem] [overflow-wrap:break-word]">Last updated {updated}. Couldn't refresh. {error}</span>
          <button type="button" onClick={refresh} className={actionClass}>Retry</button>
        </div>
      )}
      {(phase === "ready" || phase === "refreshing") && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p id={statusId} role="status" className="text-muted">{phase === "refreshing" ? "Refreshing…" : `Updated ${updated}`}</p>
          <button type="button" onClick={() => { if (phase !== "refreshing") refresh(); }} aria-disabled={phase === "refreshing"} aria-describedby={statusId}
            className={`${actionClass} aria-disabled:opacity-60`}>
            Refresh
          </button>
        </div>
      )}
    </div>
  );
}

/** Placeholder text while figures load: never a zero. */
function Placeholder({ className }: { className: string }) {
  return (
    <>
      <span aria-hidden="true" className={`block animate-pulse rounded-sm bg-surface-soft motion-reduce:animate-none ${className}`} />
      <span className="sr-only">Loading</span>
    </>
  );
}

/** One figure: its label, value (a placeholder while loading, "Unavailable" after a failed first load) and definition; a link when `to` is given. */
export function FigureCard({ label, definition, value, detail, to, phase }: {
  label: string;
  definition: string;
  value: string | null;
  detail?: string;
  to: string | null;
  phase: ReportPhase;
}) {
  const labelId = useId();
  const valueId = useId();
  const definitionId = useId();
  const body = (
    <>
      <span id={labelId} className="text-sm font-semibold text-navy-900">{label}</span>
      <span id={valueId} className="text-2xl font-semibold tabular-nums text-navy-900 [overflow-wrap:break-word]">
        {value ?? (phase === "failed" ? "Unavailable" : <Placeholder className="mt-1 h-[28px] w-[6rem] max-w-full" />)}
      </span>
      {detail && <span className="text-sm text-muted">{detail}</span>}
      <span id={definitionId} className="mt-1 text-xs text-muted">{definition}</span>
    </>
  );
  const cardClass = "flex h-full min-w-0 flex-col gap-0.5 rounded-lg bg-surface p-4 shadow-card [overflow-wrap:break-word]";
  return to ? (
    <Link to={to} aria-labelledby={`${labelId} ${valueId}`} aria-describedby={definitionId}
      className={`${cardClass} min-h-[44px] transition-colors duration-(--motion-feedback) hover:bg-surface-soft`}>
      {body}
    </Link>
  ) : <div className={cardClass}>{body}</div>;
}
