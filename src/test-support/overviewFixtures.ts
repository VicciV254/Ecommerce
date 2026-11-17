import type { DashboardCurrent, DashboardMetrics, ReportRange, SalesReport } from "../api/admin";

/** 14:05 EAT on Tuesday 17 November 2026: every overview fixture is generated then. */
export const OVERVIEW_NOW = "2026-11-17T11:05:00.000Z";

/** Where each period starts in Nairobi time (UTC+3) on that day. */
const PERIOD_STARTS: Record<string, string> = {
  today: "2026-11-16T21:00:00.000Z",
  week: "2026-11-15T21:00:00.000Z",
  month: "2026-10-31T21:00:00.000Z",
  year: "2025-12-31T21:00:00.000Z",
};

export function fixtureRange(period = "month"): ReportRange {
  return { period, start: PERIOD_STARTS[period] ?? PERIOD_STARTS.month, end: OVERVIEW_NOW, timeZone: "Africa/Nairobi" };
}

export const NOTHING_WAITING: DashboardCurrent = {
  orders: { awaitingStart: 0, processing: 0, readyForPickup: 0, dispatched: 0 },
  paymentsNeedingReview: 0,
  returns: { REQUESTED: 0, APPROVED: 0 },
  refunds: { REQUESTED: 0, APPROVED: 0, PROCESSING: 0, FAILED: 0, UNRESOLVED: 0 },
  stock: { LOW_STOCK: 0, OUT_OF_STOCK: 0 },
};

/** A dashboard answer as the API sends it; its figures equal `fixtureSalesReport` for the same period. */
export function fixtureDashboard(period = "month", overrides: Partial<DashboardMetrics> = {}): DashboardMetrics {
  return {
    range: fixtureRange(period),
    generatedAt: OVERVIEW_NOW,
    figures: { netSales: 12_450, paidOrders: 5, ordersPlaced: 7, cancelledOrders: 1, refunds: { count: 1, amount: 1160 } },
    current: {
      orders: { awaitingStart: 2, processing: 1, readyForPickup: 0, dispatched: 1 },
      paymentsNeedingReview: 1,
      returns: { REQUESTED: 1, APPROVED: 0 },
      refunds: { REQUESTED: 0, APPROVED: 1, PROCESSING: 0, FAILED: 1, UNRESOLVED: 0 },
      stock: { LOW_STOCK: 3, OUT_OF_STOCK: 1 },
    },
    recentOrders: [
      { id: "order-recent-1", orderNumber: "APX-261117-0001", status: "PROCESSING", deliveryMethod: "STANDARD", total: 2488, user: { firstName: "Ana", lastName: "Mwangi" } },
      { id: "order-recent-2", orderNumber: "APX-261116-0042", status: "DELIVERED", deliveryMethod: "STORE_PICKUP", total: 1044, user: null },
    ],
    ...overrides,
  };
}

/** A sales report answer as the API sends it, reconciling with `fixtureDashboard`. */
export function fixtureSalesReport(period = "month", overrides: Partial<SalesReport> = {}): SalesReport {
  return {
    period,
    range: fixtureRange(period),
    generatedAt: OVERVIEW_NOW,
    totalRevenue: 12_450,
    paidOrders: 5,
    totalOrders: 7,
    cancelledOrders: 1,
    cancelledValue: 900,
    returnedValue: 1160,
    refundedValue: 1160,
    orders: [{
      id: "order-recent-1", orderNumber: "APX-261117-0001", customer: "Ana Mwangi", email: "ana.mwangi@example.test",
      status: "PROCESSING", paymentStatus: "PAID", deliveryMethod: "STANDARD", subtotal: 2145, tax: 343, shippingCost: 0, total: 2488,
      createdAt: "2026-11-17T06:30:00.000Z",
    }],
    ...overrides,
  };
}
