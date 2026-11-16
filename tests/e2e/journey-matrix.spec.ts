import type { BrowserContext, Locator, Page } from "@playwright/test";
import type { Address, User } from "../../src/api/auth";
import type { Order, OrderTracking, Quote } from "../../src/api/orders";
import { linenShirt } from "../../src/test-support/catalogFixtures";
import { fixturePendingOrder } from "../../src/test-support/checkoutFixtures";
import { fixtureCustomerOrder } from "../../src/test-support/orderFixtures";
import { PAYABLE, PAYMENT_MESSAGES, fixtureAttempt, fixtureConfirmedAttempt, fixturePaymentOverview } from "../../src/test-support/paymentFixtures";
import { formatKES } from "../../src/utils/format";
import { STORAGE_KEYS, shopperStateKey } from "../../src/utils/storage";
import { layoutProblems } from "./adminFixtures";
import { CUSTOMER_TOKEN, ORIGIN, browserQuote, customer, expect, orderPage, servePaymentOverview, test } from "./fixtures";

/*
 * P7 close: one representative purchase, walked at every size the brief names. Home → search → a filtered listing →
 * a multi-variant product (options chosen) → mini-cart → cart → checkout (first address, review and reserve, M-Pesa
 * prompt accepted, then paid) → the printed receipt → the account order → tracking. Every API is mocked: nothing is
 * priced, charged or sent in the browser, and the figures are the server quote fixture's.
 * At each step: no page-level sideways scrolling, exactly one H1, the step's main action visible and, once focused,
 * inside the window, clear of the sticky chrome and uncovered, no console errors or uncaught errors, and the amounts
 * shown agree with the quote.
 * Matrix (`MATRIX`): every size at 100% and 200% text (the root font size doubled, as in the other reflow checks), plus
 * phone landscape and reduced motion once each; no cell is left out.
 */

const FIRST_ADDRESS: Address = { id: "addr-journey", street: "12 Moi Avenue", city: "Nairobi", county: "Nairobi", postalCode: null, isDefault: true };
const shopper: User = { ...customer, id: "browser-journey", email: "journey@example.test", addresses: [] };
const PHONE = "0712 345 678";
/** Keeps the payment panel's automatic checks out of the way of the journey's own clicks. */
const later = () => new Date(Date.now() + 60_000).toISOString();

/** The server's quote for the first address: KES 1,000 less KES 100, KES 144 VAT and KES 200 delivery, KES 1,244. */
const quote: Quote = browserQuote({
  address: { id: FIRST_ADDRESS.id, street: FIRST_ADDRESS.street, city: FIRST_ADDRESS.city, county: FIRST_ADDRESS.county, postalCode: null },
});
/** The checkout summary's rows for that quote, label and amount as shown. */
const QUOTE_ROWS = [
  ["Items subtotal", formatKES(quote.subtotal)],
  ["Savings", `−${formatKES(quote.discount)}`],
  ["Subtotal after savings", formatKES(quote.discountedSubtotal)],
  [`VAT (${quote.vatRate}%)`, formatKES(quote.tax)],
  ["Standard delivery", formatKES(quote.shippingCost)],
  ["Total", formatKES(quote.total)],
];

