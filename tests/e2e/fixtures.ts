import { expect, test as base, type Page } from "@playwright/test";
import type { User } from "../../src/api/auth";

export const customer: User = {
  id: "browser-customer",
  firstName: "Browser",
  lastName: "Customer",
  email: "browser@example.test",
  phone: "0700000000",
  emailVerified: true,
  addresses: [{
    id: "browser-address", street: "Test street", city: "Mombasa", county: "Mombasa", isDefault: true,
  }],
};

export const order = {
  id: "browser-order", orderNumber: "TEST-ORDER-1", user: customer,
  status: "PENDING", paymentStatus: "PENDING", paymentMethod: "MPESA", deliveryMethod: "STANDARD",
  subtotal: 1000, tax: 0, shippingCost: 0, total: 1000, createdAt: "2026-01-01T00:00:00Z",
  address: customer.addresses![0],
  items: [{ id: "browser-item", productId: "mens-fashion-1", productName: "Test product", productPrice: 1000, quantity: 1, subtotal: 1000 }],
};

export const test = base.extend({
  page: async ({ page, context }, provide) => {
    const errors: string[] = [];
    const watch = (current: Page) => current.on("pageerror", (error) => errors.push(error.message));
    watch(page);
    context.on("page", watch);
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === "http://127.0.0.1:4173") {
        if (request.method() === "GET") {
          if (url.pathname === "/api/settings/admin-data" || url.pathname === "/api/settings/theme") {
            await route.fulfill({ json: null });
            return;
          }
          if (url.pathname === "/api/auth/me") {
            await route.fulfill({ json: customer });
            return;
          }
          if (url.pathname === "/api/admin/analytics/dashboard") {
            await route.fulfill({ json: { sales: { total: 0 }, orders: { total: 0 }, refunds: { total: 0 }, recentOrders: [] } });
            return;
          }
        }
        if (url.pathname.startsWith("/api/")) {
          await route.fulfill({ status: 503, json: { error: "No live API is available in this browser test" } });
          return;
        }
        await route.continue();
        return;
      }
      if (request.resourceType() === "image") {
        await route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#eee"/></svg>',
        });
        return;
      }
      await route.fulfill({ contentType: "text/plain", body: "" });
    });
    await provide(page);
    expect(errors, "Uncaught browser errors, including newly opened tabs").toEqual([]);
  },
});

export { expect };

export async function signInCustomer(page: Page, withCart = false) {
  await page.context().addInitScript(({ user, cart }) => {
    localStorage.setItem("user", JSON.stringify(user));
    localStorage.setItem("token", "browser-only-customer-token");
    localStorage.setItem("refreshToken", "browser-only-refresh-token");
    localStorage.setItem(`nmb-store:${user.id}`, JSON.stringify({
      cart: cart ? [{ productId: "mens-fashion-1", qty: 1 }] : [],
      wishlist: [],
    }));
  }, { user: customer, cart: withCart });
}
