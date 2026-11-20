import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test as base, type BrowserContext, type Locator, type Page, type Route } from "@playwright/test";
import type { User } from "../../src/api/auth";
import type { StaffOrder } from "../../src/api/admin";
import type { AdminCatalogSnapshot, CatalogProduct, CatalogSnapshot, CatalogStock, StorefrontDraft } from "../../src/api/catalog";
import type { PaymentOverview } from "../../src/api/mpesa";
import type { CustomerOrder, Order, Quote } from "../../src/api/orders";
import {
  fixtureAdminSnapshot,
  fixtureProduct,
  fixtureSnapshot,
  fixtureStorefront,
  fixtureStorefrontSettings,
  fixtureVariant,
  linenShirt,
} from "../../src/test-support/catalogFixtures";
import { fixtureQuote } from "../../src/test-support/checkoutFixtures";
import { fixtureCustomerOrder } from "../../src/test-support/orderFixtures";
import { NOTHING_WAITING, fixtureDashboard } from "../../src/test-support/overviewFixtures";
import { fixturePaymentOverview } from "../../src/test-support/paymentFixtures";
import { nairobiDate } from "../../src/utils/nairobiDate";
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

/** A second shopper account on the same browser, for account-switch checks. */
export const otherCustomer: User = {
  id: "browser-customer-2",
  firstName: "Other",
  lastName: "Shopper",
  email: "other@example.test",
  emailVerified: true,
  addresses: [],
};
export const OTHER_CUSTOMER_TOKEN = "browser-only-other-customer-token";

/**
 * Lets the sign-in form succeed for these accounts (any password): `POST /auth/login` returns a session and
 * `GET /auth/me` answers for its token. Signing out (`POST /auth/logout`) is acknowledged.
 */
export async function serveSignIn(
  context: BrowserContext,
  accounts: { user: User; token: string }[] = [{ user: customer, token: CUSTOMER_TOKEN }, { user: otherCustomer, token: OTHER_CUSTOMER_TOKEN }],
) {
  await context.route("**/api/auth/login", (route) => {
    const { email } = route.request().postDataJSON() as { email: string };
    const account = accounts.find((item) => item.user.email === email);
    return account
      ? route.fulfill({ json: { user: account.user, token: account.token, refreshToken: `refresh-${account.token}` } })
      : route.fulfill({ status: 401, json: { error: "Invalid email or password" } });
  });
  await context.route("**/api/auth/me", (route) => {
    const account = accounts.find((item) => route.request().headers().authorization === `Bearer ${item.token}`);
    return account ? route.fulfill({ json: account.user }) : route.fallback();
  });
  await context.route("**/api/auth/logout", (route) => route.fulfill({ json: { message: "Signed out" } }));
}

/** Signs in through the sign-in form, as a shopper would. */
export async function signInWithForm(page: Page, user: User = customer) {
  const form = page.getByRole("main");
  await form.getByLabel("Email address").fill(user.email);
  await form.getByLabel("Password", { exact: true }).fill("browser-only-password");
  await form.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** An unpaid legacy order as the customer order view reports it: it can still be cancelled. */
export const order: CustomerOrder = fixtureCustomerOrder({
  id: "browser-order", orderNumber: "TEST-ORDER-1",
  status: "PENDING", paymentStatus: "PENDING", paymentMethod: "MPESA", deliveryMethod: "STANDARD",
  subtotal: 1000, discount: 0, tax: 0, shippingCost: 0, total: 1000, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  address: customer.addresses![0],
  items: [{ id: "browser-item", productId: linenShirt.id, variantId: "var-linen-m-white", productName: "Linen Short-Sleeve Shirt", productPrice: 1000, quantity: 1, subtotal: 1000 }],
});

const browserAddress = customer.addresses![0];

/**
 * A server quote for the signed-in browser customer's saved address. Amounts are the explicit fixture
 * values (see `checkoutFixtures`); browser tests never price anything themselves.
 */
export function browserQuote(overrides: Partial<Quote> = {}): Quote {
  return fixtureQuote({
    address: { id: browserAddress.id, street: browserAddress.street, city: browserAddress.city, county: browserAddress.county, postalCode: null },
    ...overrides,
  });
}

/** Public catalog: a demo-mode snapshot served exactly as the API contract describes. */
export const publicSnapshot: CatalogSnapshot = fixtureSnapshot();

/** Staff snapshot additionally includes hidden records. */
export const hiddenProduct: CatalogProduct = fixtureProduct({
  id: "prod-hidden-draft", name: "Hidden Draft Jacket", isActive: false,
  variants: [fixtureVariant({ id: "var-hidden", stock: 0 })],
});
export const adminSnapshot: AdminCatalogSnapshot = fixtureAdminSnapshot({ products: [...publicSnapshot.products, hiddenProduct] });

export const adminStocks: CatalogStock[] = adminSnapshot.products.flatMap((product) => product.variants.map((variant) => ({
  id: `stock-${variant.id}`, variantId: variant.id, sku: variant.sku, attributes: variant.attributes,
  productId: product.id, productName: product.name, categoryId: product.categoryId, isDemo: product.isDemo,
  quantity: variant.onHand, reserved: variant.reserved, available: variant.stock,
  maxStock: variant.maxStock, minThreshold: variant.minThreshold,
  status: variant.stock === 0 ? "OUT_OF_STOCK" : variant.stock <= variant.minThreshold ? "LOW_STOCK" : "IN_STOCK",
})));

export const publishedStorefront = fixtureStorefront();
export const storefrontDraft: StorefrontDraft = {
  version: 5, publishedVersion: 3, publishedAt: publishedStorefront.publishedAt, publishedBy: staff.username, settings: fixtureStorefrontSettings(),
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
    // A quiet store: nothing sold or waiting in any period.
    return route.fulfill({ json: fixtureDashboard(url.searchParams.get("period") ?? "month", {
      figures: { netSales: 0, paidOrders: 0, ordersPlaced: 0, cancelledOrders: 0, refunds: { count: 0, amount: 0 } },
      current: NOTHING_WAITING, recentOrders: [],
    }) });
  }
  if (url.pathname === "/api/admin/attention") return route.fulfill({ json: { items: [] } });
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
  // The payment service knows only the orders a test serves with `servePaymentOverview`.
  if (url.pathname.startsWith("/api/mpesa/")) return route.fulfill({ status: 404, json: { error: "Order not found.", code: "ORDER_NOT_FOUND" } });
  return route.fulfill({ status: 503, json: { error: "No live API is available in this browser test" } });
}

