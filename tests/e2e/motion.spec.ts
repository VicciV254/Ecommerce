import type { BrowserContext, Page } from "@playwright/test";
import type { StorefrontSettings } from "../../src/api/catalog";
import { discoveryShirts, discoverySnapshot } from "../../src/test-support/discoveryFixtures";
import { expect, pageOverflow, publishedStorefront, test } from "./fixtures";

/*
 * Motion that makes the shop feel alive, checked in a real browser: sections and cards reveal as they scroll in (never
 * on the first screen, never under reduced motion, never hidden again), loading shapes shimmer briefly, and adding to
 * the cart answers with a check and a popping count.
 */
type Section = StorefrontSettings["sections"][number];
const section = (id: string, type: Section["type"], title: string, extra: Partial<Section> = {}): Section =>
  ({ id, type, title, enabled: true, productIds: [], categoryIds: [], campaignId: null, ...extra });
const landing = [
  section("facts", "promises", "How shopping works"),
  section("departments", "departments", "Shop by department", { layout: "grid" }),
  section("picks", "products", "Staff picks", { productIds: discoveryShirts.slice(0, 12).map((product) => product.id), layout: "rail" }),
  section("fashion", "category", "Fashion", { categoryIds: ["dept-fashion"] }),
  section("featured", "featured", "Featured products", { productIds: discoveryShirts.slice(12, 20).map((product) => product.id) }),
];

async function serveLanding(context: BrowserContext, sections: Section[] = landing) {
  await context.route("**/api/catalog", (route) => route.fulfill({ json: discoverySnapshot() }));
  await context.route("**/api/settings/storefront", (route) =>
    route.fulfill({ json: { ...publishedStorefront, settings: { ...publishedStorefront.settings, sections } } }));
}

/** Every revealable element: whether it is hidden, its top in the window, and its settled opacity. */
const reveals = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-reveal]")].map((element) => ({
  hidden: element.dataset.reveal === "hidden",
  top: element.getBoundingClientRect().top,
  opacity: Number(getComputedStyle(element).opacity),
})));

/** Scrolls down a screen at a time to the bottom, letting each screen's reveals start. */
async function scrollThrough(page: Page) {
  for (let step = 0; step < 40; step += 1) {
    const atEnd = await page.evaluate(() => {
      window.scrollBy({ top: window.innerHeight * 0.8, behavior: "instant" as ScrollBehavior });
      return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
    });
    await page.waitForTimeout(120);
    if (atEnd) break;
  }
  await page.waitForTimeout(900);
}

test.describe("scroll reveals", () => {
  test("hide nothing on the first screen, show everything below once scrolled to, and never hide it again", async ({ page, context }) => {
    await serveLanding(context);
    await page.goto("/");
    await expect(page.getByRole("list", { name: "Staff picks" }).getByRole("listitem")).toHaveCount(12);
    await page.waitForTimeout(500);
    const height = await page.evaluate(() => window.innerHeight);
    const first = await reveals(page);
    expect(first.length, "sections and cards are revealable").toBeGreaterThan(10);
    expect(first.filter((item) => item.hidden && item.top < height), "hidden on the first screen").toEqual([]);
    expect(first.some((item) => item.hidden), "something below waits for its turn").toBe(true);
    await scrollThrough(page);
    const after = await reveals(page);
    expect(after.filter((item) => item.hidden)).toEqual([]);
    expect(after.filter((item) => item.opacity < 1)).toEqual([]);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }));
    await page.waitForTimeout(300);
    expect((await reveals(page)).filter((item) => item.hidden)).toEqual([]);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("show a hidden section at once when focus moves into it", async ({ page, context }) => {
    await serveLanding(context);
    await page.goto("/");
    const link = page.getByRole("link", { name: /View all\s*Featured products/ });
    await expect(link).toHaveCount(1);
    await page.waitForTimeout(500);
    const hiddenBefore = await link.evaluate((element) => element.closest("[data-reveal='hidden']") !== null);
    expect(hiddenBefore, "the last section starts hidden").toBe(true);
    await link.focus();
    const opacity = await link.evaluate((element) => {
      const wrapper = element.closest<HTMLElement>("[data-reveal]")!;
      return [wrapper.dataset.reveal, getComputedStyle(wrapper).opacity];
    });
    expect(opacity).toEqual(["shown", "1"]);
  });

  test("keep scrolling rows free of vertical scrolling while their cards wait to be revealed", async ({ page, context }) => {
    await serveLanding(context);
    await page.goto("/");
    const rail = page.getByRole("list", { name: "Fashion" });
    await expect(rail.getByRole("listitem")).toHaveCount(12);
    await page.waitForTimeout(500);
    const state = await rail.evaluate((list) => ({
      hiddenCards: list.querySelectorAll("[data-reveal='hidden']").length,
      overflow: list.scrollHeight - list.clientHeight,
    }));
    expect(state.hiddenCards, "the row's cards are still hidden").toBeGreaterThan(0);
    expect(state.overflow).toBe(0);
  });

  test("never hide anything under reduced motion", async ({ page, context }) => {
    await serveLanding(context);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.getByRole("list", { name: "Staff picks" }).getByRole("listitem")).toHaveCount(12);
    await page.waitForTimeout(500);
    expect((await reveals(page)).filter((item) => item.hidden || item.opacity < 1)).toEqual([]);
  });

  test("on the listing, keep cards shown through filtering, a reload and Back", async ({ page, context }) => {
    await serveLanding(context);
    await page.goto("/#/shop");
    const results = page.getByRole("list", { name: /Products/ });
    await expect(results.getByRole("listitem").first()).toBeVisible();
    await scrollThrough(page);
    expect((await reveals(page)).filter((item) => item.hidden)).toEqual([]);

    // Sorting re-renders the same cards in another order: none hides again.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }));
    await page.getByLabel("Sort by").selectOption({ index: 1 });
    await page.waitForTimeout(400);
    const height = await page.evaluate(() => window.innerHeight);
    expect((await reveals(page)).filter((item) => item.hidden && item.top < height)).toEqual([]);

    // A reload and a Back return to the same place, with the cards there shown.
    await results.getByRole("listitem").nth(6).scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.reload();
    await expect(results.getByRole("listitem").first()).toBeAttached();
    await page.waitForTimeout(1200);
    const inView = (await reveals(page)).filter((item) => item.top > -100 && item.top < height - 50);
    expect(inView.length).toBeGreaterThan(0);
    expect(inView.filter((item) => item.hidden || item.opacity < 1)).toEqual([]);
    await results.getByRole("link").filter({ hasText: /\S/ }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goBack();
    await expect(results.getByRole("listitem").first()).toBeAttached();
    await page.waitForTimeout(1200);
    const back = (await reveals(page)).filter((item) => item.top > -100 && item.top < height - 50);
    expect(back.filter((item) => item.hidden || item.opacity < 1)).toEqual([]);
  });
});

