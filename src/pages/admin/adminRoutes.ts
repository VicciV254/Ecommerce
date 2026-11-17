import type { CatalogStock } from "../../api/catalog";
import type { DeliveryMethod, OrderStatus, PaymentStatus, RefundStatus, ReturnStatus } from "../../api/orders";
import { parseRoute } from "../../router";
import { isDeliveryMethod, isOrderStatus, isPaymentStatus } from "../../store/checkoutModel";
import { ORDER_ID } from "../../store/checkoutSteps";
import { isRefundStatus, isReturnStatus } from "../../store/orderModel";
import { isCalendarDate } from "../../utils/nairobiDate";

/**
 * The admin's address space: `#/admin/<group>/<module>` for each module, plus the storefront draft preview and the
 * product preview. Modules are the existing destinations; groups only arrange them in the navigation.
 */
export type AdminGroupId = "overview" | "orders" | "catalog" | "storefront" | "customers";
export type AdminModuleId =
  | "dashboard" | "analytics"
  | "orders" | "returns" | "refunds"
  | "products" | "stock"
  | "storefront"
  | "customers" | "discounts" | "promotions";
export type OrdersModuleId = Extract<AdminModuleId, "orders" | "returns" | "refunds">;

type AdminModule = {
  id: AdminModuleId;
  group: AdminGroupId;
  slug: string;
  label: string;
  /** One line under the module's H1. */
  description: string;
  /** Forms read best at a bounded width; lists and tables may use the whole content area. */
  width: "full" | "form";
};

export const ADMIN_HOME = "/admin";
export const ADMIN_PREVIEW_ROUTE = "/admin/storefront/preview";
/** One saved product on shoppers' own product page, with buying off: `?product=<id>`. */
export const ADMIN_PRODUCT_PREVIEW_ROUTE = "/admin/catalog/preview";

const MODULES: readonly AdminModule[] = [
  { id: "dashboard", group: "overview", slug: "dashboard", label: "Dashboard", width: "full",
    description: "Sales and orders for a period in Nairobi time, and the work that needs action now." },
  { id: "analytics", group: "overview", slug: "analytics", label: "Sales report", width: "full",
    description: "Net sales, orders, cancellations and refunds for a period in Nairobi time, with exports." },
  { id: "orders", group: "orders", slug: "orders", label: "Orders", width: "full",
    description: "Paid orders to fulfil, every order's status and closed orders." },
  { id: "returns", group: "orders", slug: "returns", label: "Returns", width: "full",
    description: "Return requests across orders; decisions and receipts are recorded in each order." },
  { id: "refunds", group: "orders", slug: "refunds", label: "Refunds", width: "full",
    description: "Manual M-Pesa refunds, from approval to a recorded reference." },
  { id: "products", group: "catalog", slug: "products", label: "Products", width: "full",
    description: "Products, categories and designers in the catalog." },
  { id: "stock", group: "catalog", slug: "stock", label: "Stock", width: "full",
    description: "On-hand, reserved and available units for each SKU." },
  { id: "storefront", group: "storefront", slug: "editor", label: "Storefront editor", width: "form",
    description: "The homepage draft: brand, theme, sections and campaigns. Shoppers see it only once published." },
  { id: "customers", group: "customers", slug: "customers", label: "Customers", width: "full",
    description: "Shopper accounts, their verification status and order counts." },
  { id: "discounts", group: "customers", slug: "discounts", label: "Discounts", width: "full",
    description: "Automatic and coupon discounts, and when they apply." },
  { id: "promotions", group: "customers", slug: "promotions", label: "Email promotions", width: "form",
    description: "Newsletter subscribers and promotional emails." },
];

export const ADMIN_GROUPS: readonly { id: AdminGroupId; label: string; modules: readonly AdminModule[] }[] = (
  [["overview", "Overview"], ["orders", "Orders and returns"], ["catalog", "Catalog and inventory"],
    ["storefront", "Storefront"], ["customers", "Customers and promotions"]] as const
).map(([id, label]) => ({ id, label, modules: MODULES.filter((module) => module.group === id) }));

/** Every module in navigation order. */
export const ADMIN_MODULE_IDS: readonly AdminModuleId[] = MODULES.map((module) => module.id);

export function adminModule(id: AdminModuleId): AdminModule {
  // Every id is listed above; the union type guarantees the lookup succeeds.
  return MODULES.find((module) => module.id === id)!;
}

export function adminGroupLabel(id: AdminGroupId) {
  return ADMIN_GROUPS.find((group) => group.id === id)!.label;
}

