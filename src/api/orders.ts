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
  address?: OrderAddress | null;
  trackingNumber?: string | null;
  pickedUpAt?: string | null;
  trackingHistory?: TrackingEvent[];
  createdAt: string;
  updatedAt: string;
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

const orderPath = (id: string) => `/orders/${encodeURIComponent(id)}`;

export const ordersAPI = {
  getMyOrders: (params: { page?: number; limit?: number } = {}) =>
    api.get<{ orders: Order[]; pagination: Pagination }>("/orders", { params }),
  cancel: (id: string, data: { reason?: string }) => api.post<Order>(`${orderPath(id)}/cancel`, data),
  pickup: (id: string) => api.post<Order>(`${orderPath(id)}/pickup`),
  returnOrder: (id: string, data: ReturnRequest) =>
    api.post<Order & { rma?: string }>(`${orderPath(id)}/return`, data),
  track: (orderNumber: string) => api.get<OrderTracking>(`/orders/track/${encodeURIComponent(orderNumber)}`),
};
