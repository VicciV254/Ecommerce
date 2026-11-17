import { describe, expect, it } from "vitest";
import {
  ADMIN_GROUPS,
  ADMIN_MODULE_IDS,
  ADMIN_PREVIEW_ROUTE,
  ADMIN_PRODUCT_PREVIEW_ROUTE,
  NO_ORDER_FILTERS,
  activityRoute,
  parseActivityParams,
  NO_PRODUCT_FILTERS,
  adminModuleRoute,
  ordersRoute,
  parseAdminPlace,
  parseOrderFilters,
  parseOrdersParams,
  parsePeriodParam,
  parseProductListParams,
  parseProductParam,
  parseRefundFilters,
  parseReturnFilters,
  parseStockParams,
  periodRoute,
  productPreviewRoute,
  productsRoute,
  routePath,
  stockRoute,
  type OrderListFilters,
} from "./adminRoutes";

describe("admin places", () => {
  it.each([
    ["/admin", { kind: "home" }],
    ["/admin/", { kind: "home" }],
    ["/admin?from=footer", { kind: "home" }],
    ["/admin/overview/dashboard", { kind: "module", module: "dashboard" }],
    ["/admin/overview/analytics", { kind: "module", module: "analytics" }],
    ["/admin/orders/orders?view=all&order=order-1", { kind: "module", module: "orders" }],
    ["/admin/orders/returns", { kind: "module", module: "returns" }],
    ["/admin/orders/refunds", { kind: "module", module: "refunds" }],
    ["/admin/catalog/products?product=new", { kind: "module", module: "products" }],
    ["/admin/catalog/stock", { kind: "module", module: "stock" }],
    ["/admin/storefront/editor", { kind: "module", module: "storefront" }],
    ["/admin/storefront/preview", { kind: "preview" }],
    ["/admin/catalog/preview?product=prod-linen-shirt", { kind: "product-preview" }],
    ["/admin/catalog/preview", { kind: "product-preview" }],
    ["/admin/customers/customers", { kind: "module", module: "customers" }],
    ["/admin/customers/discounts", { kind: "module", module: "discounts" }],
    ["/admin/customers/promotions", { kind: "module", module: "promotions" }],
    ["/admin/settings/activity", { kind: "module", module: "activity" }],
    ["/admin/settings/activity?type=catalog&page=2", { kind: "module", module: "activity" }],
    ["/admin/orders/orders/", { kind: "module", module: "orders" }],
  ])("reads %s", (route, place) => {
    expect(parseAdminPlace(route)).toEqual(place);
  });

  it.each([
    "/admin/overview",
    "/admin/settings/no-such-page",
    "/admin/customers/activity",
    "/admin/orders/dashboard",
    "/admin/catalog/orders",
    "/admin/Orders/orders",
    "/admin/orders/orders/extra",
    "/admin/storefront/preview/x",
    "/admin/catalog/preview/prod-1",
    "/admin/storefront/product-preview",
    "/admin/%6Frders/orders",
    "/admin/constructor/toString",
    "/admin/__proto__/products",
    "/admin/../admin/overview/dashboard",
    "/shop",
  ])("reports %s as not found instead of guessing", (route) => {
    expect(parseAdminPlace(route)).toEqual({ kind: "not-found" });
  });

  it("builds a route for every module that reads back as the same module", () => {
    for (const module of ADMIN_MODULE_IDS) {
      expect(parseAdminPlace(adminModuleRoute(module))).toEqual({ kind: "module", module });
    }
    expect(parseAdminPlace(ADMIN_PREVIEW_ROUTE)).toEqual({ kind: "preview" });
    expect(parseAdminPlace(ADMIN_PRODUCT_PREVIEW_ROUTE)).toEqual({ kind: "product-preview" });
  });

  it("lists every module once, in six groups, with Settings and activity last", () => {
    const listed = ADMIN_GROUPS.flatMap((group) => group.modules.map((module) => module.id));
    expect(listed).toEqual([...ADMIN_MODULE_IDS]);
    expect(new Set(listed).size).toBe(listed.length);
    expect(ADMIN_GROUPS.map((group) => group.label)).toEqual([
      "Overview", "Orders and returns", "Catalog and inventory", "Storefront", "Customers and promotions", "Settings and activity",
    ]);
    expect(ADMIN_GROUPS.at(-1)?.modules.map((module) => [module.id, module.slug, module.label, module.width])).toEqual([
      ["activity", "activity", "Staff activity", "full"],
    ]);
  });

  it("separates a route's path from its query", () => {
    expect(routePath("/admin/orders/orders?view=all")).toBe("/admin/orders/orders");
    expect(routePath("")).toBe("/");
  });
});

