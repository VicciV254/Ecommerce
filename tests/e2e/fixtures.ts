import { expect, test as base, type Page, type Route } from "@playwright/test";
import type { User } from "../../src/api/auth";
import type { CatalogProduct, CatalogSnapshot, CatalogStock, StorefrontDraft } from "../../src/api/catalog";
import {
  fixtureProduct,
  fixtureSnapshot,
  fixtureStorefront,
  fixtureStorefrontSettings,
  fixtureVariant,
  linenShirt,
} from "../../src/test-support/catalogFixtures";
import { STORAGE_KEYS, shopperStateKey } from "../../src/utils/storage";
import { E2E_ORIGIN } from "../browser-config";

export const ORIGIN = E2E_ORIGIN;
export const CUSTOMER_TOKEN = "browser-only-customer-token";
export const STAFF_TOKEN = "browser-only-staff-token";

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

export const staff = { id: "browser-admin", email: "admin@example.test", username: "Browser staff", role: "ADMIN" };

export const order = {
  id: "browser-order", orderNumber: "TEST-ORDER-1", user: customer,
  status: "PENDING", paymentStatus: "PENDING", paymentMethod: "MPESA", deliveryMethod: "STANDARD",
  subtotal: 1000, discount: 0, tax: 0, shippingCost: 0, total: 1000, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  address: customer.addresses![0],
  items: [{ id: "browser-item", productId: linenShirt.id, variantId: "var-linen-m-white", productName: "Linen Short-Sleeve Shirt", productPrice: 1000, quantity: 1, subtotal: 1000 }],
};

/** Public catalog: a demo-mode snapshot served exactly as the API contract describes. */
export const publicSnapshot: CatalogSnapshot = fixtureSnapshot();

/** Staff snapshot additionally includes hidden records. */
export const hiddenProduct: CatalogProduct = fixtureProduct({
  id: "prod-hidden-draft", name: "Hidden Draft Jacket", isActive: false,
  variants: [fixtureVariant({ id: "var-hidden", stock: 0 })],
});
export const adminSnapshot: CatalogSnapshot = { ...publicSnapshot, mode: "admin", products: [...publicSnapshot.products, hiddenProduct] };

export const adminStocks: CatalogStock[] = adminSnapshot.products.flatMap((product) => product.variants.map((variant) => ({
  id: `stock-${variant.id}`, variantId: variant.id, sku: variant.sku, attributes: variant.attributes,
  productId: product.id, productName: product.name, categoryId: product.categoryId, isDemo: product.isDemo,
  quantity: variant.stock, maxStock: variant.maxStock, minThreshold: variant.minThreshold,
  status: variant.stock === 0 ? "OUT_OF_STOCK" : variant.stock <= variant.minThreshold ? "LOW_STOCK" : "IN_STOCK",
})));

export const publishedStorefront = fixtureStorefront();
export const storefrontDraft: StorefrontDraft = {
  version: 5, publishedVersion: 3, publishedAt: publishedStorefront.publishedAt, settings: fixtureStorefrontSettings(),
  media: [], unavailableMediaIds: [],
};

const RETIRED = new Set(["/api/settings/admin-data", "/api/settings/theme", "/api/admin/orders/import-local", "/api/admin/init"]);

