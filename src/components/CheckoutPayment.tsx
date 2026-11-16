import { useState, type RefObject } from "react";
import type { PaymentOrderSummary } from "../api/mpesa";
import type { Order } from "../api/orders";
import { useAuth } from "../contexts/AuthContext";
import { Link } from "../router";
import { PAYMENT_STATUS_LABELS } from "../store/orderCopy";
import { withPaymentSummary } from "../store/paymentModel";
import { useStorefront } from "../store/StorefrontContext";
import { formatDateTime, formatKES } from "../utils/format";
import { printReceipt } from "../utils/printReceipt";
import { primaryActionClass, secondaryActionClass, textLinkClass } from "./checkout";
import { PaymentPanel } from "./PaymentPanel";

/** The order's payment state in a few words; "Payment received" appears only once the server records the payment. */
export function reservedStatus(order: Pick<Order, "paymentStatus" | "reservationStatus" | "reservationExpiresAt">) {
  if (order.paymentStatus === "PAID") return "Payment received";
  if (order.paymentStatus !== "PENDING") return `Payment ${PAYMENT_STATUS_LABELS[order.paymentStatus]}`;
  if (order.reservationStatus !== "HELD") return "Unpaid — no longer held";
  return order.reservationExpiresAt ? `Unpaid — held until ${formatDateTime(order.reservationExpiresAt)}` : "Unpaid — items held";
}

/** Links to the account's record of this order: its details, and where it is in delivery. */
export const orderDetailsRoute = (order: Pick<Order, "id">) => `/account/orders?order=${encodeURIComponent(order.id)}`;
export const trackOrderRoute = (order: Pick<Order, "orderNumber">) => `/track?order=${encodeURIComponent(order.orderNumber)}`;

const factRowClass = "flex flex-wrap items-baseline justify-between gap-x-4";

/**
 * The Payment step: the reserved order exactly as the server returned it (number, total, hold and payment status),
 * then M-Pesa payment. The status follows the payment service's latest answer, so nothing here contradicts the payment
 * panel, and the receipt is offered only once the server says the order is paid.
 */
export function PaymentStep({ order: placed, remainingItems, headingRef, headingId }: {
  order: Order;
  remainingItems: number;
  headingRef: RefObject<HTMLHeadingElement | null>;
  headingId: string;
}) {
  const { user } = useAuth();
  const { brandName } = useStorefront();
  /** The payment service's latest view of this order. */
  const [summary, setSummary] = useState<PaymentOrderSummary | null>(null);
  const order = summary ? withPaymentSummary(placed, summary) : placed;
  const paid = order.paymentStatus === "PAID";
  const lapsed = ["RELEASED", "EXPIRED"].includes(order.reservationStatus ?? "");
  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-surface p-4 shadow-card sm:p-6">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="type-h2 text-navy-900">
          {paid ? "Order paid" : lapsed ? "Order no longer reserved" : "Order reserved"}
        </h2>
        {/* Each fact is a row that wraps its value under its label when the text is enlarged. */}
        <dl className="mt-4 space-y-2 text-sm [overflow-wrap:anywhere]">
          <div className={factRowClass}>
            <dt className="text-muted">Order number</dt>
            <dd className="min-w-0 font-mono font-bold text-navy-900">{order.orderNumber}</dd>
          </div>
          <div className={factRowClass}>
            <dt className="text-muted">Order total</dt>
            <dd className="min-w-0 font-semibold tabular-nums text-navy-900">{formatKES(order.total)}</dd>
          </div>
          <div className={factRowClass}>
            <dt className="text-muted">Status</dt>
            <dd className={`min-w-0 font-semibold ${paid ? "text-success" : lapsed ? "text-error" : "text-warning"}`}>{reservedStatus(order)}</dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-navy-800">
          {paid
            ? "Payment has been received for this order. Its payment details and next steps are shown below."
            : lapsed ? "This order's hold has ended. Do not approve an outstanding payment prompt; check its status below or in your order history."
            : "Payment has not been confirmed for this order yet. Check its status below before requesting another prompt. An unpaid reservation can expire; you can review or cancel it in your order history."}
        </p>
        {paid && (
          <>
            <p className="mt-4 rounded-md border border-success/40 bg-success-tint p-3 font-semibold text-success">Thank you. Your receipt is ready.</p>
            {/* Side by side where they fit, each on its own row when the text is enlarged or the column is narrow. */}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => printReceipt(order, user, brandName)} className={`${primaryActionClass} flex-1 basis-[12rem]`}>Print receipt</button>
              <Link to={orderDetailsRoute(order)} className={`${secondaryActionClass} flex-1 basis-[12rem]`}>View order details</Link>
              <Link to={trackOrderRoute(order)} className={`${secondaryActionClass} flex-1 basis-[12rem]`}>Track this order</Link>
            </div>
          </>
        )}
      </div>
      <PaymentPanel orderId={placed.id} onOrderChange={setSummary} headingLevel={3} />
      {remainingItems > 0 && (
        <p className="text-sm text-navy-800">
          Your cart still has {remainingItems} {remainingItems === 1 ? "item" : "items"} that were not part of this order.
        </p>
      )}
      <div className="flex flex-col gap-x-6 sm:flex-row sm:flex-wrap">
        <Link to="/account/orders" className={textLinkClass}>View or cancel in your orders</Link>
        <Link to={remainingItems > 0 ? "/cart" : "/shop"} className={textLinkClass}>
          {remainingItems > 0 ? "Back to cart" : "Continue shopping"}
        </Link>
      </div>
    </div>
  );
}
