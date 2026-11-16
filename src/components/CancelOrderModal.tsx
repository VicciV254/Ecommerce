import { useId, useState } from "react";
import { ordersAPI, type CustomerOrder } from "../api/orders";
import { apiErrorCode, describeApiError } from "../api/errors";
import { cancellationRefund } from "../store/orderCopy";
import { OrderFormatError, parseCustomerOrder } from "../store/orderModel";
import { formatKES } from "../utils/format";
import { ModalDialog } from "./Modal";

/** Refusals that mean the order changed since it was shown; its actions must be reloaded. */
const CONFLICTS: Record<string, string> = {
  ACTION_NOT_ALLOWED: "This order can no longer be cancelled because it has moved on since this page loaded.",
  PAYMENT_REVIEW_REQUIRED: "This order cannot be cancelled while its payment is under review.",
};

/** What happens to the payment, in the customer's words; never a claim that money was sent. */
function cancellationText(order: Pick<CustomerOrder, "orderNumber" | "paymentStatus" | "total">) {
  switch (cancellationRefund(order.paymentStatus)) {
    case "full":
      return `Order ${order.orderNumber} is paid. If you cancel, a refund request for the full amount (${formatKES(order.total)}, including delivery) will be recorded; we will email you when it is sent.`;
    case "remaining":
      return `Part of your payment for order ${order.orderNumber} has already been refunded. If you cancel, a refund request for the remaining paid balance will be recorded; we will email you when it is sent.`;
    case "settled":
      return `Your payment for order ${order.orderNumber} has already been refunded, so cancelling records no further refund. Any items held for it will be released.`;
    default:
      return `Cancel order ${order.orderNumber}? Any items held for it will be released.`;
  }
}

/** Customer cancellation before dispatch. A paid order records a refund request; it never claims money was sent. */
export default function CancelOrderModal({ order, onClose, onOrderCancelled, onConflict }: {
  order: Pick<CustomerOrder, "id" | "orderNumber" | "paymentStatus" | "total">;
  onClose: () => void;
  onOrderCancelled: (order: CustomerOrder) => void;
  /** Reloads the order after a refusal that means it changed; resolves `false` when it could not be reloaded. */
  onConflict: () => Promise<boolean>;
}) {
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const reasonId = useId();

  const close = () => {
    if (!isSubmitting) onClose();
  };

  const handleCancel = async () => {
    setIsSubmitting(true);
    setErrorMessage("");
    try {
      const trimmed = reason.trim();
      const { data } = await ordersAPI.cancel(order.id, trimmed ? { reason: trimmed } : {});
      onOrderCancelled(parseCustomerOrder(data, order.id));
    } catch (error) {
      const conflict = CONFLICTS[apiErrorCode(error) ?? ""];
      if (conflict) {
        const refreshed = await onConflict();
        setErrorMessage(`${conflict} ${refreshed ? "The order has been refreshed." : "We could not refresh it; reload the page to see its current status."}`);
      } else {
        setErrorMessage(error instanceof OrderFormatError
          ? "The cancellation was sent, but its result could not be read. Reload your orders to check this order's status."
          : describeApiError(error, "Failed to cancel order"));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalDialog open label="Cancel order" onClose={close}>
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl bg-surface p-6 text-navy-800 shadow-overlay [overflow-wrap:anywhere]">
        <h2 className="type-h3 mb-3 text-navy-900">Cancel order</h2>
        <p className="mb-4">{cancellationText(order)}</p>

        <div className="mb-4">
          <label htmlFor={reasonId} className="mb-1 block text-sm font-semibold text-navy-900">
            Reason for cancellation (optional)
          </label>
          <textarea
            id={reasonId}
            disabled={isSubmitting}
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Please let us know why you're cancelling..."
            rows={3}
            className="w-full rounded-sm border border-control bg-surface px-3 py-2 text-navy-900 placeholder:text-muted disabled:bg-surface-soft disabled:text-muted"
          />
        </div>

        {errorMessage && <p role="alert" className="mb-4 rounded-md bg-error-tint p-3 text-sm font-semibold text-error">{errorMessage}</p>}
        <div className="flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={close}
            disabled={isSubmitting}
            className="min-h-[44px] rounded-sm border border-navy-900 px-4 text-sm font-semibold text-navy-900 transition-colors duration-(--motion-feedback) hover:bg-surface-soft disabled:cursor-not-allowed disabled:border-control disabled:text-muted"
          >
            Keep order
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSubmitting}
            className="min-h-[44px] rounded-sm bg-error px-4 text-sm font-semibold text-white transition-colors duration-(--motion-feedback) hover:bg-navy-900 disabled:cursor-not-allowed disabled:bg-surface-soft disabled:text-muted"
          >
            {isSubmitting ? "Cancelling..." : "Cancel order"}
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