/** Everything the journey asks the server for, answered as the API would; returns what the browser sent. */
async function serveJourney(context: BrowserContext) {
  const account = { user: shopper };
  const sent = { addresses: [] as unknown[], quotes: [] as unknown[], reservations: [] as unknown[], prompts: [] as unknown[] };
  await context.addInitScript(({ user, keys, shopperKey, token, origin }) => {
    window.print = () => {};
    if (location.origin !== origin || sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem(keys.customerUser, JSON.stringify(user));
    localStorage.setItem(keys.customerToken, token);
    localStorage.setItem(keys.customerRefreshToken, "browser-only-refresh-token");
    localStorage.setItem(shopperKey, JSON.stringify({ cart: [], wishlist: [] }));
  }, { user: shopper, keys: STORAGE_KEYS, shopperKey: shopperStateKey(shopper.id), token: CUSTOMER_TOKEN, origin: ORIGIN });
  await context.route("**/api/auth/me", (route) => route.fulfill({ json: account.user }));
  await context.route("**/api/auth/addresses", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    sent.addresses.push(route.request().postDataJSON());
    account.user = { ...account.user, addresses: [FIRST_ADDRESS] };
    return route.fulfill({ status: 201, json: FIRST_ADDRESS });
  });
  await context.route("**/api/orders/quotes", (route) => {
    sent.quotes.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: quote });
  });

  const reserved = fixturePendingOrder(quote);
  const paid: Order = { ...reserved, paymentStatus: "PAID", reservationStatus: "COMMITTED", reservationExpiresAt: null };
  let stage: "unpaid" | "prompted" | "paid" = "unpaid";
  const accountOrder = () => fixtureCustomerOrder(stage === "paid" ? paid : reserved);
  await context.route("**/api/orders", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    sent.reservations.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: reserved });
  });
  await context.route("**/api/orders?*", (route) => route.fulfill({ json: orderPage([accountOrder()]) }));
  await context.route(`**/api/orders/${reserved.id}`, (route) => route.fulfill({ json: accountOrder() }));
  const tracking: OrderTracking = {
    orderNumber: reserved.orderNumber, status: "PENDING",
    trackingHistory: [{ id: "event-placed", status: "PENDING", description: "Order placed", location: null, createdAt: reserved.createdAt, actorType: null }],
  };
  await context.route(`**/api/orders/track/${reserved.orderNumber}`, (route) => route.fulfill({ json: tracking }));

  // Re-dated when the prompt is accepted, so a slow run cannot reach the automatic check before the journey's own.
  let attempt = fixtureAttempt(reserved, { nextCheckAt: later() });
  await servePaymentOverview(context, reserved, () => {
    if (stage === "unpaid") return fixturePaymentOverview(reserved, PAYABLE);
    if (stage === "prompted") {
      return fixturePaymentOverview(reserved, { ...PAYABLE, available: false, reasonCode: "PAYMENT_EXISTS", message: PAYMENT_MESSAGES.exists, attempts: [attempt] });
    }
    return fixturePaymentOverview(paid, {
      environment: "production", reasonCode: "ORDER_NOT_PAYABLE", message: "This order is not awaiting payment on an active reservation.",
      attempts: [fixtureConfirmedAttempt(reserved)],
    });
  });
  await context.route("**/api/mpesa/stk-push", (route) => {
    sent.prompts.push(route.request().postDataJSON());
    stage = "prompted";
    attempt = fixtureAttempt(reserved, { nextCheckAt: later() });
    return route.fulfill({ status: 201, json: attempt });
  });
  await context.route(`**/api/mpesa/payments/${attempt.id}/query`, (route) => {
    stage = "paid";
    return route.fulfill({ json: fixtureConfirmedAttempt(reserved) });
  });
  return { reserved, sent };
}

/** Console errors (failed loads included) and uncaught errors or rejections from the page and any window it opens, each
 * with the step it happened in. */
function watchConsole(context: BrowserContext, step: () => string) {
  const errors: string[] = [];
  const watch = (target: Page) => {
    target.on("console", (message) => {
      if (message.type() === "error") errors.push(`${step()}: ${message.text()}`);
    });
    target.on("pageerror", (error) => errors.push(`${step()}: uncaught ${error.message}`));
  };
  context.pages().forEach(watch);
  context.on("page", watch);
  return errors;
}

