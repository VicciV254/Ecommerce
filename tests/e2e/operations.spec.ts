import type { BrowserContext, Locator, Page } from "@playwright/test";
import type { AttentionItem, StaffOrder, StaffRefund } from "../../src/api/admin";
import type { CustomerOrder, Order, ReturnRequestBody } from "../../src/api/orders";
import { fixturePendingOrder, linenLine, poloLine } from "../../src/test-support/checkoutFixtures";
import {
  fixtureAttention,
  fixtureDeliveredOrder,
  fixtureRefund,
  fixtureReturn,
  fixtureStaffOrder,
  fixtureStaffRefund,
  fixtureStaffReturn,
  noFulfilment,
} from "../../src/test-support/orderFixtures";
import { STORAGE_NAMESPACE } from "../../src/utils/storage";
import {
  browserQuote,
  clippedWithin,
  expect,
  orderPage,
  pageOverflow,
  servePaymentOverview,
  serveStaffOrders,
  signInCustomer,
  signInStaff,
  test,
} from "./fixtures";

const REQUEST_KEY = /^[A-Za-z0-9:_-]{16,128}$/;
const MIN_TARGET = 44;
/** Two linen shirts (any reason) and a face cream returnable only unopened or faulty, delivered yesterday. */
const delivered: CustomerOrder = fixtureDeliveredOrder(
  fixturePendingOrder(browserQuote({
    id: "quote-delivered",
    lines: [
      { ...linenLine, quantity: 2, total: 1800 },
      { ...poloLine, productId: "prod-cream", variantId: "var-cream", sku: "CREAM", productName: "Face Cream" },
    ],
  })),
  { rules: { "item-2": "UNOPENED_OR_FAULT" } },
);
const RETURN_NUMBER = `RMA-${delivered.orderNumber}-1`;

/** Serves the order history and accepts return requests as the API does, recording what was sent. */
async function serveReturns(context: BrowserContext) {
  const requests: { key?: string; body: ReturnRequestBody }[] = [];
  let current = delivered;
  await context.route("**/api/orders?*", (route) => route.fulfill({ json: orderPage([current]) }));
  await context.route(`**/api/orders/${delivered.id}/returns`, (route) => {
    const body: ReturnRequestBody = route.request().postDataJSON();
    requests.push({ key: route.request().headers()["idempotency-key"], body });
    const items = new Map(delivered.items.map((item) => [item.id, item]));
    const returnRequest = fixtureReturn(delivered, {
      reason: body.reason, comment: body.comment ?? null, unopenedDeclared: body.unopenedDeclared ?? false,
      lines: body.lines.map((line, index) => ({
        id: `return-line-${index + 1}`, orderItemId: line.orderItemId, quantity: line.quantity, returnRule: "STANDARD",
        receivedQuantity: null, refundableQuantity: null,
        productName: items.get(line.orderItemId)?.productName ?? "", purchased: items.get(line.orderItemId)?.quantity ?? 1,
      })),
    });
    const claimed = new Map(body.lines.map((line) => [line.orderItemId, line.quantity]));
    current = {
      ...delivered,
      returns: [returnRequest],
      returnEligibility: {
        ...delivered.returnEligibility,
        lines: delivered.returnEligibility.lines.map((line) => ({
          ...line, requested: claimed.get(line.orderItemId) ?? 0, returnableQuantity: line.returnableQuantity - (claimed.get(line.orderItemId) ?? 0),
        })),
      },
    };
    return route.fulfill({ status: 201, json: { returnRequest, order: current } });
  });
  return requests;
}

const savedReturnIntents = (page: Page) =>
  page.evaluate((prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)), `${STORAGE_NAMESPACE}:return-intent:`);

async function openReturnDialog(page: Page) {
  await page.goto("/#/account/orders");
  await page.getByRole("button", { name: "Request a return" }).click();
  const dialog = page.getByRole("dialog", { name: "Request a return" });
  await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
  return dialog;
}

/** The sheet's primary action stays visible, never covers the field being edited, and nothing overflows. */
async function expectReturnSheetFits(page: Page, dialog: Locator, label: string) {
  const submit = dialog.getByRole("button", { name: "Submit return request" });
  await expect(submit, label).toBeInViewport();
  const comment = dialog.getByRole("textbox", { name: "Comment (optional)" });
  await comment.focus();
  await expect(comment, label).toBeInViewport();
  const [field, button, more] = await Promise.all([
    comment.boundingBox(), submit.boundingBox(),
    dialog.getByRole("button", { name: "Return one more Linen Short-Sleeve Shirt" }).boundingBox(),
  ]);
  expect(field && button && more, `${label}: controls render`).toBeTruthy();
  if (!field || !button || !more) return;
  expect(field.y + field.height <= button.y || button.y + button.height <= field.y, `${label}: submit button covers the focused field`).toBe(true);
  expect(button.height, `${label}: submit target`).toBeGreaterThanOrEqual(MIN_TARGET);
  expect(more.height, `${label}: quantity target`).toBeGreaterThanOrEqual(MIN_TARGET);
  expect(await pageOverflow(page), `${label}: page overflow`).toBeLessThanOrEqual(0);
  expect(await clippedWithin(dialog.locator("form")), `${label}: clipped content`).toEqual([]);
}

