import { isCancel } from "axios";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { adminAPI, type RefundAction, type StaffAction, type StaffOrder, type StaffRefund } from "../../api/admin";
import { describeApiError } from "../../api/errors";
import { Disclosure, OrderStatusBadge, OrderTimeline, OrderTotals } from "../../components/OrderRecords";
import { DELIVERY_LABELS } from "../../store/checkoutModel";
import { STAFF_ACTION_LABELS, paymentLabel, returnRuleText, returnWindowText } from "../../store/orderCopy";
import { OrderFormatError, parseStaffOrder } from "../../store/orderModel";
import { formatDateTime, formatKES } from "../../utils/format";
import { OrderActionDialog, RefundActionDialog, type ActionOutcome } from "./OperationDialogs";
import { OrderPayments, RefundRequestOptions, StaffRefundCard } from "./RefundRecords";
import { StaffReturnCard } from "./ReturnReview";
import { Feedback } from "./shared";

/** Where to take the staff member inside the order once it loads. */
export type WorkspaceFocus = { kind: "return" | "refund"; id: string } | { kind: "payments" } | null;

type LoadState = { status: "loading" } | { status: "ready"; order: StaffOrder } | { status: "error"; message: string };
type OpenDialog = { kind: "order"; action: StaffAction } | { kind: "refund"; refund: StaffRefund; action: RefundAction };

const toolClass = "min-h-11 rounded-sm border border-brand-primary px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-brand-primary hover:bg-brand-primary hover:text-white";
const stepClass = "min-h-11 rounded-sm bg-brand-primary px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary";
const cancelClass = "min-h-11 rounded-sm border border-error px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-error hover:bg-error hover:text-white";
const sectionClass = "rounded-lg bg-white p-4 shadow-sm sm:p-5";
const sectionTitle = "font-body text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary";

/** Why no fulfilment step is offered, so staff know what the order is waiting for. */
function waitingFor(order: StaffOrder) {
  if (order.paymentReviewOpen) return "Resolve the payment review before any fulfilment step.";
  if (order.status === "CANCELLED") return "This order is cancelled.";
  if (order.status === "DELIVERED") return "This order is complete. Returns and refunds are handled below.";
  if (order.status === "PENDING" && order.paymentStatus !== "PAID") return "Waiting for a confirmed payment.";
  return "No fulfilment step is available for this order now.";
}

function describeLoadError(error: unknown) {
  return error instanceof OrderFormatError ? `${error.message} Try again shortly.` : describeApiError(error, "This order could not be loaded.");
}

/** Moves focus only when an update removed the control that had it. */
function rescueFocus(target: HTMLElement | null) {
  const active = document.activeElement;
  if (!active || active === document.body || active.tagName === "DIALOG" || !active.isConnected) target?.focus();
}

/** A record's focus target id, scoped to one workspace so list copies of the record never share it. */
const recordAnchor = (scope: string, kind: "return" | "refund", id: string) => `${scope}-${kind}-${id}`;

/**
 * One order: summary, payment state and the permitted next step first, then items, payments, timeline,
 * returns and refunds. Every control comes from the server's permitted actions; viewers see no controls.
 */
