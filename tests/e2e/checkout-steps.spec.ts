import type { Page } from "@playwright/test";
import type { Address, User } from "../../src/api/auth";
import type { Order, Quote } from "../../src/api/orders";
import { fixturePendingOrder } from "../../src/test-support/checkoutFixtures";
import {
  PAYABLE,
  PAYMENT_MESSAGES,
  fixtureAttempt,
  fixtureConfirmedAttempt,
  fixturePaymentOverview,
} from "../../src/test-support/paymentFixtures";
import { STORAGE_KEYS, shopperStateKey } from "../../src/utils/storage";
import {
  CUSTOMER_TOKEN,
  ORIGIN,
  OTHER_CUSTOMER_TOKEN,
  browserQuote,
  clippedWithin,
  customer,
  expect,
  expectWholeFocusRing,
  linenCartLine,
  otherCustomer,
  pageOverflow,
  servePaymentOverview,
  serveSignIn,
  shopperState,
  signInWithForm,
  test,
  watchPaymentWrites,
} from "./fixtures";

/*
 * The checkout steps (P7.4): Delivery → Review and reserve → Payment, with the summary's pending fees, the first
 * address typed inline, the reservation and payment outcomes, and the address that names the reserved order.
 * Every API is mocked; nothing is priced or charged in the browser.
 */

const REQUEST_KEY = /^[A-Za-z0-9:_-]{16,128}$/;
const PHONE = "0712 345 678";
const FIRST_ADDRESS: Address = { id: "addr-first", street: "12 Moi Avenue", city: "Nairobi", county: "Nairobi", postalCode: null, isDefault: true };
const newcomer: User = { ...customer, id: "browser-newcomer", email: "newcomer@example.test", addresses: [] };
/** Keeps the payment panel's automatic checks out of the way of a test's own clicks. */
const later = () => new Date(Date.now() + 60_000).toISOString();

/** The quote for the first address, as the server prices it: KES 900 + KES 144 VAT + KES 200 delivery. */
const firstQuote = (overrides: Partial<Quote> = {}) => browserQuote({
  address: { id: FIRST_ADDRESS.id, street: FIRST_ADDRESS.street, city: FIRST_ADDRESS.city, county: FIRST_ADDRESS.county, postalCode: null },
  ...overrides,
});

/**
 * Signs `account.user` in once per tab (a reload keeps whatever the page did since), and answers `/auth/me` with the
 * account's current record, so an address saved during the test is there after a reload.
 */
async function signInAs(page: Page, account: { user: User }, cart = [linenCartLine]) {
  await page.context().addInitScript(({ user, lines, keys, shopperKey, token, origin }) => {
    if (location.origin !== origin || sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem(keys.customerUser, JSON.stringify(user));
    localStorage.setItem(keys.customerToken, token);
    localStorage.setItem(keys.customerRefreshToken, "browser-only-refresh-token");
    localStorage.setItem(shopperKey, JSON.stringify({ cart: lines, wishlist: [] }));
  }, { user: account.user, lines: cart, keys: STORAGE_KEYS, shopperKey: shopperStateKey(account.user.id), token: CUSTOMER_TOKEN, origin: ORIGIN });
  await page.context().route("**/api/auth/me", (route) => route.fulfill({ json: account.user }));
}

/** Saving an address as the API does: the new record (with its id) is returned and joins the account. */
async function serveNewAddress(page: Page, account: { user: User }) {
  const saved: unknown[] = [];
  await page.context().route("**/api/auth/addresses", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    saved.push(route.request().postDataJSON());
    account.user = { ...account.user, addresses: [...(account.user.addresses ?? []), FIRST_ADDRESS] };
    return route.fulfill({ status: 201, json: FIRST_ADDRESS });
  });
  return saved;
}

const stepList = (page: Page) => page.getByRole("navigation", { name: "Checkout steps" }).getByRole("listitem");
const stepHeading = (page: Page, name: string) => page.getByRole("main").getByRole("heading", { level: 2, name, exact: true });

/** Which step is current, and which steps are links back (the rest are plain text). */
async function stepper(page: Page) {
  return stepList(page).evaluateAll((items) => items.map((item) => ({
    current: item.getAttribute("aria-current") === "step",
    link: item.querySelector("a") !== null,
  })));
}

