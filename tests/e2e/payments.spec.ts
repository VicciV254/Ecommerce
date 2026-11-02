import type { BrowserContext, Page } from "@playwright/test";
import type { PaymentAttempt } from "../../src/api/mpesa";
import type { Order } from "../../src/api/orders";
import { fixturePendingOrder } from "../../src/test-support/checkoutFixtures";
import {
  PAYABLE,
  PAYMENT_MESSAGES,
  fixtureAttempt,
  fixtureConfirmedAttempt,
  fixturePaymentOverview,
} from "../../src/test-support/paymentFixtures";
import {
  CUSTOMER_TOKEN,
  STAFF_TOKEN,
  browserQuote,
  customer,
  expect,
  linenCartLine,
  servePaymentOverview,
  signInCustomer,
  signInStaff,
  test,
} from "./fixtures";

const REQUEST_KEY = /^[A-Za-z0-9:_-]{16,128}$/;
const placed = fixturePendingOrder(browserQuote());
const paidOrder: Order = { ...placed, paymentStatus: "PAID", reservationStatus: "COMMITTED", reservationExpiresAt: null };
const ordersList = (orders: Order[]) => ({ orders, pagination: { page: 1, limit: 100, total: orders.length, pages: 1 } });
/** Keeps automatic checks out of the way of a test's own clicks. */
const later = () => new Date(Date.now() + 60_000).toISOString();
const withOpenAttempt = (attempt: PaymentAttempt, attempts = [attempt]) =>
  fixturePaymentOverview(placed, { ...PAYABLE, available: false, reasonCode: "PAYMENT_EXISTS", message: PAYMENT_MESSAGES.exists, attempts });

async function reserve(page: Page, context: BrowserContext) {
  await signInCustomer(page, [linenCartLine]);
  await context.route("**/api/orders/quotes", (route) => route.fulfill({ status: 201, json: browserQuote() }));
  await context.route("**/api/orders", (route) =>
    route.request().method() === "POST" ? route.fulfill({ status: 201, json: placed }) : route.fallback());
  await page.goto("/#/checkout");
  await page.getByRole("button", { name: "Reserve Order" }).click();
  await expect(page.getByRole("heading", { name: "Order reserved" })).toBeVisible();
  return page.getByRole("region", { name: "Pay with M-Pesa" });
}

const savedIntents = (page: Page) =>
  page.evaluate(() => Object.keys(localStorage).filter((key) => key.includes(":payment-intent:")));

test("a confirmed prompt asks for the saved total once and shows payment only after the server confirms it", async ({ page, context }) => {
  const pending = fixtureAttempt(placed, { nextCheckAt: later() });
  const paid = fixtureConfirmedAttempt(placed);
  let stage: "unpaid" | "pending" | "paid" = "unpaid";
  await servePaymentOverview(context, placed, () => {
    if (stage === "unpaid") return fixturePaymentOverview(placed, PAYABLE);
    if (stage === "pending") return withOpenAttempt(pending);
    return fixturePaymentOverview(paidOrder, { environment: "production", reasonCode: "ORDER_NOT_PAYABLE", message: "This order is not awaiting payment on an active reservation.", attempts: [paid] });
  });
  const prompts: { key?: string; authorization?: string; body: unknown }[] = [];
  await context.route("**/api/mpesa/stk-push", (route) => {
    const headers = route.request().headers();
    prompts.push({ key: headers["idempotency-key"], authorization: headers.authorization, body: route.request().postDataJSON() });
    stage = "pending";
    return route.fulfill({ status: 201, json: pending });
  });
  await context.route(`**/api/mpesa/payments/${pending.id}/query`, (route) => {
    stage = "paid";
    return route.fulfill({ json: paid });
  });

  const panel = await reserve(page, context);
  await expect(panel.getByText("KES 1,244")).toBeVisible();
  await expect(panel.getByText("Live M-Pesa payment")).toBeVisible();
  await expect(panel.getByText(/Enter your M-Pesa PIN only on your phone/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Order reserved" })).toBeFocused();
  expect(prompts).toEqual([]);

  await panel.getByRole("textbox", { name: "M-Pesa phone number" }).fill("0712 345 678");
  await panel.getByRole("button", { name: "Send M-Pesa prompt" }).click();
  await expect(panel.getByText("Approve the payment on your phone")).toBeVisible();
  await expect(page.getByText("Pending · not paid")).toBeVisible();
  expect(prompts).toEqual([{
    key: expect.stringMatching(REQUEST_KEY), authorization: `Bearer ${CUSTOMER_TOKEN}`, body: { orderId: placed.id, phone: "254712345678" },
  }]);
  expect(await savedIntents(page)).toEqual([]);

  await panel.getByRole("button", { name: "Check payment status" }).click();
  await expect(panel.getByText("Payment confirmed")).toBeVisible();
  await expect(panel.getByText("SBX1234567")).toBeVisible();
  await expect(page.getByText("Payment received", { exact: true })).toBeVisible();
  await expect(page.getByText(/No payment has been taken/)).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /Send|Check payment status/ })).toHaveCount(0);
  expect(prompts).toHaveLength(1);
});

