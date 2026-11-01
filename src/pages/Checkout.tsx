import { useState, type ReactNode } from "react";
import {
  CART_BLOCKERS,
  CouponField,
  DeliveryChoices,
  PlacedOrderPanel,
  QuoteLines,
  QuoteSummary,
  SubmissionNotice,
  primaryActionClass,
} from "../components/checkout";
import { Breadcrumb, Container, DemoCatalogNotice, ErrorPanel, LoadingPanel } from "../components/ui";
import { useAuth, type User } from "../contexts/AuthContext";
import { Link } from "../router";
import { useCatalog } from "../store/CatalogContext";
import { describeVariant } from "../store/catalogModel";
import { quoteRequestFor, reviewCart, samePricing } from "../store/checkoutModel";
import { useStore } from "../store/StoreContext";
import { useCheckoutChoices } from "../store/useCheckoutChoices";
import { useCheckoutQuote } from "../store/useCheckoutQuote";
import { useOrderSubmission, type SubmissionState } from "../store/useOrderSubmission";
import { formatKES } from "../utils/format";

const CRUMBS = [{ label: "Cart", to: "/cart" }, { label: "Checkout" }];
const secondaryLinkClass = "flex-1 rounded-sm border border-light-gray px-5 py-3 text-center text-xs font-bold uppercase tracking-wider text-brand-primary hover:border-brand-primary";
const primaryLinkClass = "flex-1 rounded-sm bg-brand-primary px-5 py-3 text-center text-xs font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary";

function CenteredPanel({ title, children, before }: { title: string; children: ReactNode; before?: ReactNode }) {
  return (
    <Container className="py-8">
      <Breadcrumb items={CRUMBS} />
      {before && <div className="mx-auto mt-6 max-w-xl space-y-3">{before}</div>}
      <section aria-labelledby="checkout-title" className="mx-auto mt-6 max-w-xl rounded-lg bg-white p-6 text-center shadow-sm sm:p-8">
        <h1 id="checkout-title" className="font-display text-2xl text-brand-primary">{title}</h1>
        {children}
      </section>
    </Container>
  );
}

function EmptyCheckout({ before }: { before?: ReactNode }) {
  return (
    <CenteredPanel title="Your cart is empty" before={before}>
      <Link to="/shop" className="mt-6 inline-block rounded-sm bg-brand-primary px-6 py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary">
        Go Shopping
      </Link>
    </CenteredPanel>
  );
}

export default function Checkout() {
  const { user } = useAuth();
  const { state } = useStore();
  if (!user) {
    if (!state.cart.length) return <EmptyCheckout />;
    return (
      <CenteredPanel title="Sign in to check out">
        <p className="mt-3 text-sm text-charcoal">Orders are placed from your account so you can follow and cancel them.</p>
        <Link to="/login" className={`mt-6 inline-block ${primaryLinkClass}`}>Sign In</Link>
      </CenteredPanel>
    );
  }
  // Keyed by account: a previous customer's quote, request or outcome never reaches the next one.
  return <CheckoutContent key={user.id} user={user} />;
}

