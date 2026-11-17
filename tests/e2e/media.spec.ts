import type { BrowserContext, Locator, Page, Request } from "@playwright/test";
import type { AdminCatalogProduct, CatalogProduct, CatalogSnapshot, MediaInput, UploadIntent } from "../../src/api/catalog";
import { demoPhone, fixtureImage, linenShirt, poloShirt, staffRecord } from "../../src/test-support/catalogFixtures";
import { shopperStateKey } from "../../src/utils/storage";
import {
  ORIGIN,
  STAFF_TOKEN,
  adminSnapshot,
  clippedWithin,
  expect,
  publicSnapshot,
  publishedStorefront,
  signInStaff,
  test,
} from "./fixtures";

/** A valid 1×1 PNG served for every image host, so no real media network is used. */
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const CARD_WIDTHS = [240, 320, 480, 640, 960];
const DETAIL_WIDTHS = [480, 640, 960, 1280, 1600];
const THUMBNAIL_WIDTHS = [96, 160, 240];
const ZOOM_WIDTH = 2400;

const stored = (publicId: string, format = "webp") => `https://res.cloudinary.com/apex-test/image/upload/v1763200000/${publicId}.${format}`;
const rendition = (publicId: string, width: number, format = "webp") =>
  `https://res.cloudinary.com/apex-test/image/upload/c_limit,w_${width}/q_auto/f_auto/v1763200000/${publicId}.${format}`;

/** The width a requested rendition asks for, or null for an address that is not a rendition. */
function renditionWidth(url: string): number | null {
  const cloudinary = /\/image\/upload\/c_limit,w_(\d+)\/q_auto\/f_auto\/v\d+\//.exec(url);
  if (cloudinary) return Number(cloudinary[1]);
  const parsed = new URL(url);
  const resized = (parsed.origin === "https://images.unsplash.com" && parsed.searchParams.get("fit") === "max") ||
    (parsed.origin === "https://images.pexels.com" && parsed.searchParams.get("cs") === "tinysrgb");
  return resized ? Number(parsed.searchParams.get("w")) : null;
}

/** Answers the image CDNs locally and records every address the browser asked for. */
async function serveImageHosts(context: BrowserContext) {
  const requested: string[] = [];
  for (const host of ["https://res.cloudinary.com/**", "https://images.unsplash.com/**", "https://images.pexels.com/**"]) {
    await context.route(host, (route) => {
      requested.push(route.request().url());
      return route.fulfill({ contentType: "image/png", body: TINY_PNG });
    });
  }
  return requested;
}

/** Done loading; with `w` descriptors the density-corrected size of the 1×1 stub can round to 0, so size is not checked. */
const loaded = (element: HTMLImageElement) => element.complete && element.currentSrc !== "";

/** Chrome's initial priority for each request, from the DevTools protocol (both projects run Chromium). */
async function recordPriorities(context: BrowserContext, page: Page) {
  const priorities = new Map<string, string>();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", ({ request }) => priorities.set(request.url, request.initialPriority));
  return priorities;
}

/** The rendition an image chose once loaded, and its rendered slot in device pixels. */
async function chosenForSlot(image: Locator) {
  await expect.poll(() => image.evaluate(loaded)).toBe(true);
  const { slot, src } = await image.evaluate((element: HTMLImageElement) => ({ slot: element.clientWidth * window.devicePixelRatio, src: element.currentSrc }));
  return { slot, src, width: renditionWidth(src) ?? 0 };
}

/** The browser picked the smallest candidate that is at least as wide as the slot. */
function expectSmallestSufficient(widths: readonly number[], { slot, width }: { slot: number; width: number }) {
  expect(width).toBeGreaterThanOrEqual(slot);
  expect(widths.filter((candidate) => candidate < width).every((candidate) => candidate < slot)).toBe(true);
}

const widthsOf = (requested: readonly string[], fragment: string) =>
  [...new Set(requested.filter((url) => url.includes(fragment)).map(renditionWidth))].sort((a, b) => Number(a) - Number(b));