test("a lost prompt response is resumed from order history with the identical request, never a second prompt", async ({ page, context }) => {
  const pending = fixtureAttempt(placed, { nextCheckAt: later() });
  let recorded = false;
  await servePaymentOverview(context, placed, () => (recorded ? withOpenAttempt(pending) : fixturePaymentOverview(placed, PAYABLE)));
  const prompts: { key?: string; body: unknown }[] = [];
  await context.route("**/api/mpesa/stk-push", (route) => {
    prompts.push({ key: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() });
    // The first answer is lost before the server recorded anything.
    if (prompts.length === 1) return route.abort("failed");
    recorded = true;
    return route.fulfill({ status: 201, json: pending });
  });
  await context.route("**/api/orders?*", (route) => route.fulfill({ json: ordersList([placed]) }));

  const panel = await reserve(page, context);
  await panel.getByRole("textbox", { name: "M-Pesa phone number" }).fill("0712 345 678");
  await panel.getByRole("button", { name: "Send M-Pesa prompt" }).click();
  await expect(panel.getByRole("button", { name: "Retry the same request" })).toBeVisible();
  await expect(panel.getByRole("button", { name: /Send/ })).toHaveCount(0);
  expect(await savedIntents(page)).toHaveLength(1);

  await page.goto("/#/account/orders");
  await page.reload();
  await page.getByRole("button", { name: "Details", exact: true }).click();
  const resumed = page.getByRole("dialog", { name: "Receipt Details" }).getByRole("region", { name: "Pay with M-Pesa" });
  const retry = resumed.getByRole("button", { name: "Retry the same request" });
  await expect(retry).toBeVisible();
  expect(prompts).toHaveLength(1);
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(resumed.getByText("Approve the payment on your phone")).toBeVisible();
  expect(prompts).toEqual([
    { key: expect.stringMatching(REQUEST_KEY), body: { orderId: placed.id, phone: "254712345678" } },
    prompts[0],
  ]);
  await expect.poll(() => savedIntents(page)).toEqual([]);
});

test("a sandbox prompt is labelled before confirmation and a failed attempt needs an explicit new prompt", async ({ page, context }) => {
  const failed = fixtureAttempt(placed, { status: "FAILED", environment: "sandbox", message: PAYMENT_MESSAGES.cancelled, canReconcile: false });
  const second = fixtureAttempt(placed, { id: "attempt-2", environment: "sandbox", nextCheckAt: later() });
  let sent = false;
  await servePaymentOverview(context, placed, () => sent
    ? fixturePaymentOverview(placed, { ...PAYABLE, environment: "sandbox", available: false, reasonCode: "PAYMENT_EXISTS", message: PAYMENT_MESSAGES.exists, attempts: [second, failed] })
    : fixturePaymentOverview(placed, { ...PAYABLE, environment: "sandbox", attempts: [failed] }));
  const bodies: unknown[] = [];
  await context.route("**/api/mpesa/stk-push", (route) => {
    bodies.push(route.request().postDataJSON());
    sent = true;
    return route.fulfill({ status: 201, json: second });
  });

  const panel = await reserve(page, context);
  await expect(panel.getByText("Sandbox test: real funds may be deducted")).toBeVisible();
  await expect(panel.getByText("Payment not completed")).toBeVisible();
  await expect(panel.getByText(PAYMENT_MESSAGES.cancelled)).toBeVisible();
  const send = panel.getByRole("button", { name: "Send new M-Pesa prompt" });
  await expect(send).toBeVisible();
  expect(bodies).toEqual([]);

  await send.click();
  await expect(panel.getByText("Approve the payment on your phone")).toBeVisible();
  await expect(panel.getByText("Sandbox test: real funds may be deducted")).toBeVisible();
  // The profile number was offered and confirmed; no amount or status is ever sent.
  expect(bodies).toEqual([{ orderId: placed.id, phone: "254700000000" }]);
});

