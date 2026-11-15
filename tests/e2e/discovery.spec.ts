import type { BrowserContext, Locator, Page } from "@playwright/test";
import { fixtureImage } from "../../src/test-support/catalogFixtures";
import { DISCOVERY_DEPARTMENTS, SHIRT_COUNT, discoveryProducts, discoverySnapshot } from "../../src/test-support/discoveryFixtures";
import { expect, pageOverflow, publishedStorefront, test } from "./fixtures";

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** Serves the 14-department catalog and its product details. */
async function serveDiscoveryCatalog(context: BrowserContext) {
  await context.route("**/api/catalog", (route) => route.fulfill({ json: discoverySnapshot() }));
  await context.route("**/api/products/*", (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() ?? "");
    const product = discoveryProducts.find((item) => item.id === id);
    return product ? route.fulfill({ json: { ...product, reviewList: [] } }) : route.fallback();
  });
}

/** Product names on the listing page, in order. */
const listed = (page: Page) => page.getByRole("list", { name: "Products" }).getByRole("listitem").getByRole("heading", { level: 3 }).allTextContents();

/** Waits until the window has stopped scrolling (smooth scrolling and restoration may take a few frames). */
async function scrollSettled(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    let last = window.scrollY;
    let still = 0;
    const timer = window.setInterval(() => {
      still = window.scrollY === last ? still + 1 : 0;
      last = window.scrollY;
      if (still >= 6) {
        window.clearInterval(timer);
        resolve();
      }
    }, 50);
  }));
}

/** The bottom edge of the sticky chrome (brand row, plus the phone search row while it sticks). */
const stickyBottom = (page: Page) => page.evaluate(() =>
  Math.max(...[...document.querySelectorAll("[data-sticky-header]")].map((element) => element.getBoundingClientRect().bottom)));

const activate = (locator: Locator, touch: boolean) => (touch ? locator.tap() : locator.click());

const WHITE_ARTWORK = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="#fff"/></svg>';

/**
 * Plain white artwork for every department and for an overlay hero: the worst backdrop for light text laid over
 * images. `layout` is read on each request, so a reload picks up a change.
 */
