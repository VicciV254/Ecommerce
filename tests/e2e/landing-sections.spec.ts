import type { BrowserContext, Locator, Page } from "@playwright/test";
import type { StorefrontSettings } from "../../src/api/catalog";
import { DISCOVERY_DEPARTMENTS, discoveryShirts, discoverySnapshot } from "../../src/test-support/discoveryFixtures";
import { clippedWithin, expect, expectWholeFocusRing, pageOverflow, publishedStorefront, test } from "./fixtures";

/*
 * P8.7 landing page sections in a real browser: product rails, the departments grid, the shopping facts strip and the
 * measured best sellers, on the 14-department catalog.
 */
type Section = StorefrontSettings["sections"][number];
const section = (id: string, type: Section["type"], title: string, extra: Partial<Section> = {}): Section =>
  ({ id, type, title, enabled: true, productIds: [], categoryIds: [], campaignId: null, ...extra });

const BEST_SELLERS_PATH = "/api/settings/storefront/best-sellers";
const picks = (count = 12) => section("picks", "products", "Staff picks", { productIds: discoveryShirts.slice(0, count).map((product) => product.id), layout: "rail" });
const departmentsGrid = section("departments", "departments", "Shop by department", { layout: "grid" });
const facts = section("facts", "promises", "How shopping works");
const bestSellers = section("best", "bestSellers", "Best sellers");
const fashionRow = section("fashion", "category", "Fashion", { categoryIds: ["dept-fashion"] });
const landing = [facts, departmentsGrid, picks(), fashionRow, bestSellers];

/** Serves the 14-department catalog and a published storefront with `sections`. */
async function serveLanding(context: BrowserContext, sections: Section[]) {
  await context.route("**/api/catalog", (route) => route.fulfill({ json: discoverySnapshot() }));
  await context.route("**/api/settings/storefront", (route) =>
    route.fulfill({ json: { ...publishedStorefront, settings: { ...publishedStorefront.settings, sections } } }));
}

