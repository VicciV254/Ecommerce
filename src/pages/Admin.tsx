import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Container } from "../components/ui";
import { PasswordInput } from "../components/PasswordInput";
import { ConfirmModal, Toast } from "../components/Modal";
import { navigate } from "../router";
import { adminAPI, type AdminOrder, type AdminUser, type DashboardMetrics, type SalesReport, type Subscription } from "../api/admin";
import { describeApiError } from "../api/errors";
import { clearAdminSession, readAdminSession, saveAdminSession, type AdminSession } from "../api/staffSession";
import { useStorefront } from "../store/StorefrontContext";
import { activeVariants, isDiscountActive } from "../store/catalogModel";
import { formatKES } from "../utils/format";
import { AdminCatalogProvider, useAdminCatalog } from "./admin/AdminCatalogContext";
import { CatalogManager } from "./admin/CatalogManager";
import { DiscountManager } from "./admin/DiscountManager";
import { StockManager } from "./admin/StockManager";
import { StorefrontManager } from "./admin/StorefrontManager";
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

const TABS = ["Dashboard", "Discounts", "Stock", "Catalog", "Storefront", "Orders", "Users", "Promotions", "Analytics"] as const;
type Tab = (typeof TABS)[number];
const TOAST_MS = 2500;
const RECENT_ORDER_LIMIT = 8;
const REPORT_PREVIEW_LIMIT = 12;

export default function Admin() {
  const [admin, setAdmin] = useState<AdminSession | null>(readAdminSession);

  if (!admin) {
    return <AdminLogin onLogin={setAdmin} />;
  }

  return (
    <AdminCatalogProvider>
      <AdminDashboard
        admin={admin}
        onLogout={() => {
          clearAdminSession();
          setAdmin(null);
        }}
      />
    </AdminCatalogProvider>
  );
}

function AdminLogin({ onLogin }: { onLogin: (admin: AdminSession) => void }) {
  const { brandName } = useStorefront();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data } = await adminAPI.login({ email, password });
      saveAdminSession(data.admin, data.token, data.refreshToken);
      onLogin(data.admin);
    } catch (err) {
      setError(describeApiError(err, "Invalid admin email or password."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-off-white px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg bg-white p-8 shadow-sm">
        <p className="text-center font-display text-lg uppercase tracking-[0.12em] text-brand-primary">{brandName}</p>
        <h1 className="mt-3 text-center font-display text-2xl uppercase tracking-wider text-brand-primary">Admin Login</h1>
        <p className="mt-2 text-center text-sm text-gray-600">Staff credentials are required for dashboard access.</p>
        {error && <p role="alert" className="mt-4 rounded-sm bg-error/10 p-3 text-center text-xs font-semibold text-error">{error}</p>}
        <div className="mt-6 space-y-4">
          <div>
            <label htmlFor="admin-email" className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-600">Email</label>
            <input id="admin-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-sm border border-light-gray px-3 py-2.5 text-sm outline-none focus:border-brand-secondary" />
          </div>
          <div>
            <label htmlFor="admin-password" className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-600">Password</label>
            <PasswordInput id="admin-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-sm border border-light-gray px-3 py-2.5 text-sm outline-none focus:border-brand-secondary" />
          </div>
        </div>
        <button disabled={loading} className="mt-6 w-full rounded-sm bg-brand-primary py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary disabled:cursor-not-allowed disabled:bg-gray-300">
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}

function AdminDashboard({ admin, onLogout }: { admin: AdminSession; onLogout: () => void }) {
  const { brandName } = useStorefront();
  const catalog = useAdminCatalog();
  const [tab, setTab] = useState<Tab>("Dashboard");
  const [storefrontDirty, setStorefrontDirty] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), TOAST_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  /** Unsaved storefront edits live only in this tab, so confirm before discarding them. */
  const guard = (action: () => void) => {
    if (tab === "Storefront" && storefrontDirty) setPendingLeave(() => action);
    else action();
  };

  const now = new Date();
  const activeDiscounts = catalog.data?.snapshot.discounts.filter((discount) => !discount.isDemo && isDiscountActive(discount, now)).length;

  return (
    <div className="min-h-screen bg-off-white text-brand-primary">
      <div className="sticky top-0 z-40 bg-brand-primary py-4">
        <Container className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-lg tracking-wider text-white">{brandName} Admin</h1>
            <span className="hidden rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/80 sm:inline">
              {admin.username} · {admin.role}
            </span>
            {catalog.refreshing && catalog.data && <span role="status" className="text-[10px] font-bold uppercase tracking-wider text-white/70">Refreshing…</span>}
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => guard(() => navigate("/"))} className="text-[10px] font-bold uppercase tracking-widest text-white/80 hover:text-white">
              ← Exit
            </button>
            <button type="button" onClick={() => guard(onLogout)} className="text-[10px] font-bold uppercase tracking-widest text-white/80 hover:text-white">
              Logout
            </button>
          </div>
        </Container>
      </div>

      <Container className="py-6">
        {catalog.sessionExpired && (
          <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-error/30 bg-error/10 p-4 text-sm font-semibold text-error">
            <span>Your staff session has expired. Sign in again to continue.</span>
            <button type="button" onClick={onLogout} className="rounded-sm bg-error px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-white">Sign in again</button>
          </div>
        )}
        {!catalog.sessionExpired && catalog.error && (
          <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-error/30 bg-error/10 p-4 text-sm text-error">
            <span>{catalog.data ? `Catalog data may be out of date: ${catalog.error}` : catalog.error}</span>
            <button type="button" onClick={catalog.reload} className="font-bold underline">Try again</button>
          </div>
        )}

        <nav aria-label="Admin sections" className="no-scrollbar mb-6 flex gap-0.5 overflow-x-auto border-b border-light-gray">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              aria-current={tab === t ? "page" : undefined}
              onClick={() => guard(() => setTab(t))}
              className={`whitespace-nowrap px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors ${
                tab === t ? "border-b-2 border-brand-primary text-brand-primary" : "text-gray-600 hover:text-charcoal"
              }`}
            >
              {t}
              {t === "Discounts" && Boolean(activeDiscounts) && (
                <span className="ml-1.5 rounded-full bg-success px-1.5 py-0.5 text-[9px] text-white">{activeDiscounts}</span>
              )}
            </button>
          ))}
        </nav>

        {tab === "Dashboard" && <DashboardPanel activeDiscounts={activeDiscounts} />}
        {tab === "Analytics" && <AnalyticsPanel />}
        {tab === "Orders" && <OrdersManager showToast={showToast} />}
        {tab === "Users" && <UsersManager showToast={showToast} />}
        {tab === "Promotions" && <PromotionsManager showToast={showToast} />}
        {tab === "Storefront" && <StorefrontManager showToast={showToast} onDirtyChange={setStorefrontDirty} />}
        {["Discounts", "Stock", "Catalog"].includes(tab) && (
          catalog.data ? (
            <>
              {tab === "Discounts" && <DiscountManager showToast={showToast} />}
              {tab === "Stock" && <StockManager showToast={showToast} />}
              {tab === "Catalog" && <CatalogManager showToast={showToast} />}
            </>
          ) : !catalog.error && (
            <p role="status" className="rounded-lg bg-white p-6 text-sm text-gray-600 shadow-sm">Loading catalog data…</p>
          )
        )}
      </Container>

      <ConfirmModal
        open={Boolean(pendingLeave)}
        title="Discard unsaved storefront changes?"
        message="Your draft edits have not been saved. Leaving now discards them."
        confirmLabel="Discard Changes"
        cancelLabel="Keep Editing"
        tone="danger"
        onConfirm={() => {
          const action = pendingLeave;
          setPendingLeave(null);
          setStorefrontDirty(false);
          action?.();
        }}
        onCancel={() => setPendingLeave(null)}
      />

      <Toast open={Boolean(toast)} message={toast} />
    </div>
  );
}

