import { describe, expect, it } from "vitest";
import {
  ADMIN_GROUPS,
  ADMIN_MODULE_IDS,
  ADMIN_PREVIEW_ROUTE,
  adminModuleRoute,
  ordersRoute,
  parseAdminPlace,
  parseOrdersParams,
  parseProductParam,
  productsRoute,
  routePath,
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
    ["/admin/customers/customers", { kind: "module", module: "customers" }],
    ["/admin/customers/discounts", { kind: "module", module: "discounts" }],
    ["/admin/customers/promotions", { kind: "module", module: "promotions" }],
    ["/admin/orders/orders/", { kind: "module", module: "orders" }],
  ])("reads %s", (route, place) => {
    expect(parseAdminPlace(route)).toEqual(place);
  });

  it.each([
    "/admin/overview",
    "/admin/settings/activity",
    "/admin/orders/dashboard",
    "/admin/catalog/orders",
    "/admin/Orders/orders",
    "/admin/orders/orders/extra",
    "/admin/storefront/preview/x",
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
  });

  it("lists every module once, in five groups, with no settings or activity group", () => {
    const listed = ADMIN_GROUPS.flatMap((group) => group.modules.map((module) => module.id));
    expect(listed).toEqual([...ADMIN_MODULE_IDS]);
    expect(new Set(listed).size).toBe(listed.length);
    expect(ADMIN_GROUPS.map((group) => group.label)).toEqual([
      "Overview", "Orders and returns", "Catalog and inventory", "Storefront", "Customers and promotions",
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
});
