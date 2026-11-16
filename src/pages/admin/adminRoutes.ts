import { parseRoute } from "../../router";
import { ORDER_ID } from "../../store/checkoutSteps";

/**
 * The admin's address space: `#/admin/<group>/<module>` for each module, plus the storefront draft preview.
 * Modules are the existing destinations; groups only arrange them in the navigation.
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

const MODULES: readonly AdminModule[] = [
  { id: "dashboard", group: "overview", slug: "dashboard", label: "Dashboard", width: "full",
    description: "Sales, orders and stock that need attention, at a glance." },
  { id: "analytics", group: "overview", slug: "analytics", label: "Sales report", width: "full",
    description: "Revenue, cancellations, returns and refunds for a period, with exports." },
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

/** Where an admin address leads: the bare entry, a module, the storefront draft preview, or nothing that exists. */
export type AdminPlace =
  | { kind: "home" }
  | { kind: "module"; module: AdminModuleId }
  | { kind: "preview" }
  | { kind: "not-found" };

/** Reads an `#/admin/...` route. Segments must match exactly; anything else is "not found", never a guess. */
export function parseAdminPlace(route: string): AdminPlace {
  const { parts } = parseRoute(route);
  if (parts[0] !== "admin") return { kind: "not-found" };
  if (parts.length === 1) return { kind: "home" };
  if (parts.length !== 3) return { kind: "not-found" };
  const [, group, slug] = parts;
  if (`/admin/${group}/${slug}` === ADMIN_PREVIEW_ROUTE) return { kind: "preview" };
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

/** The route of an orders module; the default view is left out, and only a well-formed order id is kept. */
export function ordersRoute(module: OrdersModuleId, { view = DEFAULT_ORDER_VIEW, order = null }: { view?: OrderView; order?: string | null } = {}) {
  const params = new URLSearchParams();
  if (module === "orders" && view !== DEFAULT_ORDER_VIEW) params.set("view", view);
  if (order !== null && ORDER_ID.test(order)) params.set("order", order);
  const query = params.toString();
  return `${adminModuleRoute(module)}${query ? `?${query}` : ""}`;
}

/* Products */

/** `product=new` opens "Add product". */
export const NEW_PRODUCT = "new";

export function parseProductParam(route: string): RecordParam {
  return recordParam(parseRoute(route).params.get("product"));
}

export function productsRoute(product: string | null = null) {
  return product !== null && ORDER_ID.test(product)
    ? `${adminModuleRoute("products")}?${new URLSearchParams({ product }).toString()}`
    : adminModuleRoute("products");
}