/** The summary's figures, label to value, as shown (opening the phone disclosure first). */
async function summaryFigures(page: Page) {
  const summary = page.getByRole("region", { name: "Order summary" });
  const toggle = summary.getByRole("button", { name: /order summary/ });
  if (await toggle.isVisible() && (await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  return summary.locator("dl > div").evaluateAll((rows) => rows.map((row) => [row.querySelector("dt")?.textContent, row.querySelector("dd")?.textContent]));
}

test("a first address typed at checkout is saved and quoted, reserved unpaid, then paid with a receipt", async ({ page, context }) => {
  const account = { user: newcomer };
  await signInAs(page, account);
  await context.addInitScript(() => { window.print = () => {}; });
  const saved = await serveNewAddress(page, account);
  const quote = firstQuote();
  const quoted: { addressId: string; deliveryMethod: string }[] = [];
  await context.route("**/api/orders/quotes", (route) => {
    quoted.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: quote });
  });
  const reserved = fixturePendingOrder(quote);
  const reservations: { key?: string; body: unknown }[] = [];
  await context.route("**/api/orders", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    reservations.push({ key: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() });
    return route.fulfill({ status: 201, json: reserved });
  });
  const paidOrder: Order = { ...reserved, paymentStatus: "PAID", reservationStatus: "COMMITTED", reservationExpiresAt: null };
  const pending = fixtureAttempt(reserved, { nextCheckAt: later() });
  let stage: "unpaid" | "pending" | "paid" = "unpaid";
  await servePaymentOverview(context, reserved, () => {
    if (stage === "unpaid") return fixturePaymentOverview(reserved, PAYABLE);
    if (stage === "pending") return fixturePaymentOverview(reserved, { ...PAYABLE, available: false, reasonCode: "PAYMENT_EXISTS", message: PAYMENT_MESSAGES.exists, attempts: [pending] });
    return fixturePaymentOverview(paidOrder, {
      environment: "production", reasonCode: "ORDER_NOT_PAYABLE", message: "This order is not awaiting payment on an active reservation.",
      attempts: [fixtureConfirmedAttempt(reserved)],
    });
  });
  const prompts: unknown[] = [];
  await context.route("**/api/mpesa/stk-push", (route) => {
    prompts.push(route.request().postDataJSON());
    stage = "pending";
    return route.fulfill({ status: 201, json: pending });
  });
  await context.route(`**/api/mpesa/payments/${pending.id}/query`, (route) => {
    stage = "paid";
    return route.fulfill({ json: fixtureConfirmedAttempt(reserved) });
  });
  const paymentWrites = watchPaymentWrites(page);

  // Delivery: the address form itself, with later steps as text and nothing quoted yet.
  await page.goto("/#/checkout");
  await expect(stepHeading(page, "Delivery")).toBeVisible();
  expect(await stepper(page)).toEqual([{ current: true, link: false }, { current: false, link: false }, { current: false, link: false }]);
  const main = page.getByRole("main");
  await main.getByRole("textbox", { name: "Street address" }).fill(FIRST_ADDRESS.street);
  await main.getByRole("textbox", { name: "Town or city" }).fill(FIRST_ADDRESS.city);
  await main.getByRole("textbox", { name: "County" }).fill(FIRST_ADDRESS.county);
  expect(quoted).toEqual([]);
  await main.getByRole("button", { name: "Save and continue" }).click();

  // Review: the saved address is chosen and quoted; reserving is explained as charging nothing.
  await expect(stepHeading(page, "Review and reserve")).toBeFocused();
  await expect(page).toHaveURL(/#\/checkout\?step=review$/);
  expect(saved).toEqual([{ street: FIRST_ADDRESS.street, city: FIRST_ADDRESS.city, county: FIRST_ADDRESS.county, isDefault: true }]);
  const total = page.getByRole("region", { name: "Order total" });
  await expect(total.getByText("KES 1,244")).toBeVisible();
  expect(quoted.at(-1)).toMatchObject({ addressId: FIRST_ADDRESS.id, deliveryMethod: "STANDARD" });
  await expect(total.getByText("Reserving creates an unpaid order and charges nothing.")).toBeVisible();
  expect(await stepper(page)).toEqual([{ current: false, link: true }, { current: true, link: false }, { current: false, link: false }]);
  await total.getByRole("button", { name: "Reserve order", exact: true }).click();

  // Payment: the server's order, unpaid and held; nothing has been charged or requested.
  await expect(stepHeading(page, "Order reserved")).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`#/checkout\\?step=payment&order=${reserved.id}$`));
  await expect(main.getByText(reserved.orderNumber, { exact: true })).toBeVisible();
  await expect(main.getByText(/^Unpaid — held until /)).toBeVisible();
  expect(reservations).toEqual([{ key: expect.stringMatching(REQUEST_KEY), body: { quoteId: quote.id } }]);
  expect(paymentWrites).toEqual([]);
  expect(await stepper(page)).toEqual([{ current: false, link: false }, { current: false, link: false }, { current: true, link: false }]);
  await expect(main.getByRole("button", { name: "Print receipt" })).toHaveCount(0);

  const panel = page.getByRole("region", { name: "Pay with M-Pesa" });
  await panel.getByRole("textbox", { name: "M-Pesa phone number" }).fill(PHONE);
  await panel.getByRole("button", { name: "Send M-Pesa prompt" }).click();
  await expect(panel.getByText("Approve the payment on your phone")).toBeVisible();
  // "Paid" appears only once the server confirms it.
  await expect(main.getByText(/^Unpaid — held until /)).toBeVisible();
  await expect(main.getByText("Payment received", { exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "Check payment status" }).click();
  await expect(main.getByText("Payment received", { exact: true })).toBeVisible();
  await expect(main.getByText("Thank you. Your receipt is ready.")).toBeVisible();
  // The step heading follows the server's confirmation too: a paid order no longer reads as only reserved.
  await expect(stepHeading(page, "Order paid")).toBeVisible();
  await expect(stepHeading(page, "Order reserved")).toHaveCount(0);
  expect(prompts).toEqual([{ orderId: reserved.id, phone: "254712345678" }]);
  expect(paymentWrites).toEqual(["POST /api/mpesa/stk-push", `POST /api/mpesa/payments/${pending.id}/query`]);

  await expect(main.getByRole("link", { name: "View order details" })).toHaveAttribute("href", `#/account/orders?order=${reserved.id}`);
  await expect(main.getByRole("link", { name: "Track this order" })).toHaveAttribute("href", `#/track?order=${reserved.orderNumber}`);
  const [printed] = await Promise.all([page.waitForEvent("popup"), main.getByRole("button", { name: "Print receipt" }).click()]);
  await expect(printed.locator(".title")).toContainText(`Order ${reserved.orderNumber}`);
  await expect(printed.locator(".facts")).toContainText("M-Pesa (paid)");
  await expect(printed.locator(".totals .grand")).toContainText("KES 1,244");
  await printed.close();
  await expect.poll(() => shopperState(page, newcomer.id)).toMatchObject({ cart: [], pendingOrder: null });
});

