import { useMemo, useState } from "react";
import { catalogAdminAPI, type CatalogDiscount, type DiscountInput } from "../../api/catalog";
import { describeApiError } from "../../api/errors";
import { ConfirmModal } from "../../components/Modal";
import { discountAppliesTo, isDiscountActive } from "../../store/catalogModel";
import { normalizeCouponCode } from "../../store/checkoutModel";
import { formatKES } from "../../utils/format";
import { useAdminCatalog } from "./AdminCatalogContext";
import {
  Feedback,
  Field,
  Panel,
  categoryOptions,
  dangerButtonClass,
  fromDateInput,
  inputClass,
  primaryButtonClass,
  smallButtonClass,
  toDateInput,
  todayInput,
} from "./shared";

const PERCENT_PRESETS = [5, 10, 15, 20, 25, 50];
const MAX_PERCENT = 100;
const MAX_AMOUNT = 1_000_000_000;
const PICKER_LIMIT = 60;
const DEFAULT_DURATION_DAYS = 7;

type Scope = CatalogDiscount["applyTo"];

function validValue(type: CatalogDiscount["type"], value: number) {
  return Number.isFinite(value) && value > 0 && value <= (type === "PERCENTAGE" ? MAX_PERCENT : MAX_AMOUNT) &&
    Number(value.toFixed(2)) === value;
}

function discountInput(discount: CatalogDiscount, patch: Partial<DiscountInput>): DiscountInput {
  return {
    name: discount.name,
    type: discount.type,
    value: discount.value,
    couponCode: discount.couponCode,
    applyTo: discount.applyTo,
    targetIds: discount.targetIds,
    startDate: discount.startDate,
    endDate: discount.endDate,
    isActive: discount.isActive,
    ...patch,
  };
}

