import type { BrowserContext, Locator, Page } from "@playwright/test";
import type { Campaign, StorefrontSettings } from "../../src/api/catalog";
import { discoverySnapshot } from "../../src/test-support/discoveryFixtures";
import { fixtureImage } from "../../src/test-support/catalogFixtures";
import { backdropContrast, clippedWithin, expect, expectWholeFocusRing, pageOverflow, publishedStorefront, test } from "./fixtures";

/*
 * The hero carousel in a real browser: full-width slides with copy over the photos, rotating every 6 s with a pause
 * control, stopping once someone uses it, still under reduced motion, swiped on phones without capturing vertical
 * scrolling, and loading only the photos it is about to show.
 */
type Section = StorefrontSettings["sections"][number];
const SLIDE_MS = 6000;
const IMAGE_HOST = "https://media.example.test";
const campaign = (id: string, title: string, body: string): Campaign => ({
  id, title, body, conditions: "Sample offer for this demonstration store.", cta: { label: `Shop ${title.toLowerCase()}`, target: "shop", targetId: null },
  desktopMediaId: `media-${id}`, mobileMediaId: null, desktopFocal: { x: 50, y: 50 }, mobileFocal: { x: 50, y: 50 }, layout: "overlay",
});
const CAMPAIGNS = [
  campaign("week", "Fashion week", "New arrivals across the department, from linen shirts to evening wear."),
  campaign("season", "A new season of workspace essentials", "Desks, lamps and laptops for home offices."),
  campaign("home", "Home refresh", "Bedding, kitchenware and small appliances."),
];
const MEDIA = CAMPAIGNS.map((item) => fixtureImage({ id: `media-${item.id}`, url: `${IMAGE_HOST}/${item.id}.jpg`, alt: "", width: 2400, height: 1200 }));
const carousel = (campaignIds = CAMPAIGNS.map((item) => item.id)): Section => ({
  id: "hero-carousel", type: "carousel", title: "Highlights", enabled: true, productIds: [], categoryIds: [], campaignId: null, campaignIds,
});
const facts: Section = { id: "facts", type: "promises", title: "How shopping works", enabled: true, productIds: [], categoryIds: [], campaignId: null };
const departments: Section = { id: "departments", type: "departments", title: "Shop by department", enabled: true, productIds: [], categoryIds: [], campaignId: null, layout: "grid" };

async function serveCarousel(context: BrowserContext, sections: Section[] = [carousel(), facts, departments], { photo = "#9aa5b1", placeholder = false } = {}) {
  await context.route("**/api/catalog", (route) => route.fulfill({ json: discoverySnapshot() }));
  const settings: StorefrontSettings = { ...publishedStorefront.settings, sections, campaigns: CAMPAIGNS };
  const media = MEDIA.map((item) => ({ ...item, isPlaceholder: placeholder }));
  await context.route("**/api/settings/storefront", (route) => route.fulfill({ json: { ...publishedStorefront, settings, media } }));
  await context.route(`${IMAGE_HOST}/**`, (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1200"><rect width="2400" height="1200" fill="${photo}"/></svg>`,
  }));
}

const region = (page: Page) => page.getByRole("region", { name: "Highlights" });
/**
 * Clipped text in the carousel: each slide's copy (the hidden slides lay out too) and the controls. The photo layer is
 * left out: it clips its slow zoom on purpose.
 */
async function clippedCopy(page: Page) {
  const parts = [
    ...await region(page).locator("[role='group'] h2").locator("xpath=..").all(),
    region(page).getByRole("button", { name: /^(Pause|Play) slides$/ }).locator("xpath=../.."),
  ];
  const clipped = [];
  for (const part of parts) clipped.push(...await clippedWithin(part));
  return clipped;
}
const current = (page: Page) => region(page).getByRole("group").getAttribute("aria-label");
const rotation = (page: Page) => region(page).getByRole("button", { name: /^(Pause|Play) slides$/ });
/**
 * How strongly text shows, as rendered: each pixel with the text shown against the same pixel with the text transparent,
 * best pixel. Unlike `backdropContrast`, which assumes the text paints on top, this sees anything painted over it.
 */