const linenCover = fixtureImage({
  id: "img-linen-cover", url: stored("apex-cart/products/linen-cover"), alt: "Linen shirt, front", isMain: true,
  width: 2400, height: 3000, format: "webp", bytes: 245_000,
});
const linenBack = fixtureImage({ id: "img-linen-back", url: stored("apex-cart/products/linen-back"), alt: "Linen shirt, back", order: 1, width: 2400, height: 3000 });
const poloPhoto = fixtureImage({
  id: "img-polo-unsplash", url: "https://images.unsplash.com/photo-polo?ixid=keep&w=1600&h=900&fit=crop&q=90", alt: "Cotton polo shirt", isMain: true,
});
/** Demo placeholders may be Pexels-hosted photos. */
const phonePlaceholder = fixtureImage({
  id: "img-demo-phone-pexels", url: "https://images.pexels.com/photos/1092644/pexels-photo-1092644.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1",
  alt: "Smartphone on a desk", isMain: true, isPlaceholder: true, sourceUrl: "https://www.pexels.com/photo/1092644/", license: "Pexels License",
});

/** The public catalog with uploaded and Unsplash product and department images. */
const mediaSnapshot: CatalogSnapshot = {
  ...publicSnapshot,
  categories: publicSnapshot.categories.map((category) => {
    if (category.id === "cat-fashion") return { ...category, image: stored("apex-cart/storefront/dept-fashion", "jpg") };
    if (category.id === "cat-phones-tablets") return { ...category, image: "https://images.unsplash.com/photo-dept-phones?ixid=keep&w=1600&fit=crop" };
    return category;
  }),
  products: publicSnapshot.products.map((product): CatalogProduct => {
    if (product.id === linenShirt.id) return { ...product, images: [linenCover, linenBack] };
    if (product.id === poloShirt.id) return { ...product, images: [poloPhoto] };
    if (product.id === demoPhone.id) return { ...product, images: [phonePlaceholder] };
    return product;
  }),
};

async function serveMediaCatalog(context: BrowserContext) {
  await context.route("**/api/catalog", (route) => route.fulfill({ json: mediaSnapshot }));
  await context.route("**/api/products/*", (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() ?? "");
    const product = mediaSnapshot.products.find((item) => item.id === id);
    return product ? route.fulfill({ json: { ...product, reviewList: [] } }) : route.fallback();
  });
}

test("cards and department tiles request card-width renditions, never the zoom size", async ({ page, context, isMobile }) => {
  const requested = await serveImageHosts(context);
  await serveMediaCatalog(context);
  // Phones (390px) show 173px cards everywhere and tiles at 50vw - 22px. At 1280px the homepage's cards are 295px and
  // the listing's 227px beside its filters (P7 close: both declared 300px before, 32% too wide for the listing), with
  // 5 tiles per row.
  const homeCardWidth = isMobile ? 240 : 320;
  const listingCardWidth = 240;

  await page.goto("/");
  await expect(page.getByRole("list", { name: "Shop by department" }).getByRole("link")).toHaveCount(2);
  await expect.poll(() => widthsOf(requested, "dept-fashion")).toEqual([240]);
  await expect.poll(() => widthsOf(requested, "photo-dept-phones")).toEqual([240]);
  // The featured linen shirt loads on the homepage; the listing then reuses that rendition, which is at least as wide.
  await page.getByRole("list", { name: "Featured products" }).getByRole("link", { name: "Linen Short-Sleeve Shirt", exact: true }).scrollIntoViewIfNeeded();
  await expect.poll(() => widthsOf(requested, "linen-cover")).toEqual([homeCardWidth]);

  await page.goto("/#/shop");
  await expect(page.getByRole("heading", { name: "All products", exact: true })).toBeVisible();
  for (const name of ["Linen Short-Sleeve Shirt", "Cotton Polo Shirt", "Demo Smartphone"]) {
    await page.getByRole("link", { name, exact: true }).scrollIntoViewIfNeeded();
  }
  await expect.poll(() => widthsOf(requested, "photo-polo")).toEqual([listingCardWidth]);
  await expect.poll(() => widthsOf(requested, "pexels-photo-1092644")).toEqual([listingCardWidth]);
  expect(widthsOf(requested, "linen-cover")).toEqual([homeCardWidth]);

  const polo = requested.find((url) => url.includes("photo-polo"))!;
  expect(Object.fromEntries(new URL(polo).searchParams)).toEqual({ ixid: "keep", w: String(listingCardWidth), auto: "format", q: "75", fit: "max" });
  const placeholder = new URL(requested.find((url) => url.includes("pexels-photo-1092644"))!);
  expect(placeholder.pathname).toBe("/photos/1092644/pexels-photo-1092644.jpeg");
  expect([...placeholder.searchParams]).toEqual([["auto", "compress"], ["cs", "tinysrgb"], ["w", String(listingCardWidth)]]);
  expect(requested.map(renditionWidth).every((width) => width !== null && CARD_WIDTHS.includes(width))).toBe(true);
  expect(requested.some((url) => renditionWidth(url) === ZOOM_WIDTH)).toBe(false);
  await test.info().attach("requested-images.json", { body: JSON.stringify(requested, null, 2), contentType: "application/json" });
});

