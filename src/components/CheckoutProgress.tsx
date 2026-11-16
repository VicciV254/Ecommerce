import { Link } from "../router";
import { CHECKOUT_STEPS, STEP_LABELS, checkoutRoute, type CheckoutStep, type StepView } from "../store/checkoutSteps";

/**
 * The checkout's ordered steps. The current step is marked for assistive technology; steps the shopper can go to are
 * links, and steps that cannot be reached yet (or are locked once the order is reserved) are plain text.
 */
export function CheckoutProgress({ view, onLeave }: {
  view: StepView;
  /** Runs before a step link navigates, so the step being left is recorded for Back. */
  onLeave: () => void;
}) {
  return (
    <nav aria-label="Checkout steps">
      <ol className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-x-1 sm:gap-y-1">
        {CHECKOUT_STEPS.map((step, index) => {
          const current = step === view.current;
          const done = view.completed.includes(step) && !current;
          const reachable = view.reachable.includes(step) && !current;
          const layout = "flex min-h-[44px] min-w-0 flex-col items-center gap-1 rounded-sm py-1 text-center text-sm sm:flex-row sm:gap-2 sm:py-0 sm:pr-1 sm:text-left";
          return (
            <li key={step} aria-current={current ? "step" : undefined} className="flex min-w-0 items-start justify-center sm:items-center sm:justify-start sm:gap-1">
              {index > 0 && <span aria-hidden="true" className="mx-1 hidden h-px w-8 shrink-0 bg-control sm:block" />}
              {reachable
                ? (
                  <Link to={checkoutRoute(step)} onClick={onLeave} className={`${layout} font-semibold text-link underline-offset-4 hover:text-link-hover hover:underline`}>
                    <StepContent step={step} index={index} state={done ? "done" : "open"} />
                  </Link>
                )
                : (
                  <span className={`${layout} ${current ? "font-semibold text-navy-900" : done ? "text-navy-800" : "text-muted"}`}>
                    <StepContent step={step} index={index} state={current ? "current" : done ? "done" : "later"} />
                  </span>
                )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const MARKERS = {
  current: "border-navy-900 bg-navy-900 text-white",
  done: "border-success bg-success-tint text-success",
  open: "border-link bg-surface text-link",
  later: "border-control bg-surface text-muted",
} as const;

function StepContent({ step, index, state }: { step: CheckoutStep; index: number; state: keyof typeof MARKERS }) {
  return (
    <>
      <span aria-hidden="true" className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold tabular-nums ${MARKERS[state]}`}>
        {state === "done" ? (
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="size-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        ) : index + 1}
      </span>
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <span className="sr-only">Step {index + 1}: </span>
        {STEP_LABELS[step]}
        {state === "done" && <span className="sr-only"> (done)</span>}
      </span>
    </>
  );
}
