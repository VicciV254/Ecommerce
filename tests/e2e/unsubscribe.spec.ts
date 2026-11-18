import type { Locator, Page } from "@playwright/test";
import { expect, pageOverflow, test } from "./fixtures";

/** A link's capability as an email would carry it; the page sends it and never shows it. */
const TOKEN = "3f2b8c1e-9d4a-4e6b-8f0a-1c2d3e4f5a6b";
const LINK = `/#/unsubscribe?token=${TOKEN}`;

/** Sets the root text size, then checks the page scrolls only vertically. */
async function expectNoSidewaysScroll(page: Page, where: string) {
  for (const size of ["100%", "200%"]) {
    await page.evaluate((value) => { document.documentElement.style.fontSize = value; }, size);
    expect(await pageOverflow(page), `${where} with ${size} text`).toBeLessThanOrEqual(0);
  }
}

/** Width of `target` against the content column it sits in (the heading's). */
const widths = (page: Page, target: Locator) => Promise.all([
  target.evaluate((element) => element.getBoundingClientRect().width),
  page.getByRole("heading", { level: 1 }).evaluate((element) => element.parentElement!.getBoundingClientRect().width),
]);

test("an unsubscribe link waits for the button, then confirms in place with focus on the confirmation", async ({ page, context, isMobile }) => {
  const sent: unknown[] = [];
  await context.route("**/api/subscriptions/unsubscribe", (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: { message: "Unsubscribed." } });
  });
  const width = isMobile ? 360 : 1280;
  await page.setViewportSize({ width, height: 800 });
  await page.goto(LINK);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Unsubscribe from Apex Cart emails" })).toBeVisible();
  await expect(page).toHaveTitle("Unsubscribe · Apex Cart");
  const button = main.getByRole("button", { name: "Unsubscribe", exact: true });
  await expect(button).toBeEnabled();
  // Opening the link (as a mail scanner would) changes nothing.
  await page.waitForTimeout(500);
  expect(sent).toEqual([]);

  // Phones: one column with a full-width button; wider screens: the button at its natural width.
  for (const size of ["100%", "200%"]) {
    await page.evaluate((value) => { document.documentElement.style.fontSize = value; }, size);
    const [buttonWidth, column] = await widths(page, button);
    if (width < 640) expect(buttonWidth, `button spans the column with ${size} text`).toBeCloseTo(column, 0);
    else expect(buttonWidth, `button keeps its natural width with ${size} text`).toBeLessThan(column / 2);
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await expectNoSidewaysScroll(page, `the form at ${width}px`);
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });

  await button.click();
  const confirmation = main.getByRole("heading", { name: "You're unsubscribed" });
  await expect(confirmation).toBeFocused();
  expect(sent).toEqual([{ token: TOKEN }]);
  await expect(main.getByRole("status")).toContainText("If you have an account, its email preference is now off.");
  await expect(main.getByRole("button")).toHaveCount(0);
  const shop = main.getByRole("link", { name: "Continue shopping" });
  await expect(shop).toHaveAttribute("href", "#/shop");
  expect((await shop.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expectNoSidewaysScroll(page, `the confirmation at ${width}px`);
  expect(await page.content()).not.toContain(TOKEN);
});

test("a refused link explains itself with a Contact link and offers no retry; a failed request keeps the button", async ({ page, context, isMobile }) => {
  let answer = { status: 503, json: { error: "We couldn't update email preferences just now. Try again.", code: "SUBSCRIPTION_UNAVAILABLE" } };
  await context.route("**/api/subscriptions/unsubscribe", (route) => route.fulfill(answer));
  const width = isMobile ? 360 : 1280;
  await page.setViewportSize({ width, height: 800 });
  await page.goto(LINK);
  const main = page.getByRole("main");
  const button = main.getByRole("button", { name: "Unsubscribe", exact: true });

  await button.click();
  await expect(main.getByRole("alert")).toHaveText("We couldn't unsubscribe you just now. Try again.");
  await expect(button).toBeEnabled();
  await expect(button).toBeFocused();
  await expectNoSidewaysScroll(page, `the failure at ${width}px`);
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });

  answer = { status: 404, json: { error: "This unsubscribe link isn't valid.", code: "UNSUBSCRIBE_LINK_INVALID" } };
  await button.click();
  const alert = main.getByRole("alert");
  await expect(alert).toBeFocused();
  await expect(alert).toContainText("This unsubscribe link isn't valid. It may have been copied incompletely.");
  await expect(alert.getByRole("link", { name: "Contact us" })).toHaveAttribute("href", "#/contact");
  await expect(main.getByRole("button")).toHaveCount(0);
  await expectNoSidewaysScroll(page, `the refused link at ${width}px`);
  expect(await page.content()).not.toContain(TOKEN);
});

test("a link without its token offers no button and points to Contact", async ({ page }) => {
  await page.goto("/#/unsubscribe");
  const main = page.getByRole("main");
  await expect(main.getByText("This unsubscribe link is incomplete. Open it from the email again, or contact us.")).toBeVisible();
  await expect(main.getByRole("link", { name: "Contact us" })).toHaveAttribute("href", "#/contact");
  await expect(main.getByRole("button")).toHaveCount(0);
});