/** Every grid of product cards: where it is and the element holding the cards. */
const CARD_GRIDS = [
  { name: "listing beside its filters", path: "/#/shop", grid: 'ul[aria-label="Products"]' },
  { name: "homepage section", path: "/", grid: 'ul[aria-label="Featured products"]' },
  { name: "related products", path: `/#/product/${linenShirt.id}`, grid: 'section[aria-labelledby="related-title"] .product-grid' },
  { name: "wishlist", path: "/#/wishlist", grid: "main .grid" },
] as const;

/** An image's rendered width and the width its `sizes` declares at the current viewport, in CSS pixels. */
const declaredAndRendered = (image: Locator) => image.evaluate((element: HTMLImageElement) => {
  let declared = Number.NaN;
  for (const entry of (element.getAttribute("sizes") ?? "").split(/,\s*(?![^()]*\))/)) {
    const match = /^\s*(\(.*?\))\s+(.+)$/.exec(entry);
    const [condition, length] = match ? [match[1], match[2]] : [null, entry.trim()];
    if (condition && !matchMedia(condition).matches) continue;
    const probe = document.createElement("div");
    probe.style.cssText = `position: absolute; visibility: hidden; width: ${length}`;
    document.body.append(probe);
    declared = probe.getBoundingClientRect().width;
    probe.remove();
    break;
  }
  return { declared, rendered: element.getBoundingClientRect().width };
});

test.describe("product card images", () => {
  test.use({ deviceScaleFactor: 2 });

  test("declare their rendered width in every grid, and a 2x screen loads the smallest sufficient rendition", async ({ page, context, isMobile }) => {
    await serveImageHosts(context);
    await serveMediaCatalog(context);
    await context.addInitScript(({ key, ids, origin }) => {
      if (location.origin === origin && !localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ cart: [], wishlist: ids }));
    }, { key: shopperStateKey(null), ids: [linenShirt.id, poloShirt.id, demoPhone.id], origin: ORIGIN });
    const evidence: Record<string, number | string>[] = [];
    for (const width of isMobile ? [360, 390, 430] : [768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const { name, path, grid } of CARD_GRIDS) {
        // A new document each time: within one, Chrome reuses any larger candidate it has already loaded.
        await page.goto("about:blank");
        await page.goto(path);
        const image = page.locator(grid).locator("img").first();
        await image.scrollIntoViewIfNeeded();
        const choice = await chosenForSlot(image);
        const { declared, rendered } = await declaredAndRendered(image);
        // Never narrower than the rendered slot, and at most 15% wider.
        expect(declared, `${name} at ${width}px: declared ${declared}, rendered ${rendered}`).toBeGreaterThanOrEqual(rendered - 0.5);
        expect(declared, `${name} at ${width}px: declared ${declared}, rendered ${rendered}`).toBeLessThanOrEqual(rendered * 1.15);
        expectSmallestSufficient(CARD_WIDTHS, choice);
        evidence.push({ width, grid: name, rendered, declared, slot: choice.slot, chosen: choice.width });
      }
    }
    await test.info().attach("card-sizes.json", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
  });
});

