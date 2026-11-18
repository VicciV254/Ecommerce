import { useId, useState, type FormEvent, type ReactNode } from "react";
import type { Address } from "../api/auth";
import { MAX_QUOTE_ITEMS, type DeliveryMethod, type Order, type Quote } from "../api/orders";
import { Link } from "../router";
import { useCatalog } from "../store/CatalogContext";
import { DELIVERY_LABELS, normalizeCouponCode } from "../store/checkoutModel";
import { summaryRows } from "../store/checkoutSummary";
import { deliveryDescription } from "../store/storeFacts";
import type { CheckoutQuote } from "../store/useCheckoutQuote";
import type { SubmissionState } from "../store/useOrderSubmission";
import { formatDateTime } from "../utils/format";
import { fieldClass, fieldLabelClass } from "./AddressForm";
import { FigureRows } from "./CheckoutSummary";

/** Quote errors shown beside the choice that caused them rather than in the totals. */
export const CHOICE_ERRORS = { address: "ADDRESS_UNAVAILABLE", delivery: "DELIVERY_UNAVAILABLE", coupon: "COUPON_INVALID" } as const;
/** Choices made on the Delivery step; a quote refused for one of them sends the shopper back there. */
export const DELIVERY_CHOICE_ERRORS: readonly string[] = [CHOICE_ERRORS.address, CHOICE_ERRORS.delivery];
const STOCK_ERRORS = ["OUT_OF_STOCK", "ITEM_UNAVAILABLE"];

const secondaryButtonClass =
  "inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-sm border border-navy-900 px-4 text-sm font-semibold text-navy-900 transition-colors duration-(--motion-feedback) hover:bg-surface-soft disabled:cursor-not-allowed disabled:border-control disabled:bg-surface-soft disabled:text-muted";
/** The page's main action: the commerce button (navy, gold on hover); disabled reads muted on soft, with a stated reason. */
export const primaryActionClass =
  "flex min-h-[48px] w-full items-center justify-center rounded-sm bg-navy-900 px-[20px] text-center text-sm font-bold uppercase tracking-[0.12em] text-white transition-colors duration-(--motion-feedback) hover:bg-gold-500 hover:text-navy-900 disabled:cursor-not-allowed disabled:bg-surface-soft disabled:text-muted";
export const secondaryActionClass =
  "flex min-h-[48px] w-full items-center justify-center rounded-sm border border-navy-900 px-[20px] text-center text-sm font-semibold text-navy-900 transition-colors duration-(--motion-feedback) hover:bg-surface-soft";
export const textLinkClass = "inline-flex min-h-[44px] items-center font-semibold text-link underline underline-offset-4 hover:text-link-hover";
const inlineLinkClass = "font-semibold text-link underline underline-offset-4 hover:text-link-hover";

export function formatAddress(address: Pick<Address, "street" | "city" | "county">) {
  return `${address.street}, ${address.city}, ${address.county}`;
}

function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return <p id={id} role="alert" className="mt-1.5 text-sm font-semibold text-error">{message}</p>;
}

/**
 * Choice cards for the delivery methods new orders can use, in the catalog's order; the fee for each appears only in the
 * server's quote. Each radio is named by its visible label alone and described by the line under it.
 */
