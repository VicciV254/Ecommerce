import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { Order, OrderFulfilment, TrackingEvent } from "../api/orders";
import { ACTOR_LABELS, ORDER_STATUS_TONES, orderStatusLabel, shopperOrderStatusLabel, shopperOrderStatusTone } from "../store/orderCopy";
import { formatDateTime, formatKES } from "../utils/format";

/** Wider layouts open every section by default; phones start collapsed. */
const OPEN_FROM = "(min-width: 768px)";

/**
 * A native disclosure. Closed content is not rendered, so it never holds invisible focus targets;
 * `defaultOpen` opens it on mount whatever the width (for example, a section the user navigated to).
 */
export function Disclosure({ title, summary, defaultOpen = false, id, children }: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  id?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useLayoutEffect(() => {
    const details = ref.current;
    if (!details) return;
    if (defaultOpen || (typeof window.matchMedia === "function" && window.matchMedia(OPEN_FROM).matches)) details.open = true;
  }, [defaultOpen]);
  return (
    <details ref={ref} id={id} className="group rounded-md border border-divider bg-surface">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 rounded-md px-4 py-2 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 text-sm font-semibold text-navy-900">
          {title}
          {summary && <span className="ml-2 font-normal text-muted">{summary}</span>}
        </span>
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="size-5 shrink-0 text-navy-800 transition-transform duration-(--motion-feedback) group-open:rotate-180 motion-reduce:transition-none">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
        </svg>
      </summary>
      <div className="border-t border-divider px-4 py-3 text-sm text-navy-800 [overflow-wrap:anywhere]">{children}</div>
    </details>
  );
}

/** Staff read the canonical status; shoppers read what a pending order waits for. Every caller says which it is. */
export function OrderStatusBadge({ order, audience }: {
  order: Pick<Order, "status" | "deliveryMethod" | "paymentStatus">;
  audience: "shopper" | "staff";
}) {
  const shopper = audience === "shopper";
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${shopper ? shopperOrderStatusTone(order) : ORDER_STATUS_TONES[order.status]}`}>
      {shopper ? shopperOrderStatusLabel(order) : orderStatusLabel(order)}
    </span>
  );
}

/** The order's stored amounts, read as "Label: value"; nothing is recalculated here. */
export function OrderTotals({ order }: { order: Pick<Order, "subtotal" | "discount" | "tax" | "shippingCost" | "total" | "pricingSnapshot"> }) {
  const rows: [string, string][] = [
    ["Subtotal", formatKES(order.subtotal)],
    ["Discount", `-${formatKES(order.discount)}`],
    [order.pricingSnapshot ? `VAT (${order.pricingSnapshot.vatRate}%)` : "Tax", formatKES(order.tax)],
    ["Delivery fee", formatKES(order.shippingCost)],
  ];
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 tabular-nums">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt>{label}:</dt>{" "}<dd className="text-right">{value}</dd>
        </div>
      ))}
      <div className="contents font-bold text-navy-900">
        <dt>Total:</dt>{" "}<dd className="text-right">{formatKES(order.total)}</dd>
      </div>
    </dl>
  );
}

type Step = { label: string; at: string | null };

/** Staff-confirmed steps for this order's delivery method; a cancelled order ends at cancellation. */
function fulfilmentSteps(order: Pick<Order, "createdAt" | "deliveryMethod" | "status">, fulfilment: OrderFulfilment): Step[] {
  const placed: Step = { label: "Order placed", at: order.createdAt };
  const processing: Step = { label: "Being prepared", at: fulfilment.processingAt };
  if (order.status === "CANCELLED") {
    return [placed, ...(fulfilment.processingAt ? [processing] : []), { label: "Cancelled", at: fulfilment.cancelledAt }];
  }
  return order.deliveryMethod === "STORE_PICKUP"
    ? [placed, processing, { label: "Ready for pickup", at: fulfilment.readyForPickupAt },
      { label: "Collected", at: fulfilment.pickedUpAt ?? fulfilment.deliveredAt }]
    : [placed, processing, { label: "Dispatched", at: fulfilment.shippedAt }, { label: "Delivered", at: fulfilment.deliveredAt }];
}

export function OrderProgress({ order, fulfilment }: {
  order: Pick<Order, "createdAt" | "deliveryMethod" | "status">;
  fulfilment: OrderFulfilment;
}) {
  return (
    <ol aria-label="Order progress" className="space-y-2">
      {fulfilmentSteps(order, fulfilment).map((step) => (
        <li key={step.label} className="flex items-start gap-3">
          <span aria-hidden="true" className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${step.at ? "bg-success" : "border border-control bg-surface"}`} />
          <span className="min-w-0">
            <span className={`block text-sm ${step.at ? "font-semibold text-navy-900" : "text-muted"}`}>{step.label}</span>
            <span className="block text-sm text-muted">{step.at ? formatDateTime(step.at) : "Not yet"}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Recorded events, newest first, with who recorded each and (for staff) any recorded reason. */
export function OrderTimeline({ events, label = "Order history" }: {
  events: readonly (TrackingEvent & { reason?: string | null })[];
  label?: string;
}) {
  if (!events.length) return <p className="text-sm text-muted">No updates have been recorded yet.</p>;
  return (
    <ol aria-label={label} className="space-y-3">
      {events.map((event) => {
        const actor = event.actorType ? ACTOR_LABELS[event.actorType] : null;
        // A demonstration step is both recorded by and located in "Demonstration": say it once.
        const location = event.location && event.location !== actor ? event.location : null;
        return (
          <li key={event.id} className="border-l-2 border-divider pl-3">
            <p className="text-sm font-semibold text-navy-900">{event.description}</p>
            <p className="text-sm text-muted">
              {formatDateTime(event.createdAt)}
              {actor ? ` · ${actor}` : ""}
              {location ? ` · ${location}` : ""}
            </p>
            {event.reason && <p className="mt-1 text-sm text-navy-800">Reason: {event.reason}</p>}
          </li>
        );
      })}
    </ol>
  );
}
