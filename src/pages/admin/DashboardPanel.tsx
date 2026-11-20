import { useEffect, useId, type ReactNode } from "react";
import { adminAPI, type DashboardMetrics, type RecentOrder } from "../../api/admin";
import { Link, navigate, useRoute } from "../../router";
import { customerName, orderStatusLabel } from "../../store/orderCopy";
import { formatKES } from "../../utils/format";
import { nairobiDate } from "../../utils/nairobiDate";
import { useOptionalAdminCatalog } from "./AdminCatalogContext";
import { adminModuleRoute, ordersRoute, parsePeriodParam, periodRoute, type ReportPeriod } from "./adminRoutes";
import { FIGURES, needsActionRows, parseDashboard, type FigureKey } from "./overviewModel";
import { FigureCard, PeriodChoice, RangeLine, usePeriodReport, type ReportPhase } from "./PeriodControls";

const RECENT_ORDER_LIMIT = 8;
const PLACEHOLDER_ROWS = 3;

const loadDashboard = async (period: ReportPeriod) => parseDashboard((await adminAPI.analytics.getDashboard(period)).data);

const panelClass = "min-w-0 rounded-lg bg-surface p-4 shadow-card sm:p-5";
const headingClass = "type-h3 text-navy-900";
const rowLinkClass =
  "flex min-h-[44px] min-w-0 items-center gap-x-3 gap-y-1 rounded-sm px-[8px] py-[8px] text-sm text-navy-900 transition-colors duration-(--motion-feedback) hover:bg-surface-soft";

/** Where each figure's records are listed: orders by date range (and status), money in the sales report for the period. */
function figureRoute(key: FigureKey, period: ReportPeriod, data: DashboardMetrics) {
  const dates = { from: nairobiDate(data.range.start), to: nairobiDate(data.range.end) };
  if (key === "ordersPlaced") return ordersRoute("orders", { view: "all", filters: dates });
  if (key === "cancelledOrders") return ordersRoute("orders", { view: "all", filters: { ...dates, status: "CANCELLED" } });
  return periodRoute("analytics", period);
}

function figureValue(key: FigureKey, { figures }: DashboardMetrics) {
  if (key === "netSales") return formatKES(figures.netSales);
  if (key === "refunds") return formatKES(figures.refunds.amount);
  return String(figures[key]);
}

/** What the section shows when there is no answer to list: placeholders while loading, or "Unavailable". */
function Missing({ phase }: { phase: ReportPhase }) {
  if (phase === "failed") return <p className="mt-3 text-sm text-muted">Unavailable</p>;
  return (
    <ul aria-hidden="true" className="mt-3 space-y-2">
      {Array.from({ length: PLACEHOLDER_ROWS }, (_, index) => (
        <li key={index} className="h-[44px] animate-pulse rounded-sm bg-surface-soft motion-reduce:animate-none" />
      ))}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={panelClass}>
      <h2 id={headingId} className={headingClass}>{title}</h2>
      {children}
    </section>
  );
}

function RecentOrderRow({ order }: { order: RecentOrder }) {
  const customer = customerName(order.user);
  const status = orderStatusLabel(order);
  const total = formatKES(order.total);
  return (
    <li>
      <Link to={ordersRoute("orders", { view: "all", order: order.id })} aria-label={`Order ${order.orderNumber}, ${customer}, ${status}, ${total}`}
        className={`${rowLinkClass} flex-wrap justify-between`}>
        <span className="min-w-0 flex-[1_1_14rem] [overflow-wrap:break-word]">
          <span className="font-mono font-semibold [overflow-wrap:anywhere]">{order.orderNumber}</span>{" "}
          <span className="text-muted">{customer}</span>
        </span>
        <span className="flex min-w-0 flex-[1_1_10rem] flex-wrap items-baseline justify-between gap-x-3">
          <span>{status}</span>
          <span className="font-semibold tabular-nums">{total}</span>
        </span>
      </Link>
    </li>
  );
}