export function DeliveryMethodChoices({ deliveryMethod, disabled, error, onDelivery }: {
  deliveryMethod: DeliveryMethod;
  disabled: boolean;
  error: string | null;
  onDelivery: (method: DeliveryMethod) => void;
}) {
  const id = useId();
  const { delivery } = useCatalog();
  return (
    <fieldset className="min-w-0" aria-describedby={error ? `${id}-delivery-error` : undefined}>
      <legend className={fieldLabelClass}>Delivery method</legend>
      <div className="mt-1.5 space-y-2">
        {(delivery ?? []).map((option) => (
          <label key={option.method} className="flex min-h-[48px] cursor-pointer items-start gap-3 rounded-md border border-control bg-surface px-3 py-2.5 text-navy-900 has-[:checked]:border-2 has-[:checked]:border-navy-900 has-[:checked]:bg-surface-page has-[:disabled]:cursor-not-allowed">
            {/* As tall as the label's first line, so the radio stays beside it however the description wraps. */}
            <span className="flex h-6 shrink-0 items-center">
              <input
                type="radio"
                name={`${id}-delivery`}
                value={option.method}
                checked={deliveryMethod === option.method}
                disabled={disabled}
                onChange={() => onDelivery(option.method)}
                aria-labelledby={`${id}-${option.method}-label`}
                aria-describedby={`${id}-${option.method}-description`}
                className="size-5 accent-navy-900"
              />
            </span>
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span id={`${id}-${option.method}-label`} className="block leading-6">{DELIVERY_LABELS[option.method]}</span>
              <span id={`${id}-${option.method}-description`} className="block text-sm text-muted">{deliveryDescription(option)}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="mt-1.5 text-sm text-muted">The fee for the method you choose is added to your total.</p>
      <FieldError id={`${id}-delivery-error`} message={error} />
    </fieldset>
  );
}

/** The cart page's saved address and delivery method; fees appear only in the server quote. */
export function DeliveryChoices({
  addresses, address, deliveryMethod, disabled, errorCode, errorMessage, onAddress, onDelivery,
}: {
  addresses: Address[];
  address: Address | null;
  deliveryMethod: DeliveryMethod;
  disabled: boolean;
  errorCode?: string;
  errorMessage?: string;
  onAddress: (addressId: string) => void;
  onDelivery: (method: DeliveryMethod) => void;
}) {
  const id = useId();
  if (!address) {
    return (
      <div className="rounded-md border border-warning/40 bg-warning-tint p-3 text-sm text-navy-800">
        <p className="font-semibold">Add a delivery address to see delivery, VAT and your total.</p>
        <Link to="/checkout" className={textLinkClass}>Add your address at checkout</Link>
      </div>
    );
  }
  const addressError = errorCode === CHOICE_ERRORS.address ? errorMessage ?? null : null;
  const deliveryError = errorCode === CHOICE_ERRORS.delivery ? errorMessage ?? null : null;
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${id}-address`} className={fieldLabelClass}>Delivery address</label>
        <select
          id={`${id}-address`}
          value={address.id}
          disabled={disabled}
          aria-invalid={Boolean(addressError)}
          aria-describedby={addressError ? `${id}-address-error` : undefined}
          onChange={(event) => onAddress(event.target.value)}
          className={fieldClass}
        >
          {addresses.map((item) => (
            <option key={item.id} value={item.id}>{formatAddress(item)}{item.isDefault ? " (default)" : ""}</option>
          ))}
        </select>
        <FieldError id={`${id}-address-error`} message={addressError} />
        <Link to="/account/addresses" className={`${textLinkClass} text-sm`}>Manage addresses</Link>
      </div>
      <DeliveryMethodChoices deliveryMethod={deliveryMethod} disabled={disabled} error={deliveryError} onDelivery={onDelivery} />
    </div>
  );
}

/** Coupon entry; the code is kept with the cart and only the server decides whether it applies. */
export function CouponField({
  couponCode, quote, errorCode, errorMessage, disabled, onApply, onRemove,
}: {
  couponCode: string | null;
  quote: Quote | null;
  errorCode?: string;
  errorMessage?: string;
  disabled: boolean;
  onApply: (couponCode: string) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);

  if (couponCode) {
    const error = errorCode === CHOICE_ERRORS.coupon ? errorMessage ?? null : null;
    const priced = quote?.couponCode === couponCode ? quote : null;
    let outcome = "Checking this code with your total…";
    if (error) outcome = "Not applied.";
    else if (priced?.couponApplied) outcome = "Applied to your total.";
    else if (priced) outcome = priced.couponMessage ?? "Not applied to this order.";
    return (
      <div>
        <p className={fieldLabelClass}>Coupon</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3 rounded-md border border-control bg-surface-page px-3 py-2">
          <p className="min-w-0 text-sm text-navy-800 [overflow-wrap:anywhere]">
            <span className="font-mono font-bold text-navy-900">{couponCode}</span>
            <span className="block">{outcome}</span>
          </p>
          <button type="button" disabled={disabled} onClick={onRemove} aria-label={`Remove coupon ${couponCode}`} className={secondaryButtonClass}>
            Remove
          </button>
        </div>
        <FieldError id={`${id}-coupon-error`} message={error} />
      </div>
    );
  }

  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = normalizeCouponCode(draft);
    setInvalid(code === null);
    if (code === null) return;
    setDraft("");
    onApply(code);
  };
  return (
    <form onSubmit={apply} noValidate>
      <label htmlFor={`${id}-coupon`} className={fieldLabelClass}>Coupon code (optional)</label>
      <div className="mt-1 flex flex-wrap gap-2">
        <input
          id={`${id}-coupon`}
          value={draft}
          disabled={disabled}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-coupon-error` : undefined}
          onChange={(event) => { setDraft(event.target.value); setInvalid(false); }}
          className="min-h-[44px] min-w-0 flex-1 basis-40 rounded-sm border border-control bg-surface px-3 py-2 uppercase text-navy-900 aria-[invalid=true]:border-2 aria-[invalid=true]:border-error disabled:cursor-not-allowed disabled:bg-surface-soft disabled:text-muted"
        />
        <button type="submit" disabled={disabled || !draft.trim()} className={secondaryButtonClass}>Apply</button>
      </div>
      <FieldError id={`${id}-coupon-error`} message={invalid ? "Enter 3–40 letters, numbers, hyphens or underscores." : null} />
    </form>
  );
}

/** Server totals: VAT and delivery stay separate lines, nothing is added up in the browser. */
export function QuoteTotals({ quote }: { quote: Quote }) {
  return <FigureRows rows={summaryRows({ kind: "quote", quote })} />;
}

/**
 * Totals panel for the current request: why nothing is quoted yet, progress, errors, expiry and the
 * server's totals. A previous quote is never presented as current while a new one is loading. A refusal caused by a
 * delivery choice made elsewhere shows `changeDelivery` (a way back to that choice) instead of a retry.
 */
export function QuoteSummary({ blocker, quote, onRefreshAvailability, changeDelivery }: {
  blocker: string | null;
  quote: CheckoutQuote;
  onRefreshAvailability: () => void;
  changeDelivery?: ReactNode;
}) {
  if (blocker) return <p role="status" className="rounded-md bg-surface-soft p-3 text-sm font-semibold text-navy-800">{blocker}</p>;
  if (quote.status === "idle") return null;
  if (quote.status === "loading") {
    return (
      <p role="status" className="flex items-center gap-2 rounded-md bg-surface-soft p-3 text-sm text-navy-800">
        <span aria-hidden="true" className="size-4 shrink-0 animate-spin rounded-full border-2 border-navy-900 border-t-transparent" />
        Calculating your total with current prices…
      </p>
    );
  }
  if (quote.error) {
    const code = quote.error.code ?? "";
    const choice = Object.values(CHOICE_ERRORS).some((item) => item === code);
    const stock = STOCK_ERRORS.includes(code);
    const elsewhere = changeDelivery !== undefined && DELIVERY_CHOICE_ERRORS.includes(code);
    return (
      <div role="alert" className="rounded-md border border-error/40 bg-error-tint p-3 text-sm text-navy-800">
        <p className="font-semibold text-error">
          {elsewhere ? "Your total can't be calculated for the delivery you chose." : choice ? "Your total can't be calculated until the highlighted choice is changed." : quote.error.message}
        </p>
        {elsewhere && <p className="mt-1">{quote.error.message}</p>}
        {stock && <p className="mt-1">Reduce or remove that item, then check again.</p>}
        {elsewhere ? changeDelivery : (
          <button type="button" onClick={stock ? onRefreshAvailability : quote.refresh} className={textLinkClass}>
            {stock ? "Refresh availability" : "Try again"}
          </button>
        )}
      </div>
    );
  }
  if (!quote.quote) return null;
  return (
    <div className="space-y-3">
      <QuoteTotals quote={quote.quote} />
      {quote.expired ? (
        <div role="alert" className="rounded-md border border-warning/40 bg-warning-tint p-3 text-sm text-navy-800">
          <p className="font-semibold">These prices expired at {formatDateTime(quote.quote.expiresAt)}.</p>
          <button type="button" onClick={quote.refresh} className={textLinkClass}>Refresh prices</button>
        </div>
      ) : (
        <p className="text-sm text-muted">Prices held until {formatDateTime(quote.quote.expiresAt)}.</p>
      )}
      {quote.quote.mode === "demo" && (
        <p role="note" className="rounded-md border border-info/30 bg-info-tint p-3 text-sm text-info">
          Demo quote: these are sample products in a development store, not a real purchase.
        </p>
      )}
    </div>
  );
}

const NOTICE_TONES = {
  info: { box: "border-info/30 bg-info-tint", title: "text-info" },
  warning: { box: "border-warning/40 bg-warning-tint", title: "text-warning" },
  error: { box: "border-error/40 bg-error-tint", title: "text-error" },
  success: { box: "border-success/40 bg-success-tint", title: "text-success" },
} as const;

/** A message in its semantic tint: the title in the tone's colour, the text in body navy, so both stay legible. */
export function Notice({ tone, role, title, children }: {
  tone: keyof typeof NOTICE_TONES;
  role: "status" | "alert";
  title?: string;
  children: ReactNode;
}) {
  return (
    <div role={role} className={`rounded-md border p-4 text-sm text-navy-800 [overflow-wrap:anywhere] ${NOTICE_TONES[tone].box}`}>
      {title && <p className={`font-semibold ${NOTICE_TONES[tone].title}`}>{title}</p>}
      <div className={title ? "mt-1" : ""}>{children}</div>
    </div>
  );
}

function lapsedReason(order: Order) {
  return order.reservationStatus === "EXPIRED"
    ? "Its reservation expired before payment, so the items were released."
    : "It was cancelled, so the items were released.";
}

/** Outcome of an earlier or failed request; placed orders get their own panel. */
export function SubmissionNotice({ state, actions }: { state: SubmissionState; actions?: ReactNode }) {
  switch (state.status) {
    case "resolving":
      return <Notice tone="info" role="status">Checking the outcome of your earlier order request…</Notice>;
    case "sending":
      return state.retry ? <Notice tone="info" role="status">Sending your earlier order request again with the same request key…</Notice> : null;
    case "unresolved":
      return (
        <Notice tone="warning" role="alert" title="Your order request has not finished">
          <p>{state.message}</p>
          {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
        </Notice>
      );
    case "lapsed":
      return (
        <Notice tone="warning" role="status" title={`Order ${state.order.orderNumber} is no longer reserved`}>
          <p>{lapsedReason(state.order)} Your cart still has these items.</p>
        </Notice>
      );
    case "rejected":
      return <Notice tone="error" role="alert" title="Your order was not placed"><p>{state.message}</p></Notice>;
    case "blocked":
      return <Notice tone="error" role="alert" title="Your order was not sent"><p>{state.message}</p></Notice>;
    default:
      return null;
  }
}

/** Why the cart cannot be quoted as a whole; a partial order is never quoted silently. */
export const CART_BLOCKERS = {
  unavailable: "Remove unavailable items to see your total.",
  stock: "Reduce quantities to what is available to see your total.",
  "too-many": `An order can include up to ${MAX_QUOTE_ITEMS} different items. Remove some to see your total.`,
  settling: "Your total returns once your earlier order request is settled.",
} as const;

/** Compact confirmation where the full order panel is not shown. */
export function PlacedNotice({ order }: { order: Order }) {
  return (
    <Notice tone="info" role="status" title={`Order ${order.orderNumber} is reserved and not paid`}>
      <p>
        Its items were removed from your cart.
        {order.reservationStatus === "HELD" && order.reservationExpiresAt && ` Items are held until ${formatDateTime(order.reservationExpiresAt)}.`}{" "}
        <Link to="/account/orders" className={inlineLinkClass}>View or cancel it in your orders</Link>
      </p>
    </Notice>
  );
}
