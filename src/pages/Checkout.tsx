import { isCancel } from "axios";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Address } from "../api/auth";
import { apiErrorCode, apiStatus, describeApiError } from "../api/errors";
import { checkoutAPI, type Order } from "../api/orders";
import { AddressForm, fieldLabelClass } from "../components/AddressForm";
import { ReviewLines } from "../components/CartLines";
import {
  CART_BLOCKERS,
  CHOICE_ERRORS,
  CouponField,
  DeliveryMethodChoices,
  Notice,
  QuoteSummary,
  SubmissionNotice,
  formatAddress,
  primaryActionClass,
  secondaryActionClass,
  textLinkClass,
} from "../components/checkout";
import { PaymentStep } from "../components/CheckoutPayment";
import { CheckoutProgress } from "../components/CheckoutProgress";
import { CheckoutSummary, type SummaryLine } from "../components/CheckoutSummary";
import { Breadcrumb, Container, DemoCatalogNotice, ErrorPanel, LoadingPanel } from "../components/ui";
import { useAuth, type User } from "../contexts/AuthContext";
import { Link, navigate, useRouteState } from "../router";
import { EMPTY_ADDRESS, clearAddressDraft, readAddressDraft, saveAddressDraft } from "../store/addressModel";
import { useCatalog } from "../store/CatalogContext";
import { cartEstimate, cartLineViews, type CartLineView } from "../store/cartModel";
import { describeVariant } from "../store/catalogModel";
import { CheckoutFormatError, DELIVERY_LABELS, parseOrder, quoteRequestFor, reviewCart, samePricing } from "../store/checkoutModel";
import { checkoutRoute, checkoutSteps, parseCheckoutRoute, type CheckoutStep, type StepView } from "../store/checkoutSteps";
import { pendingReason, type CheckoutFigures } from "../store/checkoutSummary";
import { CHECKOUT_REGISTER, CHECKOUT_SIGN_IN } from "../store/returnTo";
import { useStore, type CartLine } from "../store/StoreContext";
import { useCheckoutChoices } from "../store/useCheckoutChoices";
import { useCheckoutQuote, type CheckoutQuote } from "../store/useCheckoutQuote";
import { useOrderSubmission, type SubmissionState } from "../store/useOrderSubmission";
import { formatKES } from "../utils/format";

const CRUMBS = [{ label: "Cart", to: "/cart" }, { label: "Checkout" }];
const cardClass = "rounded-lg bg-surface p-4 shadow-card sm:p-6";
const stepHeadingClass = "type-h2 text-navy-900";
/** How a line is named once its product has left the catalog. */
const MISSING_NAME = "Item no longer in the catalog";

/* ------------------------------------------------------------------ */
/* Whole-page states                                                   */
/* ------------------------------------------------------------------ */

function CenteredPanel({ title, children, before }: { title: string; children: ReactNode; before?: ReactNode }) {
  return (
    <Container className="py-6 md:py-8">
      <Breadcrumb items={CRUMBS} />
      {before && <div className="mx-auto mt-6 max-w-xl space-y-3">{before}</div>}
      <section aria-labelledby="checkout-title" className={`mx-auto mt-6 max-w-xl text-center ${cardClass}`}>
        <h1 id="checkout-title" className="type-h1 text-navy-900">{title}</h1>
        {children}
      </section>
    </Container>
  );
}

function EmptyCheckout({ before }: { before?: ReactNode }) {
  return (
    <CenteredPanel title="Your cart is empty" before={before}>
      <p className="mt-2 text-navy-800">Add something to your cart, then check out here.</p>
      <Link to="/shop" className={`mx-auto mt-6 max-w-xs ${primaryActionClass}`}>Go shopping</Link>
    </CenteredPanel>
  );
}

function PagePanel({ children }: { children: ReactNode }) {
  return (
    <Container className="py-6 md:py-8">
      <Breadcrumb items={CRUMBS} />
      <div className="mt-8">{children}</div>
    </Container>
  );
}