describe("orders parameters", () => {
  it("defaults the view to needs action and keeps a well-formed order id", () => {
    expect(parseOrdersParams("orders", "/admin/orders/orders")).toEqual({
      view: "needs-action", unknownView: false, order: { id: null, malformed: false },
    });
    expect(parseOrdersParams("orders", "/admin/orders/orders?view=closed&order=order_1:A-2")).toEqual({
      view: "closed", unknownView: false, order: { id: "order_1:A-2", malformed: false },
    });
  });

  it.each(["bogus", "ALL", "", "needs action", "toString"])("falls back from the unknown view %j and flags it", (view) => {
    const parsed = parseOrdersParams("orders", `/admin/orders/orders?view=${encodeURIComponent(view)}`);
    expect(parsed.view).toBe("needs-action");
    expect(parsed.unknownView).toBe(true);
  });

  it("ignores a view on the Returns and Refunds modules", () => {
    expect(parseOrdersParams("returns", "/admin/orders/returns?view=all")).toMatchObject({ view: "needs-action", unknownView: false });
    expect(parseOrdersParams("refunds", "/admin/orders/refunds?view=bogus")).toMatchObject({ view: "needs-action", unknownView: false });
  });

  it.each([
    ["", "an empty id"],
    ["../admin/1", "a path"],
    ["<script>", "markup"],
    ["order 1", "a space"],
    ["x".repeat(129), "an over-long id"],
    ["order%2F1", "an encoded slash"],
    ["ordér", "a non-ASCII letter"],
  ])("flags the malformed order id %j (%s), so it is never sent", (order) => {
    const route = `/admin/orders/orders?order=${encodeURIComponent(order)}`;
    expect(parseOrdersParams("orders", route).order).toEqual({ id: null, malformed: true });
  });

  it("builds canonical routes: no default view, no malformed ids", () => {
    expect(ordersRoute("orders")).toBe("/admin/orders/orders");
    expect(ordersRoute("orders", { view: "needs-action" })).toBe("/admin/orders/orders");
    expect(ordersRoute("orders", { view: "all", order: "order-1" })).toBe("/admin/orders/orders?view=all&order=order-1");
    expect(ordersRoute("returns", { view: "closed", order: "order-1" })).toBe("/admin/orders/returns?order=order-1");
    expect(ordersRoute("refunds", { order: "bad id" })).toBe("/admin/orders/refunds");
  });
});

describe("products parameter", () => {
  it("reads a product id, the new-product marker and malformed ids", () => {
    expect(parseProductParam("/admin/catalog/products")).toEqual({ id: null, malformed: false });
    expect(parseProductParam("/admin/catalog/products?product=prod-linen-shirt")).toEqual({ id: "prod-linen-shirt", malformed: false });
    expect(parseProductParam("/admin/catalog/products?product=new")).toEqual({ id: "new", malformed: false });
    expect(parseProductParam("/admin/catalog/products?product=%3Cimg%3E")).toEqual({ id: null, malformed: true });
    expect(parseProductParam("/admin/catalog/products?product=")).toEqual({ id: null, malformed: true });
  });

  it("builds product routes and drops malformed ids", () => {
    expect(productsRoute()).toBe("/admin/catalog/products");
    expect(productsRoute("new")).toBe("/admin/catalog/products?product=new");
    expect(productsRoute("prod-1")).toBe("/admin/catalog/products?product=prod-1");
    expect(productsRoute("a/b")).toBe("/admin/catalog/products");
  });

  it("previews only a well-formed saved product id, and reads it back from the preview address", () => {
    expect(productPreviewRoute("prod-linen-shirt")).toBe("/admin/catalog/preview?product=prod-linen-shirt");
    expect(parseProductParam(productPreviewRoute("prod-linen-shirt"))).toEqual({ id: "prod-linen-shirt", malformed: false });
    for (const id of ["new", "a/b", "", "<img>"]) expect(productPreviewRoute(id)).toBe("/admin/catalog/products");
  });
});

