import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES, PRODUCTS, stockStatus, type Product } from "../data/products";
import { Container } from "../components/ui";
import {
  formatKES,
  useStore,
  isDiscountActive,
  discountAppliesTo,
  type Discount,
} from "../store/StoreContext";
import { useAdminDraft } from "../store/useAdminDraft";
import { ConfirmModal, Toast } from "../components/Modal";
import { navigate } from "../router";
import { useCustomize, FONT_OPTIONS, COLOR_PRESETS, COLOR_SLOT_LEGEND } from "../store/CustomizeContext";
import { adminAPI } from "../api/admin";
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

const TABS = ["Dashboard", "Discounts", "Stock", "Catalog", "Customize", "Orders", "Users", "Promotions", "Analytics"] as const;

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

type AdminSession = {
  id: string;
  email: string;
  username: string;
  role: string;
};

export default function Admin() {
  const [admin, setAdmin] = useState<AdminSession | null>(() => {
    try {
      const raw = localStorage.getItem("adminUser");
      return raw ? (JSON.parse(raw) as AdminSession) : null;
    } catch {
      return null;
    }
  });

  if (!admin) {
    return <AdminLogin onLogin={setAdmin} />;
  }

  return (
    <AdminDashboard
      admin={admin}
      onLogout={() => {
        localStorage.removeItem("adminToken");
        localStorage.removeItem("adminRefreshToken");
        localStorage.removeItem("adminUser");
        setAdmin(null);
      }}
    />
  );
}

function AdminLogin({ onLogin }: { onLogin: (admin: AdminSession) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data } = await adminAPI.login({ email, password });
      localStorage.setItem("adminToken", data.token);
      localStorage.setItem("adminRefreshToken", data.refreshToken);
      localStorage.setItem("adminUser", JSON.stringify(data.admin));
      onLogin(data.admin);
    } catch {
      setError("Invalid admin email or password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-off-white px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg bg-white p-8 shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-sm bg-brand-primary text-sm font-bold text-brand-secondary">NM</div>
        <h1 className="mt-5 text-center font-display text-2xl uppercase tracking-wider text-brand-primary">Admin Login</h1>
        <p className="mt-2 text-center text-sm text-gray-500">Staff credentials are required for dashboard access.</p>
        {error && <p className="mt-4 rounded-sm bg-error/10 p-3 text-center text-xs font-semibold text-error">{error}</p>}
        <div className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-sm border border-light-gray px-3 py-2.5 text-sm outline-none focus:border-brand-secondary" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Password</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-sm border border-light-gray px-3 py-2.5 text-sm outline-none focus:border-brand-secondary" />
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
  const { state, commitAdmin, publishAdmin } = useStore();
  const draftApi = useAdminDraft(state.admin, (data) => commitAdmin(data));
  const [tab, setTab] = useState<(typeof TABS)[number]>("Dashboard");

  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [toast, setToast] = useState("");

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 2500);
  };

  const doSave = async () => {
    try {
      await publishAdmin(draftApi.draft);
      draftApi.markSaved();
      setConfirmSave(false);
      showToast("Changes published to the live store");
    } catch {
      showToast("Could not publish changes. Please sign in again.");
    }
  };

  const tryExit = () => {
    if (draftApi.dirty) setConfirmExit(true);
    else navigate("/");
  };

  // Products reflecting DRAFT stock (so admin sees pending edits)
  const draftProducts = PRODUCTS.map((p) => ({
    ...p,
    stock: draftApi.draft.stock[p.id] ?? p.stock,
  }));

  const lowStock = draftProducts.filter((p) => stockStatus(p.stock) === "low");
  const outStock = draftProducts.filter((p) => stockStatus(p.stock) === "out");
  const inventoryValue = draftProducts.reduce((s, p) => s + p.price * p.stock, 0);
  const activeDiscounts = draftApi.draft.discounts.filter((d) => isDiscountActive(d));

  const catTotals = useMemo(() => {
    return CATEGORIES.map((c) => {
      const items = draftProducts.filter((p) => p.categorySlug === c.slug);
      const value = items.reduce((s, p) => s + p.price * p.stock, 0);
      return { ...c, value };
    }).sort((a, b) => b.value - a.value);
  }, [draftProducts]);
  const maxCatValue = Math.max(...catTotals.map((c) => c.value), 1);

  return (
    <div className="min-h-screen bg-off-white text-brand-primary">
      {/* Top bar */}
      <div className="sticky top-0 z-40 bg-brand-primary py-4">
        <Container className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-brand-secondary text-xs font-bold text-brand-primary">NM</div>
            <h1 className="font-display text-lg tracking-wider text-white">Admin Dashboard</h1>
            <span className="hidden rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/70 sm:inline">
              {admin.username} · {admin.role}
            </span>
            {draftApi.dirty && (
              <span className="rounded-full bg-warning/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning">
                Unsaved changes
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Undo / Redo */}
            <button
              onClick={draftApi.undo}
              disabled={!draftApi.canUndo}
              title="Undo"
              className="flex h-8 w-8 items-center justify-center rounded-sm bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-30"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4"><path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" /></svg>
            </button>
            <button
              onClick={draftApi.redo}
              disabled={!draftApi.canRedo}
              title="Redo"
              className="flex h-8 w-8 items-center justify-center rounded-sm bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-30"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4"><path strokeLinecap="round" strokeLinejoin="round" d="m15 15 6-6m0 0-6-6m6 6H9a6 6 0 0 0 0 12h3" /></svg>
            </button>

            {/* Save */}
            <button
              onClick={() => setConfirmSave(true)}
              disabled={!draftApi.dirty}
              className="rounded-sm bg-brand-secondary px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-primary transition-all hover:bg-white disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/40"
            >
              Save Changes
            </button>

            <button onClick={tryExit} className="ml-1 text-[10px] font-bold uppercase tracking-widest text-white/60 hover:text-white">
              ← Exit
            </button>
            <button onClick={onLogout} className="text-[10px] font-bold uppercase tracking-widest text-white/60 hover:text-white">
              Logout
            </button>
          </div>
        </Container>
      </div>

      <Container className="py-6">
        <div className="no-scrollbar mb-6 flex gap-0.5 border-b border-light-gray">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`whitespace-nowrap px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors ${
                tab === t ? "border-b-2 border-brand-primary text-brand-primary" : "text-gray-400 hover:text-charcoal"
              }`}
            >
              {t}
              {t === "Discounts" && activeDiscounts.length > 0 && (
                <span className="ml-1.5 rounded-full bg-success px-1.5 py-0.5 text-[9px] text-white">{activeDiscounts.length}</span>
              )}
            </button>
          ))}
        </div>

        {tab === "Dashboard" && (
          <DashboardPanel activeDiscounts={activeDiscounts.length} lowStock={lowStock} outStock={outStock} />
        )}

        {tab === "Analytics" && (
          <AnalyticsPanel inventoryValue={inventoryValue} catTotals={catTotals} maxCatValue={maxCatValue} />
        )}

        {tab === "Discounts" && <DiscountManager draftApi={draftApi} />}
        {tab === "Stock" && <StockManager draftApi={draftApi} />}
        {tab === "Catalog" && <CatalogManager draftApi={draftApi} />}
        {tab === "Customize" && <CustomizePanel />}

        {tab === "Orders" && <OrdersManager showToast={showToast} />}
        {tab === "Users" && <UsersManager showToast={showToast} />}
        {tab === "Promotions" && <PromotionsManager showToast={showToast} />}
      </Container>

      {/* Save confirmation */}
      <ConfirmModal
        open={confirmSave}
        title="Save Changes?"
        message="These changes are applied to the live store as you edit them. Saving here just keeps the draft baseline in sync."
        confirmLabel="Yes, Save"
        onConfirm={doSave}
        onCancel={() => setConfirmSave(false)}
      />

      {/* Exit with unsaved changes */}
      <ConfirmModal
        open={confirmExit}
        title="Discard unsaved changes?"
        message="You have unsaved changes. Leaving now will discard them."
        confirmLabel="Discard & Exit"
        cancelLabel="Keep Editing"
        tone="danger"
        onConfirm={() => { setConfirmExit(false); navigate("/"); }}
        onCancel={() => setConfirmExit(false)}
      />

      <Toast open={!!toast} message={toast} />
    </div>
  );
}


type AdminOrder = {
  id: string;
  orderNumber: string;
  total: number;
  status: string;
  paymentStatus: string;
  deliveryMethod: string;
  createdAt: string;
  updatedAt: string;
  user?: { firstName: string; lastName: string; email: string; phone?: string };
  address?: { city: string; county: string; street: string };
  items?: { id: string; productName: string; quantity: number; subtotal: number }[];
  trackingHistory?: { id: string; status: string; description: string; location?: string; createdAt: string }[];
};

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

