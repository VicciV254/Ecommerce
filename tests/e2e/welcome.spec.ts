import type { Page } from "@playwright/test";
import { fixtureImage } from "../../src/test-support/catalogFixtures";
import { STORAGE_KEYS } from "../../src/utils/storage";
import { ORIGIN, expect, expectWholeFocusRing, pageOverflow, publishedStorefront, test } from "./fixtures";

/*
 * The welcome dialog on a first visit: about 2 s after a browsing page's content is ready, once per browser, never on
 * checkout-like or legal pages, never over another dialog, focus managed like every dialog here.
 */
test.use({ welcome: "fresh" });

const welcome = (page: Page) => page.getByRole("dialog", { name: /^Welcome to / });
const shownMark = (page: Page) => page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.welcomeShown);

test("opens about 2 seconds after the home page is ready, with focus on its heading; Tab stays inside and Escape closes it", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
  const ready = Date.now();
  await expect(welcome(page)).toBeVisible({ timeout: 5000 });
  expect(Date.now() - ready).toBeGreaterThan(1200);
  const heading = welcome(page).getByRole("heading", { level: 2, name: /^Welcome to / });
  await expect(heading).toBeFocused();
  expect(await shownMark(page)).not.toBeNull();
  for (let press = 0; press < 12; press += 1) {
    await page.keyboard.press("Tab");
    expect(await welcome(page).evaluate((dialog) => dialog.contains(document.activeElement)), `Tab ${press + 1} stays inside`).toBe(true);
    await expectWholeFocusRing(page);
  }
  await page.keyboard.press("Escape");
  await expect(welcome(page)).toHaveCount(0);
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
});

test("is shown once per browser: not again after a reload or in a new tab", async ({ page, context }) => {
  await page.goto("/");
  await expect(welcome(page)).toBeVisible({ timeout: 6000 });
  await welcome(page).getByRole("button", { name: "Start browsing" }).click();
  await expect(welcome(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
  await page.waitForTimeout(3500);
  await expect(welcome(page)).toHaveCount(0);
  const tab = await context.newPage();
  await tab.goto(`${ORIGIN}/#/shop`);
  await expect(tab.getByRole("heading", { level: 1 })).toBeVisible();
  await tab.waitForTimeout(3500);
  await expect(welcome(tab)).toHaveCount(0);
  await tab.close();
});

test("closes with its close button and with a click on the backdrop, and subscribes no one", async ({ page, isMobile }) => {
  const writes: string[] = [];
  page.on("request", (request) => { if (request.method() !== "GET" && request.url().includes("/api/")) writes.push(request.url()); });
  await page.goto("/shop");
  await expect(welcome(page)).toBeVisible({ timeout: 6000 });
  const close = welcome(page).getByRole("button", { name: "Close" });
  const size = (await close.boundingBox())!;
  expect(Math.min(size.width, size.height)).toBeGreaterThanOrEqual(44);
  await close.click();
  await expect(welcome(page)).toHaveCount(0);
  if (!isMobile) {
    await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEYS.welcomeShown);
    await page.reload();
    await expect(welcome(page)).toBeVisible({ timeout: 6000 });
    await page.mouse.click(8, 8);
    await expect(welcome(page)).toHaveCount(0);
  }
  expect(writes).toEqual([]);
});

test("never opens on the cart, checkout, account or legal pages, and not after moving to one", async ({ page }) => {
  for (const path of ["/cart", "/privacy", "/terms", "/login", "/track", "/wishlist"]) {
    await page.goto(`/#${path}`);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await page.waitForTimeout(3000);
    await expect(welcome(page), path).toHaveCount(0);
  }
  expect(await shownMark(page)).toBeNull();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
  await page.goto("/#/cart");
  await page.waitForTimeout(3500);
  await expect(welcome(page)).toHaveCount(0);
});

test("waits for the mini cart to close before opening", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Cart" }).click();
  const drawer = page.getByRole("dialog", { name: "Your cart" });
  await expect(drawer).toBeVisible();
  await page.waitForTimeout(4000);
  await expect(welcome(page)).toHaveCount(0);
  await drawer.getByRole("button", { name: "Close cart" }).click();
  await expect(drawer).toHaveCount(0);
  await expect(welcome(page)).toBeVisible({ timeout: 5000 });
});

test("its Privacy link closes it and the Privacy notice takes focus", async ({ page }) => {
  await page.goto("/");
  await expect(welcome(page)).toBeVisible({ timeout: 6000 });
  await welcome(page).getByRole("link", { name: "Privacy notice" }).click();
  await expect(page).toHaveURL(/#\/privacy$/);
  await expect(welcome(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Privacy notice" })).toBeFocused();
});

test("shows the hero's photo, decorative, beside the form from 768px and none on phones, where the card scrolls inside at 200% text", async ({ page, context, isMobile }) => {
  const settings = {
    ...publishedStorefront.settings,
    sections: [{ id: "hero-carousel", type: "carousel" as const, title: "Highlights", enabled: true, productIds: [], categoryIds: [], campaignId: null, campaignIds: ["week"] }],
    campaigns: [{
      id: "week", title: "Fashion week", body: "", conditions: "", cta: { label: "Shop now", target: "shop" as const, targetId: null },
      desktopMediaId: "media-week", mobileMediaId: null, desktopFocal: { x: 50, y: 50 }, mobileFocal: { x: 50, y: 50 }, layout: "overlay" as const,
    }],
  };
  const media = [fixtureImage({ id: "media-week", url: "https://media.example.test/week.jpg", alt: "" })];
  await context.route("**/api/settings/storefront", (route) => route.fulfill({ json: { ...publishedStorefront, settings, media } }));
  if (isMobile) await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/");
  await expect(welcome(page)).toBeVisible({ timeout: 6000 });
  const images = welcome(page).locator("img");
  if (isMobile) {
    await expect(images).toHaveCount(0);
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    const card = await welcome(page).evaluate((dialog) => {
      const panel = dialog.firstElementChild as HTMLElement;
      return { fits: panel.getBoundingClientRect().bottom <= window.innerHeight + 1, scrolls: panel.scrollHeight > panel.clientHeight };
    });
    expect(card).toEqual({ fits: true, scrolls: true });
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  } else {
    const photo = images.first();
    await expect(photo).toBeVisible();
    expect([await photo.getAttribute("alt"), new URL((await photo.getAttribute("src"))!).pathname]).toEqual(["", "/week.jpg"]);
  }
});

test("stays out of the staff area even on a first visit", async ({ page }) => {
  await page.goto("/#/admin");
  await page.waitForTimeout(3500);
  await expect(welcome(page)).toHaveCount(0);
});