describe("products list filters in the address", () => {
  it("reads nothing as no filter", () => {
    expect(parseProductListParams("/admin/catalog/products")).toEqual({ filters: NO_PRODUCT_FILTERS, invalid: false });
    expect(parseProductListParams("/admin/catalog/products?product=prod-1")).toEqual({ filters: NO_PRODUCT_FILTERS, invalid: false });
  });

  it("reads every status and readiness value and a well-formed category id", () => {
    for (const status of ["visible", "hidden", "demo", "sample-images"] as const) {
      expect(parseProductListParams(`/admin/catalog/products?status=${status}`).filters.status).toBe(status);
    }
    for (const readiness of ["ready", "needs-images", "out-of-stock", "category-hidden"] as const) {
      expect(parseProductListParams(`/admin/catalog/products?readiness=${readiness}`).filters.readiness).toBe(readiness);
    }
    expect(parseProductListParams("/admin/catalog/products?status=hidden&readiness=ready&category=cat-shirts&product=prod-1"))
      .toEqual({ filters: { status: "hidden", readiness: "ready", category: "cat-shirts" }, invalid: false });
  });

  it("drops and flags an unknown status or readiness and a malformed category, keeping the others", () => {
    const kept = { status: "hidden", readiness: "ready", category: "cat-1" } as const;
    for (const [name, value] of [
      ["status", "all"], ["status", "Hidden"], ["status", ""], ["readiness", "no-active-option"], ["readiness", ""],
      ["category", "a%2Fb"], ["category", ""],
    ] as const) {
      const query = Object.entries({ ...kept, [name]: value }).map(([key, item]) => `${key}=${item}`).join("&");
      expect(parseProductListParams(`/admin/catalog/products?${query}`), query)
        .toEqual({ filters: { ...kept, [name]: null }, invalid: true });
    }
  });

  it("writes the filters in one canonical order before the open product, and never a malformed value", () => {
    const filters = { status: "hidden", readiness: "needs-images", category: "cat-shirts" } as const;
    expect(productsRoute(null, filters)).toBe("/admin/catalog/products?status=hidden&readiness=needs-images&category=cat-shirts");
    expect(productsRoute("prod-1", filters))
      .toBe("/admin/catalog/products?status=hidden&readiness=needs-images&category=cat-shirts&product=prod-1");
    expect(parseProductListParams(productsRoute("prod-1", filters))).toEqual({ filters, invalid: false });
    expect(productsRoute(null, { status: null, readiness: null, category: "a/b" })).toBe("/admin/catalog/products");
    expect(productsRoute("new", { category: "cat-1" })).toBe("/admin/catalog/products?category=cat-1&product=new");
  });
});

