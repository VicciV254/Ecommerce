import type { BrowserContext, Frame, Page } from "@playwright/test";
import type { StorefrontDraft } from "../../src/api/catalog";
import { fixtureImage, fixtureProduct, fixtureStorefrontSettings } from "../../src/test-support/catalogFixtures";
import { layoutProblems, serveAdminData, waitForPlace } from "./adminFixtures";
import { STAFF_TOKEN, expect, pageOverflow, publicSnapshot, signInStaff, storefrontDraft, test } from "./fixtures";

const PREVIEW_H1 = "Draft preview: shoppers can't see this";
const FRAME = 'iframe[title^="Storefront draft at"]';
/** A valid 1×1 PNG answered for every artwork request, so no real media network is used. */
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

/** Nine featured products added to the catalog: more than any width shows, so each section's card count is its limit. */
const previewProducts = Array.from({ length: 9 }, (_, index) =>
  fixtureProduct({ id: `prod-preview-${index + 1}`, name: `Preview product ${index + 1}`, isFeatured: true }));
const catalog = { ...publicSnapshot, products: [...publicSnapshot.products, ...previewProducts] };

const artwork = (composition: "desktop" | "mobile") => fixtureImage({
  id: `media-preview-${composition}`, alt: "", width: composition === "desktop" ? 2400 : 1080, height: 1200,
  url: `https://res.cloudinary.com/apex-test/image/upload/v1763200000/apex-cart/storefront/preview-${composition}.jpg`,
});
const desktopArt = artwork("desktop");
const mobileArt = artwork("mobile");

/** A hero campaign with separate phone artwork, the departments, and two product sections. */
const draft: StorefrontDraft = {
  ...storefrontDraft,
  settings: fixtureStorefrontSettings({
    sections: [
      { id: "hero", type: "campaign", title: "Hero", enabled: true, productIds: [], categoryIds: [], campaignId: "launch" },
      { id: "departments", type: "departments", title: "Shop by department", enabled: true, productIds: [], categoryIds: [], campaignId: null },
      { id: "featured", type: "featured", title: "Featured products", enabled: true, productIds: [], categoryIds: [], campaignId: null },
      { id: "picks", type: "products", title: "Staff picks", enabled: true, productIds: previewProducts.map((product) => product.id), categoryIds: [], campaignId: null },
    ],
    campaigns: [{
      id: "launch", title: "Launch week", body: "New season arrivals.", conditions: "While stocks last.",
      cta: { label: "Shop now", target: "shop", targetId: null },
      desktopMediaId: desktopArt.id, mobileMediaId: mobileArt.id,
      desktopFocal: { x: 50, y: 50 }, mobileFocal: { x: 50, y: 50 }, layout: "overlay",
    }],
  }),
  media: [desktopArt, mobileArt],
};

type ArtworkRequest = { url: string; frame: string };

/** Signs staff in and serves the admin, the larger catalog and this draft; records every artwork request and its frame. */
async function servePreview(page: Page) {
  const context: BrowserContext = page.context();
  await signInStaff(page, "ADMIN");
  await serveAdminData(context);
  await context.route("**/api/catalog", (route) => route.fulfill({ json: catalog }));
  await context.route("**/api/settings/storefront/draft", (route) =>
    route.request().method() === "GET" && route.request().headers().authorization === `Bearer ${STAFF_TOKEN}`
      ? route.fulfill({ json: draft })
      : route.fallback());
  const requested: ArtworkRequest[] = [];
  await context.route("https://res.cloudinary.com/**", (route) => {
    requested.push({ url: route.request().url(), frame: route.request().frame().url() });
    return route.fulfill({ contentType: "image/png", body: TINY_PNG });
  });
  return requested;
}

/** The preview's frame as a document, once it shows the draft. */
async function previewFrame(page: Page): Promise<Frame> {
  const frame = await (await page.locator(FRAME).elementHandle())?.contentFrame();
  if (!frame) throw new Error("The draft preview has no frame");
  await expect(frame.getByRole("heading", { name: "Launch week", exact: true })).toBeVisible();
  return frame;
}

const heroSource = (frame: Frame) => frame.getByRole("region", { name: "Launch week", exact: true }).locator("picture img")
  .evaluate((image: HTMLImageElement) => (image.complete ? image.currentSrc : ""));
const deviceButton = (page: Page, name: string) => page.getByRole("group", { name: "Preview width", exact: true }).getByRole("button", { name, exact: true });
const visibleCards = (frame: Frame, section: string) => frame.getByRole("list", { name: section, exact: true }).getByRole("listitem");
/**
 * How much taller the frame is than its content, measured from the content's own boxes rather than the wrapper that
 * reports it (a wrapper with a viewport-height minimum would hold the frame at its old height).
 */