export function OrderWorkspace({ orderId, focus, canWrite, onBack, onChanged, showToast }: {
  orderId: string;
  focus: WorkspaceFocus;
  canWrite: boolean;
  onBack: () => void;
  /** Called after any change so worklists and the attention feed reload. */
  onChanged: () => void;
  showToast: (message: string) => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [problem, setProblem] = useState("");
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const loads = useRef(0);
  const targetFocused = useRef(false);
  const headingId = useId();

  /** Loads the order; `notice` explains why it was reloaded and stays visible afterwards. */
  const reload = useCallback(async (notice = "") => {
    const ticket = ++loads.current;
    try {
      const { data } = await adminAPI.orders.get(orderId);
      const order = parseStaffOrder(data, orderId);
      if (ticket !== loads.current) return;
      setState({ status: "ready", order });
      setProblem(notice);
    } catch (error) {
      if (ticket !== loads.current || isCancel(error)) return;
      const message = describeLoadError(error);
      setState((current) => (current.status === "ready" ? current : { status: "error", message }));
      setProblem(notice ? `${notice} Reloading failed: ${message}` : message);
    }
  }, [orderId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useLayoutEffect(() => {
    heading.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (state.status !== "ready" || targetFocused.current || !focus || focus.kind === "payments") return;
    targetFocused.current = true;
    document.getElementById(recordAnchor(headingId, focus.kind, focus.id))?.focus();
  }, [state.status, focus, headingId]);

  useLayoutEffect(() => {
    if (focusRequest) rescueFocus(heading.current);
  }, [focusRequest]);

  const handleOutcome = (outcome: ActionOutcome) => {
    setDialog(null);
    if (outcome.kind === "done") {
      loads.current += 1; // An older reload still in flight would show the order as it was before this change.
      setState({ status: "ready", order: outcome.order });
      setProblem("");
      showToast(outcome.message);
    } else {
      setProblem(outcome.message);
      void reload(outcome.message);
    }
    onChanged();
    setFocusRequest((count) => count + 1);
  };

  const order = state.status === "ready" ? state.order : null;
  const customer = order?.user ? `${order.user.firstName} ${order.user.lastName}`.trim() : "";

  return (
    <section aria-labelledby={headingId} className="space-y-4 [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={onBack} className={toolClass}>← Back to orders</button>
        <button type="button" onClick={() => void reload()} className={toolClass}>Reload order</button>
      </div>

      <div className={sectionClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id={headingId} ref={heading} tabIndex={-1} className="font-display text-xl text-brand-primary">
              {order ? `Order ${order.orderNumber}` : "Order details"}
            </h3>
            {order && (
              <>
                <p className="text-xs text-gray-600">{[customer, order.user?.email].filter(Boolean).join(" · ") || "Customer details unavailable"}</p>
                <p className="text-xs text-gray-600">
                  Placed {formatDateTime(order.createdAt)} · {DELIVERY_LABELS[order.deliveryMethod]}
                  {order.trackingNumber && ` · Tracking ${order.trackingNumber}`}
                </p>
              </>
            )}
          </div>
          {order && (
            <div className="flex flex-col items-start gap-1.5 sm:items-end">
              <p className="font-display text-2xl text-brand-primary">{formatKES(order.total)}</p>
              <div className="flex flex-wrap gap-2">
                <OrderStatusBadge order={order} />
                <span className="rounded-full bg-off-white px-3 py-1 text-xs font-semibold text-charcoal">Payment: {paymentLabel(order)}</span>
              </div>
            </div>
          )}
        </div>
        {order?.paymentReviewOpen && (
          <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm font-semibold text-charcoal">
            A payment on this order is under review. Fulfilment is blocked until the review is resolved; see M-Pesa payments below.
          </p>
        )}
        {order?.isDemo && <p className="mt-3 text-xs text-ocean-blue-dark">Demo order: sample data for review, not a real sale.</p>}
        {state.status === "loading" && <p role="status" className="mt-3 text-sm text-gray-600">Loading order…</p>}
      </div>

      <Feedback message={problem} tone="error" />

      {order && (
        <>
          <section aria-labelledby={`${headingId}-next`} className={sectionClass}>
            <h4 id={`${headingId}-next`} className={sectionTitle}>Next step</h4>
            {!canWrite ? (
              <p className="mt-2 text-sm text-charcoal">View only: your role can see this order but cannot change it.</p>
            ) : order.allowedActions.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {order.allowedActions.map((action) => (
                  <button key={action} type="button" onClick={() => setDialog({ kind: "order", action })} className={action === "CANCEL" ? cancelClass : stepClass}>
                    {STAFF_ACTION_LABELS[action]}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-charcoal">{waitingFor(order)}</p>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2 lg:items-start xl:grid-cols-3">
            <Disclosure title="Items and totals" summary={`${order.items.length} ${order.items.length === 1 ? "item" : "items"}`}>
              <ul className="space-y-2">
                {order.items.map((item) => {
                  const line = order.returnEligibility.lines.find((entry) => entry.orderItemId === item.id);
                  return (
                    <li key={item.id}>
                      <div className="flex justify-between gap-3">
                        <span>{item.quantity} × {item.productName}{item.sku ? <span className="block font-mono text-[11px] text-gray-600">{item.sku}</span> : null}</span>
                        <span className="shrink-0 font-semibold">{formatKES(item.subtotal)}</span>
                      </div>
                      {line && <p className="text-xs text-gray-600">{returnRuleText(line.returnRule, order.returnEligibility.policy.windowDays)}</p>}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 border-t border-light-gray pt-3"><OrderTotals order={order} /></div>
              {order.address && (
                <p className="mt-3 text-xs text-gray-600">Deliver to: {order.address.street}, {order.address.city}, {order.address.county}</p>
              )}
            </Disclosure>

            <div className="rounded-md border border-light-gray bg-white p-3">
              <OrderPayments order={order} canWrite={canWrite} onOutcome={handleOutcome}
                defaultOpen={focus?.kind === "payments" || order.paymentReviewOpen} />
            </div>

            <Disclosure title="Timeline" summary={`${order.trackingHistory.length} ${order.trackingHistory.length === 1 ? "update" : "updates"}`}>
              <OrderTimeline events={order.trackingHistory} label="Order timeline" />
            </Disclosure>
          </div>

          <Disclosure title="Returns" summary={String(order.returns.length)} defaultOpen={focus?.kind === "return"}>
            <p className="mb-3 text-xs text-gray-600">{returnWindowText(order.returnEligibility) ?? "No return window is open."}</p>
            {order.returns.length ? (
              <ul className="space-y-3">
                {order.returns.map((item) => (
                  <StaffReturnCard key={item.id} order={order} item={item} canWrite={canWrite}
                    anchorId={recordAnchor(headingId, "return", item.id)} onOutcome={handleOutcome} />
                ))}
              </ul>
            ) : <p className="text-sm text-gray-600">No returns have been requested for this order.</p>}
          </Disclosure>

          <Disclosure title="Refunds" summary={String(order.refunds.length)} defaultOpen={focus?.kind === "refund" || order.refundRequestOptions.length > 0}>
            <div className="space-y-3">
              <RefundRequestOptions order={order} canWrite={canWrite} onOutcome={handleOutcome} />
              {order.refunds.length ? (
                <ul className="space-y-3">
                  {order.refunds.map((refund) => (
                    <StaffRefundCard key={refund.id} refund={refund} canWrite={canWrite} anchorId={recordAnchor(headingId, "refund", refund.id)}
                      onAction={(action) => setDialog({ kind: "refund", refund, action })} />
                  ))}
                </ul>
              ) : <p className="text-sm text-gray-600">No refunds have been recorded for this order.</p>}
            </div>
          </Disclosure>
        </>
      )}

      {order && dialog?.kind === "order" && (
        <OrderActionDialog order={order} action={dialog.action} onClose={() => setDialog(null)} onOutcome={handleOutcome} />
      )}
      {dialog?.kind === "refund" && (
        <RefundActionDialog refund={dialog.refund} action={dialog.action} onClose={() => setDialog(null)} onOutcome={handleOutcome} />
      )}
    </section>
  );
}
