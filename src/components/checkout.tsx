import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Address } from "../api/auth";
import { MAX_QUOTE_ITEMS, type DeliveryMethod, type Order, type Quote } from "../api/orders";
import { Link } from "../router";
import { describeVariant } from "../store/catalogModel";
import { DELIVERY_LABELS, DELIVERY_METHODS, normalizeCouponCode } from "../store/checkoutModel";
import type { CheckoutQuote } from "../store/useCheckoutQuote";
import type { SubmissionState } from "../store/useOrderSubmission";
import { formatDateTime, formatKES } from "../utils/format";

/** Quote errors shown beside the choice that caused them rather than in the totals. */
export const CHOICE_ERRORS = { address: "ADDRESS_UNAVAILABLE", delivery: "DELIVERY_UNAVAILABLE", coupon: "COUPON_INVALID" } as const;
const STOCK_ERRORS = ["OUT_OF_STOCK", "ITEM_UNAVAILABLE"];

const labelClass = "block text-[11px] font-bold uppercase tracking-[0.12em] text-brand-primary";
const fieldClass = "w-full min-w-0 rounded-sm border border-light-gray bg-off-white px-3 py-2.5 text-sm focus:border-brand-secondary disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass = "shrink-0 rounded-sm border border-brand-primary px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-primary hover:bg-brand-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-50";
export const primaryActionClass = "block w-full rounded-sm bg-brand-primary py-3.5 text-center text-xs font-bold uppercase tracking-[0.12em] text-white hover:bg-brand-secondary hover:text-brand-primary disabled:cursor-not-allowed disabled:bg-light-gray disabled:text-charcoal";

export function formatAddress(address: Pick<Address, "street" | "city" | "county">) {
  return `${address.street}, ${address.city}, ${address.county}`;
}

function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return <p id={id} role="alert" className="mt-1.5 text-xs font-semibold text-error">{message}</p>;
}

/** Saved address and delivery method; fees appear only in the server quote. */
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
      <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-charcoal">
        <p className="font-semibold">Add a delivery address to see delivery, VAT and your total.</p>
        <Link to="/account/addresses" className="mt-2 inline-block font-bold text-brand-primary underline underline-offset-4">
          Add an address
        </Link>
      </div>
    );
  }
  const addressError = errorCode === CHOICE_ERRORS.address ? errorMessage ?? null : null;
  const deliveryError = errorCode === CHOICE_ERRORS.delivery ? errorMessage ?? null : null;
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${id}-address`} className={labelClass}>Delivery address</label>
        <select
          id={`${id}-address`}
          value={address.id}
          disabled={disabled}
          aria-invalid={Boolean(addressError)}
          aria-describedby={addressError ? `${id}-address-error` : undefined}
          onChange={(event) => onAddress(event.target.value)}
          className={`mt-1.5 ${fieldClass}`}
        >
          {addresses.map((item) => (
            <option key={item.id} value={item.id}>{formatAddress(item)}{item.isDefault ? " (default)" : ""}</option>
          ))}
        </select>
        <FieldError id={`${id}-address-error`} message={addressError} />
        <Link to="/account/addresses" className="mt-1.5 inline-block text-[11px] text-gray-600 underline underline-offset-4 hover:text-brand-primary">
          Manage addresses
        </Link>
      </div>
      <fieldset className="min-w-0" aria-describedby={deliveryError ? `${id}-delivery-error` : undefined}>
        <legend className={labelClass}>Delivery method</legend>
        <div className="mt-1.5 space-y-1.5">
          {DELIVERY_METHODS.map((method) => (
            <label key={method} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-sm border border-light-gray px-3 text-sm has-[:checked]:border-brand-primary has-[:disabled]:cursor-not-allowed">
              <input
                type="radio"
                name={`${id}-delivery`}
                value={method}
                checked={deliveryMethod === method}
                disabled={disabled}
                onChange={() => onDelivery(method)}
                className="h-4 w-4 shrink-0 accent-brand-primary"
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">{DELIVERY_LABELS[method]}</span>
            </label>
          ))}
        </div>
        <FieldError id={`${id}-delivery-error`} message={deliveryError} />
      </fieldset>
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
        <p className={labelClass}>Coupon</p>
        <div className="mt-1.5 flex items-center justify-between gap-3 rounded-sm border border-light-gray bg-off-white px-3 py-2">
          <p className="min-w-0 text-xs text-charcoal">
            <span className="font-mono font-bold text-brand-primary">{couponCode}</span>
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
      <label htmlFor={`${id}-coupon`} className={labelClass}>Coupon code (optional)</label>
      <div className="mt-1.5 flex gap-2">
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
          className={`flex-1 uppercase ${fieldClass}`}
        />
        <button type="submit" disabled={disabled || !draft.trim()} className={secondaryButtonClass}>Apply</button>
      </div>
      <FieldError id={`${id}-coupon-error`} message={invalid ? "Enter 3–40 letters, numbers, hyphens or underscores." : null} />
    </form>
  );
}

function TotalRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${strong ? "border-t border-light-gray pt-3 text-base font-semibold text-brand-primary" : ""}`}>
      <dt className={strong ? "" : "text-gray-600"}>{label}</dt>
      <dd className={strong ? "font-display text-lg" : "text-charcoal"}>{value}</dd>
    </div>
  );
}

