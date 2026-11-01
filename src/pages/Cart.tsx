import {
  CART_BLOCKERS,
  CouponField,
  DeliveryChoices,
  PlacedNotice,
  QuoteSummary,
  SubmissionNotice,
  primaryActionClass,
} from "../components/checkout";
import { Breadcrumb, Container, DemoBadge, DemoCatalogNotice, ErrorPanel, LoadingPanel, ProductImage } from "../components/ui";
import { useAuth, type User } from "../contexts/AuthContext";
import { Link } from "../router";
import { useCatalog } from "../store/CatalogContext";
import { describeVariant, variantPriceView } from "../store/catalogModel";
import { quoteRequestFor, reviewCart } from "../store/checkoutModel";
import { useStore } from "../store/StoreContext";
import { useCheckoutChoices } from "../store/useCheckoutChoices";
import { useCheckoutQuote } from "../store/useCheckoutQuote";
import { useOrderSubmission } from "../store/useOrderSubmission";
import { formatKES } from "../utils/format";

export default function Cart() {
  const { user } = useAuth();
  if (!user) {
    return (
      <Container className="py-16">
        <Breadcrumb items={[{ label: "Cart" }]} />
        <div className="mx-auto mt-8 max-w-xl rounded-lg bg-white p-8 text-center shadow-sm">
          <h1 className="font-display text-2xl text-brand-primary">Sign in to use your cart</h1>
          <p className="mt-2 text-sm text-gray-500">You can browse products freely, but saving cart items requires an account.</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link to="/login" className="flex-1 rounded-sm bg-brand-primary py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary">Sign In</Link>
            <Link to="/register" className="flex-1 rounded-sm border border-brand-primary py-3 text-xs font-bold uppercase tracking-wider text-brand-primary hover:bg-brand-primary hover:text-white">Create Account</Link>
          </div>
        </div>
      </Container>
    );
  }
  // Keyed by account: nothing from a previous customer's quote or request survives a switch.
  return <CartContent key={user.id} user={user} />;
}