/** Two animation frames: long enough for a measured rail to update its controls. */
const frames = (page: Page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

/** The bottom edge of the sticky chrome. */
const stickyBottom = (page: Page) => page.evaluate(() =>
  Math.max(...[...document.querySelectorAll("[data-sticky-header]")].map((element) => element.getBoundingClientRect().bottom)));

/** Rail items wholly inside the rail's visible box, and those only partly inside it. */
const railView = (rail: Locator) => rail.evaluate((list) => {
  const box = list.getBoundingClientRect();
  const items = [...list.children].map((item) => item.getBoundingClientRect());
  const whole = items.filter((item) => item.left >= box.left - 1 && item.right <= box.right + 1).length;
  const part = items.filter((item) => item.right > box.left + 1 && item.left < box.right - 1).length - whole;
  return { whole, part };
});

/** Boxes of the visible elements a locator matches, rounded to whole pixels. */
const boxesOf = (locator: Locator) => locator.evaluateAll((elements) => elements.map((element) => {
  const box = element.getBoundingClientRect();
  return { x: Math.round(box.x), y: Math.round(box.y), width: box.width, height: box.height };
}));

test("a product rail moves only when asked, from the keyboard, and at once under reduced motion", async ({ page, context }) => {
  await serveLanding(context, [picks()]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const rail = page.getByRole("list", { name: "Staff picks" });
  await expect(rail.getByRole("listitem")).toHaveCount(12);
  const next = page.getByRole("button", { name: "Next products in Staff picks" });
  const previous = page.getByRole("button", { name: "Previous products in Staff picks" });
  await expect(next).toBeVisible();
  await expect(previous).toHaveCount(0);
  const position = () => rail.evaluate((element) => element.scrollLeft);
  await page.waitForTimeout(500);
  expect(await position(), "no automatic movement").toBe(0);

  await next.focus();
  await page.keyboard.press("Enter");
  await frames(page);
  const moved = await position();
  expect(moved).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  expect(await position(), "reduced motion: the move was complete at once").toBe(moved);
  await expect(previous).toBeVisible();
  await expect(next).toBeFocused();
  await page.keyboard.press(" ");
  await frames(page);
  expect(await position(), "Space moves it too").toBeGreaterThan(moved);

  for (let press = 0; press < 20 && (await next.count()); press += 1) {
    await page.keyboard.press("Enter");
    await frames(page);
  }
  await expect(next).toHaveCount(0);
  // The focused Next button left at the end; focus moved to Previous instead of being lost.
  await expect(previous).toBeFocused();
  expect(await rail.evaluate((element) => element.scrollLeft + element.clientWidth >= element.scrollWidth - 1)).toBe(true);
  await page.keyboard.press("Enter");
  await frames(page);
  expect(await position()).toBeLessThan(await rail.evaluate((element) => element.scrollWidth - element.clientWidth));
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
});

test("Tab moves through the rail in visual order, keeping each focused control in view with its whole ring", async ({ page, context }) => {
  await serveLanding(context, [picks()]);
  await page.goto("/");
  const rail = page.getByRole("list", { name: "Staff picks" });
  await expect(rail.getByRole("listitem")).toHaveCount(12);
  await page.getByRole("link", { name: /View all\s*Staff picks/ }).focus();
  const visited: string[] = [];
  for (let press = 0; press < 16; press += 1) {
    await page.keyboard.press("Tab");
    visited.push(await expectWholeFocusRing(page));
    const top = await page.evaluate(() => document.activeElement!.getBoundingClientRect().top);
    expect(top, `${visited.at(-1)} below the sticky header`).toBeGreaterThanOrEqual(await stickyBottom(page));
  }
  expect(visited[0]).toBe("Next products in Staff picks");
  // Card by card: the wishlist button, the name, then the card's action (sold-out cards have none).
  const names = visited.filter((name) => name.startsWith("Discovery Shirt"));
  expect(names).toEqual(discoveryShirts.slice(0, names.length).map((product) => product.name));
  expect(names.length).toBeGreaterThanOrEqual(4);
  expect(await rail.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
});

test("a rail that stops overflowing while its control has focus hands focus to its link", async ({ page, context, isMobile }) => {
  test.skip(isMobile, "The window is widened from a phone width in the desktop project.");
  const someDepartments = DISCOVERY_DEPARTMENTS.slice(0, 6).map(({ name }) => `dept-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`);
  await serveLanding(context, [picks(5), section("departments", "departments", "Shop by department", { categoryIds: someDepartments })]);
  for (const [control, link] of [
    [page.getByRole("button", { name: "Next products in Staff picks" }), page.getByRole("link", { name: /View all\s*Staff picks/ })],
    [page.getByRole("button", { name: "Next departments" }), page.getByRole("main").getByRole("link", { name: "All departments" })],
  ]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(control).toBeVisible();
    await control.focus();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(control).toHaveCount(0);
    await expect(link).toBeFocused();
  }
});

test("the departments grid shows 8 departments on phones, 12 from 768px and all from 1280px", async ({ page, context, isMobile }) => {
  await serveLanding(context, [departmentsGrid]);
  const widths: [number, number, number][] = isMobile
    ? [[360, 2, 8], [390, 2, 8], [430, 2, 8]]
    : [[768, 4, 12], [1024, 4, 12], [1280, 7, 14], [1440, 7, 14]];
  for (const [width, columns, shown] of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const tiles = page.getByRole("list", { name: "Shop by department" }).getByRole("link");
    await expect(tiles, `${width}px`).toHaveCount(shown);
    const boxes = await boxesOf(tiles);
    expect(new Set(boxes.map((box) => box.x)).size, `${width}px columns`).toBe(columns);
    expect(boxes.map((tile) => tile.width).every((tileWidth) => Math.abs(tileWidth - boxes[0].width) < 1), `${width}px equal tiles`).toBe(true);
    await expect(page.getByRole("main").getByRole("link", { name: "All departments" })).toBeVisible();
    expect(await pageOverflow(page), `${width}px`).toBeLessThanOrEqual(0);
  }
});

test("the shopping facts are 2 by 2 on phones and one row from 768px; at 200% text they wrap inside their boxes", async ({ page, context, isMobile }) => {
  await serveLanding(context, [facts, departmentsGrid]);
  const strip = page.getByRole("list", { name: "How shopping works" });
  const links = strip.getByRole("link");
  if (isMobile) {
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 780 });
      await page.goto("/");
      await expect(links).toHaveCount(4);
      const boxes = await boxesOf(links);
      expect([new Set(boxes.map((box) => box.x)).size, new Set(boxes.map((box) => box.y)).size], `${width}px: 2 by 2`).toEqual([2, 2]);
    }
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/");
    await expect(links).toHaveCount(4);
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    expect(await pageOverflow(page), "360px at 200% text").toBeLessThanOrEqual(0);
    expect(await clippedWithin(strip), "fact text wraps inside its box").toEqual([]);
    for (const box of await boxesOf(links)) expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    await links.first().focus();
    for (let index = 0; index < 4; index += 1) {
      await expect(links.nth(index)).toBeFocused();
      await expectWholeFocusRing(page);
      await page.keyboard.press("Tab");
    }
    return;
  }
  for (const width of [768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(links).toHaveCount(4);
    const boxes = await boxesOf(links);
    expect([new Set(boxes.map((box) => box.x)).size, new Set(boxes.map((box) => box.y)).size], `${width}px: one row`).toEqual([4, 1]);
  }
});

test("product rails show two cards on phones and five or six at 1280px, each with part of the next", async ({ page, context, isMobile }) => {
  await serveLanding(context, [picks()]);
  const rail = page.getByRole("list", { name: "Staff picks" });
  const expected: [number, number[]][] = isMobile
    ? [[360, [2]], [390, [2]], [430, [2]]]
    : [[768, [3]], [1024, [4]], [1280, [5, 6]], [1440, [5, 6]]];
  for (const [width, whole] of expected) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(rail.getByRole("listitem")).toHaveCount(12);
    const view = await railView(rail);
    expect(whole, `${width}px: ${view.whole} whole cards`).toContain(view.whole);
    expect(view.part, `${width}px: part of the next card`).toBe(1);
    // Each card fills its slot, and the row's cards are one height.
    const cards = await rail.evaluate((list) => [...list.children].map((item) => ({
      slot: item.getBoundingClientRect().width, card: item.firstElementChild!.getBoundingClientRect().width,
      height: Math.round(item.firstElementChild!.getBoundingClientRect().height),
    })));
    expect(cards.every(({ slot, card }) => Math.abs(slot - card) < 1), `${width}px: cards fill their slots`).toBe(true);
    expect(new Set(cards.map(({ height }) => height)).size, `${width}px: one card height`).toBe(1);
    await expect(page.getByRole("button", { name: "Next products in Staff picks" })).toBeVisible();
  }
});