test("a customer returns selected items from a delivered order with one request key", async ({ page, context, isMobile }) => {
  await signInCustomer(page);
  const requests = await serveReturns(context);
  const dialog = await openReturnDialog(page);
  const sheet = await dialog.locator("form").boundingBox();
  const viewport = page.viewportSize();
  expect(sheet && viewport).toBeTruthy();
  if (sheet && viewport) {
    // A full-height sheet on phones; a centred dialog no wider than 42rem on desktop.
    if (isMobile) expect(sheet.height).toBeGreaterThanOrEqual(viewport.height - 1);
    else expect(sheet.width).toBeLessThanOrEqual(672);
  }
  await expect(dialog).toContainText("The delivery fee is refunded only if staff confirm an item was faulty, damaged or wrong.");
  await expect(dialog).toContainText("Refund amounts are rounded up to the nearest whole shilling and never exceed what you paid.");

  await dialog.getByRole("button", { name: "Return one more Linen Short-Sleeve Shirt" }).click();
  await dialog.getByRole("button", { name: "Return one more Face Cream" }).click();
  await dialog.getByRole("combobox", { name: "Reason for return" }).selectOption({ label: "Changed my mind" });
  await dialog.getByRole("checkbox", { name: /I confirm Face Cream is unopened/ }).check();
  await dialog.getByRole("textbox", { name: "Comment (optional)" }).fill("Wrong size");
  await dialog.getByRole("button", { name: "Submit return request" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(`Return ${RETURN_NUMBER} requested. We will email you when staff have reviewed it. Nothing is refunded until the items are received and checked.`)).toBeVisible();
  await expect(page.getByText(`Return ${RETURN_NUMBER}: Awaiting review.`)).toBeVisible();
  // One linen shirt is still returnable, so the trigger remains and gets focus back.
  await expect(page.getByRole("button", { name: "Request a return" })).toBeFocused();
  expect(requests).toEqual([{
    key: expect.stringMatching(REQUEST_KEY),
    body: {
      reason: "CHANGED_MIND", comment: "Wrong size", unopenedDeclared: true,
      lines: [{ orderItemId: "item-1", quantity: 1 }, { orderItemId: "item-2", quantity: 1 }],
    },
  }]);
  expect(await savedReturnIntents(page)).toEqual([]);
});

test("the return sheet fits 360px, 768px and doubled text without hiding or overlapping its submit button", async ({ page, context, isMobile }) => {
  await signInCustomer(page);
  await serveReturns(context);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of isMobile ? [360, 768] : [1280]) {
    await page.setViewportSize({ width, height: 740 });
    const dialog = await openReturnDialog(page);
    await expectReturnSheetFits(page, dialog, `${width}px`);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
  await page.setViewportSize({ width: isMobile ? 360 : 1280, height: 740 });
  const dialog = await openReturnDialog(page);
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expectReturnSheetFits(page, dialog, "200% text");
});

test("keyboard users reach every receipt disclosure, and Tab wraps within the receipt both ways", async ({ page, context }) => {
  const received = new Date().toISOString();
  const settled: CustomerOrder = {
    ...delivered,
    returns: [fixtureReturn(delivered, { status: "RECEIVED", decidedAt: received, receivedAt: received, merchantFaultConfirmed: false })],
    refunds: [fixtureRefund({ status: "CONFIRMED", approvedAt: received, confirmedAt: received, providerReference: "QJK3L5M7N9" })],
  };
  await signInCustomer(page);
  await context.route("**/api/orders?*", (route) => route.fulfill({ json: orderPage([settled]) }));
  await servePaymentOverview(context, settled);
  await page.goto("/#/account/orders");
  await page.getByRole("button", { name: "Details", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Receipt details" });
  const close = dialog.getByRole("button", { name: "Close" });
  const print = dialog.getByRole("button", { name: "Print receipt" });
  const disclosure = (title: string) => dialog.locator("summary", { hasText: title });
  // Chromium starts on the receipt's scrollable region, which holds every control.
  await expect(dialog.locator(":focus")).toHaveCount(1);

  // The disclosures follow Print receipt, so they are the last stops before focus wraps to Close.
  for (const stop of [disclosure("Refunds"), disclosure("Returns"), disclosure("Progress"), print]) {
    await page.keyboard.press("Shift+Tab");
    await expect(stop).toBeFocused();
  }
  for (const stop of [disclosure("Progress"), disclosure("Returns"), disclosure("Refunds"), close]) {
    await page.keyboard.press("Tab");
    await expect(stop).toBeFocused();
  }
});

/* ------------------------------------------------------------------ */
/* Staff                                                               */
/* ------------------------------------------------------------------ */

const staffCustomer = { id: "customer-ops", firstName: "Ada", lastName: "Customer", email: "ada@example.test" };
const paidOrder = (quoteId: string, overrides: Partial<Order>): Order => ({
  ...fixturePendingOrder(browserQuote({ id: quoteId })), paymentStatus: "PAID", reservationStatus: "COMMITTED", reservationExpiresAt: null, ...overrides,
});

/** A paid order being prepared, and a delivered order whose return refund is being sent by M-Pesa. */
async function serveOperations(context: BrowserContext) {
  const toDispatch = paidOrder("quote-staff", { status: "PROCESSING" });
  const returned = paidOrder("quote-refund", { status: "DELIVERED" });
  const received = fixtureStaffReturn(returned, { status: "RECEIVED", receivedAt: new Date().toISOString(), merchantFaultConfirmed: false });
  const state: { dispatch: StaffOrder; refund: StaffRefund; refundOrder: StaffOrder } = {
    dispatch: fixtureStaffOrder(toDispatch, { user: staffCustomer, fulfilment: { ...noFulfilment, processingAt: new Date().toISOString() } }),
    refund: fixtureStaffRefund(returned.id, {
      id: "refund-ops", number: `RF-${returned.orderNumber}-1`, status: "PROCESSING", amount: 1044,
      returnRequestId: received.id, approvedAt: new Date().toISOString(), processingAt: new Date().toISOString(),
    }),
    refundOrder: fixtureStaffOrder(returned, { user: staffCustomer, returns: [received] }),
  };
  state.refundOrder = { ...state.refundOrder, refunds: [state.refund] };
  const attention: AttentionItem = fixtureAttention({
    key: `refund:${state.refund.id}:PROCESSING`, type: "REFUND_ACTION", severity: "medium",
    title: `Refund ${state.refund.number} is processing`, detail: "Continue the refund; approval alone does not send money.",
    orderId: returned.id, orderNumber: returned.orderNumber, entityId: state.refund.id,
  });
  const writes = { actions: [] as unknown[], confirms: [] as unknown[], reads: [] as unknown[] };
  await serveStaffOrders(context, () => [state.dispatch, state.refundOrder]);
  await context.route("**/api/admin/attention", (route) => route.fulfill({ json: { items: [attention] } }));
  await context.route("**/api/admin/attention/read", (route) => {
    writes.reads.push(route.request().postDataJSON());
    attention.read = true;
    return route.fulfill({ json: { read: 1 } });
  });
  await context.route(`**/api/orders/admin/${toDispatch.id}/actions`, (route) => {
    const body = route.request().postDataJSON();
    writes.actions.push(body);
    state.dispatch = {
      ...state.dispatch, status: "SHIPPED", trackingNumber: body.trackingNumber ?? null, allowedActions: ["CONFIRM_DELIVERY"],
      fulfilment: { ...state.dispatch.fulfilment, shippedAt: new Date().toISOString() },
    };
    return route.fulfill({ json: state.dispatch });
  });
  await context.route(`**/api/orders/admin/refunds/${state.refund.id}/confirm`, (route) => {
    const body = route.request().postDataJSON();
    writes.confirms.push(body);
    state.refund = { ...state.refund, status: "CONFIRMED", providerReference: body.providerReference, confirmedAt: new Date().toISOString(), allowedActions: [] };
    state.refundOrder = { ...state.refundOrder, paymentStatus: "PARTIALLY_REFUNDED", refunds: [state.refund] };
    return route.fulfill({ json: { refund: state.refund, order: state.refundOrder } });
  });
  return { state, writes, toDispatch, returned };
}

async function openOrdersTab(page: Page) {
  await signInStaff(page, "ADMIN");
  await page.goto("/#/admin/orders/orders");
}

test("staff dispatch with a permitted step and record a sent M-Pesa refund", async ({ page, context }) => {
  const { state, writes, toDispatch, returned } = await serveOperations(context);
  await openOrdersTab(page);
  const attention = page.getByRole("region", { name: "Needs attention" });
  const item = attention.getByRole("listitem").filter({ hasText: `Refund ${state.refund.number} is processing` });
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: /^Mark read/ }).click();
  await expect(item.getByText("Read", { exact: true })).toBeVisible();
  // Reading an item never hides the work it describes.
  await expect(item).toBeVisible();
  expect(writes.reads).toEqual([{ keys: [`refund:${state.refund.id}:PROCESSING`] }]);

  const processing = page.getByRole("region", { name: "Processing", exact: true });
  await expect(processing.getByText("1 order", { exact: true })).toBeVisible();
  await expect(processing.getByRole("button", { name: `Dispatch ${toDispatch.orderNumber}` })).toBeVisible();
  await expect(processing.getByRole("button", { name: /Start processing|Confirm delivery|Mark ready/ })).toHaveCount(0);
  await processing.getByRole("button", { name: `Open order ${toDispatch.orderNumber}` }).click();
  await expect(page.getByRole("heading", { name: `Order ${toDispatch.orderNumber}` })).toBeFocused();
  const next = page.getByRole("region", { name: "Next step" });
  await next.getByRole("button", { name: "Dispatch", exact: true }).click();
  const dispatch = page.getByRole("dialog", { name: `Dispatch · ${toDispatch.orderNumber}` });
  await dispatch.getByRole("textbox", { name: "Tracking number (optional)" }).fill("TRK-0042");
  await dispatch.getByRole("button", { name: "Dispatch", exact: true }).click();
  await expect(dispatch).toHaveCount(0);
  await expect(page.getByText(`Order ${toDispatch.orderNumber} is marked as dispatched.`)).toBeVisible();
  await expect(next.getByRole("button", { name: "Confirm delivery" })).toBeVisible();
  expect(writes.actions).toEqual([{ action: "DISPATCH", expectedStatus: "PROCESSING", trackingNumber: "TRK-0042" }]);

  await page.getByRole("button", { name: "← Back to orders" }).click();
  await item.getByRole("button", { name: /^Open/ }).click();
  await expect(page.getByRole("heading", { name: `Order ${returned.orderNumber}` })).toBeVisible();
  const refundHeading = page.getByRole("heading", { name: state.refund.number });
  await expect(refundHeading).toBeFocused();
  const card = page.getByRole("listitem").filter({ has: refundHeading });
  await expect(card.getByText("Approval does not send money. Record the M-Pesa reference only after the refund has been sent.")).toBeVisible();
  await expect(card.getByRole("button", { name: /Approve refund|Cancel refund/ })).toHaveCount(0);
  await card.getByRole("button", { name: `Record M-Pesa reference ${state.refund.number}` }).click();
  const confirm = page.getByRole("dialog", { name: `Record M-Pesa reference · ${state.refund.number}` });
  const reference = confirm.getByRole("textbox", { name: "M-Pesa reference (required)" });
  await reference.fill("qa12bc34de");
  await expect(reference).toHaveValue("QA12BC34DE");
  await confirm.getByRole("button", { name: "Record M-Pesa reference" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(card.getByText("Sent — M-Pesa reference recorded")).toBeVisible();
  await expect(card.getByText("QA12BC34DE", { exact: true })).toBeVisible();
  expect(writes.confirms).toEqual([{ expectedStatus: "PROCESSING", providerReference: "QA12BC34DE" }]);
});

test("the order workspace keeps its total, payment state and permitted steps reachable at 360px, 768px and doubled text", async ({ page, context, isMobile }) => {
  const { toDispatch } = await serveOperations(context);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openOrdersTab(page);
  for (const [width, scale] of (isMobile ? [[360, 1], [768, 1], [360, 2]] : [[1280, 1], [1280, 2]]) as [number, number][]) {
    const label = `${width}px${scale > 1 ? " at 200% text" : ""}`;
    await page.setViewportSize({ width, height: 800 });
    await page.getByRole("region", { name: "Processing", exact: true }).getByRole("button", { name: `Open order ${toDispatch.orderNumber}` }).click();
    const heading = page.getByRole("heading", { name: `Order ${toDispatch.orderNumber}` });
    await expect(heading, label).toBeFocused();
    if (scale > 1) await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    const workspace = page.getByRole("region", { name: `Order ${toDispatch.orderNumber}` });
    await expect(workspace.getByText("KES 1,244").first(), label).toBeVisible();
    await expect(workspace.getByText("Payment: M-Pesa (paid)"), label).toBeVisible();
    const next = workspace.getByRole("region", { name: "Next step" });
    for (const name of ["Dispatch", "Cancel order"]) {
      const action = next.getByRole("button", { name, exact: true });
      await action.scrollIntoViewIfNeeded();
      await expect(action, `${label}: ${name}`).toBeInViewport();
      expect((await action.boundingBox())?.height ?? 0, `${label}: ${name} target`).toBeGreaterThanOrEqual(MIN_TARGET);
    }
    expect(await pageOverflow(page), `${label}: page overflow`).toBeLessThanOrEqual(0);
    expect(await clippedWithin(workspace), `${label}: clipped content`).toEqual([]);
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    await workspace.getByRole("button", { name: "← Back to orders" }).click();
    await expect(workspace).toHaveCount(0);
  }
});