export function DiscountManager({ showToast }: { showToast: (message: string) => void }) {
  const { data, categories, reload } = useAdminCatalog();
  const products = useMemo(() => data?.snapshot.products ?? [], [data]);
  const discounts = data?.snapshot.discounts ?? [];
  const options = useMemo(() => categoryOptions(categories), [categories]);

  const [scope, setScope] = useState<Scope>("CATEGORY");
  const [categoryId, setCategoryId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [kind, setKind] = useState<CatalogDiscount["type"]>("PERCENTAGE");
  const [discountValue, setDiscountValue] = useState(10);
  const [couponDraft, setCouponDraft] = useState("");
  const [startDate, setStartDate] = useState(todayInput());
  const [endDate, setEndDate] = useState(todayInput(DEFAULT_DURATION_DAYS));
  const [search, setSearch] = useState("");
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [confirmStop, setConfirmStop] = useState<CatalogDiscount | null>(null);
  const [edits, setEdits] = useState<Record<string, { value: number; endDate: string }>>({});
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  const chosenCategory = categoryId || options[0]?.id || "";
  // Discounts created here are live records, so demo products cannot be targeted.
  const picks = products
    .filter((product) => !product.isDemo && product.name.toLowerCase().includes(search.trim().toLowerCase()))
    .slice(0, PICKER_LIMIT);
  const couponCode = couponDraft.trim() ? normalizeCouponCode(couponDraft) : null;
  const validCoupon = !couponDraft.trim() || couponCode !== null;
  const canCreate = validValue(kind, discountValue) && validCoupon && Boolean(startDate) && (!endDate || endDate >= startDate) &&
    (scope === "ALL" || (scope === "CATEGORY" ? Boolean(chosenCategory) : selected.length > 0));
  const valueLabel = kind === "PERCENTAGE" ? `${discountValue}%` : formatKES(discountValue);
  const now = new Date();

  const create = async () => {
    setConfirmCreate(false);
    setSaving("create");
    setError("");
    const name = scope === "ALL"
      ? "All products sale"
      : scope === "CATEGORY"
      ? `${categories.byId.get(chosenCategory)?.name ?? "Category"} sale`
      : `${selected.length} item sale`;
    try {
      await catalogAdminAPI.createDiscount({
        name,
        type: kind,
        value: discountValue,
        ...(couponCode ? { couponCode } : {}),
        applyTo: scope,
        targetIds: scope === "ALL" ? [] : scope === "CATEGORY" ? [chosenCategory] : selected,
        startDate: fromDateInput(startDate, "start"),
        ...(endDate ? { endDate: fromDateInput(endDate, "end") } : {}),
        isActive: true,
      });
      setSelected([]);
      setSearch("");
      setCouponDraft("");
      showToast("Discount created");
      reload();
    } catch (reason) {
      setError(describeApiError(reason, "The discount could not be created."));
    } finally {
      setSaving("");
    }
  };

  const saveEdit = async (discount: CatalogDiscount) => {
    const edit = edits[discount.id];
    if (!edit) return;
    setSaving(discount.id);
    setError("");
    try {
      await catalogAdminAPI.updateDiscount(discount.id, discountInput(discount, {
        value: edit.value,
        endDate: edit.endDate ? fromDateInput(edit.endDate, "end") : null,
      }));
      setEdits(({ [discount.id]: _saved, ...rest }) => rest);
      showToast("Discount updated");
      reload();
    } catch (reason) {
      setError(describeApiError(reason, "The discount could not be updated."));
    } finally {
      setSaving("");
    }
  };

  const stop = async (discount: CatalogDiscount) => {
    setConfirmStop(null);
    setSaving(discount.id);
    setError("");
    try {
      await catalogAdminAPI.deleteDiscount(discount.id);
      showToast("Discount stopped");
      reload();
    } catch (reason) {
      setError(describeApiError(reason, "The discount could not be stopped."));
    } finally {
      setSaving("");
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
      <Panel title="Create Discount" description="Automatic discounts are reflected in storefront prices calculated by the server; the strongest offer applies and discounts never stack. A coupon discount applies only in checkout quotes where the shopper enters its code.">
        <div className="space-y-4">
          <fieldset>
            <legend className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">Discount type</legend>
            <div className="grid grid-cols-2 gap-2">
              {([["PERCENTAGE", "Percentage"], ["FIXED", "Fixed amount"]] as const).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}
                  className={`min-h-11 rounded-sm border px-2 text-xs font-bold ${kind === value ? "border-brand-primary bg-brand-primary text-white" : "border-light-gray text-gray-600"}`}>
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">Apply To</legend>
            <div className="grid grid-cols-3 gap-1">
              {([["ALL", "All"], ["CATEGORY", "Category"], ["SELECTED", "Products"]] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={scope === value}
                  onClick={() => setScope(value)}
                  className={`rounded-sm border py-2 text-[11px] font-bold ${scope === value ? "border-brand-primary bg-brand-primary text-white" : "border-light-gray text-gray-600"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          {scope === "CATEGORY" && (
            <Field label="Category (includes its sub-categories)">
              {(id) => (
                <select id={id} value={chosenCategory} onChange={(event) => setCategoryId(event.target.value)} className={inputClass}>
                  {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              )}
            </Field>
          )}

          {scope === "SELECTED" && (
            <div>
              <Field label={`Pick products (${selected.length} selected)`}>
                {(id) => <input id={id} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products…" className={inputClass} />}
              </Field>
              <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-sm border border-light-gray p-2">
                {picks.map((product) => {
                  const checked = selected.includes(product.id);
                  return (
                    <label key={product.id} className="flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-xs hover:bg-off-white">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setSelected((ids) => (checked ? ids.filter((id) => id !== product.id) : [...ids, product.id]))}
                        className="h-3.5 w-3.5 accent-brand-secondary"
                      />
                      <span className="flex-1 truncate text-charcoal">{product.name}</span>
                      {!product.isActive && <span className="text-[9px] font-bold uppercase text-gray-600">Hidden</span>}
                      <span className="text-gray-500">{formatKES(product.price)}</span>
                    </label>
                  );
                })}
                {!picks.length && <p className="p-2 text-xs text-gray-500">No products match.</p>}
              </div>
            </div>
          )}

          <fieldset>
            <legend className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">{kind === "PERCENTAGE" ? "Discount %" : "Discount amount (KES)"}</legend>
            {kind === "PERCENTAGE" && <div className="mb-2 flex gap-1">
              {PERCENT_PRESETS.map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={discountValue === value}
                  onClick={() => setDiscountValue(value)}
                  className={`flex-1 rounded-sm border py-1.5 text-[11px] font-bold ${discountValue === value ? "border-brand-primary bg-brand-primary text-white" : "border-light-gray text-gray-600"}`}
                >
                  {value}%
                </button>
              ))}
            </div>}
            <input
              type="number"
              aria-label={kind === "PERCENTAGE" ? "Custom percentage" : "Fixed amount (KES)"}
              value={discountValue}
              min={0.01}
              step={0.01}
              max={kind === "PERCENTAGE" ? MAX_PERCENT : MAX_AMOUNT}
              onChange={(event) => setDiscountValue(Number(event.target.value))}
              className={inputClass}
            />
          </fieldset>

          <div>
            <Field label="Coupon code (optional)" hint="Leave empty for an automatic discount shown in storefront prices.">
              {(id) => (
                <input
                  id={id}
                  value={couponDraft}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!validCoupon}
                  onChange={(event) => setCouponDraft(event.target.value)}
                  className={`uppercase ${inputClass}`}
                />
              )}
            </Field>
            {!validCoupon && <p role="alert" className="mt-1 text-[11px] font-semibold text-error">Use 3–40 letters, numbers, hyphens or underscores.</p>}
          </div>
          {kind === "FIXED" && <p className="text-xs text-gray-600">
            {couponCode ? "A fixed coupon is deducted once from eligible merchandise, not once per item." : "An automatic fixed discount applies per eligible unit using the configured catalog rounding."}
          </p>}

          <div className="grid grid-cols-2 gap-2">
            <Field label="Start">{(id) => <input id={id} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className={inputClass} />}</Field>
            <Field label="End (inclusive)">{(id) => <input id={id} type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} className={inputClass} />}</Field>
          </div>

          <button type="button" onClick={() => setConfirmCreate(true)} disabled={!canCreate || saving === "create"} className={`w-full ${primaryButtonClass} py-3`}>
            {saving === "create" ? "Creating…" : "Create Discount"}
          </button>
        </div>
      </Panel>

      <Panel title={`Current Discounts (${discounts.length})`}>
        <div className="space-y-3">
          <Feedback message={error} tone="error" />
          {!discounts.length && <p className="py-12 text-center text-sm text-gray-500">No discounts yet.</p>}
          {discounts.map((discount) => {
            const active = isDiscountActive(discount, now);
            const affected = products.filter((product) => discountAppliesTo(discount, product)).length;
            const edit = edits[discount.id] ?? { value: discount.value, endDate: toDateInput(discount.endDate) };
            const dirty = Boolean(edits[discount.id]);
            return (
              <article key={discount.id} className="rounded-md border border-light-gray p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-brand-primary">
                      {discount.name}
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${active ? "bg-success/15 text-success" : "bg-gray-100 text-gray-600"}`}>
                        {active ? "Active" : discount.isActive ? "Scheduled / Ended" : "Paused"}
                      </span>
                      {discount.isDemo && <span className="rounded-full bg-ocean-blue/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-ocean-blue">Demo: demo products only</span>}
                      {discount.couponCode && <span className="rounded-full bg-brand-secondary/20 px-2 py-0.5 font-mono text-[10px] font-bold text-brand-accent">Coupon {discount.couponCode}</span>}
                    </p>
                    <p className="mt-1 text-xs text-gray-600">
                      {affected} {affected === 1 ? "product" : "products"} · {toDateInput(discount.startDate)} → {discount.endDate ? toDateInput(discount.endDate) : "no end date"}
                    </p>
                  </div>
                  <p className="text-right font-display text-2xl text-coral">
                    {discount.type === "PERCENTAGE" ? `${discount.value}%` : formatKES(discount.value)}
                    <span className="block text-[9px] uppercase tracking-wider text-gray-500">off</span>
                  </p>
                </div>
                  <div className="mt-3 grid gap-2 border-t border-light-gray pt-3 sm:grid-cols-4">
                    <Field label={discount.type === "PERCENTAGE" ? "Percentage" : "Amount (KES)"}>
                      {(id) => (
                        <input id={id} type="number" min={0.01} step={0.01} max={discount.type === "PERCENTAGE" ? MAX_PERCENT : MAX_AMOUNT} value={edit.value}
                          onChange={(event) => setEdits((all) => ({ ...all, [discount.id]: { ...edit, value: Number(event.target.value) } }))}
                          className={inputClass} />
                      )}
                    </Field>
                    <Field label="End date">
                      {(id) => (
                        <input id={id} type="date" value={edit.endDate} min={toDateInput(discount.startDate)}
                          onChange={(event) => setEdits((all) => ({ ...all, [discount.id]: { ...edit, endDate: event.target.value } }))}
                          className={inputClass} />
                      )}
                    </Field>
                    <div className="flex items-end">
                      <button type="button" disabled={!dirty || saving === discount.id || !validValue(discount.type, edit.value)} onClick={() => void saveEdit(discount)} className={`w-full ${smallButtonClass}`}>
                        Save
                      </button>
                    </div>
                    <div className="flex items-end">
                      <button type="button" disabled={saving === discount.id} onClick={() => setConfirmStop(discount)} className={`w-full ${dangerButtonClass}`}>
                        Stop Discount
                      </button>
                    </div>
                  </div>
              </article>
            );
          })}
        </div>
      </Panel>

      <ConfirmModal
        open={confirmCreate}
        title="Create this discount?"
        message={couponCode
          ? `A ${valueLabel} discount for coupon ${couponCode} will be saved. From ${startDate} it applies only to checkout quotes that enter the code.`
          : `A ${valueLabel} discount will be saved and shown to shoppers from ${startDate}.`}
        confirmLabel="Create Discount"
        onConfirm={() => void create()}
        onCancel={() => setConfirmCreate(false)}
      />
      <ConfirmModal
        open={Boolean(confirmStop)}
        title="Stop this discount?"
        message={confirmStop ? `"${confirmStop.name}" will stop applying immediately.` : undefined}
        confirmLabel="Stop Discount"
        tone="danger"
        onConfirm={() => { if (confirmStop) void stop(confirmStop); }}
        onCancel={() => setConfirmStop(null)}
      />
    </div>
  );
}