/** Server totals: VAT and delivery stay separate lines, nothing is added up in the browser. */
export function QuoteTotals({ quote }: { quote: Quote }) {
  return (
    <dl className="space-y-2.5 text-sm">
      <TotalRow label="Items subtotal" value={formatKES(quote.subtotal)} />
      {quote.discount > 0 && (
        <>
          <TotalRow label={quote.couponApplied ? `Savings (incl. coupon ${quote.couponCode})` : "Savings"} value={`−${formatKES(quote.discount)}`} />
          <TotalRow label="Subtotal after savings" value={formatKES(quote.discountedSubtotal)} />
        </>
      )}
      <TotalRow label={`VAT (${quote.vatRate}%)`} value={formatKES(quote.tax)} />
      <TotalRow label={DELIVERY_LABELS[quote.deliveryMethod]} value={formatKES(quote.shippingCost)} />
      <TotalRow label="Total" value={formatKES(quote.total)} strong />
    </dl>
  );
}

/**
 * Totals panel for the current request: why nothing is quoted yet, progress, errors, expiry and the
 * server's totals. A previous quote is never presented as current while a new one is loading.
 */
export function QuoteSummary({ blocker, quote, onRefreshAvailability }: {
  blocker: string | null;
  quote: CheckoutQuote;
  onRefreshAvailability: () => void;
}) {
  if (blocker) return <p role="status" className="rounded-md bg-off-white p-3 text-xs font-semibold text-charcoal">{blocker}</p>;
  if (quote.status === "idle") return null;
  if (quote.status === "loading") {
    return (
      <p role="status" className="flex items-center gap-2 rounded-md bg-off-white p-3 text-xs text-charcoal">
        <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-brand-secondary border-t-transparent" />
        Calculating your total with current prices…
      </p>
    );
  }
  if (quote.error) {
    const choice = Object.values(CHOICE_ERRORS).some((code) => code === quote.error?.code);
    const stock = STOCK_ERRORS.includes(quote.error.code ?? "");
    return (
      <div role="alert" className="rounded-md border border-error/30 bg-error/5 p-3 text-xs text-charcoal">
        <p className="font-semibold text-error">{choice ? "Your total can't be calculated until the highlighted choice is changed." : quote.error.message}</p>
        {stock && <p className="mt-1">Reduce or remove that item, then check again.</p>}
        <button type="button" onClick={stock ? onRefreshAvailability : quote.refresh} className="mt-2 font-bold text-brand-primary underline underline-offset-4">
          {stock ? "Refresh availability" : "Try again"}
        </button>
      </div>
    );
  }
  if (!quote.quote) return null;
  return (
    <div className="space-y-3">
      <QuoteTotals quote={quote.quote} />
      {quote.expired ? (
        <div role="alert" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-charcoal">
          <p className="font-semibold">These prices expired at {formatDateTime(quote.quote.expiresAt)}.</p>
          <button type="button" onClick={quote.refresh} className="mt-1 font-bold text-brand-primary underline underline-offset-4">Refresh prices</button>
        </div>
      ) : (
        <p className="text-[11px] text-gray-600">Prices held until {formatDateTime(quote.quote.expiresAt)}.</p>
      )}
      {quote.quote.mode === "demo" && (
        <p role="note" className="rounded-md border border-ocean-blue/30 bg-ocean-blue/10 p-2.5 text-[11px] text-ocean-blue-dark">
          Demo quote: these are sample products in a development store, not a real purchase.
        </p>
      )}
    </div>
  );
}

