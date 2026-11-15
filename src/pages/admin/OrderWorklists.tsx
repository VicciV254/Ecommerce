import { useCallback, useEffect, useId, useState } from "react";
import {
  adminAPI,
  type ListedRefund,
  type RefundAction,
  type RefundPage,
  type ReturnPage,
  type StaffAction,
  type StaffOrder,
  type StaffOrderFilters,
  type StaffOrderPage,
  type StaffRefund,
} from "../../api/admin";
import { describeApiError } from "../../api/errors";
import type { Pagination, RefundStatus, ReturnStatus } from "../../api/orders";
import { OrderStatusBadge } from "../../components/OrderRecords";
import { DELIVERY_LABELS } from "../../store/checkoutModel";
import { RETURN_REASON_LABELS, STAFF_ACTION_LABELS, STAFF_REFUND_STATUS, STAFF_RETURN_STATUS, paymentLabel } from "../../store/orderCopy";
import {
  OrderFormatError,
  REFUND_STATUSES,
  RETURN_STATUSES,
  isRefundStatus,
  isReturnStatus,
  parseRefundPage,
  parseReturnPage,
  parseStaffOrderPage,
} from "../../store/orderModel";
import { formatDateTime, formatKES } from "../../utils/format";
import { OrderActionDialog, RefundActionDialog, type ActionOutcome } from "./OperationDialogs";
import { StaffRefundCard } from "./RefundRecords";
import type { WorkspaceFocus } from "./OrderWorkspace";
import { Feedback, Field } from "./shared";

const PAGE_SIZE = 20;

/** An order to open in the workspace, with the record to bring into view. */
export type OpenTarget = { orderId: string; focus: WorkspaceFocus };
type OpenOrder = (target: OpenTarget, from: HTMLElement) => void;

type LoadState<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string };

const openClass = "min-h-11 rounded-sm border border-light-gray px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-charcoal hover:border-brand-primary hover:text-brand-primary";
const stepClass = "min-h-11 rounded-sm bg-brand-primary px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary";
const cancelClass = "min-h-11 rounded-sm border border-error/50 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-error hover:bg-error hover:text-white";
const selectClass = "min-h-11 w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm";
const sectionClass = "rounded-lg bg-white p-4 shadow-sm sm:p-5";

function describeListError(error: unknown, fallback: string) {
  return error instanceof OrderFormatError ? `${error.message} Try again shortly.` : describeApiError(error, fallback);
}

/**
 * Loads one page whenever the request (a memoized `load`), page or reload token changes; superseded answers
 * are dropped. A page past the end (the list shrank) is replaced by the last page that exists.
 */
function usePage<T extends { pagination: Pagination }>(load: (page: number) => Promise<T>, reloadToken: number, fallback: string) {
  const [page, setPage] = useState(1);
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    load(page)
      .then((data) => {
        if (!current) return;
        const last = Math.max(1, data.pagination.pages);
        if (page <= last) {
          setState({ status: "ready", data });
          return;
        }
        setState({ status: "loading" });
        setPage(last);
      })
      .catch((error: unknown) => { if (current) setState({ status: "error", message: describeListError(error, fallback) }); });
    return () => { current = false; };
  }, [load, page, attempt, reloadToken, fallback]);
  return { setPage, state, setState, retry: () => setAttempt((value) => value + 1) };
}

function countText(pagination: Pagination, noun: [string, string]) {
  const label = pagination.total === 1 ? noun[0] : noun[1];
  if (pagination.pages <= 1) return `${pagination.total} ${label}`;
  const first = (pagination.page - 1) * pagination.limit + 1;
  const last = Math.min(pagination.total, pagination.page * pagination.limit);
  return `${first}–${last} of ${pagination.total} ${label}`;
}

function Pager({ pagination, label, onPage }: { pagination: Pagination; label: string; onPage: (page: number) => void }) {
  if (pagination.pages <= 1) return null;
  const { page, pages } = pagination;
  return (
    <nav aria-label={`${label} pages`} className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <button type="button" aria-disabled={page <= 1} onClick={() => { if (page > 1) onPage(page - 1); }} className={`${openClass} aria-disabled:opacity-50`}>
        Previous
      </button>
      <p className="text-xs text-gray-600">Page {page} of {pages}</p>
      <button type="button" aria-disabled={page >= pages} onClick={() => { if (page < pages) onPage(page + 1); }} className={`${openClass} aria-disabled:opacity-50`}>
        Next
      </button>
    </nav>
  );
}

