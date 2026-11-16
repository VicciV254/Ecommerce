import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AttentionItem, StaffOrderFilters } from "../../api/admin";
import type { OrderStatus, PaymentStatus } from "../../api/orders";
import { Link, navigate, useRouteState } from "../../router";
import { DELIVERY_LABELS, DELIVERY_METHODS, isDeliveryMethod, isOrderStatus, isPaymentStatus } from "../../store/checkoutModel";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "../../store/orderCopy";
import { ORDER_VIEWS, ordersRoute, parseOrdersParams, type OrdersModuleId } from "./adminRoutes";
import { AttentionPanel } from "./AttentionPanel";
import { OrderQueue, RefundsQueue, ReturnsQueue, type OpenTarget } from "./OrderWorklists";
import { OrderWorkspace } from "./OrderWorkspace";
import { Field } from "./shared";

const ORDER_NOT_FOUND = "That order wasn't found.";
type Queue = { title: string; filters: StaffOrderFilters; empty: string };

const ACTION_QUEUES: Queue[] = [
  { title: "Paid — ready to start", filters: { status: "PENDING", paymentStatus: "PAID" }, empty: "No paid orders are waiting to be started." },
  { title: "Processing", filters: { status: "PROCESSING" }, empty: "No orders are being prepared." },
  { title: "Ready for pickup", filters: { status: "READY_FOR_PICKUP" }, empty: "No orders are waiting to be collected." },
  { title: "Dispatched — confirm delivery", filters: { status: "SHIPPED" }, empty: "No dispatched orders are waiting for delivery confirmation." },
];
const CLOSED_QUEUES: Queue[] = [
  { title: "Delivered or collected", filters: { status: "DELIVERED" }, empty: "No delivered orders match these filters." },
  { title: "Cancelled", filters: { status: "CANCELLED" }, empty: "No cancelled orders match these filters." },
];
const ORDER_STATUS_OPTIONS = Object.keys(ORDER_STATUS_LABELS).filter(isOrderStatus);
const PAYMENT_STATUS_OPTIONS = Object.keys(PAYMENT_STATUS_LABELS).filter(isPaymentStatus);
const selectClass = "min-h-11 w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm";

/** Where an attention item leads inside its order. */
function attentionTarget(item: AttentionItem): OpenTarget | null {
  if (!item.orderId) return null;
  switch (item.type) {
    case "RETURN_AWAITING_DECISION":
    case "RETURN_AWAITING_RECEIPT":
      return { orderId: item.orderId, focus: { kind: "return", id: item.entityId } };
    case "REFUND_ACTION":
      return { orderId: item.orderId, focus: { kind: "refund", id: item.entityId } };
    case "PAYMENT_REVIEW":
      return { orderId: item.orderId, focus: { kind: "payments" } };
    default:
      return { orderId: item.orderId, focus: null };
  }
}

/**
 * Staff order operations for the Orders, Returns and Refunds modules: what needs attention, server-filtered worklists
 * and one order's workspace. The Orders view and the open order live in the address (`view`, `order`), so refresh,
 * deep links and Back/Forward keep them. Only server-permitted actions are offered, and only to roles that may write.
 */
