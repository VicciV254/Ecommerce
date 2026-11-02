/**
 * Server-shaped M-Pesa fixtures shared by unit and browser tests. Messages mirror the server's own
 * wording; amounts are always the saved order total, never calculated here.
 */
import type { PaymentAttempt, PaymentOverview } from "../api/mpesa";
import type { Order } from "../api/orders";

type OverviewOrder = Pick<Order, "id" | "orderNumber" | "total" | "status" | "paymentStatus" | "reservationStatus" | "reservationExpiresAt" | "isDemo">;

export const PAYMENT_MESSAGES = {
  disabled: "M-Pesa payments are not enabled yet.",
  initiating: "The payment request is being submitted. No payment has been confirmed.",
  pending: "Check your phone for the M-Pesa prompt. Payment has not been confirmed yet.",
  unknown: "The provider outcome is unknown. Check this attempt instead of sending another prompt.",
  review: "This payment needs verification or staff review. Do not pay again.",
  receivedReview: "Payment was received, but the order requires staff review. Do not pay again.",
  succeeded: "M-Pesa payment confirmed.",
  cancelled: "The M-Pesa request was cancelled.",
  insufficientFunds: "M-Pesa reported insufficient funds.",
  exists: "Check the existing payment attempt. Do not send another prompt.",
  cooldown: "Wait before requesting another M-Pesa prompt.",
  fractional: "M-Pesa requires a positive whole-KES total. This order will not be rounded or charged.",
} as const;

/** What the server reports when a new prompt may be requested. */
export const PAYABLE: Pick<PaymentOverview, "available" | "environment" | "reasonCode" | "message"> = {
  available: true, environment: "production", reasonCode: null, message: null,
};

/** An overview for an order whose payments are switched off: the default for tests that do not pay. */
export function fixturePaymentOverview(order: OverviewOrder, overrides: Partial<PaymentOverview> = {}): PaymentOverview {
  return {
    order: {
      id: order.id, orderNumber: order.orderNumber, total: order.total, status: order.status, paymentStatus: order.paymentStatus,
      reservationStatus: order.reservationStatus ?? "COMMITTED", reservationExpiresAt: order.reservationExpiresAt ?? null,
      isDemo: order.isDemo ?? false,
    },
    available: false, environment: null, reasonCode: "MPESA_DISABLED", message: PAYMENT_MESSAGES.disabled, attempts: [],
    ...overrides,
  };
}

/** An accepted prompt that M-Pesa has not yet confirmed: not a payment. */
export function fixtureAttempt(order: Pick<Order, "id" | "total">, overrides: Partial<PaymentAttempt> = {}): PaymentAttempt {
  const createdAt = new Date().toISOString();
  return {
    id: "attempt-1", orderId: order.id, status: "PENDING", environment: "production", amount: order.total,
    phoneMasked: "+254 *** 5678", receiptNumber: null, confirmedAt: null, reviewRequired: false, reasonCode: null,
    message: PAYMENT_MESSAGES.pending, createdAt, updatedAt: createdAt, nextCheckAt: null, canReconcile: true,
    ...overrides,
  };
}

/** A confirmed payment with its receipt; the order is paid but not yet fulfilled. */
export function fixtureConfirmedAttempt(order: Pick<Order, "id" | "total">, overrides: Partial<PaymentAttempt> = {}): PaymentAttempt {
  const confirmedAt = new Date().toISOString();
  return fixtureAttempt(order, {
    status: "SUCCEEDED", receiptNumber: "SBX1234567", confirmedAt, updatedAt: confirmedAt,
    message: PAYMENT_MESSAGES.succeeded, canReconcile: false, ...overrides,
  });
}