test("before an address, the summary estimates the items and leaves every fee pending, never 0 or free", async ({ page, isMobile }) => {
  await signInAs(page, { user: newcomer });
  const quotes: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/orders/quotes") quotes.push(request.method()); });
  await page.goto("/#/checkout");
  await expect(stepHeading(page, "Delivery")).toBeVisible();
  const summary = page.getByRole("region", { name: "Order summary" });
  if (isMobile) {
    // Phones: a closed disclosure above the step, already saying the total is pending.
    const toggle = summary.getByRole("button", { name: /Show order summary/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toContainText("Total pending");
    const [summaryBox, stepBox] = [await summary.boundingBox(), await stepHeading(page, "Delivery").boundingBox()];
    expect(summaryBox!.y + summaryBox!.height).toBeLessThanOrEqual(stepBox!.y);
  } else {
    // From 1280px: a 360px column beside the step.
    expect(Math.round((await summary.boundingBox())!.width)).toBe(360);
  }
  expect(await summaryFigures(page)).toEqual([
    ["Items (estimate, excl. VAT)", "KES 900"], ["Delivery", "Pending"], ["VAT (16%)", "Pending"], ["Total", "Pending"],
  ]);
  await expect(summary.getByText("Choose a delivery address to see delivery, VAT and your total.")).toBeVisible();
  await expect(summary).not.toContainText(/KES 0\b|Free/i);
  expect(quotes).toEqual([]);
});

/** The offer ended: KES 1,000 + KES 160 VAT + KES 200 delivery. */
const repricedTotals: Partial<Quote> = {
  id: "quote-2", lines: [{ ...browserQuote().lines[0], unitPrice: 1000, total: 1000, discount: 0, discountId: null }],
  discount: 0, discountedSubtotal: 1000, tax: 160, total: 1360,
};

test("expired prices are refreshed and a changed total is confirmed, all within Review", async ({ page, context, isMobile }) => {
  await signInAs(page, { user: customer });
  let calls = 0;
  await context.route("**/api/orders/quotes", (route) => {
    calls += 1;
    // The first quote lapses moments after it is issued; the refreshed one reflects an offer that has ended.
    return route.fulfill({ status: 201, json: calls === 1 ? browserQuote({ expiresAt: new Date(Date.now() + 2500).toISOString() }) : browserQuote(repricedTotals) });
  });
  const reservations: string[] = [];
  await context.route("**/api/orders", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    reservations.push(route.request().postDataJSON().quoteId);
    return route.fulfill({ status: 201, json: fixturePendingOrder(browserQuote(repricedTotals)) });
  });
  await servePaymentOverview(context, fixturePendingOrder(browserQuote(repricedTotals)));

  await page.goto("/#/checkout");
  const review = stepHeading(page, "Review and reserve");
  await expect(review).toBeVisible();
  const total = page.getByRole("region", { name: "Order total" });
  const reserve = total.getByRole("button", { name: "Reserve order", exact: true });
  await expect(total.getByText("KES 1,244")).toBeVisible();
  await expect(reserve).toBeEnabled();

  await expect(total.getByText(/^These prices expired at /)).toBeVisible({ timeout: 10_000 });
  await expect(reserve).toBeDisabled();
  await expect(reserve).toHaveAccessibleDescription(/Refresh prices to continue\./);
  if (isMobile) {
    // The summary never presents lapsed prices as the current total.
    await expect(page.getByRole("region", { name: "Order summary" }).getByRole("button", { name: /order summary/ })).toContainText("Total pending");
  }
  await total.getByRole("button", { name: "Refresh prices" }).click();

  await expect(total.getByText("Your total changed from KES 1,244 to KES 1,360.", { exact: false })).toBeVisible();
  await expect(reserve).toBeDisabled();
  await expect(reserve).toHaveAccessibleDescription(/Confirm you have reviewed the updated total to continue\./);
  await expect(review).toBeVisible();
  expect((await stepper(page))[1]).toEqual({ current: true, link: false });
  expect(reservations).toEqual([]);
  await total.getByRole("button", { name: "I have reviewed the new total" }).click();
  await expect(reserve).toBeEnabled();
  await reserve.click();
  await expect(stepHeading(page, "Order reserved")).toBeFocused();
  expect(reservations).toEqual(["quote-2"]);
});

test("a lost reservation response is settled on Review with the same key, never as a second order", async ({ page, context }) => {
  await signInAs(page, { user: customer });
  await context.route("**/api/orders/quotes", (route) => route.fulfill({ status: 201, json: browserQuote() }));
  const keys: (string | undefined)[] = [];
  await context.route("**/api/orders", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    keys.push(route.request().headers()["idempotency-key"]);
    // The server may have committed the order; only its answer is lost.
    return route.abort("failed");
  });
  let reachable = false;
  await context.route("**/api/orders/quotes/quote-1", (route) => (reachable
    ? route.fulfill({ json: browserQuote({ consumed: true, orderId: "order-quote-1" }) })
    : route.abort("failed")));
  const reserved = fixturePendingOrder(browserQuote());
  await context.route(`**/api/orders/${reserved.id}`, (route) => route.fulfill({ json: reserved }));
  await servePaymentOverview(context, reserved);

  await page.goto("/#/checkout");
  await page.getByRole("button", { name: "Reserve order", exact: true }).click();
  // Unresolved: still the Review step (never Payment), offering only the same request again.
  const settling = stepHeading(page, "Finishing your earlier order request");
  await expect(settling).toBeVisible();
  expect(await stepper(page)).toEqual([{ current: false, link: false }, { current: true, link: false }, { current: false, link: false }]);
  await expect(page.getByRole("button", { name: "Reserve order", exact: true })).toHaveCount(0);
  await expect(page.getByText(/We could not check your earlier order request/)).toBeVisible();
  const retry = page.getByRole("button", { name: "Retry the same request" });
  await expect(retry).toHaveAttribute("aria-disabled", "false");
  await retry.click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[0]).toMatch(REQUEST_KEY);
  expect((await shopperState(page, customer.id)).pendingOrder).toMatchObject({ quoteId: "quote-1", idempotencyKey: keys[0] });

  // Once the server answers, the stored request resolves to the order it created; nothing is sent again.
  reachable = true;
  await page.reload();
  await expect(stepHeading(page, "Order reserved")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/checkout\\?step=payment&order=${reserved.id}$`));
  await expect(page.getByRole("main").getByText(reserved.orderNumber, { exact: true })).toBeVisible();
  expect(keys).toHaveLength(2);
  await expect.poll(() => shopperState(page, customer.id)).toMatchObject({ cart: [], pendingOrder: null, acknowledgedOrderIds: [reserved.id] });
});

test("an unresolved payment resumes after a reload with the same request, and a new prompt is offered only after a failure", async ({ page, context }) => {
  await signInAs(page, { user: customer });
  await context.route("**/api/orders/quotes", (route) => route.fulfill({ status: 201, json: browserQuote() }));
  const reserved = fixturePendingOrder(browserQuote());
  await context.route("**/api/orders", (route) =>
    route.request().method() === "POST" ? route.fulfill({ status: 201, json: reserved }) : route.fallback());
  await context.route(`**/api/orders/${reserved.id}`, (route) => route.fulfill({ json: reserved }));
  const open = fixtureAttempt(reserved, { nextCheckAt: later() });
  const failed = fixtureAttempt(reserved, { status: "FAILED", message: PAYMENT_MESSAGES.cancelled, canReconcile: false });
  let stage: "none" | "open" | "failed" = "none";
  await servePaymentOverview(context, reserved, () => {
    if (stage === "open") return fixturePaymentOverview(reserved, { ...PAYABLE, available: false, reasonCode: "PAYMENT_EXISTS", message: PAYMENT_MESSAGES.exists, attempts: [open] });
    if (stage === "failed") return fixturePaymentOverview(reserved, { ...PAYABLE, attempts: [failed] });
    return fixturePaymentOverview(reserved, PAYABLE);
  });
  const prompts: { key?: string; body: unknown }[] = [];
  await context.route("**/api/mpesa/stk-push", (route) => {
    prompts.push({ key: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() });
    // The first answer is lost before the server recorded anything.
    if (prompts.length === 1) return route.abort("failed");
    stage = "open";
    return route.fulfill({ status: 201, json: open });
  });
  await context.route(`**/api/mpesa/payments/${open.id}/query`, (route) => {
    stage = "failed";
    return route.fulfill({ json: failed });
  });

  await page.goto("/#/checkout");
  await page.getByRole("button", { name: "Reserve order", exact: true }).click();
  await expect(stepHeading(page, "Order reserved")).toBeVisible();
  const panel = page.getByRole("region", { name: "Pay with M-Pesa" });
  await panel.getByRole("textbox", { name: "M-Pesa phone number" }).fill(PHONE);
  await panel.getByRole("button", { name: "Send M-Pesa prompt" }).click();
  await expect(panel.getByRole("button", { name: "Retry the same request" })).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Send/ })).toHaveCount(0);

  // A reload returns to this order's Payment step with the unresolved request, never a fresh invitation to pay.
  await page.reload();
  await expect(stepHeading(page, "Order reserved")).toBeVisible();
  await expect(panel.getByText("Your payment request has not been confirmed")).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Send/ })).toHaveCount(0);
  expect(prompts).toHaveLength(1);
  await panel.getByRole("button", { name: "Retry the same request" }).click();
  await expect(panel.getByText("Approve the payment on your phone")).toBeVisible();
  expect(prompts).toEqual([{ key: expect.stringMatching(REQUEST_KEY), body: { orderId: reserved.id, phone: "254712345678" } }, prompts[0]]);

  // Only a reported failure brings back a prompt, and only when the shopper asks for one.
  await panel.getByRole("button", { name: "Check payment status" }).click();
  await expect(panel.getByText("Payment not completed")).toBeVisible();
  const again = panel.getByRole("button", { name: "Send new M-Pesa prompt" });
  await expect(again).toBeVisible();
  expect(prompts).toHaveLength(2);
  await again.click();
  await expect.poll(() => prompts.length).toBe(3);
  expect(prompts[2].key).not.toBe(prompts[0].key);
});

test("leaving for the cart and coming back keeps the typed address, the delivery method and the coupon", async ({ page, context }) => {
  const account = { user: newcomer };
  await signInAs(page, account);
  await serveNewAddress(page, account);
  const quoted: { deliveryMethod: string; couponCode: string | null }[] = [];
  await context.route("**/api/orders/quotes", (route) => {
    const body = route.request().postDataJSON();
    quoted.push(body);
    return route.fulfill({ status: 201, json: firstQuote({ deliveryMethod: body.deliveryMethod, couponCode: body.couponCode }) });
  });
  const main = page.getByRole("main");
  const street = main.getByRole("textbox", { name: "Street address" });
  const city = main.getByRole("textbox", { name: "Town or city" });
  const sameDay = main.getByRole("radio", { name: "Same-day delivery" });

  await page.goto("/#/checkout");
  await street.fill(FIRST_ADDRESS.street);
  await city.fill(FIRST_ADDRESS.city);
  await sameDay.check();
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Cart" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your cart" })).toBeVisible();
  await page.goBack();
  await expect(stepHeading(page, "Delivery")).toBeVisible();
  await expect(street).toHaveValue(FIRST_ADDRESS.street);
  await expect(city).toHaveValue(FIRST_ADDRESS.city);
  await expect(sameDay).toBeChecked();
  await page.reload();
  await expect(street).toHaveValue(FIRST_ADDRESS.street);
  await expect(sameDay).toBeChecked();

  await main.getByRole("textbox", { name: "County" }).fill(FIRST_ADDRESS.county);
  await main.getByRole("button", { name: "Save and continue" }).click();
  await expect(stepHeading(page, "Review and reserve")).toBeVisible();
  await main.getByRole("textbox", { name: "Coupon code (optional)" }).fill("save10");
  await main.getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(() => quoted.at(-1)).toMatchObject({ deliveryMethod: "SAME_DAY", couponCode: "SAVE10" });
  await main.getByRole("link", { name: "Edit cart", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your cart" })).toBeVisible();
  await page.goBack();
  await expect(stepHeading(page, "Review and reserve")).toBeVisible();
  const recap = page.getByRole("region", { name: "Review and reserve" });
  await expect(recap.getByText(`${FIRST_ADDRESS.street}, ${FIRST_ADDRESS.city}, ${FIRST_ADDRESS.county}`)).toBeVisible();
  await expect(recap.getByText("Same-day delivery", { exact: true })).toBeVisible();
  await expect(recap.getByText("SAVE10", { exact: true })).toBeVisible();
  expect(quoted.at(-1)).toMatchObject({ addressId: FIRST_ADDRESS.id, deliveryMethod: "SAME_DAY", couponCode: "SAVE10" });
  // Saved, so nothing typed is left behind in this tab.
  expect(await page.evaluate((key) => sessionStorage.getItem(key), STORAGE_KEYS.checkoutAddressDraft)).toBeNull();
});

/* ------------------------------------------------------------------ */
/* Trust boundaries: the order in the address, accounts and drafts    */
/* ------------------------------------------------------------------ */

const DRAFT_KEY = STORAGE_KEYS.checkoutAddressDraft;
const draftIn = (page: Page) => page.evaluate((key) => sessionStorage.getItem(key), DRAFT_KEY);

/** Seeds account carts once per test (never again on a reload or in a new tab). */
async function seedAccountCarts(page: Page, owners: string[]) {
  await page.context().addInitScript(({ keys, line, origin }) => {
    if (location.origin !== origin || localStorage.getItem("test:carts-seeded")) return;
    localStorage.setItem("test:carts-seeded", "1");
    for (const key of keys) localStorage.setItem(key, JSON.stringify({ cart: [line], wishlist: [] }));
  }, { keys: owners.map((owner) => shopperStateKey(owner)), line: linenCartLine, origin: ORIGIN });
}

/** Records whether `text` is ever rendered from now on, however briefly. */
async function watchForText(page: Page, text: string) {
  await page.evaluate((watched) => {
    const flag = window as Window & { sawWatchedText?: boolean };
    flag.sawWatchedText = document.body.textContent?.includes(watched) ?? false;
    new MutationObserver(() => {
      if (document.body.textContent?.includes(watched)) flag.sawWatchedText = true;
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  }, text);
  return () => page.evaluate(() => (window as Window & { sawWatchedText?: boolean }).sawWatchedText);
}

/** Reserves the signed-in customer's cart and waits for the Payment step that names the order in the address. */
async function reserveToPayment(page: Page, reserved: Order) {
  await page.getByRole("button", { name: "Reserve order", exact: true }).click();
  await expect(stepHeading(page, "Order reserved")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#/checkout\\?step=payment&order=${reserved.id}$`));
  await expect(page.getByRole("main").getByText(reserved.orderNumber, { exact: true })).toBeVisible();
}

