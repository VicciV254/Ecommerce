import { isCancel } from "axios";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, navigate, parseRoute, useEntryFocus, useRoute } from "../router";
import { useAuth, type User } from "../contexts/AuthContext";
import type { PaymentOrderSummary } from "../api/mpesa";
import { ordersAPI, type CustomerOrder, type OrderReturn, type ReturnRequestResult } from "../api/orders";
import { apiErrorCode, describeApiError } from "../api/errors";
import { formatDateTime, formatKES } from "../utils/format";
import { DELIVERY_LABELS } from "../store/checkoutModel";
import { OrderFormatError, parseCustomerOrder, parseCustomerOrderPage } from "../store/orderModel";
import {
  REFUND_METHOD_LABELS,
  REFUND_SOURCE_TEXT,
  RETURN_REASON_LABELS,
  cancellationNotice,
  cancellationRequestsRefund,
  customerName,
  deliveryAddress,
  paymentLabel,
  refundStatusText,
  returnFaultText,
  returnNotice,
  returnRuleText,
  returnStatusText,
  returnWindowText,
  sampleRetentionText,
} from "../store/orderCopy";
import { withPaymentSummary } from "../store/paymentModel";
import { printReceipt } from "../utils/printReceipt";
import { useCatalog } from "../store/CatalogContext";
import { useStorefront } from "../store/StorefrontContext";
import CancelOrderModal from "../components/CancelOrderModal";
import DemonstrationControls from "../components/DemonstrationControls";
import ReturnOrderModal from "../components/ReturnOrderModal";
import { ConfirmModal, ModalDialog } from "../components/Modal";
import { ResponsiveImage } from "../components/ui";
import { Disclosure, OrderProgress, OrderStatusBadge, OrderTimeline, OrderTotals } from "../components/OrderRecords";
import { PaymentPanel } from "../components/PaymentPanel";
import { ErrorPanel, LoadingPanel } from "../components/ui";
import { Notice as NoticeBox } from "../components/checkout";

const ORDER_PAGE_LIMIT = 100;
const ORDERS_ROUTE = "/account/orders";
const buttonBase = "inline-flex min-h-[44px] items-center justify-center rounded-sm px-4 py-2 text-sm font-semibold transition-colors duration-(--motion-feedback)";
const primaryButton = `${buttonBase} bg-navy-900 text-white hover:bg-gold-500 hover:text-navy-900`;
const outlineButton = `${buttonBase} border border-navy-900 text-navy-900 hover:bg-surface-soft`;
const quietButton = `${buttonBase} border border-control text-navy-900 hover:border-navy-900 hover:bg-surface-soft`;
const dangerButton = `${buttonBase} border border-error text-error hover:bg-error-tint`;

/** The one thing an order most likely needs next, judged only from what the server reports and permits. */
type NextAction = "pay" | "return" | "track" | "receipt";
export function nextOrderAction(order: Pick<CustomerOrder, "quoteId" | "status" | "paymentStatus" | "reservationStatus" | "customerActions">): NextAction {
  if (order.quoteId && order.status === "PENDING" && order.paymentStatus === "PENDING" && order.reservationStatus === "HELD") return "pay";
  if (order.customerActions.includes("REQUEST_RETURN")) return "return";
  if (order.status === "PROCESSING" || order.status === "SHIPPED" || order.status === "READY_FOR_PICKUP") return "track";
  return "receipt";
}

type OrdersState =
  | { status: "loading" }
  | { status: "ready"; orders: CustomerOrder[] }
  | { status: "error"; message: string };
type Notice = { tone: "info" | "error"; text: string };

function describeOrderError(error: unknown, fallback: string) {
  return error instanceof OrderFormatError ? `${error.message} Try again shortly.` : describeApiError(error, fallback);
}

/** Stock-hold state of a quote-based order; legacy orders have none to show. */
function reservationNote(order: CustomerOrder) {
  if (!order.quoteId) return null;
  switch (order.reservationStatus) {
    case "HELD":
      return order.reservationExpiresAt
        ? `Items held until ${formatDateTime(order.reservationExpiresAt)} while payment is pending.`
        : "Items are held while payment is pending.";
    case "EXPIRED":
      return "The hold expired before payment, so the items were released.";
    case "RELEASED":
      return "The items were released when this order was cancelled.";
    default:
      return null;
  }
}

