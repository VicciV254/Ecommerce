import type { Locator, Page } from "@playwright/test";
import { expect, expectWholeFocusRing, pageOverflow, publicSnapshot, test } from "./fixtures";

const NARROW_PHONE = { width: 360, height: 780 };
const TOUCH_TARGET = 44;
/** The 3px focus ring sits 2px outside its control, so it needs this much room below the sticky header too. */
const FOCUS_RING_OUTSET = 5;
/** How long the delayed catalog keeps a fresh load waiting for its final layout. */
const CATALOG_DELAY_MS = 1500;

const PAGES = [
  { path: "/#/delivery", heading: "Delivery", sections: false },
  { path: "/#/returns", heading: "Returns and refunds", sections: false },
  { path: "/#/faq", heading: "FAQ", sections: true },
  { path: "/#/privacy", heading: "Privacy notice", sections: true },
  { path: "/#/terms", heading: "Terms of use", sections: true },
  { path: "/#/does-not-exist", heading: "We can't find that page", sections: false },
];

const setTextSize = (page: Page, size: string) => page.evaluate((value) => { document.documentElement.style.fontSize = value; }, size);

/** The lowest edge of the chrome that is sticky right now. */
const stickyBottom = (page: Page) => page.evaluate(() =>
  Math.max(0, ...[...document.querySelectorAll("[data-sticky-header]")].map((element) => element.getBoundingClientRect().bottom)));

/** An element's top once scrolling has stopped (stable for a few frames, or after about two seconds). */
const settledTop = (target: Locator) => target.evaluate((element) => new Promise<number>((resolve) => {
  let last = Number.NaN;
  let still = 0;
  let frames = 0;
  const check = () => {
    const top = element.getBoundingClientRect().top;
    still = top === last ? still + 1 : 0;
    last = top;
    frames += 1;
    if (still >= 3 || frames > 120) resolve(top);
    else requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}));

async function expectFooterReachable(page: Page, where: string) {
  const footer = page.getByRole("contentinfo");
  await footer.getByRole("link", { name: "Terms", exact: true }).scrollIntoViewIfNeeded();
  await expect(footer.getByRole("link", { name: "Terms", exact: true }), `${where}: footer reachable`).toBeInViewport();
}

test("every information page and the not-found page reflow at 360px with 200% text, footer within reach", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone widths are checked in the mobile project.");
  await page.setViewportSize(NARROW_PHONE);
  for (const { path, heading } of PAGES) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    for (const size of ["100%", "200%"]) {
      await setTextSize(page, size);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect.poll(() => pageOverflow(page), `${path} at ${size} text: sideways scrolling (px)`).toBeLessThanOrEqual(0);
      await expectFooterReachable(page, `${path} at ${size} text`);
    }
    await setTextSize(page, "");
  }
});

test("long pages show On this page beside the content from 1024px and above it below", async ({ page, isMobile }) => {
  test.skip(isMobile, "Desktop widths are checked in the desktop project.");
  for (const width of [1023, 1024, 1279, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const { path, heading, sections } of PAGES) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      expect(await pageOverflow(page), `${path} at ${width}px: sideways scrolling (px)`).toBeLessThanOrEqual(0);
      await expectFooterReachable(page, `${path} at ${width}px`);
      if (!sections) {
        await expect(page.getByRole("navigation", { name: "On this page" })).toHaveCount(0);
        continue;
      }
      const nav = (await page.getByRole("navigation", { name: "On this page" }).boundingBox())!;
      const first = (await page.getByRole("main").getByRole("heading", { level: 2 }).first().boundingBox())!;
      if (width >= 1024) expect(nav.x + nav.width, `${path} at ${width}px: column beside the content`).toBeLessThanOrEqual(first.x);
      else expect(nav.y + nav.height, `${path} at ${width}px: list above the content`).toBeLessThanOrEqual(first.y);
    }
  }
});