export default function Checkout() {
  const { user } = useAuth();
  const { state } = useStore();
  if (!user) {
    if (!state.cart.length) return <EmptyCheckout />;
    return (
      <CenteredPanel title="Sign in to check out">
        <p className="mt-2 text-navy-800">Orders are placed from your account so you can follow and cancel them. Your cart comes with you.</p>
        <div className="mx-auto mt-6 max-w-sm space-y-3">
          <Link to={CHECKOUT_SIGN_IN} className={primaryActionClass}>Sign in</Link>
          <Link to={CHECKOUT_REGISTER} className={secondaryActionClass}>Create an account</Link>
        </div>
      </CenteredPanel>
    );
  }
  // Keyed by account: a previous customer's quote, request, order or typed address never reaches the next one.
  return <CheckoutContent key={user.id} user={user} />;
}

/* ------------------------------------------------------------------ */
/* The reserved order named by the address                             */
/* ------------------------------------------------------------------ */

type RequestedOrder =
  | { status: "none" }
  | { status: "loading" }
  | { status: "ready"; order: Order }
  /** The server refuses that order to this account: the address is dropped and checkout continues from the cart. */
  | { status: "missing" }
  | { status: "error"; message: string };

/** Answers meaning "not an order of this account" (unknown, another account's, or not an order identifier at all). */
const REFUSED_ORDER_STATUSES: readonly (number | undefined)[] = [400, 403, 404];

/**
 * The reserved order a payment-step address names, loaded from the server (which only answers for the signed-in
 * account), so a reload shows that order's payment again. A refusal reads as not found; any other failure is reported,
 * never taken as an empty checkout.
 */
function useRequestedOrder(orderId: string | null) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ orderId: string; attempt: number; outcome: RequestedOrder } | null>(null);

  useEffect(() => {
    if (orderId === null) return;
    let live = true;
    checkoutAPI.getOrder(orderId)
      .then(({ data }) => {
        const order = parseOrder(data);
        if (order.id !== orderId) throw new CheckoutFormatError("order identity");
        if (live) setResult({ orderId, attempt, outcome: { status: "ready", order } });
      })
      .catch((error: unknown) => {
        if (!live || isCancel(error)) return;
        const missing = REFUSED_ORDER_STATUSES.includes(apiStatus(error)) || apiErrorCode(error) === "ORDER_NOT_FOUND";
        const message = error instanceof CheckoutFormatError
          ? `${error.message} Try again shortly.`
          : describeApiError(error, "Your order could not be loaded.");
        setResult({ orderId, attempt, outcome: missing ? { status: "missing" } : { status: "error", message } });
      });
    return () => { live = false; };
  }, [orderId, attempt]);

  let state: RequestedOrder = { status: "none" };
  if (orderId !== null) state = result?.orderId === orderId && result.attempt === attempt ? result.outcome : { status: "loading" };
  return { state, retry: () => setAttempt((count) => count + 1) };
}

/**
 * Moves focus to the step heading whenever the step changes, so the change is announced and keyboard users start at
 * the new step. The first step shown takes focus only on an in-app arrival (a followed link, or Back/Forward), never on
 * a fresh load and never out of the site header (the P7.2 route-entry pattern).
 */
function useStepFocus(stepKey: string, heading: RefObject<HTMLElement | null>) {
  const { kind } = useRouteState();
  const arrival = useRef(kind);
  const shown = useRef<string | null>(null);
  useLayoutEffect(() => {
    const previous = shown.current;
    shown.current = stepKey;
    if (previous === stepKey) return;
    if (previous === null) {
      if (arrival.current !== "push" && arrival.current !== "traverse") return;
      if (document.activeElement?.closest("[data-site-header]")) return;
    }
    heading.current?.focus();
  }, [stepKey, heading]);
}

/* ------------------------------------------------------------------ */
/* The signed-in checkout                                              */
/* ------------------------------------------------------------------ */

const summaryLinesFromCart = (views: readonly CartLineView<CartLine>[]): SummaryLine[] =>
  views.map((view) => ({ key: view.key, name: view.product?.name ?? MISSING_NAME, detail: view.variantLabel, quantity: view.line.quantity }));

const summaryLinesFromOrder = (order: Order): SummaryLine[] => order.items.map((item) => ({
  key: item.id, name: item.productName, quantity: item.quantity,
  detail: item.variantAttributes ? describeVariant({ attributes: item.variantAttributes }) : "",
}));