/** Where an admin address leads: the bare entry, a module, a preview, or nothing that exists. */
export type AdminPlace =
  | { kind: "home" }
  | { kind: "module"; module: AdminModuleId }
  | { kind: "preview" }
  | { kind: "product-preview" }
  | { kind: "not-found" };

/** Reads an `#/admin/...` route. Segments must match exactly; anything else is "not found", never a guess. */
export function parseAdminPlace(route: string): AdminPlace {
  const { parts } = parseRoute(route);
  if (parts[0] !== "admin") return { kind: "not-found" };
  if (parts.length === 1) return { kind: "home" };
  if (parts.length !== 3) return { kind: "not-found" };
  const [, group, slug] = parts;
  if (`/admin/${group}/${slug}` === ADMIN_PREVIEW_ROUTE) return { kind: "preview" };
  if (`/admin/${group}/${slug}` === ADMIN_PRODUCT_PREVIEW_ROUTE) return { kind: "product-preview" };
  const found = MODULES.find((module) => module.group === group && module.slug === slug);
  return found ? { kind: "module", module: found.id } : { kind: "not-found" };
}

export function adminModuleRoute(id: AdminModuleId) {
  const module = adminModule(id);
  return `/admin/${module.group}/${module.slug}`;
}

/** The path of a route, without its query. */
export function routePath(route: string) {
  return route.split("?")[0] || "/";
}

/* ------------------------------------------------------------------ */
/* Record identifiers in the address                                  */
/* ------------------------------------------------------------------ */

/** A record id read from the address: absent, well-formed, or malformed (never sent to the server). */
type RecordParam = { id: string | null; malformed: boolean };

function recordParam(value: string | null): RecordParam {
  if (value === null) return { id: null, malformed: false };
  return ORDER_ID.test(value) ? { id: value, malformed: false } : { id: null, malformed: true };
}

/* Orders, returns and refunds */

export const ORDER_VIEWS = [
  { id: "needs-action", label: "Needs action" },
  { id: "all", label: "All orders" },
  { id: "closed", label: "Closed" },
] as const;
export type OrderView = (typeof ORDER_VIEWS)[number]["id"];
const DEFAULT_ORDER_VIEW: OrderView = "needs-action";

const isOrderView = (value: string | null): value is OrderView => ORDER_VIEWS.some((view) => view.id === value);

type OrdersParams = {
  view: OrderView;
  /** A `view` was given but is not one of the views; the address should be corrected with a replace. */
  unknownView: boolean;
  order: RecordParam;
};

/** The Orders view (Orders module only) and the open order (all three modules). */
export function parseOrdersParams(module: OrdersModuleId, route: string): OrdersParams {
  const { params } = parseRoute(route);
  const view = module === "orders" ? params.get("view") : null;
  return {
    view: isOrderView(view) ? view : DEFAULT_ORDER_VIEW,
    unknownView: view !== null && !isOrderView(view),
    order: recordParam(params.get("order")),
  };
}

/* Worklist filters and pages */

/** The highest page a list request may ask for (the API's limit). */
const MAX_PAGE = 10_000;
const PAGE_PATTERN = /^[1-9]\d*$/;

/** A value read from the address: absent (null), accepted, or refused (null and flagged, so it is never sent). */
type Read<T> = { value: T | null; invalid: boolean };

function readParam<T extends string>(params: URLSearchParams, name: string, accept: (value: string) => value is T): Read<T> {
  const value = params.get(name);
  if (value === null) return { value: null, invalid: false };
  return accept(value) ? { value, invalid: false } : { value: null, invalid: true };
}

const isDay = (value: string): value is string => isCalendarDate(value);
const isPage = (value: string) => PAGE_PATTERN.test(value) && Number(value) <= MAX_PAGE;

function readPage(params: URLSearchParams): { page: number; invalid: boolean } {
  const value = params.get("page");
  if (value === null) return { page: 1, invalid: false };
  return isPage(value) ? { page: Number(value), invalid: false } : { page: 1, invalid: true };
}

/** Orders' filters: delivery and dates in every view; status, payment and page in All orders only. */
export type OrderListFilters = {
  delivery: DeliveryMethod | null;
  /** First and last Nairobi day an order was placed on (`YYYY-MM-DD`, both included). */
  from: string | null;
  to: string | null;
  status: OrderStatus | null;
  payment: PaymentStatus | null;
  page: number;
};
export const NO_ORDER_FILTERS: OrderListFilters = { delivery: null, from: null, to: null, status: null, payment: null, page: 1 };
const ALL_ORDERS_ONLY = ["status", "payment", "page"] as const;

/**
 * The Orders filters in the address for `view`. Unknown or malformed values, a `from` after its `to`, and the All-orders
 * filters in another view are dropped and flagged (`invalid`), so the address is corrected with a replace.
 */