async function respond(route: Route, url: URL) {
  const request = route.request();
  const authorization = request.headers().authorization;
  const staffRequest = url.pathname.startsWith("/api/admin/") || url.pathname === "/api/settings/storefront/draft";
  if (RETIRED.has(url.pathname)) return route.fulfill({ status: 410, json: { error: "Retired in this browser test" } });
  if (staffRequest && authorization !== `Bearer ${STAFF_TOKEN}`) return route.fulfill({ status: 401, json: { error: "Invalid token" } });
  if (request.method() !== "GET") return route.fulfill({ status: 503, json: { error: "No live API is available in this browser test" } });

  if (url.pathname === "/api/catalog") return route.fulfill({ json: publicSnapshot });
  if (url.pathname === "/api/settings/storefront") return route.fulfill({ json: publishedStorefront });
  if (url.pathname === "/api/settings/storefront/draft") return route.fulfill({ json: storefrontDraft });
  if (url.pathname === "/api/admin/catalog") return route.fulfill({ json: adminSnapshot });
  if (url.pathname === "/api/admin/stock") return route.fulfill({ json: { stocks: adminStocks } });
  if (url.pathname === "/api/admin/analytics/dashboard") {
    return route.fulfill({ json: { sales: { total: 0 }, orders: { total: 0, pending: 0, processing: 0, cancelled: 0, returned: 0 }, refunds: { total: 0 }, recentOrders: [] } });
  }
  const productId = /^\/api\/products\/([^/]+)$/.exec(url.pathname)?.[1];
  if (productId) {
    const product = publicSnapshot.products.find((item) => item.id === decodeURIComponent(productId));
    return product ? route.fulfill({ json: { ...product, reviewList: [] } }) : route.fulfill({ status: 404, json: { error: "Product not found" } });
  }
  if (url.pathname === "/api/auth/me") {
    return authorization === `Bearer ${CUSTOMER_TOKEN}`
      ? route.fulfill({ json: customer })
      : route.fulfill({ status: 401, json: { error: "Invalid token" } });
  }
  return route.fulfill({ status: 503, json: { error: "No live API is available in this browser test" } });
}

export const test = base.extend({
  page: async ({ page, context }, provide) => {
    const errors: string[] = [];
    const watch = (current: Page) => current.on("pageerror", (error) => errors.push(error.message));
    watch(page);
    context.on("page", watch);
    // Context-wide, so new tabs are isolated too; nothing reaches a live store or media host.
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === ORIGIN) {
        if (url.pathname.startsWith("/api/")) return respond(route, url);
        return route.continue();
      }
      if (request.resourceType() === "image") {
        return route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#eee"/></svg>',
        });
      }
      return route.fulfill({ contentType: "text/plain", body: "" });
    });
    await provide(page);
    expect(errors, "Uncaught browser errors, including newly opened tabs").toEqual([]);
  },
});

export { expect };

export type CartLine = { productId: string; variantId: string; quantity: number };
export const linenCartLine: CartLine = { productId: linenShirt.id, variantId: "var-linen-m-white", quantity: 1 };

export async function signInCustomer(page: Page, cart: CartLine[] = []) {
  await page.context().addInitScript(({ user, lines, keys, shopperKey, token, origin }) => {
    // Init scripts also run in blank new tabs, whose opaque origin has no storage.
    if (location.origin !== origin) return;
    localStorage.setItem(keys.customerUser, JSON.stringify(user));
    localStorage.setItem(keys.customerToken, token);
    localStorage.setItem(keys.customerRefreshToken, "browser-only-refresh-token");
    if (!localStorage.getItem(shopperKey)) localStorage.setItem(shopperKey, JSON.stringify({ cart: lines, wishlist: [] }));
  }, { user: customer, lines: cart, keys: STORAGE_KEYS, shopperKey: shopperStateKey(customer.id), token: CUSTOMER_TOKEN, origin: ORIGIN });
}

export async function signInStaff(page: Page) {
  await page.context().addInitScript(({ admin, keys, token, origin }) => {
    if (location.origin !== origin) return;
    localStorage.setItem(keys.adminToken, token);
    localStorage.setItem(keys.adminRefreshToken, "browser-only-staff-refresh");
    localStorage.setItem(keys.adminUser, JSON.stringify(admin));
  }, { admin: staff, keys: STORAGE_KEYS, token: STAFF_TOKEN, origin: ORIGIN });
}

export function shopperState(page: Page): Promise<{ cart: CartLine[]; wishlist: string[] }> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), shopperStateKey(customer.id));
}
