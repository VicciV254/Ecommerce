import api from "./client";

export type OrderStatus =
  | "PENDING"
  | "PROCESSING"
  | "SHIPPED"
  | "READY_FOR_PICKUP"
  | "DELIVERED"
  | "CANCELLED"
  | "AWAITING_REFUND"
  | "RETURNED";
export type PaymentStatus = "PENDING" | "PAID" | "FAILED" | "REFUNDED";
export type DeliveryMethod = "STORE_PICKUP" | "SAME_DAY" | "STANDARD";
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
  paymentMethod: string;
  paymentStatus: PaymentStatus;
  deliveryMethod: DeliveryMethod;
  /** The immutable delivery snapshot for quote-based orders. */
  address?: OrderAddress | null;
  trackingNumber?: string | null;
  pickedUpAt?: string | null;
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

export interface ReturnRequest {
  reason: string;
  resolution: string;
  images: string[];
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

export const ordersAPI = {
  getMyOrders: (params: { page?: number; limit?: number } = {}) =>
    api.get<{ orders: Order[]; pagination: Pagination }>("/orders", { params }),
  cancel: (id: string, data: { reason?: string }) => api.post<Order>(`${orderPath(id)}/cancel`, data),
  pickup: (id: string) => api.post<Order>(`${orderPath(id)}/pickup`),
  returnOrder: (id: string, data: ReturnRequest) =>
    api.post<Order & { rma?: string }>(`${orderPath(id)}/return`, data),
  track: (orderNumber: string) => api.get<OrderTracking>(`/orders/track/${encodeURIComponent(orderNumber)}`),
};
