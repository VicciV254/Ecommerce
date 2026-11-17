import api from "./client";
import type {
  CustomerOrder,
  DeliveryMethod,
  OrderRefund,
  OrderReturn,
  OrderStatus,
  Pagination,
  PaymentStatus,
  ReturnLine,
  TrackingEvent,
} from "./orders";
import { staffRequest, type AdminSession } from "./staffSession";

export type AdminLoginResponse = { admin: AdminSession; token: string; refreshToken: string };

/** The labelled range a figure covers: ISO instants, with the time zone its days are counted in (Africa/Nairobi). */
export type ReportRange = { period: string; start: string; end: string; timeZone: string };

/** Figures for real (non-demo) orders placed in the range; the sales report reports the same ones. */
export type DashboardFigures = {
  netSales: number;
  paidOrders: number;
  ordersPlaced: number;
  cancelledOrders: number;
  refunds: { count: number; amount: number };
};

/** Work waiting now, whatever the period, counted as the lists they link to count it (demo records excluded). */
export type DashboardCurrent = {
  orders: { awaitingStart: number; processing: number; readyForPickup: number; dispatched: number };
  paymentsNeedingReview: number;
  returns: { REQUESTED: number; APPROVED: number };
  refunds: { REQUESTED: number; APPROVED: number; PROCESSING: number; FAILED: number; UNRESOLVED: number };
  stock: { LOW_STOCK: number; OUT_OF_STOCK: number };
};

export type RecentOrder = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  deliveryMethod: DeliveryMethod;
  total: number;
  user: { firstName: string; lastName: string } | null;
};

/** `GET /admin/analytics/dashboard?period=…`; validated by `parseDashboard` before use. */
export type DashboardMetrics = {
  range: ReportRange;
  generatedAt: string;
  figures: DashboardFigures;
  current: DashboardCurrent;
  recentOrders: RecentOrder[];
};

