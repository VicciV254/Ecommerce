import type { DashboardCurrent, DashboardFigures, DashboardMetrics, RecentOrder, ReportRange, SalesReport } from "../../api/admin";
import { isMoney } from "../../store/catalogModel";
import { isDeliveryMethod, isOrderStatus } from "../../store/checkoutModel";
import { isRecord } from "../../utils/storage";
import { formatNairobiRange, nairobiDate } from "../../utils/nairobiDate";
import { ordersRoute, stockRoute } from "./adminRoutes";

/* ------------------------------------------------------------------ */
/* Boundary validation: a figure is shown only from a complete answer; */
/* a malformed one reads as unavailable, never as zero.               */
/* ------------------------------------------------------------------ */

export class OverviewFormatError extends Error {
  constructor(detail: string) {
    super(`The figures response was not in the expected format (${detail}).`);
    this.name = "OverviewFormatError";
  }
}

const isCount = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0;
const isSignedMoney = (value: unknown): value is number => typeof value === "number" && isMoney(Math.abs(value));
const isTimestamp = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isText = (value: unknown): value is string => typeof value === "string";

/** Every key of `keys` holds a count. */
const counts = (value: unknown, keys: readonly string[]) => isRecord(value) && keys.every((key) => isCount(value[key]));

function check(condition: boolean, detail: string): asserts condition {
  if (!condition) throw new OverviewFormatError(detail);
}

function parseRange(value: unknown): ReportRange {
  check(isRecord(value) && isText(value.period) && isTimestamp(value.start) && isTimestamp(value.end) && value.timeZone === "Africa/Nairobi", "range");
  return { period: value.period, start: value.start, end: value.end, timeZone: value.timeZone };
}

function parseFigures(value: unknown): DashboardFigures {
  check(isRecord(value) && isSignedMoney(value.netSales) && counts(value, ["paidOrders", "ordersPlaced", "cancelledOrders"]), "figures");
  const { refunds } = value;
  check(isRecord(refunds) && isCount(refunds.count) && isMoney(refunds.amount), "refunds");
  return {
    netSales: value.netSales, paidOrders: Number(value.paidOrders), ordersPlaced: Number(value.ordersPlaced),
    cancelledOrders: Number(value.cancelledOrders), refunds: { count: refunds.count, amount: refunds.amount },
  };
}

function parseCurrent(value: unknown): DashboardCurrent {
  check(isRecord(value), "current");
  check(counts(value.orders, ["awaitingStart", "processing", "readyForPickup", "dispatched"]), "current orders");
  check(isCount(value.paymentsNeedingReview), "payments needing review");
  check(counts(value.returns, ["REQUESTED", "APPROVED"]), "current returns");
  check(counts(value.refunds, ["REQUESTED", "APPROVED", "PROCESSING", "FAILED", "UNRESOLVED"]), "current refunds");
  check(counts(value.stock, ["LOW_STOCK", "OUT_OF_STOCK"]), "current stock");
  return value as DashboardCurrent;
}

function parseRecentOrder(value: unknown): RecentOrder {
  check(isRecord(value) && isText(value.id) && value.id !== "" && isText(value.orderNumber) && isOrderStatus(value.status) &&
    isDeliveryMethod(value.deliveryMethod) && isMoney(value.total), "recent order");
  const { user } = value;
  check(user === null || user === undefined || (isRecord(user) && isText(user.firstName) && isText(user.lastName)), "recent order customer");
  return {
    id: value.id, orderNumber: value.orderNumber, status: value.status, deliveryMethod: value.deliveryMethod, total: value.total,
    user: user ? { firstName: String(user.firstName), lastName: String(user.lastName) } : null,
  };
}

export function parseDashboard(data: unknown): DashboardMetrics {
  check(isRecord(data) && isTimestamp(data.generatedAt) && Array.isArray(data.recentOrders), "dashboard");
  return {
    range: parseRange(data.range),
    generatedAt: data.generatedAt,
    figures: parseFigures(data.figures),
    current: parseCurrent(data.current),
    recentOrders: data.recentOrders.map(parseRecentOrder),
  };
}

export function parseSalesReport(data: unknown): SalesReport {
  check(isRecord(data) && isTimestamp(data.generatedAt) && Array.isArray(data.orders), "sales report");
  check(isSignedMoney(data.totalRevenue) && counts(data, ["paidOrders", "totalOrders", "cancelledOrders"]) &&
    [data.cancelledValue, data.returnedValue, data.refundedValue].every(isMoney), "sales figures");
  return { ...(data as unknown as SalesReport), range: parseRange(data.range) };
}

/* ------------------------------------------------------------------ */
/* What each figure means                                             */
/* ------------------------------------------------------------------ */

export type FigureKey = "netSales" | "paidOrders" | "ordersPlaced" | "cancelledOrders" | "refunds";