export function parseOrderFilters(view: OrderView, route: string): { filters: OrderListFilters; invalid: boolean } {
  const { params } = parseRoute(route);
  const delivery = readParam(params, "delivery", isDeliveryMethod);
  const from = readParam(params, "from", isDay);
  const to = readParam(params, "to", isDay);
  const reversed = from.value !== null && to.value !== null && from.value > to.value;
  const allOrders = view === "all";
  const status = readParam(params, "status", isOrderStatus);
  const payment = readParam(params, "payment", isPaymentStatus);
  const page = readPage(params);
  const listInvalid = allOrders ? status.invalid || payment.invalid || page.invalid : ALL_ORDERS_ONLY.some((name) => params.has(name));
  return {
    filters: {
      delivery: delivery.value,
      from: reversed ? null : from.value,
      to: reversed ? null : to.value,
      status: allOrders ? status.value : null,
      payment: allOrders ? payment.value : null,
      page: allOrders ? page.page : 1,
    },
    invalid: delivery.invalid || from.invalid || to.invalid || reversed || listInvalid,
  };
}

/** Returns' or Refunds' filters: a status and a page. */
export type RecordListFilters<Status extends string = string> = { status: Status | null; page: number };

function recordFilters<Status extends string>(route: string, isStatus: (value: string) => value is Status) {
  const { params } = parseRoute(route);
  const status = readParam(params, "status", isStatus);
  const page = readPage(params);
  return { filters: { status: status.value, page: page.page }, invalid: status.invalid || page.invalid };
}

/** The Returns list's status and page; unknown or malformed values are dropped and flagged. */
export const parseReturnFilters = (route: string): { filters: RecordListFilters<ReturnStatus>; invalid: boolean } =>
  recordFilters(route, (value): value is ReturnStatus => isReturnStatus(value));
/** The Refunds list's status and page; unknown or malformed values are dropped and flagged. */
export const parseRefundFilters = (route: string): { filters: RecordListFilters<RefundStatus>; invalid: boolean } =>
  recordFilters(route, (value): value is RefundStatus => isRefundStatus(value));

type OrdersRouteOptions = {
  view?: OrderView;
  order?: string | null;
  /** Orders module: delivery and dates (every view); status, payment and page (All orders). */
  filters?: Partial<OrderListFilters>;
  /** Returns and Refunds modules: status and page. */
  records?: Partial<RecordListFilters>;
};

/**
 * The route of an orders module. Defaults (the Needs action view, page 1, no filter) are left out, and only well-formed
 * values are written: a malformed order id, an unknown status or a reversed date range never reaches the address.
 */
export function ordersRoute(module: OrdersModuleId, { view = DEFAULT_ORDER_VIEW, order = null, filters = {}, records = {} }: OrdersRouteOptions = {}) {
  const params = new URLSearchParams();
  const page = (value: number | undefined) => {
    if (value !== undefined && value > 1 && isPage(String(value))) params.set("page", String(value));
  };
  if (module === "orders") {
    if (view !== DEFAULT_ORDER_VIEW) params.set("view", view);
    if (filters.delivery && isDeliveryMethod(filters.delivery)) params.set("delivery", filters.delivery);
    const from = filters.from && isCalendarDate(filters.from) ? filters.from : null;
    const to = filters.to && isCalendarDate(filters.to) ? filters.to : null;
    if (!(from && to && from > to)) {
      if (from) params.set("from", from);
      if (to) params.set("to", to);
    }
    if (view === "all") {
      if (filters.status && isOrderStatus(filters.status)) params.set("status", filters.status);
      if (filters.payment && isPaymentStatus(filters.payment)) params.set("payment", filters.payment);
      page(filters.page);
    }
  } else {
    const isStatus = module === "returns" ? isReturnStatus : isRefundStatus;
    if (records.status && isStatus(records.status)) params.set("status", records.status);
    page(records.page);
  }
  if (order !== null && ORDER_ID.test(order)) params.set("order", order);
  const query = params.toString();
  return `${adminModuleRoute(module)}${query ? `?${query}` : ""}`;
}

/* Reporting periods: Dashboard and Sales report */

export const REPORT_PERIODS = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "year", label: "This year" },
] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number]["id"];
export const DEFAULT_REPORT_PERIOD: ReportPeriod = "month";
const isReportPeriod = (value: string): value is ReportPeriod => REPORT_PERIODS.some((period) => period.id === value);
export type PeriodModuleId = Extract<AdminModuleId, "dashboard" | "analytics">;