const unfilled = (frame: Frame) => frame.evaluate(() => {
  const boxes = [...(document.getElementById("root")?.firstElementChild?.children ?? [])].map((child) => child.getBoundingClientRect());
  return window.innerHeight - Math.ceil(Math.max(...boxes.map((box) => box.bottom)) - Math.min(...boxes.map((box) => box.top)));
});

test("the draft shows at true phone, tablet and desktop widths: viewport, artwork and cards per section", async ({ page }) => {
  const requested = await servePreview(page);
  const draftReads: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/settings/storefront/draft")) draftReads.push(request.frame() === page.mainFrame() ? "admin" : request.frame().url());
  });
  await page.goto("/#/admin/storefront/preview");
  await waitForPlace(page, PREVIEW_H1);
  await expect(deviceButton(page, "Phone 390 px")).toHaveAttribute("aria-pressed", "true");

  const frame = await previewFrame(page);
  const widths = [
    { button: "Phone 390 px", title: "Storefront draft at phone width (390 px)", width: 390, cards: 4, art: "preview-mobile" },
    { button: "Tablet 768 px", title: "Storefront draft at tablet width (768 px)", width: 768, cards: 6, art: "preview-desktop" },
    { button: "Desktop 1280 px", title: "Storefront draft at desktop width (1280 px)", width: 1280, cards: 8, art: "preview-desktop" },
  ];
  for (const shown of widths) {
    await deviceButton(page, shown.button).click();
    await expect(deviceButton(page, shown.button)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(FRAME)).toHaveAttribute("title", shown.title);
    await expect.poll(() => frame.evaluate(() => window.innerWidth), shown.button).toBe(shown.width);
    for (const section of ["Featured products", "Staff picks"]) {
      await expect(visibleCards(frame, section), `${section} at ${shown.button}`).toHaveCount(shown.cards);
    }
    await expect.poll(() => heroSource(frame), shown.button).toContain(`/apex-cart/storefront/${shown.art}.jpg`);
    if (shown.width === 390) {
      // Phone first: nothing so far has asked for the desktop composition.
      expect(requested.filter((request) => request.url.includes("preview-desktop"))).toEqual([]);
    }
  }
  expect(requested.length).toBeGreaterThan(0);
  expect(requested.every((request) => request.frame.endsWith("#/admin/storefront/preview-frame")), JSON.stringify(requested)).toBe(true);
  // Only the admin reads the staff draft; the frame shows what it is sent.
  expect(draftReads).toEqual(["admin"]);
  await test.info().attach("artwork-requests.json", { body: JSON.stringify(requested, null, 2), contentType: "application/json" });
});

test("the frame takes its content's height as it grows and shrinks, and a wide frame is scaled to fit the admin", async ({ page, isMobile }) => {
  await servePreview(page);
  await page.goto("/#/admin/storefront/preview");
  await waitForPlace(page, PREVIEW_H1);
  const frame = await previewFrame(page);
  await expect.poll(() => unfilled(frame), "phone").toBe(0);
  const phoneHeight = await frame.evaluate(() => window.innerHeight);

  // This draft is taller at desktop width (larger cards, the hero's minimum height): the frame grows...
  await deviceButton(page, "Desktop 1280 px").click();
  await expect.poll(() => frame.evaluate(() => window.innerWidth)).toBe(1280);
  await expect.poll(() => unfilled(frame), "desktop").toBe(0);
  const desktopHeight = await frame.evaluate(() => window.innerHeight);
  expect(desktopHeight).toBeGreaterThan(phoneHeight);
  expect(await frame.evaluate(() => document.documentElement.scrollHeight)).toBe(desktopHeight);

  // A 390px admin shows the 1280px frame at 30%; beside the 240px navigation, a 1280px admin has 1040px (81%).
  const percent = isMobile ? 30 : 81;
  await expect(page.getByText(`Shown at ${percent}% of actual size`, { exact: true })).toBeVisible();
  const box = await page.locator(FRAME).boundingBox();
  expect(box?.width).toBeCloseTo((1280 * percent) / 100, 0);
  expect(box?.height).toBeCloseTo((desktopHeight * percent) / 100, 0);
  expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  expect((await layoutProblems(page)).scrollers).toEqual([]);

  // ...and shrinks back to the phone layout's height.
  await deviceButton(page, "Phone 390 px").click();
  await expect.poll(() => frame.evaluate(() => window.innerWidth)).toBe(390);
  await expect.poll(() => unfilled(frame), "phone again").toBe(0);
  expect(await frame.evaluate(() => window.innerHeight)).toBe(phoneHeight);
  await expect(page.getByText(/^Shown at/)).toHaveCount(0);
});

