import api from "./client";
import type { Order, OrderStatus, Pagination, PaymentStatus } from "./orders";
import { staffRequest, type AdminSession } from "./staffSession";

export type AdminLoginResponse = { admin: AdminSession; token: string; refreshToken: string };

export type DashboardMetrics = {
  sales: { total: number };
  orders: { total: number; pending: number; processing: number; cancelled: number; returned: number };
  refunds: { total: number };
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    status: OrderStatus;
    total: number;
    user?: { firstName: string; lastName: string } | null;
  }>;
};

export type SalesReport = {
  period: string;
  totalRevenue: number;
  totalOrders: number;
  cancelledValue: number;
  returnedValue: number;
  refundedValue: number;
  orders: Array<{
    id: string;
    orderNumber: string;
    customer: string;
    email: string;
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    deliveryMethod: string;
    subtotal: number;
    tax: number;
    shippingCost: number;
    total: number;
    createdAt: string;
  }>;
};

export type AdminOrder = Order & {
  user?: { id: string; firstName: string; lastName: string; email: string; phone?: string | null } | null;
};

export type AdminOrderFilters = {
  status?: string;
  paymentStatus?: PaymentStatus;
  deliveryMethod?: string;
  orderedDay?: string;
  limit?: number;
};

export type OrderStageUpdate = { status: string; description: string; location: string };

export type AdminUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  emailVerified: boolean;
  isDisabled: boolean;
  createdAt: string;
  _count?: { orders: number; addresses: number; wishlist: number };
};

export type Subscription = { id: string; email: string; isActive: boolean; createdAt: string };

export const adminAPI = {
  login: (data: { email: string; password: string }) => api.post<AdminLoginResponse>("/admin/login", data),

  analytics: {
    getDashboard: async () => api.get<DashboardMetrics>("/admin/analytics/dashboard", staffRequest()),
    getSales: async (params: { period: string }) => api.get<SalesReport>("/admin/analytics/sales", staffRequest(params)),
  },

  users: {
    getAll: async (params: { q?: string; verified?: string; disabled?: string }) =>
      api.get<{ users: AdminUser[] }>("/admin/users", staffRequest(params)),
    sendVerification: async (id: string) =>
      api.post<{ sent: boolean }>(`/admin/users/${encodeURIComponent(id)}/verify`, {}, staffRequest()),
    sendVerificationBulk: async (ids: string[]) =>
      api.post<{ results: Array<{ sent: boolean }> }>("/admin/users/verify", { ids }, staffRequest()),
    setDisabled: async (id: string, disabled: boolean) =>
      api.put<AdminUser>(`/admin/users/${encodeURIComponent(id)}/disabled`, { disabled }, staffRequest()),
    delete: async (id: string) => api.delete<{ success?: boolean }>(`/admin/users/${encodeURIComponent(id)}`, staffRequest()),
  },

  orders: {
    getAll: async (params: AdminOrderFilters) =>
      api.get<{ orders: AdminOrder[]; pagination: Pagination }>("/orders/admin/all", staffRequest(params)),
    updateStatus: async (id: string, data: OrderStageUpdate) =>
      api.put<AdminOrder>(`/orders/admin/${encodeURIComponent(id)}/status`, data, staffRequest()),
    approveRefund: async (id: string) =>
      api.put<AdminOrder>(`/orders/admin/${encodeURIComponent(id)}/refund`, {}, staffRequest()),
  },

  subscriptions: {
    getAll: async (params: { active?: string }) =>
      api.get<{ subscriptions: Subscription[] }>("/subscriptions/admin/all", staffRequest(params)),
    sendPromotional: async (data: { subject: string; content: string }) =>
      api.post<{ successful: number; failed: number }>("/subscriptions/admin/send-promotional", data, staffRequest()),
    delete: async (id: string) =>
      api.delete<{ message: string }>(`/subscriptions/admin/${encodeURIComponent(id)}`, staffRequest()),
  },
};
