import { isCancel } from "axios";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Link, navigate } from "../router";
import { useAuth, type User } from "../contexts/AuthContext";
import type { PaymentOrderSummary } from "../api/mpesa";
import { ordersAPI, type CustomerOrder, type OrderReturn, type ReturnRequestResult } from "../api/orders";
import { apiErrorCode, describeApiError } from "../api/errors";
import { formatDateTime, formatKES } from "../utils/format";
import { DELIVERY_LABELS } from "../store/checkoutModel";
import { OrderFormatError, parseCustomerOrder, parseCustomerOrderPage } from "../store/orderModel";
import {
  REFUND_SOURCE_TEXT,
  RETURN_REASON_LABELS,
  RETURN_STATUS_TEXT,
  cancellationNotice,
  cancellationRequestsRefund,
  customerName,
  deliveryAddress,
  paymentLabel,
  refundStatusText,
  returnNotice,
  returnRuleText,
  returnWindowText,
} from "../store/orderCopy";
import { withPaymentSummary } from "../store/paymentModel";
import { receiptDocument } from "../utils/receiptDocument";
import { useStorefront } from "../store/StorefrontContext";
import CancelOrderModal from "../components/CancelOrderModal";
import ReturnOrderModal from "../components/ReturnOrderModal";
import { ConfirmModal, ModalDialog } from "../components/Modal";
import { ResponsiveImage } from "../components/ui";
import { Disclosure, OrderProgress, OrderStatusBadge, OrderTimeline, OrderTotals } from "../components/OrderRecords";
import { PaymentPanel } from "../components/PaymentPanel";
import { ErrorPanel, LoadingPanel } from "../components/ui";

const ORDER_PAGE_LIMIT = 100;
const buttonBase = "min-h-11 rounded-sm px-3 py-2 text-[11px] font-bold uppercase tracking-wider";
const primaryButton = `${buttonBase} bg-brand-primary text-white hover:bg-brand-secondary hover:text-brand-primary`;
const outlineButton = `${buttonBase} border border-brand-primary text-brand-primary hover:bg-brand-primary hover:text-white`;
const quietButton = `${buttonBase} border border-light-gray text-charcoal hover:border-brand-primary`;
const dangerButton = `${buttonBase} border border-error text-error hover:bg-error hover:text-white`;

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

/** Short status lines: refunds and returns first, then the return window or the stock hold. */
function orderNotes(order: CustomerOrder): string[] {
  const notes: string[] = [];
  const refund = order.refunds.find((item) => item.status !== "CANCELLED");
  if (refund) notes.push(`Refund of ${formatKES(refund.amount)}: ${refundStatusText(refund)}.`);
  const open = order.returns.find((item) => item.status === "REQUESTED" || item.status === "APPROVED");
  if (open) notes.push(`Return ${open.number}: ${RETURN_STATUS_TEXT[open.status]}.`);
  if (order.status === "DELIVERED") {
    const windowNote = returnWindowText(order.returnEligibility);
    if (windowNote) notes.push(windowNote);
  }
  const hold = reservationNote(order);
  if (hold) notes.push(hold);
  return notes;
}

/** A refund is requested only for money received and not yet refunded. */
function cancelLabel(order: CustomerOrder) {
  return cancellationRequestsRefund(order.paymentStatus) ? "Cancel & Request Refund" : "Cancel Order";
}

/** Longest wait for the brand fonts; after it the receipt prints in its fallback faces. */
const RECEIPT_FONT_WAIT_MS = 3000;

/** Opens the receipt in its own window and prints it once, after the brand fonts load, fail or time out. */
function printReceipt(order: CustomerOrder, user: User | null, brandName: string) {
  const popup = window.open("", "_blank", "width=720,height=900");
  if (!popup) return;
  popup.document.write(receiptDocument(order, user, brandName));
  popup.document.close();
  const loaded = new Promise<void>((resolve) => {
    if (popup.document.readyState === "complete") resolve();
    else popup.addEventListener("load", () => resolve(), { once: true });
  });
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, RECEIPT_FONT_WAIT_MS));
  void Promise.race([loaded.then(() => popup.document.fonts.ready), timeout]).then(() => {
    if (popup.closed) return;
    popup.focus();
    popup.print();
  });
}