/** The shared figures, in reading order, with one-line definitions; the sales report shows the same ones. */
export const FIGURES: readonly { key: FigureKey; label: string; definition: string }[] = [
  { key: "netSales", label: "Net sales", definition: "Paid orders placed in this period, less refunds confirmed on them" },
  { key: "paidOrders", label: "Paid orders", definition: "Orders placed in this period that are paid and not cancelled" },
  { key: "ordersPlaced", label: "Orders placed", definition: "Every order placed in this period, whatever its status" },
  { key: "cancelledOrders", label: "Cancelled", definition: "Orders placed in this period that are now cancelled" },
  { key: "refunds", label: "Refunded", definition: "Refunds confirmed as sent on orders placed in this period" },
];

/** "1–17 November 2026 · Nairobi time (EAT)". */
export const rangeInWords = (range: Pick<ReportRange, "start" | "end">) => `${formatNairobiRange(range.start, range.end)} · Nairobi time (EAT)`;

/* ------------------------------------------------------------------ */
/* Needs action now: one row per kind of waiting work                 */
/* ------------------------------------------------------------------ */

export type NeedsActionRow = { key: string; label: string; count: number; to: string };

/**
 * The non-zero current counts, most urgent first, each linking to the list that shows those records: order steps and
 * payment reviews to Orders (Needs action, where the attention list shows each review), returns and refunds to their
 * list with that status, and stock to Stock with that status.
 */
export function needsActionRows(current: DashboardCurrent): NeedsActionRow[] {
  const orders = ordersRoute("orders");
  const returns = (status: "REQUESTED" | "APPROVED") => ordersRoute("returns", { records: { status } });
  const refunds = (status: keyof DashboardCurrent["refunds"]) => ordersRoute("refunds", { records: { status } });
  const rows: NeedsActionRow[] = [
    { key: "payment-reviews", label: "Payments needing review", count: current.paymentsNeedingReview, to: orders },
    { key: "refunds-failed", label: "Failed refunds", count: current.refunds.FAILED, to: refunds("FAILED") },
    { key: "refunds-unresolved", label: "Unresolved refunds", count: current.refunds.UNRESOLVED, to: refunds("UNRESOLVED") },
    { key: "orders-awaiting-start", label: "Paid orders waiting to start", count: current.orders.awaitingStart, to: orders },
    { key: "orders-processing", label: "Orders being prepared", count: current.orders.processing, to: orders },
    { key: "orders-ready", label: "Ready for pickup", count: current.orders.readyForPickup, to: orders },
    { key: "orders-dispatched", label: "Dispatched, awaiting delivery confirmation", count: current.orders.dispatched, to: orders },
    { key: "returns-requested", label: "Returns awaiting a decision", count: current.returns.REQUESTED, to: returns("REQUESTED") },
    { key: "returns-approved", label: "Returns awaiting receipt", count: current.returns.APPROVED, to: returns("APPROVED") },
    { key: "refunds-requested", label: "Refunds awaiting approval", count: current.refunds.REQUESTED, to: refunds("REQUESTED") },
    { key: "refunds-approved", label: "Refunds approved, not yet sent", count: current.refunds.APPROVED, to: refunds("APPROVED") },
    { key: "refunds-processing", label: "Refunds being sent", count: current.refunds.PROCESSING, to: refunds("PROCESSING") },
    { key: "stock-out", label: "Out-of-stock SKUs", count: current.stock.OUT_OF_STOCK, to: stockRoute({ status: "OUT_OF_STOCK" }) },
    { key: "stock-low", label: "Low-stock SKUs", count: current.stock.LOW_STOCK, to: stockRoute({ status: "LOW_STOCK" }) },
  ];
  return rows.filter((row) => row.count > 0);
}

/* ------------------------------------------------------------------ */
/* Sales report exports                                               */
/* ------------------------------------------------------------------ */

/** The store's name for a file name: lower-case letters and digits joined by hyphens ("Apex Cart" -> "apex-cart"). */
export function storeSlug(name: string) {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** `apex-cart-sales-2026-11-01-to-2026-11-17.csv`, or one date for a single day. */
export function salesExportName(storeName: string, range: Pick<ReportRange, "start" | "end">, extension: string) {
  const [from, to] = [nairobiDate(range.start), nairobiDate(range.end)];
  const dates = from === to ? from : `${from}-to-${to}`;
  return `${[storeSlug(storeName), "sales", dates].filter(Boolean).join("-")}.${extension}`;
}

/** "Sales report, 1–17 November 2026 (Nairobi time)". */
export const salesExportTitle = (range: Pick<ReportRange, "start" | "end">) =>
  `Sales report, ${formatNairobiRange(range.start, range.end)} (Nairobi time)`;