/** Lines exactly as the server priced them. */
export function QuoteLines({ quote }: { quote: Quote }) {
  return (
    <ul className="divide-y divide-light-gray">
      {quote.lines.map((line) => {
        const options = describeVariant(line);
        return (
          <li key={line.variantId} className="flex flex-wrap gap-3 py-3 first:pt-0 last:pb-0">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-warm-beige">
              {line.productImage && <img src={line.productImage} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1 basis-40 [overflow-wrap:anywhere]">
              <p className="text-sm font-medium text-brand-primary">{line.productName}</p>
              {options && <p className="mt-0.5 text-[11px] text-gray-600">{options}</p>}
              <p className="mt-0.5 text-[11px] text-gray-600">Qty {line.quantity} · {formatKES(line.unitPrice)} each</p>
              {line.discount > 0 && <p className="mt-0.5 text-[11px] font-semibold text-success">Saving {formatKES(line.discount)}</p>}
            </div>
            <p className="ml-auto max-w-full text-sm font-semibold text-brand-primary">{formatKES(line.total)}</p>
          </li>
        );
      })}
    </ul>
  );
}

function Notice({ tone, role, title, children }: { tone: "info" | "warning" | "error"; role: "status" | "alert"; title?: string; children: ReactNode }) {
  const tones = {
    info: "border-ocean-blue/30 bg-ocean-blue/10 text-ocean-blue-dark",
    warning: "border-warning/40 bg-warning/10 text-charcoal",
    error: "border-error/30 bg-error/5 text-charcoal",
  };
  return (
    <div role={role} className={`rounded-md border p-4 text-sm ${tones[tone]}`}>
      {title && <p className="font-semibold text-brand-primary">{title}</p>}
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

/** A real pending order from the server: number, unpaid status and how long the items are held. */
export function PlacedOrderPanel({ order, remainingItems }: { order: Order; remainingItems: number }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const unpaid = order.paymentStatus === "PENDING";
  return (
    <section aria-labelledby="order-placed-title" className="mx-auto mt-8 max-w-xl rounded-lg bg-white p-6 shadow-sm sm:p-8">
      <h1 id="order-placed-title" ref={heading} tabIndex={-1} className="font-display text-2xl text-brand-primary">Order reserved</h1>
      <dl className="mt-5 space-y-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><dt className="text-gray-600">Order number</dt><dd className="font-mono font-bold text-brand-primary">{order.orderNumber}</dd></div>
        <div className="flex flex-wrap justify-between gap-2"><dt className="text-gray-600">Status</dt><dd className="font-semibold">{unpaid ? "Pending · not paid" : `Payment ${order.paymentStatus.toLowerCase()}`}</dd></div>
        <div className="flex flex-wrap justify-between gap-2"><dt className="text-gray-600">Order total</dt><dd>{formatKES(order.total)}</dd></div>
        {order.reservationStatus === "HELD" && order.reservationExpiresAt && (
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-gray-600">Items held until</dt><dd className="font-semibold">{formatDateTime(order.reservationExpiresAt)}</dd></div>
        )}
      </dl>
      <p className="mt-5 text-sm text-charcoal">
        No payment has been taken. Online payment is not available yet; if the order is not paid while your items are held,
        the hold ends and they are released. You can review or cancel this order in your order history.
      </p>
      {remainingItems > 0 && (
        <p className="mt-3 text-sm text-charcoal">
          Your cart still has {remainingItems} {remainingItems === 1 ? "item" : "items"} that were not part of this order.
        </p>
      )}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link to="/account/orders" className="flex-1 rounded-sm bg-brand-primary px-5 py-3 text-center text-xs font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary">
          View or cancel in your orders
        </Link>
        <Link to={remainingItems > 0 ? "/cart" : "/shop"} className="flex-1 rounded-sm border border-light-gray px-5 py-3 text-center text-xs font-bold uppercase tracking-wider text-brand-primary hover:border-brand-primary">
          {remainingItems > 0 ? "Back to Cart" : "Continue Shopping"}
        </Link>
      </div>
    </section>
  );
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
        <Link to="/account/orders" className="font-bold text-brand-primary underline underline-offset-4">View or cancel it in your orders</Link>
      </p>
    </Notice>
  );
}
