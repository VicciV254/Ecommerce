import { useEffect, useMemo, useState } from "react";
import { adminAPI, type SalesReport } from "../../api/admin";
import { describeApiError } from "../../api/errors";
import { useStorefront } from "../../store/StorefrontContext";
import { activeVariants } from "../../store/catalogModel";
import { formatKES } from "../../utils/format";
import { useAdminCatalog } from "./AdminCatalogContext";
import type { LoadResult } from "./DashboardPanel";
import { downloadCsv, downloadExcel, downloadPdf } from "./reportExports";

const REPORT_PREVIEW_LIMIT = 12;

export function AnalyticsPanel() {
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
    const filename = `apex-cart-financial-${period}`;
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
            <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Financial report</h3>
            <p className="mt-1 text-xs text-gray-600">Order revenue, cancellations, returns and refunds recorded by the API.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select aria-label="Report period" value={period} onChange={(event) => setPeriod(event.target.value)} className="rounded-sm border border-light-gray px-3 py-2 text-xs">
              <option value="day">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
              <option value="year">This year</option>
            </select>
            <select aria-label="Download format" value={downloadFormat} onChange={(event) => setDownloadFormat(event.target.value === "excel" ? "excel" : event.target.value === "pdf" ? "pdf" : "csv")} className="rounded-sm border border-light-gray px-3 py-2 text-xs">
              <option value="csv">CSV</option>
              <option value="excel">Excel</option>
              <option value="pdf">PDF</option>
            </select>
            <button type="button" disabled={!rows.length} onClick={handleDownload} className="rounded-sm bg-brand-primary px-3 py-2 text-[10px] font-bold uppercase text-white hover:bg-brand-secondary hover:text-brand-primary disabled:opacity-50">
              Download report
            </button>
          </div>
        </div>
        {report.status === "error" && <p role="alert" className="mt-4 text-sm font-semibold text-error">{report.message}</p>}
        {report.status === "loading" && <p role="status" className="mt-4 text-sm text-gray-600">Loading report…</p>}
        {salesData && (
          <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-3">
            {summary.map(([label, value]) => (
              <div key={label} className="rounded-md bg-off-white p-4">
                <p className="text-lg font-semibold tabular-nums text-navy-900">{value}</p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-600">{label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg bg-white p-6 shadow-sm">
          <h3 className="mb-1 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Inventory value by department</h3>
          <p className="mb-5 text-[11px] text-gray-600">Active SKUs at current list price; demo records are excluded.</p>
          {catalog.data ? (
            <>
              <div className="space-y-3">
                {departments.map((department) => (
                  <div key={department.id}>
                    <div className="mb-1 flex flex-wrap justify-between gap-x-3 text-xs">
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
          <h3 className="mb-4 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Report orders</h3>
          <div className="max-h-80 overflow-y-auto text-xs">
            {rows.slice(0, REPORT_PREVIEW_LIMIT).map((row) => (
              <div key={row.orderNumber} className="flex flex-wrap justify-between gap-x-3 border-b border-light-gray py-2">
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
