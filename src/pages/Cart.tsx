import type { ReactNode } from "react";
import { CartEstimateSummary, CartLines, useCartUndo, type CartUndo } from "../components/CartLines";
import {
  CART_BLOCKERS,
  CouponField,
  DeliveryChoices,
  PlacedNotice,
  QuoteSummary,
  SubmissionNotice,
  primaryActionClass,
} from "../components/checkout";
import { Breadcrumb, Container, DemoCatalogNotice, ErrorPanel, LoadingPanel } from "../components/ui";
import { useAuth, type User } from "../contexts/AuthContext";
import { Link } from "../router";
import { useCatalog } from "../store/CatalogContext";
import { cartEstimate, cartLineViews } from "../store/cartModel";
import { quoteRequestFor, reviewCart } from "../store/checkoutModel";
import { CHECKOUT_REGISTER, CHECKOUT_SIGN_IN } from "../store/returnTo";
import { useStore } from "../store/StoreContext";
import { useCheckoutChoices } from "../store/useCheckoutChoices";
import { useCheckoutQuote } from "../store/useCheckoutQuote";
import { useOrderSubmission } from "../store/useOrderSubmission";

const CRUMBS = [{ label: "Cart" }];
const summaryTitle = "text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary";

export default function Cart() {
  const { user } = useAuth();
  const { ownerReady } = useStore();
  const catalog = useCatalog();
  // During a sign-in change (or while a guest cart is merging) the cart shown would be the wrong owner's: wait.
  if (!ownerReady) {
    return (
      <Container className="py-8">
        <Breadcrumb items={CRUMBS} />
        <div className="mt-8">
          {catalog.status === "error"
            ? <ErrorPanel title="Cart prices are unavailable" message={`${catalog.error ?? "The catalog could not be loaded."} Your cart is unchanged.`} onRetry={catalog.reload} />
            : <LoadingPanel label="Loading your cart…" />}
        </div>
      </Container>
    );
  }
  // Keyed by account: nothing from a previous customer's quote or request survives a switch.
  return user ? <CartContent key={user.id} user={user} /> : <GuestCart />;
}

/** The page frame: heading, item count, notices, then the lines beside the summary from 768px. */
function CartFrame({ count, notices, lines, summary }: { count: number; notices?: ReactNode; lines: ReactNode; summary: ReactNode }) {
  return (
    <Container className="py-8">
      <Breadcrumb items={CRUMBS} />
      <h1 className="type-h1 mt-5 text-navy-900">Your cart</h1>
      <p className="mt-1 text-sm text-muted">{count} {count === 1 ? "item" : "items"}</p>
      <div className="mt-4 space-y-3">
        <DemoCatalogNotice />
        {notices}
      </div>
      <div className="mt-6 grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_300px] lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-8">
        <div className="min-w-0 rounded-lg bg-white px-4 shadow-sm sm:px-5">{lines}</div>
        {summary}
      </div>
    </Container>
  );
}

function EmptyCart({ notices, undo }: { notices?: ReactNode; undo: CartUndo }) {
  return (
    <Container className="py-8">
      <Breadcrumb items={CRUMBS} />
      {notices && <div className="mt-6 space-y-3">{notices}</div>}
      <div className="mt-6 rounded-lg bg-white p-10 text-center shadow-sm sm:p-16">
        <h1 className="font-display text-xl text-brand-primary">Your cart is empty</h1>
        <p className="mt-1 text-sm text-gray-500">Browse the shop and find something you love.</p>
        {undo.removal && <div className="mx-auto mt-4 max-w-md text-left"><CartLines views={[]} undo={undo} label="Cart items" /></div>}
        <Link to="/shop" className="mt-6 inline-flex min-h-[44px] items-center rounded-sm bg-brand-primary px-8 text-xs font-bold uppercase tracking-[0.12em] text-white hover:bg-brand-secondary hover:text-brand-primary">
          Start Shopping
        </Link>
      </div>
    </Container>
  );
}

function CatalogPending() {
  const catalog = useCatalog();
  return (
    <Container className="py-8">
      <Breadcrumb items={CRUMBS} />
      <div className="mt-8">
        {catalog.status === "loading"
          ? <LoadingPanel label="Loading current prices for your cart…" />
          : <ErrorPanel title="Cart prices are unavailable" message={`${catalog.error ?? "The catalog could not be loaded."} Your cart is unchanged.`} onRetry={catalog.reload} />}
      </div>
    </Container>
  );
}