/**
 * The site's own fonts (Jost and Marcellus; SIL Open Font License, see brand-fonts/OFL.txt), served in place of Google
 * Fonts so text is laid out and measured as shoppers see it: the fallback fonts are narrower and hide overflow.
 */
const BRAND_FONTS = fileURLToPath(new URL("./brand-fonts/", import.meta.url));

function serveBrandFonts(route: Route, url: URL) {
  // Fonts are fetched cross-origin, so they need the CORS header Google sends.
  const headers = { "access-control-allow-origin": "*" };
  if (url.host === "fonts.googleapis.com") {
    return route.fulfill({ headers, contentType: "text/css", body: readFileSync(`${BRAND_FONTS}fonts.css`, "utf8") });
  }
  const file = resolve(BRAND_FONTS, `.${url.pathname}`);
  if (!file.startsWith(BRAND_FONTS.replace(/[\\/]$/, "") + sep) || !existsSync(file)) return route.fulfill({ status: 404, body: "" });
  return route.fulfill({ headers, contentType: "font/woff2", body: readFileSync(file) });
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
      if (url.host === "fonts.googleapis.com" || url.host === "fonts.gstatic.com") return serveBrandFonts(route, url);
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

export async function signInStaff(page: Page, role = staff.role) {
  await page.context().addInitScript(({ admin, keys, token, origin }) => {
    if (location.origin !== origin) return;
    localStorage.setItem(keys.adminToken, token);
    localStorage.setItem(keys.adminRefreshToken, "browser-only-staff-refresh");
    localStorage.setItem(keys.adminUser, JSON.stringify(admin));
  }, { admin: { ...staff, role }, keys: STORAGE_KEYS, token: STAFF_TOKEN, origin: ORIGIN });
}

/**
 * Serves one order's customer payment overview as the API reports it: payments switched off unless the
 * test passes another overview, or a function choosing one per request. Writes fall through to the test.
 */
export async function servePaymentOverview(
  context: BrowserContext, order: Order, overview: PaymentOverview | (() => PaymentOverview) = fixturePaymentOverview(order),
) {
  await context.route(`**/api/mpesa/orders/${encodeURIComponent(order.id)}/payments`, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: typeof overview === "function" ? overview() : overview })
      : route.fallback());
}

/** Requests that could start or settle a payment: anything but a read of the payment API. */
export function watchPaymentWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/mpesa") && request.method() !== "GET") writes.push(`${request.method()} ${pathname}`);
  });
  return writes;
}

/** A customer order-history page, as `GET /orders` returns it. */
export const orderPage = (orders: readonly Order[]) => ({ orders, pagination: { page: 1, limit: 100, total: orders.length, pages: 1 } });

function paginate<T>(items: readonly T[], url: URL) {
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.max(1, Number(url.searchParams.get("limit")) || 20);
  return {
    items: items.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total: items.length, pages: Math.ceil(items.length / limit) },
  };
}

