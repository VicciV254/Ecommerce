import { useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Address } from "../api/auth";
import { describeApiError } from "../api/errors";
import {
  ADDRESS_FIELDS,
  ADDRESS_LABELS,
  ADDRESS_MAX_LENGTH,
  addressInput,
  addressProblems,
  type AddressDraft,
  type AddressField,
  type AddressProblems,
} from "../store/addressModel";

/** Browsers fill each field from the shopper's saved addresses. */
const AUTOCOMPLETE: Record<AddressField, string> = {
  street: "street-address",
  city: "address-level2",
  county: "address-level1",
  postalCode: "postal-code",
};

export const fieldLabelClass = "block text-sm font-semibold text-navy-900";
export const fieldClass =
  "mt-1 block min-h-[44px] w-full min-w-0 rounded-sm border border-control bg-surface px-3 py-2 text-navy-900 placeholder:text-muted aria-[invalid=true]:border-2 aria-[invalid=true]:border-error disabled:cursor-not-allowed disabled:bg-surface-soft disabled:text-muted";
/** `fieldClass` for a `WrappingSelect`'s box: the box is not the control, so its states come from the select inside. */
export const selectBoxClass =
  "mt-1 min-h-[44px] w-full min-w-0 rounded-sm border border-control bg-surface px-3 py-2 text-navy-900 has-[select[aria-invalid=true]]:border-2 has-[select[aria-invalid=true]]:border-error has-[select:disabled]:bg-surface-soft has-[select:disabled]:text-muted";
export const fieldErrorClass = "mt-1 text-sm font-semibold text-error";

/** The four address fields with their labels, autocomplete hints and the error tied to each field. */
export function AddressFields({ idPrefix, value, problems, disabled = false, onChange }: {
  idPrefix: string;
  value: AddressDraft;
  problems: AddressProblems;
  disabled?: boolean;
  onChange: (field: AddressField, text: string) => void;
}) {
  return (
    // Columns sized in rem follow the text size, so enlarged text gets one field per row instead of squeezed labels.
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-4">
      {ADDRESS_FIELDS.map((field) => {
        const id = `${idPrefix}-${field}`;
        const problem = problems[field];
        return (
          <div key={field} className={field === "street" ? "col-span-full" : "min-w-0"}>
            <label htmlFor={id} className={fieldLabelClass}>{ADDRESS_LABELS[field]}</label>
            <input
              id={id}
              name={field}
              type="text"
              autoComplete={AUTOCOMPLETE[field]}
              required={field !== "postalCode"}
              maxLength={ADDRESS_MAX_LENGTH[field]}
              value={value[field]}
              disabled={disabled}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `${id}-error` : undefined}
              onChange={(event) => onChange(field, event.target.value)}
              className={fieldClass}
            />
            {problem && <p id={`${id}-error`} className={fieldErrorClass}>{problem}</p>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The problems found on submit, each a button that moves focus to its field, plus a failure from the server. It takes
 * focus when shown, so the shopper hears what to fix; the fields keep their own messages.
 */
export function ErrorSummary({ idPrefix, problems, failure, focusKey }: {
  idPrefix: string;
  problems: AddressProblems;
  failure: string | null;
  /** Changes on each failed submit, so the summary takes focus again. */
  focusKey: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const entries = ADDRESS_FIELDS.flatMap((field) => (problems[field] ? [[field, problems[field]] as const] : []));
  const shown = entries.length > 0 || failure !== null;
  useLayoutEffect(() => {
    if (focusKey > 0) box.current?.focus();
  }, [focusKey]);
  if (!shown) return null;
  return (
    <div ref={box} tabIndex={-1} role="alert" aria-labelledby={titleId} className="rounded-md border-2 border-error bg-error-tint p-4 text-navy-800">
      <p id={titleId} className="font-semibold text-error">{entries.length ? "Check your address" : "Your address was not saved"}</p>
      {failure && <p className="mt-1">{failure}</p>}
      {entries.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {entries.map(([field, message]) => (
            <li key={field}>
              <button
                type="button"
                onClick={() => document.getElementById(`${idPrefix}-${field}`)?.focus()}
                className="inline-flex min-h-[44px] items-center text-left font-semibold text-error underline underline-offset-4"
              >
                {message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A new delivery address. Problems are shown beside their fields and summarised on submit; the address is sent only
 * when the fields pass the server's rules, and `onSaved` receives the server's record. `onDraft` sees every change, so
 * the caller can keep what was typed.
 */
export function AddressForm({
  title, initial, isDefault, submitLabel, extra, onDraft, onSave, onSaved, onCancel,
}: {
  title: string;
  initial: AddressDraft;
  isDefault: boolean;
  submitLabel: string;
  /** Controls shown after the fields and before the actions (for example the delivery method). */
  extra?: ReactNode;
  onDraft?: (draft: AddressDraft) => void;
  onSave: (address: Omit<Address, "id">) => Promise<Address>;
  onSaved: (address: Address) => void;
  onCancel?: () => void;
}) {
  const idPrefix = useId();
  const titleId = `${idPrefix}-title`;
  const [draft, setDraft] = useState(initial);
  const [problems, setProblems] = useState<AddressProblems>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  const change = (field: AddressField, text: string) => {
    const next = { ...draft, [field]: text };
    setDraft(next);
    onDraft?.(next);
    // A field's message clears once it is fixed; the others stay until the next submit.
    if (problems[field] && !addressProblems(next)[field]) setProblems((current) => ({ ...current, [field]: undefined }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) return;
    const found = addressProblems(draft);
    setProblems(found);
    setFailure(null);
    if (Object.keys(found).length) {
      setAttempts((count) => count + 1);
      return;
    }
    busy.current = true;
    setSaving(true);
    try {
      const saved = await onSave(addressInput(draft, isDefault));
      onSaved(saved);
    } catch (error) {
      setFailure(describeApiError(error, "Your address could not be saved. Check your connection and try again."));
      setAttempts((count) => count + 1);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  return (
    <form noValidate onSubmit={submit} aria-labelledby={titleId} className="space-y-4">
      <h3 id={titleId} className="type-h3 text-navy-900">{title}</h3>
      <ErrorSummary idPrefix={idPrefix} problems={problems} failure={failure} focusKey={attempts} />
      <AddressFields idPrefix={idPrefix} value={draft} problems={problems} disabled={saving} onChange={change} />
      {extra}
      <p role="status" className="sr-only">{saving ? "Saving your address…" : ""}</p>
      {/* Side by side while they fit; otherwise each action takes its own row. */}
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          aria-disabled={saving}
          className="inline-flex min-h-[48px] flex-auto items-center justify-center rounded-sm bg-navy-900 px-[20px] text-sm font-bold uppercase tracking-[0.12em] text-white transition-colors duration-(--motion-feedback) hover:bg-gold-500 hover:text-navy-900 aria-disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={() => { if (!busy.current) onCancel(); }}
            className="inline-flex min-h-[48px] flex-auto items-center justify-center rounded-sm border border-navy-900 px-[20px] text-sm font-semibold text-navy-900 transition-colors duration-(--motion-feedback) hover:bg-surface-soft"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