const ORDER_STATUSES = ["PENDING", "PROCESSING", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "RETURNED", "AWAITING_REFUND"];
const DELIVERY_FILTERS = [["", "All Delivery"], ["STORE_PICKUP", "Store Pickup"], ["SAME_DAY", "Same-Day Delivery"], ["STANDARD", "Standard Delivery"]];
const STAGE_PRESETS: Record<string, { description: string; location: string }> = {
  PENDING: { description: "Order Placed - Payment confirmed", location: "No Maneno Bazaar Warehouse" },
  PROCESSING: { description: "Order Processed", location: "No Maneno Bazaar Warehouse" },
  SHIPPED: { description: "Order Shipped - Dispatched from warehouse", location: "Mombasa Main Station" },
  OUT_FOR_DELIVERY: { description: "Out for Delivery", location: "Mombasa CBD Hub" },
  DELIVERED: { description: "Delivered", location: "Customer destination" },
  CANCELLED: { description: "Order Cancelled", location: "No Maneno Bazaar Warehouse" },
  RETURNED: { description: "Order Returned", location: "No Maneno Bazaar Warehouse" },
  AWAITING_REFUND: { description: "Awaiting Refund Approval", location: "No Maneno Bazaar Admin" },
};
function deliveryLabel(value: string) { return value === "STORE_PICKUP" ? "In-Store Pickup" : value === "SAME_DAY" ? "Same-Day Delivery" : "Standard Delivery"; }
function statusLabel(value: string) { return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()); }
function dateTime(value: string) { return new Date(value).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }); }

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => `"${String(row[header] ?? "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadExcel(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
  
  // Add brand colors to header
  const range = XLSX.utils.decode_range(worksheet['!ref'] || "A1");
  for (let C = range.s.c; C <= range.e.c; ++C) {
    const address = XLSX.utils.encode_col(C) + "1";
    if (!worksheet[address]) continue;
    worksheet[address].s = {
      fill: { fgColor: { rgb: "2B1B12" } },
      font: { color: { rgb: "FFFFFF" }, bold: true },
    };
  }
  
  XLSX.writeFile(workbook, filename);
}

function downloadPdf(filename: string, rows: Record<string, unknown>[], title: string, brandName: string) {
  if (!rows.length) return;
  const doc = new jsPDF();
  
  // Brand colors
  const brandPrimary = "#2B1B12";
  const brandSecondary = "#D7A84F";
  
  // Add logo placeholder (you can replace with actual logo URL)
  doc.setFontSize(20);
  doc.setTextColor(parseInt(brandPrimary.slice(1, 3), 16), parseInt(brandPrimary.slice(3, 5), 16), parseInt(brandPrimary.slice(5, 7), 16));
  doc.text(brandName, 14, 20);
  
  doc.setFontSize(10);
  doc.setTextColor(parseInt(brandSecondary.slice(1, 3), 16), parseInt(brandSecondary.slice(3, 5), 16), parseInt(brandSecondary.slice(5, 7), 16));
  doc.text("Financial Report", 14, 28);
  
  // Add title
  doc.setFontSize(16);
  doc.setTextColor(parseInt(brandPrimary.slice(1, 3), 16), parseInt(brandPrimary.slice(3, 5), 16), parseInt(brandPrimary.slice(5, 7), 16));
  doc.text(title, 14, 40);
  
  // Add date
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 48);
  
  // Generate table
  const headers = Object.keys(rows[0]);
  const data = rows.map(row => headers.map(header => String(row[header] ?? "")));
  
  autoTable(doc, {
    head: [headers],
    body: data,
    startY: 55,
    headStyles: {
      fillColor: [43, 27, 18],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [245, 245, 245],
    },
    styles: {
      fontSize: 9,
      cellPadding: 3,
    },
  });
  
  doc.save(filename);
}

type LoadResult<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string };

function DashboardPanel({ activeDiscounts }: { activeDiscounts: number | undefined }) {
  const catalog = useAdminCatalog();
  const [metrics, setMetrics] = useState<LoadResult<DashboardMetrics>>({ status: "loading" });

  useEffect(() => {
    adminAPI.analytics.getDashboard()
      .then(({ data }) => setMetrics({ status: "ready", data }))
      .catch((error: unknown) => setMetrics({ status: "error", message: describeApiError(error, "Order metrics could not be loaded.") }));
  }, []);

  const stocks = catalog.data?.stocks.filter((stock) => !stock.isDemo);
  const lowStock = stocks?.filter((stock) => stock.status === "LOW_STOCK").length;
  const outStock = stocks?.filter((stock) => stock.status === "OUT_OF_STOCK").length;
  const values = metrics.status === "ready" ? metrics.data : null;
  const show = (value: number | undefined, format: (input: number) => string = String) =>
    value === undefined ? "Unavailable" : format(value);

  const cards: [string, string, string][] = [
    ["Revenue", show(values?.sales.total, formatKES), "bg-brand-secondary"],
    ["Live Orders", show(values?.orders.total), "bg-ocean-blue"],
    ["Processing", show(values?.orders.processing), "bg-coral"],
    ["Cancelled", show(values?.orders.cancelled), "bg-error"],
    ["Refunded", show(values?.refunds.total, formatKES), "bg-warning"],
    ["Active Discounts", show(activeDiscounts), "bg-success"],
  ];

  return (
    <div className="space-y-6">
      {metrics.status === "error" && <p role="alert" className="rounded-lg bg-error/10 p-4 text-sm font-semibold text-error">{metrics.message}</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {cards.map(([label, value, color]) => (
          <div key={label} className="rounded-lg bg-white p-5 shadow-sm">
            <div className={`mb-2 h-1 w-8 rounded-full ${color}`} />
            <p className="font-display text-xl text-brand-primary">{metrics.status === "loading" && label !== "Active Discounts" ? "…" : value}</p>
            <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-gray-600">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-lg bg-white p-6 shadow-sm">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Recent Live Orders</h3>
          <div className="mt-4 space-y-3">
            {(values?.recentOrders ?? []).slice(0, RECENT_ORDER_LIMIT).map((order) => (
              <div key={order.id} className="flex items-center justify-between border-b border-light-gray pb-3 text-xs last:border-b-0">
                <div>
                  <p className="font-mono font-bold text-brand-primary">{order.orderNumber}</p>
                  <p className="text-gray-600">{order.user?.firstName} {order.user?.lastName} - {statusLabel(order.status)}</p>
                </div>
                <p className="font-bold text-brand-primary">{formatKES(order.total)}</p>
              </div>
            ))}
            {values && !values.recentOrders.length && <p className="text-sm text-gray-600">No live orders yet.</p>}
          </div>
        </div>

        <div className="rounded-lg bg-white p-6 shadow-sm">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Attention Queue</h3>
          <div className="mt-4 space-y-3 text-sm">
            <p className="flex justify-between"><span>Low stock SKUs</span><strong className="text-warning">{show(lowStock)}</strong></p>
            <p className="flex justify-between"><span>Out-of-stock SKUs</span><strong className="text-error">{show(outStock)}</strong></p>
            <p className="flex justify-between"><span>Pending orders</span><strong>{show(values?.orders.pending)}</strong></p>
            <p className="flex justify-between"><span>Returns</span><strong>{show(values?.orders.returned)}</strong></p>
            <p className="text-[11px] text-gray-600">Stock counts exclude demo records.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnalyticsPanel() {
  const { brandName } = useStorefront();
  const catalog = useAdminCatalog();
  const [period, setPeriod] = useState("month");
  const [report, setReport] = useState<LoadResult<SalesReport>>({ status: "loading" });
  const [downloadFormat, setDownloadFormat] = useState<"csv" | "excel" | "pdf">("csv");

  useEffect(() => {
    setReport({ status: "loading" });
    adminAPI.analytics.getSales({ period })
      .then(({ data }) => setReport({ status: "ready", data }))
      .catch((error: unknown) => setReport({ status: "error", message: describeApiError(error, "The sales report could not be loaded.") }));
  }, [period]);

  // Inventory value of on-hand units at current list prices, real records only (demo samples are not commercial stock).
  const departments = useMemo(() => {
    const products = catalog.data?.snapshot.products.filter((product) => !product.isDemo) ?? [];
    return catalog.categories.roots.map((department) => {
      const value = products
        .filter((product) => product.categoryPath.includes(department.id))
        .reduce((sum, product) => sum + activeVariants(product).reduce((total, variant) => total + variant.price * variant.onHand, 0), 0);
      return { id: department.id, name: department.name, value };
    }).sort((a, b) => b.value - a.value);
  }, [catalog.data, catalog.categories]);
  const inventoryValue = departments.reduce((sum, department) => sum + department.value, 0);
  const maxValue = Math.max(1, ...departments.map((department) => department.value));

  const salesData = report.status === "ready" ? report.data : null;
  const rows = (salesData?.orders ?? []).map((order) => ({
    orderNumber: order.orderNumber,
    date: new Date(order.createdAt).toLocaleString("en-KE"),
    customer: order.customer,
    email: order.email,
    status: order.status,
    paymentStatus: order.paymentStatus,
    deliveryMethod: order.deliveryMethod,
    subtotal: order.subtotal,
    tax: order.tax,
    shippingCost: order.shippingCost,
    total: order.total,
  }));

  const handleDownload = () => {
    const filename = `nmb-financial-${period}`;
    const title = `Financial Report - ${period.charAt(0).toUpperCase() + period.slice(1)}`;
    if (downloadFormat === "csv") downloadCsv(`${filename}.csv`, rows);
    else if (downloadFormat === "excel") downloadExcel(`${filename}.xlsx`, rows);
    else downloadPdf(`${filename}.pdf`, rows, title, brandName);
  };

  const summary: [string, string][] = salesData
    ? [
      ["Net Revenue", formatKES(salesData.totalRevenue)],
      ["Gross Orders", String(salesData.totalOrders)],
      ["Cancelled", formatKES(salesData.cancelledValue)],
      ["Returned", formatKES(salesData.returnedValue)],
      ["Refunded", formatKES(salesData.refundedValue)],
    ]
    : [];

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Financial Report</h3>
            <p className="mt-1 text-xs text-gray-600">Order revenue, cancellations, returns and refunds recorded by the API.</p>
          </div>
          <div className="flex gap-2">
            <select aria-label="Report period" value={period} onChange={(event) => setPeriod(event.target.value)} className="rounded-sm border border-light-gray px-3 py-2 text-xs">
              <option value="day">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="year">This Year</option>
            </select>
            <select aria-label="Download format" value={downloadFormat} onChange={(event) => setDownloadFormat(event.target.value === "excel" ? "excel" : event.target.value === "pdf" ? "pdf" : "csv")} className="rounded-sm border border-light-gray px-3 py-2 text-xs">
              <option value="csv">CSV</option>
              <option value="excel">Excel</option>
              <option value="pdf">PDF</option>
            </select>
            <button type="button" disabled={!rows.length} onClick={handleDownload} className="rounded-sm bg-brand-primary px-3 py-2 text-[10px] font-bold uppercase text-white hover:bg-brand-secondary hover:text-brand-primary disabled:opacity-50">
              Download Report
            </button>
          </div>
        </div>
        {report.status === "error" && <p role="alert" className="mt-4 text-sm font-semibold text-error">{report.message}</p>}
        {report.status === "loading" && <p role="status" className="mt-4 text-sm text-gray-600">Loading report…</p>}
        {salesData && (
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
            {summary.map(([label, value]) => (
              <div key={label} className="rounded-md bg-off-white p-4">
                <p className="font-display text-lg text-brand-primary">{value}</p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-600">{label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg bg-white p-6 shadow-sm">
          <h3 className="mb-1 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Inventory Value by Department</h3>
          <p className="mb-5 text-[11px] text-gray-600">Active SKUs at current list price; demo records are excluded.</p>
          {catalog.data ? (
            <>
              <div className="space-y-3">
                {departments.map((department) => (
                  <div key={department.id}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-charcoal">{department.name}</span>
                      <span className="font-medium text-brand-primary">{formatKES(department.value)}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-off-white">
                      <div className="h-full rounded-full bg-brand-secondary transition-all" style={{ width: `${(department.value / maxValue) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-5 border-t border-light-gray pt-3 text-xs text-gray-600">
                Total inventory value: <strong className="text-brand-primary">{formatKES(inventoryValue)}</strong>
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-600">{catalog.error ?? "Loading catalog data…"}</p>
          )}
        </div>

        <div className="rounded-lg bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Report Orders</h3>
          <div className="max-h-80 overflow-y-auto text-xs">
            {rows.slice(0, REPORT_PREVIEW_LIMIT).map((row) => (
              <div key={row.orderNumber} className="flex justify-between border-b border-light-gray py-2">
                <span className="font-mono text-brand-primary">{row.orderNumber}</span>
                <span>{row.status}</span>
                <strong>{formatKES(Number(row.total || 0))}</strong>
              </div>
            ))}
            {salesData && !rows.length && <p className="text-gray-600">No orders in this period.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function OrdersManager({ showToast }: { showToast: (message: string) => void }) {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState("");
  const [orderedDay, setOrderedDay] = useState("");
  const [updating, setUpdating] = useState(""); const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"live" | "closed" | "refund">("live");
  const loadOrders = async () => {
    setLoading(true);
    setError("");
    let statusFilter = status || undefined;
    
    try {
      // Apply status filter based on active tab
      if (activeTab === "closed") {
        // Closed orders: DELIVERED or CANCELLED with REFUNDED payment status
        const { data: deliveredData } = await adminAPI.orders.getAll({ status: "DELIVERED", deliveryMethod: deliveryMethod || undefined, orderedDay: orderedDay || undefined, limit: 100 });
        const { data: refundedData } = await adminAPI.orders.getAll({ status: "CANCELLED", paymentStatus: "REFUNDED", deliveryMethod: deliveryMethod || undefined, orderedDay: orderedDay || undefined, limit: 100 });
        setOrders([...deliveredData.orders, ...refundedData.orders]);
      } else if (activeTab === "refund") {
        statusFilter = "AWAITING_REFUND";
        const { data } = await adminAPI.orders.getAll({ status: statusFilter, deliveryMethod: deliveryMethod || undefined, orderedDay: orderedDay || undefined, limit: 100 });
        setOrders(data.orders);
      } else {
        // Live orders: Only show orders in progress (exclude DELIVERED, AWAITING_REFUND, CANCELLED, RETURNED)
        const { data } = await adminAPI.orders.getAll({ status: statusFilter, deliveryMethod: deliveryMethod || undefined, orderedDay: orderedDay || undefined, limit: 100 });
        setOrders(data.orders.filter((order) =>
          !["DELIVERED", "AWAITING_REFUND", "CANCELLED", "RETURNED"].includes(order.status)
        ));
      }
    } catch (err) {
      const message = describeApiError(err, "Could not load orders.");
      setError(message);
      showToast(message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { loadOrders(); }, [status, deliveryMethod, orderedDay, activeTab]);
  const updateStage = async (order: AdminOrder, nextStatus: string) => {
    const preset = STAGE_PRESETS[nextStatus] ?? STAGE_PRESETS.PROCESSING;
    setUpdating(order.id);
    try { await adminAPI.orders.updateStatus(order.id, { status: nextStatus, ...preset }); showToast(`Order ${order.orderNumber} updated to ${statusLabel(nextStatus)}`); await loadOrders(); }
    catch (err) { showToast(describeApiError(err, "Could not update order stage.")); }
    finally { setUpdating(""); }
  };
  const approveRefund = async (order: AdminOrder) => {
    setUpdating(order.id);
    try { await adminAPI.orders.approveRefund(order.id); showToast(`Refund approved for order ${order.orderNumber}`); await loadOrders(); }
    catch (err) { showToast(describeApiError(err, "Could not approve refund.")); }
    finally { setUpdating(""); }
  };
  return <div className="space-y-4">
    <div className="rounded-lg bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Orders</h3>
          <p className="mt-1 text-xs text-gray-500">View customer orders and update tracking. Each update records the current time.</p>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-brand-accent">Showing {orders.length} order(s)</p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadOrders} className="rounded-sm border border-brand-primary px-3 py-2 text-[10px] font-bold uppercase text-brand-primary hover:bg-brand-primary hover:text-white">Refresh</button>
        </div>
      </div>
      <div className="mt-4 flex gap-2 border-b border-light-gray">
        <button onClick={() => setActiveTab("live")} className={`px-4 py-2 text-[11px] font-bold uppercase tracking-wider ${activeTab === "live" ? "text-brand-primary border-b-2 border-brand-primary" : "text-gray-500 hover:text-brand-primary"}`}>Live Orders</button>
        <button onClick={() => setActiveTab("closed")} className={`px-4 py-2 text-[11px] font-bold uppercase tracking-wider ${activeTab === "closed" ? "text-brand-primary border-b-2 border-brand-primary" : "text-gray-500 hover:text-brand-primary"}`}>Closed Orders</button>
        <button onClick={() => setActiveTab("refund")} className={`px-4 py-2 text-[11px] font-bold uppercase tracking-wider ${activeTab === "refund" ? "text-brand-primary border-b-2 border-brand-primary" : "text-gray-500 hover:text-brand-primary"}`}>Refund</button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <select value={deliveryMethod} onChange={(e) => setDeliveryMethod(e.target.value)} className="rounded-sm border border-light-gray px-3 py-2 text-xs">{DELIVERY_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        {activeTab === "live" && <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-sm border border-light-gray px-3 py-2 text-xs"><option value="">All Stages</option>{ORDER_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select>}
        <input type="date" value={orderedDay} onChange={(e) => setOrderedDay(e.target.value)} className="rounded-sm border border-light-gray px-3 py-2 text-xs" />
      </div>
    </div>
    {error && <div className="rounded-lg bg-error/10 p-4 text-sm font-semibold text-error shadow-sm">{error}</div>}
    {loading && <div className="rounded-lg bg-white p-6 text-sm text-gray-500 shadow-sm">Loading orders...</div>}
    {!loading && orders.length === 0 && <div className="rounded-lg bg-white p-6 text-sm text-gray-500 shadow-sm">No orders match these filters.</div>}
    {orders.map((order) => <div key={order.id} className="rounded-lg bg-white p-5 shadow-sm"><div className="flex flex-wrap justify-between gap-4 border-b border-light-gray pb-4"><div><p className="font-mono text-sm font-bold text-brand-primary">{order.orderNumber}</p><p className="mt-1 text-xs text-gray-500">{order.user?.firstName} {order.user?.lastName} - {order.user?.email}</p><p className="mt-1 text-xs text-gray-500">Ordered {dateTime(order.createdAt)} - {deliveryLabel(order.deliveryMethod)}</p></div><div className="text-right"><p className="font-display text-lg text-brand-primary">{formatKES(order.total)}</p><p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{statusLabel(order.status)} / {order.paymentStatus}</p></div></div><div className="mt-4 grid gap-4 lg:grid-cols-[1fr_260px]"><div><p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Items</p><div className="mt-2 space-y-1 text-xs text-charcoal">{(order.items ?? []).map((item) => <p key={item.id}>{item.quantity} x {item.productName} - {formatKES(item.subtotal)}</p>)}</div><p className="mt-4 text-[10px] font-bold uppercase tracking-wider text-gray-400">Timeline</p><div className="mt-2 space-y-2">{(order.trackingHistory ?? []).map((event) => <div key={event.id} className="rounded-sm bg-off-white p-3 text-xs"><p className="font-bold text-brand-primary">{event.description}</p><p className="text-gray-500">{event.location || "No location"} - {dateTime(event.createdAt)}</p></div>)}</div></div><div><label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">Update Stage</label><select value={order.status} onChange={(e) => updateStage(order, e.target.value)} disabled={updating === order.id} className="mt-2 w-full rounded-sm border border-light-gray px-3 py-2 text-xs">{(!order.status || order.status !== "AWAITING_REFUND") ? ORDER_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>) : <option value="AWAITING_REFUND">Awaiting Refund</option>}</select>{order.status === "AWAITING_REFUND" && <button onClick={() => approveRefund(order)} disabled={updating === order.id} className="mt-3 w-full rounded-sm bg-success px-3 py-2 text-[10px] font-bold uppercase text-white hover:bg-green-600 disabled:opacity-50">Approve Refund</button>}<div className="mt-3 rounded-sm bg-light-pink p-3 text-[11px] text-charcoal"><p className="font-bold text-brand-primary">Delivery guide:</p><p>Store Pickup: Pickup Desk</p><p>Same-Day: Mombasa CBD Hub</p><p>Standard: Mombasa Main Station</p></div></div></div></div>)}
  </div>;
}

function UsersManager({ showToast }: { showToast: (message: string) => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]); const [selected, setSelected] = useState<string[]>([]); const [q, setQ] = useState(""); const [verified, setVerified] = useState(""); const [disabled, setDisabled] = useState(""); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  const loadUsers = async () => { setLoading(true); setError(""); try { const { data } = await adminAPI.users.getAll({ q: q || undefined, verified: verified || undefined, disabled: disabled || undefined }); setUsers(data.users); } catch (err) { const message = describeApiError(err, "Could not load users."); setError(message); showToast(message); } finally { setLoading(false); } };
  useEffect(() => { loadUsers(); }, [verified, disabled]);
  const toggleSelected = (id: string) => setSelected((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  const sendBulk = async () => { if (!selected.length) return showToast("Select at least one user"); try { const { data } = await adminAPI.users.sendVerificationBulk(selected); const sent = data.results.filter((result) => result.sent).length; showToast(`Verification sent to ${sent} user(s)`); await loadUsers(); } catch (err) { showToast(describeApiError(err, "Could not send verification links.")); } };
  const sendOne = async (id: string) => { try { const { data } = await adminAPI.users.sendVerification(id); showToast(data.sent ? "Verification link sent" : "Verification email could not be sent"); await loadUsers(); } catch (err) { showToast(describeApiError(err, "Could not send verification link.")); } };
  const setAccountDisabled = async (id: string, value: boolean) => { try { await adminAPI.users.setDisabled(id, value); showToast(value ? "Account disabled" : "Account enabled"); await loadUsers(); } catch (err) { showToast(describeApiError(err, "Could not update account.")); } };
  const handleDeleteClick = (id: string) => { setDeleteUserId(id); setDeleteConfirmOpen(true); };
  const handleDeleteConfirm = async () => { if (!deleteUserId) return; try { await adminAPI.users.delete(deleteUserId); showToast("User deleted"); await loadUsers(); setDeleteConfirmOpen(false); setDeleteUserId(null); } catch (error) { showToast(describeApiError(error, "Could not delete user.")); } };
  return (
    <>
      <div className="rounded-lg bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Users</h3>
            <p className="mt-1 text-xs text-gray-500">View accounts, send verification links, disable accounts, or delete accounts without orders.</p>
            <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-brand-accent">Showing {users.length} user(s)</p>
          </div>
          <button onClick={sendBulk} className="rounded-sm bg-brand-primary px-3 py-2 text-[10px] font-bold uppercase text-white hover:bg-brand-secondary hover:text-brand-primary">Send Verification to Selected</button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_160px_160px_90px]">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users" className="rounded-sm border border-light-gray px-3 py-2 text-xs" />
          <select value={verified} onChange={(e) => setVerified(e.target.value)} className="rounded-sm border border-light-gray px-3 py-2 text-xs">
            <option value="">All Verification</option>
            <option value="true">Verified</option>
            <option value="false">Unverified</option>
          </select>
          <select value={disabled} onChange={(e) => setDisabled(e.target.value)} className="rounded-sm border border-light-gray px-3 py-2 text-xs">
            <option value="">All Accounts</option>
            <option value="false">Active</option>
            <option value="true">Disabled</option>
          </select>
          <button onClick={loadUsers} className="rounded-sm border border-brand-primary px-3 py-2 text-[10px] font-bold uppercase text-brand-primary hover:bg-brand-primary hover:text-white">Search</button>
        </div>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-light-gray text-left text-[10px] font-bold uppercase tracking-wider text-gray-400">
                <th className="py-2">Select</th>
                <th>User</th>
                <th>Status</th>
                <th>Orders</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {error && <tr><td colSpan={6} className="py-4 text-center font-semibold text-error">{error}</td></tr>}
              {loading && <tr><td colSpan={6} className="py-6 text-center text-gray-400">Loading users...</td></tr>}
              {!loading && users.map((user) => (
                <tr key={user.id} className="border-b border-light-gray/70">
                  <td className="py-3"><input type="checkbox" checked={selected.includes(user.id)} onChange={() => toggleSelected(user.id)} /></td>
                  <td>
                    <p className="font-semibold text-brand-primary">{user.firstName} {user.lastName}</p>
                    <p className="text-gray-500">{user.email}</p>
                  </td>
                  <td><span className={user.isDisabled ? "text-error" : user.emailVerified ? "text-success" : "text-warning"}>{user.isDisabled ? "Disabled" : user.emailVerified ? "Verified" : "Unverified"}</span></td>
                  <td>{user._count?.orders ?? 0}</td>
                  <td>{new Date(user.createdAt).toLocaleDateString("en-KE")}</td>
                  <td className="space-x-2 whitespace-nowrap">
                    <button onClick={() => sendOne(user.id)} className="font-bold text-ocean-blue hover:underline">Verify</button>
                    <button onClick={() => setAccountDisabled(user.id, !user.isDisabled)} className="font-bold text-warning hover:underline">{user.isDisabled ? "Enable" : "Disable"}</button>
                    <button onClick={() => handleDeleteClick(user.id)} className="font-bold text-error hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <ConfirmModal
        open={deleteConfirmOpen}
        title="Delete User?"
        message="This action cannot be undone. The user account will be permanently deleted."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        tone="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => { setDeleteConfirmOpen(false); setDeleteUserId(null); }}
      />
    </>
  );
}

/* ============================================================= */
/* PROMOTIONS MANAGER                                            */
/* ============================================================= */
function PromotionsManager({ showToast }: { showToast: (message: string) => void }) {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const handleEditorInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
  };

  const insertHTML = (html: string) => {
    setContent(prev => prev + html);
    if (editorRef.current) {
      editorRef.current.focus();
    }
  };

  const loadSubscriptions = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await adminAPI.subscriptions.getAll({ active: activeFilter || undefined });
      setSubscriptions(data.subscriptions);
    } catch (err) {
      const message = describeApiError(err, "Could not load subscriptions.");
      setError(message);
      showToast(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSubscriptions();
  }, [activeFilter]);

  const sendPromotionalEmail = async () => {
    if (!subject || !content) return showToast("Subject and content are required");
    setSending(true);
    try {
      const { data } = await adminAPI.subscriptions.sendPromotional({ subject, content });
      showToast(`Email sent to ${data.successful} subscribers (${data.failed} failed)`);
      setSubject("");
      setContent("");
    } catch (error) {
      showToast(describeApiError(error, "Could not send promotional email."));
    } finally {
      setSending(false);
    }
  };

  const deleteSubscription = async (id: string) => {
    try {
      await adminAPI.subscriptions.delete(id);
      showToast("Subscription deleted");
      loadSubscriptions();
    } catch (error) {
      showToast(describeApiError(error, "Could not delete subscription."));
    }
  };

  return <div className="space-y-4">
    <div className="rounded-lg bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Promotions & Subscriptions</h3>
          <p className="mt-1 text-xs text-gray-500">Manage email subscriptions and send promotional emails to subscribers.</p>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-brand-accent">Showing {subscriptions.length} subscription(s)</p>
        </div>
        <button onClick={loadSubscriptions} className="rounded-sm border border-brand-primary px-3 py-2 text-[10px] font-bold uppercase text-brand-primary hover:bg-brand-primary hover:text-white">Refresh</button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)} className="rounded-sm border border-light-gray px-3 py-2 text-xs">
          <option value="">All Subscriptions</option>
          <option value="true">Active Only</option>
          <option value="false">Inactive Only</option>
        </select>
      </div>
    </div>

    {error && <div className="rounded-lg bg-error/10 p-4 text-sm font-semibold text-error shadow-sm">{error}</div>}
    {loading && <div className="rounded-lg bg-white p-6 text-sm text-gray-500 shadow-sm">Loading subscriptions...</div>}

    <div className="rounded-lg bg-white p-5 shadow-sm">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary mb-4">Send Promotional Email</h3>
      <div className="space-y-3">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject line" className="w-full rounded-sm border border-light-gray px-3 py-2 text-xs" />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">Content (HTML supported)</label>
          <div className="rounded-sm border border-light-gray">
            <div className="flex flex-wrap items-center gap-1 border-b border-light-gray bg-off-white p-2">
              <button onClick={() => insertHTML('<strong>')} className="rounded px-2 py-1 text-xs font-bold hover:bg-gray-200" title="Bold">B</button>
              <button onClick={() => insertHTML('<em>')} className="rounded px-2 py-1 text-xs italic hover:bg-gray-200" title="Italic">I</button>
              <button onClick={() => insertHTML('<u>')} className="rounded px-2 py-1 text-xs underline hover:bg-gray-200" title="Underline">U</button>
              <div className="w-px h-5 bg-gray-300 mx-1"></div>
              <button onClick={() => insertHTML('<ul><li>')} className="rounded px-2 py-1 text-xs hover:bg-gray-200" title="Bullet List">•</button>
              <button onClick={() => insertHTML('<ol><li>')} className="rounded px-2 py-1 text-xs hover:bg-gray-200" title="Numbered List">1.</button>
              <div className="w-px h-5 bg-gray-300 mx-1"></div>
              <button onClick={() => {
                const url = prompt('Enter link URL:');
                if (url) insertHTML(`<a href="${url}">`);
              }} className="rounded px-2 py-1 text-xs hover:bg-gray-200" title="Insert Link">🔗</button>
            </div>
            <textarea
              ref={editorRef}
              value={content}
              onChange={handleEditorInput}
              placeholder="Email content... (HTML supported)"
              rows={6}
              className="w-full p-3 text-xs outline-none resize-none"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={sendPromotionalEmail} disabled={sending || subscriptions.length === 0} className="rounded-sm bg-brand-primary px-4 py-2 text-[10px] font-bold uppercase text-white hover:bg-brand-secondary hover:text-brand-primary disabled:opacity-50">
            {sending ? "Sending..." : `Send to ${subscriptions.length} Subscribers`}
          </button>
        </div>
      </div>
    </div>

    {!loading && (
      <div className="rounded-lg bg-white p-5 shadow-sm">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary mb-4">Subscriptions</h3>
        {subscriptions.length === 0 ? (
          <p className="text-sm text-gray-500">No subscriptions found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-light-gray text-left text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  <th className="py-2">Email</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Subscribed</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((sub) => (
                  <tr key={sub.id} className="border-b border-light-gray">
                    <td className="py-2">{sub.email}</td>
                    <td className="py-2">
                      <span className={`rounded-full px-2 py-1 text-xs ${sub.isActive ? 'bg-success/10 text-success' : 'bg-error/10 text-error'}`}>
                        {sub.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-2">{new Date(sub.createdAt).toLocaleDateString()}</td>
                    <td className="py-2">
                      <button onClick={() => deleteSubscription(sub.id)} className="text-error hover:underline">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )}
  </div>;
}