/**
 * Staff order reads as the API serves them: `/orders/admin/all` honours its status, payment and delivery filters, its
 * inclusive Nairobi-day range (`orderedFrom`, `orderedTo`) and pages; returns and refunds lists are derived from the
 * same orders. Writes fall through to the test.
 */
export async function serveStaffOrders(context: BrowserContext, orders: () => readonly StaffOrder[]) {
  await context.route("**/api/orders/admin/**", (route) => {
    const request = route.request();
    if (request.method() !== "GET") return route.fallback();
    if (request.headers().authorization !== `Bearer ${STAFF_TOKEN}`) return route.fulfill({ status: 401, json: { error: "Invalid token" } });
    const url = new URL(request.url());
    const current = orders();
    const path = url.pathname.replace("/api/orders/admin/", "");
    const status = url.searchParams.get("status");
    if (path === "all") {
      const filters = ["status", "paymentStatus", "deliveryMethod"] as const;
      const [from, to] = [url.searchParams.get("orderedFrom"), url.searchParams.get("orderedTo")];
      const placed = (item: StaffOrder) => (!from || nairobiDate(item.createdAt) >= from) && (!to || nairobiDate(item.createdAt) <= to);
      const matched = current.filter((item) => placed(item) && filters.every((key) => !url.searchParams.get(key) || item[key] === url.searchParams.get(key)));
      const { items, pagination } = paginate(matched, url);
      return route.fulfill({ json: { orders: items, pagination } });
    }
    if (path === "returns") {
      const listed = current.flatMap((item) => item.returns.map((entry) => ({ ...entry, orderNumber: item.orderNumber, isDemo: item.isDemo ?? false })));
      const { items, pagination } = paginate(listed.filter((entry) => !status || entry.status === status), url);
      return route.fulfill({ json: { returns: items, pagination } });
    }
    if (path === "refunds") {
      const listed = current.flatMap((item) => item.refunds.map((entry) => ({ ...entry, orderNumber: item.orderNumber, isDemo: item.isDemo ?? false })));
      const { items, pagination } = paginate(listed.filter((entry) => !status || entry.status === status), url);
      return route.fulfill({ json: { refunds: items, pagination } });
    }
    const found = current.find((item) => item.id === decodeURIComponent(path));
    return found ? route.fulfill({ json: found }) : route.fulfill({ status: 404, json: { error: "Order not found", code: "ORDER_NOT_FOUND" } });
  });
}

/** Page-level horizontal overflow in CSS pixels, once the fonts have loaded; 0 or less means nothing scrolls sideways. */
export const pageOverflow = (page: Page) => page.evaluate(async () => {
  await document.fonts.ready;
  return document.documentElement.scrollWidth - document.documentElement.clientWidth;
});

/** Elements inside `scope` whose content is wider than their box once the fonts have loaded, ignoring form fields that
 * scroll their own value, 1px visually hidden text and intentional horizontal scrollers. */
export const clippedWithin = (scope: Locator) => scope.evaluate(async (root) => {
  await document.fonts.ready;
  return [root, ...root.querySelectorAll<HTMLElement>("*")]
    .filter((element) => element instanceof HTMLElement && !element.matches("input, textarea, select") &&
      element.clientWidth > 1 && element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflowX !== "auto")
    .slice(0, 10)
    .map((element) => ({ tag: element.tagName, text: element.textContent?.slice(0, 40), client: element.clientWidth, scroll: element.scrollWidth }));
});

/**
 * The focused control once it has stopped moving: its name, whether it shows the focus ring, and how far the ring (the
 * outline and its gap) reaches past the window or the nearest box that clips it; 0 or less means the whole ring shows.
 */
const focusRing = (page: Page) => page.evaluate(async () => {
  const control = document.activeElement as HTMLElement;
  await new Promise<void>((resolve) => {
    let last = "";
    let still = 0;
    let frames = 0;
    // Focus scrolls a control into view (smoothly, unless reduced motion is set), and under load that scroll can start a
    // few frames late: a control still outside the window has not settled yet. After about a second it is measured
    // where it is, so a control the page never brings into view still fails.
    const inView = () => {
      const box = control.getBoundingClientRect();
      return box.top >= 0 && box.left >= 0 && box.bottom <= window.innerHeight && box.right <= window.innerWidth;
    };
    const settle = () => {
      frames += 1;
      const { top, left } = control.getBoundingClientRect();
      still = `${top},${left}` === last ? still + 1 : 0;
      last = `${top},${left}`;
      if (still >= 2 && (inView() || frames > 60)) resolve();
      else requestAnimationFrame(settle);
    };
    requestAnimationFrame(settle);
  });
  const style = getComputedStyle(control);
  const reach = Number.parseFloat(style.outlineOffset) + Number.parseFloat(style.outlineWidth);
  const box = control.getBoundingClientRect();
  let overhang = Math.max(reach - box.left, reach - box.top, box.right + reach - window.innerWidth, box.bottom + reach - window.innerHeight);
  for (let node = control.parentElement; node; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node);
    if (overflowX === "visible" && overflowY === "visible") continue;
    const clip = node.getBoundingClientRect();
    overhang = Math.max(overhang, clip.left - (box.left - reach), clip.top - (box.top - reach),
      box.right + reach - clip.right, box.bottom + reach - clip.bottom);
  }
  return {
    name: control.getAttribute("aria-label") || (control as HTMLInputElement).labels?.[0]?.textContent?.trim() ||
      control.textContent?.trim() || control.tagName,
    shown: control.matches(":focus-visible") && reach > 0,
    overhang,
  };
});

