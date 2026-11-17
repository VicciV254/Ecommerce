import type { Locator, Page } from "@playwright/test";
import type { ActivityEntry } from "../../src/api/admin";
import { LONG_STAFF_NAME, activityEntries, layoutProblems, serveAdminData, serveStaffHistory, waitForPlace } from "./adminFixtures";
import { clippedWithin, expect, signInStaff, test } from "./fixtures";

const ROUTE = "/admin/settings/activity";

/** Follows a navigation link: from the drawer below 1280px, from the persistent column above. */
async function navigation(page: Page) {
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    return page.getByRole("dialog", { name: "Admin navigation" }).getByRole("navigation", { name: "Admin" });
  }
  return page.getByRole("navigation", { name: "Admin" });
}

const entries = (page: Page) => page.getByRole("main").getByRole("listitem");
const smallerThan44 = (controls: Locator) => controls.evaluateAll((elements) => elements
  .filter((element) => (element as HTMLElement).offsetParent !== null)
  .map((element) => ({ name: element.getAttribute("aria-label") ?? element.textContent?.trim(), box: element.getBoundingClientRect() }))
  .filter(({ box }) => box.height < 43.5 || box.width < 43.5)
  .map(({ name, box }) => `${name} ${Math.round(box.width)}x${Math.round(box.height)}`));

test("lists a publish and a restore with the staff member's name and links to the storefront editor", async ({ page }) => {
  await signInStaff(page, "ADMIN");
  await serveAdminData(page.context());
  await page.goto("/#/admin/overview/dashboard");
  await waitForPlace(page, "Dashboard");
  const nav = await navigation(page);
  await expect(nav.getByText("Settings and activity")).toBeVisible();
  await nav.getByRole("link", { name: "Staff activity", exact: true }).click();
  await waitForPlace(page, "Staff activity");
  await expect(page.getByText("Sign-ins and changes made by staff, newest first. Times are Nairobi time.")).toBeVisible();
  await expect(page.getByText(`${activityEntries.length} entries`)).toBeVisible();

  const [restored, published] = [entries(page).first(), entries(page).last()];
  await expect(restored).toContainText("Restored an earlier storefront version to the draft: version 1");
  await expect(restored).toContainText("Browser staff · Admin · 17 Nov 2026, 14:20");
  await expect(published).toContainText("Published the storefront: version 3");
  await expect(published).toContainText("Browser staff · Admin · 31 Oct 2026, 03:00");
  await expect(entries(page).nth(1).getByRole("link", { name: "Open product Linen Short-Sleeve Shirt", exact: true }))
    .toHaveAttribute("href", "#/admin/catalog/products?product=prod-linen-shirt");
  await expect(entries(page).nth(3).getByRole("link", { name: "Open discounts", exact: true })).toHaveAttribute("href", "#/admin/customers/discounts");
  // Customer accounts and sign-ins have no link.
  await expect(entries(page).nth(4)).toContainText("Disabled a customer account");
  await expect(entries(page).nth(4).getByRole("link")).toHaveCount(0);
  await expect(entries(page).nth(5)).toContainText(`Signed in${LONG_STAFF_NAME} · Super admin`);
  await expect(entries(page).nth(5).getByRole("link")).toHaveCount(0);

  await published.getByRole("link", { name: "Open storefront editor", exact: true }).click();
  await waitForPlace(page, "Storefront editor");
  await page.goBack();
  await waitForPlace(page, "Staff activity");
  await expect(restored.getByRole("link", { name: "Open storefront editor", exact: true })).toHaveAttribute("href", "#/admin/storefront/editor");
});

