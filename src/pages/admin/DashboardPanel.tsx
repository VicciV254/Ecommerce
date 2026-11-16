import { useEffect, useState } from "react";
import { adminAPI, type DashboardMetrics } from "../../api/admin";
import { describeApiError } from "../../api/errors";
import { formatKES } from "../../utils/format";
import { useAdminCatalog } from "./AdminCatalogContext";

const RECENT_ORDER_LIMIT = 8;

function statusLabel(value: string) { return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()); }

export type LoadResult<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; message: string };

export function DashboardPanel({ activeDiscounts }: { activeDiscounts: number | undefined }) {
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
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-3">
        {cards.map(([label, value, color]) => (
          <div key={label} className="rounded-lg bg-white p-5 shadow-sm">
            <div className={`mb-2 h-1 w-8 rounded-full ${color}`} />
            <p className="text-xl font-semibold tabular-nums text-navy-900">{metrics.status === "loading" && label !== "Active Discounts" ? "…" : value}</p>
            <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-gray-600">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="rounded-lg bg-white p-6 shadow-sm">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Recent Live Orders</h3>
          <div className="mt-4 space-y-3">
            {(values?.recentOrders ?? []).slice(0, RECENT_ORDER_LIMIT).map((order) => (
              <div key={order.id} className="flex flex-wrap items-center justify-between gap-x-3 border-b border-light-gray pb-3 text-xs last:border-b-0">
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
            <p className="flex flex-wrap justify-between gap-x-3"><span>Low stock SKUs</span><strong className="text-warning">{show(lowStock)}</strong></p>
            <p className="flex flex-wrap justify-between gap-x-3"><span>Out-of-stock SKUs</span><strong className="text-error">{show(outStock)}</strong></p>
            <p className="flex flex-wrap justify-between gap-x-3"><span>Pending orders</span><strong>{show(values?.orders.pending)}</strong></p>
            <p className="flex flex-wrap justify-between gap-x-3"><span>Returns</span><strong>{show(values?.orders.returned)}</strong></p>
            <p className="text-[11px] text-gray-600">Stock counts exclude demo records.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
