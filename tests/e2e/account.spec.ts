import type { BrowserContext, Locator, Page } from "@playwright/test";
import type { User } from "../../src/api/auth";
import type { CustomerOrder, OrderTracking } from "../../src/api/orders";
import { linenShirt } from "../../src/test-support/catalogFixtures";
import { fixturePendingOrder } from "../../src/test-support/checkoutFixtures";
import { fixtureCustomerOrder, fixtureDeliveredOrder, fixtureReturn } from "../../src/test-support/orderFixtures";
import { PAYABLE, fixturePaymentOverview } from "../../src/test-support/paymentFixtures";
import { shopperStateKey } from "../../src/utils/storage";
import {
  ORIGIN,
  browserQuote,
  clippedWithin,
  expect,
  expectWholeFocusRing,
  linenCartLine,
  order,
  orderPage,
  pageOverflow,
  servePaymentOverview,
  serveSignIn,
  signInCustomer,
  signInWithForm,
  test,
} from "./fixtures";

/*
 * The account area, tracking, returns and the sign-up return (P7.4). Every API is mocked.
 */

const REQUEST_KEY = /^[A-Za-z0-9:_-]{16,128}$/;
const NEW_TOKEN = "browser-only-new-shopper-token";
const newShopper: User = {
  id: "browser-new-shopper", email: "new.shopper@example.test", firstName: "Nia", lastName: "Shopper", emailVerified: false, addresses: [],
};

/** Seeds the guest cart once per test (not again on a reload). */
async function seedGuestCart(page: Page) {
  await page.context().addInitScript(({ key, line, origin }) => {
    if (location.origin !== origin || localStorage.getItem("test:guest-seeded")) return;
    localStorage.setItem("test:guest-seeded", "1");
    localStorage.setItem(key, JSON.stringify({ cart: [line], wishlist: [] }));
  }, { key: shopperStateKey(null), line: linenCartLine, origin: ORIGIN });
}

/** Registration that needs email verification, the OTP check, then sign-in for the verified account. */
async function serveSignUp(context: BrowserContext) {
  const registered: unknown[] = [];
  const verified: unknown[] = [];
  await context.route("**/api/auth/register", (route) => {
    registered.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: { user: newShopper, token: "", refreshToken: "", verificationEmailSent: true } });
  });
  await context.route("**/api/auth/verify-otp", (route) => {
    verified.push(route.request().postDataJSON());
    return route.fulfill({ json: { message: "Email verified" } });
  });
  await serveSignIn(context, [{ user: { ...newShopper, emailVerified: true }, token: NEW_TOKEN }]);
  return { registered, verified };
}

/** The route after the hash, split into its path and query values. */
const currentRoute = (page: Page) => page.evaluate(() => {
  const [path, query = ""] = location.hash.slice(1).split("?");
  return { path, params: Object.fromEntries(new URLSearchParams(query)) };
});

async function register(page: Page) {
  const main = page.getByRole("main");
  await main.getByLabel("First name").fill(newShopper.firstName);
  await main.getByLabel("Last name").fill(newShopper.lastName);
  await main.getByLabel("Email address").fill(newShopper.email);
  await main.getByLabel("Password", { exact: true }).fill("browser-only-password");
  await main.getByRole("button", { name: "Create account" }).click();
}

async function enterCode(page: Page) {
  const main = page.getByRole("main");
  for (const [index, digit] of [..."123456"].entries()) await main.getByLabel(`Digit ${index + 1} of 6`).fill(digit);
  await main.getByRole("button", { name: "Verify code" }).click();
}