test("On this page sticks beside long content on tall desktops and stays static on short ones", async ({ page, isMobile }) => {
  test.skip(isMobile, "The column exists from 1024px.");
  for (const [height, position] of [[900, "sticky"], [560, "static"]] as const) {
    await page.setViewportSize({ width: 1280, height });
    await page.goto("/#/privacy");
    const nav = page.getByRole("navigation", { name: "On this page" });
    await expect(nav).toHaveCSS("position", position);
    if (position === "sticky") {
      // Halfway down the notice, the column is still in view below the sticky header.
      await page.getByRole("heading", { level: 2, name: "Your rights" }).scrollIntoViewIfNeeded();
      const box = (await nav.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(await stickyBottom(page));
      expect(box.y + box.height).toBeLessThanOrEqual(height);
    }
  }
});

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`an FAQ section link focuses its heading fully below the sticky header (${reducedMotion} motion)`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto("/#/faq");
    await expect(page.getByRole("heading", { level: 1, name: "FAQ" })).toBeVisible();
    const link = page.getByRole("navigation", { name: "On this page" }).getByRole("link", { name: "Your account and privacy" });
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/faq\?section=your-account-and-privacy$/);
    const heading = page.getByRole("heading", { level: 2, name: "Your account and privacy" });
    await expect(heading).toBeFocused();
    const top = await settledTop(heading);
    expect(top - FOCUS_RING_OUTSET, "the heading and its focus ring clear the sticky header").toBeGreaterThanOrEqual(await stickyBottom(page));
    expect(top, "the heading is brought to the top").toBeLessThan(await stickyBottom(page) + 40);
    await expectWholeFocusRing(page);

    // Following the same link again, after scrolling away, brings the heading back (the address doesn't change).
    await page.mouse.wheel(0, -2000);
    await expect.poll(() => heading.evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThan(400);
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(heading).toBeFocused();
    expect(await settledTop(heading) - FOCUS_RING_OUTSET).toBeGreaterThanOrEqual(await stickyBottom(page));

    // Back to the page itself: the router starts it at the top and the h1 takes focus.
    await page.goBack();
    await expect(page).toHaveURL(/#\/faq$/);
    await expect(page.getByRole("heading", { level: 1, name: "FAQ" })).toBeFocused();
  });
}

test("a fresh load at an FAQ section lands on it once the delayed catalog has arrived, without moving focus", async ({ page }) => {
  await page.route("**/api/catalog", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, CATALOG_DELAY_MS));
    await route.fulfill({ json: publicSnapshot });
  });
  await page.goto("/#/faq?section=your-account-and-privacy");
  // The catalog's facts have arrived once the delivery answer is filled in (it stays closed under its question); the
  // footer below the section changes with them too.
  await expect(page.getByText("Standard delivery: Anywhere in Kenya · 2–5 working days.")).toBeAttached();
  const heading = page.getByRole("heading", { level: 2, name: "Your account and privacy" });
  await expect.poll(async () => {
    const top = await settledTop(heading);
    const bottom = await stickyBottom(page);
    return top >= bottom && top < bottom + 40;
  }, { message: "the section sits at the top, below the sticky header" }).toBe(true);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test("FAQ answers stay closed until their question is opened by keyboard or tap, at phone and desktop widths", async ({ page, isMobile }) => {
  await page.setViewportSize(isMobile ? NARROW_PHONE : { width: 1280, height: 900 });
  await page.goto("/#/faq");
  const main = page.getByRole("main");
  const questions = main.locator("details > summary");
  await expect(questions).toHaveCount(11);
  await expect(main.locator("details[open]")).toHaveCount(0);
  for (const question of await questions.all()) {
    const box = (await question.boundingBox())!;
    expect.soft(box.height, `${await question.textContent()}: height`).toBeGreaterThanOrEqual(TOUCH_TARGET);
  }

  const disclosure = (question: string) => main.locator("details").filter({ has: page.locator("summary", { hasText: question }) });
  const account = disclosure("How do I delete my account or my information?");
  const links = account.locator("a");
  const chevron = account.locator("summary svg");
  await expect(links.first()).toBeHidden();
  await expect(chevron).toHaveCSS("rotate", "none");

  // Tab reaches the question past the closed one before it; Enter opens it, and its links come next in order.
  await disclosure("How do I stop promotional emails?").locator("summary").focus();
  await page.keyboard.press("Tab");
  await expect(account.locator("summary")).toBeFocused();
  await expectWholeFocusRing(page);
  await page.keyboard.press("Enter");
  await expect(account).toHaveJSProperty("open", true);
  await expect(links).toHaveCount(2);
  await expect(links.nth(1)).toBeVisible();
  await expect(chevron).toHaveCSS("rotate", "180deg");
  await page.keyboard.press("Tab");
  await expect(links.first()).toBeFocused();

  // Space closes it again, and Tab then skips its hidden links.
  await page.keyboard.press("Shift+Tab");
  await expect(account.locator("summary")).toBeFocused();
  await page.keyboard.press(" ");
  await expect(account).toHaveJSProperty("open", false);
  await expect(links.first()).toBeHidden();
  await page.keyboard.press("Tab");
  await expect(disclosure("How do I contact you?").locator("summary")).toBeFocused();

  // A tap opens a question, and opening another leaves it open, so two answers can be read together.
  await disclosure("What can I try?").locator("summary").click();
  await expect(main.getByText("checkout stops before an order is placed", { exact: false })).toBeVisible();
  await disclosure("Will I be charged?").locator("summary").click();
  await expect(main.getByText("the site takes no real payments", { exact: false })).toBeVisible();
  await expect(main.getByText("checkout stops before an order is placed", { exact: false })).toBeVisible();
  await expect(main.locator("details[open]")).toHaveCount(2);
});