function downloadPdf(filename: string, rows: Record<string, unknown>[], title: string) {
  if (!rows.length) return;
  const doc = new jsPDF();
  
  // Brand colors
  const brandPrimary = "#2B1B12";
  const brandSecondary = "#D7A84F";
  
  // Add logo placeholder (you can replace with actual logo URL)
  doc.setFontSize(20);
  doc.setTextColor(parseInt(brandPrimary.slice(1, 3), 16), parseInt(brandPrimary.slice(3, 5), 16), parseInt(brandPrimary.slice(5, 7), 16));
  doc.text("No Maneno Bazaar", 14, 20);
  
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

function DashboardPanel({ activeDiscounts, lowStock, outStock }: { activeDiscounts: number; lowStock: Product[]; outStock: Product[] }) {
  const [metrics, setMetrics] = useState<any>(null);

  useEffect(() => {
    adminAPI.analytics.getDashboard().then(({ data }: any) => setMetrics(data)).catch(() => setMetrics(null));
  }, []);

  const cards = [
    ["Revenue", formatKES(metrics?.sales?.total || 0), "bg-brand-secondary"],
    ["Live Orders", String(metrics?.orders?.total || 0), "bg-ocean-blue"],
    ["Processing", String(metrics?.orders?.processing || 0), "bg-coral"],
    ["Cancelled", String(metrics?.orders?.cancelled || 0), "bg-error"],
    ["Refunded", formatKES(metrics?.refunds?.total || 0), "bg-warning"],
    ["Active Discounts", String(activeDiscounts), "bg-success"],
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {cards.map(([label, value, color]) => (
          <div key={label} className="rounded-lg bg-white p-5 shadow-sm">
            <div className={`mb-2 h-1 w-8 rounded-full ${color}`} />
            <p className="font-display text-xl text-brand-primary">{value}</p>
            <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-lg bg-white p-6 shadow-sm">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Recent Live Orders</h3>
          <div className="mt-4 space-y-3">
            {(metrics?.recentOrders || []).slice(0, 8).map((order: any) => (
              <div key={order.id} className="flex items-center justify-between border-b border-light-gray pb-3 text-xs last:border-b-0">
                <div>
                  <p className="font-mono font-bold text-brand-primary">{order.orderNumber}</p>
                  <p className="text-gray-500">{order.user?.firstName} {order.user?.lastName} - {statusLabel(order.status)}</p>
                </div>
                <p className="font-bold text-brand-primary">{formatKES(order.total)}</p>
              </div>
            ))}
            {!metrics?.recentOrders?.length && <p className="text-sm text-gray-500">No live orders yet.</p>}
          </div>
        </div>

        <div className="rounded-lg bg-white p-6 shadow-sm">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Attention Queue</h3>
          <div className="mt-4 space-y-3 text-sm">
            <p className="flex justify-between"><span>Low stock</span><strong className="text-warning">{lowStock.length}</strong></p>
            <p className="flex justify-between"><span>Out of stock</span><strong className="text-error">{outStock.length}</strong></p>
            <p className="flex justify-between"><span>Pending orders</span><strong>{metrics?.orders?.pending || 0}</strong></p>
            <p className="flex justify-between"><span>Returns</span><strong>{metrics?.orders?.returned || 0}</strong></p>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnalyticsPanel({ inventoryValue, catTotals, maxCatValue }: { inventoryValue: number; catTotals: Array<{ slug: string; name: string; value: number }>; maxCatValue: number }) {
  const [period, setPeriod] = useState("month");
  const [report, setReport] = useState<any>(null);
  const [downloadFormat, setDownloadFormat] = useState<"csv" | "excel" | "pdf">("csv");

  useEffect(() => {
    adminAPI.analytics.getSales({ period }).then(({ data }: any) => setReport(data)).catch(() => setReport(null));
  }, [period]);

  const rows = (report?.orders || []).map((order: any) => ({
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
    
    switch (downloadFormat) {
      case "csv":
        downloadCsv(`${filename}.csv`, rows);
        break;
      case "excel":
        downloadExcel(`${filename}.xlsx`, rows);
        break;
      case "pdf":
        downloadPdf(`${filename}.pdf`, rows, title);
        break;
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Financial Report</h3>
            <p className="mt-1 text-xs text-gray-500">Live order revenue, cancellations, returns, and visual refunds.</p>
          </div>
          <div className="flex gap-2">
            <select value={period} onChange={(event) => setPeriod(event.target.value)} className="rounded-sm border border-light-gray px-3 py-2 text-xs">
              <option value="day">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="year">This Year</option>
            </select>
            <select value={downloadFormat} onChange={(event) => setDownloadFormat(event.target.value as "csv" | "excel" | "pdf")} className="rounded-sm border border-light-gray px-3 py-2 text-xs">
              <option value="csv">CSV</option>
              <option value="excel">Excel</option>
              <option value="pdf">PDF</option>
            </select>
            <button onClick={handleDownload} className="rounded-sm bg-brand-primary px-3 py-2 text-[10px] font-bold uppercase text-white hover:bg-brand-secondary hover:text-brand-primary">
              Download Report
            </button>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            ["Net Revenue", formatKES(report?.totalRevenue || 0)],
            ["Gross Orders", String(report?.totalOrders || 0)],
            ["Cancelled", formatKES(report?.cancelledValue || 0)],
            ["Returned", formatKES(report?.returnedValue || 0)],
            ["Refunded", formatKES(report?.refundedValue || 0)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md bg-off-white p-4">
              <p className="font-display text-lg text-brand-primary">{value}</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg bg-white p-6 shadow-sm">
          <h3 className="mb-5 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Inventory Value by Category</h3>
          <div className="space-y-3">
            {catTotals.map((c) => (
              <div key={c.slug}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-charcoal">{c.name}</span>
                  <span className="font-medium text-brand-primary">{formatKES(c.value)}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-off-white">
                  <div className="h-full rounded-full bg-brand-secondary transition-all" style={{ width: `${(c.value / maxCatValue) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-5 border-t border-light-gray pt-3 text-xs text-gray-500">
            Total Inventory Value: <strong className="text-brand-primary">{formatKES(inventoryValue)}</strong>
          </p>
        </div>

        <div className="rounded-lg bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Report Orders</h3>
          <div className="max-h-80 overflow-y-auto text-xs">
            {rows.slice(0, 12).map((row: any) => (
              <div key={row.orderNumber} className="flex justify-between border-b border-light-gray py-2">
                <span className="font-mono text-brand-primary">{row.orderNumber}</span>
                <span>{row.status}</span>
                <strong>{formatKES(Number(row.total || 0))}</strong>
              </div>
            ))}
            {!rows.length && <p className="text-gray-500">No orders in this period.</p>}
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
        const allOrders = [...(deliveredData.orders || []), ...(refundedData.orders || [])] as AdminOrder[];
        setOrders(allOrders);
      } else if (activeTab === "refund") {
        statusFilter = "AWAITING_REFUND";
        const { data } = await adminAPI.orders.getAll({ status: statusFilter, deliveryMethod: deliveryMethod || undefined, orderedDay: orderedDay || undefined, limit: 100 });
        setOrders((data.orders ?? []) as AdminOrder[]);
      } else {
        // Live orders: Only show orders in progress (exclude DELIVERED, AWAITING_REFUND, CANCELLED, RETURNED)
        const { data } = await adminAPI.orders.getAll({ status: statusFilter, deliveryMethod: deliveryMethod || undefined, orderedDay: orderedDay || undefined, limit: 100 });
        const ordersArray = (data.orders || []) as AdminOrder[];
        const filteredOrders = ordersArray.filter((order) => 
          !["DELIVERED", "AWAITING_REFUND", "CANCELLED", "RETURNED"].includes(order.status)
        );
        setOrders(filteredOrders);
      }
    } catch (err: any) {
      const message = err?.response?.data?.error || err?.message || "Could not load orders";
      setError(message);
      showToast(message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { loadOrders(); }, [status, deliveryMethod, orderedDay, activeTab]);
    const syncLocalReceipts = async () => {
    const receipts: any[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith("nmb-receipts-")) continue;
      try {
        const batch = JSON.parse(localStorage.getItem(key) || "[]");
        if (Array.isArray(batch)) receipts.push(...batch);
      } catch {
        /* ignore malformed local receipt data */
      }
    }
    if (!receipts.length) return showToast("No local receipts found on this device");
    try {
      const { data } = await adminAPI.orders.importLocal(receipts);
      const imported = (data.results ?? []).filter((item: any) => item.imported).length;
      showToast(`Imported ${imported} local receipt(s)`);
      await loadOrders();
    } catch (err: any) {
      showToast(err?.response?.data?.error || "Could not import local receipts");
    }
  };
const updateStage = async (order: AdminOrder, nextStatus: string) => {
    const preset = STAGE_PRESETS[nextStatus] ?? STAGE_PRESETS.PROCESSING;
    setUpdating(order.id);
    try { await adminAPI.orders.updateStatus(order.id, { status: nextStatus, ...preset }); showToast(`Order ${order.orderNumber} updated to ${statusLabel(nextStatus)}`); await loadOrders(); }
    catch { showToast("Could not update order stage"); }
    finally { setUpdating(""); }
  };
  const approveRefund = async (order: AdminOrder) => {
    setUpdating(order.id);
    try { await adminAPI.orders.approveRefund(order.id); showToast(`Refund approved for order ${order.orderNumber}`); await loadOrders(); }
    catch { showToast("Could not approve refund"); }
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
          <button onClick={syncLocalReceipts} className="rounded-sm bg-brand-secondary px-3 py-2 text-[10px] font-bold uppercase text-brand-primary hover:bg-brand-primary hover:text-white">Sync Local Receipts</button>
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
    {!loading && orders.length === 0 && <div className="rounded-lg bg-white p-6 text-sm text-gray-500 shadow-sm">No backend orders match these filters. If these were older checkout receipts saved on this browser before backend order sync was added, use Sync Local Receipts to import them once.</div>}
    {orders.map((order) => <div key={order.id} className="rounded-lg bg-white p-5 shadow-sm"><div className="flex flex-wrap justify-between gap-4 border-b border-light-gray pb-4"><div><p className="font-mono text-sm font-bold text-brand-primary">{order.orderNumber}</p><p className="mt-1 text-xs text-gray-500">{order.user?.firstName} {order.user?.lastName} - {order.user?.email}</p><p className="mt-1 text-xs text-gray-500">Ordered {dateTime(order.createdAt)} - {deliveryLabel(order.deliveryMethod)}</p></div><div className="text-right"><p className="font-display text-lg text-brand-primary">{formatKES(order.total)}</p><p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{statusLabel(order.status)} / {order.paymentStatus}</p></div></div><div className="mt-4 grid gap-4 lg:grid-cols-[1fr_260px]"><div><p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Items</p><div className="mt-2 space-y-1 text-xs text-charcoal">{(order.items ?? []).map((item) => <p key={item.id}>{item.quantity} x {item.productName} - {formatKES(item.subtotal)}</p>)}</div><p className="mt-4 text-[10px] font-bold uppercase tracking-wider text-gray-400">Timeline</p><div className="mt-2 space-y-2">{(order.trackingHistory ?? []).map((event) => <div key={event.id} className="rounded-sm bg-off-white p-3 text-xs"><p className="font-bold text-brand-primary">{event.description}</p><p className="text-gray-500">{event.location || "No location"} - {dateTime(event.createdAt)}</p></div>)}</div></div><div><label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400">Update Stage</label><select value={order.status} onChange={(e) => updateStage(order, e.target.value)} disabled={updating === order.id} className="mt-2 w-full rounded-sm border border-light-gray px-3 py-2 text-xs">{(!order.status || order.status !== "AWAITING_REFUND") ? ORDER_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>) : <option value="AWAITING_REFUND">Awaiting Refund</option>}</select>{order.status === "AWAITING_REFUND" && <button onClick={() => approveRefund(order)} disabled={updating === order.id} className="mt-3 w-full rounded-sm bg-success px-3 py-2 text-[10px] font-bold uppercase text-white hover:bg-green-600 disabled:opacity-50">Approve Refund</button>}<div className="mt-3 rounded-sm bg-light-pink p-3 text-[11px] text-charcoal"><p className="font-bold text-brand-primary">Delivery guide:</p><p>Store Pickup: Pickup Desk</p><p>Same-Day: Mombasa CBD Hub</p><p>Standard: Mombasa Main Station</p></div></div></div></div>)}
  </div>;
}

type AdminUser = { id: string; email: string; firstName: string; lastName: string; phone?: string; emailVerified: boolean; isDisabled: boolean; createdAt: string; _count?: { orders: number; addresses: number; wishlist: number } };
function UsersManager({ showToast }: { showToast: (message: string) => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]); const [selected, setSelected] = useState<string[]>([]); const [q, setQ] = useState(""); const [verified, setVerified] = useState(""); const [disabled, setDisabled] = useState(""); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  const loadUsers = async () => { setLoading(true); setError(""); try { const { data } = await adminAPI.users.getAll({ q: q || undefined, verified: verified || undefined, disabled: disabled || undefined }); setUsers((data.users ?? []) as AdminUser[]); } catch (err: any) { const message = err?.response?.data?.error || err?.message || "Could not load users"; setError(message); showToast(message); } finally { setLoading(false); } };
  useEffect(() => { loadUsers(); }, [verified, disabled]);
  const toggleSelected = (id: string) => setSelected((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  const sendBulk = async () => { if (!selected.length) return showToast("Select at least one user"); try { const { data } = await adminAPI.users.sendVerificationBulk(selected); const sent = (data.results ?? []).filter((r: any) => r.sent).length; showToast(`Verification sent to ${sent} user(s)`); await loadUsers(); } catch { showToast("Could not send verification links"); } };
  const sendOne = async (id: string) => { try { const { data } = await adminAPI.users.sendVerification(id); showToast(data.sent ? "Verification link sent" : "Verification email could not be sent"); await loadUsers(); } catch { showToast("Could not send verification link"); } };
  const setAccountDisabled = async (id: string, value: boolean) => { try { await adminAPI.users.setDisabled(id, value); showToast(value ? "Account disabled" : "Account enabled"); await loadUsers(); } catch { showToast("Could not update account"); } };
  const handleDeleteClick = (id: string) => { setDeleteUserId(id); setDeleteConfirmOpen(true); };
  const handleDeleteConfirm = async () => { if (!deleteUserId) return; try { await adminAPI.users.delete(deleteUserId); showToast("User deleted"); await loadUsers(); setDeleteConfirmOpen(false); setDeleteUserId(null); } catch (error: any) { showToast(error?.response?.data?.error || "Could not delete user"); } };
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
/* DISCOUNT MANAGER                                              */
/* ============================================================= */
type DraftApi = ReturnType<typeof useAdminDraft>;

function DiscountManager({ draftApi }: { draftApi: DraftApi }) {
  const { draft, addDiscount, updateDiscount, removeDiscount } = draftApi;
  const [confirmStop, setConfirmStop] = useState<string | null>(null);

  // form
  const [scope, setScope] = useState<"all" | "category" | "products">("category");
  const [categorySlug, setCategorySlug] = useState(CATEGORIES[0].slug);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [percent, setPercent] = useState(10);
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO(7));
  const [search, setSearch] = useState("");
  const [confirmAdd, setConfirmAdd] = useState(false);

  const filteredForPick = PRODUCTS.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const resetForm = () => {
    setSelectedProducts([]);
    setPercent(10);
    setStartDate(todayISO());
    setEndDate(todayISO(7));
    setSearch("");
  };

  const handleCreate = () => {
    const name =
      scope === "all"
        ? "All Products Sale"
        : scope === "category"
        ? `${CATEGORIES.find((c) => c.slug === categorySlug)?.name} Sale`
        : `${selectedProducts.length} Item Sale`;
    const d: Discount = {
      id: "disc-" + Date.now(),
      name,
      scope,
      categorySlug: scope === "category" ? categorySlug : undefined,
      productIds: scope === "products" ? selectedProducts : [],
      percent,
      startDate,
      endDate,
    };
    addDiscount(d);
    setConfirmAdd(false);
    resetForm();
  };

  const canCreate = percent > 0 && (scope !== "products" || selectedProducts.length > 0);

  const countAffected = (d: Discount) => {
    if (d.scope === "all") return PRODUCTS.length;
    return PRODUCTS.filter((p) => discountAppliesTo(d, p)).length;
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
      {/* ---- Create form ---- */}
      <div className="h-fit rounded-lg bg-white p-6 shadow-sm">
        <h3 className="mb-5 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Create Discount</h3>

        {/* Scope */}
        <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Apply To</label>
        <div className="mb-4 grid grid-cols-3 gap-1">
          {([["all", "All"], ["category", "Category"], ["products", "Products"]] as const).map(([v, l]) => (
            <button
              key={v}
              onClick={() => setScope(v)}
              className={`rounded-sm border py-2 text-[11px] font-bold ${scope === v ? "border-brand-primary bg-brand-primary text-white" : "border-light-gray text-gray-400"}`}
            >
              {l}
            </button>
          ))}
        </div>

        {scope === "category" && (
          <div className="mb-4">
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Category</label>
            <select
              value={categorySlug}
              onChange={(e) => setCategorySlug(e.target.value)}
              className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2.5 text-sm outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c.slug} value={c.slug}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {scope === "products" && (
          <div className="mb-4">
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-gray-400">
              Pick Products ({selectedProducts.length} selected)
            </label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products…"
              className="mb-2 w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-xs outline-none"
            />
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-sm border border-light-gray p-2">
              {filteredForPick.slice(0, 60).map((p) => {
                const checked = selectedProducts.includes(p.id);
                return (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-xs hover:bg-off-white">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelectedProducts((arr) =>
                          checked ? arr.filter((x) => x !== p.id) : [...arr, p.id]
                        )
                      }
                      className="h-3.5 w-3.5 accent-brand-secondary"
                    />
                    <img src={p.image} alt="" className="h-6 w-6 rounded-sm object-cover" />
                    <span className="flex-1 truncate text-charcoal">{p.name}</span>
                    <span className="text-gray-400">{formatKES(p.price)}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Percent */}
        <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Discount %</label>
        <div className="mb-2 flex gap-1">
          {[5, 10, 15, 20, 25, 50].map((v) => (
            <button
              key={v}
              onClick={() => setPercent(v)}
              className={`flex-1 rounded-sm border py-1.5 text-[11px] font-bold ${percent === v ? "border-brand-primary bg-brand-primary text-white" : "border-light-gray text-gray-400"}`}
            >
              {v}%
            </button>
          ))}
        </div>
        <input
          type="number"
          value={percent}
          min={1}
          max={90}
          onChange={(e) => setPercent(Number(e.target.value))}
          className="mb-4 w-full rounded-sm border border-light-gray bg-off-white px-3 py-2.5 text-sm outline-none"
          placeholder="Custom %"
        />

        {/* Duration */}
        <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Duration</label>
        <div className="mb-5 grid grid-cols-2 gap-2">
          <div>
            <span className="mb-1 block text-[9px] uppercase text-gray-400">Start</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-sm border border-light-gray bg-off-white px-2 py-2 text-xs outline-none" />
          </div>
          <div>
            <span className="mb-1 block text-[9px] uppercase text-gray-400">End</span>
            <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded-sm border border-light-gray bg-off-white px-2 py-2 text-xs outline-none" />
          </div>
        </div>

        <button
          onClick={() => setConfirmAdd(true)}
          disabled={!canCreate}
          className="w-full rounded-sm bg-brand-primary py-3 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-brand-secondary hover:text-brand-primary disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
        >
          Add Discount
        </button>
        <p className="mt-2 text-center text-[10px] text-gray-400">Remember to click <strong>Save Changes</strong> at the top to publish.</p>
      </div>

      {/* ---- Active / scheduled discounts list ---- */}
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">
          Current Discounts ({draft.discounts.length})
        </h3>

        {draft.discounts.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            No discounts yet. Create one using the form on the left.
          </div>
        ) : (
          <div className="space-y-3">
            {draft.discounts.map((d) => {
              const active = isDiscountActive(d);
              return (
                <div key={d.id} className="rounded-md border border-light-gray p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-brand-primary">{d.name}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${active ? "bg-success/15 text-success" : "bg-gray-100 text-gray-400"}`}>
                          {active ? "Active" : "Scheduled / Ended"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-400">
                        {countAffected(d)} products · {d.startDate} → {d.endDate}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="font-display text-2xl text-coral">{d.percent}%</span>
                      <span className="block text-[9px] uppercase tracking-wider text-gray-400">off</span>
                    </div>
                  </div>

                  {/* Inline editing */}
                  <div className="mt-3 grid gap-2 border-t border-light-gray pt-3 sm:grid-cols-3">
                    <div>
                      <span className="mb-1 block text-[9px] uppercase text-gray-400">Percentage</span>
                      <input
                        type="number"
                        value={d.percent}
                        min={1}
                        max={90}
                        onChange={(e) => updateDiscount(d.id, { percent: Number(e.target.value) })}
                        className="w-full rounded-sm border border-light-gray bg-off-white px-2 py-1.5 text-xs outline-none"
                      />
                    </div>
                    <div>
                      <span className="mb-1 block text-[9px] uppercase text-gray-400">Extend End Date</span>
                      <input
                        type="date"
                        value={d.endDate}
                        min={d.startDate}
                        onChange={(e) => updateDiscount(d.id, { endDate: e.target.value })}
                        className="w-full rounded-sm border border-light-gray bg-off-white px-2 py-1.5 text-xs outline-none"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        onClick={() => setConfirmStop(d.id)}
                        className="w-full rounded-sm border border-error/40 py-1.5 text-[10px] font-bold uppercase tracking-wider text-error transition-colors hover:bg-error hover:text-white"
                      >
                        Stop Discount
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add confirm */}
      <ConfirmModal
        open={confirmAdd}
        title="Add this discount?"
        message={`A ${percent}% discount will be created. Don't forget to Save Changes to make it live.`}
        confirmLabel="Add Discount"
        onConfirm={handleCreate}
        onCancel={() => setConfirmAdd(false)}
      />

      {/* Stop confirm */}
      <ConfirmModal
        open={!!confirmStop}
        title="Stop this discount?"
        message="This will permanently remove the discount from the draft."
        confirmLabel="Stop Discount"
        tone="danger"
        onConfirm={() => { if (confirmStop) removeDiscount(confirmStop); setConfirmStop(null); }}
        onCancel={() => setConfirmStop(null)}
      />
    </div>
  );
}

/* ============================================================= */
/* STOCK MANAGER                                                */
/* ============================================================= */
function StockManager({ draftApi }: { draftApi: DraftApi }) {
  const { draft, setStock, bulkStock } = draftApi;
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [bulkVal, setBulkVal] = useState(50);
  const [confirmBulk, setConfirmBulk] = useState<null | { ids: string[]; op: "add" | "sub" | "set"; label: string }>(null);

  const products = PRODUCTS.map((p) => ({ ...p, stock: draft.stock[p.id] ?? p.stock }));
  const list = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) &&
      (!catFilter || p.categorySlug === catFilter)
  );
  const visibleIds = list.map((p) => p.id);
  const allIds = PRODUCTS.map((p) => p.id);

  const runBulk = () => {
    if (confirmBulk) bulkStock(confirmBulk.ids, confirmBulk.op, bulkVal);
    setConfirmBulk(null);
  };

  return (
    <div className="rounded-lg bg-white p-6 shadow-sm">
      <h3 className="mb-4 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Stock Management</h3>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <div className="flex gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="flex-1 rounded-sm border border-light-gray bg-off-white px-3 py-2 text-xs outline-none"
          />
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="rounded-sm border border-light-gray px-3 py-2 text-xs">
            <option value="">All Categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-md bg-off-white p-3 text-xs">
          <span className="font-semibold text-brand-primary">Bulk:</span>
          <input
            type="number"
            value={bulkVal}
            onChange={(e) => setBulkVal(Number(e.target.value))}
            className="w-16 rounded-sm border border-light-gray px-2 py-1.5 text-xs"
          />
          <button onClick={() => setConfirmBulk({ ids: visibleIds, op: "add", label: `Add ${bulkVal} to ${visibleIds.length} filtered products` })} className="rounded-sm bg-success px-3 py-1.5 font-semibold text-white">Add (filtered)</button>
          <button onClick={() => setConfirmBulk({ ids: visibleIds, op: "sub", label: `Subtract ${bulkVal} from ${visibleIds.length} filtered products` })} className="rounded-sm bg-warning px-3 py-1.5 font-semibold text-white">Subtract</button>
          <button onClick={() => setConfirmBulk({ ids: allIds, op: "add", label: `Add ${bulkVal} to ALL ${allIds.length} products` })} className="rounded-sm bg-brand-primary px-3 py-1.5 font-semibold text-white">Add to ALL</button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-light-gray text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">
              <th className="py-2.5">Product</th><th>Stock</th><th>Max</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 50).map((p) => {
              const s = stockStatus(p.stock);
              const dot = s === "in" ? "text-success" : s === "low" ? "text-warning" : "text-error";
              return (
                <tr key={p.id} className="border-b border-light-gray/50">
                  <td className="py-2.5 pr-2">
                    <div className="flex items-center gap-2">
                      <img src={p.image} alt="" className="h-7 w-7 rounded-sm object-cover" />
                      <span className="font-medium text-brand-primary">{p.name}</span>
                    </div>
                  </td>
                  <td>
                    <input
                      type="number"
                      value={p.stock}
                      onChange={(e) => setStock(p.id, Number(e.target.value))}
                      className="w-16 rounded-sm border border-light-gray px-2 py-1"
                    />
                  </td>
                  <td className="text-gray-400">{p.maxStock}</td>
                  <td className={`whitespace-nowrap font-semibold ${dot}`}>● {s.toUpperCase()}</td>
                  <td>
                    <button onClick={() => setStock(p.id, p.maxStock)} className="rounded-sm bg-brand-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary">Restock</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[10px] text-gray-400">Edits update the draft. Click <strong>Save Changes</strong> at the top to publish.</p>

      <ConfirmModal
        open={!!confirmBulk}
        title="Apply bulk update?"
        message={confirmBulk?.label}
        confirmLabel="Apply"
        onConfirm={runBulk}
        onCancel={() => setConfirmBulk(null)}
      />
    </div>
  );
}

/* ============================================================= */
/* CATALOG MANAGER — tags + add/remove products                  */
/* ============================================================= */
function CatalogManager({ draftApi }: { draftApi: DraftApi }) {
  const { draft, addProduct, removeProduct, editProduct, addCategory, editCategory, addDesigner, editDesigner, removeCategory, removeDesigner } = draftApi;
  const { allCategories, allDesigners } = useStore();

  const [catFilter, setCatFilter] = useState("mens-fashion");
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmDeleteType, setConfirmDeleteType] = useState<"product" | "category" | "designer" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<{ slug: string; name: string; image: string } | null>(null);
  const [editingDesigner, setEditingDesigner] = useState<{ id: string; name: string; specialty: string; location: string; image: string } | null>(null);

  // Merge base + custom + overrides
  const merged: Product[] = [...PRODUCTS, ...draft.customProducts].map((p) => {
    const ov = draft.productOverrides[p.id];
    const tagOv = draft.tagOverrides[p.id];
    let next = p;
    if (ov) next = { ...next, ...ov };
    if (tagOv) next = { ...next, tags: tagOv };
    return next;
  });

  const list = merged.filter(
    (p) => p.categorySlug === catFilter && p.name.toLowerCase().includes(search.toLowerCase())
  );

  /* ---- Add product form ---- */
  const [form, setForm] = useState({
    name: "", category: "mens-fashion", price: "", designerId: "", overview: "",
    d1: "", d2: "", d3: "", d4: "", tags: "",
  });
  const [confirmAdd, setConfirmAdd] = useState(false);
  const canAdd = form.name.trim() && Number(form.price) > 0 && form.overview.trim();

  const doAddProduct = () => {
    const cat = allCategories.find((c) => c.slug === form.category)!;
    const overview = form.overview.trim();
    const gallery = [form.d1, form.d2, form.d3, form.d4].map((s) => s.trim()).filter(Boolean);
    while (gallery.length < 3) gallery.push(overview);
    const id = `custom-${Date.now()}`;
    const p: Product = {
      id, name: form.name.trim(), price: Number(form.price),
      category: cat.name, categorySlug: cat.slug,
      stock: 50, maxStock: 100, rating: 5, reviews: 0,
      image: overview, main_image: overview, gallery_images: gallery.slice(0, 3),
      description: "Added via Admin. Quality you can trust from No Maneno Bazaar — IKO KITU!",
      tags: form.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
      designerId: form.designerId || undefined,
      custom: true,
    };
    addProduct(p);
    setConfirmAdd(false);
    setForm({ ...form, name: "", price: "", overview: "", d1: "", d2: "", d3: "", d4: "", tags: "" });
  };

  /* ---- Add category / designer ---- */
  const [newCat, setNewCat] = useState({ name: "", image: "" });
  const [newDesigner, setNewDesigner] = useState({
    id: "", name: "", specialty: "", location: "Mombasa", image: "",
    useCustomSpotlight: false, spotlightTitle: "", spotlightText: "",
  });
  const [addCatOpen, setAddCatOpen] = useState(false);
  const [addDesignerOpen, setAddDesignerOpen] = useState(false);

  const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const newCatValid = !!newCat.name.trim();
  const submitNewCat = () => {
    if (!newCatValid) return;
    const slug = "custom-" + slugify(newCat.name);
    addCategory({
      name: newCat.name.trim(),
      slug,
      image: newCat.image.trim() || "https://images.pexels.com/photos/5556176/pexels-photo-5556176.jpeg?auto=compress&cs=tinysrgb&w=600",
    });
    setNewCat({ name: "", image: "" });
    setAddCatOpen(false);
    setForm((f) => ({ ...f, category: slug }));
  };

  const newDesignerValid =
    !!newDesigner.id.trim() &&
    !!newDesigner.name.trim() &&
    !!newDesigner.specialty.trim() &&
    (!newDesigner.useCustomSpotlight || (!!newDesigner.spotlightTitle.trim() && !!newDesigner.spotlightText.trim()));
  const submitNewDesigner = () => {
    if (!newDesignerValid) return;
    const id = slugify(newDesigner.id);
    const spotlightTitle = newDesigner.useCustomSpotlight
      ? newDesigner.spotlightTitle.trim()
      : `${newDesigner.name.trim()}: Featured Designer`;
    const spotlightText = newDesigner.useCustomSpotlight
      ? newDesigner.spotlightText.trim()
      : `${newDesigner.name.trim()} brings their signature ${newDesigner.specialty.trim().toLowerCase()} to the No Maneno Bazaar showroom.`;
    addDesigner({
      id,
      name: newDesigner.name.trim(),
      specialty: newDesigner.specialty.trim(),
      location: newDesigner.location.trim() || "Mombasa",
      image: newDesigner.image.trim() || "https://images.pexels.com/photos/20453359/pexels-photo-20453359.jpeg?auto=compress&cs=tinysrgb&w=900",
      spotlightTitle,
      spotlightText,
    });
    setNewDesigner({ id: "", name: "", specialty: "", location: "Mombasa", image: "", useCustomSpotlight: false, spotlightTitle: "", spotlightText: "" });
    setAddDesignerOpen(false);
    setForm((f) => ({ ...f, designerId: id }));
  };

  /* ---- Editor navigation ---- */
  const editingProduct = editingId ? merged.find((p) => p.id === editingId) ?? null : null;
  const editingIndex = editingProduct ? list.findIndex((p) => p.id === editingProduct.id) : -1;
  const goPrev = () => { if (editingIndex > 0) setEditingId(list[editingIndex - 1].id); };
  const goNext = () => { if (editingIndex < list.length - 1) setEditingId(list[editingIndex + 1].id); };

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      {/* Add product form */}
      <div className="h-fit rounded-lg bg-white p-6 shadow-sm">
        <h3 className="mb-5 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Add New Product</h3>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Category</label>
              <select value={form.category} onChange={(e) => { if (e.target.value === "__new__") { setAddCatOpen(true); } else { setForm({ ...form, category: e.target.value }); } }} className="w-full rounded-sm border border-light-gray bg-off-white px-2 py-2 text-xs outline-none">
                {allCategories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                <option value="__new__">+ Add new category…</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Price (KES)</label>
              <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Designer</label>
            <select value={form.designerId} onChange={(e) => { if (e.target.value === "__new__") { setAddDesignerOpen(true); } else { setForm({ ...form, designerId: e.target.value }); } }} className="w-full rounded-sm border border-light-gray bg-off-white px-2 py-2 text-xs outline-none">
              <option value="">— None —</option>
              {allDesigners.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              <option value="__new__">+ Add new designer…</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Overview Picture URL</label>
            <input value={form.overview} onChange={(e) => setForm({ ...form, overview: e.target.value })} placeholder="https://..." className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(["d1","d2","d3","d4"] as const).map((k, i) => (
              <div key={k}>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Detail Pic {i + 1}</label>
                <input value={(form as any)[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} placeholder="https://..." className="w-full rounded-sm border border-light-gray bg-off-white px-2 py-2 text-xs outline-none" />
              </div>
            ))}
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Tags (comma separated)</label>
            <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="shirt, cotton, casual" className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none" />
          </div>
          {form.overview && <img src={form.overview} alt="preview" className="h-24 w-24 rounded-sm object-cover" />}
          <button onClick={() => setConfirmAdd(true)} disabled={!canAdd} className="w-full rounded-sm bg-brand-primary py-3 text-xs font-bold uppercase tracking-widest text-white hover:bg-brand-secondary hover:text-brand-primary disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400">Add Product</button>
          <p className="text-center text-[10px] text-gray-400">Click <strong>Save Changes</strong> at the top to publish.</p>
        </div>
      </div>

      {/* Product list — click to edit */}
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Edit Products — Click any product to open the editor</h3>
        <div className="mb-4 flex flex-wrap gap-2">
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="rounded-sm border border-light-gray px-3 py-2 text-xs">
            {allCategories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products…" className="flex-1 rounded-sm border border-light-gray bg-off-white px-3 py-2 text-xs outline-none" />
        </div>

        <div className="grid max-h-[640px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((p) => (
            <div key={p.id} className="group flex flex-col overflow-hidden rounded-md border border-light-gray bg-white text-left transition-all hover:border-brand-secondary hover:shadow-md">
              <button onClick={() => setEditingId(p.id)} className="flex-1 text-left">
                <div className="aspect-square overflow-hidden bg-warm-beige">
                  <img src={p.image} alt="" className="h-full w-full object-cover" />
                </div>
                <div className="p-2">
                  <p className="truncate text-xs font-medium text-brand-primary">{p.name}</p>
                  <p className="text-[10px] text-gray-400">{formatKES(p.price)}</p>
                  {p.custom && <span className="mt-0.5 inline-block rounded-sm bg-brand-secondary/20 px-1.5 text-[9px] font-bold uppercase text-brand-accent">New</span>}
                </div>
              </button>
              <button
                onClick={() => {
                  setConfirmDeleteType("product");
                  setDeleteTarget({ id: p.id, label: p.name });
                }}
                className="border-t border-light-gray px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-error hover:bg-error hover:text-white"
              >
                Delete
              </button>
            </div>
          ))}
          {list.length === 0 && <p className="col-span-full py-10 text-center text-xs text-gray-400">No products match.</p>}
        </div>

        {/* Manage custom categories & designers */}
        {(allCategories.length > 0 || allDesigners.length > 0) && (
          <div className="mt-6 border-t border-light-gray pt-4">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-brand-accent">Manage Catalog Items</p>
            <div className="mb-3">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Categories</p>
              <div className="flex flex-wrap gap-2">
                {allCategories.map((c) => (
                  <span key={c.slug} className="flex items-center gap-1.5 rounded-full border border-light-gray bg-off-white px-3 py-1 text-[11px]">
                    {c.name}
                    <button onClick={() => setEditingCategory({ slug: c.slug, name: c.name, image: c.image })} className="text-gray-400 hover:text-brand-primary" title="Edit category">✎</button>
                    <button onClick={() => {
                      setConfirmDeleteType("category");
                      setDeleteTarget({ id: c.slug, label: c.name });
                    }} className="text-gray-400 hover:text-error" title="Delete category">×</button>
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Designers</p>
              <div className="flex flex-wrap gap-2">
                {allDesigners.map((d) => (
                  <span key={d.id} className="flex items-center gap-1.5 rounded-full border border-light-gray bg-off-white px-3 py-1 text-[11px]">
                    {d.name}
                    <button onClick={() => setEditingDesigner({ id: d.id, name: d.name, specialty: d.specialty ?? "", location: d.location ?? "Mombasa", image: d.image ?? "" })} className="text-gray-400 hover:text-brand-primary" title="Edit designer">✎</button>
                    <button onClick={() => {
                      setConfirmDeleteType("designer");
                      setDeleteTarget({ id: d.id, label: d.name });
                    }} className="text-gray-400 hover:text-error" title="Delete designer">×</button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <ConfirmModal
        open={confirmAdd}
        title="Add this product?"
        message={`"${form.name}" will be added to ${allCategories.find((c) => c.slug === form.category)?.name}. Remember to Save Changes.`}
        confirmLabel="Add Product"
        onConfirm={doAddProduct}
        onCancel={() => setConfirmAdd(false)}
      />
      <ConfirmModal
        open={!!confirmDelete}
        title="Remove this product?"
        message="This removes the custom product from the draft."
        confirmLabel="Remove"
        tone="danger"
        onConfirm={() => { if (confirmDelete) removeProduct(confirmDelete); setConfirmDelete(null); }}
        onCancel={() => setConfirmDelete(null)}
      />
      <ConfirmModal
        open={!!confirmDeleteType && !!deleteTarget}
        title={confirmDeleteType === "product" ? "Delete this product?" : confirmDeleteType === "category" ? "Delete this category?" : "Delete this designer?"}
        message={confirmDeleteType === "product"
          ? `"${deleteTarget?.label}" will be hidden from the catalog after you save.`
          : confirmDeleteType === "category"
          ? `"${deleteTarget?.label}" will be removed from the catalog after you save.`
          : `"${deleteTarget?.label}" will be hidden from the showroom and catalog after you save.`}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {
          if (!deleteTarget) return;
          if (confirmDeleteType === "product") removeProduct(deleteTarget.id);
          if (confirmDeleteType === "category") removeCategory(deleteTarget.id);
          if (confirmDeleteType === "designer") removeDesigner(deleteTarget.id);
          setConfirmDeleteType(null);
          setDeleteTarget(null);
        }}
        onCancel={() => {
          setConfirmDeleteType(null);
          setDeleteTarget(null);
        }}
      />

      {/* Add category modal */}
      <ConfirmModal
        open={addCatOpen}
        title="Create New Category"
        confirmLabel="Create Category"
        confirmDisabled={!newCatValid}
        onConfirm={submitNewCat}
        onCancel={() => { setAddCatOpen(false); setNewCat({ name: "", image: "" }); }}
      />

      <ConfirmModal
        open={!!editingCategory}
        title="Edit Category"
        confirmLabel="Save Category"
        onConfirm={() => {
          if (!editingCategory) return;
          editCategory(editingCategory.slug, { name: editingCategory.name.trim(), image: editingCategory.image.trim() });
          setEditingCategory(null);
        }}
        onCancel={() => setEditingCategory(null)}
      >
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Category Name</label>
            <input
              value={editingCategory?.name ?? ""}
              onChange={(e) => setEditingCategory((s) => s ? { ...s, name: e.target.value } : s)}
              className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Header Image URL</label>
            <input
              value={editingCategory?.image ?? ""}
              onChange={(e) => setEditingCategory((s) => s ? { ...s, image: e.target.value } : s)}
              className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none"
            />
          </div>
        </div>
      </ConfirmModal>

      <ConfirmModal
        open={!!editingDesigner}
        title="Edit Designer"
        confirmLabel="Save Designer"
        size="lg"
        onConfirm={() => {
          if (!editingDesigner) return;
          editDesigner(editingDesigner.id, {
            name: editingDesigner.name.trim(),
            specialty: editingDesigner.specialty.trim(),
            location: editingDesigner.location.trim() || "Mombasa",
            image: editingDesigner.image.trim(),
          });
          setEditingDesigner(null);
        }}
        onCancel={() => setEditingDesigner(null)}
      >
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Full Name</label>
              <input
                value={editingDesigner?.name ?? ""}
                onChange={(e) => setEditingDesigner((s) => s ? { ...s, name: e.target.value } : s)}
                className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Specialty</label>
              <input
                value={editingDesigner?.specialty ?? ""}
                onChange={(e) => setEditingDesigner((s) => s ? { ...s, specialty: e.target.value } : s)}
                className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Location</label>
              <input
                value={editingDesigner?.location ?? ""}
                onChange={(e) => setEditingDesigner((s) => s ? { ...s, location: e.target.value } : s)}
                className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Profile Image URL</label>
              <input
                value={editingDesigner?.image ?? ""}
                onChange={(e) => setEditingDesigner((s) => s ? { ...s, image: e.target.value } : s)}
                className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none"
              />
            </div>
          </div>
        </div>
      </ConfirmModal>

      <ConfirmModal
        open={addCatOpen}
        title="Create New Category"
        confirmLabel="Create Category"
        confirmDisabled={!newCatValid}
        onConfirm={submitNewCat}
        onCancel={() => { setAddCatOpen(false); setNewCat({ name: "", image: "" }); }}
      >
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Category Name</label>
            <input
              value={newCat.name}
              onChange={(e) => setNewCat((s) => ({ ...s, name: e.target.value }))}
              placeholder="e.g. Traditional Wear"
              className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Header Image URL</label>
            <input
              value={newCat.image}
              onChange={(e) => setNewCat((s) => ({ ...s, image: e.target.value }))}
              placeholder="https://..."
              className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none"
            />
            {newCat.image && (
              <img src={newCat.image} alt="" className="mt-2 h-20 w-20 rounded-sm object-cover" />
            )}
          </div>
        </div>
      </ConfirmModal>

      {/* Add designer modal */}
      <ConfirmModal
        open={addDesignerOpen}
        title="Create New Designer"
        confirmLabel="Create Designer"
        size="lg"
        confirmDisabled={!newDesignerValid}
        onConfirm={submitNewDesigner}
        onCancel={() => {
          setAddDesignerOpen(false);
          setNewDesigner({ id: "", name: "", specialty: "", location: "Mombasa", image: "", useCustomSpotlight: false, spotlightTitle: "", spotlightText: "" });
        }}
      >
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Designer ID (one word)</label>
              <input
                value={newDesigner.id}
                onChange={(e) => setNewDesigner((s) => ({ ...s, id: e.target.value }))}
                placeholder="e.g. amina"
                className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Full Name</label>
              <input
                value={newDesigner.name}
                onChange={(e) => setNewDesigner((s) => ({ ...s, name: e.target.value }))}
                placeholder="e.g. Amina Mohamed"
                className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Specialty</label>
              <input
                value={newDesigner.specialty}
                onChange={(e) => setNewDesigner((s) => ({ ...s, specialty: e.target.value }))}
                placeholder="e.g. Silk Scarves"
                className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Location (optional)</label>
              <input
                value={newDesigner.location}
                onChange={(e) => setNewDesigner((s) => ({ ...s, location: e.target.value }))}
                placeholder="e.g. Mombasa"
                className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Profile Image URL (optional)</label>
            <input
              value={newDesigner.image}
              onChange={(e) => setNewDesigner((s) => ({ ...s, image: e.target.value }))}
              placeholder="https://..."
              className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none"
            />
            {newDesigner.image && (
              <img src={newDesigner.image} alt="" className="mt-2 h-20 w-20 rounded-sm object-cover" />
            )}
          </div>

          <div className="rounded-md border border-light-gray/80 bg-off-white p-3">
            <label className="flex items-center gap-2 text-[11px] font-semibold text-brand-primary">
              <input
                type="checkbox"
                checked={newDesigner.useCustomSpotlight}
                onChange={(e) => setNewDesigner((s) => ({ ...s, useCustomSpotlight: e.target.checked }))}
                className="h-4 w-4 accent-brand-secondary"
              />
              Use custom spotlight text
            </label>
            <p className="mt-2 text-[11px] text-gray-500">Add a custom heading and a short two-line paragraph for the showroom spotlight card.</p>
            {newDesigner.useCustomSpotlight && (
              <div className="mt-3 space-y-2">
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Spotlight Heading</label>
                  <input
                    value={newDesigner.spotlightTitle}
                    onChange={(e) => setNewDesigner((s) => ({ ...s, spotlightTitle: e.target.value }))}
                    placeholder="e.g. Amina's Signature Edit"
                    className="w-full rounded-sm border border-light-gray bg-white px-3 py-2 text-sm outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Spotlight Paragraph</label>
                  <textarea
                    rows={3}
                    value={newDesigner.spotlightText}
                    onChange={(e) => setNewDesigner((s) => ({ ...s, spotlightText: e.target.value }))}
                    placeholder="Write a short 2-line spotlight paragraph for this designer."
                    className="w-full rounded-sm border border-light-gray bg-white px-3 py-2 text-sm outline-none"
                  />
                </div>
              </div>
            )}
          </div>

        </div>
      </ConfirmModal>

      {/* Full-screen product editor */}
      {editingProduct && (
        <ProductEditor
          product={editingProduct}
          allProducts={list}
          index={editingIndex}
          allCategories={allCategories}
          allDesigners={allDesigners}
          onPrev={goPrev}
          onNext={goNext}
          onClose={() => setEditingId(null)}
          onSave={(patch) => { editProduct(editingProduct.id, patch); }}
          onAddCategory={() => setAddCatOpen(true)}
          onAddDesigner={() => setAddDesignerOpen(true)}
          onRemove={() => {
            setConfirmDeleteType("product");
            setDeleteTarget({ id: editingProduct.id, label: editingProduct.name });
            setEditingId(null);
          }}
        />
      )}
    </div>
  );
}

/* ============================================================= */
/* PRODUCT EDITOR MODAL                                          */
/* ============================================================= */
function ProductEditor({
  product, allProducts, index, allCategories, allDesigners,
  onPrev, onNext, onClose, onSave, onAddCategory, onAddDesigner, onRemove,
}: {
  product: Product;
  allProducts: Product[];
  index: number;
  allCategories: { name: string; slug: string; image: string }[];
  allDesigners: { id: string; name: string }[];
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onSave: (patch: Partial<Product>) => void;
  onAddCategory: () => void;
  onAddDesigner: () => void;
  onRemove?: () => void;
}) {
  // Re-init form when the product changes (next/prev arrows)
  const [form, setForm] = useState({
    name: product.name,
    price: String(product.price),
    categorySlug: product.categorySlug,
    designerId: product.designerId ?? "",
    image: product.image,
    g0: product.gallery_images?.[0] ?? product.image,
    g1: product.gallery_images?.[1] ?? product.image,
    g2: product.gallery_images?.[2] ?? product.image,
    g3: product.gallery_images?.[3] ?? product.image,
    tags: (product.tags ?? []).join(", "),
    description: product.description,
  });
  const [preview, setPreview] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm({
      name: product.name,
      price: String(product.price),
      categorySlug: product.categorySlug,
      designerId: product.designerId ?? "",
      image: product.image,
      g0: product.gallery_images?.[0] ?? product.image,
      g1: product.gallery_images?.[1] ?? product.image,
      g2: product.gallery_images?.[2] ?? product.image,
      g3: product.gallery_images?.[3] ?? product.image,
      tags: (product.tags ?? []).join(", "),
      description: product.description,
    });
    setPreview(false);
    setSaved(false);
  }, [product.id]);

  // Active angle in preview
  const [activeAngle, setActiveAngle] = useState<0 | 1 | 2 | 3 | 4>(0);
  const allImgs = [form.image, form.g0, form.g1, form.g2, form.g3];

  const apply = () => {
    const cat = allCategories.find((c) => c.slug === form.categorySlug);
    onSave({
      name: form.name.trim(),
      price: Number(form.price),
      categorySlug: form.categorySlug,
      category: cat?.name ?? product.category,
      designerId: form.designerId || undefined,
      image: form.image,
      main_image: form.image,
      gallery_images: [form.g0, form.g1, form.g2, form.g3],
      tags: form.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
      description: form.description,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="fixed inset-0 z-120 flex items-center justify-center p-2 sm:p-6">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative flex h-full max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-light-gray px-4 py-3">
          <div className="flex items-center gap-2">
            <button onClick={onPrev} disabled={index <= 0} className="flex h-8 w-8 items-center justify-center rounded-full border border-light-gray text-charcoal disabled:opacity-30">←</button>
            <button onClick={onNext} disabled={index >= allProducts.length - 1} className="flex h-8 w-8 items-center justify-center rounded-full border border-light-gray text-charcoal disabled:opacity-30">→</button>
            <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">{index + 1} of {allProducts.length} in {product.category}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPreview((p) => !p)} className={`rounded-sm border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${preview ? "border-brand-secondary bg-brand-secondary text-brand-primary" : "border-light-gray text-charcoal hover:border-brand-secondary"}`}>{preview ? "Editing View" : "Preview"}</button>
            <button onClick={apply} className="rounded-sm bg-brand-primary px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary">{saved ? "✓ Applied" : "Apply"}</button>
            {onRemove && <button onClick={onRemove} className="rounded-sm border border-error/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-error hover:bg-error hover:text-white">Remove</button>}
            <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-warm-beige">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {preview ? (
            /* PREVIEW MODE — mimics product detail */
            <div className="grid gap-8 p-6 lg:grid-cols-2">
              <div>
                <div className="aspect-square overflow-hidden rounded-lg bg-warm-beige">
                  <img src={allImgs[activeAngle]} alt={form.name} className="h-full w-full object-cover" />
                </div>
                <div className="mt-3 grid grid-cols-5 gap-2">
                  {allImgs.map((img, i) => (
                    <button key={i} onClick={() => setActiveAngle(i as 0|1|2|3|4)} className={`aspect-square overflow-hidden rounded-md border-2 ${i === activeAngle ? "border-brand-primary" : "border-transparent"}`}>
                      <img src={img} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-brand-accent">{allCategories.find((c) => c.slug === form.categorySlug)?.name}</p>
                <h1 className="mt-1.5 font-display text-2xl text-brand-primary sm:text-3xl">{form.name}</h1>
                <p className="mt-3 font-display text-3xl text-brand-primary">{formatKES(Number(form.price))}</p>
                {form.designerId && <p className="mt-2 text-xs text-brand-accent">By {allDesigners.find((d) => d.id === form.designerId)?.name}</p>}
                <p className="mt-4 text-sm leading-relaxed text-charcoal">{form.description}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {form.tags.split(",").map((t) => t.trim()).filter(Boolean).map((t) => (
                    <span key={t} className="rounded-full bg-warm-beige px-2.5 py-0.5 text-[10px] text-charcoal">{t}</span>
                  ))}
                </div>
                <p className="mt-6 text-[10px] uppercase tracking-wider text-gray-400">↑ This is how the product will look. Click <strong>Apply</strong> to save edits to the draft.</p>
              </div>
            </div>
          ) : (
            /* EDIT MODE */
            <div className="grid gap-6 p-6 lg:grid-cols-2">
              <div>
                <h4 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-brand-primary">Images</h4>
                <div className="space-y-3">
                  <Field label="Overview image (main)">
                    <input value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-xs outline-none" />
                  </Field>
                  {form.image && <img src={form.image} alt="" className="h-24 w-24 rounded-sm object-cover" />}
                  <Field label="Detail pic 1"><input value={form.g0} onChange={(e) => setForm({ ...form, g0: e.target.value })} className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-xs outline-none" /></Field>
                  <Field label="Detail pic 2"><input value={form.g1} onChange={(e) => setForm({ ...form, g1: e.target.value })} className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-xs outline-none" /></Field>
                  <Field label="Detail pic 3"><input value={form.g2} onChange={(e) => setForm({ ...form, g2: e.target.value })} className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-xs outline-none" /></Field>
                  <Field label="Detail pic 4"><input value={form.g3} onChange={(e) => setForm({ ...form, g3: e.target.value })} className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-xs outline-none" /></Field>
                  <div className="grid grid-cols-4 gap-2">
                    {[form.g0, form.g1, form.g2, form.g3].map((g, i) => g && <img key={i} src={g} alt="" className="aspect-square w-full rounded-sm object-cover" />)}
                  </div>
                </div>
              </div>
              <div>
                <h4 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-brand-primary">Details</h4>
                <div className="space-y-3">
                  <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none" /></Field>
                  <Field label="Price (KES)"><input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none" /></Field>
                  <Field label="Category">
                    <div className="flex gap-2">
                      <select value={form.categorySlug} onChange={(e) => setForm({ ...form, categorySlug: e.target.value })} className="flex-1 rounded-sm border border-light-gray bg-off-white px-2 py-2 text-xs outline-none">
                        {allCategories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                      </select>
                      <button onClick={onAddCategory} className="rounded-sm border border-brand-primary px-3 py-2 text-[10px] font-bold uppercase text-brand-primary hover:bg-brand-primary hover:text-white">+ New</button>
                    </div>
                  </Field>
                  <Field label="Designer">
                    <div className="flex gap-2">
                      <select value={form.designerId} onChange={(e) => setForm({ ...form, designerId: e.target.value })} className="flex-1 rounded-sm border border-light-gray bg-off-white px-2 py-2 text-xs outline-none">
                        <option value="">— None —</option>
                        {allDesigners.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                      <button onClick={onAddDesigner} className="rounded-sm border border-brand-primary px-3 py-2 text-[10px] font-bold uppercase text-brand-primary hover:bg-brand-primary hover:text-white">+ New</button>
                    </div>
                  </Field>
                  <Field label="Tags (comma separated)">
                    <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="shirt, cotton, summer" className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none" />
                  </Field>
                  <Field label="Description">
                    <textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none" />
                  </Field>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</label>
      {children}
    </div>
  );
}

/* ============================================================= */
/* CUSTOMIZE PANEL — fonts + color presets + custom color         */
/* (Backed by the global CustomizeContext so changes apply        */
/*  everywhere, not just inside the admin route.)                 */
/* ============================================================= */
function CustomizePanel() {
  const {
    fontId, colorId, colors, customColors,
    setFont, setColorPreset, setCustomColor, resetAll,
  } = useCustomize();

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Fonts */}
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <h3 className="mb-5 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Typography</h3>
        <div className="space-y-2">
          {FONT_OPTIONS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFont(f.id)}
              className={`flex w-full items-center justify-between rounded-sm border p-3 text-left transition-all ${
                fontId === f.id ? "border-brand-secondary bg-brand-secondary/10" : "border-light-gray hover:border-brand-accent"
              }`}
            >
              <div>
                <p className="text-sm font-semibold text-brand-primary" style={{ fontFamily: `"${f.display}", serif` }}>{f.label}</p>
                <p className="mt-0.5 text-[11px] text-gray-400" style={{ fontFamily: `"${f.body}", sans-serif` }}>
                  The quick brown fox jumps over the lazy dog.
                </p>
              </div>
              {fontId === f.id && <span className="text-brand-secondary">✓</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Colors */}
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <h3 className="mb-5 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Color Theme</h3>

        <div className="space-y-2">
          {COLOR_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setColorPreset(p.id)}
              className={`flex w-full items-center gap-3 rounded-sm border p-3 text-left transition-all ${
                colorId === p.id ? "border-brand-secondary bg-brand-secondary/10" : "border-light-gray hover:border-brand-accent"
              }`}
            >
              <div className="flex flex-wrap gap-1">
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.primary }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.secondary }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.accent }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.warmBeige }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.oceanBlue }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.oceanBlueDark }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.coral }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.success }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.warning }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.error }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.charcoal }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.offWhite }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.lightGray }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.lightPink }} />
              </div>
              <span className="text-xs font-medium text-brand-primary">{p.name}</span>
              {colorId === p.id && <span className="ml-auto text-brand-secondary">✓</span>}
            </button>
          ))}

          {/* Custom */}
          <button
            onClick={() => setColorPreset("custom")}
            className={`flex w-full items-center gap-3 rounded-sm border p-3 text-left transition-all ${
              colorId === "custom" ? "border-brand-secondary bg-brand-secondary/10" : "border-light-gray hover:border-brand-accent"
            }`}
          >
            <div className="flex flex-wrap gap-1">
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.primary }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.secondary }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.accent }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.warmBeige }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.oceanBlue }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.oceanBlueDark }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.coral }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.success }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.warning }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.error }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.charcoal }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.offWhite }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.lightGray }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.lightPink }} />
            </div>
            <span className="text-xs font-medium text-brand-primary">Custom Colors</span>
            {colorId === "custom" && <span className="ml-auto text-brand-secondary">✓</span>}
          </button>
        </div>

        {colorId === "custom" && (
          <div className="mt-4 rounded-md border border-light-gray bg-off-white p-4">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-brand-accent">Edit Custom Colors</p>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-7">
              {(["primary", "secondary", "accent", "warmBeige", "oceanBlue", "oceanBlueDark", "coral", "success", "warning", "error", "charcoal", "offWhite", "lightGray", "lightPink"] as const).map((key) => (
                <div key={key} className="text-center">
                  <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-gray-400">{key}</label>
                  <input
                    type="color"
                    value={colors[key]}
                    onChange={(e) => setCustomColor(key, e.target.value)}
                    className="mx-auto block h-10 w-10 cursor-pointer rounded-sm border-0 bg-transparent"
                  />
                  <span className="mt-0.5 block text-[9px] text-gray-400">{colors[key]}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Color legend */}
      <div className="lg:col-span-2 rounded-lg bg-white p-5 shadow-sm">
        <h4 className="mb-3 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Color Slot Key</h4>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {COLOR_SLOT_LEGEND.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              <span className="h-5 w-5 shrink-0 rounded-sm border" style={{ background: colors[s.key as keyof typeof colors] }} />
              <div>
                <p className="text-[10px] font-bold text-brand-primary">{i + 1}. {s.key}</p>
                <p className="text-[9px] text-gray-400">{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Reset */}
      <div className="lg:col-span-2">
        <button
          onClick={resetAll}
          className="rounded-sm border border-brand-primary px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-brand-primary transition-colors hover:bg-brand-primary hover:text-white"
        >
          Reset to Defaults
        </button>
        <p className="mt-2 text-[10px] text-gray-400">Restores the original Marcellus + Jost fonts and Classic Gold color theme.</p>
      </div>
    </div>
  );
}

/* ============================================================= */
/* PROMOTIONS MANAGER                                            */
/* ============================================================= */
type Subscription = { id: string; email: string; isActive: boolean; createdAt: string };
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
      setSubscriptions((data.subscriptions ?? []) as Subscription[]);
    } catch (err: any) {
      const message = err?.response?.data?.error || err?.message || "Could not load subscriptions";
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
    } catch (error: any) {
      showToast(error?.response?.data?.error || "Could not send promotional email");
    } finally {
      setSending(false);
    }
  };

  const deleteSubscription = async (id: string) => {
    try {
      await adminAPI.subscriptions.delete(id);
      showToast("Subscription deleted");
      loadSubscriptions();
    } catch (error: any) {
      showToast(error?.response?.data?.error || "Could not delete subscription");
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