/** `period`: this month when absent; an unknown value reads as this month and is flagged for a replace. */
export function parsePeriodParam(route: string): { period: ReportPeriod; invalid: boolean } {
  const read = readParam(parseRoute(route).params, "period", isReportPeriod);
  return { period: read.value ?? DEFAULT_REPORT_PERIOD, invalid: read.invalid };
}

/** The Dashboard or Sales report for a period; this month, the default, is left out. */
export function periodRoute(module: PeriodModuleId, period: ReportPeriod = DEFAULT_REPORT_PERIOD) {
  return period === DEFAULT_REPORT_PERIOD ? adminModuleRoute(module) : `${adminModuleRoute(module)}?period=${period}`;
}

/* Stock */

type StockStatus = CatalogStock["status"];
export const STOCK_STATUSES: readonly StockStatus[] = ["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"];
const isStockStatus = (value: string): value is StockStatus => STOCK_STATUSES.some((status) => status === value);
const isRecordId = (value: string) => ORDER_ID.test(value);

/** Stock's filters: a status, and a category (with its subcategories) by id. */
export type StockFilters = { status: StockStatus | null; category: string | null };

/** The Stock filters; an unknown status or a malformed category id is dropped and flagged. */
export function parseStockParams(route: string): { filters: StockFilters; invalid: boolean } {
  const { params } = parseRoute(route);
  const status = readParam(params, "status", isStockStatus);
  const category = readParam(params, "category", (value): value is string => isRecordId(value));
  return { filters: { status: status.value, category: category.value }, invalid: status.invalid || category.invalid };
}

export function stockRoute({ status = null, category = null }: Partial<StockFilters> = {}) {
  const params = new URLSearchParams();
  if (status && isStockStatus(status)) params.set("status", status);
  if (category && isRecordId(category)) params.set("category", category);
  const query = params.toString();
  return `${adminModuleRoute("stock")}${query ? `?${query}` : ""}`;
}

/* Products */

/** `product=new` opens "Add product". */
export const NEW_PRODUCT = "new";

export function parseProductParam(route: string): RecordParam {
  return recordParam(parseRoute(route).params.get("product"));
}

/** The products list's status filter values. */
export const PRODUCT_STATUSES = ["visible", "hidden", "demo", "sample-images"] as const;
export type ProductStatusFilter = (typeof PRODUCT_STATUSES)[number];
/** The readiness filter values: ready to publish, or one open check (see `catalogReadiness.ts`). */
export const PRODUCT_READINESS = ["ready", "needs-images", "out-of-stock", "category-hidden"] as const;
export type ProductReadinessFilter = (typeof PRODUCT_READINESS)[number];
const isProductStatus = (value: string): value is ProductStatusFilter => PRODUCT_STATUSES.some((status) => status === value);
const isProductReadiness = (value: string): value is ProductReadinessFilter => PRODUCT_READINESS.some((item) => item === value);

/** The products list's filters: status, readiness, and a category (with its subcategories) by id. */
export type ProductListFilters = {
  status: ProductStatusFilter | null;
  readiness: ProductReadinessFilter | null;
  category: string | null;
};
export const NO_PRODUCT_FILTERS: ProductListFilters = { status: null, readiness: null, category: null };

/** The products list's filters; an unknown status or readiness, or a malformed category id, is dropped and flagged. */
export function parseProductListParams(route: string): { filters: ProductListFilters; invalid: boolean } {
  const { params } = parseRoute(route);
  const status = readParam(params, "status", isProductStatus);
  const readiness = readParam(params, "readiness", isProductReadiness);
  const category = readParam(params, "category", (value): value is string => isRecordId(value));
  return {
    filters: { status: status.value, readiness: readiness.value, category: category.value },
    invalid: status.invalid || readiness.invalid || category.invalid,
  };
}

/** The products list with its filters, then the open product (`new` for "Add product"); only well-formed values. */
export function productsRoute(product: string | null = null, filters: Partial<ProductListFilters> = {}) {
  const params = new URLSearchParams();
  if (filters.status && isProductStatus(filters.status)) params.set("status", filters.status);
  if (filters.readiness && isProductReadiness(filters.readiness)) params.set("readiness", filters.readiness);
  if (filters.category && isRecordId(filters.category)) params.set("category", filters.category);
  if (product !== null && ORDER_ID.test(product)) params.set("product", product);
  const query = params.toString();
  return `${adminModuleRoute("products")}${query ? `?${query}` : ""}`;
}

/** The preview of a saved product; anything but a well-formed product id leads to the products list instead. */
export function productPreviewRoute(product: string) {
  return ORDER_ID.test(product) && product !== NEW_PRODUCT
    ? `${ADMIN_PRODUCT_PREVIEW_ROUTE}?${new URLSearchParams({ product }).toString()}`
    : productsRoute();
}
