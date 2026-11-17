import { useEffect, useId, useMemo, useState } from "react";
import { adminAPI, type SalesReport } from "../../api/admin";
import { navigate, useRoute } from "../../router";
import { useStorefront } from "../../store/StorefrontContext";
import { activeVariants } from "../../store/catalogModel";
import { formatKES } from "../../utils/format";
import { useAdminCatalog } from "./AdminCatalogContext";
import { parsePeriodParam, periodRoute, type ReportPeriod } from "./adminRoutes";
import { FIGURES, parseSalesReport, salesExportName, salesExportTitle, type FigureKey } from "./overviewModel";
import { FigureCard, PeriodChoice, RangeLine, usePeriodReport } from "./PeriodControls";
import { downloadCsv, downloadExcel, downloadPdf } from "./reportExports";

const REPORT_PREVIEW_LIMIT = 12;
const DOWNLOAD_FORMATS = { csv: { label: "CSV", extension: "csv" }, excel: { label: "Excel", extension: "xlsx" }, pdf: { label: "PDF", extension: "pdf" } } as const;
type DownloadFormat = keyof typeof DOWNLOAD_FORMATS;
const isDownloadFormat = (value: string): value is DownloadFormat => Object.keys(DOWNLOAD_FORMATS).includes(value);

const loadSales = async (period: ReportPeriod) => parseSalesReport((await adminAPI.analytics.getSales(period)).data);

/** The dashboard's figures, read from the report under the same names and definitions. */
function reportValue(key: FigureKey, report: SalesReport) {
  switch (key) {
    case "netSales": return formatKES(report.totalRevenue);
    case "paidOrders": return String(report.paidOrders);
    case "ordersPlaced": return String(report.totalOrders);
    case "cancelledOrders": return String(report.cancelledOrders);
    default: return formatKES(report.refundedValue);
  }
}

/**
 * The sales report for a period in Nairobi time (the address's `period`, this month by default), with the dashboard's
 * figures and range line, its orders, and downloads named with the store and the dates.
 */
export function AnalyticsPanel() {
  const { brandName } = useStorefront();
  const catalog = useAdminCatalog();
  const route = useRoute();
  const { period, invalid } = parsePeriodParam(route);
  // An unknown period reads as this month and is corrected in place; it is never sent.
  useEffect(() => {
    if (invalid) navigate(periodRoute("analytics", period), { replace: true });
  }, [invalid, period]);
  const report = usePeriodReport(period, loadSales, "The sales report could not be loaded.");
  const [downloadFormat, setDownloadFormat] = useState<DownloadFormat>("csv");
  const downloadId = useId();

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

  const salesData = report.data;
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
  const fileName = salesData ? salesExportName(brandName, salesData.range, DOWNLOAD_FORMATS[downloadFormat].extension) : "";

  const handleDownload = () => {
    if (!salesData) return;
    const title = salesExportTitle(salesData.range);
    if (downloadFormat === "csv") downloadCsv(fileName, rows);
    else if (downloadFormat === "excel") downloadExcel(fileName, rows, title);
    else downloadPdf(fileName, rows, title, brandName, salesData.generatedAt);
  };

  return (
    <div className="@container space-y-6">
      <div className="space-y-4 rounded-lg bg-surface p-4 shadow-card sm:p-5">
        <PeriodChoice module="analytics" current={period} />
        <RangeLine report={report} what="The sales report" />
      </div>

      <section aria-label="Figures for this period">
        <ul className="grid grid-cols-1 gap-3 @min-[18rem]:grid-cols-2 @min-[36rem]:grid-cols-3 @min-[56rem]:grid-cols-5">
          {FIGURES.map((figure) => (
            <li key={figure.key} className="min-w-0">
              <FigureCard label={figure.label} definition={figure.definition} value={salesData ? reportValue(figure.key, salesData) : null}
                to={null} phase={report.phase} />
            </li>
          ))}
        </ul>
        {salesData && (
          <p className="mt-3 text-sm text-muted [overflow-wrap:break-word]">
            Value of cancelled orders: {formatKES(salesData.cancelledValue)} · Refunded for returned items: {formatKES(salesData.returnedValue)}
          </p>
        )}
      </section>

      <section aria-labelledby={downloadId} className="rounded-lg bg-surface p-4 shadow-card sm:p-5">
        <h2 id={downloadId} className="type-h3 text-navy-900">Download</h2>
        <p className="mt-1 text-sm text-muted">The orders in this report, as a file named with the store and its Nairobi dates.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <select aria-label="Download format" value={downloadFormat} onChange={(event) => { if (isDownloadFormat(event.target.value)) setDownloadFormat(event.target.value); }}
            className="min-h-[44px] rounded-sm border border-control bg-surface px-3 text-sm">
            {Object.entries(DOWNLOAD_FORMATS).map(([value, format]) => <option key={value} value={value}>{format.label}</option>)}
          </select>
          <button type="button" disabled={!rows.length} onClick={handleDownload}
            className="min-h-[44px] rounded-sm bg-navy-900 px-[16px] text-sm font-semibold text-white transition-colors duration-(--motion-feedback) hover:bg-gold-500 hover:text-navy-900 disabled:cursor-not-allowed disabled:opacity-50">
            Download report
          </button>
        </div>
        {salesData && (
          <p className="mt-2 text-sm text-muted [overflow-wrap:anywhere]">
            {rows.length ? <>File: <span className="font-mono text-navy-900">{fileName}</span></> : "No orders in this period to download."}
          </p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg bg-white p-6 shadow-sm">
          <h2 className="mb-1 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Inventory value by department</h2>
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
          <h2 className="mb-4 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Report orders</h2>
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