function CartContent({ user }: { user: User }) {
  const { state, removeFromCart, setQuantity, cartCount } = useStore();
  const catalog = useCatalog();
  const choices = useCheckoutChoices(user);
  const submission = useOrderSubmission();
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

  if (state.cart.length === 0) {
    return (
      <Container className="py-8">
        <Breadcrumb items={[{ label: "Cart" }]} />
        <div className="mt-6 space-y-3">{notices}</div>
        <div className="mt-6 rounded-lg bg-white p-10 text-center shadow-sm sm:p-16">
          <h1 className="font-display text-xl text-brand-primary">Your cart is empty</h1>
          <p className="mt-1 text-sm text-gray-500">Browse the shop and find something you love.</p>
          <Link to="/shop" className="mt-6 inline-block rounded-sm bg-brand-primary px-8 py-3 text-xs font-bold uppercase tracking-[0.12em] text-white hover:bg-brand-secondary hover:text-brand-primary">
            Start Shopping
          </Link>
        </div>
      </Container>
    );
  }

  if (catalog.status !== "ready") {
    return (
      <Container className="py-8">
        <Breadcrumb items={[{ label: "Cart" }]} />
        <div className="mt-8">
          {catalog.status === "loading"
            ? <LoadingPanel label="Loading current prices for your cart…" />
            : <ErrorPanel title="Cart prices are unavailable" message={`${catalog.error ?? "The catalog could not be loaded."} Your cart is unchanged.`} onRetry={catalog.reload} />}
        </div>
      </Container>
    );
  }

  const current = quote.quote;
  const quotedLines = new Map(current?.lines.map((line) => [line.variantId, line]) ?? []);
  const canContinue = current !== null && !quote.expired && current.reservationsEnabled;
  let unavailableReason = "Your total must be calculated before checkout.";
  if (current && !current.reservationsEnabled) unavailableReason = "Ordering is not available yet, so no order can be placed. Your cart is saved.";
  else if (current && quote.expired) unavailableReason = "Refresh prices to continue.";
  const choicesDisabled = settling;

  return (
    <Container className="py-8">
      <Breadcrumb items={[{ label: "Cart" }]} />
      <h1 className="mt-5 font-display text-2xl uppercase tracking-wider text-brand-primary">Shopping Cart</h1>
      <p className="mt-1 text-xs text-gray-500">{cartCount} {cartCount === 1 ? "item" : "items"}</p>
      <div className="mt-4 space-y-3">
        <DemoCatalogNotice />
        {notices}
      </div>

      <div className="mt-6 grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_300px] lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-8">
        <ul aria-label="Cart items" className="divide-y divide-light-gray rounded-lg bg-white shadow-sm">
          {review.lines.map(({ line, index, product, variant, problem }) => {
            if (!product || !variant) {
              return (
                <li key={`${index}:${line.variantId}`} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-brand-primary">This item is no longer available</p>
                    <p className="mt-0.5 text-xs text-gray-500">It was removed from the catalog or its options changed. Remove it to continue.</p>
                  </div>
                  <button type="button" onClick={() => removeFromCart(index)} className="shrink-0 rounded-sm border border-error/40 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-error hover:bg-error hover:text-white">
                    Remove
                  </button>
                </li>
              );
            }
            const projected = variantPriceView(variant);
            const quoted = quotedLines.get(line.variantId);
            const stock = Math.max(0, variant.stock);
            const options = describeVariant(variant);
            return (
              <li key={`${index}:${line.variantId}`} className="flex gap-3 p-4 sm:gap-4">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-warm-beige sm:h-20 sm:w-20">
                  <ProductImage product={product} />
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link to={`/product/${encodeURIComponent(product.id)}`} className="text-sm font-medium text-brand-primary hover:text-brand-secondary">
                        {product.name}
                      </Link>
                      {product.isDemo && <DemoBadge className="ml-2 align-middle" />}
                    </div>
                    <button type="button" aria-label={`Remove ${product.name} from cart`} onClick={() => removeFromCart(index)} className="-m-2 shrink-0 p-2 text-gray-500 hover:text-error">
                      <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                  {options && <p className="mt-0.5 text-[11px] text-gray-500">{options}</p>}
                  {problem === "out-of-stock" ? (
                    <p className="mt-1 text-[11px] font-semibold text-error">Out of stock: this item cannot currently be ordered.</p>
                  ) : problem === "over-stock" ? (
                    <p className="mt-1 text-[11px] font-semibold text-warning">Only {stock} available. Reduce the quantity to continue.</p>
                  ) : null}
                  <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-2">
                    <div className="flex items-center rounded-sm border border-light-gray">
                      <button type="button" aria-label={`Decrease quantity of ${product.name}`} disabled={line.quantity <= 1} onClick={() => setQuantity(index, line.quantity - 1)} className="h-9 w-9 text-sm text-gray-600 disabled:opacity-40">−</button>
                      <span aria-live="polite" className="w-8 text-center text-xs">{line.quantity}</span>
                      <button type="button" aria-label={`Increase quantity of ${product.name}`} disabled={line.quantity >= stock} onClick={() => setQuantity(index, line.quantity + 1)} className="h-9 w-9 text-sm text-gray-600 disabled:opacity-40">+</button>
                    </div>
                    <p className="text-right">
                      <span className="block text-[11px] text-gray-600">
                        {!quoted && projected.comparePrice !== null && <span className="mr-1 line-through">{formatKES(projected.comparePrice)}</span>}
                        {formatKES(quoted ? quoted.unitPrice : projected.price)} each
                      </span>
                      {quoted && <span className="font-display text-base text-brand-primary">{formatKES(quoted.total)}</span>}
                      {quoted && quoted.discount > 0 && <span className="block text-[11px] font-semibold text-success">Saving {formatKES(quoted.discount)}</span>}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <section aria-labelledby="cart-summary-title" className="rounded-lg bg-white p-5 shadow-sm sm:p-6">
          <h2 id="cart-summary-title" className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Order Summary</h2>
          <div className="mt-4 space-y-5">
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
      </div>
    </Container>
  );
}