test("no page-level overflow with every new section, from 360px to 1440px and at 200% text on phones", async ({ page, context, isMobile }) => {
  await serveLanding(context, landing);
  await context.route(`**${BEST_SELLERS_PATH}`, (route) =>
    route.fulfill({ json: { windowDays: 30, productIds: discoveryShirts.slice(10, 16).map((product) => product.id) } }));
  for (const width of isMobile ? [360, 390, 430] : [768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("list", { name: "Best sellers" }).getByRole("listitem")).toHaveCount(6);
    await expect(page.getByRole("list", { name: "Fashion" }).getByRole("listitem")).toHaveCount(12);
    expect(await pageOverflow(page), `${width}px`).toBeLessThanOrEqual(0);
    if (width === 360) {
      await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      expect(await pageOverflow(page), "360px at 200% text").toBeLessThanOrEqual(0);
      expect(await clippedWithin(page.getByRole("main")), "360px at 200% text").toEqual([]);
      const targets = page.getByRole("main").getByRole("button", { name: /^(Previous|Next) products in / })
        .or(page.getByRole("main").getByRole("link", { name: /^(View all|See all|All departments)/ }));
      const sizes = await boxesOf(targets);
      expect(sizes.length, "rail controls and section links").toBeGreaterThanOrEqual(6);
      for (const box of sizes) expect(Math.min(box.width, box.height), "a 44px target at 200% text").toBeGreaterThanOrEqual(44);
      await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    }
  }
});

