import type { BrowserContext, Page } from "@playwright/test";
import type { AdminUser, StaffOrder, Subscription } from "../../src/api/admin";
import type { Order } from "../../src/api/orders";
import { fixturePendingOrder } from "../../src/test-support/checkoutFixtures";
import { fixtureStaffOrder, fixtureStaffRefund, fixtureStaffReturn, noFulfilment } from "../../src/test-support/orderFixtures";
import { browserQuote, expect, serveStaffOrders } from "./fixtures";

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

/** Staff reads every module makes, answered as the API would; writes fall through to the test (or the 503 default). */
export async function serveAdminData(context: BrowserContext) {
  const orders = staffOrders();
  await serveStaffOrders(context, () => orders);
  const read = (json: unknown) => (route: Parameters<Parameters<BrowserContext["route"]>[1]>[0]) =>
    route.request().method() === "GET" ? route.fulfill({ json }) : route.fallback();
  await context.route("**/api/admin/users?*", read({ users }));
  await context.route("**/api/admin/users", read({ users }));
  await context.route("**/api/subscriptions/admin/all*", read({ subscriptions }));
  await context.route("**/api/admin/analytics/sales*", read({
    period: "month", totalRevenue: 2488, totalOrders: 2, cancelledValue: 0, returnedValue: 1044, refundedValue: 0,
    orders: orders.map((order) => ({
      id: order.id, orderNumber: order.orderNumber, customer: `${customer.firstName} ${customer.lastName}`, email: customer.email,
      status: order.status, paymentStatus: order.paymentStatus, deliveryMethod: order.deliveryMethod,
      subtotal: order.subtotal, tax: order.tax, shippingCost: order.shippingCost, total: order.total, createdAt: order.createdAt,
    })),
  }));
  return orders;
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
      // The storefront's own renderer inside the draft preview (its department rail scrolls by design; P7.2 owns it).
      if (element.closest('[aria-label="Draft preview"]')) return false;
      return !(element.getAttribute("role") === "region" && element.getAttribute("aria-label") && element.tabIndex >= 0);
    })
    .map((element) => `${describe(element)} scrolls ${element.scrollWidth - element.clientWidth}px`);
  return { overflow, offenders, scrollers };
});