test.describe("loading shapes", () => {
  /** Holds the catalog until the returned function is called. */
  async function holdCatalog(context: BrowserContext) {
    let release = () => {};
    const released = new Promise<void>((resolve) => { release = resolve; });
    await context.route("**/api/catalog", async (route) => {
      await released;
      await route.fulfill({ json: discoverySnapshot() });
    });
    return release;
  }
  const sweeping = (page: Page) => page.evaluate(() => document.getAnimations()
    .filter((animation) => animation.playState === "running" && (animation.effect as KeyframeEffect | null)?.target instanceof Element &&
      ((animation.effect as KeyframeEffect).target as Element).classList.contains("skeleton")).length);

  test("shimmer for a few passes, then rest", async ({ page, context }) => {
    const release = await holdCatalog(context);
    await page.goto("/#/shop");
    await expect(page.getByRole("status").filter({ hasText: "Loading products…" })).toBeAttached();
    expect(await sweeping(page)).toBeGreaterThan(0);
    await page.waitForTimeout(5000);
    expect(await sweeping(page)).toBe(0);
    release();
  });

  test("stay still under reduced motion", async ({ page, context }) => {
    const release = await holdCatalog(context);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#/shop");
    await expect(page.getByRole("status").filter({ hasText: "Loading products…" })).toBeAttached();
    await page.waitForTimeout(100);
    expect(await sweeping(page)).toBe(0);
    release();
  });
});

test.describe("feedback", () => {
  test("adding from a card shows a check for a moment and pops the cart count, keeping the button's name", async ({ page, context }) => {
    await serveLanding(context, [section("featured", "featured", "Featured products", { productIds: discoveryShirts.slice(0, 4).map((product) => product.id) })]);
    await page.goto("/");
    // Records what animates, as the count's pop is over in a third of a second.
    await page.evaluate(() => {
      const animated: string[] = [];
      (window as unknown as { animated: string[] }).animated = animated;
      const original = Element.prototype.animate;
      Element.prototype.animate = function animate(this: Element, ...args: Parameters<Element["animate"]>) {
        animated.push(this.id || this.tagName);
        return original.apply(this, args);
      };
    });
    const add = page.getByRole("list", { name: "Featured products" }).getByRole("button", { name: "Add to cart" }).first();
    await add.click();
    await expect(add).toHaveAttribute("data-added", "true");
    await expect(page.getByRole("dialog", { name: "Your cart" })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { animated: string[] }).animated)).toContain("header-cart-count");
    await page.waitForTimeout(1800);
    await expect(add).not.toHaveAttribute("data-added", "true");
  });
});