test.describe("best sellers", () => {
  const requested = (page: Page) => {
    const urls: string[] = [];
    page.on("request", (request) => { if (new URL(request.url()).pathname === BEST_SELLERS_PATH) urls.push(request.url()); });
    return urls;
  };

  test("a page without an enabled best sellers section asks for no ranking", async ({ page, context }) => {
    const urls = requested(page);
    await page.goto("/");
    await expect(page.getByRole("list", { name: "Shop by department" })).toBeVisible();
    await serveLanding(context, [departmentsGrid, { ...bestSellers, enabled: false }]);
    await page.reload();
    await expect(page.getByRole("list", { name: "Shop by department" }).getByRole("link").first()).toBeVisible();
    await page.waitForTimeout(300);
    expect(urls).toEqual([]);
  });

  const hidden: [string, ((context: BrowserContext) => Promise<unknown>) | null][] = [
    ["no product qualifies (the default answer)", null],
    ["the ranking fails", (context) => context.route(`**${BEST_SELLERS_PATH}`, (route) => route.fulfill({ status: 503, json: { error: "Unavailable" } }))],
    ["the answer is malformed", (context) => context.route(`**${BEST_SELLERS_PATH}`, (route) => route.fulfill({ json: { windowDays: 30, productIds: "shirt-1" } }))],
    ["only three of its products are in the catalog", (context) => context.route(`**${BEST_SELLERS_PATH}`, (route) =>
      route.fulfill({ json: { windowDays: 30, productIds: ["shirt-1", "retired-product", "shirt-2", "shirt-3"] } }))],
  ];
  for (const [name, serve] of hidden) {
    test(`stay hidden when ${name}`, async ({ page, context }) => {
      await serveLanding(context, [bestSellers, departmentsGrid]);
      await serve?.(context);
      const urls = requested(page);
      const answered = page.waitForResponse((response) => new URL(response.url()).pathname === BEST_SELLERS_PATH);
      await page.goto("/");
      await answered;
      await expect(page.getByRole("list", { name: "Shop by department" }).getByRole("link").first()).toBeVisible();
      await page.waitForTimeout(300);
      await expect(page.getByRole("heading", { name: "Best sellers" })).toHaveCount(0);
      await expect(page.getByText(/Ranked by paid orders/)).toHaveCount(0);
      expect(urls).toHaveLength(1);
    });
  }

  test("show a qualifying ranking in its order, with how it was ranked", async ({ page, context }) => {
    await serveLanding(context, [bestSellers, departmentsGrid]);
    await context.route(`**${BEST_SELLERS_PATH}`, (route) =>
      route.fulfill({ json: { windowDays: 30, productIds: ["shirt-4", "retired-product", "shirt-2", "shirt-1", "shirt-3"] } }));
    await page.goto("/");
    const rail = page.getByRole("list", { name: "Best sellers" });
    await expect(rail.getByRole("heading", { level: 3 })).toHaveText(["Discovery Shirt 4", "Discovery Shirt 2", "Discovery Shirt 1", "Discovery Shirt 3"]);
    await expect(page.getByText("Ranked by paid orders in the last 30 days")).toBeVisible();
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test("a published section of a kind this version doesn't know is left out; the rest of the page shows", async ({ page, context }) => {
  await serveLanding(context, [
    departmentsGrid,
    { ...section("stores", "featured", "Our sellers"), type: "stores" } as unknown as Section,
    picks(),
  ]);
  await page.goto("/");
  await expect(page.getByRole("list", { name: "Staff picks" }).getByRole("listitem")).toHaveCount(12);
  await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText(["Shop by department", "Staff picks"]);
  await expect(page.getByText("Storefront content is unavailable")).toHaveCount(0);
});

test("nothing already on screen moves while the storefront and then the catalog arrive", async ({ page, context }) => {
  const hero = section("hero", "campaign", "Hero", { campaignId: "week" });
  const settings: StorefrontSettings = {
    ...publishedStorefront.settings,
    sections: [hero, facts, departmentsGrid, picks()],
    campaigns: [{
      id: "week", title: "Fashion week", body: "New arrivals across the department.", conditions: "",
      cta: { label: "Shop fashion", target: "category", targetId: "dept-fashion" },
      desktopMediaId: "media-campaign-desktop", mobileMediaId: null,
      desktopFocal: { x: 50, y: 50 }, mobileFocal: { x: 50, y: 50 }, layout: "split",
    }],
  };
  // Each answer waits until the test releases it.
  let releaseStorefront = () => {};
  let releaseCatalog = () => {};
  const storefrontReleased = new Promise<void>((resolve) => { releaseStorefront = resolve; });
  const catalogReleased = new Promise<void>((resolve) => { releaseCatalog = resolve; });
  await context.route("**/api/settings/storefront", async (route) => {
    await storefrontReleased;
    await route.fulfill({ json: { ...publishedStorefront, settings } });
  });
  await context.route("**/api/catalog", async (route) => {
    await catalogReleased;
    await route.fulfill({ json: discoverySnapshot() });
  });
  await page.addInitScript(() => {
    const shifts = window as unknown as { layoutShift: number };
    shifts.layoutShift = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!entry.hadRecentInput) shifts.layoutShift += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  const top = (locator: Locator) => locator.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);

  await page.goto("/");
  await expect(page.getByRole("status").filter({ hasText: "Loading the storefront" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // The footer waits below the first screen, where the arriving page can't push it.
  expect(await top(page.getByRole("contentinfo"))).toBeGreaterThanOrEqual(page.viewportSize()?.height ?? 0);
  const main = page.locator("main");
  const mainTop = await top(main);

  releaseStorefront();
  const heroRegion = page.getByRole("region", { name: "Fashion week" });
  const strip = page.getByRole("list", { name: "How shopping works" });
  await expect(strip).toBeVisible();
  await frames(page);
  const placed = { main: await top(main), hero: await top(heroRegion), strip: await top(strip) };
  expect(placed.main).toBe(mainTop);

  releaseCatalog();
  await expect(heroRegion.getByRole("link", { name: "Shop fashion" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Shop by department" }).getByRole("link").first()).toBeVisible();
  await frames(page);
  expect({ main: await top(main), hero: await top(heroRegion), strip: await top(strip) }).toEqual(placed);
  expect(await page.evaluate(() => (window as unknown as { layoutShift: number }).layoutShift)).toBeLessThan(0.01);
});

test("a split hero sits beside its artwork from 768px, and stacks while enlarged text needs the room", async ({ page, context, isMobile }) => {
  test.skip(isMobile, "Tablet and laptop widths are set in the desktop project.");
  const hero = section("hero", "campaign", "Hero", { campaignId: "week" });
  const settings: StorefrontSettings = {
    ...publishedStorefront.settings,
    sections: [hero],
    campaigns: [{
      id: "week", title: "Shop for home, work and play", body: "Phones, fashion and more.", conditions: "",
      cta: { label: "Browse products", target: "shop", targetId: null },
      desktopMediaId: "media-campaign-desktop", mobileMediaId: null,
      desktopFocal: { x: 50, y: 50 }, mobileFocal: { x: 50, y: 50 }, layout: "split",
    }],
  };
  await context.route("**/api/settings/storefront", (route) => route.fulfill({ json: { ...publishedStorefront, settings } }));
  const heading = page.getByRole("heading", { name: "Shop for home, work and play" });
  const region = page.getByRole("region", { name: "Shop for home, work and play" });
  /** Whether the artwork is beside the heading (true) or above it (false). */
  const beside = async () => {
    const art = await region.locator("picture img").boundingBox();
    const title = await heading.boundingBox();
    return Boolean(art && title && art.x >= title.x + title.width);
  };
  /** Lines of the heading as laid out, so a word broken inside itself shows up as a fragment. */
  const lines = () => heading.evaluate((element) => {
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
  const words = ["Shop", "for", "home,", "work", "and", "play"];

  for (const [width, expected] of [[767, false], [768, true], [1280, true]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(heading).toBeVisible();
    expect(await beside(), `${width}px at 100% text`).toBe(expected);
  }
  for (const width of [768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(heading).toBeVisible();
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await frames(page);
    expect(await lines(), `${width}px at 200% text`).toEqual(words);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  }
});

/*
 * More ways the page can arrive (the hero carousel's contract): a carousel leading the page, a leading product section
 * that turns out empty, a best-sellers ranking that comes in last, and a catalog that fails. In each, whatever is
 * already on the screen stays where it is, and the layout shift score stays under 0.01.
 */
test.describe("nothing on screen moves while the page arrives", () => {
  const campaigns: StorefrontSettings["campaigns"] = [
    { id: "week", title: "Fashion week", body: "New arrivals across the department.", conditions: "", cta: { label: "Shop fashion", target: "category", targetId: "dept-fashion" },
      desktopMediaId: "media-campaign-desktop", mobileMediaId: null, desktopFocal: { x: 50, y: 50 }, mobileFocal: { x: 50, y: 50 }, layout: "overlay" },
    { id: "season", title: "New season", body: "Desks, lamps and laptops.", conditions: "", cta: { label: "Browse products", target: "shop", targetId: null },
      desktopMediaId: "media-campaign-mobile", mobileMediaId: null, desktopFocal: { x: 50, y: 50 }, mobileFocal: { x: 50, y: 50 }, layout: "overlay" },
  ];
  const carousel = section("hero-carousel", "carousel", "Highlights", { campaignIds: ["week", "season"] });
  const featured = section("featured", "featured", "Featured products");

  /** Holds the storefront, the catalog and the ranking until each is released; the catalog may fail instead. */
  async function stagedLoad(page: Page, context: BrowserContext, sections: Section[], { catalog = discoverySnapshot(), fail = false } = {}) {
    const gates = { storefront: () => {}, catalog: () => {}, ranking: () => {} };
    const held = (name: keyof typeof gates) => new Promise<void>((resolve) => { gates[name] = resolve; });
    const [storefront, catalogGate, ranking] = [held("storefront"), held("catalog"), held("ranking")];
    await context.route("**/api/settings/storefront", async (route) => {
      await storefront;
      await route.fulfill({ json: { ...publishedStorefront, settings: { ...publishedStorefront.settings, sections, campaigns } } });
    });
    await context.route("**/api/catalog", async (route) => {
      await catalogGate;
      await (fail ? route.fulfill({ status: 503, json: { error: "Unavailable" } }) : route.fulfill({ json: catalog }));
    });
    await context.route(`**${BEST_SELLERS_PATH}`, async (route) => {
      await ranking;
      await route.fulfill({ json: { windowDays: 30, productIds: discoveryShirts.slice(0, 6).map((product) => product.id) } });
    });
    await page.addInitScript(() => {
      const shifts = window as unknown as { layoutShift: number };
      shifts.layoutShift = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!entry.hadRecentInput) shifts.layoutShift += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto("/");
    await expect(page.getByRole("status").filter({ hasText: "Loading the storefront" })).toBeAttached();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    return gates;
  }
  /** Document-relative tops of the visible elements on the first screen inside `main`, by a stable key. */
  const onScreen = (page: Page) => page.evaluate(() => {
    const tops: Record<string, number> = {};
    for (const element of document.querySelectorAll<HTMLElement>("main section, main [role='note'], main h2, main ul[aria-label]")) {
      const box = element.getBoundingClientRect();
      if (box.height === 0 || box.top >= window.innerHeight || getComputedStyle(element).visibility === "hidden") continue;
      const key = `${element.tagName}:${element.getAttribute("aria-label") ?? element.textContent?.slice(0, 30)}`;
      tops[key] = Math.round(box.top + window.scrollY);
    }
    return tops;
  });
  /** Everything that was on screen before is still there, at the same place. */
  async function expectStill(page: Page, before: Record<string, number>) {
    await frames(page);
    const after = await onScreen(page);
    for (const [key, top] of Object.entries(before)) expect(after[key], key).toBe(top);
  }
  const shiftScore = (page: Page) => page.evaluate(() => (window as unknown as { layoutShift: number }).layoutShift);

  test("a hero carousel leading the page", async ({ page, context }) => {
    const gates = await stagedLoad(page, context, [carousel, facts, departmentsGrid, picks()]);
    gates.storefront();
    await expect(page.getByRole("region", { name: "Highlights" })).toBeVisible();
    await expect(page.getByRole("list", { name: "How shopping works" })).toBeVisible();
    await frames(page);
    const before = await onScreen(page);
    expect(Object.keys(before).some((key) => key.includes("Highlights"))).toBe(true);
    gates.catalog();
    await expect(page.getByRole("list", { name: "Shop by department" }).getByRole("link").first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Highlights" }).getByRole("link", { name: "Shop fashion" })).toBeVisible();
    await expectStill(page, before);
    expect(await shiftScore(page)).toBeLessThan(0.01);
  });

  test("a leading product section that turns out empty", async ({ page, context }) => {
    const nothingFeatured = { ...discoverySnapshot(), products: discoverySnapshot().products.map((product) => ({ ...product, isFeatured: false })) };
    const gates = await stagedLoad(page, context, [featured, facts, departmentsGrid], { catalog: nothingFeatured });
    gates.storefront();
    await expect(page.getByRole("status").filter({ hasText: "Loading featured products" })).toBeAttached();
    await frames(page);
    const before = await onScreen(page);
    gates.catalog();
    await expect(page.getByRole("list", { name: "Shop by department" }).getByRole("link").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Featured products" })).toHaveCount(0);
    await expectStill(page, before);
    expect(await shiftScore(page)).toBeLessThan(0.01);
  });

  test("a best-sellers ranking that arrives after the catalog", async ({ page, context }) => {
    const gates = await stagedLoad(page, context, [carousel, section("best", "bestSellers", "Best sellers"), facts, departmentsGrid]);
    gates.storefront();
    await expect(page.getByRole("region", { name: "Highlights" })).toBeVisible();
    gates.catalog();
    await expect(page.getByRole("region", { name: "Highlights" }).getByRole("link", { name: "Shop fashion" })).toBeVisible();
    await page.waitForTimeout(300);
    await frames(page);
    const before = await onScreen(page);
    gates.ranking();
    await expect(page.getByRole("list", { name: "Best sellers" }).getByRole("listitem")).toHaveCount(6);
    await expectStill(page, before);
    expect(await shiftScore(page)).toBeLessThan(0.01);
  });

  test("a catalog that fails", async ({ page, context }) => {
    const gates = await stagedLoad(page, context, [carousel, facts, departmentsGrid, picks()], { fail: true });
    gates.storefront();
    await expect(page.getByRole("list", { name: "How shopping works" })).toBeVisible();
    await frames(page);
    const before = await onScreen(page);
    gates.catalog();
    await expect(page.getByRole("heading", { name: "Products are unavailable" })).toBeVisible();
    await expectStill(page, before);
    expect(await shiftScore(page)).toBeLessThan(0.01);
  });
});