async function serveWhiteArtwork(context: BrowserContext, hero: { layout: "overlay" | "banner" }) {
  await context.route(/^https:\/\/media\.example\.test\//, (route) => route.fulfill({ contentType: "image/svg+xml", body: WHITE_ARTWORK }));
  const snapshot = discoverySnapshot();
  snapshot.categories = snapshot.categories.map((category) =>
    (category.parentId ? category : { ...category, image: `https://media.example.test/${category.id}.jpg` }));
  await context.route("**/api/catalog", (route) => route.fulfill({ json: snapshot }));
  const media = [fixtureImage({ id: "hero-art", url: "https://media.example.test/hero.jpg", alt: "", width: 2400, height: 1200, isPlaceholder: false })];
  await context.route("**/api/settings/storefront", (route) => route.fulfill({
    json: {
      ...publishedStorefront,
      media,
      settings: {
        ...publishedStorefront.settings,
        sections: [
          { id: "hero", type: "campaign", title: "Hero", enabled: true, productIds: [], categoryIds: [], campaignId: "launch" },
          ...publishedStorefront.settings.sections,
        ],
        campaigns: [{
          id: "launch", title: "New season shirts", body: "Linen and cotton shirts for warm days, in sizes S to L.",
          conditions: "Sample campaign for review. Prices exclude VAT.", cta: { label: "Shop shirts", target: "shop", targetId: null },
          desktopMediaId: "hero-art", mobileMediaId: null, desktopFocal: { x: 50, y: 50 }, mobileFocal: { x: 50, y: 50 }, layout: hero.layout,
        }],
      },
    },
  }));
}

/**
 * The lowest WCAG contrast between `text` and the pixels behind its words. The words are hidden while each line's box
 * is captured; the text colour, with its alpha, is then blended over every captured pixel.
 */
async function backdropContrast(page: Page, text: Locator) {
  await text.scrollIntoViewIfNeeded();
  const { color, lines } = await text.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 1 && rect.height > 1);
    return { color: getComputedStyle(node).color, lines: rects.map(({ x, y, width, height }) => ({ x, y, width, height })) };
  });
  await text.evaluate((node) => (node as HTMLElement).style.setProperty("color", "transparent", "important"));
  const shots: string[] = [];
  for (const clip of lines) shots.push((await page.screenshot({ clip, animations: "disabled" })).toString("base64"));
  await text.evaluate((node) => (node as HTMLElement).style.removeProperty("color"));
  expect(shots.length, "the text has visible lines").toBeGreaterThan(0);
  return page.evaluate(async ({ color, shots }) => {
    const swatch = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true })!;
    swatch.fillStyle = color;
    swatch.fillRect(0, 0, 1, 1);
    const [red, green, blue, opacity] = swatch.getImageData(0, 0, 1, 1).data;
    const alpha = opacity / 255;
    const channel = (value: number) => {
      const unit = value / 255;
      return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (r: number, g: number, b: number) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    let worst = Infinity;
    for (const shot of shots) {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(shot), (char) => char.charCodeAt(0))], { type: "image/png" }));
      const board = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d", { willReadFrequently: true })!;
      board.drawImage(bitmap, 0, 0);
      const { data } = board.getImageData(0, 0, bitmap.width, bitmap.height);
      for (let index = 0; index < data.length; index += 4) {
        const [r, g, b] = [data[index], data[index + 1], data[index + 2]];
        const front = luminance(alpha * red + (1 - alpha) * r, alpha * green + (1 - alpha) * g, alpha * blue + (1 - alpha) * b);
        const back = luminance(r, g, b);
        worst = Math.min(worst, (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05));
      }
    }
    return worst;
  }, { color, shots });
}

test.beforeEach(async ({ page, context }) => {
  // Requesting `page` first sets up the shared API fixture, so these routes take precedence over it.
  void page;
  await serveDiscoveryCatalog(context);
});

test("a shared, reloaded or re-opened filtered listing shows the same results, page and filters", async ({ page, context }) => {
  const shared = "/#/shop?cat=shirts&a.size=M&a.size=L&s.Brand=Kora&min=1000&max=2400&sort=price-desc";
  await page.goto(shared);
  await expect(page.getByRole("heading", { level: 1, name: "Shirts" })).toBeVisible();
  const results = await listed(page);
  // Kora makes the even-numbered shirts; sizes M or L drop every third; KES 2,400 drops shirt 30.
  expect(results).toEqual([26, 24, 20, 18, 14, 12, 8, 6, 2].map((number) => `Discovery Shirt ${number}`));
  const chips = page.getByRole("list", { name: "Active filters" }).first();
  await expect(chips.getByRole("button")).toHaveText(["Size: M", "Size: L", "Brand: Kora", "Price: KES 1,000 to KES 2,400", "Clear all"]);
  await expect(page.getByRole("combobox", { name: "Sort by" })).toHaveValue("price-desc");

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Shirts" })).toBeVisible();
  expect(await listed(page)).toEqual(results);
  const reopened = await context.newPage();
  await reopened.goto(shared);
  await expect(reopened.getByRole("heading", { level: 1, name: "Shirts" })).toBeVisible();
  expect(await listed(reopened)).toEqual(results);
  await expect(reopened.getByText(`${results.length} products found`)).toBeVisible();
  await reopened.close();
});

