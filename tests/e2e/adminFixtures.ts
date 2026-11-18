import type { BrowserContext, Page } from "@playwright/test";
import type { ActivityEntry, AdminUser, StaffOrder, Subscription } from "../../src/api/admin";
import type { StorefrontRevision } from "../../src/api/catalog";
import type { Order } from "../../src/api/orders";
import { fixturePendingOrder } from "../../src/test-support/checkoutFixtures";
import { fixtureStaffOrder, fixtureStaffRefund, fixtureStaffReturn, noFulfilment } from "../../src/test-support/orderFixtures";
import { NOTHING_WAITING, fixtureDashboard, fixtureSalesReport } from "../../src/test-support/overviewFixtures";
import { STAFF_TOKEN, adminStocks, browserQuote, expect, serveStaffOrders, staff, storefrontDraft } from "./fixtures";

/** Every admin place, with its H1. */
export const ADMIN_PLACES = [
  { route: "/admin/overview/dashboard", h1: "Dashboard" },
  { route: "/admin/overview/analytics", h1: "Sales report" },
  { route: "/admin/orders/orders", h1: "Orders" },
  { route: "/admin/orders/returns", h1: "Returns" },
  { route: "/admin/orders/refunds", h1: "Refunds" },
  { route: "/admin/catalog/products", h1: "Products" },
  { route: "/admin/catalog/stock", h1: "Stock" },
  { route: "/admin/storefront/editor", h1: "Storefront editor" },
  { route: "/admin/storefront/preview", h1: "Draft preview: shoppers can't see this" },
  { route: "/admin/customers/customers", h1: "Customers" },
  { route: "/admin/customers/discounts", h1: "Discounts" },
  { route: "/admin/customers/promotions", h1: "Email promotions" },
  { route: "/admin/settings/activity", h1: "Staff activity" },
] as const;

const customer = { id: "customer-admin-e2e", firstName: "Wanjiku", lastName: "Kamau-Odhiambo", email: "wanjiku.kamau-odhiambo@example.test" };
const paidOrder = (quoteId: string, overrides: Partial<Order>): Order => ({
  ...fixturePendingOrder(browserQuote({ id: quoteId })), paymentStatus: "PAID", reservationStatus: "COMMITTED", reservationExpiresAt: null, ...overrides,
});

/** One order to dispatch, and a delivered order with a received return and a processing refund. */
export function staffOrders(): StaffOrder[] {
  const processing = paidOrder("quote-admin-1", { status: "PROCESSING" });
  const returned = paidOrder("quote-admin-2", { status: "DELIVERED" });
  const received = fixtureStaffReturn(returned, { status: "RECEIVED", receivedAt: "2026-11-10T09:00:00Z", merchantFaultConfirmed: false });
  const refund = fixtureStaffRefund(returned.id, {
    id: "refund-admin", number: `RF-${returned.orderNumber}-1`, status: "PROCESSING", amount: 1044,
    returnRequestId: received.id, approvedAt: "2026-11-10T10:00:00Z", processingAt: "2026-11-10T10:05:00Z",
  });
  return [
    fixtureStaffOrder(processing, { user: customer, fulfilment: { ...noFulfilment, processingAt: "2026-11-09T08:00:00Z" } }),
    { ...fixtureStaffOrder(returned, { user: customer, returns: [received] }), refunds: [refund] },
  ];
}

const users: AdminUser[] = [
  { ...customer, phone: null, emailVerified: true, isDisabled: false, createdAt: "2026-10-01T08:00:00Z", _count: { orders: 2, addresses: 1, wishlist: 0 } },
  {
    id: "customer-2", firstName: "Unverified", lastName: "Shopper", email: "an.extremely.long.address.for.layout@example.test", phone: null,
    emailVerified: false, isDisabled: false, createdAt: "2026-11-01T08:00:00Z", _count: { orders: 0, addresses: 0, wishlist: 0 },
  },
];
const subscriptions: Subscription[] = [
  { id: "sub-1", email: "newsletter.reader@example.test", isActive: true, createdAt: "2026-09-01T08:00:00Z" },
  { id: "sub-2", email: "lapsed.reader@example.test", isActive: false, createdAt: "2026-08-01T08:00:00Z" },
];

const signedIn = { username: staff.username, role: staff.role };
/** A long unbroken name, so layouts are checked with text that cannot wrap between words. */
export const LONG_STAFF_NAME = "wanjiku.kamau-odhiambo.night-shift-supervisor";

/** When the draft fixture's live version 3 was published. */
const PUBLISHED_AT = storefrontDraft.publishedAt ?? "";

/**
 * Staff activity, newest first: a restore into the draft by the signed-in staff member, other kinds of change and long
 * text, and the publication of the live version 3 by the same staff member.
 */