test("the detail cover loads once at a detail width with high priority, and no zoom rendition is fetched", async ({ page, context, isMobile }) => {
  const requested = await serveImageHosts(context);
  await serveMediaCatalog(context);
  const priorities = await recordPriorities(context, page);
  const detail = page.waitForResponse((response) => response.url().endsWith(`/api/products/${linenShirt.id}`));

  await page.goto(`/#/product/${linenShirt.id}`);
  await detail;
  const cover = page.getByRole("img", { name: "Linen shirt, front" });
  await expect(cover).toHaveAttribute("fetchpriority", "high");
  await expect(cover).toHaveAttribute("loading", "eager");
  await expect.poll(() => cover.evaluate(loaded)).toBe(true);
  // 100vw on a 390px phone and 50vw at 1280px choose these detail candidates; strip slots are ~80px and ~137px wide.
  const detailWidth = isMobile ? 480 : 640;
  const stripWidth = isMobile ? 96 : 160;
  // The second image is the next slide of the swipeable stage: requested ahead of a swipe at the same detail width,
  // lazily and never at the zoom width.
  await expect.poll(() => widthsOf(requested, "linen-back")).toEqual([stripWidth, detailWidth]);
  expect(priorities.get(rendition("apex-cart/products/linen-back", detailWidth))).not.toBe("High");
  const stripChoices: Awaited<ReturnType<typeof chosenForSlot>>[] = [];
  for (const thumbnail of await page.getByRole("button", { name: /^Image \d+ of \d+$/ }).locator("img").all()) {
    const choice = await chosenForSlot(thumbnail);
    expectSmallestSufficient(THUMBNAIL_WIDTHS, choice);
    stripChoices.push(choice);
  }

  const coverRequests = requested.filter((url) => url.includes("linen-cover") && DETAIL_WIDTHS.includes(renditionWidth(url) ?? 0));
  expect(coverRequests).toEqual([rendition("apex-cart/products/linen-cover", detailWidth)]);
  expect(widthsOf(requested, "linen-cover")).toEqual([stripWidth, detailWidth]);
  expect(priorities.get(coverRequests[0])).toBe("High");
  const strip = requested.filter((url) => renditionWidth(url) === stripWidth);
  expect(strip.map((url) => priorities.get(url))).not.toContain("High");
  await expect(page.locator('img[fetchpriority="high"]')).toHaveCount(1);
  expect(requested.some((url) => renditionWidth(url) === ZOOM_WIDTH)).toBe(false);
  await test.info().attach("requested-images.json", {
    body: JSON.stringify(requested.map((url) => ({ url, priority: priorities.get(url) })), null, 2), contentType: "application/json",
  });
  await test.info().attach("strip-renditions.json", { body: JSON.stringify(stripChoices, null, 2), contentType: "application/json" });
});