async function shownTextContrast(page: Page, text: Locator) {
  await text.scrollIntoViewIfNeeded();
  const clip = (await text.boundingBox())!;
  const shot = async () => (await page.screenshot({ clip, animations: "disabled" })).toString("base64");
  const shown = await shot();
  await text.evaluate((node) => (node as HTMLElement).style.setProperty("color", "transparent", "important"));
  const hidden = await shot();
  await text.evaluate((node) => (node as HTMLElement).style.removeProperty("color"));
  return page.evaluate(async (shots) => {
    const pixels = async (shot: string) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(shot), (char) => char.charCodeAt(0))], { type: "image/png" }));
      const board = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d", { willReadFrequently: true })!;
      board.drawImage(bitmap, 0, 0);
      return board.getImageData(0, 0, bitmap.width, bitmap.height).data;
    };
    const channel = (value: number) => {
      const unit = value / 255;
      return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (data: Uint8ClampedArray, at: number) => 0.2126 * channel(data[at]) + 0.7152 * channel(data[at + 1]) + 0.0722 * channel(data[at + 2]);
    const [front, back] = [await pixels(shots.shown), await pixels(shots.hidden)];
    let best = 1;
    for (let at = 0; at < front.length; at += 4) {
      const [a, b] = [luminance(front, at), luminance(back, at)];
      best = Math.max(best, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
    }
    return best;
  }, { shown, hidden });
}
/** The scale shown now, running animations included: the progress line's (x) and the current slide photo's. */
const shownScales = (page: Page) => region(page).evaluate((element) => {
  const scale = (target: Element | null) => Number(/^matrix\(([^,]+),/.exec(target ? getComputedStyle(target).transform : "")?.[1] ?? 1);
  const slide = element.querySelector("[aria-roledescription='slide']:not([aria-hidden])");
  return { line: scale(element.querySelector("[aria-current='true'] span span")), photo: scale(slide?.querySelector("[data-slide-zoom]") ?? null) };
});
/** Lines of a heading as laid out, so a word broken inside itself shows up as a fragment. */
const headingWords = (heading: Locator) => heading.evaluate((element) => {
  const text = element.firstChild as Text;
  const range = document.createRange();
  const rows = new Map<number, string>();
  for (let index = 0; index < text.length; index += 1) {
    range.setStart(text, index);
    range.setEnd(text, index + 1);
    const top = Math.round(range.getBoundingClientRect().top);
    rows.set(top, (rows.get(top) ?? "") + text.data[index]);
  }
  return [...rows.values()].flatMap((line) => line.trim().split(" "));
});

test.describe("layout", () => {
  test("spans the window edge to edge under the header, at its minimum height for the width, without overflow or clipped copy", async ({ page, context, isMobile }) => {
    await serveCarousel(context);
    const widths: [number, number][] = isMobile ? [[360, 440], [390, 440], [430, 440]] : [[768, 520], [1024, 600], [1280, 600], [1440, 600]];
    for (const [width, minimum] of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expect(region(page).getByRole("group")).toBeVisible();
      const box = (await region(page).boundingBox())!;
      const main = (await page.getByRole("main").boundingBox())!;
      expect([box.x, Math.round(box.width)], `${width}px edge to edge`).toEqual([0, width]);
      expect(Math.round(box.y), `${width}px directly under the header`).toBe(Math.round(main.y));
      expect(box.height, `${width}px tall enough`).toBeGreaterThanOrEqual(minimum);
      expect(await pageOverflow(page), `${width}px`).toBeLessThanOrEqual(0);
      expect(await clippedCopy(page), `${width}px`).toEqual([]);
      // The sample-catalog notice follows the carousel.
      const notice = page.getByRole("note").filter({ hasText: "Demo catalog" });
      expect((await notice.boundingBox())!.y).toBeGreaterThan(box.y + box.height - 1);
      for (const control of await region(page).getByRole("button").all()) {
        const size = (await control.boundingBox())!;
        expect(Math.min(size.width, size.height), `${width}px 44px target`).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test("keeps one height for every slide and moves nothing while slides change", async ({ page, context }) => {
    await serveCarousel(context);
    await page.addInitScript(() => {
      const store = window as unknown as { shifts: number };
      store.shifts = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { value: number }[]) store.shifts += entry.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto("/");
    await expect(region(page).getByRole("group")).toBeVisible();
    await page.waitForTimeout(500);
    const before = await page.evaluate(() => (window as unknown as { shifts: number }).shifts);
    const heights = [];
    for (const dot of ["Slide 2: A new season of workspace essentials", "Slide 3: Home refresh", "Slide 1: Fashion week"]) {
      await region(page).getByRole("button", { name: dot }).click();
      await page.waitForTimeout(800);
      heights.push(Math.round((await region(page).boundingBox())!.height));
    }
    expect(new Set(heights).size, `heights ${heights}`).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { shifts: number }).shifts) - before).toBe(0);
  });

  test("at 200% text on a 360px phone the copy grows the carousel and no word breaks inside", async ({ page, context, isMobile }) => {
    test.skip(!isMobile, "Phone widths are set in the mobile project.");
    await serveCarousel(context);
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/");
    await region(page).getByRole("button", { name: "Slide 2: A new season of workspace essentials" }).click();
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await page.waitForTimeout(300);
    const heading = region(page).getByRole("heading", { level: 2 });
    expect(await headingWords(heading)).toEqual("A new season of workspace essentials".split(" "));
    expect(await clippedCopy(page)).toEqual([]);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    const copy = (await region(page).getByRole("group").boundingBox())!;
    const box = (await region(page).boundingBox())!;
    expect(copy.y + copy.height).toBeLessThanOrEqual(box.y + box.height + 1);
  });

  test("at 200% text on a phone a sample photo's label stays readable over the grown copy band, clear of the heading", async ({ page, context, isMobile }) => {
    test.skip(!isMobile, "Phone widths are set in the mobile project.");
    await serveCarousel(context, [carousel(), facts], { placeholder: true });
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/");
    await rotation(page).click();
    await expect(rotation(page)).toHaveAccessibleName("Play slides");
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    // Slide 2's copy is the longest, so its band fills the slide; slide 1's is shorter, and the band's fade covers the top.
    for (const dot of ["Slide 2: A new season of workspace essentials", "Slide 1: Fashion week"]) {
      await region(page).getByRole("button", { name: dot }).click();
      await page.waitForTimeout(900);
      const slide = region(page).getByRole("group");
      const label = slide.getByText("Sample image");
      expect(await shownTextContrast(page, label), dot).toBeGreaterThanOrEqual(4.5);
      const gap = await slide.evaluate((element) => {
        const tag = [...element.querySelectorAll("span")].find((span) => span.textContent === "Sample image")!.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(element.querySelector("h2")!);
        return range.getClientRects()[0].top - tag.bottom;
      });
      expect(gap, `${dot}: space between the label and the heading's first line`).toBeGreaterThanOrEqual(0);
    }
  });

  test("white copy keeps 4.5:1 against its scrim over a pure white photo", async ({ page, context }) => {
    await serveCarousel(context, [carousel(), facts], { photo: "#ffffff" });
    await page.goto("/");
    await rotation(page).click();
    await expect(rotation(page)).toHaveAccessibleName("Play slides");
    await page.waitForTimeout(800);
    const slide = region(page).getByRole("group");
    for (const text of [slide.getByRole("heading", { level: 2 }), slide.getByText(CAMPAIGNS[0].body), slide.getByText(CAMPAIGNS[0].conditions)]) {
      expect(await backdropContrast(page, text)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

test.describe("rotation", () => {
  test("moves to the next slide after about 6 seconds, and the progress line fills meanwhile", async ({ page, context }) => {
    await serveCarousel(context);
    await page.goto("/");
    await expect(region(page).getByRole("group")).toBeVisible();
    const start = Date.now();
    await page.waitForTimeout(3000);
    const { line, photo } = await shownScales(page);
    expect(line).toBeGreaterThan(0.3);
    expect(line).toBeLessThan(0.75);
    expect(photo, "the photo zooms slowly while its slide shows").toBeGreaterThan(1.01);
    expect(photo).toBeLessThan(1.06);
    await expect.poll(() => current(page), { timeout: 8000, intervals: [100] }).toBe("2 of 3");
    expect(Date.now() - start).toBeGreaterThan(SLIDE_MS - 1500);
  });

  test("pauses while the mouse is over it and carries on where it was once the mouse leaves", async ({ page, context, isMobile }) => {
    test.skip(isMobile, "Phones have no hovering pointer.");
    await serveCarousel(context);
    await page.goto("/");
    await expect(region(page).getByRole("group")).toBeVisible();
    await page.waitForTimeout(3000);
    await region(page).getByRole("heading", { level: 2 }).hover();
    await page.waitForTimeout(SLIDE_MS + 1000);
    expect(await current(page)).toBe("1 of 3");
    await page.mouse.move(5, 5);
    const left = Date.now();
    await expect.poll(() => current(page), { timeout: 6000, intervals: [100] }).toBe("2 of 3");
    expect(Date.now() - left, "the time already shown was kept").toBeLessThan(SLIDE_MS - 1000);
  });

  test("stops for good when a dot or Next is used, until Play slides", async ({ page, context }) => {
    await serveCarousel(context);
    await page.goto("/");
    await region(page).getByRole("button", { name: "Next slide" }).click();
    expect(await current(page)).toBe("2 of 3");
    await expect(rotation(page)).toHaveAccessibleName("Play slides");
    await page.waitForTimeout(SLIDE_MS + 1000);
    expect(await current(page)).toBe("2 of 3");
    await rotation(page).click();
    await expect(rotation(page)).toHaveAccessibleName("Pause slides");
    await expect.poll(() => current(page), { timeout: SLIDE_MS + 2000, intervals: [200] }).toBe("3 of 3");
  });

  test("keyboard focus entering the carousel stops it, and its first stop is the rotation control", async ({ page, context }) => {
    await serveCarousel(context);
    await page.goto("/");
    await expect(region(page).getByRole("group")).toBeVisible();
    for (let press = 0; press < 30; press += 1) {
      await page.keyboard.press("Tab");
      if (await region(page).evaluate((element) => element.contains(document.activeElement))) break;
    }
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Play slides");
    await expectWholeFocusRing(page);
    await page.waitForTimeout(SLIDE_MS + 1000);
    expect(await current(page)).toBe("1 of 3");
  });

  test("pauses while the mini cart is open and carries on where it was once it closes", async ({ page, context }) => {
    await serveCarousel(context);
    await page.goto("/");
    await expect(region(page).getByRole("group")).toBeVisible();
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "Cart" }).click();
    const drawer = page.getByRole("dialog", { name: "Your cart" });
    await expect(drawer).toBeVisible();
    await page.waitForTimeout(SLIDE_MS + 1000);
    const frozen = await shownScales(page);
    await page.waitForTimeout(500);
    expect(await shownScales(page), "the line and the photo hold where they were").toEqual(frozen);
    expect(frozen.line).toBeGreaterThan(0.25);
    expect(frozen.photo).toBeGreaterThan(1.01);
    await drawer.getByRole("button", { name: "Close cart" }).click();
    await expect(drawer).toHaveCount(0);
    expect(await current(page)).toBe("1 of 3");
    const closed = Date.now();
    await expect.poll(() => current(page), { timeout: 6000, intervals: [100] }).toBe("2 of 3");
    expect(Date.now() - closed, "the time already shown was kept").toBeLessThan(SLIDE_MS - 1000);
  });

  test("starts stopped under reduced motion, without slow zoom, and changes slides at once", async ({ page, context }) => {
    await serveCarousel(context);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(rotation(page)).toHaveAccessibleName("Play slides");
    await page.waitForTimeout(SLIDE_MS + 1000);
    expect(await current(page)).toBe("1 of 3");
    await region(page).getByRole("button", { name: "Next slide" }).click();
    const opacity = await region(page).getByRole("group").evaluate((element) => getComputedStyle(element).opacity);
    expect(opacity).toBe("1");
    await page.waitForTimeout(1000);
    // No slow zoom was ever applied to any slide.
    const zooms = await region(page).locator("[data-slide-zoom]").evaluateAll((layers) => layers.map((layer) => getComputedStyle(layer).transform));
    expect(zooms.length).toBe(3);
    expect(zooms.every((zoom) => zoom === "none" || zoom === "matrix(1, 0, 0, 1, 0, 0)"), zooms.join()).toBe(true);
  });
});

test.describe("photos", () => {
  test("loads only the shown slide's photo first, the next about a second after it shows, and the third when its turn nears", async ({ page, context }) => {
    await serveCarousel(context);
    const requested: { url: string; at: number }[] = [];
    page.on("request", (request) => { if (request.url().startsWith(IMAGE_HOST)) requested.push({ url: request.url(), at: Date.now() }); });
    await page.goto("/");
    await expect(region(page).getByRole("group")).toBeVisible();
    const shown = Date.now();
    await page.waitForTimeout(600);
    expect(requested.map((item) => new URL(item.url).pathname)).toEqual(["/week.jpg"]);
    await expect.poll(() => requested.length, { timeout: 3000 }).toBe(2);
    expect(new URL(requested[1].url).pathname).toBe("/season.jpg");
    expect(requested[1].at - shown).toBeGreaterThan(700);
    await page.waitForTimeout(1500);
    expect(requested).toHaveLength(2);
    const first = region(page).locator("img").first();
    expect([await first.getAttribute("loading"), await first.getAttribute("fetchpriority")]).toEqual(["eager", "high"]);
  });
});

test.describe("swipes on phones", () => {
  test.skip(({ isMobile }) => !isMobile, "Touch gestures run in the mobile project.");

  /** One finger from `from` to `to`, held still before lifting so no fling carries on. */
  async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
    const cdp = await page.context().newCDPSession(page);
    const point = (step: number) => [{ x: from.x + ((to.x - from.x) * step) / 8, y: from.y + ((to.y - from.y) * step) / 8 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(0) });
    for (let step = 1; step <= 8; step += 1) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(step) });
    await page.waitForTimeout(150);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  }
  /** A point on the photo above the copy, clear of every control. */
  const onPhoto = (page: Page) => region(page).evaluate((element) => {
    const box = element.getBoundingClientRect();
    const point = { x: box.left + box.width * 0.7, y: box.top + 60 };
    const hit = document.elementFromPoint(point.x, point.y);
    return { ...point, onSlide: Boolean(hit && element.contains(hit) && !hit.closest("button, a")) };
  });

  test("a horizontal swipe changes the slide and stops rotation; a vertical one scrolls the page instead", async ({ page, context }) => {
    await serveCarousel(context);
    await page.goto("/");
    await expect(region(page).getByRole("group")).toBeVisible();
    const start = await onPhoto(page);
    expect(start.onSlide, "the swipe starts on the slide itself").toBe(true);
    await swipe(page, start, { x: start.x - 160, y: start.y + 4 });
    expect(await current(page)).toBe("2 of 3");
    await expect(rotation(page)).toHaveAccessibleName("Play slides");

    const scrolled = await page.evaluate(() => window.scrollY);
    await swipe(page, { x: start.x, y: start.y + 120 }, { x: start.x + 10, y: start.y - 100 });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrolled + 50);
    expect(await current(page)).toBe("2 of 3");
  });

  test("a swipe while the page is pinch-zoomed pans the page and leaves the slide alone", async ({ page, context }) => {
    await serveCarousel(context);
    await page.goto("/");
    await expect(region(page).getByRole("group")).toBeVisible();
    await rotation(page).click();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    await expect.poll(() => page.evaluate(() => window.visualViewport!.scale)).toBeGreaterThan(1.5);
    const start = await region(page).evaluate((element) => {
      const box = element.getBoundingClientRect();
      const view = window.visualViewport!;
      return { x: view.offsetLeft + view.width * 0.7, y: Math.max(box.top, view.offsetTop) + 40 };
    });
    await swipe(page, start, { x: start.x - 120, y: start.y });
    await page.waitForTimeout(300);
    expect(await current(page)).toBe("1 of 3");
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
    await cdp.detach();
  });
});