test("creating an account from checkout verifies the email, signs in and returns to checkout with the cart", async ({ page, context }) => {
  await seedGuestCart(page);
  const { registered, verified } = await serveSignUp(context);

  await page.goto("/#/checkout");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to check out" })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Create an account" }).click();
  expect(await currentRoute(page)).toEqual({ path: "/register", params: { returnTo: "/checkout" } });
  await expect(page.getByRole("main").getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "#/login?returnTo=%2Fcheckout");
  await register(page);

  await expect(page.getByRole("heading", { level: 1, name: "Verify your email" })).toBeVisible();
  expect(await currentRoute(page)).toEqual({ path: "/verify-email", params: { email: newShopper.email, returnTo: "/checkout" } });
  expect(registered).toEqual([expect.objectContaining({ email: newShopper.email, firstName: newShopper.firstName })]);
  await enterCode(page);

  await expect(page.getByText("Email verified. Sign in to continue.")).toBeVisible();
  expect(await currentRoute(page)).toEqual({ path: "/login", params: { verified: "1", email: newShopper.email, returnTo: "/checkout" } });
  expect(verified).toEqual([{ email: newShopper.email, code: "123456" }]);
  await expect(page.getByRole("main").getByLabel("Email address")).toHaveValue(newShopper.email);
  await page.getByRole("main").getByLabel("Password", { exact: true }).fill("browser-only-password");
  await page.getByRole("main").getByRole("button", { name: "Sign in", exact: true }).click();

  // Back where the shopper was going, signed in, with the guest cart joined to the new account.
  await expect(page).toHaveURL(/#\/checkout$/);
  await expect(page.getByRole("main").getByRole("heading", { level: 2, name: "Delivery", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Your guest cart" })).toContainText(`${linenShirt.name} (Size: M · Color: White): 1 added`);
  await expect(page.getByRole("main").getByRole("textbox", { name: "Street address" })).toBeVisible();
});

test("a hostile return address is dropped at every step of sign-up and sign-in ends at home", async ({ page, context }) => {
  await serveSignUp(context);
  await page.goto("/#/register?returnTo=%2F%2Fevil.example%2Fcheckout");
  await expect(page.getByRole("main").getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "#/login");
  await register(page);
  await expect(page.getByRole("heading", { level: 1, name: "Verify your email" })).toBeVisible();
  expect(await currentRoute(page)).toEqual({ path: "/verify-email", params: { email: newShopper.email } });

  // A verification link edited by hand is checked again before anything is passed on.
  await page.goto(`/#/verify-email?email=${encodeURIComponent(newShopper.email)}&returnTo=https%3A%2F%2Fevil.example`);
  await expect(page.getByRole("main").getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "#/login");
  await enterCode(page);
  await expect(page.getByText("Email verified. Sign in to continue.")).toBeVisible();
  expect(await currentRoute(page)).toEqual({ path: "/login", params: { verified: "1", email: newShopper.email } });

  // So is the sign-in link: a staff page is not a place sign-in returns to.
  await page.goto(`/#/login?verified=1&email=${encodeURIComponent(newShopper.email)}&returnTo=%2Fadmin`);
  await signInWithForm(page, { ...newShopper, emailVerified: true });
  await expect(page).toHaveURL(new RegExp(`^${ORIGIN}/#/$`));
});

test("the account navigation is a compact row of tabs on phones and a 224px column from 1280px", async ({ page, isMobile }) => {
  await signInCustomer(page);
  await page.goto("/#/account/profile");
  const nav = page.getByRole("navigation", { name: "Account" });
  const tabs = nav.getByRole("link");
  await expect(tabs).toHaveText(["Profile", "Orders", "Addresses"]);
  await expect(nav.getByRole("link", { name: "Profile" })).toHaveAttribute("aria-current", "page");
  for (const tab of await tabs.all()) expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const navBox = (await nav.boundingBox())!;
  const heading = page.getByRole("heading", { level: 1, name: "Profile" });
  const headingBox = (await heading.boundingBox())!;
  if (isMobile) {
    // One row of tabs above the page, not a stacked sidebar.
    const rows = new Set(await tabs.evaluateAll((links) => links.map((link) => Math.round(link.getBoundingClientRect().top))));
    expect(rows.size).toBe(1);
    expect(navBox.y + navBox.height).toBeLessThanOrEqual(headingBox.y);
    expect(navBox.height).toBeLessThanOrEqual(120);
  } else {
    expect(Math.round(navBox.width)).toBe(224);
    expect(headingBox.x).toBeGreaterThanOrEqual(navBox.x + navBox.width);
  }

  await nav.getByRole("link", { name: "Orders" }).click();
  await expect(page).toHaveURL(/#\/account\/orders$/);
  await expect(page.getByRole("heading", { level: 1, name: "Orders and receipts" })).toBeFocused();
  await expect(nav.getByRole("link", { name: "Orders" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Profile" })).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await nav.getByRole("link", { name: "Addresses" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Addresses" })).toBeFocused();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
});

/** Public tracking for one order, newest step first, each with the time the server recorded it. */
const shippedTracking: OrderTracking = {
  orderNumber: "APX-TRACK-1", status: "SHIPPED",
  trackingHistory: [
    { id: "event-3", status: "SHIPPED", description: "Shipped", location: null, createdAt: "2026-11-14T09:30:00.000Z", actorType: null },
    { id: "event-2", status: "PROCESSING", description: "Processing", location: null, createdAt: "2026-11-13T08:00:00.000Z", actorType: null },
    { id: "event-1", status: "PENDING", description: "Order placed", location: null, createdAt: "2026-11-12T07:15:00.000Z", actorType: null },
  ],
};

async function serveTracking(context: BrowserContext, known: OrderTracking[]) {
  const asked: string[] = [];
  await context.route("**/api/orders/track/*", (route) => {
    const number = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() ?? "");
    asked.push(number);
    const found = known.find((item) => item.orderNumber === number);
    return found ? route.fulfill({ json: found }) : route.fulfill({ status: 404, json: { error: "Order not found" } });
  });
  return asked;
}

test("a guest looks up an order and sees only the recorded steps, or a clear not-found", async ({ page, context }) => {
  const asked = await serveTracking(context, [shippedTracking]);
  await page.goto("/#/track");
  await expect(page.getByRole("heading", { level: 1, name: "Track your order" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your active orders" })).toHaveCount(0);
  const field = page.getByRole("textbox", { name: "Order number" });
  await field.fill("APX-NOPE");
  await page.getByRole("button", { name: "Track order" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Order not found" })).toBeFocused();

  await field.fill("APX-TRACK-1");
  await field.press("Enter");
  const result = page.getByRole("region", { name: "Order APX-TRACK-1" });
  await expect(result.getByRole("heading", { level: 2 })).toBeFocused();
  await expect(result.getByText("Shipped", { exact: true }).first()).toBeVisible();
  const steps = result.getByRole("list", { name: "Tracking history" }).getByRole("listitem");
  await expect(steps).toHaveCount(3);
  expect(await steps.locator("time").evaluateAll((times) => times.map((time) => time.getAttribute("datetime"))))
    .toEqual(shippedTracking.trackingHistory.map((event) => event.createdAt));
  expect(asked).toEqual(["APX-NOPE", "APX-TRACK-1"]);
});

test("a signed-in shopper's active orders are tracked from the list and open their details in the account", async ({ page, context }) => {
  await signInCustomer(page);
  const shipped: CustomerOrder = fixtureCustomerOrder(fixturePendingOrder(browserQuote({ id: "quote-track" })), {
    orderNumber: "APX-TRACK-1", status: "SHIPPED", paymentStatus: "PAID", reservationStatus: "COMMITTED", reservationExpiresAt: null, customerActions: [],
  });
  const delivered = fixtureDeliveredOrder(order);
  await context.route("**/api/orders?*", (route) => route.fulfill({ json: orderPage([shipped, delivered]) }));
  await serveTracking(context, [shippedTracking]);
  await page.goto("/#/track");
  const active = page.getByRole("region", { name: "Your active orders" });
  await expect(active.getByRole("listitem")).toHaveCount(1);
  await expect(active.getByText(shipped.orderNumber, { exact: true })).toBeVisible();
  await expect(active.getByText(delivered.orderNumber, { exact: true })).toHaveCount(0);
  await active.getByRole("button", { name: `Track order ${shipped.orderNumber}` }).click();
  await expect(page.getByRole("region", { name: `Order ${shipped.orderNumber}` }).getByRole("heading", { level: 2 })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Order number" })).toHaveValue(shipped.orderNumber);

  await active.getByRole("link", { name: `View details of order ${shipped.orderNumber}` }).click();
  const receipt = page.getByRole("dialog", { name: "Receipt details" });
  await expect(receipt).toBeVisible();
  await expect(receipt.getByText(shipped.orderNumber, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/account\/orders$/);
  await page.keyboard.press("Escape");
  await expect(receipt).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Orders and receipts" })).toBeVisible();
});

test("an order card leads with its summary and next action, and a return is requested from it", async ({ page, context }) => {
  await signInCustomer(page);
  const delivered = fixtureDeliveredOrder(order);
  const requested = fixtureReturn(delivered, { reason: "DAMAGED" });
  const afterReturn: CustomerOrder = { ...delivered, returns: [requested], customerActions: [] };
  let returned = false;
  await context.route("**/api/orders?*", (route) => route.fulfill({ json: orderPage([returned ? afterReturn : delivered]) }));
  const sent: { key?: string; body: unknown }[] = [];
  await context.route(`**/api/orders/${delivered.id}/returns`, (route) => {
    sent.push({ key: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() });
    returned = true;
    return route.fulfill({ status: 201, json: { order: afterReturn, returnRequest: requested } });
  });
  await page.goto("/#/account/orders");
  const card = page.getByRole("list", { name: "Your orders" }).getByRole("listitem").filter({ hasText: delivered.orderNumber }).first();
  const next = card.getByRole("button", { name: "Request a return", exact: true });
  // Number, date, total and payment come first, then the next action, then the items.
  const [summaryTop, actionTop, itemsTop] = await Promise.all([
    card.getByText(delivered.orderNumber, { exact: true }).boundingBox(),
    next.boundingBox(),
    card.getByRole("list", { name: `Items in order ${delivered.orderNumber}` }).boundingBox(),
  ]);
  expect(summaryTop!.y).toBeLessThan(actionTop!.y);
  expect(actionTop!.y).toBeLessThan(itemsTop!.y);
  await expect(card.getByText("Payment: M-Pesa (paid)")).toBeVisible();
  expect(await card.getByRole("button").first().textContent()).toBe("Request a return");

  await next.click();
  const dialog = page.getByRole("dialog", { name: "Request a return", exact: true });
  await dialog.getByRole("button", { name: `Return one more ${linenShirt.name}` }).click();
  await dialog.getByRole("combobox", { name: "Reason for return" }).selectOption({ label: "Arrived damaged" });
  await dialog.getByRole("button", { name: "Submit return request" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: `Return ${requested.number} requested.` })).toBeVisible();
  expect(sent).toEqual([{
    key: expect.stringMatching(REQUEST_KEY),
    body: { reason: "DAMAGED", lines: [{ orderItemId: delivered.items[0].id, quantity: 1 }] },
  }]);
  // The server no longer offers a return for this order, so neither does the card.
  await expect(card.getByRole("button", { name: "Request a return", exact: true })).toHaveCount(0);
});

/* ------------------------------------------------------------------ */
/* Layout and focus                                                   */
/* ------------------------------------------------------------------ */

/** The 3px ring sits 2px outside its control, so it needs this much room below the sticky header too. */
const FOCUS_RING_OUTSET = 5;

/** A signed-in customer with an unpaid order to pay, a shipped one to track and a delivered one to return. */
async function serveOrderHistory(page: Page) {
  const context = page.context();
  const payable: CustomerOrder = fixtureCustomerOrder(fixturePendingOrder(browserQuote()));
  const shipped: CustomerOrder = fixtureCustomerOrder(fixturePendingOrder(browserQuote({ id: "quote-track" })), {
    orderNumber: "APX-TRACK-1", status: "SHIPPED", paymentStatus: "PAID", reservationStatus: "COMMITTED", reservationExpiresAt: null, customerActions: [],
  });
  const delivered = fixtureDeliveredOrder(order);
  await context.route("**/api/orders?*", (route) => route.fulfill({ json: orderPage([payable, shipped, delivered]) }));
  await servePaymentOverview(context, payable, fixturePaymentOverview(payable, PAYABLE));
  await serveTracking(context, [shippedTracking]);
  return { payable, shipped, delivered };
}

type Surface = { name: string; open: () => Promise<void>; scope: () => Locator };

function accountSurfaces(page: Page, orders: Awaited<ReturnType<typeof serveOrderHistory>>): Surface[] {
  const main = () => page.getByRole("main");
  // The sign-in screens' content panel (the brand band above it is the approved P7.1 lockup, whose trailing letter
  // spacing is deliberately outside its box).
  const authPanel = () => main().getByRole("heading", { level: 1 }).locator("..");
  const receipt = () => page.getByRole("dialog", { name: "Receipt details" });
  const returnForm = () => page.getByRole("dialog", { name: "Request a return", exact: true });
  return [
    { name: "order cards", scope: main, open: async () => {
      await page.goto("/#/account/orders");
      await expect(main().getByText(orders.delivered.orderNumber, { exact: true })).toBeVisible();
    } },
    { name: "receipt details", scope: receipt, open: async () => {
      await page.goto("/#/account/orders");
      await main().getByRole("listitem").filter({ hasText: orders.payable.orderNumber }).getByRole("button", { name: /^Pay now/ }).click();
      await expect(receipt().getByRole("button", { name: "Send M-Pesa prompt" })).toBeVisible();
    } },
    { name: "return request", scope: returnForm, open: async () => {
      await page.goto("/#/account/orders");
      await main().getByRole("listitem").filter({ hasText: orders.delivered.orderNumber }).getByRole("button", { name: "Request a return", exact: true }).click();
      await expect(returnForm().getByRole("combobox", { name: "Reason for return" })).toBeVisible();
    } },
    { name: "profile", scope: main, open: async () => {
      await page.goto("/#/account/profile");
      await expect(main().getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
    } },
    { name: "addresses with the form open", scope: main, open: async () => {
      await page.goto("/#/account/addresses");
      await main().getByRole("button", { name: "Add a new address" }).click();
      await expect(main().getByRole("textbox", { name: "Street address" })).toBeVisible();
    } },
    { name: "tracking result and active orders", scope: main, open: async () => {
      await page.goto(`/#/track?order=${orders.shipped.orderNumber}`);
      await expect(main().getByRole("heading", { level: 2, name: `Order ${orders.shipped.orderNumber}` })).toBeVisible();
      await expect(main().getByRole("region", { name: "Your active orders" }).getByRole("listitem").first()).toBeVisible();
    } },
    { name: "registration", scope: authPanel, open: async () => {
      await page.goto("/#/register?returnTo=%2Fcheckout");
      await expect(main().getByRole("heading", { level: 1, name: "Create your account" })).toBeVisible();
    } },
    { name: "email verification", scope: authPanel, open: async () => {
      await page.goto(`/#/verify-email?email=${encodeURIComponent("a.rather.long.address+checkout@example.test")}&returnTo=%2Fcheckout`);
      await expect(main().getByRole("heading", { level: 1, name: "Verify your email" })).toBeVisible();
    } },
    { name: "verified sign-in", scope: authPanel, open: async () => {
      await page.goto(`/#/login?verified=1&email=${encodeURIComponent("a.rather.long.address+checkout@example.test")}&returnTo=%2Fcheckout`);
      await expect(main().getByText("Email verified. Sign in to continue.")).toBeVisible();
    } },
  ];
}

test("the account, tracking, return and sign-up screens reflow with doubled text, with no page-level overflow", async ({ page, isMobile }) => {
  test.setTimeout(150_000);
  await signInCustomer(page);
  const orders = await serveOrderHistory(page);
  const widths = isMobile ? [360, 430, 768] : [1024, 1280, 1440];
  for (const surface of accountSurfaces(page, orders)) {
    await page.setViewportSize({ width: widths[0], height: 900 });
    await page.goto("/#/");
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    await surface.open();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      for (const size of ["100%", "200%"]) {
        await page.evaluate((value) => { document.documentElement.style.fontSize = value; }, size);
        const label = `${surface.name} at ${width}px, ${size} text`;
        expect(await pageOverflow(page), `${label}: page overflow`).toBeLessThanOrEqual(0);
        expect(await clippedWithin(surface.scope()), `${label}: clipped content`).toEqual([]);
      }
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    await page.keyboard.press("Escape");
  }
});

test("the receipt's close control stays one 44px target beside its heading, also with doubled text at 360px", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Checked at phone widths.");
  await signInCustomer(page);
  const orders = await serveOrderHistory(page);
  await page.setViewportSize({ width: 360, height: 900 });
  const receipt = accountSurfaces(page, orders).find((surface) => surface.name === "receipt details")!;
  await receipt.open();
  const dialog = receipt.scope();
  const close = dialog.getByRole("button", { name: "Close", exact: true });
  const heading = dialog.getByRole("heading", { name: "Receipt details" });
  for (const size of ["100%", "200%"]) {
    await page.evaluate((value) => { document.documentElement.style.fontSize = value; }, size);
    const [button, title] = [(await close.boundingBox())!, (await heading.boundingBox())!];
    expect([Math.round(button.width), Math.round(button.height)], `${size} text`).toEqual([44, 44]);
    expect(button.y, `${size} text: beside the heading`).toBeLessThan(title.y + title.height);
    expect(await close.evaluate((element) => element.textContent?.trim()), `${size} text: no words to break`).toBe("");
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  await close.click();
  await expect(dialog).toHaveCount(0);
});

/** Tabs `presses` times: each control shows its whole ring and, outside the header, sits wholly below the sticky chrome. */
async function tabClearOfStickyChrome(page: Page, presses: number) {
  const visited: string[] = [];
  for (let press = 0; press < presses; press += 1) {
    await page.keyboard.press("Tab");
    const name = await expectWholeFocusRing(page);
    visited.push(name);
    const place = await page.evaluate(() => {
      const control = document.activeElement as HTMLElement;
      const chrome = Math.max(0, ...[...document.querySelectorAll("[data-sticky-header]")].map((element) => element.getBoundingClientRect().bottom));
      return {
        top: control.getBoundingClientRect().top, chrome,
        // A modal dialog covers the header, so only page content is measured against it.
        exempt: control.closest("[data-sticky-header], dialog") !== null,
      };
    });
    if (!place.exempt) expect(place.top - FOCUS_RING_OUTSET, `${name}: px of ring below the sticky header`).toBeGreaterThanOrEqual(place.chrome - 0.5);
  }
  return visited;
}

test("focus rings in the account, tracking and return screens are whole and never hidden under the sticky header", async ({ page }) => {
  test.setTimeout(150_000);
  await signInCustomer(page);
  const orders = await serveOrderHistory(page);
  const surfaces = accountSurfaces(page, orders);
  const visit = async (name: string, from: () => Locator, presses: number, expected: string[]) => {
    const surface = surfaces.find((item) => item.name === name)!;
    await page.goto("/#/");
    await surface.open();
    await from().focus();
    const visited = await tabClearOfStickyChrome(page, presses);
    expect(visited, name).toEqual(expect.arrayContaining(expected));
  };
  const main = () => page.getByRole("main");
  await visit("order cards", () => main().getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Home" }), 16,
    ["Profile", "Orders", "Addresses", "Sign out", "Track an order", "Details", "Request a return"]);
  await visit("return request", () => page.getByRole("dialog", { name: "Request a return", exact: true }).getByRole("button", { name: "Close" }), 9,
    ["Reason for return", "Comment (optional)", "Submit return request"]);
  await visit("addresses with the form open", () => main().getByRole("heading", { level: 1 }), 8, ["Street address", "County", "Save address", "Cancel"]);
  await visit("tracking result and active orders", () => main().getByRole("heading", { level: 1 }), 7,
    ["Order number", "Track order", "Copy number", "View details of order APX-TRACK-1"]);
});
