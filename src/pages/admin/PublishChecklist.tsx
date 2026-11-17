import { useState, type ReactNode } from "react";
import { Link } from "../../router";
import { stockRoute } from "./adminRoutes";
import { READINESS_CHECKS, type Readiness, type ReadinessCheckId } from "./catalogReadiness";
import { smallButtonClass } from "./shared";

const stepClass = `inline-flex min-h-[44px] items-center ${smallButtonClass}`;
const STATE_TONES = {
  open: "border-warning/50 bg-warning-tint",
  passed: "border-success/40 bg-success-tint",
  info: "border-ocean-blue/30 bg-ocean-blue/10",
} as const;

/** The state of a check in words, so it never depends on colour. */
function State({ tone, children }: { tone: keyof typeof STATE_TONES; children: ReactNode }) {
  return <span className={`rounded-sm border px-1.5 text-[0.6875rem] font-semibold leading-snug ${STATE_TONES[tone]}`}>{children}</span>;
}

type Steps = {
  /** A product not saved yet: its stock is set in Variants, and the Stock tab has none of its SKUs. */
  isNew: boolean;
  /** The saved category, whose SKUs the Stock tab lists. */
  stockCategory: { id: string; name: string } | null;
  onGoToImages: () => void;
  onGoToVariants: () => void;
  /** Leaves the editor (after confirming any unsaved changes) for this category in the tree. */
  onShowCategory?: (categoryId: string) => void;
};

/** The next step for an open check: where in this editor, or elsewhere in the admin, it is fixed. */
function nextStep(id: ReadinessCheckId, readiness: Readiness, steps: Steps): { text: string; action: ReactNode } {
  switch (id) {
    case "needs-images":
      return { text: "Add real photos in Images.", action: <button type="button" onClick={steps.onGoToImages} className={stepClass}>Go to Images</button> };
    case "no-active-option":
      return { text: "Turn on a variant, or add one, in Variants.", action: <button type="button" onClick={steps.onGoToVariants} className={stepClass}>Go to Variants</button> };
    case "out-of-stock":
      return steps.isNew || !steps.stockCategory
        ? { text: "Set initial on-hand stock in Variants.", action: <button type="button" onClick={steps.onGoToVariants} className={stepClass}>Go to Variants</button> }
        : {
          text: "Add units on the Stock tab.",
          action: <Link to={stockRoute({ category: steps.stockCategory.id })} className={stepClass}>Open Stock for {steps.stockCategory.name}</Link>,
        };
    default: {
      const hidden = readiness.hiddenCategory;
      const show = steps.onShowCategory;
      return hidden
        ? {
          text: `Show ${hidden.name} in the category tree.`,
          action: show ? <button type="button" onClick={() => show(hidden.id)} className={stepClass}>Show {hidden.name} in the tree</button> : null,
        }
        : { text: "Choose a category shoppers can see.", action: null };
    }
  }
}

/**
 * "Before publishing": each readiness check as passed or open, with its next step. It warns and never blocks a save.
 * Collapsible, and open when it first shows open checks.
 */
export function PublishChecklist({ readiness, className = "", ...steps }: Steps & { readiness: Readiness; className?: string }) {
  const openCount = readiness.open.length;
  const [expanded, setExpanded] = useState(openCount > 0);
  const summary = readiness.readyToPublish ? "Ready to publish" : openCount ? `${openCount} open` : "All checks passed";
  return (
    <details
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      className={`min-w-0 rounded-md border border-light-gray bg-off-white ${className}`}
    >
      <summary className="flex min-h-[44px] cursor-pointer flex-wrap items-center gap-x-2 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-brand-primary">
        Before publishing
        <span className="text-xs font-semibold normal-case tracking-normal text-navy-900">{summary}</span>
      </summary>
      <div className="space-y-3 border-t border-light-gray px-3 py-3 text-xs text-navy-900">
        <p className="text-navy-800">These checks warn; none of them stops a save.</p>
        <ul className="space-y-3">
          {READINESS_CHECKS.map((check) => {
            const open = readiness.open.includes(check.id);
            const step = open ? nextStep(check.id, readiness, steps) : null;
            return (
              <li key={check.id} className="[overflow-wrap:break-word]">
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <State tone={open ? "open" : "passed"}>{open ? "Open" : "Passed"}</State>{" "}
                  <span className={open ? "font-semibold" : undefined}>{open ? check.label : check.passed}</span>
                </p>
                {step && <p className="mt-0.5 text-navy-800">{step.text}</p>}
                {step?.action && <div className="mt-1">{step.action}</div>}
              </li>
            );
          })}
          {readiness.demo && (
            <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 [overflow-wrap:break-word]">
              <State tone="info">For information</State>{" "}
              <span>Demo listing: it stays a demo listing however it is edited.</span>
            </li>
          )}
        </ul>
      </div>
    </details>
  );
}
