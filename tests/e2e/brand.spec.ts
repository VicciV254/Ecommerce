import type { Locator, Page } from "@playwright/test";
import { browserQuote, expect, orderPage, pageOverflow, servePaymentOverview, signInCustomer, test } from "./fixtures";
import { fixturePendingOrder } from "../../src/test-support/checkoutFixtures";
import { fixtureCustomerOrder } from "../../src/test-support/orderFixtures";

const NAVY_900 = "rgb(20, 33, 61)";
const GOLD_400 = "rgb(228, 190, 97)";
const INFO = "rgb(29, 78, 137)";
const TOUCH_TARGET = 44;
const NARROW_PHONE = { width: 360, height: 780 };
type PrintCounter = Window & { printCalls?: number };
/** The 3px focus ring sits 2px outside its control, so it needs this much room below the sticky header too. */
const FOCUS_RING_OUTSET = 5;

test("the header lockup is named Apex Cart, sized for the device, and its row fits a 360px phone", async ({ page, isMobile }) => {
  await page.goto("/#/about");
  const banner = page.getByRole("banner");
  await expect(banner).toHaveCSS("background-color", NAVY_900);
  const home = banner.getByRole("link", { name: "Apex Cart", exact: true });
  await expect(home).toBeVisible();
  await expect(home).toHaveAttribute("href", "#/");
  await expect(home.locator("svg")).toHaveAttribute("aria-hidden", "true");
  const name = home.getByText("Apex Cart", { exact: true });
  await expect(name).toHaveCSS("text-transform", "uppercase");
  await expect(name).toHaveCSS("font-size", isMobile ? "16px" : "24px");
  expect((await home.locator("svg").boundingBox())?.width).toBe(isMobile ? 32 : 40);
  expect((await home.boundingBox())?.height).toBeGreaterThanOrEqual(TOUCH_TARGET);
  if (!isMobile) return;

  await page.setViewportSize(NARROW_PHONE);
  const icons = [
    banner.getByRole("link", { name: "Wishlist", exact: true }),
    banner.getByRole("button", { name: "Cart", exact: true }),
    banner.getByRole("link", { name: "Sign in", exact: true }),
    banner.getByRole("button", { name: "Menu", exact: true }),
  ];
  const lockup = (await home.boundingBox())!;
  const boxes = await Promise.all(icons.map(async (icon) => (await icon.boundingBox())!));
  const middle = (box: { y: number; height: number }) => box.y + box.height / 2;
  for (const box of boxes) {
    expect(box.width).toBeGreaterThanOrEqual(TOUCH_TARGET);
    expect(box.height).toBeGreaterThanOrEqual(TOUCH_TARGET);
    expect(Math.abs(middle(box) - middle(lockup))).toBeLessThanOrEqual(1);
    expect(box.x + box.width).toBeLessThanOrEqual(NARROW_PHONE.width);
  }
  expect(lockup.x + lockup.width).toBeLessThanOrEqual(boxes[0].x);
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
});

test("the footer carries the stacked gradient lockup in gold on navy", async ({ page, isMobile }) => {
  await page.goto("/#/about");
  const footer = page.getByRole("contentinfo");
  await expect(footer).toHaveCSS("background-color", NAVY_900);
  const lockup = footer.getByRole("link", { name: "Apex Cart", exact: true });
  await lockup.scrollIntoViewIfNeeded();
  await expect(lockup).toBeVisible();
  await expect(lockup.locator("linearGradient")).toHaveCount(1);
  await expect(lockup.getByText("Apex Cart", { exact: true })).toHaveCSS("color", GOLD_400);
  expect((await lockup.locator("svg").boundingBox())?.width).toBe(isMobile ? 80 : 96);
  await expect(footer).not.toContainText(/maneno|mombasa|digo|784\s*379/i);
});