/** Checks that the focused control shows its whole focus ring; returns the control's name. */
export async function expectWholeFocusRing(page: Page) {
  const ring = await focusRing(page);
  expect(ring.shown, `${ring.name} shows a focus ring`).toBe(true);
  expect(ring.overhang, `${ring.name} focus ring is cut off`).toBeLessThanOrEqual(0);
  return ring.name;
}

/** Moves focus forward `presses` times with Tab, checking each control's focus ring; returns their names. */
export async function tabThroughRings(page: Page, presses: number) {
  const visited: string[] = [];
  for (let press = 0; press < presses; press += 1) {
    await page.keyboard.press("Tab");
    visited.push(await expectWholeFocusRing(page));
  }
  return visited;
}

/**
 * Makes Tab from `from` move focus to `to` with no scrolling at all, as Firefox does for a control it counts as visible
 * and Safari does (ignoring the scroll padding) for a text field partly in view, so the page's own correction is tested.
 */
export async function tabWithoutBrowserScrolling(page: Page, from: Locator, to: Locator) {
  await from.evaluate((element) => element.setAttribute("data-emulated-from", ""));
  await to.evaluate((element) => element.setAttribute("data-emulated-to", ""));
  await page.evaluate(() => document.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || !document.activeElement?.hasAttribute("data-emulated-from")) return;
    event.preventDefault();
    document.querySelector<HTMLElement>("[data-emulated-to]")?.focus({ preventScroll: true });
  }, true));
}

export type StoredShopper = {
  cart: CartLine[];
  wishlist: string[];
  couponCode?: string | null;
  pendingOrder?: { quoteId: string; idempotencyKey: string } | null;
  acknowledgedOrderIds?: string[];
};

export function shopperState(page: Page, owner: string | null = customer.id): Promise<StoredShopper> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), shopperStateKey(owner));
}

/**
 * The lowest WCAG contrast between `text` and the pixels behind its words. The words are hidden while each line's box
 * is captured; the text colour, with its alpha, is then blended over every captured pixel.
 */
export async function backdropContrast(page: Page, text: Locator) {
  await text.scrollIntoViewIfNeeded();
  const { color, lines } = await text.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 1 && rect.height > 1);
    return { color: getComputedStyle(node).color, lines: rects.map(({ x, y, width, height }) => ({ x, y, width, height })) };
  });
  await text.evaluate((node) => (node as HTMLElement).style.setProperty("color", "transparent", "important"));
  const shots: string[] = [];
  for (const clip of lines) shots.push((await page.screenshot({ clip, animations: "disabled" })).toString("base64"));
  await text.evaluate((node) => (node as HTMLElement).style.removeProperty("color"));
  expect(shots.length, "the text has visible lines").toBeGreaterThan(0);
  return page.evaluate(async ({ color, shots }) => {
    const swatch = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true })!;
    swatch.fillStyle = color;
    swatch.fillRect(0, 0, 1, 1);
    const [red, green, blue, opacity] = swatch.getImageData(0, 0, 1, 1).data;
    const alpha = opacity / 255;
    const channel = (value: number) => {
      const unit = value / 255;
      return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (r: number, g: number, b: number) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    let worst = Infinity;
    for (const shot of shots) {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(shot), (char) => char.charCodeAt(0))], { type: "image/png" }));
      const board = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d", { willReadFrequently: true })!;
      board.drawImage(bitmap, 0, 0);
      const { data } = board.getImageData(0, 0, bitmap.width, bitmap.height);
      for (let index = 0; index < data.length; index += 4) {
        const [r, g, b] = [data[index], data[index + 1], data[index + 2]];
        const front = luminance(alpha * red + (1 - alpha) * r, alpha * green + (1 - alpha) * g, alpha * blue + (1 - alpha) * b);
        const back = luminance(r, g, b);
        worst = Math.min(worst, (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05));
      }
    }
    return worst;
  }, { color, shots });
}