function ListStatus<T>({ state, onRetry, loadingText }: { state: LoadState<T>; onRetry: () => void; loadingText: string }) {
  if (state.status === "loading") return <p role="status" className="mt-3 text-sm text-gray-600">{loadingText}</p>;
  if (state.status !== "error") return null;
  return (
    <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error">
      <span>{state.message}</span>
      <button type="button" onClick={onRetry} className="min-h-11 font-bold underline">Try again</button>
    </div>
  );
}

function DemoTag() {
  return <span className="ml-2 rounded-full bg-ocean-blue/10 px-2 py-0.5 align-middle font-body text-[10px] font-bold uppercase text-ocean-blue-dark">Demo</span>;
}

/** One order: key fields, then its permitted steps (writers only) and Open. A table row from 1024px. */
function OrderRow({ order, canWrite, onAction, onOpen }: {
  order: StaffOrder;
  canWrite: boolean;
  onAction: (order: StaffOrder, action: StaffAction) => void;
  onOpen: OpenOrder;
}) {
  const customer = order.user ? `${order.user.firstName} ${order.user.lastName}`.trim() : "";
  const openReturns = order.returns.filter((item) => item.status === "REQUESTED" || item.status === "APPROVED").length;
  return (
    <li className="grid gap-3 border-b border-light-gray py-4 first:pt-0 last:border-b-0 last:pb-0 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1.2fr)_minmax(0,1.5fr)] lg:items-center lg:gap-4">
      <div className="min-w-0">
        <p className="font-mono text-sm font-bold text-brand-primary">{order.orderNumber}{order.isDemo && <DemoTag />}</p>
        <p className="text-xs text-gray-600">{customer || order.user?.email || "Customer"}</p>
      </div>
      <p className="text-xs text-gray-600">
        <span className="lg:sr-only">Placed </span>{formatDateTime(order.createdAt)}<br />{DELIVERY_LABELS[order.deliveryMethod]}
      </p>
      <p className="font-semibold text-brand-primary"><span className="sr-only">Total </span>{formatKES(order.total)}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <OrderStatusBadge order={order} />
        <span className="text-xs text-gray-600">{paymentLabel(order)}</span>
        {order.paymentReviewOpen && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">Payment review</span>}
        {openReturns > 0 && <span className="rounded-full bg-coral/10 px-2 py-0.5 text-[11px] font-semibold text-coral">{openReturns} open {openReturns === 1 ? "return" : "returns"}</span>}
      </div>
      <div className="flex flex-wrap gap-2 lg:justify-end">
        {canWrite && order.allowedActions.map((action) => (
          <button key={action} type="button" onClick={() => onAction(order, action)} className={action === "CANCEL" ? cancelClass : stepClass}>
            {STAFF_ACTION_LABELS[action]}<span className="sr-only"> {order.orderNumber}</span>
          </button>
        ))}
        <button type="button" onClick={(event) => onOpen({ orderId: order.id, focus: null }, event.currentTarget)} className={openClass}>
          Open<span className="sr-only"> order {order.orderNumber}</span>
        </button>
      </div>
    </li>
  );
}

/** One server-filtered worklist of orders, with its full-result count and pages. */
export function OrderQueue({ title, filters, emptyText, reloadToken, canWrite, onOpen, onChanged, showToast }: {
  title: string;
  filters: StaffOrderFilters;
  emptyText: string;
  reloadToken: number;
  canWrite: boolean;
  onOpen: OpenOrder;
  onChanged: () => void;
  showToast: (message: string) => void;
}) {
  const titleId = useId();
  const [dialog, setDialog] = useState<{ order: StaffOrder; action: StaffAction } | null>(null);
  const [failure, setFailure] = useState("");
  // `filters` is memoized by the caller, so the request changes only when a filter does.
  const load = useCallback(
    async (current: number) => parseStaffOrderPage((await adminAPI.orders.getAll({ ...filters, page: current, limit: PAGE_SIZE })).data),
    [filters],
  );
  const { setPage, state, retry } = usePage<StaffOrderPage>(load, reloadToken, "Orders could not be loaded.");

  const handleOutcome = (outcome: ActionOutcome) => {
    const order = dialog?.order;
    setDialog(null);
    if (outcome.kind === "done") {
      setFailure("");
      showToast(outcome.message);
    } else {
      setFailure(`${order?.orderNumber ?? "Order"}: ${outcome.message}`);
    }
    onChanged();
  };

  const data = state.status === "ready" ? state.data : null;
  return (
    <section aria-labelledby={titleId} className={sectionClass}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 id={titleId} className="font-body text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">{title}</h4>
        {data && <p className="text-xs font-semibold text-gray-600">{countText(data.pagination, ["order", "orders"])}</p>}
      </div>
      <ListStatus state={state} onRetry={retry} loadingText="Loading orders…" />
      {failure && <div className="mt-3"><Feedback message={failure} tone="error" /></div>}
      {data && !data.orders.length && <p className="mt-3 text-sm text-gray-600">{emptyText}</p>}
      {data && data.orders.length > 0 && (
        <>
          <div aria-hidden="true" className="mt-4 hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1.2fr)_minmax(0,1.5fr)] gap-4 border-b border-light-gray pb-2 text-[10px] font-bold uppercase tracking-wider text-gray-600 lg:grid">
            <span>Order</span><span>Placed · delivery</span><span>Total</span><span>Status</span><span className="text-right">Actions</span>
          </div>
          <ul className="mt-3 lg:mt-0">
            {data.orders.map((order) => (
              <OrderRow key={order.id} order={order} canWrite={canWrite} onOpen={onOpen}
                onAction={(selected, action) => { setFailure(""); setDialog({ order: selected, action }); }} />
            ))}
          </ul>
          <Pager pagination={data.pagination} label={title} onPage={setPage} />
        </>
      )}
      {dialog && <OrderActionDialog order={dialog.order} action={dialog.action} onClose={() => setDialog(null)} onOutcome={handleOutcome} />}
    </section>
  );
}

/** Returns across orders, newest first; decisions and receipts are recorded in the order workspace. */
export function ReturnsQueue({ reloadToken, onOpen }: { reloadToken: number; onOpen: OpenOrder }) {
  const [status, setStatus] = useState<ReturnStatus | "">("");
  const titleId = useId();
  const load = useCallback(
    async (page: number) => parseReturnPage((await adminAPI.returns.getAll({ ...(status && { status }), page, limit: PAGE_SIZE })).data),
    [status],
  );
  const { setPage, state, retry } = usePage<ReturnPage>(load, reloadToken, "Returns could not be loaded.");
  const data = state.status === "ready" ? state.data : null;
  return (
    <section aria-labelledby={titleId} className={sectionClass}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 id={titleId} className="font-body text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Returns</h4>
          {data && <p className="text-xs font-semibold text-gray-600">{countText(data.pagination, ["return", "returns"])}</p>}
        </div>
        <div className="w-full sm:w-64">
          <Field label="Return status">
            {(id) => (
              <select id={id} value={status} onChange={(event) => { setStatus(isReturnStatus(event.target.value) ? event.target.value : ""); setPage(1); }} className={selectClass}>
                <option value="">All returns</option>
                {RETURN_STATUSES.map((value) => <option key={value} value={value}>{STAFF_RETURN_STATUS[value]}</option>)}
              </select>
            )}
          </Field>
        </div>
      </div>
      <ListStatus state={state} onRetry={retry} loadingText="Loading returns…" />
      {data && !data.returns.length && <p className="mt-3 text-sm text-gray-600">No returns match this filter.</p>}
      {data && data.returns.length > 0 && (
        <ul className="mt-3 space-y-3">
          {data.returns.map((item) => (
            <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-light-gray p-3">
              <div className="min-w-0 flex-1 basis-60">
                <p className="font-mono text-sm font-bold text-brand-primary">{item.number}{item.isDemo && <DemoTag />}</p>
                <p className="text-xs text-gray-600">Order {item.orderNumber} · requested {formatDateTime(item.requestedAt)}</p>
                <p className="mt-1 text-sm"><span className="font-semibold">{STAFF_RETURN_STATUS[item.status]}</span> · {RETURN_REASON_LABELS[item.reason]}</p>
                <p className="text-xs text-gray-600">{item.lines.map((line) => `${line.quantity} × ${line.productName}`).join(", ")}</p>
              </div>
              <button type="button" onClick={(event) => onOpen({ orderId: item.orderId, focus: { kind: "return", id: item.id } }, event.currentTarget)} className={openClass}>
                Open<span className="sr-only"> return {item.number}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && <Pager pagination={data.pagination} label="Returns" onPage={setPage} />}
    </section>
  );
}

/** Refunds across orders; permitted steps can be taken here or from the order workspace. */
export function RefundsQueue({ reloadToken, canWrite, onOpen, onChanged, showToast }: {
  reloadToken: number;
  canWrite: boolean;
  onOpen: OpenOrder;
  onChanged: () => void;
  showToast: (message: string) => void;
}) {
  const [status, setStatus] = useState<RefundStatus | "">("");
  const [dialog, setDialog] = useState<{ refund: ListedRefund; action: RefundAction } | null>(null);
  const [failure, setFailure] = useState("");
  const titleId = useId();
  const load = useCallback(
    async (page: number) => parseRefundPage((await adminAPI.refunds.getAll({ ...(status && { status }), page, limit: PAGE_SIZE })).data),
    [status],
  );
  const { setPage, state, setState, retry } = usePage<RefundPage>(load, reloadToken, "Refunds could not be loaded.");

  const handleOutcome = (outcome: ActionOutcome & { refund?: StaffRefund }) => {
    const listed = dialog?.refund;
    setDialog(null);
    if (outcome.kind === "done" && listed && outcome.refund) {
      const updated: ListedRefund = { ...outcome.refund, orderNumber: listed.orderNumber, isDemo: listed.isDemo };
      setState((current) => current.status === "ready"
        ? { status: "ready", data: { ...current.data, refunds: current.data.refunds.map((item) => (item.id === updated.id ? updated : item)) } }
        : current);
      setFailure("");
      showToast(outcome.message);
    } else if (outcome.kind === "stale") {
      setFailure(`${listed?.number ?? "Refund"}: ${outcome.message}`);
    }
    onChanged();
  };

  const data = state.status === "ready" ? state.data : null;
  return (
    <section aria-labelledby={titleId} className={sectionClass}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 id={titleId} className="font-body text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Refunds</h4>
          {data && <p className="text-xs font-semibold text-gray-600">{countText(data.pagination, ["refund", "refunds"])}</p>}
        </div>
        <div className="w-full sm:w-64">
          <Field label="Refund status">
            {(id) => (
              <select id={id} value={status} onChange={(event) => { setStatus(isRefundStatus(event.target.value) ? event.target.value : ""); setPage(1); }} className={selectClass}>
                <option value="">All refunds</option>
                {REFUND_STATUSES.map((value) => <option key={value} value={value}>{STAFF_REFUND_STATUS[value]}</option>)}
              </select>
            )}
          </Field>
        </div>
      </div>
      <p className="mt-2 text-xs text-charcoal">Refunds are sent manually by M-Pesa. Only a recorded M-Pesa reference marks a refund as sent.</p>
      <ListStatus state={state} onRetry={retry} loadingText="Loading refunds…" />
      {failure && <div className="mt-3"><Feedback message={failure} tone="error" /></div>}
      {data && !data.refunds.length && <p className="mt-3 text-sm text-gray-600">No refunds match this filter.</p>}
      {data && data.refunds.length > 0 && (
        <ul className="mt-3 space-y-3">
          {data.refunds.map((refund) => (
            <StaffRefundCard
              key={refund.id}
              refund={refund}
              canWrite={canWrite}
              onAction={(action) => { setFailure(""); setDialog({ refund, action }); }}
              header={(
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-light-gray pb-2">
                  <p className="text-xs text-gray-600">Order <span className="font-mono font-bold text-brand-primary">{refund.orderNumber}</span>{refund.isDemo && <DemoTag />}</p>
                  <button type="button" onClick={(event) => onOpen({ orderId: refund.orderId, focus: { kind: "refund", id: refund.id } }, event.currentTarget)} className={openClass}>
                    Open order<span className="sr-only"> {refund.orderNumber}</span>
                  </button>
                </div>
              )}
            />
          ))}
        </ul>
      )}
      {data && <Pager pagination={data.pagination} label="Refunds" onPage={setPage} />}
      {dialog && <RefundActionDialog refund={dialog.refund} action={dialog.action} onClose={() => setDialog(null)} onOutcome={handleOutcome} />}
    </section>
  );
}