test("old showroom links land on the shop without adding a history entry", async ({ page }) => {
  await page.goto("/#/about");
  await expect(page.getByRole("heading", { level: 1, name: "About Apex Cart" })).toBeVisible();
  await page.evaluate(() => { window.location.hash = "#/showroom?go=events"; });
  await expect(page).toHaveURL(/#\/shop$/);
  await expect(page.getByRole("heading", { name: "All Products", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Showroom" })).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/#\/about$/);
  await expect(page.getByRole("heading", { level: 1, name: "About Apex Cart" })).toBeVisible();
});

test("about, contact and sign-in pages reflow at 360px, including doubled text", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone widths are checked in the mobile project.");
  await page.setViewportSize(NARROW_PHONE);
  const pages = [
    ["/#/about", "About Apex Cart"], ["/#/contact", "Contact us"],
    ["/#/login", "Sign in to your account"], ["/#/register", "Create your account"],
  ];
  for (const [route, heading] of pages) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    for (const size of ["100%", "200%"]) {
      await page.evaluate((value) => { document.documentElement.style.fontSize = value; }, size);
      expect(await pageOverflow(page), `${route} at ${size} text`).toBeLessThanOrEqual(0);
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  }
});

test("keyboard focus shows a gold ring on navy and an info-blue ring on light surfaces", async ({ page }) => {
  await page.goto("/#/about");
  await expect(page.getByRole("heading", { level: 1, name: "About Apex Cart" })).toBeVisible();
  await page.keyboard.press("Tab");
  const home = page.getByRole("banner").getByRole("link", { name: "Apex Cart", exact: true });
  await expect(home).toBeFocused();
  await expect(home).toHaveCSS("outline-style", "solid");
  await expect(home).toHaveCSS("outline-color", GOLD_400);
  await expect(home).toHaveCSS("outline-width", "3px");
  await expect(home).toHaveCSS("outline-offset", "2px");
  const browse = page.getByRole("main").getByRole("link", { name: "Browse products" });
  await browse.focus();
  await expect(browse).toHaveCSS("outline-color", INFO);
  await expect(browse).toHaveCSS("outline-width", "3px");
});

test("reduced motion makes header feedback immediate", async ({ page }) => {
  await page.goto("/#/about");
  const cart = page.getByRole("banner").getByRole("button", { name: "Cart", exact: true });
  await expect(cart).toHaveCSS("transition-duration", "0.12s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(Number.parseFloat(await cart.evaluate((element) => getComputedStyle(element).transitionDuration))).toBeLessThan(0.001);
});

test("the printed receipt carries the navy mark and brand name on white paper, then prints once", async ({ page, context }) => {
  await signInCustomer(page);
  await context.addInitScript(() => {
    window.print = () => { (window as PrintCounter).printCalls = ((window as PrintCounter).printCalls ?? 0) + 1; };
  });
  const order = fixtureCustomerOrder(fixturePendingOrder(browserQuote()));
  await context.route("**/api/orders?*", (route) => route.fulfill({ json: orderPage([order]) }));
  await servePaymentOverview(context, order);
  await page.goto("/#/account/orders");
  const [printed] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "Receipt", exact: true }).click(),
  ]);
  await expect(printed).toHaveTitle(`Receipt ${order.orderNumber} · Apex Cart`);
  const mark = printed.locator(".lockup svg");
  await expect(mark).toHaveAttribute("width", "12mm");
  await expect(mark.locator("g")).toHaveAttribute("fill", "#14213D");
  await expect(printed.locator(".lockup .name")).toHaveText("Apex Cart");
  await expect(printed.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(printed.locator(".totals .grand")).toContainText(`KES ${order.total.toLocaleString("en-KE")}`);
  await expect.poll(() => printed.evaluate(() => (window as PrintCounter).printCalls ?? 0)).toBe(1);
  await printed.close();
});

type FocusKey = "Tab" | "Shift+Tab";
type Placement = "behind the header" | "above the viewport";
type FocusMove = { route: string; width: number; height: number; textSize?: string; key: FocusKey; from: string; to: string };

/** Waits until the window has stopped scrolling (focus scrolling may be smooth). */
async function scrollSettled(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    const STILL_SAMPLES = 6;
    let last = window.scrollY;
    let still = 0;
    const timer = window.setInterval(() => {
      still = window.scrollY === last ? still + 1 : 0;
      last = window.scrollY;
      if (still >= STILL_SAMPLES) {
        window.clearInterval(timer);
        resolve();
      }
    }, 50);
  }));
}

/** The bottom edge of the sticky chrome: the brand row, plus the phone search row while it sticks too. */
const stickyBottom = (page: Page) => page.evaluate(() =>
  Math.max(...[...document.querySelectorAll("[data-sticky-header]")].map((element) => element.getBoundingClientRect().bottom)));

/**
 * Scrolls so `target` sits wholly behind the sticky header (or wholly above the viewport), focuses `from` without
 * scrolling, then moves focus to `target` with the keyboard. Returns how far the target's top ends below the header.
 */
async function moveFocusPastHeader(page: Page, from: Locator, target: Locator, key: FocusKey, placement: Placement) {
  const headerBottom = await stickyBottom(page);
  await target.evaluate((element, above) => {
    const rect = element.getBoundingClientRect();
    window.scrollBy({ top: above ? rect.bottom + 8 : rect.top - 4, behavior: "instant" });
  }, placement === "above the viewport");
  const start = await target.evaluate((element) => element.getBoundingClientRect());
  if (placement === "above the viewport") expect(start.bottom, "target starts above the viewport").toBeLessThan(0);
  else expect(start.bottom, "target starts hidden behind the header").toBeLessThanOrEqual(headerBottom);
  await from.evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
  await page.keyboard.press(key);
  await expect(target).toBeFocused();
  await scrollSettled(page);
  const end = (await target.boundingBox())!;
  expect(end.y + end.height, "target ends inside the viewport").toBeLessThanOrEqual(page.viewportSize()!.height);
  return Math.round(end.y - await stickyBottom(page));
}