/** Errors are announced as alerts; confirmations go to a status region that stays mounted. */
function NoticeArea({ notice }: { notice: Notice | null }) {
  return (
    <>
      {notice?.tone === "error" && <p role="alert" className="mt-4 rounded-md border border-error/30 bg-error/5 p-3 text-sm font-semibold text-error">{notice.text}</p>}
      <p role="status" className={notice?.tone === "info" ? "mt-4 rounded-md border border-brand-secondary/30 bg-surface-soft p-3 text-sm text-navy-900" : "sr-only"}>
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
      {canReturn && <button type="button" onClick={onReturn} className={primaryButton}>Request a Return</button>}
      {canCancel && <button type="button" onClick={onCancel} className={dangerButton}>{cancelLabel(order)}</button>}
    </>
  );
}

function OrderCard({ order, onDetails, onReceipt, onCancel, onReturn }: {
  order: CustomerOrder;
  onDetails: () => void;
  onReceipt: () => void;
  onCancel: () => void;
  onReturn: () => void;
}) {
  return (
    <li className="overflow-hidden rounded-lg border border-light-gray bg-white [overflow-wrap:anywhere]">
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <p className="font-mono text-sm font-bold text-brand-primary">{order.orderNumber}</p>
            <p className="text-xs text-gray-600">Placed {formatDateTime(order.createdAt)} · {DELIVERY_LABELS[order.deliveryMethod]}</p>
          </div>
          <OrderStatusBadge order={order} />
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-xl font-semibold tabular-nums text-navy-900">{formatKES(order.total)}</p>
          <p className="text-xs text-gray-600">Payment: {paymentLabel(order)}</p>
        </div>
        {orderNotes(order).map((note) => <p key={note} className="text-xs text-charcoal">{note}</p>)}
        <div className="flex flex-wrap gap-2">
          <OrderActions order={order} onCancel={onCancel} onReturn={onReturn} />
          <button type="button" onClick={onDetails} className={quietButton}>Details</button>
          <button type="button" onClick={onReceipt} className={quietButton}>Receipt</button>
          <button type="button" onClick={() => navigate(`/track?order=${encodeURIComponent(order.orderNumber)}`)} className={quietButton}>
            Track Order
          </button>
        </div>
      </div>
      <ul aria-label={`Items in order ${order.orderNumber}`} className="space-y-2 border-t border-light-gray px-4 py-3">
        {order.items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 text-sm">
            {item.productImage && <ResponsiveImage url={item.productImage} preset="thumbnail" alt="" className="h-12 w-12 shrink-0 rounded-sm object-cover" />}
            <div className="min-w-0 flex-1">
              <p className="font-medium text-brand-primary">{item.productName}</p>
              <p className="text-xs text-gray-600">
                Qty {item.quantity}
                {item.variantAttributes && Object.values(item.variantAttributes).length > 0 && ` · ${Object.values(item.variantAttributes).join(" / ")}`}
              </p>
            </div>
            <p className="shrink-0 font-semibold">{formatKES(item.subtotal)}</p>
          </li>
        ))}
      </ul>
    </li>
  );
}