describe("orders filters in the address", () => {
  const full: OrderListFilters = { delivery: "SAME_DAY", from: "2026-11-01", to: "2026-11-17", status: "CANCELLED", payment: "REFUNDED", page: 3 };
  const allOrders = "/admin/orders/orders?view=all&delivery=SAME_DAY&from=2026-11-01&to=2026-11-17&status=CANCELLED&payment=REFUNDED&page=3";

  it("reads nothing as no filter, on page 1", () => {
    for (const view of ["needs-action", "all", "closed"] as const) {
      expect(parseOrderFilters(view, "/admin/orders/orders")).toEqual({ filters: NO_ORDER_FILTERS, invalid: false });
    }
  });

  it("reads every All orders filter and writes it back in one canonical order", () => {
    expect(parseOrderFilters("all", allOrders)).toEqual({ filters: full, invalid: false });
    expect(ordersRoute("orders", { view: "all", filters: full })).toBe(allOrders);
    expect(ordersRoute("orders", { view: "all", filters: full, order: "order-1" })).toBe(`${allOrders}&order=order-1`);
    expect(parseOrderFilters("all", ordersRoute("orders", { view: "all", filters: full }))).toEqual({ filters: full, invalid: false });
  });

  it("keeps delivery and dates in every view, and status, payment and page only in All orders", () => {
    expect(ordersRoute("orders", { filters: full })).toBe("/admin/orders/orders?delivery=SAME_DAY&from=2026-11-01&to=2026-11-17");
    expect(ordersRoute("orders", { view: "closed", filters: full })).toBe("/admin/orders/orders?view=closed&delivery=SAME_DAY&from=2026-11-01&to=2026-11-17");
    expect(parseOrderFilters("closed", "/admin/orders/orders?view=closed&from=2026-11-01")).toEqual({
      filters: { ...NO_ORDER_FILTERS, from: "2026-11-01" }, invalid: false,
    });
    for (const stray of ["status=PENDING", "payment=PAID", "page=2"]) {
      expect(parseOrderFilters("needs-action", `/admin/orders/orders?${stray}`), stray).toEqual({ filters: NO_ORDER_FILTERS, invalid: true });
    }
  });

  it("leaves out defaults: page 1 and empty filters", () => {
    expect(ordersRoute("orders", { view: "all", filters: { ...NO_ORDER_FILTERS } })).toBe("/admin/orders/orders?view=all");
    expect(ordersRoute("orders", { view: "all", filters: { page: 1 } })).toBe("/admin/orders/orders?view=all");
    expect(ordersRoute("orders", { view: "all", filters: { from: "2026-11-17" } })).toBe("/admin/orders/orders?view=all&from=2026-11-17");
  });

  it.each([
    ["delivery=DRONE"], ["delivery=constructor"], ["from=2026-02-30"], ["to=2026-13-01"], ["from=17-11-2026"], ["to="],
    ["status=SHIPPED%20"], ["status=toString"], ["payment=paid"], ["page=0"], ["page=-1"], ["page=1.5"], ["page=01"],
    ["page=abc"], ["page=10001"], ["page="],
  ])("drops and flags the malformed %s, so it is never sent", (query) => {
    const parsed = parseOrderFilters("all", `/admin/orders/orders?view=all&${query}`);
    expect(parsed).toEqual({ filters: NO_ORDER_FILTERS, invalid: true });
  });

  it("drops a from date after its to date as a pair, and never writes one", () => {
    expect(parseOrderFilters("all", "/admin/orders/orders?view=all&from=2026-11-18&to=2026-11-17")).toEqual({ filters: NO_ORDER_FILTERS, invalid: true });
    expect(parseOrderFilters("all", "/admin/orders/orders?view=all&from=2026-11-17&to=2026-11-17").filters).toMatchObject({ from: "2026-11-17", to: "2026-11-17" });
    expect(ordersRoute("orders", { view: "all", filters: { from: "2026-11-18", to: "2026-11-17" } })).toBe("/admin/orders/orders?view=all");
  });

  it("never writes a malformed filter value", () => {
    const filters = { delivery: "DRONE", from: "2026-02-30", to: "x", status: "BOGUS", payment: "BOGUS", page: 0 } as unknown as OrderListFilters;
    expect(ordersRoute("orders", { view: "all", filters })).toBe("/admin/orders/orders?view=all");
    expect(ordersRoute("orders", { view: "all", filters: { page: 10_001 } })).toBe("/admin/orders/orders?view=all");
  });
});

describe("returns and refunds filters in the address", () => {
  it("reads a status and a page for each list, with its own statuses", () => {
    expect(parseReturnFilters("/admin/orders/returns")).toEqual({ filters: { status: null, page: 1 }, invalid: false });
    expect(parseReturnFilters("/admin/orders/returns?status=REQUESTED&page=2")).toEqual({ filters: { status: "REQUESTED", page: 2 }, invalid: false });
    expect(parseRefundFilters("/admin/orders/refunds?status=UNRESOLVED")).toEqual({ filters: { status: "UNRESOLVED", page: 1 }, invalid: false });
    // A refund status is not a return status, and the reverse.
    expect(parseReturnFilters("/admin/orders/returns?status=PROCESSING")).toEqual({ filters: { status: null, page: 1 }, invalid: true });
    expect(parseRefundFilters("/admin/orders/refunds?status=RECEIVED")).toEqual({ filters: { status: null, page: 1 }, invalid: true });
    expect(parseRefundFilters("/admin/orders/refunds?status=FAILED&page=x")).toEqual({ filters: { status: "FAILED", page: 1 }, invalid: true });
  });

  it("writes status and page, then the open order, and drops statuses from another list", () => {
    expect(ordersRoute("returns", { records: { status: "APPROVED", page: 2 } })).toBe("/admin/orders/returns?status=APPROVED&page=2");
    expect(ordersRoute("refunds", { records: { status: "FAILED" }, order: "order-1" })).toBe("/admin/orders/refunds?status=FAILED&order=order-1");
    expect(ordersRoute("returns", { records: { status: "UNRESOLVED", page: 1 } })).toBe("/admin/orders/returns");
    // Orders filters belong to the Orders module only.
    expect(ordersRoute("returns", { filters: { delivery: "SAME_DAY", status: "PENDING" } })).toBe("/admin/orders/returns");
    expect(ordersRoute("orders", { view: "all", records: { status: "REQUESTED", page: 4 } })).toBe("/admin/orders/orders?view=all");
  });
});