test("an unknown address shows the not-found page with working links, and the footer's Privacy and Terms links navigate", async ({ page }) => {
  await page.goto("/#/does-not-exist");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "We can't find that page" })).toBeVisible();
  await expect(page).toHaveTitle("Page not found · Apex Cart");
  await main.getByRole("link", { name: "Browse the shop" }).click();
  await expect(page).toHaveURL(/#\/shop$/);
  await page.goBack();
  await main.getByRole("link", { name: "Contact us" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Contact us" })).toBeFocused();
  await page.goBack();
  await main.getByRole("link", { name: "Go to the home page" }).click();
  await expect(page).toHaveURL(/#\/$/);

  const footer = page.getByRole("contentinfo");
  await footer.getByRole("link", { name: "Privacy", exact: true }).click();
  await expect(page).toHaveURL(/#\/privacy$/);
  await expect(page.getByRole("heading", { level: 1, name: "Privacy notice" })).toBeFocused();
  await footer.getByRole("link", { name: "Terms", exact: true }).click();
  await expect(page).toHaveURL(/#\/terms$/);
  await expect(page.getByRole("heading", { level: 1, name: "Terms of use" })).toBeFocused();
});

test("every footer link is at least 44px each way on a 360px phone, at normal and 200% text", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone widths are checked in the mobile project.");
  await page.setViewportSize(NARROW_PHONE);
  await page.goto("/#/faq");
  const links = page.getByRole("contentinfo").getByRole("link");
  await expect(links.filter({ hasText: "Staff portal" })).toHaveCount(1);
  // Short labels ("FAQ", "Terms") are narrower than 44px at normal text, so the minimum width matters most there.
  for (const size of ["100%", "200%"]) {
    await setTextSize(page, size);
    for (const link of await links.all()) {
      const name = (await link.textContent())?.trim();
      const box = (await link.boundingBox())!;
      expect.soft(box.width, `${name}: width at ${size} text`).toBeGreaterThanOrEqual(TOUCH_TARGET);
      expect.soft(box.height, `${name}: height at ${size} text`).toBeGreaterThanOrEqual(TOUCH_TARGET);
    }
    await expect.poll(() => pageOverflow(page)).toBeLessThanOrEqual(0);
  }
});

test("the footer's Privacy, Terms and Staff portal links share one line from 768px", async ({ page, isMobile }) => {
  test.skip(isMobile, "Desktop widths are checked in the desktop project.");
  const footer = page.getByRole("contentinfo");
  const tops = () => Promise.all(["Privacy", "Terms", "Staff portal"].map(async (name) =>
    Math.round((await footer.getByRole("link", { name, exact: true }).boundingBox())!.y)));
  for (const width of [768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/faq");
    await expect(page.getByRole("heading", { level: 1, name: "FAQ" })).toBeVisible();
    const [first, ...rest] = await tops();
    expect(rest, `${width}px: links on the first link's line`).toEqual(rest.map(() => first));
  }
});