function CheckoutContent({ user }: { user: User }) {
  const navigation = useRouteState();
  const requested = parseCheckoutRoute(navigation.route);
  const { state, cartCount, ownerReady } = useStore();
  const catalog = useCatalog();
  const choices = useCheckoutChoices(user);
  const submission = useOrderSubmission();
  /** The quote the customer explicitly accepted and the rejection that acceptance answered. */
  const [reviewed, setReviewed] = useState<{ quoteId: string; rejection: SubmissionState | null } | null>(null);
  const [orderLost, setOrderLost] = useState(false);
  const status = submission.state.status;
  // A stored request is settled (or re-sent with its own key) before anything new can be reviewed.
  const settling = status === "resolving" || status === "unresolved" ||
    (submission.state.status === "sending" && submission.state.retry);
  const placedHere = submission.state.status === "placed" ? submission.state.order : null;
  const requestedOrder = useRequestedOrder(placedHere ? null : requested.orderId);
  const placed = placedHere ?? (requestedOrder.state.status === "ready" ? requestedOrder.state.order : null);
  const review = reviewCart(state.cart, catalog.productsById);
  const blocker = review.blocker ? CART_BLOCKERS[review.blocker] : null;
  // Never quote or reserve during the render where the cart still belongs to the previous account or is merging.
  const quotable = submission.ownerReady && ownerReady && !settling && placed === null &&
    catalog.status === "ready" && state.cart.length > 0 && blocker === null;
  const quote = useCheckoutQuote(quotable && choices.address
    ? quoteRequestFor(state.cart, { addressId: choices.address.id, deliveryMethod: choices.deliveryMethod, couponCode: choices.couponCode })
    : null);

  // The reserved order joins the address, so a reload (or Back to it) shows this order's payment again.
  const placedId = placedHere?.id ?? null;
  useEffect(() => {
    if (placedId !== null && requested.orderId !== placedId) navigate(checkoutRoute("payment", placedId), { replace: true });
  }, [placedId, requested.orderId]);
  // An address naming an order this account does not have (or no order at all) is dropped; checkout carries on from
  // the cart.
  const missing = requestedOrder.state.status === "missing" || requested.malformedOrder;
  useEffect(() => {
    if (!missing) return;
    setOrderLost(true);
    navigate(checkoutRoute(), { replace: true });
  }, [missing]);

  if (!ownerReady) return <PagePanel><LoadingPanel label="Loading your cart…" /></PagePanel>;
  if (requestedOrder.state.status === "loading") return <PagePanel><LoadingPanel label="Loading your order…" /></PagePanel>;
  if (requestedOrder.state.status === "error") {
    return (
      <PagePanel>
        <ErrorPanel title="Your order could not be loaded" message={`${requestedOrder.state.message} Nothing has been charged by loading this page.`} onRetry={requestedOrder.retry}>
          <Link to="/account/orders" className={textLinkClass}>View your orders</Link>
        </ErrorPanel>
      </PagePanel>
    );
  }

  const views = catalog.status === "ready" ? cartLineViews(state.cart, catalog.productsById) : [];
  const facts = { placed: placed !== null, settling, deliveryChosen: choices.address !== null };
  const view = checkoutSteps(facts, requested.step);
  const notices = (
    <>
      {orderLost && <Notice tone="warning" role="status" title="That order isn't in your account">
        <p>Checkout continues with your cart. Your orders are listed in <Link to="/account/orders" className="font-semibold text-link underline underline-offset-4 hover:text-link-hover">your account</Link>.</p>
      </Notice>}
      <SubmissionNotice state={submission.state} />
    </>
  );

  if (placed) {
    return (
      <CheckoutFrame view={view} stepKey="payment" summaryClassName="md:col-start-2 md:row-start-1"
        summary={{ lines: summaryLinesFromOrder(placed), figures: { kind: "order", order: placed } }}>
        {(heading) => <PaymentStep order={placed} remainingItems={cartCount} headingRef={heading.ref} headingId={heading.id} />}
      </CheckoutFrame>
    );
  }

  if (settling) {
    const figures: CheckoutFigures = { kind: "pending", ...estimateOf(views), reason: pendingReason({ settling, addressChosen: true, blocker, status: "idle", expired: false }) };
    return (
      <CheckoutFrame view={view} stepKey="review:settling" summaryClassName="md:col-start-2 md:row-start-1"
        summary={catalog.status === "ready" && views.length ? { lines: summaryLinesFromCart(views), figures } : null}>
        {(heading) => <SettlingStep submission={submission} heading={heading} />}
      </CheckoutFrame>
    );
  }

  if (state.cart.length === 0) return <EmptyCheckout before={notices} />;

  if (catalog.status !== "ready") {
    return (
      <PagePanel>
        {catalog.status === "loading"
          ? <LoadingPanel label="Loading current prices…" />
          : <ErrorPanel title="Checkout is unavailable" message={`${catalog.error ?? "The catalog could not be loaded."} Your cart is unchanged.`} onRetry={catalog.reload} />}
      </PagePanel>
    );
  }

  const current = quote.quote;
  if (current && !current.reservationsEnabled) return <OrderingUnavailable before={notices} />;

  const figures: CheckoutFigures = current && !quote.expired
    ? { kind: "quote", quote: current }
    : {
      kind: "pending", ...estimateOf(views),
      reason: pendingReason({ settling, addressChosen: choices.address !== null, blocker, status: quote.status, expired: quote.expired }),
    };
  const summary = { lines: summaryLinesFromCart(views), figures };
  const goTo = (step: CheckoutStep) => {
    // Without a step in the address the step shown is implied; record it first, so Back returns to it.
    if (requested.step === null) navigate(checkoutRoute(view.current), { replace: true });
    navigate(checkoutRoute(step));
  };

  if (view.current === "delivery") {
    return (
      <CheckoutFrame view={view} stepKey="delivery" notices={notices} summary={summary} summaryClassName="md:col-start-2 md:row-start-1">
        {(heading) => (
          <DeliveryStep user={user} choices={choices} quote={quote} heading={heading} onContinue={() => goTo("review")} />
        )}
      </CheckoutFrame>
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

  let blockedReason: string | null = null;
  if (!sending && !canReserve) {
    if (reviewNeeded) blockedReason = "Confirm you have reviewed the updated total to continue.";
    else if (current && quote.expired) blockedReason = "Refresh prices to continue.";
    else blockedReason = "Your total must be calculated before you can reserve.";
  }

  return (
    <CheckoutFrame
      view={view}
      stepKey="review"
      notices={notices}
      summary={summary}
      summaryClassName="md:hidden"
      aside={(
        <OrderTotal
          quote={quote}
          blocker={blocker}
          onRefreshAvailability={catalog.reload}
          changeDelivery={<button type="button" onClick={() => goTo("delivery")} className={textLinkClass}>Change delivery details</button>}
          review={reviewNeeded && current && previousTotal !== null
            ? { previousTotal, total: current.total, confirm: () => setReviewed({ quoteId: current.id, rejection }) }
            : null}
          sending={sending}
          canReserve={canReserve}
          blockedReason={blockedReason}
          onReserve={reserve}
        />
      )}
    >
      {(heading) => (
        <ReviewStep
          heading={heading}
          views={views}
          quote={quote}
          address={choices.address}
          deliveryMethod={choices.deliveryMethod}
          couponCode={choices.couponCode}
          disabled={sending}
          onChangeDelivery={() => goTo("delivery")}
          onApplyCoupon={choices.applyCoupon}
          onRemoveCoupon={choices.removeCoupon}
        />
      )}
    </CheckoutFrame>
  );
}

function estimateOf(views: readonly CartLineView<CartLine>[]) {
  const { subtotal, excluded } = cartEstimate(views);
  return { estimate: subtotal, excluded };
}

type StepHeading = { ref: RefObject<HTMLHeadingElement | null>; id: string };

/**
 * One layout for every step: the H1, the step list, notices, then the step beside its summary. On phones the summary
 * is a closed disclosure above the step; from 768px it is a 300px column, 360px from 1280px. On Review the column holds
 * the order total and the Reserve action instead, so the summary is a phone-only disclosure there.
 */
function CheckoutFrame({ view, stepKey, notices, summary, summaryClassName, aside, children }: {
  view: StepView;
  /** Changes whenever a different step (or the settling view of Review) is shown; focus then moves to its heading. */
  stepKey: string;
  notices?: ReactNode;
  summary: { lines: SummaryLine[]; figures: CheckoutFigures } | null;
  summaryClassName: string;
  aside?: ReactNode;
  children: (heading: StepHeading) => ReactNode;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const route = useRouteState().route;
  useStepFocus(stepKey, ref);
  // A step link from an address without a step records the step being left first, so Back returns to it.
  const recordCurrent = () => {
    if (parseCheckoutRoute(route).step === null) navigate(checkoutRoute(view.current), { replace: true });
  };
  return (
    <Container className="py-6 md:py-8">
      <Breadcrumb items={CRUMBS} />
      <h1 className="type-h1 mt-4 text-navy-900">Checkout</h1>
      <div className="mt-3"><CheckoutProgress view={view} onLeave={recordCurrent} /></div>
      <div className="mt-4 space-y-3 empty:hidden">
        <DemoCatalogNotice />
        {notices}
      </div>
      <div className="mt-6 grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-8">
        {summary && <CheckoutSummary lines={summary.lines} figures={summary.figures} className={summaryClassName} />}
        <section aria-labelledby={id} className="min-w-0 md:col-start-1 md:row-start-1">{children({ ref, id })}</section>
        {aside}
      </div>
    </Container>
  );
}

/** The server has reservations switched off: nothing can be reserved or charged, and the cart stays as it is. */
function OrderingUnavailable({ before }: { before?: ReactNode }) {
  return (
    <CenteredPanel title="Ordering is not available yet" before={before}>
      <p role="status" className="mt-3 text-navy-800">
        Orders cannot be placed right now, so nothing has been reserved or charged. Your cart is unchanged.
      </p>
      <div className="mx-auto mt-6 grid max-w-md gap-3 sm:grid-cols-2">
        <Link to="/cart" className={primaryActionClass}>Back to cart</Link>
        <Link to="/shop" className={secondaryActionClass}>Continue shopping</Link>
      </div>
    </CenteredPanel>
  );
}

/* ------------------------------------------------------------------ */
/* Step 1: Delivery                                                    */
/* ------------------------------------------------------------------ */

/**
 * Where and how the order is delivered. With no saved address the step is the address form itself; otherwise the saved
 * addresses are choice cards and the same form opens with "Add another address". What is typed is kept for this tab
 * and account until it is saved, so leaving to edit the cart (or reloading) loses nothing.
 */
function DeliveryStep({ user, choices, quote, heading, onContinue }: {
  user: User;
  choices: ReturnType<typeof useCheckoutChoices>;
  quote: CheckoutQuote;
  heading: StepHeading;
  onContinue: () => void;
}) {
  const { addAddress } = useAuth();
  const addresses = choices.addresses;
  const [adding, setAdding] = useState(() => addresses.length === 0 || readAddressDraft(user.id) !== null);
  const [focusAddress, setFocusAddress] = useState<string | null>(null);
  const groupId = useId();
  const radios = useRef(new Map<string, HTMLInputElement>());
  const errorCode = quote.error?.code;
  const addressError = errorCode === CHOICE_ERRORS.address ? quote.error?.message ?? null : null;
  const deliveryError = errorCode === CHOICE_ERRORS.delivery ? quote.error?.message ?? null : null;
  const first = addresses.length === 0;

  // A newly saved address takes focus once its card exists, so focus never drops when the form closes.
  useLayoutEffect(() => {
    if (focusAddress === null) return;
    const radio = radios.current.get(focusAddress);
    if (!radio) return;
    setFocusAddress(null);
    radio.focus();
  }, [focusAddress, addresses]);

  const methods = (
    <DeliveryMethodChoices deliveryMethod={choices.deliveryMethod} disabled={false} error={deliveryError} onDelivery={choices.chooseDelivery} />
  );
  const saved = (address: Address) => {
    clearAddressDraft();
    choices.chooseAddress(address.id);
    setAdding(false);
    if (first) onContinue();
    else setFocusAddress(address.id);
  };
  const form = (
    <AddressForm
      title={first ? "Delivery address" : "Add another address"}
      initial={readAddressDraft(user.id) ?? EMPTY_ADDRESS}
      isDefault={first}
      submitLabel={first ? "Save and continue" : "Save address"}
      extra={first ? methods : undefined}
      onDraft={(draft) => saveAddressDraft(user.id, draft)}
      onSave={addAddress}
      onSaved={saved}
      onCancel={first ? undefined : () => { clearAddressDraft(); setAdding(false); }}
    />
  );

  return (
    <div className={`space-y-6 ${cardClass}`}>
      <div>
        <h2 id={heading.id} ref={heading.ref} tabIndex={-1} className={stepHeadingClass}>Delivery</h2>
        <p className="mt-1 text-navy-800">
          {first ? "Where should we deliver your order? Your address is saved to your account." : "Choose where and how your order is delivered."}
        </p>
      </div>
      {first ? form : (
        <>
          <fieldset className="min-w-0" aria-describedby={addressError ? `${groupId}-error` : undefined}>
            <legend className={fieldLabelClass}>Delivery address</legend>
            <div className="mt-1.5 space-y-2">
              {addresses.map((item) => (
                <label key={item.id} className="flex min-h-[48px] cursor-pointer items-start gap-3 rounded-md border border-control bg-surface p-3 text-navy-900 has-[:checked]:border-2 has-[:checked]:border-navy-900 has-[:checked]:bg-surface-page">
                  <input
                    ref={(node) => { if (node) radios.current.set(item.id, node); else radios.current.delete(item.id); }}
                    type="radio"
                    name={`${groupId}-address`}
                    value={item.id}
                    checked={choices.address?.id === item.id}
                    onChange={() => choices.chooseAddress(item.id)}
                    className="mt-0.5 size-5 shrink-0 accent-navy-900"
                  />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="block">{item.street}</span>
                    <span className="block text-sm text-navy-800">{item.city}, {item.county}{item.postalCode ? ` ${item.postalCode}` : ""}</span>
                    {item.isDefault && <span className="mt-1 inline-block rounded-sm bg-surface-soft px-2 text-sm font-semibold text-navy-800">Default</span>}
                  </span>
                </label>
              ))}
            </div>
            {addressError && <p id={`${groupId}-error`} role="alert" className="mt-1.5 text-sm font-semibold text-error">{addressError}</p>}
          </fieldset>
          {adding ? (
            <div className="border-t border-divider pt-6">{form}</div>
          ) : (
            <div className="flex flex-wrap gap-x-6">
              <button type="button" onClick={() => setAdding(true)} className={textLinkClass}>Add another address</button>
              <Link to="/account/addresses" className={textLinkClass}>Manage saved addresses</Link>
            </div>
          )}
          {methods}
          <button type="button" onClick={onContinue} className={primaryActionClass}>Continue to review</button>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2: Review and reserve                                          */
/* ------------------------------------------------------------------ */

/** Delivery recap, the cart's lines (read-only, with Edit cart) and the coupon; the total and Reserve sit beside it. */
function ReviewStep({
  heading, views, quote, address, deliveryMethod, couponCode, disabled, onChangeDelivery, onApplyCoupon, onRemoveCoupon,
}: {
  heading: StepHeading;
  views: CartLineView<CartLine>[];
  quote: CheckoutQuote;
  address: Address | null;
  deliveryMethod: ReturnType<typeof useCheckoutChoices>["deliveryMethod"];
  couponCode: string | null;
  disabled: boolean;
  onChangeDelivery: () => void;
  onApplyCoupon: (code: string) => void;
  onRemoveCoupon: () => void;
}) {
  const itemsId = useId();
  const count = views.reduce((sum, view) => sum + view.line.quantity, 0);
  return (
    <div className={`space-y-6 ${cardClass}`}>
      <h2 id={heading.id} ref={heading.ref} tabIndex={-1} className={stepHeadingClass}>Review and reserve</h2>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 rounded-md bg-surface-page p-3 [overflow-wrap:anywhere]">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-navy-900">Delivery</p>
          <p className="text-navy-800">{address ? formatAddress(address) : "No address chosen"}</p>
          <p className="text-sm text-muted">{DELIVERY_LABELS[deliveryMethod]}</p>
        </div>
        <button type="button" onClick={onChangeDelivery} className={textLinkClass}>
          Change<span className="sr-only"> delivery details</span>
        </button>
      </div>
      <section aria-labelledby={itemsId}>
        <div className="flex flex-wrap items-center justify-between gap-x-4">
          <h3 id={itemsId} className="type-h3 text-navy-900">Items</h3>
          <Link to="/cart" className={textLinkClass}>Edit cart</Link>
        </div>
        <p className="text-sm text-muted">{count} {count === 1 ? "item" : "items"}, prices excl. VAT</p>
        <div className="mt-3"><ReviewLines views={views} quote={quote.quote} label="Items to reserve" /></div>
      </section>
      <CouponField
        couponCode={couponCode}
        quote={quote.quote}
        errorCode={quote.error?.code}
        errorMessage={quote.error?.message}
        disabled={disabled}
        onApply={onApplyCoupon}
        onRemove={onRemoveCoupon}
      />
    </div>
  );
}

/**
 * The server's total for the reviewed cart with the conditions of reserving, and the Reserve action. Expired prices
 * and a changed total are dealt with here before anything is reserved.
 */
function OrderTotal({ quote, blocker, onRefreshAvailability, changeDelivery, review, sending, canReserve, blockedReason, onReserve }: {
  quote: CheckoutQuote;
  blocker: string | null;
  onRefreshAvailability: () => void;
  changeDelivery: ReactNode;
  review: { previousTotal: number; total: number; confirm: () => void } | null;
  sending: boolean;
  canReserve: boolean;
  blockedReason: string | null;
  onReserve: () => void;
}) {
  const titleId = useId();
  const reasonId = useId();
  return (
    <section aria-labelledby={titleId} className={`min-w-0 md:col-start-2 md:row-start-1 ${cardClass}`}>
      <h2 id={titleId} className="type-h3 text-navy-900">Order total</h2>
      <div className="mt-4">
        <QuoteSummary blocker={blocker} quote={quote} onRefreshAvailability={onRefreshAvailability} changeDelivery={changeDelivery} />
      </div>
      {review && (
        <div role="alert" className="mt-4 rounded-md border border-warning/40 bg-warning-tint p-3 text-sm text-navy-800">
          <p className="font-semibold text-warning">Review the updated total</p>
          <p className="mt-1">
            {review.previousTotal === review.total
              ? `Your total is still ${formatKES(review.total)} after checking prices again.`
              : `Your total changed from ${formatKES(review.previousTotal)} to ${formatKES(review.total)}.`}{" "}
            Check the items, delivery and VAT before reserving.
          </p>
          <button type="button" onClick={review.confirm} className={`mt-3 ${secondaryActionClass}`}>
            I have reviewed the new total
          </button>
        </div>
      )}
      <ul id="reserve-help" className="mt-4 list-disc space-y-1 pl-5 text-sm text-navy-800">
        <li>Reserving creates an unpaid order and charges nothing.</li>
        <li>Your items are held for a limited time; the exact time is shown once the order is reserved.</li>
        <li>You then pay with M-Pesa, after confirming the amount and your phone number.</li>
      </ul>
      <button
        type="button"
        onClick={onReserve}
        disabled={!canReserve}
        aria-describedby={blockedReason ? `${reasonId} reserve-help` : "reserve-help"}
        className={`mt-5 ${primaryActionClass}`}
      >
        {sending ? "Reserving…" : "Reserve order"}
      </button>
      {blockedReason && <p id={reasonId} className="mt-2 text-sm text-navy-800">{blockedReason}</p>}
    </section>
  );
}

/** Review while an earlier request's outcome is settled: only that same request can be retried, or checked again. */
function SettlingStep({ submission, heading }: { submission: ReturnType<typeof useOrderSubmission>; heading: StepHeading }) {
  // The actions stay mounted (and focused) while a check or retry runs; presses are ignored until it ends.
  const busy = submission.state.status !== "unresolved";
  return (
    <div className={`space-y-4 ${cardClass}`}>
      <h2 id={heading.id} ref={heading.ref} tabIndex={-1} className={stepHeadingClass}>Finishing your earlier order request</h2>
      <SubmissionNotice state={submission.state} />
      {submission.intent && (
        <p className="text-navy-800">
          The order you reviewed totalled {formatKES(submission.intent.total)}. Retrying sends that same request again,
          so it can create at most one order.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" aria-disabled={busy} onClick={() => { if (!busy) void submission.retry(); }} className={`${primaryActionClass} aria-disabled:cursor-not-allowed aria-disabled:bg-surface-soft aria-disabled:text-muted`}>
          Retry the same request
        </button>
        <button type="button" aria-disabled={busy} onClick={() => { if (!busy) void submission.checkAgain(); }} className={`${secondaryActionClass} aria-disabled:cursor-not-allowed aria-disabled:border-control aria-disabled:text-muted`}>
          Check again
        </button>
      </div>
      <div className="flex flex-wrap gap-x-6">
        <Link to="/account/orders" className={textLinkClass}>View your orders</Link>
        <Link to="/cart" className={textLinkClass}>Back to cart</Link>
      </div>
    </div>
  );
}