/** Waits until `element` stops moving (smooth scrolling), then reports where it sits against the window and sticky chrome. */
const settledPlace = (element: Element) => new Promise<{
  top: number; bottom: number; chrome: number; height: number; covered: string[]; above: boolean; focused: boolean; scrollY: number;
}>((resolve) => {
  let last = "";
  let still = 0;
  let frames = 0;
  const settle = () => {
    const box = element.getBoundingClientRect();
    still = `${box.top},${box.left}` === last ? still + 1 : 0;
    last = `${box.top},${box.left}`;
    frames += 1;
    if (still < 2 && frames < 120) {
      requestAnimationFrame(settle);
      return;
    }
    const chrome = Math.max(0, ...[...document.querySelectorAll("[data-sticky-header]")]
      .filter((node) => getComputedStyle(node).position === "sticky")
      .map((node) => node.getBoundingClientRect().bottom));
    // Points just inside each corner and the centre: whatever is drawn there must be the action itself.
    const inset = Math.min(4, box.width / 4, box.height / 4);
    const points: [number, number][] = [
      [box.left + inset, box.top + inset], [box.right - inset, box.top + inset], [box.left + box.width / 2, box.top + box.height / 2],
      [box.left + inset, box.bottom - inset], [box.right - inset, box.bottom - inset],
    ];
    const covered = points.flatMap(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return hit && (element === hit || element.contains(hit)) ? [] : [`${hit?.tagName ?? "nothing"} at ${Math.round(x)},${Math.round(y)}`];
    });
    resolve({
      top: box.top, bottom: box.bottom, chrome, height: window.innerHeight, covered,
      above: element.closest("dialog[open], [data-sticky-header]") !== null,
      focused: document.activeElement === element, scrollY: window.scrollY,
    });
  };
  requestAnimationFrame(settle);
});

/**
 * The checks every step makes: nothing scrolls sideways, there is one H1, and the main action shows and, focused, sits
 * wholly in the window, below the sticky chrome (unless it is in a dialog or the chrome itself) and uncovered.
 */
async function checkStep(target: Page, step: string, action: Locator, errors: string[]) {
  const layout = await layoutProblems(target);
  expect(layout.overflow, `${step}: page-level sideways scrolling (px), widest boxes: ${layout.offenders.join("; ")}`).toBeLessThanOrEqual(0);
  await expect(target.locator("h1"), `${step}: exactly one H1`).toHaveCount(1);
  await expect(action, `${step}: main action visible`).toBeVisible();
  // Let any scrolling the step started (smooth scrolls to a moved focus, for example) finish before focusing.
  const { top, scrollY } = await action.evaluate(settledPlace);
  await action.focus();
  const place = await action.evaluate(settledPlace);
  const where = `${step}: ${JSON.stringify({ before: { top, scrollY }, ...place })}`;
  expect(place.top, `${where}: main action inside the window`).toBeGreaterThanOrEqual(0);
  expect(place.bottom, `${where}: main action above the window's bottom edge`).toBeLessThanOrEqual(place.height + 0.5);
  if (!place.above) expect(place.top, `${where}: main action below the sticky header`).toBeGreaterThanOrEqual(place.chrome - 0.5);
  expect(place.covered, `${where}: main action covered`).toEqual([]);
  expect(errors, `${step}: console or uncaught errors`).toEqual([]);
}

type TextSize = "100%" | "200%";
type Cell = { project: "mobile" | "desktop"; width: number; height: number; text: TextSize; reducedMotion?: boolean };

const TEXT_SIZES: readonly TextSize[] = ["100%", "200%"];
/** The phone and tablet sizes run in the mobile project (touch, mobile viewport), the wider ones in the desktop project. */
const MOBILE_SIZES = [{ width: 360, height: 780 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 768, height: 1024 }];
const DESKTOP_SIZES = [{ width: 1024, height: 768 }, { width: 1280, height: 900 }, { width: 1440, height: 900 }];
/** Every size at both text sizes, plus phone landscape and reduced motion once each. */
const MATRIX: readonly Cell[] = [
  ...MOBILE_SIZES.flatMap((size) => TEXT_SIZES.map((text): Cell => ({ project: "mobile", ...size, text }))),
  ...DESKTOP_SIZES.flatMap((size) => TEXT_SIZES.map((text): Cell => ({ project: "desktop", ...size, text }))),
  { project: "mobile", width: 844, height: 390, text: "100%" },
  { project: "desktop", width: 1280, height: 900, text: "100%", reducedMotion: true },
];
/** From this width checkout shows its summary as a column beside the step (`md`), not as a disclosure above it. */
const SUMMARY_COLUMN_WIDTH = 768;
/** From this width the listing shows its filters as a column (`xl`), not in a sheet. */
const FILTER_COLUMN_WIDTH = 1280;
/** One journey with its checks at every step, on a loaded host. */
const JOURNEY_TIMEOUT_MS = 120_000;