test("campaign artwork downloads only the viewport's source, at a hero width", async ({ page, context, isMobile }) => {
  const requested = await serveImageHosts(context);
  const desktop = fixtureImage({ id: "media-hero-desktop", url: stored("apex-cart/storefront/hero-desktop", "jpg"), alt: "", width: 2400, height: 1200 });
  const mobile = fixtureImage({ id: "media-hero-mobile", url: stored("apex-cart/storefront/hero-mobile", "jpg"), alt: "", width: 1080, height: 1350 });
  const settings = {
    ...publishedStorefront.settings,
    sections: [{ id: "hero", type: "campaign", title: "Hero", enabled: true, productIds: [], categoryIds: [], campaignId: "launch" }],
    campaigns: [{
      id: "launch", title: "Launch week", body: "New season arrivals.", conditions: "While stocks last.",
      cta: { label: "Shop now", target: "shop", targetId: null },
      desktopMediaId: desktop.id, mobileMediaId: mobile.id,
      desktopFocal: { x: 30, y: 40 }, mobileFocal: { x: 70, y: 20 }, layout: "overlay",
    }],
  };
  await context.route("**/api/settings/storefront", (route) => route.fulfill({ json: { ...publishedStorefront, settings, media: [desktop, mobile] } }));

  await page.goto("/");
  const image = page.getByRole("region", { name: "Launch week" }).locator("picture img");
  await expect.poll(() => image.evaluate(loaded)).toBe(true);
  const chosen = await image.evaluate((element: HTMLImageElement) => element.currentSrc);
  // 100vw: 390px phones take the 640px mobile candidate; 1280px desktops take the 1280px desktop candidate.
  expect(chosen).toContain(isMobile ? "/apex-cart/storefront/hero-mobile.jpg" : "/apex-cart/storefront/hero-desktop.jpg");
  expect(renditionWidth(chosen)).toBe(isMobile ? 640 : 1280);
  expect(requested.filter((url) => url.includes("/apex-cart/storefront/hero-"))).toEqual([chosen]);
  await expect(image).toHaveCSS("object-position", isMobile ? "70% 20%" : "30% 40%");
  await test.info().attach("requested-images.json", { body: JSON.stringify(requested, null, 2), contentType: "application/json" });
});

