// src/api/orders.d.ts

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  productPrice: number;
  quantity: number;
  subtotal: number;
  productImage?: string;
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
  status: 'PENDING' | 'PROCESSING' | 'SHIPPED' | 'READY_FOR_PICKUP' | 'DELIVERED' | 'CANCELLED' | 'RETURNED';
  paymentMethod: string;
  paymentStatus: string;
  deliveryMethod: string;
  address: Address;
  trackingNumber?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrackingEvent {
  status: string;
  description: string;
  location?: string;
  createdAt: string;
}

export function getUserOrders(): Promise<Order[]>;
export function getOrder(id: string): Promise<Order>;
export function cancelOrder(orderId: string): Promise<void>;
export function trackOrder(trackingNumber: string): Promise<{ order: Order; timeline: TrackingEvent[] }>;
export const ordersAPI: {
  create(data: unknown): Promise<{ data: Order }>;
  createCheckout(data: unknown): Promise<{ data: Order }>;
  getMyOrders(params?: Record<string, unknown>): Promise<unknown>;
  getById(id: string): Promise<{ data: Order }>;
  cancel(id: string, data?: unknown): Promise<{ data: Order }>;
  pickup(id: string): Promise<{ data: Order }>;
  returnOrder(id: string, data?: unknown): Promise<{ data: Order & { rma?: string } }>;
  track(number: string): Promise<unknown>;
  getAll(params?: Record<string, unknown>): Promise<{ data: { orders: Order[]; pagination?: unknown } }>;
  updateStatus(id: string, data: unknown): Promise<{ data: Order }>;
};