/**
 * Short status lines: refunds and returns first, then the return window or the stock hold, then when a sample order is
 * deleted (`retentionDays`, the catalog's period).
 */
function orderNotes(order: CustomerOrder, retentionDays: number | null): string[] {
  const notes: string[] = [];
  const refund = order.refunds.find((item) => item.status !== "CANCELLED");
  if (refund) notes.push(`Refund of ${formatKES(refund.amount)}: ${refundStatusText(refund)}.`);
  const open = order.returns.find((item) => item.status === "REQUESTED" || item.status === "APPROVED");
  if (open) notes.push(`Return ${open.number}: ${returnStatusText(open.status, order)}.`);
  if (order.status === "DELIVERED") {
    const windowNote = returnWindowText(order.returnEligibility, order.deliveryMethod);
    if (windowNote) notes.push(windowNote);
  }
  const hold = reservationNote(order);
  if (hold) notes.push(hold);
  const deletion = sampleRetentionText(order, retentionDays);
  if (deletion) notes.push(deletion);
  return notes;
}

/** A refund is requested only for money received and not yet refunded. */
function cancelLabel(order: CustomerOrder) {
  return cancellationRequestsRefund(order.paymentStatus) ? "Cancel & request refund" : "Cancel order";
}

/** Errors are announced as alerts; confirmations go to a status region that stays mounted. */
function NoticeArea({ notice }: { notice: Notice | null }) {
  return (
    <>
      {notice?.tone === "error" && <p role="alert" className="mt-4 rounded-md border border-error/40 bg-error-tint p-3 text-sm font-semibold text-error">{notice.text}</p>}
      <p role="status" className={notice?.tone === "info" ? "mt-4 rounded-md border border-success/40 bg-success-tint p-3 text-sm text-navy-900" : "sr-only"}>
        {notice?.tone === "info" ? notice.text : ""}
      </p>
    </>
  );
}

/** The actions the server says this order accepts now; nothing else is offered. */
function OrderActions({ order, onCancel, onReturn }: { order: CustomerOrder; onCancel: () => void; onReturn: () => void }) {
  const canReturn = order.customerActions.includes("REQUEST_RETURN");
  const canCancel = order.customerActions.includes("CANCEL");
  if (!canReturn && !canCancel) return null;
  return (
    <>
      {canReturn && <button type="button" onClick={onReturn} className={primaryButton}>Request a return</button>}
      {canCancel && <button type="button" onClick={onCancel} className={dangerButton}>{cancelLabel(order)}</button>}
    </>
  );
}