test("catalog manager tiles request the smallest thumbnail at least as wide as each tile", async ({ page, context, isMobile }) => {
  await signInStaff(page);
  const requested = await serveImageHosts(context);
  const images: Record<string, CatalogProduct["images"]> = { [linenShirt.id]: [linenCover], [poloShirt.id]: [poloPhoto], [demoPhone.id]: [phonePlaceholder] };
  await context.route("**/api/admin/catalog", (route) => route.fulfill({
    json: { ...adminSnapshot, products: adminSnapshot.products.map((product) => ({ ...product, images: images[product.id] ?? product.images })) },
  }));
  const evidence: { viewport: number; slot: number; src: string }[] = [];
  const checkTiles = async (expectedWidth: number) => {
    for (const name of ["Linen Short-Sleeve Shirt", "Cotton Polo Shirt", "Demo Smartphone"]) {
      const tile = page.getByRole("button", { name: `Edit ${name}` }).locator("img");
      await tile.scrollIntoViewIfNeeded();
      const choice = await chosenForSlot(tile);
      expectSmallestSufficient(CARD_WIDTHS, choice);
      expect(choice.width).toBe(expectedWidth);
      expect(requested).toContain(choice.src);
      evidence.push({ viewport: page.viewportSize()?.width ?? 0, slot: choice.slot, src: choice.src });
    }
  };

  // Tiles use card renditions: two columns on a 390px phone (~149px tiles), five at 1280px beside the navigation column
  // (~173px tiles).
  await page.goto("/#/admin/catalog/products");
  await checkTiles(240);
  // Three columns on a 768px tablet (~213px); four columns at 1200px (~260px tiles).
  await page.setViewportSize(isMobile ? { width: 768, height: 900 } : { width: 1200, height: 900 });
  await page.reload();
  await checkTiles(isMobile ? 240 : 320);
  await test.info().attach("tile-renditions.json", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
});

test("only a campaign leading the page loads with high priority; a campaign further down stays lazy", async ({ page, context, isMobile }) => {
  const requested = await serveImageHosts(context);
  await serveMediaCatalog(context);
  const priorities = await recordPriorities(context, page);
  const art = (name: string) => fixtureImage({ id: `media-${name}`, url: stored(`apex-cart/storefront/${name}`, "jpg"), alt: "", width: 2400, height: 1200 });
  const media = ["top-desktop", "top-mobile", "lower-desktop", "lower-mobile"].map(art);
  const campaign = (id: string, title: string, artwork: string) => ({
    id, title, body: "", conditions: "", cta: { label: "Shop now", target: "shop", targetId: null },
    desktopMediaId: `media-${artwork}-desktop`, mobileMediaId: `media-${artwork}-mobile`,
    desktopFocal: { x: 50, y: 50 }, mobileFocal: { x: 50, y: 50 }, layout: "overlay",
  });
  const section = (id: string, type: string, campaignId: string | null = null) =>
    ({ id, type, title: id === "departments" ? "Shop by department" : id, enabled: true, productIds: [], categoryIds: [], campaignId });
  const settings = {
    ...publishedStorefront.settings,
    sections: [section("top", "campaign", "launch"), section("departments", "departments"), section("featured", "featured"), section("lower", "campaign", "later")],
    campaigns: [campaign("launch", "Launch week", "top"), campaign("later", "Later offer", "lower")],
  };
  await context.route("**/api/settings/storefront", (route) => route.fulfill({ json: { ...publishedStorefront, settings, media } }));

  await page.goto("/");
  const viewport = isMobile ? "mobile" : "desktop";
  const top = page.getByRole("region", { name: "Launch week" }).locator("picture img");
  const lower = page.getByRole("region", { name: "Later offer" }).locator("picture img");
  await expect.poll(() => top.evaluate(loaded)).toBe(true);
  await expect(top).toHaveAttribute("loading", "eager");
  await expect(top).toHaveAttribute("fetchpriority", "high");
  const topUrl = await top.evaluate((element: HTMLImageElement) => element.currentSrc);
  expect(topUrl).toBe(rendition(`apex-cart/storefront/top-${viewport}`, isMobile ? 640 : 1280, "jpg"));
  expect(priorities.get(topUrl)).toBe("High");
  await expect(lower).toHaveAttribute("loading", "lazy");
  expect(await lower.getAttribute("fetchpriority")).toBeNull();
  await expect(page.locator('img[fetchpriority="high"]')).toHaveCount(1);

  await lower.scrollIntoViewIfNeeded();
  await expect.poll(() => lower.evaluate(loaded)).toBe(true);
  const lowerUrl = await lower.evaluate((element: HTMLImageElement) => element.currentSrc);
  // A later campaign is a compact band: its artwork fills phones' width but only a third of the band from 768px.
  expect(lowerUrl).toBe(rendition(`apex-cart/storefront/lower-${viewport}`, 640, "jpg"));
  expect(priorities.get(lowerUrl)).not.toBe("High");
  expect(requested.filter((url) => /\/apex-cart\/storefront\/(top|lower)-/.test(url)).sort()).toEqual([lowerUrl, topUrl].sort());
  await test.info().attach("campaign-priorities.json", {
    body: JSON.stringify({ top: { url: topUrl, priority: priorities.get(topUrl) }, lower: { url: lowerUrl, priority: priorities.get(lowerUrl) } }, null, 2),
    contentType: "application/json",
  });
});

const UPLOAD_SIGNATURE = "0123456789abcdef0123456789abcdef01234567";

/** A signed intent as `POST /media/uploads` returns it; every attempt names a new public ID. */
function uploadIntent(attempt: number): UploadIntent {
  return {
    uploadUrl: "https://api.cloudinary.com/v1_1/apex-test/image/upload",
    fields: {
      allowed_formats: "jpg,png,webp,avif", api_key: "123456789012345", asset_folder: "apex-cart/products", overwrite: "false",
      public_id: `apex-cart/products/20261115-${String(attempt).padStart(24, "0")}`, signature: "f".repeat(40),
      tags: "apex-cart,product", timestamp: "1763200000", transformation: "c_limit,w_3000,h_3000",
    },
    maxBytes: 10_485_760,
    acceptedTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"],
    expiresAt: "2026-11-15T10:50:00.000Z",
  };
}

const uploadReply = (intent: UploadIntent) => ({
  public_id: intent.fields.public_id, version: 1763200001, signature: UPLOAD_SIGNATURE, width: 1600, height: 2000,
  format: "png", bytes: 68, resource_type: "image",
  secure_url: `https://res.cloudinary.com/apex-test/image/upload/v1763200001/${intent.fields.public_id}.png`,
});

/** Parts of a multipart body in order: text fields by value, files as `file:<name>`. */
function formParts(request: Request): [string, string][] {
  const boundary = /boundary=([^;]+)/.exec(request.headers()["content-type"] ?? "")?.[1];
  const body = request.postDataBuffer()?.toString("latin1");
  if (!boundary || !body) return [];
  return body.split(`--${boundary}`).slice(1, -1).map((part) => {
    const [head, ...value] = part.replace(/^\r\n/, "").split("\r\n\r\n");
    const name = /name="([^"]*)"/.exec(head)?.[1] ?? "";
    const filename = /filename="([^"]*)"/.exec(head)?.[1];
    return [name, filename === undefined ? value.join("\r\n\r\n").replace(/\r\n$/, "") : `file:${filename}`];
  });
}