export const activityEntries: ActivityEntry[] = [
  { id: "act-restore", at: "2026-11-17T11:20:00.000Z", action: "STOREFRONT_RESTORED", targetType: "storefront", targetId: "1", details: "version 1", staff: signedIn },
  { id: "act-product", at: "2026-11-16T09:12:00.000Z", action: "PRODUCT_UPDATED", targetType: "product", targetId: "prod-linen-shirt", details: "Linen Short-Sleeve Shirt", staff: signedIn },
  { id: "act-category", at: "2026-11-15T16:40:00.000Z", action: "CATEGORY_UPDATED", targetType: "category", targetId: "cat-men",
    details: "Handwoven-linen-and-cotton-summer-workwear-for-coastal-Kenya", staff: { username: LONG_STAFF_NAME, role: "SUPER_ADMIN" } },
  { id: "act-discount", at: "2026-11-14T08:00:00.000Z", action: "DISCOUNT_STOPPED", targetType: "discount", targetId: "disc-1", details: "Linen week", staff: signedIn },
  { id: "act-customer", at: "2026-11-13T07:30:00.000Z", action: "CUSTOMER_DISABLED", targetType: "customer", targetId: "customer-2", details: "", staff: signedIn },
  { id: "act-login", at: "2026-11-13T05:00:00.000Z", action: "LOGIN", targetType: null, targetId: null, details: "Admin logged in", staff: { username: LONG_STAFF_NAME, role: "SUPER_ADMIN" } },
  { id: "act-publish", at: PUBLISHED_AT, action: "STOREFRONT_PUBLISHED", targetType: "storefront", targetId: "3", details: "version 3", staff: signedIn },
];

/** The actions each "Show" filter lists, as the API filters them. */
const ACTIVITY_FILTERS: Record<string, (action: string) => boolean> = {
  all: () => true,
  signins: (action) => action === "LOGIN",
  storefront: (action) => action.startsWith("STOREFRONT_"),
  catalog: (action) => /^(PRODUCT_|CATEGORY_|CATEGORIES_REORDERED|DESIGNER_)/.test(action),
  discounts: (action) => action.startsWith("DISCOUNT_"),
  customers: (action) => action.startsWith("CUSTOMER_"),
  promotions: (action) => action === "PROMOTION_SENT" || action === "SUBSCRIBER_REMOVED",
};

/** The storefront draft's history: version 3 is live (the draft fixture's `publishedVersion`), version 1 predates records. */
export const storefrontRevisions: StorefrontRevision[] = [
  { version: 3, publishedAt: PUBLISHED_AT, publishedBy: staff.username, live: true },
  { version: 2, publishedAt: "2026-10-29T07:40:00.000Z", publishedBy: LONG_STAFF_NAME, live: false },
  { version: 1, publishedAt: "2026-10-28T06:12:00.000Z", publishedBy: null, live: false },
];

type Route = Parameters<Parameters<BrowserContext["route"]>[1]>[0];
const pageOf = <T,>(items: readonly T[], page: number, limit: number) =>
  ({ items: items.slice((page - 1) * limit, page * limit), pagination: { page, limit, pages: Math.ceil(items.length / limit), total: items.length } });

/** `GET /admin/activity` (25 a page, filtered by type) and `GET /settings/storefront/revisions` (20 a page). */
export async function serveStaffHistory(context: BrowserContext, entries: () => readonly ActivityEntry[] = () => activityEntries,
  revisions: () => readonly StorefrontRevision[] = () => storefrontRevisions) {
  const staffOnly = (route: Route, answer: (url: URL) => unknown) => {
    if (route.request().method() !== "GET") return route.fallback();
    if (route.request().headers().authorization !== `Bearer ${STAFF_TOKEN}`) return route.fulfill({ status: 401, json: { error: "Invalid token" } });
    return route.fulfill({ json: answer(new URL(route.request().url())) });
  };
  await context.route("**/api/admin/activity*", (route) => staffOnly(route, (url) => {
    const matches = ACTIVITY_FILTERS[url.searchParams.get("type") ?? "all"] ?? (() => false);
    const { items, pagination } = pageOf(entries().filter((entry) => matches(entry.action)), Number(url.searchParams.get("page") ?? 1), 25);
    return { entries: items, pagination };
  }));
  await context.route("**/api/settings/storefront/revisions*", (route) => staffOnly(route, (url) => {
    const { items, pagination } = pageOf(revisions(), Number(url.searchParams.get("page") ?? 1), 20);
    return { revisions: items, pagination };
  }));
}