test("cancelling from an open receipt immediately removes payment initiation without a page reload", async ({ page, context }) => {
  await signInCustomer(page);
  let cancelled = false;
  const cancelledOrder: Order = { ...placed, status: "CANCELLED", reservationStatus: "RELEASED" };
  await context.route("**/api/orders?*", (route) => route.fulfill({ json: ordersList([cancelled ? cancelledOrder : placed]) }));
  await servePaymentOverview(context, placed, () => cancelled
    ? fixturePaymentOverview(cancelledOrder, { environment: "production", reasonCode: "ORDER_NOT_PAYABLE", message: "This order is no longer payable." })
    : fixturePaymentOverview(placed, PAYABLE));
  await context.route(`**/api/orders/${placed.id}/cancel`, (route) => {
    cancelled = true;
    return route.fulfill({ json: cancelledOrder });
  });
  const prompts: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/mpesa/stk-push") prompts.push(request.method()); });
  await page.goto("/#/account/orders");
  await page.getByRole("button", { name: "Details", exact: true }).click();
  const receipt = page.getByRole("dialog", { name: "Receipt Details" });
  await expect(receipt.getByRole("button", { name: "Send M-Pesa prompt" })).toBeVisible();
  await receipt.getByRole("button", { name: "Cancel Order", exact: true }).click();
  await page.getByRole("dialog", { name: "Cancel Order", exact: true }).getByRole("button", { name: "Cancel Order", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Cancel Order", exact: true })).toHaveCount(0);
  await expect(receipt).toBeVisible();
  await expect(receipt.getByText("This order is no longer payable.")).toBeVisible();
  await expect(receipt.getByRole("button", { name: "Send M-Pesa prompt" })).toHaveCount(0);
  await expect(receipt.getByRole("button", { name: "Cancel Order", exact: true })).toHaveCount(0);
  expect(prompts).toEqual([]);
});

/** Staff order list and payment record for one order; returns the authorizations the payment API saw. */
async function staffPayments(page: Page, context: BrowserContext, role: string) {
  await signInStaff(page, role);
  const unknown = fixtureAttempt(placed, { id: "attempt-2", status: "UNKNOWN", reasonCode: "PROVIDER_QUERY_PENDING", message: PAYMENT_MESSAGES.unknown });
  const failed = fixtureAttempt(placed, { id: "attempt-1", status: "FAILED", message: PAYMENT_MESSAGES.cancelled, canReconcile: false });
  const received = fixtureConfirmedAttempt(placed, {
    id: "attempt-2", status: "REVIEW", reviewRequired: true, reasonCode: "RESERVATION_UNAVAILABLE", message: PAYMENT_MESSAGES.receivedReview,
  });
  let checked = false;
  const seen: { path: string; authorization?: string }[] = [];
  await context.route("**/api/orders/admin/all?*", (route) => route.fulfill({
    json: ordersList([{ ...placed, user: { id: customer.id, firstName: customer.firstName, lastName: customer.lastName, email: customer.email } } as Order]),
  }));
  await context.route(`**/api/mpesa/admin/**`, (route) => {
    const { pathname } = new URL(route.request().url());
    const authorization = route.request().headers().authorization;
    seen.push({ path: `${route.request().method()} ${pathname}`, authorization });
    if (authorization !== `Bearer ${STAFF_TOKEN}`) return route.fulfill({ status: 401, json: { error: "Invalid token" } });
    if (pathname === `/api/mpesa/admin/payments/${unknown.id}/query`) {
      checked = true;
      return route.fulfill({ json: received });
    }
    return route.fulfill({ json: withOpenAttempt(checked ? received : unknown, [checked ? received : unknown, failed]) });
  });
  // Staff pages must never use the customer payment endpoints, for reads or writes.
  const customerCalls: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/mpesa/") && !pathname.startsWith("/api/mpesa/admin/")) customerCalls.push(`${request.method()} ${pathname}`);
  });

  await page.goto("/#/admin");
  await page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: "Orders" }).click();
  const toggle = page.getByRole("button", { name: `M-Pesa payments for ${placed.orderNumber}` });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(seen).toEqual([]);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const record = page.getByRole("region", { name: "M-Pesa payments" });
  await expect(record.getByText("Outcome unknown")).toBeVisible();
  await expect(record.getByText("M-Pesa has not reported a final result yet.")).toBeVisible();
  await expect(record.getByText("+254 *** 5678").first()).toBeVisible();
  await expect(record.getByRole("button", { name: /Send|refund|paid/i })).toHaveCount(0);
  return { record, seen, customerCalls };
}

test("administrators ask M-Pesa about an open attempt with staff credentials and see the review reason", async ({ page, context }) => {
  const { record, seen, customerCalls } = await staffPayments(page, context, "ADMIN");
  await record.getByRole("button", { name: "Check with M-Pesa" }).click();
  await expect(record.getByText("Money received, review required")).toBeVisible();
  await expect(record.getByText("Review required", { exact: true })).toBeVisible();
  await expect(record.getByText(/Check stock, then decide fulfilment or refund\./)).toBeVisible();
  await expect(record.getByText("SBX1234567")).toBeVisible();
  expect(seen.map(({ path }) => path)).toContain(`POST /api/mpesa/admin/payments/attempt-2/query`);
  expect(seen.every(({ authorization }) => authorization === `Bearer ${STAFF_TOKEN}`)).toBe(true);
  expect(customerCalls).toEqual([]);
});

