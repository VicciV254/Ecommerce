import api from "./client";
import { IDEMPOTENCY_HEADER, type OrderStatus, type PaymentStatus, type ReservationStatus } from "./orders";
import { staffRequest } from "./staffSession";

export type PaymentAttemptStatus = "INITIATING" | "PENDING" | "UNKNOWN" | "REVIEW" | "SUCCEEDED" | "FAILED";
export type PaymentEnvironment = "sandbox" | "production";

/**
 * One M-Pesa prompt for an order, as the server reports it. Provider identifiers, callback details
 * and the full phone number are never part of this contract.
 */
export interface PaymentAttempt {
  id: string;
  orderId: string;
  status: PaymentAttemptStatus;
  environment: PaymentEnvironment;
  /** Whole KES the server asked M-Pesa to collect: the saved order total. */
  amount: number;
  phoneMasked: string;
  receiptNumber: string | null;
  /** Set once M-Pesa confirmed the money arrived, including payments held for staff review. */
  confirmedAt: string | null;
  reviewRequired: boolean;
  reasonCode: string | null;
  /** Server-written explanation of the status; never provider text. */
  message: string;
  createdAt: string;
  updatedAt: string;
  nextCheckAt: string | null;
  /** Whether the server can ask M-Pesa about this attempt. */
  canReconcile: boolean;
}

/** The saved order as the payment service sees it. */
export interface PaymentOrderSummary {
  id: string;
  orderNumber: string;
  total: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  reservationStatus: ReservationStatus;
  reservationExpiresAt: string | null;
  isDemo: boolean;
}

export interface PaymentOverview {
  order: PaymentOrderSummary;
  /** Whether a new prompt may be requested now; otherwise `reasonCode` and `message` say why. */
  available: boolean;
  /** Configured M-Pesa environment, or `null` when payments are switched off or misconfigured. */
  environment: PaymentEnvironment | null;
  reasonCode: string | null;
  message: string | null;
  /** Newest first. */
  attempts: PaymentAttempt[];
}

const orderPayments = (orderId: string) => `orders/${encodeURIComponent(orderId)}/payments`;
const attemptPath = (id: string) => `payments/${encodeURIComponent(id)}`;

/** Customer payment calls. Responses are validated by `paymentModel` before use. */
export const paymentsAPI = {
  getOverview: (orderId: string) => api.get<unknown>(`/mpesa/${orderPayments(orderId)}`),
  /** Asks M-Pesa to prompt the phone for the saved order total; the key binds retries to one attempt. */
  requestPrompt: (orderId: string, phone: string, idempotencyKey: string) =>
    api.post<unknown>("/mpesa/stk-push", { orderId, phone }, { headers: { [IDEMPOTENCY_HEADER]: idempotencyKey } }),
  /** Asks the server to check this attempt with M-Pesa; it never starts a payment. */
  checkAttempt: (id: string) => api.post<unknown>(`/mpesa/${attemptPath(id)}/query`),
};

/** Staff reads and reconciliation, sent only with staff credentials. Staff cannot start payments. */
export const staffPaymentsAPI = {
  getOverview: async (orderId: string) => api.get<unknown>(`/mpesa/admin/${orderPayments(orderId)}`, staffRequest()),
  checkAttempt: async (id: string) => api.post<unknown>(`/mpesa/admin/${attemptPath(id)}/query`, undefined, staffRequest()),
};