/** Staff reads every module makes, answered as the API would; writes fall through to the test (or the 503 default). */
export async function serveAdminData(context: BrowserContext) {
  const orders = staffOrders();
  await serveStaffOrders(context, () => orders);
  const read = (json: unknown) => (route: Parameters<Parameters<BrowserContext["route"]>[1]>[0]) =>
    route.request().method() === "GET" ? route.fulfill({ json }) : route.fallback();
  await context.route("**/api/admin/users?*", read({ users }));
  await context.route("**/api/admin/users", read({ users }));
  await context.route("**/api/subscriptions/admin/all*", read({ subscriptions }));
  await serveStaffHistory(context);
  // The dashboard and the sales report for any period, reconciling with each other and with these records.
  const period = (route: Parameters<Parameters<BrowserContext["route"]>[1]>[0]) => new URL(route.request().url()).searchParams.get("period") ?? "month";
  await context.route("**/api/admin/analytics/sales*", (route) => route.request().method() === "GET"
    ? route.fulfill({ json: salesReport(period(route), orders) })
    : route.fallback());
  await context.route("**/api/admin/analytics/dashboard*", (route) => route.request().method() === "GET"
    ? route.fulfill({ json: dashboard(period(route), orders) })
    : route.fallback());
  return orders;
}

/** Both staff orders are paid and placed today; nothing is cancelled or refunded yet. */
const PERIOD_FIGURES = { netSales: 2488, paidOrders: 2, ordersPlaced: 2, cancelledOrders: 0, refunds: { count: 0, amount: 0 } };

function salesReport(period: string, orders: StaffOrder[]) {
  return fixtureSalesReport(period, {
    totalRevenue: PERIOD_FIGURES.netSales, paidOrders: PERIOD_FIGURES.paidOrders, totalOrders: PERIOD_FIGURES.ordersPlaced,
    cancelledOrders: 0, cancelledValue: 0, returnedValue: 0, refundedValue: 0,
    orders: orders.map((order) => ({
      id: order.id, orderNumber: order.orderNumber, customer: `${customer.firstName} ${customer.lastName}`, email: customer.email,
      status: order.status, paymentStatus: order.paymentStatus, deliveryMethod: order.deliveryMethod,
      subtotal: order.subtotal, tax: order.tax, shippingCost: order.shippingCost, total: order.total, createdAt: order.createdAt,
    })),
  });
}

/** Current counts as the lists count them: one order processing, one refund being sent, and the real SKUs low or out. */
function dashboard(period: string, orders: StaffOrder[]) {
  const realStock = (status: string) => adminStocks.filter((row) => !row.isDemo && row.status === status).length;
  return fixtureDashboard(period, {
    figures: PERIOD_FIGURES,
    current: {
      ...NOTHING_WAITING,
      orders: { ...NOTHING_WAITING.orders, processing: orders.filter((order) => order.status === "PROCESSING").length },
      refunds: { ...NOTHING_WAITING.refunds, PROCESSING: orders.flatMap((order) => order.refunds).filter((refund) => refund.status === "PROCESSING").length },
      stock: { LOW_STOCK: realStock("LOW_STOCK"), OUT_OF_STOCK: realStock("OUT_OF_STOCK") },
    },
    recentOrders: orders.map((order) => ({
      id: order.id, orderNumber: order.orderNumber, status: order.status, deliveryMethod: order.deliveryMethod, total: order.total,
      user: { firstName: customer.firstName, lastName: customer.lastName },
    })),
  });
}

/** Waits for a place's H1 and for its loading statuses to finish. */
export async function waitForPlace(page: Page, h1: string) {
  await expect(page.getByRole("heading", { level: 1, name: h1, exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /^Loading/ })).toHaveCount(0);
}

/**
 * Horizontal layout problems on the page: page-level overflow, and anything that scrolls sideways other than a
 * labelled, keyboard-focusable region (a two-dimensional table may scroll inside one).
 */
export const layoutProblems = (page: Page) => page.evaluate(() => {
  const limit = document.documentElement.clientWidth;
  const describe = (element: Element) => {
    const html = element as HTMLElement;
    const label = html.getAttribute("aria-label") ?? (html.textContent ?? "").trim().slice(0, 40);
    return `${element.tagName.toLowerCase()}${html.id ? `#${html.id}` : ""} "${label}"`;
  };
  const overflow = document.documentElement.scrollWidth - limit;
  const offenders = overflow > 0
    ? [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => {
        if (getComputedStyle(element).position === "fixed") return false;
        const box = element.getBoundingClientRect();
        const parent = element.parentElement?.getBoundingClientRect();
        return box.width > 0 && box.right > limit + 0.5 && (!parent || parent.right <= limit + 0.5);
      })
      .slice(0, 8)
      .map((element) => `${describe(element)} right=${Math.round(element.getBoundingClientRect().right)}`)
    : [];
  const scrollers = [...document.querySelectorAll<HTMLElement>("body *")]
    .filter((element) => {
      const { overflowX } = getComputedStyle(element);
      if (overflowX !== "auto" && overflowX !== "scroll") return false;
      if (element.scrollWidth <= element.clientWidth + 1 || element.getClientRects().length === 0) return false;
      return !(element.getAttribute("role") === "region" && element.getAttribute("aria-label") && element.tabIndex >= 0);
    })
    .map((element) => `${describe(element)} scrolls ${element.scrollWidth - element.clientWidth}px`);
  return { overflow, offenders, scrollers };
});
