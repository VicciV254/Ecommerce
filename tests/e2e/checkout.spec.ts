import { browserQuote, expect, linenCartLine, shopperState, signInCustomer, test } from "./fixtures";
import { fixturePendingOrder, linenLine } from "../../src/test-support/checkoutFixtures";

const REQUEST_KEY = /^[A-Za-z0-9:_-]{16,128}$/;
/** SAVE10 beats the automatic 10% offer here: KES 850 + KES 136 VAT + KES 200 delivery. */
const couponTotals = {
  id: "quote-coupon", couponCode: "SAVE10", couponApplied: true,
  lines: [{ ...linenLine, unitPrice: 1000, total: 850, couponDiscount: 150, discount: 150, discountId: "disc-coupon" }],
  discount: 150, discountedSubtotal: 850, tax: 136, total: 1186,
};
/** The offer ended between review and submission: KES 1,000 + KES 160 VAT + KES 200 delivery. */
const repricedTotals = {
  id: "quote-2", lines: [{ ...linenLine, unitPrice: 1000, total: 1000, discount: 0, discountId: null }],
  discount: 0, discountedSubtotal: 1000, tax: 160, total: 1360,
};

test("a cart quote with a coupon is reviewed and reserved as one unpaid pending order", async ({ page, context }) => {
  await signInCustomer(page, [linenCartLine]);
  const quoted: unknown[] = [];
  await context.route("**/api/orders/quotes", async (route) => {
    const body = route.request().postDataJSON();
    quoted.push(body);
    return route.fulfill({ status: 201, json: browserQuote(body.couponCode === "SAVE10" ? couponTotals : {}) });
  });
  const placed: { key: string | undefined; body: unknown }[] = [];
  await context.route("**/api/orders", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    placed.push({ key: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() });
    return route.fulfill({ status: 201, json: fixturePendingOrder(browserQuote(couponTotals)) });
  });
  const payments: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/mpesa")) payments.push(request.url()); });

  await page.goto("/#/cart");
  const summary = page.getByRole("region", { name: "Order Summary" });
  await expect(summary.getByText("KES 1,244")).toBeVisible();
  await expect(summary.getByText("VAT (16%)")).toBeVisible();
  const coupon = summary.getByRole("textbox", { name: "Coupon code (optional)" });
  await coupon.fill("save10");
  await coupon.press("Enter");
  await expect(summary.getByText("KES 1,186")).toBeVisible();
  await expect(summary.getByText("Applied to your total.")).toBeVisible();
  await expect.poll(async () => (await shopperState(page)).couponCode).toBe("SAVE10");
  await summary.getByRole("link", { name: "Continue to Checkout" }).click();

  await expect(page).toHaveURL(/#\/checkout$/);
  const total = page.getByRole("region", { name: "Order Total" });
  await expect(total.getByText("KES 1,186")).toBeVisible();
  await expect(page.getByText("SAVE10", { exact: true })).toBeVisible();
  expect(quoted.at(-1)).toEqual({ items: [linenCartLine], addressId: "browser-address", deliveryMethod: "STANDARD", couponCode: "SAVE10", notes: null });
  await total.getByRole("button", { name: "Reserve Order" }).click();

  await expect(page.getByRole("heading", { name: "Order reserved" })).toBeFocused();
  await expect(page.getByText("APX-QUOTE-COUPON")).toBeVisible();
  await expect(page.getByText("Pending · not paid")).toBeVisible();
  await expect(page.getByText("Items held until")).toBeVisible();
  expect(placed).toEqual([{ key: expect.stringMatching(REQUEST_KEY), body: { quoteId: "quote-coupon" } }]);
  await expect.poll(() => shopperState(page)).toMatchObject({
    cart: [], couponCode: null, pendingOrder: null, acknowledgedOrderIds: ["order-quote-coupon"],
  });
  expect(payments).toEqual([]);
  await page.getByRole("link", { name: "View or cancel in your orders" }).click();
  await expect(page).toHaveURL(/#\/account\/orders$/);
});

test("saved and printed receipts explain the stored discount and VAT without recalculating totals", async ({ page, context }) => {
  await signInCustomer(page);
  await context.addInitScript(() => { window.print = () => {}; });
  const order = fixturePendingOrder(browserQuote(couponTotals));
  await context.route("**/api/orders?*", (route) => route.fulfill({
    json: { orders: [order], pagination: { page: 1, limit: 100, total: 1, pages: 1 } },
  }));
  await page.goto("/#/account/orders");
  await page.getByRole("button", { name: "Details", exact: true }).click();
  const receipt = page.getByRole("dialog", { name: "Receipt Details" });
  await expect(receipt).toContainText("Subtotal: KES 1,000");
  await expect(receipt).toContainText("Discount: -KES 150");
  await expect(receipt).toContainText("VAT (16%): KES 136");
  await expect(receipt).toContainText("Delivery fee: KES 200");
  await expect(receipt).toContainText("Total: KES 1,186");
  const [printed] = await Promise.all([
    page.waitForEvent("popup"),
    receipt.getByRole("button", { name: "Print Receipt", exact: true }).click(),
  ]);
  await expect(printed.locator(".totals p").filter({ hasText: "Discount" })).toContainText("-KES 150");
  await expect(printed.locator(".totals p").filter({ hasText: "VAT (16%)" })).toContainText("KES 136");
  await expect(printed.locator(".totals .grand")).toContainText("KES 1,186");
  await printed.close();
});

test("a lost order response is retried with the same key and settled after reload without a second order", async ({ page, context }) => {
  await signInCustomer(page, [linenCartLine]);
  await context.route("**/api/orders/quotes", (route) => route.fulfill({ status: 201, json: browserQuote() }));
  const keys: (string | undefined)[] = [];
  await context.route("**/api/orders", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    keys.push(route.request().headers()["idempotency-key"]);
    // The server may have committed the order; only the response is lost.
    return route.abort("failed");
  });
  let reachable = false;
  await context.route("**/api/orders/quotes/quote-1", (route) => reachable
    ? route.fulfill({ json: browserQuote({ consumed: true, orderId: "order-quote-1" }) })
    : route.abort("failed"));
  await context.route("**/api/orders/order-quote-1", (route) => route.fulfill({ json: fixturePendingOrder(browserQuote()) }));

  await page.goto("/#/checkout");
  await page.getByRole("button", { name: "Reserve Order" }).click();
  await expect(page.getByRole("heading", { name: "Finishing your earlier order request" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reserve Order" })).toHaveCount(0);
  const stored = await shopperState(page);
  expect(stored.pendingOrder).toMatchObject({ quoteId: "quote-1", idempotencyKey: keys[0] });
  expect(stored.cart).toEqual([linenCartLine]);

  await expect(page.getByText(/We could not check your earlier order request/)).toBeVisible();
  const retry = page.getByRole("button", { name: "Retry the same request" });
  await expect(retry).toHaveAttribute("aria-disabled", "false");
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => keys.length).toBe(2);
  await expect(retry).toHaveAttribute("aria-disabled", "false");
  await expect(retry).toBeFocused();
  expect(keys[1]).toBe(keys[0]);
  expect(keys[0]).toMatch(REQUEST_KEY);

  reachable = true;
  await page.reload();
  await expect(page.getByRole("heading", { name: "Order reserved" })).toBeVisible();
  await expect(page.getByText("APX-QUOTE-1")).toBeVisible();
  expect(keys).toHaveLength(2);
  await expect.poll(() => shopperState(page)).toMatchObject({ cart: [], pendingOrder: null, acknowledgedOrderIds: ["order-quote-1"] });
});

test("a changed total must be explicitly reviewed before a new reservation is sent", async ({ page, context }) => {
  await signInCustomer(page, [linenCartLine]);
  let repriced = false;
  await context.route("**/api/orders/quotes", (route) => route.fulfill({ status: 201, json: browserQuote(repriced ? repricedTotals : {}) }));
  const posts: { key: string | undefined; quoteId: string }[] = [];
  await context.route("**/api/orders", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const { quoteId } = route.request().postDataJSON();
    posts.push({ key: route.request().headers()["idempotency-key"], quoteId });
    if (quoteId !== "quote-1") return route.fulfill({ status: 201, json: fixturePendingOrder(browserQuote(repricedTotals)) });
    repriced = true;
    return route.fulfill({ status: 409, json: { error: "Prices, delivery or the address changed. Request and review a new quote.", code: "QUOTE_CHANGED" } });
  });

  await page.goto("/#/checkout");
  const reserve = page.getByRole("button", { name: "Reserve Order" });
  await reserve.click();
  await expect(page.getByText(/Your total changed from KES 1,244 to KES 1,360\./)).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Nothing was reserved." })).toBeVisible();
  await expect(reserve).toBeDisabled();
  const confirm = page.getByRole("button", { name: "I Have Reviewed the New Total" });
  await confirm.focus();
  await page.keyboard.press("Enter");
  await expect(reserve).toBeEnabled();
  await reserve.click();
  await expect(page.getByRole("heading", { name: "Order reserved" })).toBeVisible();
  expect(posts.map((post) => post.quoteId)).toEqual(["quote-1", "quote-2"]);
  expect(posts[1].key).not.toBe(posts[0].key);
});

test("cart and checkout stack on phones, sit side by side from tablets and never overflow the page", async ({ page, context, isMobile }) => {
  await signInCustomer(page, [linenCartLine]);
  await context.route("**/api/orders/quotes", (route) => route.fulfill({ status: 201, json: browserQuote() }));
  for (const width of isMobile ? [360, 390, 768] : [1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of [
      { path: "/#/cart", items: page.getByRole("list", { name: "Cart items" }), summary: page.getByRole("region", { name: "Order Summary" }) },
      { path: "/#/checkout", items: page.getByRole("region", { name: "Items" }), summary: page.getByRole("region", { name: "Order Total" }) },
    ]) {
      await page.goto(view.path);
      await expect(view.summary.getByText("KES 1,244")).toBeVisible();
      const items = await view.items.boundingBox();
      const summary = await view.summary.boundingBox();
      expect(items && summary, `${view.path} at ${width}px renders both columns`).toBeTruthy();
      if (!items || !summary) continue;
      expect(summary.x + summary.width, `${view.path} summary fits at ${width}px`).toBeLessThanOrEqual(width + 0.5);
      if (width < 768) expect(summary.y, `${view.path} stacks at ${width}px`).toBeGreaterThanOrEqual(items.y + items.height);
      else expect(summary.x, `${view.path} is side by side at ${width}px`).toBeGreaterThanOrEqual(items.x + items.width);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${view.path} page overflow at ${width}px`).toBeLessThanOrEqual(0);
    }
  }
});

test("checkout totals and the primary action remain usable with doubled text", async ({ page, context, isMobile }) => {
  await signInCustomer(page, [linenCartLine]);
  await context.route("**/api/orders/quotes", (route) => route.fulfill({ status: 201, json: browserQuote() }));
  await page.setViewportSize({ width: isMobile ? 360 : 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/checkout");
  const total = page.getByRole("region", { name: "Order Total" });
  await expect(total.getByText("KES 1,244", { exact: true })).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expect(total.getByText("VAT (16%)", { exact: true })).toBeVisible();
  const reserve = total.getByRole("button", { name: "Reserve Order" });
  await reserve.scrollIntoViewIfNeeded();
  await reserve.focus();
  await expect(reserve).toBeFocused();
  await expect(reserve).toBeInViewport();
  const layout = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth - width;
    return {
      overflow,
      scrollX,
      elements: overflow <= 0 ? [] : [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((element) => element.getBoundingClientRect().right + scrollX > width + 1 ||
          (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1))
        .slice(0, 25)
        .map((element) => ({
          tag: element.tagName, classes: element.className, text: element.textContent?.slice(0, 60),
          right: element.getBoundingClientRect().right + scrollX,
          client: element.clientWidth, scroll: element.scrollWidth,
        })),
    };
  });
  expect(layout.overflow, JSON.stringify(layout)).toBeLessThanOrEqual(0);
});