function OrderCard({ order, retentionDays, onDetails, onReceipt, onCancel, onReturn }: {
  order: CustomerOrder;
  retentionDays: number | null;
  onDetails: () => void;
  onReceipt: () => void;
  onCancel: () => void;
  onReturn: () => void;
}) {
  const next = nextOrderAction(order);
  const track = () => navigate(`/track?order=${encodeURIComponent(order.orderNumber)}`);
  const canCancel = order.customerActions.includes("CANCEL");
  return (
    <li className="overflow-hidden rounded-lg bg-surface shadow-card [overflow-wrap:anywhere]">
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <p className="font-mono text-sm font-bold text-navy-900">{order.orderNumber}</p>
            <p className="text-sm text-muted">Placed {formatDateTime(order.createdAt)} · {DELIVERY_LABELS[order.deliveryMethod]}</p>
          </div>
          <OrderStatusBadge order={order} audience="shopper" />
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="type-price-card text-navy-900">{formatKES(order.total)}</p>
          <p className="text-sm text-navy-800">Payment: {paymentLabel(order)}</p>
        </div>
        {orderNotes(order, retentionDays).map((note) => <p key={note} className="text-sm text-navy-800">{note}</p>)}
        {/* The next action comes first and stands out; the rest follow, with cancelling last. */}
        <div className="flex flex-wrap gap-2">
          {next === "pay" && <button type="button" onClick={onDetails} className={primaryButton}>Pay now<span className="sr-only"> for order {order.orderNumber}</span></button>}
          {next === "return" && <button type="button" onClick={onReturn} className={primaryButton}>Request a return</button>}
          {next === "track" && <button type="button" onClick={track} className={primaryButton}>Track order</button>}
          {next === "receipt" && <button type="button" onClick={onReceipt} className={primaryButton}>Receipt</button>}
          <button type="button" onClick={onDetails} className={quietButton}>Details</button>
          {next !== "receipt" && <button type="button" onClick={onReceipt} className={quietButton}>Receipt</button>}
          {next !== "track" && <button type="button" onClick={track} className={quietButton}>Track order</button>}
          {canCancel && <button type="button" onClick={onCancel} className={dangerButton}>{cancelLabel(order)}</button>}
        </div>
      </div>
      <ul aria-label={`Items in order ${order.orderNumber}`} className="space-y-2 border-t border-divider px-4 py-3 sm:px-5">
        {order.items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 text-sm">
            {item.productImage && <ResponsiveImage url={item.productImage} preset="thumbnail" alt="" className="size-12 shrink-0 rounded-sm object-cover" />}
            {/* The amount sits beside the name while it fits and moves under it when the text is enlarged. */}
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3">
              <div className="min-w-0">
                <p className="font-medium text-navy-900">{item.productName}</p>
                <p className="text-muted">
                  Qty {item.quantity}
                  {item.variantAttributes && Object.values(item.variantAttributes).length > 0 && ` · ${Object.values(item.variantAttributes).join(" / ")}`}
                </p>
              </div>
              <p className="font-semibold tabular-nums text-navy-900">{formatKES(item.subtotal)}</p>
            </div>
          </li>
        ))}
      </ul>
    </li>
  );
}

/** Records are rows of their disclosure's list, divided by hairlines, not cards inside its box. */
const recordListClass = "divide-y divide-divider";
const recordClass = "py-3 first:pt-0 last:pb-0";

