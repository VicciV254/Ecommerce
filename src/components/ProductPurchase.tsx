import { useId, useState, type ReactNode } from "react";
import type { PriceView } from "../store/catalogModel";
import type { ProductSelection, SelectionOption } from "../store/selectionModel";
import { COLOR_MAP } from "../utils/colors";
import { formatKES } from "../utils/format";
import { StockBadge } from "./ui";

/**
 * Purchase controls shared by the product page and Quick View: price excluding VAT, availability, option choices,
 * quantity and the status that explains why Add is not possible yet.
 */

export const PRICE_EXCLUDES_VAT = "excl. VAT";
export const VAT_AT_CHECKOUT = "VAT (16%) and delivery are added at checkout.";

const VALUE_NOTE: Record<"unavailable" | "sold-out", string> = { unavailable: "unavailable", "sold-out": "sold out" };

/** Marks the option groups so "Choose options" can find the first one without a value. */
const MISSING_GROUP = "[data-option-group][data-missing] button";
const FIRST_GROUP = "[data-option-group] button";

/** Moves focus to the first option group still needing a value (or the first group), scrolling it into view. */
export function focusFirstOption(container: HTMLElement | null) {
  const target = container?.querySelector<HTMLElement>(MISSING_GROUP) ?? container?.querySelector<HTMLElement>(FIRST_GROUP);
  target?.focus();
  return Boolean(target);
}

export function PriceLine({ price, large = false }: { price: PriceView | null; large?: boolean }) {
  if (!price) return null;
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className={`${large ? "type-price" : "type-price-card"} text-navy-900`}>
        {price.isFromPrice && <span className="text-base font-normal">From </span>}
        {formatKES(price.price)}
      </span>
      <span className="text-sm text-muted">{PRICE_EXCLUDES_VAT}</span>
      {price.comparePrice !== null && (
        <span className="text-sm text-muted">
          <span className="sr-only">Was </span><s>{formatKES(price.comparePrice)}</s>
        </span>
      )}
      {price.discountPercent > 0 && (
        <span className="rounded-sm bg-coral px-2 py-0.5 text-xs font-bold text-white">-{price.discountPercent}%</span>
      )}
    </p>
  );
}

export function AvailabilityLine({ selection }: { selection: ProductSelection }) {
  let detail: string | null = null;
  if (selection.variant && selection.stock > 0) detail = `${selection.stock} available`;
  else if (selection.status.kind === "incomplete") detail = "Availability depends on the options you choose.";
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <StockBadge level={selection.level} />
      {detail && <span className="text-sm text-muted">{detail}</span>}
    </p>
  );
}

function FixedOptions({ options }: { options: Extract<SelectionOption, { kind: "fixed" }>[] }) {
  if (!options.length) return null;
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-navy-800">
      {options.map((option) => (
        <div key={option.key} className="flex gap-1">
          <dt className="font-semibold text-navy-900">{option.label}:</dt>
          <dd>{option.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Option values as toggle buttons; values that cannot be bought with the other choices say so in text. */
export function OptionChoices({ selection, onChoose }: { selection: ProductSelection; onChoose: (key: string, value: string) => void }) {
  const fixed = selection.options.filter((option): option is Extract<SelectionOption, { kind: "fixed" }> => option.kind === "fixed");
  const choices = selection.options.filter((option): option is Extract<SelectionOption, { kind: "choice" }> => option.kind === "choice");
  return (
    <div className="space-y-5">
      <FixedOptions options={fixed} />
      {choices.map((option) => (
        <fieldset key={option.key} data-option-group data-missing={option.chosen === null ? "" : undefined} className="min-w-0">
          <legend className="mb-2 text-sm font-semibold text-navy-900">
            {option.label}{" "}
            <span className="ml-1 font-normal text-muted">{option.chosen ?? "Not selected"}</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {option.values.map(({ value, status }) => {
              const selected = option.chosen === value;
              const swatch = option.key.toLowerCase() === "color" || option.key.toLowerCase() === "colour" ? COLOR_MAP[value] : undefined;
              const note = status === "available" ? null : VALUE_NOTE[status];
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  aria-label={note ? `${value} (${note})` : undefined}
                  onClick={() => onChoose(option.key, value)}
                  className={`inline-flex min-h-[44px] min-w-[44px] max-w-full items-center justify-center gap-2 rounded-sm border px-3 py-1.5 text-sm transition-colors duration-(--motion-feedback) ${
                    selected
                      ? "border-navy-900 bg-navy-900 text-white"
                      : note ? "border-dashed border-control bg-surface text-muted hover:border-navy-900" : "border-control bg-surface text-navy-900 hover:border-navy-900"
                  }`}
                >
                  {swatch && <span aria-hidden="true" className="size-4 shrink-0 rounded-full border border-control" style={{ background: swatch }} />}
                  <span className={`min-w-0 break-words ${note ? "line-through" : ""}`}>{value}</span>
                  {note && <span className="text-xs">({note})</span>}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

const stepButton =
  "flex size-[44px] shrink-0 items-center justify-center text-lg text-navy-900 transition-colors duration-(--motion-feedback) first:rounded-l-sm last:rounded-r-sm hover:bg-surface-soft aria-disabled:cursor-not-allowed aria-disabled:text-muted aria-disabled:hover:bg-transparent";

/**
 * A stepper plus a typed field for whole numbers from 1 to `max`. Limits use `aria-disabled`, so a button that
 * reaches its limit keeps focus instead of dropping it.
 */
export function QuantityStepper({ value, max, disabled = false, label = "Quantity", name, onChange }: {
  value: number;
  max: number;
  disabled?: boolean;
  label?: string;
  /** Product name, for the buttons' names where several steppers share a page. */
  name?: string;
  onChange: (quantity: number) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const atMin = disabled || value <= 1;
  const atMax = disabled || value >= max;
  const commit = () => {
    if (draft === null) return;
    const parsed = Number.parseInt(draft, 10);
    setDraft(null);
    if (Number.isFinite(parsed)) onChange(Math.min(Math.max(1, parsed), Math.max(1, max)));
  };
  const suffix = name ? ` of ${name}` : "";
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-sm font-semibold text-navy-900">{label}<span className="sr-only">{suffix}</span></label>
      {/* Not overflow-hidden: that would clip the buttons' and field's focus rings. */}
      <div className="mt-1 inline-flex items-stretch rounded-sm border border-control bg-surface">
        <button type="button" aria-label={`Decrease quantity${suffix}`} aria-disabled={atMin} onClick={() => { if (!atMin) onChange(value - 1); }} className={stepButton}>−</button>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          disabled={disabled}
          value={draft ?? String(value)}
          onChange={(event) => setDraft(event.target.value.replace(/\D/g, ""))}
          onBlur={commit}
          onKeyDown={(event) => { if (event.key === "Enter") commit(); }}
          className="w-[56px] min-w-0 border-x border-control bg-surface text-center tabular-nums text-navy-900 disabled:bg-surface-soft disabled:text-muted"
        />
        <button type="button" aria-label={`Increase quantity${suffix}`} aria-disabled={atMax} onClick={() => { if (!atMax) onChange(value + 1); }} className={stepButton}>+</button>
      </div>
    </div>
  );
}

/** The polite status beside the purchase action: why Add is not possible yet, or a result to report. Always rendered, so changes are announced. */
export function PurchaseStatus({ id, message, tone = "info" }: { id?: string; message: ReactNode; tone?: "info" | "warning" }) {
  return (
    <p id={id} role="status" className={`text-sm ${tone === "warning" ? "font-semibold text-warning" : "text-navy-800"}`}>
      {message}
    </p>
  );
}