test("staff upload with progress, cancel and a freshly signed retry, then save the upload without an address", async ({ page, context, isMobile }) => {
  await signInStaff(page);
  const requested = await serveImageHosts(context);
  const product: AdminCatalogProduct = { ...staffRecord(linenShirt), images: [linenCover, linenShirt.images[1]] };
  await context.route("**/api/admin/catalog", (route) => route.fulfill({
    json: { ...adminSnapshot, products: adminSnapshot.products.map((item) => (item.id === product.id ? product : item)) },
  }));
  const intents: UploadIntent[] = [];
  const intentRequests: { authorization?: string; body: unknown }[] = [];
  await context.route("**/api/media/uploads", (route) => {
    intentRequests.push({ authorization: route.request().headers().authorization, body: route.request().postDataJSON() });
    const intent = uploadIntent(intents.length + 1);
    intents.push(intent);
    return route.fulfill({ json: intent });
  });
  const uploads: Request[] = [];
  let releaseHeld = () => {};
  await context.route("https://api.cloudinary.com/**", async (route) => {
    const attempt = uploads.push(route.request());
    if (attempt === 1) {
      // Held open so the row stays in progress until the test cancels it; the page aborts it first.
      await new Promise<void>((resolve) => { releaseHeld = resolve; });
      return route.abort().catch(() => undefined);
    }
    return route.fulfill({ headers: { "access-control-allow-origin": ORIGIN }, json: uploadReply(intents[attempt - 1]) });
  });
  const saves: { images: MediaInput[] }[] = [];
  await context.route(`**/api/products/${product.id}`, (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    saves.push(route.request().postDataJSON());
    return route.fulfill({ json: product });
  });

  await page.goto("/#/admin/catalog/products");
  await page.getByRole("button", { name: "Edit Linen Short-Sleeve Shirt" }).click();
  const editor = page.getByRole("dialog", { name: "Edit product", exact: true });
  const images = editor.getByRole("region", { name: "Images" });
  await expect(images.getByText("Uploaded · WEBP · 239 KB · 2400 × 3000 px")).toBeVisible();
  await expect(images.getByRole("textbox", { name: "Image 1 URL" })).toHaveCount(0);

  await images.getByLabel("Upload images").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: TINY_PNG });
  await expect(images.getByRole("progressbar", { name: "Upload progress for photo.png" })).toBeVisible();
  await expect(images.getByText(/^(Uploading… \d+%|Finishing…)$/)).toBeVisible();
  await expect.poll(() => uploads.length).toBe(1);
  await images.getByRole("button", { name: "Cancel upload of photo.png" }).click();
  await expect(images.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(images.getByRole("progressbar")).toHaveCount(0);
  releaseHeld();
  const retry = images.getByRole("button", { name: "Retry upload of photo.png" });
  await expect(retry).toBeFocused();

  if (isMobile) {
    // Phone with doubled text: stacked cards and wrapped actions stay inside the image section with 44px targets.
    // (Page-level overflow is not asserted: the untouched Categories/Designers panels behind the dialog overflow at this size.)
    await page.setViewportSize({ width: 360, height: 740 });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    for (const control of [
      images.getByLabel("Upload images"), retry, images.getByRole("button", { name: "Dismiss photo.png" }),
      images.getByRole("button", { name: "Move image 2 up" }), images.getByRole("button", { name: "Replace image 2" }),
      images.getByRole("button", { name: "Remove image 2" }),
    ]) {
      expect((await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    expect(await images.evaluate((section) => section.scrollWidth - section.clientWidth)).toBeLessThanOrEqual(0);
    expect(await clippedWithin(images)).toEqual([]);
    const sectionBox = await images.boundingBox();
    for (const control of [images.getByRole("button", { name: "Remove image 2" }), images.getByRole("button", { name: "Dismiss photo.png" })]) {
      const box = await control.boundingBox();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((sectionBox?.x ?? 0) + (sectionBox?.width ?? 0) + 1);
    }
    const chip = await page.getByRole("button", { name: /^Needs images \(\d+\)$/ }).boundingBox();
    expect((chip?.x ?? 0) + (chip?.width ?? 0)).toBeLessThanOrEqual(360);
    const preview = images.getByRole("listitem").filter({ has: page.getByRole("heading", { name: /^Image 2/ }) }).locator("img");
    expect((await preview.boundingBox())?.width).toBe(72);
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });

    // Tablet: 96px thumbnail beside two columns of controls.
    await page.setViewportSize({ width: 768, height: 900 });
    expect((await preview.boundingBox())?.width).toBe(96);
    const alt = await images.getByRole("textbox", { name: "Image 2 alt text" }).boundingBox();
    const address = await images.getByRole("textbox", { name: "Image 2 URL" }).boundingBox();
    expect(Math.abs((alt?.y ?? 0) - (address?.y ?? 1))).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 390, height: 844 });
  }

  await retry.click();
  await expect(images.getByRole("heading", { name: /^Image 3/ })).toBeVisible();
  // Retry handed focus to Cancel; when the finished row disappears, focus stays in the editor on the upload control.
  await expect(images.getByLabel("Upload images")).toBeFocused();
  await expect(images.getByText("Unsaved upload")).toBeVisible();
  await expect(images.getByText("Uploaded · PNG · 68 B · 1600 × 2000 px")).toBeVisible();
  await expect.poll(() => widthsOf(requested, intents[1]?.fields.public_id ?? "unknown")).toEqual([96]);
  expect(intentRequests).toEqual([
    { authorization: `Bearer ${STAFF_TOKEN}`, body: { purpose: "PRODUCT" } },
    { authorization: `Bearer ${STAFF_TOKEN}`, body: { purpose: "PRODUCT" } },
  ]);
  expect(uploads.map((request) => [request.method(), request.url()])).toEqual([["POST", intents[0].uploadUrl], ["POST", intents[1].uploadUrl]]);
  expect(formParts(uploads[1])).toEqual([...Object.entries(intents[1].fields), ["file", "file:photo.png"]]);

  await editor.getByRole("button", { name: "Save product" }).click();
  await expect(editor).toHaveCount(0);
  const unset = { isPlaceholder: false, sourceUrl: null, license: null, credit: null };
  expect(saves.map((save) => save.images)).toEqual([[
    { id: linenCover.id, alt: "Linen shirt, front", isMain: true, order: 0, variantId: null, ...unset },
    { id: "img-linen-2", url: "https://media.example.test/linen-detail.jpg", alt: "Linen shirt, collar detail", isMain: false, order: 1, variantId: null, ...unset },
    {
      cloudinary: { publicId: intents[1].fields.public_id, version: 1763200001, signature: UPLOAD_SIGNATURE, format: "png", bytes: 68 },
      width: 1600, height: 2000, alt: null, isMain: false, order: 2, variantId: null, ...unset,
    },
  ]]);
  expect(saves[0].images[2]).not.toHaveProperty("url");
});