/** `GET /admin/analytics/sales?period=…`; validated by `parseSalesReport` before use. */
export type SalesReport = {
  period: string;
  range: ReportRange;
  generatedAt: string;
  totalRevenue: number;
  paidOrders: number;
  totalOrders: number;
  cancelledOrders: number;
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

/* ---------- Fulfilment, returns, refunds and attention (staff views) ---------- */

/** Fulfilment actions; an order view lists only those the server would accept now. */
export type StaffAction = "START_PROCESSING" | "MARK_READY_FOR_PICKUP" | "DISPATCH" | "CONFIRM_DELIVERY" | "CONFIRM_PICKUP" | "CANCEL";
export type RefundAction = "approve" | "start" | "confirm" | "fail" | "unresolved" | "retry" | "cancel";

export interface StaffTrackingEvent extends TrackingEvent {
  actorId: string | null;
  reason: string | null;
}

export interface StaffReturnLine extends ReturnLine {
  restockQuantity: number | null;
}

export interface StaffReturn extends Omit<OrderReturn, "lines"> {
  lines: StaffReturnLine[];
  orderId: string;
  updatedAt: string;
}

export interface StaffRefund extends OrderRefund {
  orderId: string;
  paymentId: string | null;
  returnRequestId: string | null;
  requestedAmount: number;
  reason: string | null;
  requestedByType: string;
  processingAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  unresolvedAt: string | null;
  unresolvedNote: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  allowedActions: RefundAction[];
  updatedAt: string;
}

export type StaffOrderCustomer = { id: string; firstName: string; lastName: string; email: string; phone?: string | null };

/** Money still owed after an earlier refund was cancelled, which staff may request again. */
export type RefundRequestOption =
  | { source: "CANCELLATION"; maxAmount: number }
  | { source: "RETURN"; returnId: string; returnNumber: string; maxAmount: number };

/** `GET /orders/admin/:id`: the customer view plus actor details, staff notes and permitted actions. */
export interface StaffOrder extends Omit<CustomerOrder, "trackingHistory" | "returns" | "refunds"> {
  user?: StaffOrderCustomer | null;
  trackingHistory: StaffTrackingEvent[];
  returns: StaffReturn[];
  refunds: StaffRefund[];
  allowedActions: StaffAction[];
  /** Refunds that can be requested again now; empty when nothing is owed or a refund is already active. */
  refundRequestOptions: RefundRequestOption[];
  /** A payment on this order awaits review; fulfilment is blocked until it is resolved. */
  paymentReviewOpen: boolean;
}

export type ListedReturn = StaffReturn & { orderNumber: string; isDemo: boolean };
export type ListedRefund = StaffRefund & { orderNumber: string; isDemo: boolean };

export type StaffOrderPage = { orders: StaffOrder[]; pagination: Pagination };
export type ReturnPage = { returns: ListedReturn[]; pagination: Pagination };
export type RefundPage = { refunds: ListedRefund[]; pagination: Pagination };

export type StaffOrderFilters = {
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  deliveryMethod?: string;
  /** First and last Nairobi day the order was placed on (`YYYY-MM-DD`, both included). */
  orderedFrom?: string;
  orderedTo?: string;
  page?: number;
  limit?: number;
};
export type RecordListFilters<Status extends string> = { status?: Status; page?: number; limit?: number };

export type StaffActionInput = { action: StaffAction; expectedStatus: OrderStatus; reason?: string; trackingNumber?: string };
export type ReturnDecisionInput = { decision: "APPROVE" | "REJECT"; expectedStatus: "REQUESTED"; note?: string };
export type ReturnReceiptInput = {
  expectedStatus: "APPROVED";
  merchantFaultConfirmed: boolean;
  note?: string;
  lines: { returnLineId: string; receivedQuantity: number; restockQuantity: number; refundableQuantity: number }[];
};
export type RefundActionInput = { expectedStatus: StaffRefund["status"]; amount?: number; reason?: string; providerReference?: string };
/** Body of `POST /orders/admin/:id/refunds`; `returnId` is sent only for a return refund. */
export type OwedRefundInput =
  | { source: "CANCELLATION"; reason: string }
  | { source: "RETURN"; returnId: string; reason: string };

export type AttentionType =
  | "ORDER_AWAITING_FULFILMENT"
  | "PAYMENT_REVIEW"
  | "RETURN_AWAITING_DECISION"
  | "RETURN_AWAITING_RECEIPT"
  | "REFUND_ACTION"
  | "NOTIFICATION_FAILED";

/** Derived from current records; marking it read never resolves the underlying work. */
export interface AttentionItem {
  key: string;
  type: AttentionType;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  orderId: string | null;
  orderNumber: string | null;
  /** The order, payment, return, refund or notification the item is about. */
  entityId: string;
  since: string;
  read: boolean;
}

export interface NotificationReport {
  id: string;
  type: string;
  status: "PENDING" | "SENDING" | "SENT" | "FAILED" | "DEAD";
  orderId: string | null;
  attempts: number;
  lastErrorCode: string | null;
  nextAttemptAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

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

/** The send endpoint's tally, with one result per active subscriber (`code` names why a send failed). */
export type PromotionalSendResult = {
  successful: number;
  failed: number;
  results?: { success: boolean; code?: string }[];
};

/** One staff activity entry. `details` is a display name or a count, never contact details or message text. */
export type ActivityEntry = {
  id: string;
  /** When it happened (ISO instant). */
  at: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: string;
  staff: { username: string; role: string };
};
/** `GET /admin/activity?type=&page=`: newest first, 25 a page; validated by `parseActivityPage` before use. */
export type ActivityPage = { entries: ActivityEntry[]; pagination: Pagination };

export const adminAPI = {
  login: (data: { email: string; password: string }) => api.post<AdminLoginResponse>("/admin/login", data),

  /** Staff activity, for SUPER_ADMIN and ADMIN only. */
  activity: {
    getAll: async (params: { type: string; page: number }) => api.get<unknown>("/admin/activity", staffRequest(params)),
  },

  analytics: {
    getDashboard: async (period: string) => api.get<unknown>("/admin/analytics/dashboard", staffRequest({ period })),
    getSales: async (period: string) => api.get<unknown>("/admin/analytics/sales", staffRequest({ period })),
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

  /** Order fulfilment; responses are validated by `orderModel` before use. */
  orders: {
    getAll: async (params: StaffOrderFilters) => api.get<unknown>("/orders/admin/all", staffRequest(params)),
    get: async (id: string) => api.get<unknown>(`/orders/admin/${encodeURIComponent(id)}`, staffRequest()),
    /** `expectedStatus` is the status the staff member saw; a stale one is refused with ORDER_CHANGED. */
    applyAction: async (id: string, input: StaffActionInput) =>
      api.post<unknown>(`/orders/admin/${encodeURIComponent(id)}/actions`, input, staffRequest()),
  },

  returns: {
    getAll: async (params: RecordListFilters<StaffReturn["status"]>) => api.get<unknown>("/orders/admin/returns", staffRequest(params)),
    decide: async (returnId: string, input: ReturnDecisionInput) =>
      api.post<unknown>(`/orders/admin/returns/${encodeURIComponent(returnId)}/decision`, input, staffRequest()),
    receive: async (returnId: string, input: ReturnReceiptInput) =>
      api.post<unknown>(`/orders/admin/returns/${encodeURIComponent(returnId)}/receive`, input, staffRequest()),
  },

  /** Manual M-Pesa refunds: approval never sends money; only a recorded reference confirms it. */
  refunds: {
    getAll: async (params: RecordListFilters<StaffRefund["status"]>) => api.get<unknown>("/orders/admin/refunds", staffRequest(params)),
    act: async (refundId: string, action: RefundAction, input: RefundActionInput) =>
      api.post<unknown>(`/orders/admin/refunds/${encodeURIComponent(refundId)}/${action}`, input, staffRequest()),
    /** Requests a refund of verified money on a payment that is under review. */
    requestForPayment: async (paymentId: string, reason: string) =>
      api.post<unknown>(`/orders/admin/payments/${encodeURIComponent(paymentId)}/refunds`, { reason }, staffRequest()),
    /** Records a new refund request for money still owed on an order (one of its `refundRequestOptions`). */
    requestOwed: async (orderId: string, input: OwedRefundInput) =>
      api.post<unknown>(`/orders/admin/${encodeURIComponent(orderId)}/refunds`, input, staffRequest()),
  },

  attention: {
    getAll: async () => api.get<unknown>("/admin/attention", staffRequest()),
    markRead: async (keys: string[]) => api.post<{ read: number }>("/admin/attention/read", { keys }, staffRequest()),
  },

  notifications: {
    retry: async (id: string) => api.post<unknown>(`/admin/notifications/${encodeURIComponent(id)}/retry`, {}, staffRequest()),
  },

  subscriptions: {
    getAll: async (params: { active?: string }) =>
      api.get<{ subscriptions: Subscription[] }>("/subscriptions/admin/all", staffRequest(params)),
    sendPromotional: async (data: { subject: string; content: string }) =>
      api.post<PromotionalSendResult>("/subscriptions/admin/send-promotional", data, staffRequest()),
    delete: async (id: string) =>
      api.delete<{ message: string }>(`/subscriptions/admin/${encodeURIComponent(id)}`, staffRequest()),
  },
};