function CustomerReturns({ returns, onWithdraw }: { returns: OrderReturn[]; onWithdraw: (item: OrderReturn) => void }) {
  return (
    <ul className="space-y-3">
      {returns.map((item) => (
        <li key={item.id} className="rounded-md border border-light-gray p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="font-mono text-sm font-bold text-brand-primary">{item.number}</p>
            <p className="text-sm font-semibold">{RETURN_STATUS_TEXT[item.status]}</p>
          </div>
          <p className="text-xs text-gray-600">
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
          {item.comment && <p className="mt-2 text-xs">Your comment: {item.comment}</p>}
          {item.decisionNote && <p className="mt-2 text-xs">Note from staff: {item.decisionNote}</p>}
          {item.inspectionNote && <p className="mt-2 text-xs">Inspection note: {item.inspectionNote}</p>}
          {item.status === "RECEIVED" && item.merchantFaultConfirmed !== null && (
            <p className="mt-2 text-xs">{item.merchantFaultConfirmed ? "Staff confirmed the item was faulty, damaged or wrong." : "Staff did not find a fault."}</p>
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
    <ul className="space-y-3">
      {order.refunds.map((refund) => (
        <li key={refund.id} className="rounded-md border border-light-gray p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="font-semibold text-brand-primary">{formatKES(refund.amount)}</p>
            <p className="text-xs text-gray-600">{REFUND_SOURCE_TEXT[refund.source]}</p>
          </div>
          <p className="mt-1 text-sm">{refundStatusText(refund)}</p>
          <p className="text-xs text-gray-600">
            Requested {formatDateTime(refund.requestedAt)}{refund.includesDeliveryFee ? " · includes the delivery fee" : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Receipt with summary, payment and the next permitted action first; history, returns and refunds are disclosed. */
function OrderDetails({ order, user, notice, closeRef, onClose, onCancel, onReturn, onWithdraw, onPaymentSummary, onPrint }: {
  order: CustomerOrder;
  user: User | null;
  notice: Notice | null;
  closeRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onCancel: () => void;
  onReturn: () => void;
  onWithdraw: (item: OrderReturn) => void;
  onPaymentSummary: (summary: PaymentOrderSummary) => void;
  onPrint: () => void;
}) {
  const { policy } = order.returnEligibility;
  const rules = new Map(order.returnEligibility.lines.map((line) => [line.orderItemId, line.returnRule]));
  const windowNote = order.status === "CANCELLED" ? null : returnWindowText(order.returnEligibility);
  const notes = orderNotes(order).filter((note) => note !== windowNote);
  return (
    <ModalDialog open label="Receipt Details" onClose={onClose}>
      <div className="relative max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-lg bg-white p-5 shadow-xl [overflow-wrap:anywhere] sm:p-6 md:max-w-4xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-display text-xl text-brand-primary">Receipt Details</h3>
            <p className="font-mono text-sm text-gray-600">{order.orderNumber}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="min-h-11 px-2 text-gray-600 hover:text-brand-primary">Close</button>
        </div>
        <NoticeArea notice={notice} />

        <section aria-label="Order summary" className="mt-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <OrderStatusBadge order={order} />
            <p className="text-2xl font-semibold tabular-nums text-navy-900">{formatKES(order.total)}</p>
          </div>
          <p className="text-sm"><span className="text-gray-600">Payment:</span> {paymentLabel(order)}</p>
          {notes.map((note) => <p key={note} className="text-sm text-charcoal">{note}</p>)}
          {windowNote && <p className="text-sm text-charcoal">{windowNote}</p>}
          {order.customerActions.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 md:flex md:flex-wrap">
              <OrderActions order={order} onCancel={onCancel} onReturn={onReturn} />
            </div>
          )}
        </section>

        {/* Only quote-based orders can be paid online; one panel, for the open receipt only, at full width. */}
        {order.quoteId && (
          <div className="mt-5">
            <PaymentPanel key={order.status} orderId={order.id} onOrderChange={onPaymentSummary} headingLevel={4} />
          </div>
        )}

        <div className="mt-5 grid gap-5 md:grid-cols-2 md:items-start">
          <section aria-label="Order details" className="space-y-4">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
              <dt className="text-gray-600">Customer</dt><dd>{customerName(user)}</dd>
              <dt className="text-gray-600">Email</dt><dd>{user?.email ?? ""}</dd>
              <dt className="text-gray-600">Delivery</dt><dd>{DELIVERY_LABELS[order.deliveryMethod]} · {deliveryAddress(order)}</dd>
              {order.trackingNumber && <><dt className="text-gray-600">Tracking</dt><dd className="font-mono">{order.trackingNumber}</dd></>}
            </dl>
            <Disclosure title="Items and totals" summary={`${order.items.length} ${order.items.length === 1 ? "item" : "items"}`}>
              <ul className="space-y-2">
                {order.items.map((item) => (
                  <li key={item.id}>
                    <div className="flex justify-between gap-3">
                      <span>{item.quantity} × {item.productName}</span>
                      <span className="shrink-0 font-semibold">{formatKES(item.subtotal)}</span>
                    </div>
                    {rules.has(item.id) && <p className="text-xs text-gray-600">{returnRuleText(rules.get(item.id) ?? "STANDARD", policy.windowDays)}</p>}
                  </li>
                ))}
              </ul>
              <div className="mt-3 border-t border-light-gray pt-3"><OrderTotals order={order} /></div>
            </Disclosure>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => navigate(`/track?order=${encodeURIComponent(order.orderNumber)}`)} className={outlineButton}>
                Track Order
              </button>
              <button type="button" onClick={onPrint} className={outlineButton}>Print Receipt</button>
            </div>
          </section>

          <section aria-label="Order history, returns and refunds" className="space-y-3">
            <Disclosure title="Progress">
              <OrderProgress order={order} fulfilment={order.fulfilment} />
              <h4 className="mt-4 font-body text-[11px] font-bold uppercase tracking-[0.12em] text-brand-primary">Updates</h4>
              <div className="mt-2"><OrderTimeline events={order.trackingHistory} /></div>
            </Disclosure>
            {order.returns.length > 0 && (
              <Disclosure title="Returns" summary={String(order.returns.length)}>
                <CustomerReturns returns={order.returns} onWithdraw={onWithdraw} />
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
  return <AccountOrdersContent key={user?.id ?? "guest"} user={user} />;
}

/** Moves focus to `target` only when an update removed the control that had it. */
function rescueFocus(target: HTMLElement | null) {
  const active = document.activeElement;
  if (!active || active === document.body || active.tagName === "DIALOG" || !active.isConnected) target?.focus();
}

function AccountOrdersContent({ user }: { user: User | null }) {
  const { brandName } = useStorefront();
  const [orders, setOrders] = useState<OrdersState>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
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

  if (orders.status === "loading") return <LoadingPanel label="Loading your orders…" />;
  if (orders.status === "error") return <ErrorPanel title="Orders are unavailable" message={orders.message} onRetry={retry} />;

  if (orders.orders.length === 0) {
    return (
      <div className="py-12 text-center">
        <h2 className="font-display text-2xl text-brand-primary">Orders & Receipts</h2>
        <p className="mt-3 text-sm text-gray-600">No orders yet. Orders you place will appear here.</p>
        <Link to="/shop" className="mt-5 inline-block rounded-sm bg-brand-primary px-6 py-3 text-xs font-bold uppercase tracking-[0.12em] text-white hover:bg-brand-secondary hover:text-brand-primary">
          Start Shopping
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 ref={pageHeading} tabIndex={-1} className="font-display text-2xl text-brand-primary">Orders & Receipts</h2>
          <p className="mt-1 text-sm text-gray-600">Track orders, request returns, reprint receipts and follow refunds.</p>
        </div>
        <Link to="/track" className="inline-flex min-h-11 items-center rounded-sm border border-brand-primary px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-brand-primary hover:bg-brand-primary hover:text-white">
          Track an Order
        </Link>
      </div>

      {!selected && <NoticeArea notice={notice} />}

      <ul className="mt-6 space-y-4">
        {orders.orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            onDetails={() => openModal(setSelectedId, order)}
            onReceipt={() => printReceipt(order, user, brandName)}
            onCancel={() => openModal(setCancelId, order)}
            onReturn={() => openModal(setReturnId, order)}
          />
        ))}
      </ul>

      {selected && (
        <OrderDetails
          order={selected}
          user={user}
          notice={notice}
          closeRef={detailsClose}
          onClose={() => { setSelectedId(null); setNotice(null); }}
          onCancel={() => setCancelId(selected.id)}
          onReturn={() => setReturnId(selected.id)}
          onWithdraw={(item) => setWithdrawal({ orderId: selected.id, item })}
          onPaymentSummary={applyPaymentSummary}
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
        confirmLabel={withdrawing ? "Withdrawing…" : "Withdraw Request"}
        cancelLabel="Keep Request"
        tone="danger"
        confirmDisabled={withdrawing}
        onConfirm={() => void withdraw()}
        onCancel={() => { if (!withdrawing) setWithdrawal(null); }}
      />
    </div>
  );
}