test("viewers can read the payment record but their check is blocked", async ({ page, context }) => {
  const { record, seen, customerCalls } = await staffPayments(page, context, "VIEWER");
  const check = record.getByRole("button", { name: "Check with M-Pesa" });
  await expect(check).toHaveAttribute("aria-disabled", "true");
  await expect(record.getByText("Your role can view payments but cannot request M-Pesa checks.")).toBeVisible();
  await check.focus();
  await page.keyboard.press("Enter");
  await expect(check).toBeFocused();
  await expect(record.getByText("Outcome unknown")).toBeVisible();
  expect(seen.filter(({ path }) => path.startsWith("POST"))).toEqual([]);
  expect(customerCalls).toEqual([]);
});

test("the payment panel stacks on phones, sits beside the amount from 768px and keeps cancellation reachable", async ({ page, context, isMobile }) => {
  await signInCustomer(page);
  await context.route("**/api/orders?*", (route) => route.fulfill({ json: ordersList([placed]) }));
  await servePaymentOverview(context, placed, fixturePaymentOverview(placed, { ...PAYABLE, environment: "sandbox" }));
  for (const width of isMobile ? [360, 390, 768] : [1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/account/orders");
    await page.getByRole("button", { name: "Details", exact: true }).click();
    const receipt = page.getByRole("dialog", { name: "Receipt Details" });
    const panel = receipt.getByRole("region", { name: "Pay with M-Pesa" });
    const send = panel.getByRole("button", { name: "Send M-Pesa prompt" });
    await expect(send).toBeVisible();
    await expect(panel.getByText("Sandbox test: real funds may be deducted")).toBeVisible();
    const amount = await panel.getByText("Amount to pay").boundingBox();
    const phone = await panel.getByRole("textbox", { name: "M-Pesa phone number" }).boundingBox();
    const button = await send.boundingBox();
    expect(amount && phone && button, `payment panel renders at ${width}px`).toBeTruthy();
    if (!amount || !phone || !button) continue;
    if (width < 768) expect(phone.y, `stacked at ${width}px`).toBeGreaterThanOrEqual(amount.y + amount.height);
    else expect(phone.x, `side by side at ${width}px`).toBeGreaterThanOrEqual(amount.x + amount.width);
    expect(button.height, `touch target at ${width}px`).toBeGreaterThanOrEqual(44);

    const cancel = receipt.getByRole("button", { name: "Cancel Order", exact: true });
    await cancel.scrollIntoViewIfNeeded();
    await expect(cancel).toBeInViewport();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `page overflow at ${width}px`).toBeLessThanOrEqual(0);
    const panelOverflow = await panel.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(panelOverflow, `panel overflow at ${width}px`).toBeLessThanOrEqual(0);
    await page.keyboard.press("Escape");
    await expect(receipt).toHaveCount(0);
  }
});

test("the payment form and its primary action reflow with doubled text", async ({ page, context, isMobile }) => {
  await signInCustomer(page);
  await context.route("**/api/orders?*", (route) => route.fulfill({ json: ordersList([placed]) }));
  await servePaymentOverview(context, placed, fixturePaymentOverview(placed, { ...PAYABLE, environment: "sandbox" }));
  await page.setViewportSize({ width: isMobile ? 360 : 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/account/orders");
  await page.getByRole("button", { name: "Details", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Receipt Details" }).getByRole("region", { name: "Pay with M-Pesa" });
  await expect(panel.getByRole("button", { name: "Send M-Pesa prompt" })).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  const send = panel.getByRole("button", { name: "Send M-Pesa prompt" });
  await send.scrollIntoViewIfNeeded();
  await send.focus();
  await expect(send).toBeFocused();
  await expect(send).toBeInViewport();
  await expect(panel.getByText("Sandbox test: real funds may be deducted")).toBeVisible();
  const layout = await panel.evaluate((element) => ({
    panel: element.scrollWidth - element.clientWidth,
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    clipped: [...element.querySelectorAll<HTMLElement>("*")]
      // Form fields scroll their own value; anything else wider than its box is clipped content.
      .filter((child) => !child.matches("input, textarea, select") && child.clientWidth > 0 && child.scrollWidth > child.clientWidth + 1)
      .slice(0, 10)
      .map((child) => ({ tag: child.tagName, text: child.textContent?.slice(0, 40), client: child.clientWidth, scroll: child.scrollWidth })),
  }));
  expect(layout.panel, JSON.stringify(layout)).toBeLessThanOrEqual(0);
  expect(layout.page, JSON.stringify(layout)).toBeLessThanOrEqual(0);
  expect(layout.clipped, JSON.stringify(layout)).toEqual([]);
});