test("the Show filter and page live in the address, change with a replace, and unknown values are corrected", async ({ page }) => {
  await signInStaff(page, "ADMIN");
  await serveAdminData(page.context());
  const publish = activityEntries.find((entry) => entry.action === "STOREFRONT_PUBLISHED")!;
  const many: ActivityEntry[] = Array.from({ length: 30 }, (_, index) => ({
    ...publish, id: `act-${index}`, details: `version ${40 - index}`, at: new Date(Date.UTC(2026, 10, 17, 11, 59 - index)).toISOString(),
  }));
  await serveStaffHistory(page.context(), () => [...many, ...activityEntries.filter((entry) => !entry.action.startsWith("STOREFRONT_"))]);
  const asked: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/admin/activity")) asked.push(new URL(request.url()).search); });
  await page.goto(`/#${ROUTE}?type=bogus&page=x`);
  await waitForPlace(page, "Staff activity");
  await expect(page).toHaveURL(new RegExp(`#${ROUTE}$`));
  const before = await page.evaluate(() => history.length);

  await page.getByRole("combobox", { name: "Show" }).selectOption({ label: "Storefront" });
  await expect(page).toHaveURL(new RegExp(`#${ROUTE}\\?type=storefront$`));
  await expect(page.getByText("30 entries")).toBeVisible();
  await page.getByRole("navigation", { name: "Staff activity pages" }).getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(new RegExp(`#${ROUTE}\\?type=storefront&page=2$`));
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  await expect(entries(page)).toHaveCount(5);
  await page.reload();
  await waitForPlace(page, "Staff activity");
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  await page.getByRole("combobox", { name: "Show" }).selectOption({ label: "Promotions" });
  await expect(page).toHaveURL(new RegExp(`#${ROUTE}\\?type=promotions$`));
  await expect(page.getByText("No activity of this type.")).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(before);
  expect(asked.every((query) => !query.includes("bogus") && !query.includes("page=x")), asked.join(" ")).toBe(true);
});

test("view-only staff see no Settings and activity group, and its address says it is not available, unasked", async ({ page }) => {
  await signInStaff(page, "VIEWER");
  await serveAdminData(page.context());
  const asked: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/admin/activity")) asked.push(request.url()); });
  await page.goto("/#/admin/overview/dashboard");
  await waitForPlace(page, "Dashboard");
  const nav = await navigation(page);
  await expect(nav.getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(nav.getByText("Settings and activity")).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Staff activity" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.goto(`/#${ROUTE}?type=catalog`);
  await waitForPlace(page, "Not available for your role");
  await expect(page.getByText("Your role (View only) can't open Staff activity.")).toBeVisible();
  expect(asked).toEqual([]);
});

test("at 200% text: a phone stacks each entry without overflow or cut-off text; a desktop aligns time, staff and activity", async ({ page, isMobile }) => {
  await signInStaff(page, "ADMIN");
  await serveAdminData(page.context());
  const long = activityEntries.find((entry) => entry.staff.username === LONG_STAFF_NAME && entry.action !== "LOGIN")!;
  const many: ActivityEntry[] = Array.from({ length: 26 }, (_, index) => ({ ...long, id: `act-long-${index}` }));
  await serveStaffHistory(page.context(), () => many);
  await page.setViewportSize({ width: isMobile ? 390 : 1280, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/admin/overview/dashboard");
  await waitForPlace(page, "Dashboard");
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await page.evaluate((to) => { location.hash = to; }, ROUTE);
  await waitForPlace(page, "Staff activity");
  const main = page.getByRole("main");
  await expect(entries(page)).toHaveCount(25);

  expect((await layoutProblems(page)).overflow).toBeLessThanOrEqual(0);
  expect((await layoutProblems(page)).scrollers).toEqual([]);
  expect(await clippedWithin(main)).toEqual([]);
  expect(await smallerThan44(main.locator("a, button, select"))).toEqual([]);

  const entry = entries(page).first();
  const [sentence, meta] = [entry.locator("p").nth(0), entry.locator("p").nth(1)];
  await expect(sentence).toHaveText("Edited a category: Handwoven-linen-and-cotton-summer-workwear-for-coastal-Kenya");
  await expect(meta).toHaveText(`${LONG_STAFF_NAME} · Super admin · 15 Nov 2026, 19:40`);
  const [sentenceBox, staffBox, timeBox] = await Promise.all([
    sentence.boundingBox(), meta.getByText(`${LONG_STAFF_NAME} · Super admin`).boundingBox(), meta.locator("time").boundingBox(),
  ]);
  const select = (await page.getByRole("combobox", { name: "Show" }).boundingBox())!;
  if (isMobile) {
    // The sentence above staff, role and time; the Show filter spans the panel.
    expect(staffBox!.y).toBeGreaterThanOrEqual(sentenceBox!.y + sentenceBox!.height - 1);
    expect(select.width).toBeGreaterThan((await entry.boundingBox())!.width - 2);
  } else {
    // Three columns in one row: time, then staff, then the activity.
    expect(timeBox!.x).toBeLessThan(staffBox!.x);
    expect(staffBox!.x).toBeLessThan(sentenceBox!.x);
    expect(Math.abs(timeBox!.y - sentenceBox!.y)).toBeLessThan(4);
    expect(Math.abs(staffBox!.y - sentenceBox!.y)).toBeLessThan(4);
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
});