/** A guest's cart: editing, Undo and an estimated subtotal; checkout starts with signing in, which keeps the cart. */
function GuestCart() {
  const { state, cartCount } = useStore();
  const catalog = useCatalog();
  const undo = useCartUndo();
  if (state.cart.length === 0) return <EmptyCart undo={undo} />;
  if (catalog.status !== "ready") return <CatalogPending />;
  const views = cartLineViews(state.cart, catalog.productsById);
  return (
    <CartFrame
      count={cartCount}
      lines={<CartLines views={views} undo={undo} label="Cart items" />}
      summary={(
        <section aria-labelledby="cart-summary-title" className="space-y-4 rounded-lg bg-white p-5 shadow-sm sm:p-6">
          <h2 id="cart-summary-title" className={summaryTitle}>Order Summary</h2>
          <CartEstimateSummary estimate={cartEstimate(views)} pendingFees />
          <Link to={CHECKOUT_SIGN_IN} className={`flex min-h-[44px] items-center justify-center ${primaryActionClass}`}>Sign in to check out</Link>
          <p className="text-center text-sm text-navy-800">
            New here? <Link to={CHECKOUT_REGISTER} className="inline-flex min-h-[44px] items-center font-semibold text-link underline underline-offset-4 hover:text-link-hover">Create an account</Link>
          </p>
          <p className="text-center text-xs text-muted">Your cart comes with you when you sign in.</p>
          <Link to="/shop" className="flex min-h-[44px] items-center justify-center text-sm text-gray-600 underline-offset-4 hover:text-brand-primary hover:underline">
            Continue Shopping
          </Link>
        </section>
      )}
    />
  );
}

function CartContent({ user }: { user: User }) {
  const { state, cartCount } = useStore();
  const catalog = useCatalog();
  const choices = useCheckoutChoices(user);
  const submission = useOrderSubmission();
  const undo = useCartUndo();
  const review = reviewCart(state.cart, catalog.productsById);
  const settling = submission.state.status === "resolving" || submission.state.status === "unresolved";
  const blocker = settling ? CART_BLOCKERS.settling : review.blocker ? CART_BLOCKERS[review.blocker] : null;
  // Never quote during the render where the cart still belongs to the previous account.
  const quotable = submission.ownerReady && catalog.status === "ready" && state.cart.length > 0 && blocker === null;
  const quote = useCheckoutQuote(quotable && choices.address
    ? quoteRequestFor(state.cart, { addressId: choices.address.id, deliveryMethod: choices.deliveryMethod, couponCode: choices.couponCode })
    : null);

  const notices = (
    <>
      {submission.state.status === "placed" && <PlacedNotice order={submission.state.order} />}
      <SubmissionNotice
        state={submission.state}
        actions={<Link to="/checkout" className="font-bold text-brand-primary underline underline-offset-4">Finish it at checkout</Link>}
      />
    </>
  );

  if (state.cart.length === 0) return <EmptyCart notices={notices} undo={undo} />;
  if (catalog.status !== "ready") return <CatalogPending />;

  const views = cartLineViews(state.cart, catalog.productsById);
  const current = quote.quote;
  // One idea of the subtotal at a time: the browser's estimate only until the server's figures are current.
  const quoted = current !== null && !quote.expired;
  // Without a saved address there is nothing to quote yet: checkout's Delivery step takes the first address.
  const needsAddress = choices.address === null && blocker === null;
  const canContinue = (quoted && current.reservationsEnabled) || needsAddress;
  let unavailableReason = "Your total must be calculated before checkout.";
  if (current && !current.reservationsEnabled) unavailableReason = "Ordering is not available yet, so no order can be placed. Your cart is saved.";
  else if (current && quote.expired) unavailableReason = "Refresh prices to continue.";
  const choicesDisabled = settling;

  return (
    <CartFrame
      count={cartCount}
      notices={notices}
      lines={<CartLines views={views} undo={undo} label="Cart items" />}
      summary={(
        <section aria-labelledby="cart-summary-title" className="rounded-lg bg-white p-5 shadow-sm sm:p-6">
          <h2 id="cart-summary-title" className={summaryTitle}>Order Summary</h2>
          <div className="mt-4 space-y-5">
            {!quoted && <CartEstimateSummary estimate={cartEstimate(views)} pendingFees={false} />}
            <DeliveryChoices
              addresses={choices.addresses}
              address={choices.address}
              deliveryMethod={choices.deliveryMethod}
              disabled={choicesDisabled}
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
              disabled={choicesDisabled}
              onApply={choices.applyCoupon}
              onRemove={choices.removeCoupon}
            />
            <QuoteSummary blocker={blocker} quote={quote} onRefreshAvailability={catalog.reload} />
          </div>

          {canContinue ? (
            <Link to="/checkout" className={`mt-5 ${primaryActionClass}`}>Continue to Checkout</Link>
          ) : (
            <>
              <button type="button" disabled aria-describedby="checkout-unavailable" className={`mt-5 ${primaryActionClass}`}>
                Continue to Checkout
              </button>
              <p id="checkout-unavailable" className="mt-2 text-center text-xs text-charcoal">{unavailableReason}</p>
            </>
          )}
          <Link to="/shop" className="mt-3 block text-center text-[11px] text-gray-600 underline-offset-4 hover:text-brand-primary hover:underline">
            Continue Shopping
          </Link>
        </section>
      )}
    />
  );
}