test("an unsaved edit in the editor shows in the frame", async ({ page }) => {
  await servePreview(page);
  await page.goto("/#/admin/storefront/editor");
  await waitForPlace(page, "Storefront editor");
  const heading = page.getByRole("textbox", { name: "Heading", exact: true }).nth(2);
  await expect(heading).toHaveValue("Featured products");
  await heading.fill("Weekend picks");

  await page.getByRole("main").getByRole("link", { name: "Draft preview", exact: true }).click();
  await waitForPlace(page, PREVIEW_H1);
  await expect(page.getByText("Includes unsaved changes", { exact: true })).toBeVisible();
  const frame = await previewFrame(page);
  await expect(frame.getByRole("heading", { name: "Weekend picks", exact: true })).toBeVisible();
  await expect(frame.getByRole("heading", { name: "Featured products", exact: true })).toHaveCount(0);
});

test("links in the frame don't open, and nothing in it buys or saves", async ({ page }) => {
  await servePreview(page);
  const writes: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (request.method() !== "GET" && /^\/api\/(cart|wishlist|orders|mpesa)(\/|$)/.test(pathname)) writes.push(`${request.method()} ${pathname}`);
  });
  await page.goto("/#/admin/storefront/preview");
  await waitForPlace(page, PREVIEW_H1);
  await expect(page.getByText("Links don't open from the preview; buying and wishlists are off.", { exact: true })).toBeVisible();
  const frame = await previewFrame(page);
  const adminAddress = page.url();
  const frameAddress = frame.url();

  const picks = frame.getByRole("list", { name: "Staff picks", exact: true });
  const card = picks.getByRole("link", { name: "Preview product 1", exact: true });
  await expect(card).toHaveAttribute("href", "#/admin/catalog/preview?product=prod-preview-1");
  // Preview cards: no Add to cart, Choose options or wishlist.
  await expect(picks.getByRole("button")).toHaveCount(0);
  await card.click();
  await card.focus();
  await page.keyboard.press("Enter");
  await frame.getByRole("link", { name: "Shop now", exact: true }).click();
  await frame.getByRole("link", { name: "View all Staff picks", exact: true }).click();

  expect(page.url()).toBe(adminAddress);
  expect(frame.url()).toBe(frameAddress);
  await expect(frame.getByRole("heading", { name: "Launch week", exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test("the chosen width stays in the address through a reload, and an unknown one is corrected in place", async ({ page }) => {
  await servePreview(page);
  await page.goto("/#/admin/storefront/preview?device=watch");
  await waitForPlace(page, PREVIEW_H1);
  await expect(page).toHaveURL(/#\/admin\/storefront\/preview$/);
  await expect(deviceButton(page, "Phone 390 px")).toHaveAttribute("aria-pressed", "true");

  const entries = await page.evaluate(() => history.length);
  await deviceButton(page, "Tablet 768 px").click();
  await expect(page).toHaveURL(/#\/admin\/storefront\/preview\?device=tablet$/);
  expect(await page.evaluate(() => history.length)).toBe(entries);

  await page.reload();
  await waitForPlace(page, PREVIEW_H1);
  await expect(deviceButton(page, "Tablet 768 px")).toHaveAttribute("aria-pressed", "true");
  const frame = await previewFrame(page);
  expect(await frame.evaluate(() => window.innerWidth)).toBe(768);
});

test("the frame's address opened on its own says what it is and leads to the draft preview", async ({ page }) => {
  await servePreview(page);
  const draftReads: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/settings/storefront/draft")) draftReads.push(request.url()); });
  await page.goto("/#/admin/storefront/preview-frame");
  await expect(page.getByRole("heading", { level: 1, name: "Draft preview frame", exact: true })).toBeVisible();
  await expect(page.getByText("This address shows the storefront draft inside the draft preview. On its own, it has nothing to show.", { exact: true })).toBeVisible();
  // No shopper or admin shell, and no staff draft asked for.
  await expect(page.getByRole("banner")).toHaveCount(0);
  await expect(page.locator("iframe")).toHaveCount(0);
  expect(draftReads).toEqual([]);

  await page.getByRole("link", { name: "Open the draft preview", exact: true }).click();
  await waitForPlace(page, PREVIEW_H1);
  await expect(page).toHaveURL(/#\/admin\/storefront\/preview$/);
});
