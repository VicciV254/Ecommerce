import api from "./client";

/** Fulfilment stage. Staff confirm each step; returns and refunds are separate records. */
export type OrderStatus = "PENDING" | "PROCESSING" | "SHIPPED" | "READY_FOR_PICKUP" | "DELIVERED" | "CANCELLED";
/** `REFUNDED`/`PARTIALLY_REFUNDED` follow only refunds confirmed as sent. */
export type PaymentStatus = "PENDING" | "PAID" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";
export type DeliveryMethod = "STORE_PICKUP" | "SAME_DAY" | "STANDARD";
/** How an order was paid; `DEMONSTRATION` is a sample order's demonstration payment, which takes no money. */
export type PaymentMethod = "MPESA" | "CARD" | "BANK_TRANSFER" | "COD" | "DEMONSTRATION";
/**
 * Who recorded a tracking event; `DEMONSTRATION` is the customer playing the store's part for their own sample order.
 * `null` on events recorded before actors were kept.
 */
export type ActorType = "CUSTOMER" | "STAFF" | "SYSTEM" | "PROVIDER" | "DEMONSTRATION";
/** Stock hold for an order; legacy orders report COMMITTED with no expiry. */
export type ReservationStatus = "HELD" | "COMMITTED" | "RELEASED" | "EXPIRED";

export interface OrderItem {
  id: string;
  productId: string;
  variantId?: string | null;
  sku?: string | null;
  variantAttributes?: Record<string, string> | null;
  productName: string;
  productPrice: number;
  quantity: number;
  subtotal: number;
  productImage?: string | null;
  /** The accepted quote line; absent on legacy orders. */
  pricingSnapshot?: QuoteLine | null;
}

export interface OrderAddress {
  id: string;
  street: string;
  city: string;
  county: string;
  postalCode?: string | null;
}

export interface TrackingEvent {
  id: string;
  status: OrderStatus;
  description: string;
  location?: string | null;
  createdAt: string;
  actorType?: ActorType | null;
}

