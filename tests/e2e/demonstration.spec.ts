import type { Locator } from "@playwright/test";
import { linenShirt } from "../../src/test-support/catalogFixtures";
import { serveDemonstrationStore } from "./demonstrationFixtures";
import { expect, linenCartLine, pageOverflow, signInCustomer, test, watchPaymentWrites } from "./fixtures";

const TOUCH_TARGET = 44;

/** Each listed step's button is a full touch target; on phones it takes the region's whole width. */
async function expectStepButtons(controls: Locator, isMobile: boolean) {
  const region = (await controls.boundingBox())!;
  for (const button of await controls.getByRole("button").all()) {
    const box = (await button.boundingBox())!;
    expect.soft(box.height, `${await button.textContent()}: height`).toBeGreaterThanOrEqual(TOUCH_TARGET);
    if (isMobile) expect.soft(box.width, `${await button.textContent()}: stacked at full width`).toBeGreaterThan(region.width * 0.8);
  }
}

/** Opens a receipt disclosure; from 768px they start open. */
async function openDisclosure(scope: Locator, title: string) {
  const details = scope.locator("details").filter({ has: scope.page().locator("summary", { hasText: title }) });
  if (!await details.evaluate((element) => (element as HTMLDetailsElement).open)) await details.locator("summary").click();
  return details;
}

/** A box's own chrome: a section in the dialog's flow has a top hairline and no side borders, shadow or fill. */
const chromeOf = (target: Locator) => target.evaluate((element) => {
  const style = getComputedStyle(element);
  return {
    top: style.borderTopWidth, sides: `${style.borderLeftWidth} ${style.borderRightWidth}`, shadow: style.boxShadow,
    fill: style.backgroundColor,
  };
});
const IN_FLOW = { top: "1px", sides: "0px 0px", shadow: "none", fill: "rgba(0, 0, 0, 0)" };

/** Words (hyphen-separated parts) whose visible letters fall on more than one line. */
const brokenWords = (target: Locator) => target.evaluateAll((elements) => elements.flatMap((root) => {
  const broken: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest(".sr-only")) continue;
    for (const match of (node.textContent ?? "").matchAll(/[^\s-]+-?/g)) {
      const tops = new Set<number>();
      for (let index = match.index; index < match.index + match[0].length; index += 1) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const rect = range.getClientRects()[0];
        if (rect?.width) tops.add(Math.round(rect.top));
      }
      if (tops.size > 1) broken.push(match[0]);
    }
  }
  return broken;
}));

test("a sample order is paid with a demonstration payment and its store side is played to a recorded refund", async ({ page, context, isMobile }) => {
  await signInCustomer(page, [linenCartLine]);
  const store = await serveDemonstrationStore(context);
  const mpesaWrites = watchPaymentWrites(page);

  await page.goto("/#/checkout");
  await expect(page.getByText("You then pay with a demonstration payment (no money), or with M-Pesa from an approved test number.")).toBeVisible();
  await page.getByRole("button", { name: "Reserve Order" }).click();
  await expect(page.getByRole("heading", { name: "Order reserved" })).toBeVisible();
  const order = store.current()!;

  // The demonstration payment comes first; the sandbox form stays closed until asked for.
  const payment = page.getByRole("region", { name: "Payment", exact: true });
  await expect(payment.getByText("No money is taken and no phone prompt is sent.")).toBeVisible();
  const sandbox = payment.locator("details").filter({ hasText: "Pay with M-Pesa sandbox instead" });
  await expect(sandbox).toHaveJSProperty("open", false);
  await expect(payment.getByRole("textbox", { name: "M-Pesa phone number" })).toBeHidden();
  await payment.getByRole("button", { name: "Pay with a demonstration payment" }).click();
  await expect(page.getByRole("heading", { name: "Order paid" })).toBeVisible();
  await expect(page.getByText("This order is paid with a demonstration payment; no money was taken.", { exact: false })).toBeVisible();
  await expect(payment.getByText("Paid with a demonstration payment").first()).toBeVisible();
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);

  // The store's part, step by step, from the order's receipt details.
  await page.getByRole("link", { name: "View order details" }).click();
  const receipt = page.getByRole("dialog", { name: "Receipt details" });
  const controls = receipt.getByRole("region", { name: "Demonstration controls" });
  const outcome = controls.getByRole("status");
  await expect(controls.getByText("You play the store's part here. Nothing is shipped and no money moves.")).toBeVisible();
  await expectStepButtons(controls, isMobile);
  const play = async (button: string, result: string) => {
    await controls.getByRole("button", { name: button }).click();
    await expect(outcome).toHaveText(result);
    await expect(outcome).toBeFocused();
  };
  await play("Mark as being prepared", `Order ${order.orderNumber} is marked as being prepared.`);
  await play("Mark as dispatched", `Order ${order.orderNumber} is marked as dispatched.`);
  await play("Mark as delivered", `Order ${order.orderNumber} is marked as delivered.`);
  await expect(controls.getByRole("button")).toHaveCount(0);

  // The customer's own part: a return, with terms that move no money.
  await receipt.getByRole("button", { name: "Request a return" }).click();
  const request = page.getByRole("dialog", { name: "Request a return", exact: true });
  await expect(request.getByText("Refunds of demonstration payments are recorded without moving money.")).toBeVisible();
  await expect(request.getByText(/Refunds are sent by M-Pesa/)).toHaveCount(0);
  await request.getByRole("button", { name: `Return one more ${linenShirt.name}` }).click();
  await request.getByRole("combobox", { name: "Reason for return" }).selectOption({ label: "Arrived damaged" });
  await request.getByRole("button", { name: "Submit return request" }).click();
  await expect(request).toHaveCount(0);
  const { returns: [returned] } = store.current()!;
  await expect(receipt.getByText(`Return ${returned.number} requested. Nothing is refunded until the items are received and checked.`)).toBeVisible();

  await expectStepButtons(controls, isMobile);
  await play(`Approve the return ${returned.number}`, `Return ${returned.number} is approved.`);
  await play(`Mark the return as received ${returned.number}`, `Return ${returned.number} is marked as received.`);
  const { refunds: [refund] } = store.current()!;
  // The last step leaves no buttons; its outcome keeps focus in the region.
  await play(`Record the demonstration refund ${refund.number}`, `Demonstration refund ${refund.number} of KES 1,244 is recorded; no money was sent.`);
  await expect(controls.getByRole("button")).toHaveCount(0);

  await openDisclosure(receipt, "Returns");
  await expect(receipt.getByText("Fault confirmed in the demonstration.")).toBeVisible();
  await openDisclosure(receipt, "Refunds");
  const recorded = receipt.getByRole("listitem").filter({ hasText: "Demonstration refund (no money sent)" });
  await expect(recorded.getByText(/^Recorded on .+; no money was sent$/)).toBeVisible();
  await expect(recorded.getByText(/M-Pesa|reference/)).toHaveCount(0);
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);

  expect(store.requests).toEqual([
    { step: "/demonstration-payment", body: {} },
    { step: "/demonstration-actions", body: { action: "START_PROCESSING", expectedStatus: "PENDING" } },
    { step: "/demonstration-actions", body: { action: "DISPATCH", expectedStatus: "PROCESSING" } },
    { step: "/demonstration-actions", body: { action: "CONFIRM_DELIVERY", expectedStatus: "SHIPPED" } },
    { step: "/returns", body: { reason: "DAMAGED", lines: [{ orderItemId: order.items[0].id, quantity: 1 }] } },
    { step: `/returns/${returned.id}/demonstration-approve`, body: { expectedStatus: "REQUESTED" } },
    { step: `/returns/${returned.id}/demonstration-receive`, body: { expectedStatus: "APPROVED" } },
    { step: `/refunds/${refund.id}/demonstration-complete`, body: { expectedStatus: "REQUESTED" } },
  ]);
  expect(mpesaWrites, "no M-Pesa request of any kind").toEqual([]);
});