test("filters replace the history entry while categories and pages push one", async ({ page, isMobile }) => {
  await page.goto("/#/about");
  await page.goto("/#/shop?cat=fashion");
  await expect(page.getByRole("heading", { level: 1, name: "Fashion" })).toBeVisible();
  await page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/#\/shop\?cat=fashion&page=2$/);
  await expect(page.getByRole("heading", { level: 1, name: "Fashion" })).toBeFocused();
  const panel = isMobile ? page.getByRole("dialog", { name: "Product filters" }) : page.getByRole("complementary", { name: "Filters" });
  if (isMobile) await page.getByRole("button", { name: /^Filters/ }).click();
  await panel.getByRole("group", { name: "Size" }).getByRole("checkbox", { name: /^M/ }).check();
  // A filter starts again at page 1, in place.
  await expect(page).toHaveURL(/#\/shop\?cat=fashion&a\.size=M$/);
  await panel.getByRole("checkbox", { name: /^In stock only/ }).check();
  await expect(page).toHaveURL(/#\/shop\?cat=fashion&a\.size=M&stock=in$/);
  if (isMobile) await panel.getByRole("button", { name: /^Show \d+ results$/ }).click();
  // Back leaves the filtered view (to the page before it) instead of undoing each tick.
  await page.goBack();
  await expect(page).toHaveURL(/#\/shop\?cat=fashion$/);
  await expect(page.getByText(`${SHIRT_COUNT} products found`)).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/about$/);
  await page.goForward();
  await page.goForward();
  await expect(page).toHaveURL(/#\/shop\?cat=fashion&a\.size=M&stock=in$/);
  await expect(page.getByText("10 products found")).toBeVisible();
});

test("Back from a product returns to the same filters, page, scroll position and product", async ({ page }) => {
  await page.goto("/#/shop?cat=shirts&sort=price-desc&page=2");
  await expect(page.getByText(`Showing 13–24 of ${SHIRT_COUNT} products`)).toBeVisible();
  const product = page.getByRole("link", { name: "Discovery Shirt 7", exact: true });
  await product.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy({ top: 120, behavior: "instant" }));
  await scrollSettled(page);
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(400);
  await product.click();
  await expect(page.getByRole("heading", { level: 1, name: "Discovery Shirt 7" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/shop\?cat=shirts&sort=price-desc&page=2$/);
  await expect(page.getByRole("navigation", { name: "Pagination" }).locator("[aria-current=page]")).toHaveText("Page 2");
  await expect(product).toBeFocused();
  await scrollSettled(page);
  expect(Math.abs(await page.evaluate(() => window.scrollY) - before)).toBeLessThanOrEqual(2);
});

test("following a link back to a listing seen earlier starts at its top, with focus on the heading", async ({ page }) => {
  await page.goto("/#/shop?cat=fashion");
  const heading = page.getByRole("heading", { level: 1, name: "Fashion" });
  await expect(heading).toBeVisible();
  const pagination = page.getByRole("navigation", { name: "Pagination" });
  await pagination.scrollIntoViewIfNeeded();
  await scrollSettled(page);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(400);
  await pagination.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/#\/shop\?cat=fashion&page=2$/);
  // Page 1 was scrolled before; a link to it is a new visit (a pushed entry), not a return through history.
  await pagination.getByRole("link", { name: "Previous" }).click();
  await expect(page).toHaveURL(/#\/shop\?cat=fashion$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(2);
  await expect(heading).toBeFocused();
  expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(await stickyBottom(page));
});

test("every department is reachable through the drawer by touch and keyboard", async ({ page, isMobile }) => {
  test.skip(!isMobile, "The drawer serves widths below 1280px; the mobile project has touch.");
  await page.goto("/#/about");
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  await menu.tap();
  const drawer = page.getByRole("dialog", { name: "Navigation menu" });
  for (const { name } of DISCOVERY_DEPARTMENTS) {
    await drawer.getByRole("button", { name, exact: true }).tap();
    await expect(drawer.getByRole("heading", { name, exact: true })).toBeFocused();
    await expect(drawer.getByRole("link", { name: `Shop all ${name}`, exact: true })).toHaveAttribute("href", `#/shop?cat=${slug(name)}`);
    await drawer.getByRole("button", { name: "Back to menu" }).tap();
    await expect(drawer.getByRole("heading", { name: "Departments", exact: true })).toBeFocused();
  }
  // Keyboard: open a department, then a group, then follow a leaf; the drawer closes and focus returns to Menu.
  await drawer.getByRole("button", { name: "Supermarket", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(drawer.getByRole("heading", { name: "Supermarket", exact: true })).toBeFocused();
  await drawer.getByRole("button", { name: "Margarine Jams Honey & Spreads" }).focus();
  await page.keyboard.press("Enter");
  await expect(drawer.getByRole("heading", { name: "Margarine Jams Honey & Spreads" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(drawer.getByRole("link", { name: "Shop all Margarine Jams Honey & Spreads" })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/shop\?cat=margarine-jams-honey-spreads-1$/);
  await expect(drawer).toHaveCount(0);
  await expect(menu).toBeFocused();
  await expect(page.getByRole("heading", { level: 1, name: "Margarine Jams Honey & Spreads 1" })).toBeVisible();
});

test.describe("on a wide window", () => {
  test.use({ hasTouch: true });

  test("every department is reachable through the desktop panel by keyboard and touch", async ({ page, isMobile }) => {
    test.skip(isMobile, "The panel serves widths from 1280px.");
    await page.goto("/#/about");
    const button = page.getByRole("button", { name: "Departments", exact: true });
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Tab");
    const tabs = page.getByRole("tablist", { name: "Departments" }).getByRole("tab");
    await expect(tabs).toHaveCount(DISCOVERY_DEPARTMENTS.length);
    for (const [index, { name }] of DISCOVERY_DEPARTMENTS.entries()) {
      await expect(tabs.nth(index)).toBeFocused();
      const pane = page.getByRole("tabpanel", { name });
      await expect(pane.getByRole("link", { name: `Shop all ${name}`, exact: true })).toHaveAttribute("href", `#/shop?cat=${slug(name)}`);
      // Eight leaves of the ten in the first group, then View all.
      await expect(pane.getByRole("region", { name: `${name} Essentials` }).getByRole("link")).toHaveCount(9);
      await page.keyboard.press("ArrowDown");
    }
    await expect(tabs.first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded", "false");

    // Touch on a wide screen: tap a department, then a group's View all link.
    await button.tap();
    await tabs.filter({ hasText: "Books, Movies & Music" }).tap();
    await page.getByRole("tabpanel", { name: "Books, Movies & Music" }).getByRole("link", { name: "View all in Books, Movies & Music Specials" }).tap();
    await expect(page).toHaveURL(/#\/shop\?cat=books-movies-music-specials$/);
    await expect(page.getByRole("tablist")).toHaveCount(0);
  });

  test("department and page links offer 44px targets on wide layouts, which may be touch screens", async ({ page, isMobile }) => {
    test.skip(isMobile, "Wide layouts are checked in the desktop project.");
    const shortest = (links: Locator) => links.evaluateAll((nodes) => Math.min(...nodes.map((node) => node.getBoundingClientRect().height)));
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    expect(await shortest(page.getByRole("navigation", { name: "Main" }).getByRole("link")), "header page links").toBeGreaterThanOrEqual(44);
    await page.getByRole("button", { name: "Departments", exact: true }).click();
    expect(await shortest(page.getByRole("tabpanel").getByRole("link")), "department panel links").toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Escape");
    await page.goto("/#/departments");
    await expect(page.getByRole("heading", { level: 1, name: "All departments" })).toBeVisible();
    expect(await shortest(page.getByRole("main").getByRole("listitem").getByRole("link")), "departments page links").toBeGreaterThanOrEqual(44);
    // From 1024px to 1279px the shop shows the department strip in the header.
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto("/#/shop");
    const strip = page.getByRole("banner").getByRole("link", { name: DISCOVERY_DEPARTMENTS[0].name, exact: true });
    await expect(strip).toBeVisible();
    expect(await shortest(strip), "shop department strip links").toBeGreaterThanOrEqual(44);
  });
});

test("the departments page lists all 14 departments and their groups", async ({ page, isMobile }) => {
  await page.goto("/#/departments");
  await expect(page.getByRole("heading", { level: 1, name: "All departments" })).toBeVisible();
  for (const { name } of DISCOVERY_DEPARTMENTS) {
    const card = page.getByRole("region", { name, exact: true });
    await expect(card.getByRole("link", { name: `Shop all ${name}`, exact: true })).toHaveAttribute("href", `#/shop?cat=${slug(name)}`);
    await expect(card.getByRole("link")).toHaveCount(4);
  }
  const target = page.getByRole("region", { name: "Gaming", exact: true }).getByRole("link", { name: /^Gaming Accessories/ });
  if (isMobile) await target.tap();
  else {
    await target.focus();
    await page.keyboard.press("Enter");
  }
  await expect(page).toHaveURL(/#\/shop\?cat=gaming-accessories$/);
});

test("search suggestions open categories and products by tap or click", async ({ page, isMobile }) => {
  await page.goto("/");
  const input = page.getByRole("combobox", { name: "Search products" });
  await input.fill("shirt");
  const suggestions = page.getByRole("listbox", { name: "Search suggestions" });
  await expect(page.getByRole("status").filter({ hasText: /^\d+ suggestions$/ })).toHaveText("6 suggestions");
  await activate(suggestions.getByRole("option", { name: /^Shirts/ }), isMobile);
  await expect(page).toHaveURL(/#\/shop\?cat=shirts$/);
  await expect(input).toHaveValue("");
  await input.fill("shirt 7");
  await activate(page.getByRole("option", { name: /Discovery Shirt 7/ }), isMobile);
  await expect(page.getByRole("heading", { level: 1, name: "Discovery Shirt 7" })).toBeVisible();
  await input.fill("zzzz");
  await expect(page.getByRole("status").filter({ hasText: /^No suggestions/ })).toHaveText('No suggestions for "zzzz". Press Enter to search all products.');
  await input.press("Enter");
  await expect(page).toHaveURL(/#\/shop\?q=zzzz$/);
  await expect(page.getByRole("heading", { name: "No matching products" })).toBeVisible();
});

test("hiding or reordering published sections changes the homepage", async ({ page, context }) => {
  type Section = (typeof publishedStorefront.settings.sections)[number];
  let sections: Section[] = publishedStorefront.settings.sections;
  await context.route("**/api/settings/storefront", (route) =>
    route.fulfill({ json: { ...publishedStorefront, settings: { ...publishedStorefront.settings, sections } } }));
  const headings = () => page.getByRole("main").getByRole("heading", { level: 2 }).allTextContents();
  await page.goto("/");
  await expect(page.getByRole("list", { name: "Shop by department" })).toBeVisible();
  expect(await headings()).toEqual(["Shop by department", "Featured products"]);

  sections = [...publishedStorefront.settings.sections].reverse();
  await page.reload();
  await expect(page.getByRole("list", { name: "Featured products" })).toBeVisible();
  expect(await headings()).toEqual(["Featured products", "Shop by department"]);

  sections = publishedStorefront.settings.sections.map((section) => ({ ...section, enabled: section.type !== "departments" }));
  await page.reload();
  await expect(page.getByRole("list", { name: "Featured products" })).toBeVisible();
  expect(await headings()).toEqual(["Featured products"]);
  await expect(page.getByRole("list", { name: "Shop by department" })).toHaveCount(0);
});

test("the department rail moves only when asked, with controls for each direction it can go", async ({ page, isMobile }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const rail = page.getByRole("list", { name: "Shop by department" });
  await expect(rail.getByRole("link")).toHaveCount(DISCOVERY_DEPARTMENTS.length);
  const previous = page.getByRole("button", { name: "Previous departments" });
  const next = page.getByRole("button", { name: "Next departments" });
  await expect(previous).toHaveCount(0);
  const position = () => rail.evaluate((element) => element.scrollLeft);
  await page.waitForTimeout(500);
  expect(await position(), "no automatic movement").toBe(0);
  const settledFrames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await next.focus();
  for (let press = 0; press < 20 && (await next.count()); press += 1) {
    await page.keyboard.press("Enter");
    await settledFrames();
  }
  await expect(next).toHaveCount(0);
  // The focused Next button left; focus moved to Previous instead of being lost.
  await expect(previous).toBeFocused();
  expect(await rail.evaluate((element) => element.scrollLeft + element.clientWidth >= element.scrollWidth - 1)).toBe(true);
  if (isMobile) {
    // Real touch swipes (finger moving right) scroll the rail back to its start natively.
    const box = (await rail.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    const y = box.y + box.height / 2;
    for (let swipe = 0; swipe < 8 && await position() > 0; swipe += 1) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 40, y }] });
      for (let step = 1; step <= 10; step += 1) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.x + 40 + step * 25, y }] });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(400);
    }
    await expect(previous).toHaveCount(0);
    await expect(next).toBeVisible();
    expect(await position()).toBe(0);
  }
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
});

test("no page-level overflow at 360px with normal and doubled text", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone widths are checked in the mobile project.");
  await page.setViewportSize({ width: 360, height: 780 });
  for (const route of ["/", "/#/shop?cat=shirts&a.size=M&s.Brand=Apex&min=1000", "/#/shop?q=zzzz", "/#/departments", "/#/shop?cat=margarine-jams-honey-spreads"]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeAttached();
    for (const size of ["100%", "200%"]) {
      await page.evaluate((value) => { document.documentElement.style.fontSize = value; }, size);
      expect(await pageOverflow(page), `${route} at ${size} text`).toBeLessThanOrEqual(0);
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  }
  await page.goto("/#/shop?cat=shirts");
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await page.getByRole("button", { name: /^Filters/ }).click();
  expect(await pageOverflow(page), "filter sheet at 200% text").toBeLessThanOrEqual(0);
  const sheet = page.getByRole("dialog", { name: "Product filters" });
  const sheetBox = (await sheet.boundingBox())!;
  expect(sheetBox.width).toBeLessThanOrEqual(360);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("dialog", { name: "Navigation menu" }).getByRole("button", { name: "Books, Movies & Music" }).click();
  expect(await pageOverflow(page), "drawer level at 200% text").toBeLessThanOrEqual(0);
});

test("the phone header keeps search and brand sticky, or only the brand row when space is short", async ({ page, isMobile }) => {
  test.skip(!isMobile, "The phone header is checked in the mobile project.");
  const brand = page.getByRole("banner");
  const search = page.getByRole("combobox", { name: "Search products" });
  // Portrait: both rows stay; the department shortcuts scroll away.
  await page.goto("/#/shop?cat=shirts");
  await page.evaluate(() => window.scrollTo({ top: 700, behavior: "instant" }));
  const brandBox = (await brand.boundingBox())!;
  const searchBox = (await search.boundingBox())!;
  expect(brandBox.y).toBe(0);
  expect(searchBox.y).toBeGreaterThanOrEqual(brandBox.y + brandBox.height);
  expect(searchBox.y + searchBox.height).toBeLessThanOrEqual(await stickyBottom(page));
  expect(await page.getByRole("navigation", { name: "Department shortcuts" }).evaluate((element) => element.getBoundingClientRect().bottom)).toBeLessThan(0);
  await expect(page.getByRole("button", { name: "Go to search" })).toHaveCount(0);

  // Landscape (or zoomed text): only the brand row sticks, and a button brings the search back.
  for (const { size, textSize } of [{ size: { width: 667, height: 375 }, textSize: "" }, { size: { width: 360, height: 780 }, textSize: "200%" }]) {
    await page.setViewportSize(size);
    await page.goto("/#/shop?cat=shirts");
    await page.evaluate((value) => { document.documentElement.style.fontSize = value; }, textSize);
    await page.evaluate(() => window.scrollTo({ top: 900, behavior: "instant" }));
    const label = `${size.width}x${size.height}${textSize ? ` at ${textSize}` : ""}`;
    const chromeHeight = await stickyBottom(page);
    expect(chromeHeight, `${label}: sticky chrome within a quarter of the viewport`).toBeLessThanOrEqual(size.height * 0.25 + 1);
    expect((await search.boundingBox())!.y + (await search.boundingBox())!.height, `${label}: search scrolled away`).toBeLessThanOrEqual(chromeHeight);
    await page.getByRole("button", { name: "Go to search" }).click();
    await expect(search).toBeFocused();
    await scrollSettled(page);
    const shown = (await search.boundingBox())!;
    expect(shown.y, `${label}: search shown below the brand row`).toBeGreaterThanOrEqual(chromeHeight);
    expect(shown.y + shown.height).toBeLessThanOrEqual(size.height);
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  }
});

test.describe("light text laid over artwork", () => {
  /** Waits until every image inside `scope` has loaded, so captures show the artwork rather than its placeholder. */
  const artworkLoaded = (scope: Locator) => expect.poll(() => scope.locator("img").evaluateAll((images) =>
    images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);

  test("department tile captions stay legible over white artwork, also at 200% text", async ({ page, context, isMobile }) => {
    await serveWhiteArtwork(context, { layout: "overlay" });
    for (const width of isMobile ? [360, 390] : [768, 1280]) {
      await page.setViewportSize({ width, height: isMobile ? 844 : 900 });
      await page.goto("/");
      const tiles = page.getByRole("list", { name: "Shop by department" }).getByRole("link");
      await expect(tiles).toHaveCount(DISCOVERY_DEPARTMENTS.length);
      for (const size of ["", "200%"]) {
        await page.evaluate((value) => { document.documentElement.style.fontSize = value; }, size);
        // A two-line name and a one-line name.
        for (const { name } of DISCOVERY_DEPARTMENTS.slice(0, 2)) {
          const tile = tiles.filter({ hasText: name });
          await tile.scrollIntoViewIfNeeded();
          await artworkLoaded(tile);
          const label = `${name} at ${width}px${size ? `, ${size} text` : ""}`;
          expect(await backdropContrast(page, tile.getByText(name, { exact: true })), `name, ${label}`).toBeGreaterThanOrEqual(4.5);
          expect(await backdropContrast(page, tile.getByText(/^\d+ products?$/)), `count, ${label}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    }
  });

  test("hero copy laid over artwork stays legible over white artwork", async ({ page, context, isMobile }) => {
    test.skip(isMobile, "Phones show the hero copy below the artwork, on navy.");
    const hero: { layout: "overlay" | "banner" } = { layout: "overlay" };
    await serveWhiteArtwork(context, hero);
    for (const layout of ["overlay", "banner"] as const) {
      hero.layout = layout;
      for (const width of [768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto("/");
        const section = page.getByRole("region", { name: "New season shirts" });
        await artworkLoaded(section);
        for (const size of width === 768 ? ["", "200%"] : [""]) {
          await page.evaluate((value) => { document.documentElement.style.fontSize = value; }, size);
          const label = `${layout} at ${width}px${size ? `, ${size} text` : ""}`;
          expect(await backdropContrast(page, section.getByRole("heading", { level: 2 })), `title, ${label}`).toBeGreaterThanOrEqual(3);
          expect(await backdropContrast(page, section.getByText("Linen and cotton shirts")), `body, ${label}`).toBeGreaterThanOrEqual(4.5);
          expect(await backdropContrast(page, section.getByText("Sample campaign for review.")), `conditions, ${label}`).toBeGreaterThanOrEqual(4.5);
        }
        await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
      }
    }
  });
});