export function OrdersManager({ module = "orders", canWrite, showToast }: {
  module?: OrdersModuleId;
  canWrite: boolean;
  showToast: (message: string) => void;
}) {
  const { route, kind } = useRouteState();
  const { view, unknownView, order } = parseOrdersParams(module, route);
  const orderId = order.id;
  const [opened, setOpened] = useState<OpenTarget | null>(null);
  const [notice, setNotice] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [deliveryMethod, setDeliveryMethod] = useState("");
  const [orderedDay, setOrderedDay] = useState("");
  const [status, setStatus] = useState<OrderStatus | "">("");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | "">("");
  const trigger = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const returning = useRef(false);
  const shownOrder = useRef<string | null>(null);
  const headingId = useId();

  // An unknown view reads as Needs action, and a malformed order id is never sent: the address is corrected in place.
  useEffect(() => {
    if (!unknownView && !order.malformed) return;
    if (order.malformed) setNotice(ORDER_NOT_FOUND);
    navigate(ordersRoute(module, { view, order: orderId }), { replace: true });
  }, [module, unknownView, order.malformed, view, orderId]);

  const shared = useMemo<StaffOrderFilters>(() => ({
    ...(deliveryMethod && { deliveryMethod }),
    ...(orderedDay && { orderedDay }),
  }), [deliveryMethod, orderedDay]);
  const queues = useMemo(() => {
    if (module !== "orders") return [];
    const scoped = (list: Queue[]) => list.map((queue) => ({ ...queue, filters: { ...queue.filters, ...shared } }));
    if (view === "needs-action") return scoped(ACTION_QUEUES);
    if (view === "closed") return scoped(CLOSED_QUEUES);
    return [{
      title: "All orders",
      filters: { ...shared, ...(status && { status }), ...(paymentStatus && { paymentStatus }) },
      empty: "No orders match these filters.",
    }];
  }, [module, view, shared, status, paymentStatus]);

  const changed = () => setReloadToken((value) => value + 1);
  // Opening an order adds a history entry, so Back closes it again.
  const open = (next: OpenTarget, from: HTMLElement) => {
    trigger.current = from;
    setOpened(next);
    setNotice("");
    navigate(ordersRoute(module, { view, order: next.orderId }));
  };
  const back = () => {
    returning.current = true;
    navigate(ordersRoute(module, { view }), { replace: true });
  };
  const missing = () => {
    setNotice(ORDER_NOT_FOUND);
    navigate(ordersRoute(module, { view }), { replace: true });
  };

  // Leaving the workspace (its Back button, browser Back, or an order that wasn't found): focus returns to the control
  // that opened it, or to this section's heading, but only if it was opened here or the staff member closed it.
  useLayoutEffect(() => {
    const previous = shownOrder.current;
    shownOrder.current = orderId;
    if (orderId || !previous) return;
    const restore = returning.current || kind === "traverse" || opened?.orderId === previous;
    returning.current = false;
    if (!restore) return;
    if (trigger.current?.isConnected) trigger.current.focus();
    else heading.current?.focus();
  }, [orderId, kind, opened]);

  const viewOnly = "View only: your role can see orders, returns and refunds but cannot change them.";
  return (
    <div className="space-y-4">
      {notice && <p role="status" className="rounded-md border border-warning/40 bg-warning-tint p-3 text-sm font-semibold text-navy-900">{notice}</p>}
      <div hidden={Boolean(orderId)} className="space-y-4">
        <AttentionPanel canWrite={canWrite} reloadToken={reloadToken} onOpen={(item, from) => {
          const next = attentionTarget(item);
          if (next) open(next, from);
        }} />

        <section aria-labelledby={headingId} className="rounded-lg bg-white p-4 shadow-sm sm:p-5">
          <h3 id={headingId} ref={heading} tabIndex={-1} className="font-body text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">
            {module === "orders" ? "Orders" : module === "returns" ? "Returns" : "Refunds"}
          </h3>
          <p className="mt-1 text-xs text-gray-600">
            {canWrite
              ? "Confirm each fulfilment step, review returns and record manual M-Pesa refunds. Only the steps the order allows are offered."
              : viewOnly}
          </p>
          {module === "orders" && (
            <>
              <nav aria-label="Order worklists" className="mt-4 flex flex-wrap gap-1 border-b border-light-gray">
                {ORDER_VIEWS.map((item) => (
                  <Link key={item.id} to={ordersRoute("orders", { view: item.id })} replace aria-current={view === item.id ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center whitespace-nowrap px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] ${
                      view === item.id ? "border-b-2 border-brand-primary text-brand-primary" : "text-gray-600 hover:text-charcoal"
                    }`}>
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3">
                <Field label="Delivery">
                  {(id) => (
                    <select id={id} value={deliveryMethod} onChange={(event) => setDeliveryMethod(isDeliveryMethod(event.target.value) ? event.target.value : "")} className={selectClass}>
                      <option value="">All delivery methods</option>
                      {DELIVERY_METHODS.map((method) => <option key={method} value={method}>{DELIVERY_LABELS[method]}</option>)}
                    </select>
                  )}
                </Field>
                <Field label="Ordered on">
                  {(id) => <input id={id} type="date" value={orderedDay} onChange={(event) => setOrderedDay(event.target.value)} className={selectClass} />}
                </Field>
                {view === "all" && (
                  <>
                    <Field label="Order status">
                      {(id) => (
                        <select id={id} value={status} onChange={(event) => setStatus(isOrderStatus(event.target.value) ? event.target.value : "")} className={selectClass}>
                          <option value="">All statuses</option>
                          {ORDER_STATUS_OPTIONS.map((value) => <option key={value} value={value}>{ORDER_STATUS_LABELS[value]}</option>)}
                        </select>
                      )}
                    </Field>
                    <Field label="Payment">
                      {(id) => (
                        <select id={id} value={paymentStatus} onChange={(event) => setPaymentStatus(isPaymentStatus(event.target.value) ? event.target.value : "")} className={selectClass}>
                          <option value="">All payments</option>
                          {PAYMENT_STATUS_OPTIONS.map((value) => <option key={value} value={value}>{PAYMENT_STATUS_LABELS[value]}</option>)}
                        </select>
                      )}
                    </Field>
                  </>
                )}
              </div>
            </>
          )}
        </section>

        {queues.map((queue) => (
          <OrderQueue key={`${view}:${queue.title}:${JSON.stringify(queue.filters)}`} title={queue.title} filters={queue.filters}
            emptyText={queue.empty} reloadToken={reloadToken} canWrite={canWrite} onOpen={open} onChanged={changed} showToast={showToast} />
        ))}
        {module === "returns" && <ReturnsQueue reloadToken={reloadToken} onOpen={open} />}
        {module === "refunds" && <RefundsQueue reloadToken={reloadToken} canWrite={canWrite} onOpen={open} onChanged={changed} showToast={showToast} />}
      </div>

      {orderId && (
        <OrderWorkspace key={orderId} orderId={orderId} focus={opened?.orderId === orderId ? opened.focus : null} canWrite={canWrite}
          focusOnOpen={kind !== "load"} onBack={back} onMissing={missing} onChanged={changed} showToast={showToast} />
      )}
    </div>
  );
}