test("on a 390px phone with 200% text the receipt's sections sit in the dialog's flow, not as cards in a card", async ({ page, context, isMobile }) => {
  test.skip(!isMobile, "Checked at phone width in the mobile project.");
  await page.setViewportSize({ width: 390, height: 844 });
  await signInCustomer(page, [linenCartLine]);
  await serveDemonstrationStore(context);
  await page.goto("/#/checkout");
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await page.getByRole("button", { name: "Reserve Order" }).click();
  // On the checkout page the payment panel is the card; its sandbox disclosure is a section of it, not a card inside it.
  const payment = page.getByRole("region", { name: "Payment", exact: true });
  expect(await chromeOf(payment.locator("details"))).toEqual(IN_FLOW);
  await payment.getByRole("button", { name: "Pay with a demonstration payment" }).click();
  await page.getByRole("link", { name: "View order details" }).click();

  const receipt = page.getByRole("dialog", { name: "Receipt details" });
  const controls = receipt.getByRole("region", { name: "Demonstration controls" });
  await expect(controls.getByRole("button", { name: "Mark as being prepared" })).toBeVisible();
  expect(await chromeOf(controls)).toEqual(IN_FLOW);
  expect(await chromeOf(receipt.getByRole("region", { name: "Payment", exact: true }))).toEqual(IN_FLOW);
  expect(await brokenWords(controls.getByRole("button"))).toEqual([]);
  await expectStepButtons(controls, true);

  for (const step of ["Mark as being prepared", "Mark as dispatched", "Mark as delivered"]) {
    await controls.getByRole("button", { name: step }).click();
    await expect(controls.getByRole("status")).toBeFocused();
  }
  await receipt.getByRole("button", { name: "Request a return" }).click();
  const request = page.getByRole("dialog", { name: "Request a return", exact: true });
  await request.getByRole("button", { name: `Return one more ${linenShirt.name}` }).click();
  await request.getByRole("combobox", { name: "Reason for return" }).selectOption({ label: "Arrived damaged" });
  await request.getByRole("button", { name: "Submit return request" }).click();
  await expect(request).toHaveCount(0);
  for (const step of ["Approve the return", "Mark the return as received", "Record the demonstration refund"]) {
    await expectStepButtons(controls, true);
    await controls.getByRole("button", { name: step }).click();
    await expect(controls.getByRole("status")).toBeFocused();
  }
  // Each return and refund is a row of its list, not a bordered card inside the list's box.
  for (const title of ["Returns", "Refunds"]) {
    const record = (await openDisclosure(receipt, title)).locator("li").first();
    expect(await chromeOf(record), title).toMatchObject({ sides: "0px 0px", shadow: "none", fill: "rgba(0, 0, 0, 0)" });
  }
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
});