const cellName = (cell: Cell) => `${cell.width}x${cell.height}, ${cell.text} text${cell.reducedMotion ? ", reduced motion" : ""}`;

/** Doubles the text of the current document; the app's own navigation keeps the document, so this lasts the journey. */
const setText = (target: Page, text: TextSize) =>
  target.evaluate((size) => { document.documentElement.style.fontSize = size; }, text === "200%" ? "200%" : "");

async function walkJourney(page: Page, context: BrowserContext, cell: Cell) {
  const { reserved, sent } = await serveJourney(context);
  let step = "start";
  const errors = watchConsole(context, () => step);
  await page.setViewportSize({ width: cell.width, height: cell.height });
  if (cell.reducedMotion) await page.emulateMedia({ reducedMotion: "reduce" });
  const main = page.getByRole("main");
  const sheetFilters = cell.width < FILTER_COLUMN_WIDTH;

  step = "home";
  await page.goto("/");
  await setText(page, cell.text);
  await expect(page.getByRole("list", { name: "Featured products" })).toBeVisible();
  const search = page.getByRole("combobox", { name: "Search products" });
  await checkStep(page, step, search, errors);

  step = "search";
  await search.fill("linen");
  await search.press("Enter");
  await expect(page).toHaveURL(/#\/shop\?q=linen$/);
  await expect(page.getByRole("heading", { level: 1, name: 'Results for "linen"' })).toBeVisible();
  const openFilters = page.getByRole("button", { name: /^Filters/ });
  const filters = sheetFilters ? page.getByRole("dialog", { name: "Product filters" }) : page.getByRole("complementary", { name: "Filters" });
  const sizeM = filters.getByRole("group", { name: "Size" }).getByRole("checkbox", { name: /^M/ });
  await checkStep(page, step, sheetFilters ? openFilters : sizeM, errors);

  step = "filtered listing";
  if (sheetFilters) await openFilters.click();
  await sizeM.check();
  await expect(page).toHaveURL(/#\/shop\?q=linen&a\.size=M$/);
  if (sheetFilters) await filters.getByRole("button", { name: /^Show \d+ results?$/ }).click();
  await expect(filters.getByRole("group", { name: "Size" })).toHaveCount(sheetFilters ? 0 : 1);
  const productLink = page.getByRole("list", { name: "Products" }).getByRole("link", { name: linenShirt.name, exact: true });
  await expect(page.getByRole("list", { name: "Products" }).getByRole("listitem")).toHaveCount(1);
  await checkStep(page, step, productLink, errors);

  step = "product";
  await productLink.click();
  await expect(page.getByRole("heading", { level: 1, name: linenShirt.name })).toBeVisible();
  // As the shopper arrives: nothing chosen yet, so the page's action asks for the options.
  await checkStep(page, `${step} (options not chosen)`, main.getByRole("button", { name: "Choose options", exact: true }).first(), errors);
  await main.getByRole("group", { name: /^Size/ }).getByRole("button", { name: "M", exact: true }).click();
  await main.getByRole("group", { name: /^Color/ }).getByRole("button", { name: "White", exact: true }).click();
  // The page's own button; the phone purchase bar repeats it later in the page while this one is off screen.
  const add = main.getByRole("button", { name: "Add to cart", exact: true }).first();
  await expect(add).toBeEnabled();
  await checkStep(page, step, add, errors);

  step = "mini-cart";
  await add.click();
  const drawer = page.getByRole("dialog", { name: "Your cart" });
  await expect(drawer.getByRole("link", { name: linenShirt.name })).toBeVisible();
  // The browser's estimate of the items is the quote's subtotal after savings; fees wait for the server.
  await expect(drawer.getByText("Subtotal (excl. VAT)").locator("xpath=following-sibling::*[1]")).toHaveText(formatKES(quote.discountedSubtotal));
  const viewCart = drawer.getByRole("link", { name: "View cart" });
  await checkStep(page, step, viewCart, errors);

  step = "cart";
  await viewCart.click();
  await expect(page.getByRole("heading", { level: 1, name: "Your cart" })).toBeVisible();
  const summary = page.getByRole("region", { name: "Order summary" });
  await expect(summary.getByText("Subtotal (excl. VAT)").locator("xpath=following-sibling::*[1]")).toHaveText(formatKES(quote.discountedSubtotal));
  const toCheckout = summary.getByRole("link", { name: "Continue to checkout" });
  await checkStep(page, step, toCheckout, errors);

  step = "checkout: delivery";
  await toCheckout.click();
  await expect(main.getByRole("heading", { level: 2, name: "Delivery", exact: true })).toBeVisible();
  await main.getByRole("textbox", { name: "Street address" }).fill(FIRST_ADDRESS.street);
  await main.getByRole("textbox", { name: "Town or city" }).fill(FIRST_ADDRESS.city);
  await main.getByRole("textbox", { name: "County" }).fill(FIRST_ADDRESS.county);
  const saveAddress = main.getByRole("button", { name: "Save and continue" });
  await checkStep(page, step, saveAddress, errors);

  step = "checkout: review";
  await saveAddress.click();
  await expect(main.getByRole("heading", { level: 2, name: "Review and reserve", exact: true })).toBeVisible();
  const total = page.getByRole("region", { name: "Order total" });
  await expect(total.getByText(formatKES(quote.total), { exact: true })).toBeVisible();
  expect(await figures(total), "review: the order total's figures").toEqual(QUOTE_ROWS);
  // Below 768px the order summary is a disclosure above the step that repeats the figures; from 768px it is hidden here.
  const checkoutSummary = page.getByRole("region", { name: "Order summary" });
  if (cell.width < SUMMARY_COLUMN_WIDTH) {
    await checkoutSummary.getByRole("button", { name: "Show order summary" }).click();
    expect(await figures(checkoutSummary), "review: the order summary's figures").toEqual(QUOTE_ROWS);
  } else {
    await expect(checkoutSummary).toHaveCount(0);
  }
  const reserve = total.getByRole("button", { name: "Reserve order", exact: true });
  await checkStep(page, step, reserve, errors);

  step = "checkout: payment";
  await reserve.click();
  await expect(main.getByRole("heading", { level: 2, name: "Order reserved", exact: true })).toBeVisible();
  await expect(main.getByText(reserved.orderNumber, { exact: true })).toBeVisible();
  await expect(fact(main, "Order total")).toHaveText(formatKES(quote.total));
  const pay = page.getByRole("region", { name: "Pay with M-Pesa" });
  await pay.getByRole("textbox", { name: "M-Pesa phone number" }).fill(PHONE);
  const prompt = pay.getByRole("button", { name: "Send M-Pesa prompt" });
  await checkStep(page, step, prompt, errors);

  step = "checkout: prompt accepted";
  await prompt.click();
  await expect(pay.getByText("Approve the payment on your phone")).toBeVisible();
  const check = pay.getByRole("button", { name: "Check payment status" });
  await checkStep(page, step, check, errors);

  step = "checkout: paid";
  await check.click();
  await expect(main.getByRole("heading", { level: 2, name: "Order paid", exact: true })).toBeVisible();
  await expect(main.getByText("Payment received", { exact: true })).toBeVisible();
  await expect(fact(main, "Order total")).toHaveText(formatKES(quote.total));
  const print = main.getByRole("button", { name: "Print receipt" });
  await checkStep(page, step, print, errors);

  step = "receipt";
  const [receipt] = await Promise.all([page.waitForEvent("popup"), print.click()]);
  await receipt.waitForLoadState();
  // Playwright opens a popup at the context's default size, not the opener's; check it at the cell's size.
  await receipt.setViewportSize({ width: cell.width, height: cell.height });
  await setText(receipt, cell.text);
  await expect(receipt.locator(".title")).toContainText(`Order ${reserved.orderNumber}`);
  await expect(receipt.locator(".facts")).toContainText("Waiting to be prepared");
  await expect(receipt.locator(".facts")).toContainText("M-Pesa (paid)");
  expect(await receipt.locator(".totals p").evaluateAll((rows) => rows.map((row) => [...row.children].map((part) => part.textContent))))
    .toEqual([
      ["Subtotal", formatKES(quote.subtotal)], ["Discount", `-${formatKES(quote.discount)}`], [`VAT (${quote.vatRate}%)`, formatKES(quote.tax)],
      ["Delivery", formatKES(quote.shippingCost)], ["Total", formatKES(quote.total)],
    ]);
  // The receipt has no control of its own: its main content is the total, which must be reachable without sideways scrolling.
  const grandTotal = receipt.locator(".totals .grand");
  await grandTotal.scrollIntoViewIfNeeded();
  await checkStep(receipt, step, grandTotal, errors);
  await receipt.close();

  step = "account order";
  await main.getByRole("link", { name: "View order details" }).click();
  const details = page.getByRole("dialog", { name: "Receipt details" });
  await expect(details.getByText(reserved.orderNumber, { exact: true })).toBeVisible();
  await expect(details.getByText("Waiting to be prepared", { exact: true })).toBeVisible();
  await expect(details.getByText(formatKES(quote.total), { exact: true }).first()).toBeVisible();
  const track = details.getByRole("button", { name: "Track order" });
  await checkStep(page, step, track, errors);

  step = "tracking";
  await track.click();
  await expect(page).toHaveURL(new RegExp(`#/track\\?order=${reserved.orderNumber}$`));
  const result = page.getByRole("region", { name: `Order ${reserved.orderNumber}` });
  await expect(result.getByText("Order placed", { exact: true }).first()).toBeVisible();
  const active = page.getByRole("region", { name: "Your active orders" });
  await expect(active.getByText("Waiting to be prepared", { exact: true })).toBeVisible();
  await checkStep(page, step, page.getByRole("button", { name: "Track order", exact: true }), errors);

  // What reached the server: one address, quotes for it, one reservation and one prompt.
  expect(sent.addresses).toEqual([{ street: FIRST_ADDRESS.street, city: FIRST_ADDRESS.city, county: FIRST_ADDRESS.county, isDefault: true }]);
  expect(sent.quotes.length, "quotes requested").toBeGreaterThan(0);
  expect(sent.quotes.every((body) => (body as { addressId?: string }).addressId === FIRST_ADDRESS.id)).toBe(true);
  expect(sent.reservations).toEqual([{ quoteId: quote.id }]);
  expect(sent.prompts).toEqual([{ orderId: reserved.id, phone: "254712345678" }]);
}

/** A labelled fact's value on the Payment step. */
const fact = (scope: Locator, label: string) => scope.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");

/** The figure rows shown in `scope`, label to amount. */
const figures = (scope: Locator) =>
  scope.locator("dl > div").evaluateAll((rows) => rows.map((row) => [row.querySelector("dt")?.textContent, row.querySelector("dd")?.textContent]));

test.describe("representative purchase journey across the matrix", () => {
  for (const cell of MATRIX) {
    test(cellName(cell), async ({ page, context }, testInfo) => {
      test.skip(testInfo.project.name !== cell.project, `runs in the ${cell.project} project`);
      test.setTimeout(JOURNEY_TIMEOUT_MS);
      await walkJourney(page, context, cell);
    });
  }
});