export interface OrderPricingSnapshot {
  currency: "KES";
  policyVersion: number;
  policyHash: string;
  vatRate: number;
  couponCode: string | null;
  couponApplied: boolean;
  discountedSubtotal: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  tax: number;
  shippingCost: number;
  total: number;
  status: OrderStatus;
  /** A `PaymentMethod`; older or future values are shown as they are. */
  paymentMethod: string;
  paymentStatus: PaymentStatus;
  deliveryMethod: DeliveryMethod;
  /** The immutable delivery snapshot for quote-based orders. */
  address?: OrderAddress | null;
  trackingNumber?: string | null;
  trackingHistory?: TrackingEvent[];
  createdAt: string;
  updatedAt: string;
  /** Quote-based (pending reservation) orders only; legacy orders have none. */
  quoteId?: string | null;
  reservationStatus?: ReservationStatus | null;
  reservationExpiresAt?: string | null;
  pricingSnapshot?: OrderPricingSnapshot | null;
  isDemo?: boolean;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface OrderTracking {
  orderNumber: string;
  status: OrderStatus;
  trackingHistory: TrackingEvent[];
}

/* ---------- Fulfilment, returns and refunds (customer order view) ---------- */

export type ReturnRule = "STANDARD" | "FAULT_ONLY" | "UNOPENED_OR_FAULT";
export type ReturnReason = "CHANGED_MIND" | "FAULTY" | "DAMAGED" | "WRONG_ITEM" | "OTHER";
export type ReturnStatus = "REQUESTED" | "APPROVED" | "REJECTED" | "CANCELLED" | "RECEIVED";
export type RefundStatus = "REQUESTED" | "APPROVED" | "PROCESSING" | "CONFIRMED" | "FAILED" | "UNRESOLVED" | "CANCELLED";
export type RefundSource = "CANCELLATION" | "RETURN" | "PAYMENT_REVIEW";
/** `DEMONSTRATION` refunds a demonstration payment: no money moves and there is never an M-Pesa reference. */
export type RefundMethod = "MPESA_MANUAL" | "DEMONSTRATION";
export type DeliveryFeeRefund = "MERCHANT_FAULT_ONLY" | "ALWAYS" | "NEVER";
export type CustomerAction = "CANCEL" | "REQUEST_RETURN";
export type ReturnIneligibility = "NOT_DELIVERED" | "NOT_PAID" | "WINDOW_CLOSED" | "NOTHING_RETURNABLE";

/** Staff-confirmed fulfilment times; `deliveredAt` (delivery or pickup handover) starts the return window. */
export interface OrderFulfilment {
  processingAt: string | null;
  readyForPickupAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  pickedUpAt: string | null;
  cancelledAt: string | null;
}

export interface ReturnLine {
  id: string;
  orderItemId: string;
  quantity: number;
  /** The item's rule recorded at purchase. */
  returnRule: ReturnRule;
  /** Recorded by staff on receipt; `null` until then. */
  receivedQuantity: number | null;
  refundableQuantity: number | null;
  productName: string;
  purchased: number;
}

export interface OrderReturn {
  id: string;
  number: string;
  status: ReturnStatus;
  reason: ReturnReason;
  comment: string | null;
  unopenedDeclared: boolean;
  requestedAt: string;
  decidedAt: string | null;
  /** Customer-visible staff note on the decision. */
  decisionNote: string | null;
  receivedAt: string | null;
  merchantFaultConfirmed: boolean | null;
  /** Customer-visible staff note from inspection on receipt. */
  inspectionNote: string | null;
  lines: ReturnLine[];
}

/** A refund record; only `CONFIRMED` means money was sent, and only then is the M-Pesa reference shown. */
export interface OrderRefund {
  id: string;
  number: string;
  source: RefundSource;
  status: RefundStatus;
  amount: number;
  includesDeliveryFee: boolean;
  method: RefundMethod;
  requestedAt: string;
  approvedAt: string | null;
  confirmedAt: string | null;
  providerReference: string | null;
}

export interface ReturnPolicyTerms {
  windowDays: number;
  deliveryFeeRefund: DeliveryFeeRefund;
  refundRounding: "UP_TO_WHOLE_KES";
  resolutions: "REFUND"[];
  refundMethod: "MPESA_MANUAL";
}

export interface ReturnEligibilityLine {
  orderItemId: string;
  productName: string;
  purchased: number;
  /** Units already in active or received return requests. */
  requested: number;
  returnableQuantity: number;
  returnRule: ReturnRule;
  allowedReasons: ReturnReason[];
}

export interface ReturnEligibility {
  eligible: boolean;
  reasonCode: ReturnIneligibility | null;
  windowEndsAt: string | null;
  policy: ReturnPolicyTerms;
  lines: ReturnEligibilityLine[];
}

/** Store-side order steps the owner of a paid sample order may play: every staff step except cancelling. */
export type DemonstrationOrderStep = "START_PROCESSING" | "DISPATCH" | "CONFIRM_DELIVERY" | "MARK_READY_FOR_PICKUP" | "CONFIRM_PICKUP";

/** One demonstration control the server would accept now, with the status it expects (a stale one is refused). */
export type DemonstrationAction =
  | { action: DemonstrationOrderStep; expectedStatus: OrderStatus }
  | { action: "APPROVE"; returnId: string; expectedStatus: "REQUESTED" }
  | { action: "RECEIVE"; returnId: string; expectedStatus: "APPROVED" }
  | { action: "COMPLETE_REFUND"; refundId: string; expectedStatus: "REQUESTED" | "APPROVED" | "PROCESSING" };

/** `GET /orders` and `GET /orders/:id`: the order with the actions the server would accept now. */
export interface CustomerOrder extends Order {
  trackingHistory: TrackingEvent[];
  fulfilment: OrderFulfilment;
  returns: OrderReturn[];
  refunds: OrderRefund[];
  returnEligibility: ReturnEligibility;
  customerActions: CustomerAction[];
  /** The store's part the owner may play for a sample order; empty when none applies. */
  demonstrationActions: DemonstrationAction[];
}

/** Body of `POST /orders/:id/returns`; the server rejects unknown keys. */
export interface ReturnRequestBody {
  reason: ReturnReason;
  comment?: string;
  unopenedDeclared?: boolean;
  lines: { orderItemId: string; quantity: number }[];
}

export interface ReturnRequestResult {
  returnRequest: OrderReturn;
  order: CustomerOrder;
}

/* ---------- Checkout quotes and pending orders ---------- */

export interface QuoteItemInput {
  productId: string;
  variantId: string;
  quantity: number;
}

/** Body of `POST /orders/quotes`; the server prices it. */
export interface QuoteRequest {
  items: QuoteItemInput[];
  addressId: string;
  deliveryMethod: DeliveryMethod;
  couponCode: string | null;
  notes: string | null;
}

export interface QuoteLine {
  productId: string;
  variantId: string;
  productName: string;
  sku: string;
  attributes: Record<string, string>;
  quantity: number;
  productImage: string | null;
  originalUnitPrice: number;
  unitPrice: number;
  total: number;
  couponDiscount: number;
  discount: number;
  discountId: string | null;
}

export interface QuoteAddress {
  id: string;
  street: string;
  city: string;
  county: string;
  postalCode: string | null;
}

/** Server-authoritative prices for one cart, address, delivery choice and coupon. */
export interface Quote {
  id: string;
  version: 1;
  currency: "KES";
  policyVersion: number;
  policyHash: string;
  vatRate: number;
  mode: "live" | "demo";
  address: QuoteAddress;
  notes: string | null;
  couponCode: string | null;
  couponApplied: boolean;
  couponMessage: string | null;
  deliveryMethod: DeliveryMethod;
  lines: QuoteLine[];
  subtotal: number;
  discount: number;
  discountedSubtotal: number;
  tax: number;
  shippingCost: number;
  total: number;
  expiresAt: string;
  expired: boolean;
  consumed: boolean;
  orderId: string | null;
  reservationsEnabled: boolean;
}

/** Most distinct variants one quote accepts. */
export const MAX_QUOTE_ITEMS = 100;
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

const orderPath = (id: string) => `/orders/${encodeURIComponent(id)}`;

/** Quote and pending-order calls. Responses are validated by `checkoutModel` before use. */
export const checkoutAPI = {
  createQuote: (request: QuoteRequest) => api.post<unknown>("/orders/quotes", request),
  getQuote: (id: string) => api.get<unknown>(`/orders/quotes/${encodeURIComponent(id)}`),
  /** Creates (or replays) the pending order for an accepted quote; the key binds retries to one order. */
  placeOrder: (quoteId: string, idempotencyKey: string) =>
    api.post<unknown>("/orders", { quoteId }, { headers: { [IDEMPOTENCY_HEADER]: idempotencyKey } }),
  getOrder: (id: string) => api.get<unknown>(orderPath(id)),
};

/** Customer order calls. Responses are validated by `orderModel` before use. */
export const ordersAPI = {
  getMyOrders: (params: { page?: number; limit?: number } = {}) => api.get<unknown>("/orders", { params }),
  get: (id: string) => api.get<unknown>(orderPath(id)),
  cancel: (id: string, data: { reason?: string }) => api.post<unknown>(`${orderPath(id)}/cancel`, data),
  /** Creates (or replays) one return request; retries of the same request reuse the same key. */
  requestReturn: (id: string, body: ReturnRequestBody, idempotencyKey: string) =>
    api.post<unknown>(`${orderPath(id)}/returns`, body, { headers: { [IDEMPOTENCY_HEADER]: idempotencyKey } }),
  /** Withdraws a return that is still awaiting review. */
  cancelReturn: (orderId: string, returnId: string) =>
    api.post<unknown>(`${orderPath(orderId)}/returns/${encodeURIComponent(returnId)}/cancel`, {}),
  /** Plays one listed store-side step for the customer's own sample order; the server reads only these fields. */
  playDemonstration: (orderId: string, step: DemonstrationAction) => {
    const path = orderPath(orderId);
    const body = { expectedStatus: step.expectedStatus };
    switch (step.action) {
      case "APPROVE":
        return api.post<unknown>(`${path}/returns/${encodeURIComponent(step.returnId)}/demonstration-approve`, body);
      case "RECEIVE":
        return api.post<unknown>(`${path}/returns/${encodeURIComponent(step.returnId)}/demonstration-receive`, body);
      case "COMPLETE_REFUND":
        return api.post<unknown>(`${path}/refunds/${encodeURIComponent(step.refundId)}/demonstration-complete`, body);
      default:
        return api.post<unknown>(`${path}/demonstration-actions`, { action: step.action, ...body });
    }
  },
  track: (orderNumber: string) => api.get<OrderTracking>(`/orders/track/${encodeURIComponent(orderNumber)}`),
};