/**
 * The daily overview for a period in Nairobi time (the address's `period`, this month by default): defined figures that
 * reconcile with the sales report, the work that needs action now, and recent orders. Every figure, row and order links
 * to the records behind it.
 */
export function DashboardPanel({ activeDiscounts }: { activeDiscounts: number | undefined }) {
  const route = useRoute();
  const { period, invalid } = parsePeriodParam(route);
  // An unknown period reads as this month and is corrected in place; it is never sent.
  useEffect(() => {
    if (invalid) navigate(periodRoute("dashboard", period), { replace: true });
  }, [invalid, period]);
  const report = usePeriodReport(period, loadDashboard, "The figures could not be loaded.");
  const { data, phase } = report;
  const rows = data ? needsActionRows(data.current) : [];
  // Sample orders never count here; while the store takes them (a demonstration store), say so and where they are.
  const takesSampleOrders = useOptionalAdminCatalog()?.data?.snapshot.demonstrationOrders === true;

  return (
    <div className="@container space-y-6">
      <div className={`${panelClass} space-y-4`}>
        <PeriodChoice module="dashboard" current={period} />
        <RangeLine report={report} what="The figures" />
        {takesSampleOrders && (
          <p className="text-sm text-muted">
            Sample orders are left out of these figures. You'll find them in{" "}
            <Link to={adminModuleRoute("orders")} className="font-semibold text-link underline underline-offset-4 hover:text-link-hover">Orders</Link>.
          </p>
        )}
      </div>

      <section aria-label="Figures for this period">
        <ul className="grid grid-cols-1 gap-3 @min-[18rem]:grid-cols-2 @min-[36rem]:grid-cols-3 @min-[56rem]:grid-cols-5">
          {FIGURES.map((figure) => (
            <li key={figure.key} className="min-w-0">
              <FigureCard
                label={figure.label}
                definition={figure.definition}
                value={data ? figureValue(figure.key, data) : null}
                detail={data && figure.key === "refunds" ? `${data.figures.refunds.count} ${data.figures.refunds.count === 1 ? "refund" : "refunds"}` : undefined}
                to={data ? figureRoute(figure.key, period, data) : null}
                phase={phase}
              />
            </li>
          ))}
        </ul>
      </section>

      <div className="grid grid-cols-1 gap-6 @min-[56rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] @min-[56rem]:items-start">
        <Section title="Needs action now">
          {!data && <Missing phase={phase} />}
          {data && !rows.length && <p className="mt-3 text-sm text-muted">Nothing needs action right now.</p>}
          {rows.length > 0 && (
            <ul className="mt-3 divide-y divide-divider">
              {rows.map((row) => (
                <li key={row.key} className="py-0.5">
                  <Link to={row.to} aria-label={`${row.label}: ${row.count}`} className={`${rowLinkClass} justify-between`}>
                    <span className="min-w-0 [overflow-wrap:break-word]">{row.label}</span>
                    <span className="shrink-0 rounded-full bg-surface-soft px-[10px] text-sm font-bold leading-6 tabular-nums">{row.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Recent orders">
          {!data && <Missing phase={phase} />}
          {data && !data.recentOrders.length && <p className="mt-3 text-sm text-muted">No orders yet.</p>}
          {data && data.recentOrders.length > 0 && (
            <ul className="mt-3 divide-y divide-divider">
              {data.recentOrders.slice(0, RECENT_ORDER_LIMIT).map((order) => <RecentOrderRow key={order.id} order={order} />)}
            </ul>
          )}
        </Section>
      </div>

      <p>
        <Link to={adminModuleRoute("discounts")} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-link underline hover:text-link-hover">
          {activeDiscounts === undefined ? "Active discounts" : `Active discounts: ${activeDiscounts}`}
        </Link>
      </p>
    </div>
  );
}
