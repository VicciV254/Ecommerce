import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AttentionItem, StaffOrderFilters } from "../../api/admin";
import type { OrderStatus, PaymentStatus } from "../../api/orders";
import { DELIVERY_LABELS, DELIVERY_METHODS, isDeliveryMethod, isOrderStatus, isPaymentStatus } from "../../store/checkoutModel";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from "../../store/orderCopy";
import { AttentionPanel } from "./AttentionPanel";
import { OrderQueue, RefundsQueue, ReturnsQueue, type OpenTarget } from "./OrderWorklists";
import { OrderWorkspace } from "./OrderWorkspace";
import { Field } from "./shared";

/** Roles the server lets change orders, returns, refunds and emails; viewers read only. */
const WRITE_ROLES = ["ADMIN", "SUPER_ADMIN"];
const VIEWS = [
  ["action", "Needs action"],
  ["all", "All orders"],
  ["closed", "Closed"],
  ["returns", "Returns"],
  ["refunds", "Refunds"],
] as const;
type View = (typeof VIEWS)[number][0];
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
 * Staff order operations: what needs attention, server-filtered worklists and one order's workspace.
 * Only server-permitted actions are offered, and only to roles that may write.
 */
export function OrdersManager({ role, showToast }: { role: string; showToast: (message: string) => void }) {
  const canWrite = WRITE_ROLES.includes(role);
  const [view, setView] = useState<View>("action");
  const [target, setTarget] = useState<OpenTarget | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [deliveryMethod, setDeliveryMethod] = useState("");
  const [orderedDay, setOrderedDay] = useState("");
  const [status, setStatus] = useState<OrderStatus | "">("");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | "">("");
  const trigger = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const returning = useRef(false);
  const headingId = useId();

  const shared = useMemo<StaffOrderFilters>(() => ({
    ...(deliveryMethod && { deliveryMethod }),
    ...(orderedDay && { orderedDay }),
  }), [deliveryMethod, orderedDay]);
  const queues = useMemo(() => {
    const scoped = (list: Queue[]) => list.map((queue) => ({ ...queue, filters: { ...queue.filters, ...shared } }));
    if (view === "action") return scoped(ACTION_QUEUES);
    if (view === "closed") return scoped(CLOSED_QUEUES);
    if (view === "all") {
      return [{
        title: "All orders",
        filters: { ...shared, ...(status && { status }), ...(paymentStatus && { paymentStatus }) },
        empty: "No orders match these filters.",
      }];
    }
    return [];
  }, [view, shared, status, paymentStatus]);

  const changed = () => setReloadToken((value) => value + 1);
  const open = (next: OpenTarget, from: HTMLElement) => {
    trigger.current = from;
    setTarget(next);
  };
  const back = () => {
    returning.current = true;
    setTarget(null);
  };

  // Back from the workspace: return focus to the control that opened it, or to this section's heading.
  useLayoutEffect(() => {
    if (target || !returning.current) return;
    returning.current = false;
    if (trigger.current?.isConnected) trigger.current.focus();
    else heading.current?.focus();
  }, [target]);

  return (
    <div className="space-y-4">
      <div hidden={Boolean(target)} className="space-y-4">
        <AttentionPanel canWrite={canWrite} reloadToken={reloadToken} onOpen={(item, from) => {
          const next = attentionTarget(item);
          if (next) open(next, from);
        }} />

        <section aria-labelledby={headingId} className="rounded-lg bg-white p-4 shadow-sm sm:p-5">
          <h3 id={headingId} ref={heading} tabIndex={-1} className="font-body text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Orders</h3>
          <p className="mt-1 text-xs text-gray-600">
            {canWrite
              ? "Confirm each fulfilment step, review returns and record manual M-Pesa refunds. Only the steps the order allows are offered."
              : "View only: your role can see orders, returns and refunds but cannot change them."}
          </p>
          <nav aria-label="Order worklists" className="no-scrollbar mt-4 flex gap-1 overflow-x-auto border-b border-light-gray">
            {VIEWS.map(([value, label]) => (
              <button key={value} type="button" aria-current={view === value ? "page" : undefined} onClick={() => setView(value)}
                className={`min-h-11 whitespace-nowrap px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] ${
                  view === value ? "border-b-2 border-brand-primary text-brand-primary" : "text-gray-600 hover:text-charcoal"
                }`}>
                {label}
              </button>
            ))}
          </nav>
          {(view === "action" || view === "all" || view === "closed") && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          )}
        </section>

        {queues.map((queue) => (
          <OrderQueue key={`${view}:${queue.title}:${JSON.stringify(queue.filters)}`} title={queue.title} filters={queue.filters}
            emptyText={queue.empty} reloadToken={reloadToken} canWrite={canWrite} onOpen={open} onChanged={changed} showToast={showToast} />
        ))}
        {view === "returns" && <ReturnsQueue reloadToken={reloadToken} onOpen={open} />}
        {view === "refunds" && <RefundsQueue reloadToken={reloadToken} canWrite={canWrite} onOpen={open} onChanged={changed} showToast={showToast} />}
      </div>

      {target && (
        <OrderWorkspace key={target.orderId} orderId={target.orderId} focus={target.focus} canWrite={canWrite}
          onBack={back} onChanged={changed} showToast={showToast} />
      )}
    </div>
  );
}