/** Stands for the last tab stop in the sticky chrome (the phone search row, or else the header), whichever the width shows. */
const LAST_HEADER_STOP = "the header's last control";
const SHOP_CARD = { route: "/#/shop", height: 700, key: "Shift+Tab", from: "Choose options for Linen Short-Sleeve Shirt", to: "Linen Short-Sleeve Shirt" } as const;
const ABOUT = { route: "/#/about", key: "Shift+Tab", from: "Track an order", to: "Browse products" } as const;
const CONTACT = { route: "/#/contact", key: "Tab", from: "Name", to: "Email" } as const;
const OUT_OF_HEADER = { route: "/#/about", key: "Tab", from: LAST_HEADER_STOP, to: "Home" } as const;
const FOCUS_MOVES: Record<"phone" | "desktop", FocusMove[]> = {
  phone: [
    { ...ABOUT, width: 390, height: 844 },
    { ...CONTACT, width: 390, height: 844 },
    { ...OUT_OF_HEADER, width: 390, height: 844 },
    { ...ABOUT, ...NARROW_PHONE, textSize: "200%" },
    // The listing under the taller phone chrome (brand and search rows), and in landscape where only the brand row sticks.
    { ...SHOP_CARD, width: 390, height: 844 },
    { ...SHOP_CARD, width: 667, height: 375 },
  ],
  desktop: [
    { ...ABOUT, width: 1280, height: 900 },
    { ...CONTACT, width: 1280, height: 900 },
    { ...OUT_OF_HEADER, width: 1280, height: 900 },
    { ...SHOP_CARD, width: 1024 },
    { ...SHOP_CARD, width: 1280 },
  ],
};

/** A named link or labelled field in the page content, or the header's last visible tab stop. */
function focusStop(page: Page, name: string) {
  if (name === LAST_HEADER_STOP) return page.locator("[data-sticky-header]").locator("a[href]:visible, button:visible").last();
  const main = page.getByRole("main");
  return main.getByRole("link", { name, exact: true }).or(main.getByLabel(name, { exact: true }));
}

test("keyboard focus moved to a control behind or above the sticky header ends fully below it (WCAG 2.4.11)", async ({ page, isMobile }) => {
  for (const move of FOCUS_MOVES[isMobile ? "phone" : "desktop"]) {
    await page.setViewportSize({ width: move.width, height: move.height });
    await page.goto(move.route);
    await page.evaluate((size) => { document.documentElement.style.fontSize = size; }, move.textSize ?? "");
    await expect(focusStop(page, move.to)).toBeVisible();
    for (const placement of ["behind the header", "above the viewport"] as const) {
      const clearance = await moveFocusPastHeader(page, focusStop(page, move.from), focusStop(page, move.to), move.key, placement);
      const label = `${move.route} at ${move.width}px${move.textSize ? ` and ${move.textSize} text` : ""}: ${move.key} to "${move.to}" ${placement}`;
      expect.soft(clearance, `${label}; px below the header`).toBeGreaterThanOrEqual(FOCUS_RING_OUTSET);
    }
  }
});

test("focus and typing inside the sticky header never scroll the page", async ({ page, isMobile }) => {
  const SCROLLED = 400;
  await page.goto("/#/shop");
  await expect(page.getByRole("heading", { name: "All Products", exact: true })).toBeVisible();
  const scrollY = async () => { await scrollSettled(page); return page.evaluate(() => window.scrollY); };
  const focusWithoutScrolling = (locator: Locator) => locator.evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
  await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), SCROLLED);

  // On phones the department shortcuts scroll with the page between the sticky search row and the content.
  const start = isMobile
    ? page.getByRole("navigation", { name: "Department shortcuts" }).getByRole("link").first()
    : page.getByRole("main").getByRole("link").first();
  await focusWithoutScrolling(start);
  for (let step = 0; step < 4; step += 1) {
    await page.keyboard.press("Shift+Tab");
    expect(await scrollY(), `Shift+Tab ${step + 1} into the header`).toBe(SCROLLED);
  }
  await expect(page.getByRole("banner").locator(":focus")).toHaveCount(1);

  const search = page.getByRole("combobox", { name: "Search products" });
  await focusWithoutScrolling(search);
  await page.keyboard.type("shirt");
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  expect(await scrollY(), "typing and arrowing through suggestions").toBe(SCROLLED);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  expect(await scrollY(), "after closing the suggestions").toBe(SCROLLED);
});