/** The reserved order answers only for the account that placed it; anyone else gets the API's 404. */
async function serveOwnedOrder(page: Page, reserved: Order) {
  const askedWith: string[] = [];
  await page.context().route(`**/api/orders/${reserved.id}`, (route) => {
    const authorization = route.request().headers().authorization ?? "";
    askedWith.push(authorization);
    return authorization === `Bearer ${CUSTOMER_TOKEN}`
      ? route.fulfill({ json: reserved })
      : route.fulfill({ status: 404, json: { error: "Order not found", code: "ORDER_NOT_FOUND" } });
  });
  return askedWith;
}

test("an order in the address that the server refuses, or that is malformed, reads as not found", async ({ page, context }) => {
  await signInAs(page, { user: customer });
  await context.route("**/api/orders/quotes", (route) => route.fulfill({ status: 201, json: browserQuote() }));
  const asked: string[] = [];
  await context.route("**/api/orders/*", (route) => {
    const { pathname } = new URL(route.request().url());
    if (route.request().method() !== "GET" || pathname === "/api/orders/quotes") return route.fallback();
    asked.push(pathname);
    return pathname.endsWith("/forbidden-order")
      ? route.fulfill({ status: 403, json: { error: "Forbidden" } })
      : route.fulfill({ status: 404, json: { error: "Order not found", code: "ORDER_NOT_FOUND" } });
  });
  for (const order of ["someone-elses-order", "forbidden-order", "%3Cimg%20src%3Dx%3E%2F..%2Fadmin"]) {
    // From another page each time, so every visit starts a fresh checkout.
    await page.goto("/#/cart");
    await page.goto(`/#/checkout?step=payment&order=${order}`);
    await expect(page.getByText("That order isn't in your account")).toBeVisible();
    await expect(page).toHaveURL(/#\/checkout$/);
    await expect(stepHeading(page, "Review and reserve")).toBeVisible();
    await expect(stepHeading(page, "Order reserved")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Your order could not be loaded" })).toHaveCount(0);
  }
  // The malformed value was never sent to the server.
  expect(asked).toEqual(["/api/orders/someone-elses-order", "/api/orders/forbidden-order"]);
});

test("after signing out and in as another account in this tab, Payment never shows the first account's order", async ({ page, context }) => {
  await serveSignIn(context);
  await seedAccountCarts(page, [customer.id]);
  await context.route("**/api/orders/quotes", (route) => route.fulfill({ status: 201, json: browserQuote() }));
  const reserved = fixturePendingOrder(browserQuote());
  await context.route("**/api/orders", (route) =>
    route.request().method() === "POST" ? route.fulfill({ status: 201, json: reserved }) : route.fallback());
  await servePaymentOverview(context, reserved);
  const askedWith = await serveOwnedOrder(page, reserved);

  await page.goto("/#/login?returnTo=%2Fcheckout");
  await signInWithForm(page, customer);
  await expect(stepHeading(page, "Review and reserve")).toBeVisible();
  await reserveToPayment(page, reserved);

  await page.goto("/#/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/#\/login$/);
  await signInWithForm(page, otherCustomer);
  await expect(page).toHaveURL(/#\/$/);
  const sawOrder = await watchForText(page, reserved.orderNumber);
  // Back at the first account's payment address, as Back or a saved link would bring it.
  await page.goto(`/#/checkout?step=payment&order=${reserved.id}`);
  await expect(page.getByText("That order isn't in your account")).toBeVisible();
  await expect(page).toHaveURL(/#\/checkout$/);
  expect(await sawOrder()).toBe(false);
  expect(askedWith.at(-1)).toBe(`Bearer ${OTHER_CUSTOMER_TOKEN}`);
});

test("when another tab switches account, this tab's Payment step drops the first account's order", async ({ page, context, isMobile }) => {
  test.skip(isMobile, "Tabs behave alike on every screen size; the desktop project covers them.");
  await serveSignIn(context);
  await seedAccountCarts(page, [customer.id]);
  await context.route("**/api/orders/quotes", (route) => route.fulfill({ status: 201, json: browserQuote() }));
  const reserved = fixturePendingOrder(browserQuote());
  await context.route("**/api/orders", (route) =>
    route.request().method() === "POST" ? route.fulfill({ status: 201, json: reserved }) : route.fallback());
  await servePaymentOverview(context, reserved);
  const askedWith = await serveOwnedOrder(page, reserved);

  await page.goto("/#/login?returnTo=%2Fcheckout");
  await signInWithForm(page, customer);
  await reserveToPayment(page, reserved);

  const other = await context.newPage();
  await other.goto("/#/account");
  await other.getByRole("button", { name: "Sign out" }).click();
  await expect(other).toHaveURL(/#\/login$/);
  await page.bringToFront();
  // This tab follows the sign-out at once: the order is no longer on screen.
  await expect(page.getByRole("main").getByText(reserved.orderNumber, { exact: true })).toHaveCount(0);
  const sawOrder = await watchForText(page, reserved.orderNumber);

  await other.bringToFront();
  await signInWithForm(other, otherCustomer);
  await expect(other).toHaveURL(/#\/$/);
  await page.bringToFront();
  await expect(page.getByText("That order isn't in your account")).toBeVisible();
  await expect(page).toHaveURL(/#\/checkout$/);
  expect(await sawOrder()).toBe(false);
  expect(askedWith.at(-1)).toBe(`Bearer ${OTHER_CUSTOMER_TOKEN}`);
});

test("when another tab signs in as someone else without signing out first, this tab's Payment step drops the first account's order", async ({ page, context, isMobile }) => {
  test.skip(isMobile, "Tabs behave alike on every screen size; the desktop project covers them.");
  await serveSignIn(context);
  await seedAccountCarts(page, [customer.id]);
  await context.route("**/api/orders/quotes", (route) => route.fulfill({ status: 201, json: browserQuote() }));
  const reserved = fixturePendingOrder(browserQuote());
  await context.route("**/api/orders", (route) =>
    route.request().method() === "POST" ? route.fulfill({ status: 201, json: reserved }) : route.fallback());
  await servePaymentOverview(context, reserved);
  const askedWith = await serveOwnedOrder(page, reserved);

  await page.goto("/#/login?returnTo=%2Fcheckout");
  await signInWithForm(page, customer);
  await reserveToPayment(page, reserved);

  // The other tab signs in as a different account straight over this one: the stored session goes from the first
  // account to the second with no signed-out moment between, so nothing on this page unmounts on the way.
  const other = await context.newPage();
  await other.goto("/#/login");
  await signInWithForm(other, otherCustomer);
  await expect(other).toHaveURL(/#\/$/);
  await page.bringToFront();
  await expect(page.getByText("That order isn't in your account")).toBeVisible();
  await expect(page).toHaveURL(/#\/checkout$/);
  await expect(page.getByRole("main").getByText(reserved.orderNumber, { exact: true })).toHaveCount(0);
  expect(askedWith.at(-1)).toBe(`Bearer ${OTHER_CUSTOMER_TOKEN}`);
});

test("a typed address stays in its own tab and account, and is forgotten on sign-out and account switch", async ({ page, context, isMobile }) => {
  test.skip(isMobile, "Tabs behave alike on every screen size; the desktop project covers them.");
  const second: User = { ...otherCustomer, addresses: [] };
  await serveSignIn(context, [{ user: newcomer, token: CUSTOMER_TOKEN }, { user: second, token: OTHER_CUSTOMER_TOKEN }]);
  await seedAccountCarts(page, [newcomer.id, second.id]);
  const street = (tab: Page) => tab.getByRole("main").getByRole("textbox", { name: "Street address" });

  await page.goto("/#/login?returnTo=%2Fcheckout");
  await signInWithForm(page, newcomer);
  await street(page).fill(FIRST_ADDRESS.street);
  expect(JSON.parse((await draftIn(page))!)).toMatchObject({ owner: newcomer.id, draft: { street: FIRST_ADDRESS.street } });

  // Another tab of the same account starts empty: the draft belongs to the tab that typed it.
  const other = await context.newPage();
  await other.goto("/#/checkout");
  await expect(street(other)).toHaveValue("");
  expect(await draftIn(other)).toBeNull();

  // An account switch made in the other tab forgets this tab's draft, and the new account sees an empty form.
  await other.goto("/#/account");
  await other.getByRole("button", { name: "Sign out" }).click();
  await signInWithForm(other, second);
  await expect(other).toHaveURL(/#\/$/);
  await page.bringToFront();
  await expect(street(page)).toHaveValue("");
  expect(await draftIn(page)).toBeNull();

  // A draft typed by the second account is forgotten when it signs out here; the first account sees none of it.
  await street(page).fill("99 Second Street");
  expect(JSON.parse((await draftIn(page))!)).toMatchObject({ owner: second.id });
  await page.goto("/#/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  expect(await draftIn(page)).toBeNull();
  await page.goto("/#/login?returnTo=%2Fcheckout");
  await signInWithForm(page, newcomer);
  await expect(street(page)).toHaveValue("");
});

/* ------------------------------------------------------------------ */
/* Layout and focus on every step                                     */
/* ------------------------------------------------------------------ */

/** The 3px ring sits 2px outside its control, so it needs this much room below the sticky header too. */
const FOCUS_RING_OUTSET = 5;
const office: Address = { id: "addr-office", street: "2 Office Road, Upper Hill Business Park", city: "Nairobi", county: "Nairobi", postalCode: "00100", isDefault: false };

/** The checkout states every layout check visits, each reached the way a shopper reaches it. */
const CHECKOUT_STATES = ["first address with errors", "saved addresses with the form open", "review", "payment", "paid"] as const;
type CheckoutState = typeof CHECKOUT_STATES[number];

async function serveCheckoutStates(page: Page) {
  const context = page.context();
  const quote = browserQuote();
  const reserved = fixturePendingOrder(quote);
  const paidOrder: Order = { ...fixturePendingOrder(quote, { id: "order-paid", orderNumber: "APX-PAID-1" }), paymentStatus: "PAID", reservationStatus: "COMMITTED", reservationExpiresAt: null };
  await context.route("**/api/orders/quotes", (route) => route.fulfill({ status: 201, json: quote }));
  await context.route(`**/api/orders/${reserved.id}`, (route) => route.fulfill({ json: reserved }));
  await context.route(`**/api/orders/${paidOrder.id}`, (route) => route.fulfill({ json: paidOrder }));
  await servePaymentOverview(context, reserved, fixturePaymentOverview(reserved, PAYABLE));
  await servePaymentOverview(context, paidOrder, fixturePaymentOverview(paidOrder, {
    environment: "production", reasonCode: "ORDER_NOT_PAYABLE", message: "This order is not awaiting payment on an active reservation.",
    attempts: [fixtureConfirmedAttempt(paidOrder)],
  }));
  return { reserved, paidOrder };
}

/** Opens `state` for the signed-in account (its addresses decide which Delivery form shows). */
async function openCheckoutState(page: Page, state: CheckoutState, orders: { reserved: Order; paidOrder: Order }) {
  const main = page.getByRole("main");
  if (state === "first address with errors") {
    await page.goto("/#/checkout");
    await main.getByRole("button", { name: "Save and continue" }).click();
    await expect(main.getByRole("alert").filter({ hasText: "Check your address" })).toBeFocused();
  } else if (state === "saved addresses with the form open") {
    await page.goto("/#/checkout?step=delivery");
    await main.getByRole("button", { name: "Add another address" }).click();
    await expect(main.getByRole("heading", { name: "Add another address" })).toBeVisible();
  } else if (state === "review") {
    await page.goto("/#/checkout");
    await expect(page.getByRole("region", { name: "Order total" }).getByText("KES 1,244")).toBeVisible();
    const toggle = page.getByRole("region", { name: "Order summary" }).getByRole("button", { name: /order summary/ });
    if (await toggle.isVisible()) await toggle.click();
  } else {
    const placed = state === "paid" ? orders.paidOrder : orders.reserved;
    await page.goto(`/#/checkout?step=payment&order=${placed.id}`);
    await expect(stepHeading(page, state === "paid" ? "Order paid" : "Order reserved")).toBeVisible();
    await expect(state === "paid" ? main.getByRole("button", { name: "Print receipt" }) : main.getByRole("button", { name: "Send M-Pesa prompt" })).toBeVisible();
  }
}

/** The account per state: no address for the first-address form, two saved addresses otherwise (same account, same cart). */
const accountFor = (state: CheckoutState): User => ({
  ...newcomer, addresses: state === "first address with errors" ? [] : [...customer.addresses!, office],
});

test("every checkout step reflows with doubled text, with no page-level overflow", async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  const orders = await serveCheckoutStates(page);
  const account = { user: newcomer };
  await signInAs(page, account);
  // The brief's matrix: phones and a tablet in the mobile project, laptop to wide desktop in the desktop project.
  const widths = isMobile ? [360, 430, 768] : [1024, 1280, 1440];
  await page.setViewportSize({ width: widths[0], height: 900 });
  await page.goto("/#/cart");
  for (const state of CHECKOUT_STATES) {
    account.user = accountFor(state);
    await page.evaluate(({ key, user }) => localStorage.setItem(key, JSON.stringify(user)), { key: STORAGE_KEYS.customerUser, user: account.user });
    await page.goto("/#/cart");
    await page.reload();
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    await openCheckoutState(page, state, orders);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      for (const size of ["100%", "200%"]) {
        await page.evaluate((value) => { document.documentElement.style.fontSize = value; }, size);
        const label = `${state} at ${width}px, ${size} text`;
        expect(await pageOverflow(page), `${label}: page overflow`).toBeLessThanOrEqual(0);
        expect(await clippedWithin(page.getByRole("main")), `${label}: clipped content`).toEqual([]);
      }
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    await page.setViewportSize({ width: widths[0], height: 900 });
  }
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
      return { top: control.getBoundingClientRect().top, chrome, inChrome: control.closest("[data-sticky-header]") !== null };
    });
    if (!place.inChrome) expect(place.top - FOCUS_RING_OUTSET, `${name}: px of ring below the sticky header`).toBeGreaterThanOrEqual(place.chrome - 0.5);
  }
  return visited;
}

test("focus rings on every checkout step are whole and never hidden under the sticky header", async ({ page }) => {
  test.setTimeout(120_000);
  const orders = await serveCheckoutStates(page);
  const account = { user: newcomer };
  await signInAs(page, account);
  await page.goto("/#/cart");
  for (const [state, presses, expected] of [
    ["first address with errors", 14, ["Street address", "Town or city", "County", "Save and continue"]],
    ["saved addresses with the form open", 16, ["Street address", "Save address", "Cancel"]],
    ["review", 14, ["Edit cart", "Reserve order"]],
    ["payment", 8, ["M-Pesa phone number", "Send M-Pesa prompt"]],
    ["paid", 6, ["Print receipt", "View order details", "Track this order"]],
  ] as const) {
    account.user = accountFor(state);
    await page.evaluate(({ key, user }) => localStorage.setItem(key, JSON.stringify(user)), { key: STORAGE_KEYS.customerUser, user: account.user });
    await page.goto("/#/cart");
    await page.reload();
    await openCheckoutState(page, state, orders);
    // From the step heading onward, through the step's controls (and on Review, the order total beside it).
    await page.getByRole("main").getByRole("heading", { level: 2 }).first().focus();
    const visited = await tabClearOfStickyChrome(page, presses);
    expect(visited, state).toEqual(expect.arrayContaining([...expected]));
  }
});