function CheckoutContent({ user }: { user: User }) {
  const { state, cartCount } = useStore();
  const catalog = useCatalog();
  const choices = useCheckoutChoices(user);
  const submission = useOrderSubmission();
  /** The quote the customer explicitly accepted and the rejection that acceptance answered. */
  const [reviewed, setReviewed] = useState<{ quoteId: string; rejection: SubmissionState | null } | null>(null);
  const status = submission.state.status;
  // A stored request is settled (or re-sent with its own key) before anything new can be reviewed.
  const settling = status === "resolving" || status === "unresolved" ||
    (submission.state.status === "sending" && submission.state.retry);
  const review = reviewCart(state.cart, catalog.productsById);
  const blocker = review.blocker ? CART_BLOCKERS[review.blocker] : null;
  // Never quote or reserve during the render where the cart still belongs to the previous account.
  const quotable = submission.ownerReady && !settling && status !== "placed" &&
    catalog.status === "ready" && state.cart.length > 0 && blocker === null;
  const quote = useCheckoutQuote(quotable && choices.address
    ? quoteRequestFor(state.cart, { addressId: choices.address.id, deliveryMethod: choices.deliveryMethod, couponCode: choices.couponCode })
    : null);

  if (submission.state.status === "placed") {
    return (
      <Container className="py-8">
        <Breadcrumb items={CRUMBS} />
        <PlacedOrderPanel order={submission.state.order} remainingItems={cartCount} />
      </Container>
    );
  }

  if (settling) {
    // The actions stay mounted (and focused) while a check or retry runs; clicks are ignored until it ends.
    const busy = status !== "unresolved";
    const actionClass = "rounded-sm px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
    return (
      <CenteredPanel title="Finishing your earlier order request">
        <div className="mt-4 text-left"><SubmissionNotice state={submission.state} /></div>
        {submission.intent && (
          <p className="mt-4 text-sm text-charcoal">
            The order you reviewed totalled {formatKES(submission.intent.total)}. Retrying sends that same request again,
            so it can create at most one order.
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button type="button" aria-disabled={busy} onClick={() => { if (!busy) void submission.retry(); }} className={`${actionClass} bg-brand-primary text-white hover:bg-brand-secondary hover:text-brand-primary`}>
            Retry the same request
          </button>
          <button type="button" aria-disabled={busy} onClick={() => { if (!busy) void submission.checkAgain(); }} className={`${actionClass} border border-brand-primary text-brand-primary hover:bg-brand-primary hover:text-white`}>
            Check again
          </button>
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link to="/account/orders" className={secondaryLinkClass}>View Your Orders</Link>
          <Link to="/cart" className={secondaryLinkClass}>Back to Cart</Link>
        </div>
      </CenteredPanel>
    );
  }

  const notice = <SubmissionNotice state={submission.state} />;
  if (state.cart.length === 0) return <EmptyCheckout before={notice} />;

  if (catalog.status !== "ready") {
    return (
      <Container className="py-8">
        <Breadcrumb items={CRUMBS} />
        <div className="mt-8">
          {catalog.status === "loading"
            ? <LoadingPanel label="Loading current prices…" />
            : <ErrorPanel title="Checkout is unavailable" message={`${catalog.error ?? "The catalog could not be loaded."} Your cart is unchanged.`} onRetry={catalog.reload} />}
        </div>
      </Container>
    );
  }

  const current = quote.quote;
  if (current && !current.reservationsEnabled) {
    return (
      <CenteredPanel title="Ordering is not available yet" before={notice}>
        <p role="status" className="mt-4 text-sm leading-relaxed text-charcoal">
          Orders cannot be placed right now, so nothing has been reserved or charged. Your cart is unchanged.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link to="/cart" className={primaryLinkClass}>Back to Cart</Link>
          <Link to="/shop" className={secondaryLinkClass}>Continue Shopping</Link>
        </div>
      </CenteredPanel>
    );
  }

  // A definite rejection or a changed refresh needs explicit review of the new quote before reserving.
  const rejection = submission.state.status === "rejected" && submission.state.signature === quote.signature &&
    submission.state !== reviewed?.rejection ? submission.state : null;
  const repriced = current && quote.replaced && !samePricing(quote.replaced, current) ? quote.replaced : null;
  const previousTotal = rejection?.previousTotal ?? repriced?.total ?? null;
  const reviewNeeded = current !== null && previousTotal !== null && current.id !== reviewed?.quoteId;
  const sending = status === "sending";
  const canReserve = submission.ownerReady && current !== null && quote.signature !== null && !quote.expired &&
    !sending && !state.pendingOrder && !reviewNeeded;

  const reserve = () => {
    if (!current || quote.signature === null || !canReserve) return;
    void submission.submit(current, quote.signature).then((outcome) => {
      // The reviewed quote was refused: show a new one rather than the refused total.
      if (outcome?.status === "rejected") quote.refresh();
    });
  };

  return (
    <Container className="py-8">
      <Breadcrumb items={CRUMBS} />
      <h1 className="mt-5 font-display text-2xl uppercase tracking-wider text-brand-primary">Review and Reserve</h1>
      <div className="mt-4 space-y-3">
        <DemoCatalogNotice />
        {notice}
      </div>

      <div className="mt-6 grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_300px] lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-8">
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="checkout-items-title" className="rounded-lg bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="checkout-items-title" className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Items</h2>
              <Link to="/cart" className="text-[11px] font-bold uppercase tracking-wider text-brand-primary underline-offset-4 hover:underline">Edit Cart</Link>
            </div>
            <div className="mt-4">
              {current ? <QuoteLines quote={current} /> : (
                <ul className="divide-y divide-light-gray">
                  {review.lines.map(({ line, index, product, variant }) => (
                    <li key={`${index}:${line.variantId}`} className="py-3 text-sm first:pt-0 last:pb-0">
                      <p className="font-medium text-brand-primary">{product?.name ?? "Unavailable item"}</p>
                      <p className="mt-0.5 text-[11px] text-gray-600">
                        Qty {line.quantity}{variant && describeVariant(variant) ? ` · ${describeVariant(variant)}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section aria-labelledby="checkout-delivery-title" className="rounded-lg bg-white p-5 shadow-sm sm:p-6">
            <h2 id="checkout-delivery-title" className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Delivery and Coupon</h2>
            <div className="mt-4 space-y-5">
              <DeliveryChoices
                addresses={choices.addresses}
                address={choices.address}
                deliveryMethod={choices.deliveryMethod}
                disabled={sending}
                errorCode={quote.error?.code}
                errorMessage={quote.error?.message}
                onAddress={choices.chooseAddress}
                onDelivery={choices.chooseDelivery}
              />
              <CouponField
                couponCode={choices.couponCode}
                quote={current}
                errorCode={quote.error?.code}
                errorMessage={quote.error?.message}
                disabled={sending}
                onApply={choices.applyCoupon}
                onRemove={choices.removeCoupon}
              />
            </div>
          </section>
        </div>

        <section aria-labelledby="checkout-summary-title" className="rounded-lg bg-white p-5 shadow-sm sm:p-6">
          <h2 id="checkout-summary-title" className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Order Total</h2>
          <div className="mt-4">
            <QuoteSummary blocker={blocker} quote={quote} onRefreshAvailability={catalog.reload} />
          </div>
          {reviewNeeded && current && previousTotal !== null && (
            <div role="alert" className="mt-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-charcoal">
              <p className="font-semibold text-brand-primary">Review the updated total</p>
              <p className="mt-1">
                {previousTotal === current.total
                  ? `Your total is still ${formatKES(current.total)} after checking prices again.`
                  : `Your total changed from ${formatKES(previousTotal)} to ${formatKES(current.total)}.`}{" "}
                Check the items, delivery and VAT before reserving.
              </p>
              <button type="button" onClick={() => setReviewed({ quoteId: current.id, rejection })} className="mt-3 w-full rounded-sm border border-brand-primary px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-primary hover:bg-brand-primary hover:text-white">
                I Have Reviewed the New Total
              </button>
            </div>
          )}
          <button type="button" onClick={reserve} disabled={!canReserve} aria-describedby="reserve-help" className={`mt-5 ${primaryActionClass}`}>
            {sending ? "Reserving…" : "Reserve Order"}
          </button>
          <p id="reserve-help" className="mt-2 text-xs text-charcoal">
            Creates an unpaid order and holds these items for a limited time. No payment is taken on this page.
          </p>
        </section>
      </div>
    </Container>
  );
}