describe("report period in the address", () => {
  it("defaults to this month and flags anything but the four periods", () => {
    expect(parsePeriodParam("/admin/overview/dashboard")).toEqual({ period: "month", invalid: false });
    for (const period of ["today", "week", "month", "year"] as const) {
      expect(parsePeriodParam(`/admin/overview/analytics?period=${period}`)).toEqual({ period, invalid: false });
    }
    for (const period of ["day", "Month", "", "constructor"]) {
      expect(parsePeriodParam(`/admin/overview/dashboard?period=${period}`), period).toEqual({ period: "month", invalid: true });
    }
  });

  it("leaves this month out of the route", () => {
    expect(periodRoute("dashboard")).toBe("/admin/overview/dashboard");
    expect(periodRoute("dashboard", "month")).toBe("/admin/overview/dashboard");
    expect(periodRoute("analytics", "week")).toBe("/admin/overview/analytics?period=week");
    expect(parseAdminPlace(periodRoute("analytics", "year"))).toEqual({ kind: "module", module: "analytics" });
  });
});

describe("stock filters in the address", () => {
  it("reads a status and a well-formed category id, and flags anything else", () => {
    expect(parseStockParams("/admin/catalog/stock")).toEqual({ filters: { status: null, category: null }, invalid: false });
    expect(parseStockParams("/admin/catalog/stock?status=LOW_STOCK&category=cat-shirts")).toEqual({
      filters: { status: "LOW_STOCK", category: "cat-shirts" }, invalid: false,
    });
    expect(parseStockParams("/admin/catalog/stock?status=low")).toEqual({ filters: { status: null, category: null }, invalid: true });
    expect(parseStockParams("/admin/catalog/stock?category=%3Cimg%3E")).toEqual({ filters: { status: null, category: null }, invalid: true });
  });

  it("writes only well-formed filters", () => {
    expect(stockRoute()).toBe("/admin/catalog/stock");
    expect(stockRoute({ status: "OUT_OF_STOCK" })).toBe("/admin/catalog/stock?status=OUT_OF_STOCK");
    expect(stockRoute({ status: "LOW_STOCK", category: "cat-shirts" })).toBe("/admin/catalog/stock?status=LOW_STOCK&category=cat-shirts");
    expect(stockRoute({ category: "a/b" })).toBe("/admin/catalog/stock");
  });
});

describe("staff activity filter and page in the address", () => {
  it("reads all activity on page 1 by default, and a known type and page as given", () => {
    expect(parseActivityParams("/admin/settings/activity")).toEqual({ filters: { type: "all", page: 1 }, invalid: false });
    expect(parseActivityParams("/admin/settings/activity?type=customers&page=3")).toEqual({ filters: { type: "customers", page: 3 }, invalid: false });
  });

  it.each([
    ["type=bogus", { type: "all", page: 1 }],
    ["type=Catalog&page=2", { type: "all", page: 2 }],
    ["type=signins&page=0", { type: "signins", page: 1 }],
    ["page=02", { type: "all", page: 1 }],
    ["page=10001", { type: "all", page: 1 }],
    ["type=", { type: "all", page: 1 }],
  ])("drops and flags %s", (query, filters) => {
    expect(parseActivityParams(`/admin/settings/activity?${query}`)).toEqual({ filters, invalid: true });
  });

  it("writes only what differs from the defaults, and only well-formed values", () => {
    expect(activityRoute()).toBe("/admin/settings/activity");
    expect(activityRoute({ type: "all", page: 1 })).toBe("/admin/settings/activity");
    expect(activityRoute({ type: "catalog", page: 2 })).toBe("/admin/settings/activity?type=catalog&page=2");
    expect(activityRoute({ page: 0 })).toBe("/admin/settings/activity");
    for (const route of [activityRoute({ type: "promotions", page: 7 }), activityRoute({ type: "signins" })]) {
      expect(activityRoute(parseActivityParams(route).filters)).toBe(route);
    }
  });
});