/** A sample order's returns are approved and received in the demonstration, so their wording says so. */
function CustomerReturns({ order, onWithdraw }: { order: Pick<CustomerOrder, "returns" | "isDemo">; onWithdraw: (item: OrderReturn) => void }) {
  return (
    <ul className={recordListClass}>
      {order.returns.map((item) => (
        <li key={item.id} className={recordClass}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="font-mono text-sm font-bold text-navy-900">{item.number}</p>
            {/* "…in the demonstration" can't fit a phone column at 200% text; it breaks at a syllable instead. */}
            <p className="text-sm font-semibold text-navy-900 hyphenate-long-words">{returnStatusText(item.status, order)}</p>
          </div>
          <p className="text-sm text-muted">
            Requested {formatDateTime(item.requestedAt)} · {RETURN_REASON_LABELS[item.reason]}{item.unopenedDeclared ? " · declared unopened" : ""}
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {item.lines.map((line) => (
              <li key={line.id}>
                {line.quantity} × {line.productName}
                {line.receivedQuantity !== null && ` · received ${line.receivedQuantity}, refundable ${line.refundableQuantity ?? 0}`}
              </li>
            ))}
          </ul>
          {item.comment && <p className="mt-2 text-sm">Your comment: {item.comment}</p>}
          {item.decisionNote && <p className="mt-2 text-sm">Note from staff: {item.decisionNote}</p>}
          {item.inspectionNote && <p className="mt-2 text-sm">Inspection note: {item.inspectionNote}</p>}
          {item.status === "RECEIVED" && item.merchantFaultConfirmed !== null && (
            <p className="mt-2 text-sm">{returnFaultText(item.merchantFaultConfirmed, order)}</p>
          )}
          {item.status === "REQUESTED" && (
            <button type="button" onClick={() => onWithdraw(item)} className={`mt-3 ${quietButton}`}>
              Withdraw request<span className="sr-only"> {item.number}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function CustomerRefunds({ order }: { order: CustomerOrder }) {
  return (
    <ul className={recordListClass}>
      {order.refunds.map((refund) => (
        <li key={refund.id} className={recordClass}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="font-semibold tabular-nums text-navy-900">{formatKES(refund.amount)}</p>
            <p className="text-sm text-muted">{REFUND_SOURCE_TEXT[refund.source]}</p>
          </div>
          <p className="mt-1 text-sm">{refundStatusText(refund)}</p>
          {refund.method === "DEMONSTRATION" && <p className="text-sm text-muted">{REFUND_METHOD_LABELS.DEMONSTRATION}</p>}
          <p className="text-sm text-muted">
            Requested {formatDateTime(refund.requestedAt)}{refund.includesDeliveryFee ? " · includes the delivery fee" : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Receipt with summary, payment and the next permitted action first; history, returns and refunds are disclosed. */
function OrderDetails({ order, retentionDays, user, notice, closeRef, onClose, onCancel, onReturn, onWithdraw, onPaymentSummary, onOrderChange, onRefresh, onPrint }: {
  order: CustomerOrder;
  retentionDays: number | null;
  user: User | null;
  notice: Notice | null;
  closeRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onCancel: () => void;
  onReturn: () => void;
  onWithdraw: (item: OrderReturn) => void;
  onPaymentSummary: (summary: PaymentOrderSummary) => void;
  /** Shows the order a demonstration step returned. */
  onOrderChange: (order: CustomerOrder) => void;
  /** Reloads this order; resolves `false` when it could not be reloaded. */
  onRefresh: () => Promise<boolean>;
  onPrint: () => void;
}) {
  const { policy } = order.returnEligibility;
  const rules = new Map(order.returnEligibility.lines.map((line) => [line.orderItemId, line.returnRule]));
  const windowNote = order.status === "CANCELLED" ? null : returnWindowText(order.returnEligibility, order.deliveryMethod);
  const notes = orderNotes(order, retentionDays).filter((note) => note !== windowNote);
  return (
    <ModalDialog open label="Receipt details" onClose={onClose}>
      <div className="focus-scroll-room relative max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl bg-surface p-5 text-navy-800 shadow-overlay [overflow-wrap:anywhere] sm:p-6 md:max-w-4xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="type-h3 text-navy-900">Receipt details</h2>
            <p className="font-mono text-sm text-muted">{order.orderNumber}</p>
          </div>
          {/* An icon, so no word can break in it beside a long heading or order number. */}
          <button ref={closeRef} type="button" aria-label="Close" onClick={onClose} className="flex size-[44px] shrink-0 items-center justify-center rounded-full text-navy-900 transition-colors duration-(--motion-feedback) hover:bg-surface-soft">
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <NoticeArea notice={notice} />

        <section aria-label="Order summary" className="mt-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <OrderStatusBadge order={order} audience="shopper" />
            <p className="type-price text-navy-900">{formatKES(order.total)}</p>
          </div>
          <p className="text-sm"><span className="text-muted">Payment:</span> {paymentLabel(order)}</p>
          {notes.map((note) => <p key={note} className="text-sm">{note}</p>)}
          {windowNote && <p className="text-sm">{windowNote}</p>}
          {order.customerActions.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 md:flex md:flex-wrap">
              <OrderActions order={order} onCancel={onCancel} onReturn={onReturn} />
            </div>
          )}
        </section>

        {/* Only quote-based orders can be paid online; one panel, for the open receipt only, at full width. */}
        {order.quoteId && (
          <div className="mt-5">
            <PaymentPanel key={order.status} orderId={order.id} onOrderChange={onPaymentSummary} headingLevel={4} framed={false} />
          </div>
        )}

        {/* Shown only while the server lists steps, or to report the last one; the wrapper collapses when it is not. */}
        <div className="mt-5 empty:hidden">
          <DemonstrationControls key={order.id} order={order} onOrderChange={onOrderChange} onRefresh={onRefresh} />
        </div>

        <div className="mt-5 grid gap-5 md:grid-cols-2 md:items-start">
          <section aria-label="Order details" className="@container space-y-4">
            {/* Label beside value while the column has 17rem at the current text size; otherwise label above value, so
                labels never break mid-word ("Custom/er"). */}
            <dl className="grid grid-cols-1 text-sm [&>dd]:mb-2 @[17rem]:grid-cols-[fit-content(50%)_minmax(0,1fr)] @[17rem]:gap-x-4 @[17rem]:gap-y-1 @[17rem]:[&>dd]:mb-0">
              <dt className="text-muted">Customer</dt><dd>{customerName(user)}</dd>
              <dt className="text-muted">Email</dt><dd>{user?.email ?? ""}</dd>
              <dt className="text-muted">Delivery</dt><dd>{DELIVERY_LABELS[order.deliveryMethod]} · {deliveryAddress(order)}</dd>
              {order.trackingNumber && <><dt className="text-muted">Tracking</dt><dd className="font-mono">{order.trackingNumber}</dd></>}
            </dl>
            <Disclosure title="Items and totals" summary={`${order.items.length} ${order.items.length === 1 ? "item" : "items"}`}>
              <ul className="space-y-2">
                {order.items.map((item) => (
                  <li key={item.id}>
                    <div className="flex flex-wrap justify-between gap-x-3">
                      <span className="min-w-0">{item.quantity} × {item.productName}</span>
                      <span className="font-semibold tabular-nums">{formatKES(item.subtotal)}</span>
                    </div>
                    {rules.has(item.id) && <p className="text-sm text-muted">{returnRuleText(rules.get(item.id) ?? "STANDARD", policy.windowDays, order.deliveryMethod)}</p>}
                  </li>
                ))}
              </ul>
              <div className="mt-3 border-t border-divider pt-3"><OrderTotals order={order} /></div>
            </Disclosure>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => navigate(`/track?order=${encodeURIComponent(order.orderNumber)}`)} className={outlineButton}>
                Track order
              </button>
              <button type="button" onClick={onPrint} className={outlineButton}>Print receipt</button>
            </div>
          </section>

          <section aria-label="Order history, returns and refunds" className="space-y-3">
            <Disclosure title="Progress">
              <OrderProgress order={order} fulfilment={order.fulfilment} />
              <h4 className="mt-4 text-sm font-semibold text-navy-900">Updates</h4>
              <div className="mt-2"><OrderTimeline events={order.trackingHistory} /></div>
            </Disclosure>
            {order.returns.length > 0 && (
              <Disclosure title="Returns" summary={String(order.returns.length)}>
                <CustomerReturns order={order} onWithdraw={onWithdraw} />
              </Disclosure>
            )}
            {order.refunds.length > 0 && (
              <Disclosure title="Refunds" summary={String(order.refunds.length)}>
                <CustomerRefunds order={order} />
              </Disclosure>
            )}
          </section>
        </div>
      </div>
    </ModalDialog>
  );
}

export default function AccountOrders() {
  const { user } = useAuth();
  // An order named in the address (a link from checkout or tracking) opens once this account's orders have loaded.
  const requestedId = parseRoute(useRoute()).params.get("order");
  return <AccountOrdersContent key={user?.id ?? "guest"} user={user} requestedId={requestedId} />;
}

/** Moves focus to `target` only when an update removed the control that had it. */
function rescueFocus(target: HTMLElement | null) {
  const active = document.activeElement;
  if (!active || active === document.body || active.tagName === "DIALOG" || !active.isConnected) target?.focus();
}

function AccountOrdersContent({ user, requestedId }: { user: User | null; requestedId: string | null }) {
  const { brandName } = useStorefront();
  const { sampleOrderRetentionDays } = useCatalog();
  const [orders, setOrders] = useState<OrdersState>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [missingOrder, setMissingOrder] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [returnId, setReturnId] = useState<string | null>(null);
  const [withdrawal, setWithdrawal] = useState<{ orderId: string; item: OrderReturn } | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const latest = useRef<CustomerOrder[]>([]);
  /** Each order's newest reload or accepted result; answers to older reloads of that order are ignored. */
  const orderTickets = useRef(new Map<string, number>());
  const ticketCount = useRef(0);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const detailsClose = useRef<HTMLButtonElement>(null);

  const list = orders.status === "ready" ? orders.orders : [];
  const find = (id: string | null) => (id ? list.find((order) => order.id === id) ?? null : null);
  const selected = find(selectedId);
  const cancelling = find(cancelId);
  const returning = find(returnId);

  useLayoutEffect(() => {
    latest.current = list;
  });
  useLayoutEffect(() => {
    if (focusRequest) rescueFocus(detailsClose.current ?? pageHeading.current);
  }, [focusRequest]);
  useEntryFocus(pageHeading);

  // A requested order is looked up only in this account's own list, so no other account's order can open. The
  // request is then dropped from the address, so a reload or Back does not open it again.
  useEffect(() => {
    if (requestedId === null || orders.status !== "ready") return;
    const found = orders.orders.some((order) => order.id === requestedId);
    setMissingOrder(!found);
    if (found) setSelectedId(requestedId);
    navigate(ORDERS_ROUTE, { replace: true });
  }, [requestedId, orders]);

  const loadOrders = useCallback(async () => {
    try {
      const { data } = await ordersAPI.getMyOrders({ limit: ORDER_PAGE_LIMIT });
      setOrders({ status: "ready", orders: parseCustomerOrderPage(data).orders });
    } catch (error) {
      setOrders({ status: "error", message: describeOrderError(error, "Your orders could not be loaded.") });
    }
  }, []);

  // The account id, not the user object: `/me` replaces the object without changing whose orders these are.
  const userId = user?.id;
  useEffect(() => {
    if (userId) void loadOrders();
  }, [userId, loadOrders]);

  const retry = () => {
    setOrders({ status: "loading" });
    void loadOrders();
  };

  const claimOrder = useCallback((id: string) => {
    ticketCount.current += 1;
    orderTickets.current.set(id, ticketCount.current);
    return ticketCount.current;
  }, []);

  /** Shows an order as the server returned it; reloads of that order still in flight are now older and ignored. */
  const applyUpdatedOrder = useCallback((order: CustomerOrder) => {
    claimOrder(order.id);
    setOrders((current) => current.status === "ready"
      ? { status: "ready", orders: current.orders.map((item) => (item.id === order.id ? order : item)) }
      : current);
  }, [claimOrder]);

  /**
   * Reloads one order so its permitted actions, returns and refunds reflect the server again; `true` when the
   * reload answered. An answer overtaken by a newer reload or accepted result changes nothing and reports nothing.
   */
  const refreshOrder = useCallback(async (id: string) => {
    const ticket = claimOrder(id);
    try {
      const { data } = await ordersAPI.get(id);
      const order = parseCustomerOrder(data, id);
      if (orderTickets.current.get(id) === ticket) applyUpdatedOrder(order);
      return true;
    } catch (error) {
      if (orderTickets.current.get(id) === ticket && !isCancel(error)) {
        setNotice({ tone: "error", text: describeOrderError(error, "This order could not be refreshed. Reload the page to see its latest status.") });
      }
      return false;
    }
  }, [applyUpdatedOrder, claimOrder]);

  /** Keeps the list and the open receipt in step with the payment service, then reloads that order's actions. */
  const applyPaymentSummary = useCallback((summary: PaymentOrderSummary) => {
    const known = latest.current.find((item) => item.id === summary.id);
    if (!known || withPaymentSummary(known, summary) === known) return;
    setOrders((current) => current.status === "ready"
      ? { status: "ready", orders: current.orders.map((item) => withPaymentSummary(item, summary)) }
      : current);
    void refreshOrder(summary.id);
  }, [refreshOrder]);

  const openModal = (open: (id: string) => void, order: CustomerOrder) => {
    setNotice(null);
    setMissingOrder(false);
    open(order.id);
  };

  const handleOrderCancelled = (order: CustomerOrder) => {
    applyUpdatedOrder(order);
    setCancelId(null);
    setNotice({ tone: "info", text: cancellationNotice(order) });
    setFocusRequest((count) => count + 1);
  };

  const handleReturned = ({ order, returnRequest }: ReturnRequestResult) => {
    applyUpdatedOrder(order);
    setReturnId(null);
    setNotice({ tone: "info", text: returnNotice(returnRequest, order) });
    setFocusRequest((count) => count + 1);
  };

  const withdraw = async () => {
    if (!withdrawal || withdrawing) return;
    const { orderId, item } = withdrawal;
    setWithdrawing(true);
    try {
      const { data } = await ordersAPI.cancelReturn(orderId, item.id);
      applyUpdatedOrder(parseCustomerOrder(data, orderId));
      setNotice({ tone: "info", text: `Return ${item.number} withdrawn.` });
    } catch (error) {
      const changed = apiErrorCode(error) === "RETURN_CHANGED";
      setNotice({
        tone: "error",
        text: changed ? `Return ${item.number} has already been reviewed, so it can no longer be withdrawn.`
          : describeOrderError(error, "The return could not be withdrawn."),
      });
      if (changed) void refreshOrder(orderId);
    } finally {
      setWithdrawing(false);
      setWithdrawal(null);
      setFocusRequest((count) => count + 1);
    }
  };

  let body: ReactNode;
  if (orders.status === "loading") body = <LoadingPanel label="Loading your orders…" />;
  else if (orders.status === "error") body = <ErrorPanel title="Orders are unavailable" message={orders.message} onRetry={retry} />;
  else if (orders.orders.length === 0) {
    body = (
      <div className="rounded-lg bg-surface p-6 text-center shadow-card sm:p-8">
        <p className="text-navy-800">No orders yet. Orders you place will appear here.</p>
        <Link to="/shop" className={`mt-5 ${primaryButton}`}>Start shopping</Link>
      </div>
    );
  } else {
    body = (
      <ul aria-label="Your orders" className="space-y-4">
        {orders.orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            retentionDays={sampleOrderRetentionDays}
            onDetails={() => openModal(setSelectedId, order)}
            onReceipt={() => printReceipt(order, user, brandName)}
            onCancel={() => openModal(setCancelId, order)}
            onReturn={() => openModal(setReturnId, order)}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 ref={pageHeading} tabIndex={-1} className="type-h1 text-navy-900">Orders and receipts</h1>
          <p className="mt-1 text-navy-800">Pay, track and return orders, reprint receipts and follow refunds.</p>
        </div>
        <Link to="/track" className={outlineButton}>Track an order</Link>
      </div>

      {missingOrder && (
        <NoticeBox tone="warning" role="alert" title="That order isn't in your account">
          <p>Check the link you followed. Your own orders are listed here.</p>
        </NoticeBox>
      )}
      {!selected && <NoticeArea notice={notice} />}

      {body}

      {selected && (
        <OrderDetails
          order={selected}
          retentionDays={sampleOrderRetentionDays}
          user={user}
          notice={notice}
          closeRef={detailsClose}
          onClose={() => { setSelectedId(null); setNotice(null); }}
          onCancel={() => setCancelId(selected.id)}
          onReturn={() => setReturnId(selected.id)}
          onWithdraw={(item) => setWithdrawal({ orderId: selected.id, item })}
          onPaymentSummary={applyPaymentSummary}
          onOrderChange={applyUpdatedOrder}
          onRefresh={() => refreshOrder(selected.id)}
          onPrint={() => printReceipt(selected, user, brandName)}
        />
      )}

      {cancelling && (
        <CancelOrderModal
          order={cancelling}
          onClose={() => { setCancelId(null); setFocusRequest((count) => count + 1); }}
          onOrderCancelled={handleOrderCancelled}
          onConflict={() => refreshOrder(cancelling.id)}
        />
      )}
      {returning && user && (
        <ReturnOrderModal
          order={returning}
          ownerId={user.id}
          onClose={() => setReturnId(null)}
          onReturned={handleReturned}
          onRefresh={() => void refreshOrder(returning.id)}
        />
      )}
      <ConfirmModal
        open={Boolean(withdrawal)}
        title={`Withdraw return ${withdrawal?.item.number ?? ""}`}
        message="Your return request will be cancelled and the items stay with you. You can request a new return while the return window is open."
        confirmLabel={withdrawing ? "Withdrawing…" : "Withdraw request"}
        cancelLabel="Keep request"
        tone="danger"
        confirmDisabled={withdrawing}
        onConfirm={() => void withdraw()}
        onCancel={() => { if (!withdrawing) setWithdrawal(null); }}
      />
    </div>
  );
}
