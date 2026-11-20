import type { BrowserContext, Locator, Page } from "@playwright/test";
import { linenShirt } from "../../src/test-support/catalogFixtures";
import { IMAGE_SIZE, LONG_NAME, campShirt, selectionSnapshot } from "../../src/test-support/selectionFixtures";
import { backdropContrast, expect, expectWholeFocusRing, pageOverflow, shopperState, tabThroughRings, tabWithoutBrowserScrolling, test } from "./fixtures";

const STAND_IN = `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_SIZE.width}" height="${IMAGE_SIZE.height}"><rect width="100%" height="100%" fill="#c9d6e3"/><circle cx="600" cy="500" r="300" fill="#fff"/></svg>`;
const productRoute = (id: string) => `/#/product/${encodeURIComponent(id)}`;

/** Serves the catalog with the camp shirt, its product details, and every image host; returns the image requests. */
async function serveSelectionCatalog(context: BrowserContext) {
  const snapshot = selectionSnapshot();
  await context.route("**/api/catalog", (route) => route.fulfill({ json: snapshot }));
  await context.route("**/api/products/*", (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() ?? "");
    const product = snapshot.products.find((item) => item.id === id);
    return product ? route.fulfill({ json: { ...product, reviewList: [] } }) : route.fallback();
  });
  const requested: string[] = [];
  await context.route("https://res.cloudinary.com/**", (route) => {
    requested.push(route.request().url());
    return route.fulfill({ contentType: "image/svg+xml", body: STAND_IN });
  });
  return requested;
}

/** The page's own purchase action: the first Add or Choose options button in the main content. */
const pageAction = (page: Page) => page.getByRole("main").getByRole("button", { name: /^(Add to cart|Choose options)$/ }).first();
const top = async (locator: Locator) => (await locator.boundingBox())!.y;

/** Waits until the window has stopped scrolling. */
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

/** Dispatches one raw touch gesture through the DevTools protocol: each step lists every finger's position. */
async function touchGesture(page: Page, steps: { x: number; y: number }[][]) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: steps[0] });
  for (const points of steps.slice(1)) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** The viewer's zoom and pan as applied, with the largest pan that still keeps the frame covered. */
const viewerState = (page: Page) => page.getByRole("dialog", { name: "Image viewer" }).locator("img").evaluate((image: HTMLImageElement) => {
  const frame = image.parentElement!.getBoundingClientRect();
  const [, x, y, scale] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(image.style.transform)!.map(Number);
  const fit = Math.min(frame.width / image.naturalWidth, frame.height / image.naturalHeight);
  return {
    scale, x, y,
    limitX: Math.max(0, (image.naturalWidth * fit * scale - frame.width) / 2),
    limitY: Math.max(0, (image.naturalHeight * fit * scale - frame.height) / 2),
  };
});

test.beforeEach(async ({ page, context }) => {
  // Requesting `page` first sets up the shared API fixture, so these routes take precedence over it.
  void page;
  await serveSelectionCatalog(context);
});

test("phones show the title, price and availability before the gallery, then the choices and purchase facts", async ({ page, isMobile }) => {
  await page.goto(productRoute(campShirt.id));
  const heading = page.getByRole("heading", { level: 1, name: LONG_NAME });
  await expect(heading).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  const main = page.getByRole("main");
  const price = main.getByText("excl. VAT", { exact: true }).first();
  const availability = main.getByText("Availability depends on the options you choose.");
  const stage = page.getByRole("list", { name: `Images of ${LONG_NAME}` });
  const options = main.getByRole("group", { name: /^Size/ });
  const facts = main.getByRole("region", { name: "Delivery and returns" });
  await expect(main.getByText("VAT (16%) and delivery are added at checkout.")).toBeVisible();
  await expect(main.getByText("Sample values for review, not verified product facts.")).toBeVisible();
  await expect(main.getByRole("term").filter({ hasText: "Material" })).toBeVisible();
  if (isMobile) {
    const order = [await top(heading), await top(price), await top(availability), await top(stage), await top(options), await top(pageAction(page)), await top(facts)];
    expect(order, "title, price, availability, gallery, options, action, facts").toEqual([...order].sort((a, b) => a - b));
  } else {
    // Two columns: the gallery on the left, the facts and choices on the right.
    const [galleryBox, headingBox, optionsBox] = [await stage.boundingBox(), await heading.boundingBox(), await options.boundingBox()];
    expect(galleryBox!.x + galleryBox!.width).toBeLessThanOrEqual(headingBox!.x);
    expect(optionsBox!.x).toBeGreaterThanOrEqual(galleryBox!.x + galleryBox!.width);
    expect(Math.abs(galleryBox!.y - headingBox!.y)).toBeLessThanOrEqual(24);
  }
});

test("nothing is added without every choice: on the product page, on cards and in Quick View", async ({ page }) => {
  await page.goto(productRoute(campShirt.id));
  await expect(pageAction(page)).toHaveText("Choose options");
  await pageAction(page).click();
  // The action leads to the first choice still missing.
  await expect(page.getByRole("main").getByRole("button", { name: "S", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "M", exact: true }).click();
  await expect(pageAction(page)).toHaveText("Choose options");
  await expect(page.getByText("Select color to continue.")).toBeVisible();
  // Unavailable values say so in text; choosing one states the reason and disables Add.
  await page.getByRole("button", { name: "Black (sold out)" }).click();
  await expect(page.getByRole("status").filter({ hasText: "This combination is sold out. Choose different options." })).toBeVisible();
  await expect(pageAction(page)).toBeDisabled();
  await page.getByRole("button", { name: "L", exact: true }).click();
  await page.getByRole("button", { name: "White (unavailable)" }).click();
  await expect(page.getByText("This combination is not available. Choose different options.")).toBeVisible();
  await expect(pageAction(page)).toBeDisabled();
  expect((await shopperState(page, null))?.cart ?? []).toEqual([]);

  await page.goto("/#/shop?cat=shirts");
  const card = page.getByRole("list", { name: "Products" }).getByRole("listitem").filter({ hasText: LONG_NAME });
  await expect(card.getByRole("button", { name: /add to cart/i })).toHaveCount(0);
  const opener = card.getByRole("button", { name: `Choose options for ${LONG_NAME}` });
  await expect(opener).toHaveAttribute("aria-haspopup", "dialog");
  await opener.click();
  const quickView = page.getByRole("dialog", { name: `Quick view: ${LONG_NAME}` });
  const quickAction = quickView.getByRole("button", { name: /^(Add to cart|Choose options)$/ });
  await expect(quickAction).toHaveText("Choose options");
  await quickAction.click();
  await expect(quickView.getByRole("button", { name: "S", exact: true })).toBeFocused();
  expect((await shopperState(page, null))?.cart ?? []).toEqual([]);
});

test("Quick View stores the same line as the product page and leaves the listing as it was", async ({ page, isMobile }) => {
  await page.goto("/#/shop?cat=shirts");
  await expect(page.getByRole("heading", { level: 1, name: "Shirts" })).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: 300, behavior: "instant" }));
  await scrollSettled(page);
  const scrolled = await page.evaluate(() => window.scrollY);
  const url = page.url();
  const opener = page.getByRole("button", { name: `Choose options for ${LONG_NAME}` });
  await opener.focus();
  await page.keyboard.press("Enter");
  const quickView = page.getByRole("dialog", { name: `Quick view: ${LONG_NAME}` });
  await expect(quickView.getByRole("heading", { level: 2, name: LONG_NAME })).toBeFocused();
  // Sheet on phones, a centred two-column dialog at 1280px.
  const box = (await quickView.locator(":scope > div").boundingBox())!;
  if (isMobile) expect([box.x, box.width]).toEqual([0, 390]);
  else expect(box.width).toBeLessThanOrEqual(960);

  await quickView.getByRole("button", { name: "S", exact: true }).click();
  await quickView.getByRole("button", { name: "Navy", exact: true }).click();
  await quickView.getByRole("button", { name: "Add to cart" }).click();
  const confirmation = quickView.getByRole("status").filter({ hasText: "Added to cart." });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole("link", { name: "View cart" })).toHaveAttribute("href", "#/cart");
  // Quick View confirms in place: no mini-cart over it; the header badge counts the unit.
  await expect(page.getByRole("dialog", { name: "Your cart" })).toHaveCount(0);
  const fromQuickView = (await shopperState(page, null)).cart;
  expect(fromQuickView).toEqual([{ productId: campShirt.id, variantId: "camp-s-navy", quantity: 1 }]);
  await confirmation.getByRole("button", { name: "Keep shopping" }).click();
  await expect(quickView).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  await expect(page.getByRole("button", { name: "Cart", exact: true })).toHaveText(/^1/);

  // The same choice made on the product page stores an identical line (a fresh load starts from the cleared cart).
  await page.evaluate(() => localStorage.clear());
  await page.goto(productRoute(campShirt.id));
  await page.reload();
  await page.getByRole("button", { name: "S", exact: true }).click();
  await page.getByRole("button", { name: "Navy", exact: true }).click();
  await pageAction(page).click();
  await expect(page.getByRole("dialog", { name: "Your cart" })).toBeVisible();
  expect((await shopperState(page, null)).cart).toEqual(fromQuickView);
});

test("the product heading takes focus on an in-app visit, not on a fresh load", async ({ page }) => {
  await page.goto(productRoute(linenShirt.id));
  await expect(page.getByRole("heading", { level: 1, name: linenShirt.name })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).not.toBeFocused();
  await page.goto("/#/shop?cat=shirts");
  await page.getByRole("link", { name: linenShirt.name, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: linenShirt.name })).toBeFocused();
});

test("a choice reorders the gallery around the chosen colour and returns to its first image", async ({ page }) => {
  await page.goto(productRoute(campShirt.id));
  const thumbnails = page.getByRole("list", { name: "Choose an image" }).getByRole("button");
  await expect(thumbnails).toHaveCount(5);
  const stage = page.getByRole("list", { name: `Images of ${LONG_NAME}` });
  const shown = () => stage.getByRole("img").getAttribute("alt");
  expect(await shown()).toBe("Camp-collar shirt laid flat, front");
  await page.getByRole("button", { name: "Next image" }).click();
  await expect(page.getByText("Image 2 of 5", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Navy", exact: true }).click();
  // Navy narrows the shirt to its navy SKUs: their image first, then the general images; other colours' images go.
  await expect(thumbnails).toHaveCount(3);
  await expect(page.getByText("Image 1 of 3", { exact: true })).toBeVisible();
  expect(await shown()).toBe("Camp-collar shirt in navy");
});

test("the zoom viewer zooms by buttons and keys, loads the large image only when opened, and gives focus back", async ({ page, context }) => {
  const requested = await serveSelectionCatalog(context);
  await page.goto(productRoute(campShirt.id));
  const zoom = page.getByRole("button", { name: "Zoom image 1 of 5" });
  await expect(zoom).toBeVisible();
  expect(requested.some((url) => url.includes("w_2400"))).toBe(false);
  await zoom.click();
  const viewer = page.getByRole("dialog", { name: "Image viewer" });
  await expect(viewer.getByRole("button", { name: "Close" })).toBeFocused();
  await expect.poll(() => requested.filter((url) => url.includes("w_2400"))).toEqual([
    "https://res.cloudinary.com/apex-test/image/upload/c_limit,w_2400/q_auto/f_auto/v1763200000/apex-cart/products/camp-front.webp",
  ]);
  const picture = viewer.getByRole("img", { name: "Camp-collar shirt laid flat, front" });
  await expect.poll(() => picture.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(IMAGE_SIZE.width);
  await expect(viewer.getByText("Sample image")).toBeVisible();
  const level = viewer.getByText(/^Zoom \d+%$/);
  await expect(level).toHaveText("Zoom 100%");
  await expect(viewer.getByRole("button", { name: "Zoom out" })).toHaveAttribute("aria-disabled", "true");
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  await expect(level).toHaveText("Zoom 150%");
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  // Bounded at 4×.
  await expect(level).toHaveText("Zoom 400%");
  await expect(viewer.getByRole("button", { name: "Zoom in" })).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("-");
  await expect(level).toHaveText("Zoom 267%");
  await viewer.getByRole("button", { name: "Reset zoom" }).click();
  await expect(level).toHaveText("Zoom 100%");
  await page.keyboard.press("+");
  await page.keyboard.press("0");
  await expect(level).toHaveText("Zoom 100%");
  // While zoomed the arrow keys pan within the picture instead of changing it (at 400% it overflows both ways).
  for (let press = 0; press < 4; press += 1) await page.keyboard.press("+");
  await expect(level).toHaveText("Zoom 400%");
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await viewerState(page)).x).toBeLessThan(0);
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await viewerState(page)).y).toBeLessThan(0);
  await expect(viewer.getByText("Image 1 of 5", { exact: true })).toBeVisible();
  await page.keyboard.press("0");
  await expect(level).toHaveText("Zoom 100%");
  await page.keyboard.press("ArrowRight");
  // The image's own alt text, otherwise the product name and position.
  await expect(viewer.getByRole("img", { name: `${LONG_NAME}, image 2 of 5` })).toBeVisible();
  await expect(viewer.getByText("Image 2 of 5", { exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Previous image" }).click();
  await expect(viewer.getByText("Image 1 of 5", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(viewer.getByText("Image 5 of 5", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  // The page gallery follows the viewer; focus is back on its zoom button.
  await expect(page.getByRole("button", { name: "Zoom image 5 of 5" })).toBeFocused();
});

test("every zoom viewer control shows its whole focus ring on screen", async ({ page }) => {
  await page.goto(productRoute(campShirt.id));
  await page.getByRole("button", { name: "Zoom image 1 of 5" }).focus();
  await page.keyboard.press("Enter");
  const viewer = page.getByRole("dialog", { name: "Image viewer" });
  await expect(viewer.getByRole("button", { name: "Close" })).toBeFocused();
  const visited = [await expectWholeFocusRing(page), ...await tabThroughRings(page, 5)];
  expect(visited.sort()).toEqual(["Close", "Next image", "Previous image", "Reset zoom", "Zoom in", "Zoom out"]);
});

test("focus rings on the product page's purchase controls and in Quick View are never cut off", async ({ page }) => {
  await page.goto(productRoute(campShirt.id));
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "M", exact: true }).click();
  await main.getByRole("button", { name: "White", exact: true }).click();
  // A control reached by Tab while just past the bottom edge of the window comes into view with its whole ring: a
  // thumbnail, while the page's own action is still in view, so the purchase bar adds no room of its own.
  const thumbnail = main.getByRole("list", { name: "Choose an image" }).getByRole("button").first();
  await thumbnail.evaluate((element) => window.scrollBy({ top: element.getBoundingClientRect().bottom - (window.innerHeight + 4), behavior: "instant" }));
  await main.getByRole("button", { name: /^Zoom image/ }).evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
  await page.keyboard.press("Tab");
  await expect(thumbnail).toBeFocused();
  await expectWholeFocusRing(page);
  // M in white narrows the gallery to that colour's three images.
  await page.getByRole("heading", { level: 1 }).focus();
  const onPage = await tabThroughRings(page, 20);
  expect(onPage).toEqual(expect.arrayContaining([
    "Previous image", "Zoom image 1 of 3", "Image 1 of 3", "S", "White", "Decrease quantity", "Quantity", "Increase quantity", "Add to cart",
  ]));

  await page.goto("/#/shop?cat=shirts");
  await page.getByRole("button", { name: `Choose options for ${LONG_NAME}` }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: `Quick view: ${LONG_NAME}` }).getByRole("heading", { level: 2 })).toBeFocused();
  // Round the whole dialog, past its last control and back to the first.
  const inQuickView = await tabThroughRings(page, 26);
  expect(inQuickView).toEqual(expect.arrayContaining([
    "Close quick view", "Previous image", "Next image", "S", "M", "L", "Decrease quantity", "Increase quantity", "View full details",
  ]));
});

test("touch pinches to zoom, drags only as far as keeps the frame covered, and double-taps back", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Touch gestures are checked in the mobile project.");
  await page.goto(productRoute(campShirt.id));
  await page.getByRole("button", { name: "Zoom image 1 of 5" }).click();
  const viewer = page.getByRole("dialog", { name: "Image viewer" });
  const picture = viewer.getByRole("img", { name: "Camp-collar shirt laid flat, front" });
  await expect.poll(() => picture.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(IMAGE_SIZE.width);
  const frame = (await picture.boundingBox())!;
  const centre = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };

  // Two fingers moving apart.
  const pinch = Array.from({ length: 11 }, (_, step) => {
    const spread = 30 + step * 12;
    return [{ x: centre.x - spread, y: centre.y }, { x: centre.x + spread, y: centre.y }];
  });
  await touchGesture(page, pinch);
  const pinched = await viewerState(page);
  expect(pinched.scale).toBeGreaterThan(2);
  expect(pinched.scale).toBeLessThanOrEqual(4);

  // A long one-finger drag stops where the zoomed image's edge meets the frame's edge.
  await touchGesture(page, Array.from({ length: 12 }, (_, step) => [{ x: centre.x - 100 + step * 40, y: centre.y + step * 30 }]));
  const dragged = await viewerState(page);
  expect(dragged.scale).toBe(pinched.scale);
  expect(Math.abs(dragged.x)).toBeGreaterThan(0);
  expect(Math.abs(dragged.x)).toBeLessThanOrEqual(dragged.limitX + 0.5);
  expect(Math.abs(dragged.y)).toBeLessThanOrEqual(dragged.limitY + 0.5);

  // Double-tap returns to 1×; at 1× a horizontal swipe moves to the next image.
  for (let tap = 0; tap < 2; tap += 1) await touchGesture(page, [[centre], [centre]]);
  await expect(viewer.getByText(/^Zoom \d+%$/)).toHaveText("Zoom 100%");
  await touchGesture(page, Array.from({ length: 8 }, (_, step) => [{ x: centre.x + 120 - step * 30, y: centre.y }]));
  await expect(viewer.getByText("Image 2 of 5", { exact: true })).toBeVisible();
  // On the page itself, the stage swipes natively between images.
  await page.keyboard.press("Escape");
  await expect(page.getByText("Image 2 of 5", { exact: true })).toBeAttached();
  const list = page.getByRole("list", { name: `Images of ${LONG_NAME}` });
  await list.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
  // A finger moving left across the middle of the stage, clear of its buttons.
  const stage = (await list.boundingBox())!;
  const middle = { x: stage.x + stage.width / 2, y: stage.y + stage.height * 0.35 };
  await touchGesture(page, Array.from({ length: 10 }, (_, step) => [{ x: middle.x + 110 - step * 25, y: middle.y }]));
  await expect(page.getByText("Image 3 of 5", { exact: true })).toBeAttached();
});

test("in the viewer a zoomed picture stays put: Next's spot pans instead, and a finger lifted after pinching back never swipes", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Touch gestures are checked in the mobile project.");
  await page.goto(productRoute(campShirt.id));
  await page.getByRole("button", { name: "Zoom image 1 of 5" }).click();
  const viewer = page.getByRole("dialog", { name: "Image viewer" });
  const picture = viewer.getByRole("img", { name: "Camp-collar shirt laid flat, front" });
  await expect.poll(() => picture.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(IMAGE_SIZE.width);
  const level = viewer.getByText(/^Zoom \d+%$/);
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  await expect(level).toHaveText("Zoom 150%");
  const next = viewer.getByRole("button", { name: "Next image" });
  await expect(next).toHaveAttribute("aria-disabled", "true");
  const spot = (await next.boundingBox())!;
  await page.touchscreen.tap(spot.x + spot.width / 2, spot.y + spot.height / 2);
  await page.touchscreen.tap(spot.x + spot.width / 2 - 200, spot.y + spot.height / 2);
  await expect(viewer.getByText("Image 1 of 5", { exact: true })).toBeVisible();
  await expect(level).toHaveText("Zoom 150%");

  // Two fingers pinch back to 100%; one lifts, the other slides well across the picture and lifts.
  await viewer.getByRole("button", { name: "Reset zoom" }).click();
  const frame = (await picture.boundingBox())!;
  const centre = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  const fingers = (spread: number) => [{ x: centre.x - spread, y: centre.y, id: 1 }, { x: centre.x + spread, y: centre.y, id: 2 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: fingers(30) });
  for (const spread of [50, 70, 90, 70, 50, 30]) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: fingers(spread) });
  await expect(level).toHaveText("Zoom 100%");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [fingers(30)[0]] });
  for (let step = 1; step <= 6; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: centre.x - 30 - step * 25, y: centre.y, id: 1 }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await expect(viewer.getByText("Image 1 of 5", { exact: true })).toBeVisible();
});

test("on a phone a tap on the picture opens the viewer, and a pinch-zoomed page never swipes the pictures", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Touch gestures are checked in the mobile project.");
  await page.goto(productRoute(campShirt.id));
  const list = page.getByRole("list", { name: `Images of ${LONG_NAME}` });
  await list.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
  const stage = (await list.boundingBox())!;
  await page.touchscreen.tap(stage.x + stage.width / 2, stage.y + stage.height * 0.35);
  const viewer = page.getByRole("dialog", { name: "Image viewer" });
  await expect(viewer.getByText("Image 1 of 5", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);

  const cdp = await page.context().newCDPSession(page);
  /**
   * A finger sliding left across the visible part of the stage, clear of its buttons. DevTools touch points are page
   * (client) coordinates even while the page is zoomed; the swipe must start on the stage itself.
   */
  const swipeAcrossStage = async () => {
    const line = await list.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const view = window.visualViewport!;
      const y = rect.top + rect.height * 0.35;
      const left = Math.max(rect.left, view.offsetLeft) + 20;
      const right = Math.min(rect.right, view.offsetLeft + view.width) - 20;
      const visible = y > view.offsetTop && y < view.offsetTop + view.height;
      return { from: right, to: left, y, onStage: visible && element.contains(document.elementFromPoint(right, y)) };
    });
    expect(line.onStage, "the swipe starts on the visible stage itself").toBe(true);
    const point = (step: number) => [{ x: line.from - ((line.from - line.to) * step) / 9, y: line.y }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(0) });
    for (let step = 1; step <= 9; step += 1) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(step) });
    // Held still before lifting, so it ends without a fling: a fling left over from the zoomed swipe would carry on
    // into the stage once the emulated zoom resets, which real fingers (pinching back out) never allow.
    await page.waitForTimeout(150);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  const scrolled = () => list.evaluate((element) => element.scrollLeft);
  /** The furthest the stage has scrolled since this was first read, so a drag that springs back still counts. */
  const furthest = () => list.evaluate((element) => {
    const store = window as unknown as { stageFurthest?: number };
    if (store.stageFurthest === undefined) {
      store.stageFurthest = 0;
      element.addEventListener("scroll", () => { store.stageFurthest = Math.max(store.stageFurthest!, element.scrollLeft); }, { passive: true });
    }
    return store.stageFurthest;
  });
  await furthest();
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  await expect.poll(() => page.evaluate(() => window.visualViewport!.scale)).toBeGreaterThan(1.5);
  await swipeAcrossStage();
  await page.waitForTimeout(400);
  expect(await furthest(), "the stage never moves while the page is zoomed").toBe(0);
  await expect(page.getByText("Image 1 of 5", { exact: true })).toBeAttached();
  // Back at 100%, still on the first picture at rest, the same swipe moves to the next picture.
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
  await expect.poll(() => page.evaluate(() => window.visualViewport!.scale)).toBe(1);
  await page.waitForTimeout(300);
  expect(await scrolled(), "nothing carried on into the stage").toBe(0);
  await swipeAcrossStage();
  await expect(page.getByText("Image 2 of 5", { exact: true })).toBeAttached();
  await cdp.detach();
});

test("a hovering mouse magnifies the shown picture where it points, and a click opens the viewer", async ({ page, context, isMobile }) => {
  test.skip(isMobile, "Hover zoom serves a mouse or trackpad.");
  const requested = await serveSelectionCatalog(context);
  await page.goto(productRoute(campShirt.id));
  const list = page.getByRole("list", { name: `Images of ${LONG_NAME}` });
  const picture = list.getByRole("img", { name: "Camp-collar shirt laid flat, front" });
  await expect.poll(() => picture.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  /** The magnification applied around the picture, and where it centres as a share of the picture. */
  const magnified = () => picture.locator("xpath=..").evaluate((element: HTMLElement) => {
    const style = getComputedStyle(element);
    const [x, y] = style.transformOrigin.split(" ").map(parseFloat);
    return { scale: style.transform === "none" ? 1 : new DOMMatrix(style.transform).a, x: x / element.offsetWidth, y: y / element.offsetHeight };
  });
  expect(requested.some((url) => url.includes("w_2400"))).toBe(false);
  const box = (await list.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.75);
  await expect.poll(async () => (await magnified()).scale).toBeCloseTo(2.5, 2);
  let now = await magnified();
  expect([now.x, now.y].map((share) => Math.round(share * 100))).toEqual([25, 75]);
  await expect.poll(() => requested.filter((url) => url.includes("w_2400"))).toEqual([
    "https://res.cloudinary.com/apex-test/image/upload/c_limit,w_2400/q_auto/f_auto/v1763200000/apex-cart/products/camp-front.webp",
  ]);
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.2);
  now = await magnified();
  expect([now.x, now.y].map((share) => Math.round(share * 100))).toEqual([60, 20]);
  // Leaving the picture restores it; a click on it opens the viewer at it.
  await page.mouse.move(box.x + box.width / 2, box.y - 30);
  await expect.poll(async () => (await magnified()).scale).toBe(1);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6);
  await expect(page.getByRole("dialog", { name: "Image viewer" }).getByText("Image 1 of 5", { exact: true })).toBeVisible();
});

test("reduced motion makes zoom and image changes immediate", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(productRoute(campShirt.id));
  await expect(page.getByRole("list", { name: `Images of ${LONG_NAME}` })).toHaveCSS("scroll-behavior", "auto");
  await page.getByRole("button", { name: "Zoom image 1 of 5" }).click();
  const picture = page.getByRole("dialog", { name: "Image viewer" }).locator("img");
  await expect(picture).toBeVisible();
  const motion = await picture.evaluate((image) => {
    const style = getComputedStyle(image);
    return { transition: Number.parseFloat(style.transitionDuration), animation: style.animationName };
  });
  expect(motion.transition).toBeLessThan(0.001);
  expect(motion.animation).toBe("none");
  await page.keyboard.press("+");
  // Two frames later the zoom is complete; the 160ms gallery transition would still be under way.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await picture.evaluate((image) => getComputedStyle(image).transform)).toMatch(/^matrix\(1\.5, 0, 0, 1\.5/);
});

test("the phone purchase bar shows only while the page's action is off screen, and leads to the first missing choice", async ({ page, isMobile }) => {
  test.skip(!isMobile, "The purchase bar serves widths below 1024px.");
  await page.goto(productRoute(campShirt.id));
  const bar = page.locator("[data-purchase-bar]");
  const action = pageAction(page);
  await expect(action).toBeVisible();
  await action.scrollIntoViewIfNeeded();
  await scrollSettled(page);
  await expect(bar).toBeHidden();
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("KES 3,200");
  await expect(bar).toContainText("excl. VAT");
  await bar.getByRole("button", { name: "Choose options" }).click();
  const first = page.getByRole("main").getByRole("button", { name: "S", exact: true });
  await expect(first).toBeFocused();
  await scrollSettled(page);
  const focused = (await first.boundingBox())!;
  const header = await page.evaluate(() => Math.max(...[...document.querySelectorAll("[data-sticky-header]")].map((element) => element.getBoundingClientRect().bottom)));
  expect(focused.y).toBeGreaterThanOrEqual(header);
  if (await bar.isVisible()) expect(focused.y + focused.height).toBeLessThanOrEqual((await bar.boundingBox())!.y);

  await first.click();
  await page.getByRole("button", { name: "White", exact: true }).click();
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  const add = bar.getByRole("button", { name: "Add to cart" });
  await expect(add).toBeVisible();
  await add.click();
  const drawer = page.getByRole("dialog", { name: "Your cart" });
  await expect(drawer).toBeVisible();
  // Hidden (keeping its space) while a dialog is open.
  await expect(bar).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(bar).toBeVisible();
  expect((await shopperState(page, null)).cart).toEqual([{ productId: campShirt.id, variantId: "camp-s-white", quantity: 1 }]);

  // Short viewports (landscape) keep the sticky budget: no bar at all.
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(bar).toBeHidden();
});

test("back to top floats above the phone purchase bar, never over it", async ({ page, isMobile }) => {
  test.skip(!isMobile, "The purchase bar serves widths below 1024px.");
  await page.goto(productRoute(campShirt.id));
  const bar = page.locator("[data-purchase-bar]");
  const back = page.getByRole("button", { name: "Back to top" });
  await expect(pageAction(page)).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await expect(bar).toBeVisible();
  await page.evaluate(() => window.scrollBy({ top: -150, behavior: "instant" }));
  expect(await page.evaluate(() => window.scrollY > window.innerHeight), "still more than a screen down").toBe(true);
  await expect(back).toBeVisible();
  await expect(bar, "the page's own action is still off screen").toBeVisible();
  const gap = async () => (await bar.boundingBox())!.y - (await back.boundingBox().then((box) => box!.y + box!.height));
  await expect.poll(gap, "space between the button and the bar").toBeGreaterThanOrEqual(8);
});

test("keyboard focus moved behind the purchase bar ends above it (WCAG 2.4.11)", async ({ page, isMobile }) => {
  test.skip(!isMobile, "The purchase bar serves widths below 1024px.");
  await page.goto(productRoute(campShirt.id));
  const bar = page.locator("[data-purchase-bar]");
  const related = page.getByRole("region", { name: /^More in/ });
  const target = related.getByRole("button", { name: "Add to cart" }).first();
  const before = related.getByRole("link", { name: "Cotton Polo Shirt", exact: true });
  await target.scrollIntoViewIfNeeded();
  await expect(bar).toBeVisible();
  const barTop = (await bar.boundingBox())!.y;
  // Put the target's top just inside the bar, then Tab to it from the link before it.
  await target.evaluate((element, edge) => window.scrollBy({ top: element.getBoundingClientRect().top - edge + 4, behavior: "instant" }), barTop);
  await scrollSettled(page);
  const start = (await target.boundingBox())!;
  expect(start.y + start.height, "target starts behind the bar").toBeGreaterThan(barTop);
  await before.evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
  await page.keyboard.press("Tab");
  await expect(target).toBeFocused();
  await scrollSettled(page);
  const end = (await target.boundingBox())!;
  expect(end.y + end.height + 5, "target and its focus ring end above the bar").toBeLessThanOrEqual((await bar.boundingBox())!.y);
});

test("keyboard focus ends above the purchase bar where the browser's own focus scroll stops short", async ({ page, isMobile }) => {
  test.skip(!isMobile, "The purchase bar serves widths below 1024px.");
  await page.goto(productRoute(campShirt.id));
  const bar = page.locator("[data-purchase-bar]");
  const related = page.getByRole("region", { name: /^More in/ });
  const target = related.getByRole("button", { name: "Add to cart" }).first();
  const before = related.getByRole("link", { name: "Cotton Polo Shirt", exact: true });
  await tabWithoutBrowserScrolling(page, before, target);
  await target.scrollIntoViewIfNeeded();
  await expect(bar).toBeVisible();
  const barTop = (await bar.boundingBox())!.y;
  // Only the ring is behind the bar: the button itself ends 2px above it.
  await target.evaluate((element, edge) => window.scrollBy({ top: element.getBoundingClientRect().bottom - (edge - 2), behavior: "instant" }), barTop);
  await scrollSettled(page);
  await before.evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
  await page.keyboard.press("Tab");
  await expect(target).toBeFocused();
  await scrollSettled(page);
  const end = (await target.boundingBox())!;
  expect(end.y + end.height + 5, "target and its focus ring end above the bar").toBeLessThanOrEqual((await bar.boundingBox())!.y);
});

test("the product page and Quick View reflow at 360px, also with doubled text", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone widths are checked in the mobile project.");
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(productRoute(campShirt.id));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  for (const size of ["100%", "200%"]) {
    await page.evaluate((value) => { document.documentElement.style.fontSize = value; }, size);
    expect(await pageOverflow(page), `product page at ${size} text`).toBeLessThanOrEqual(0);
  }
  await page.getByRole("button", { name: "Zoom image 1 of 5" }).click();
  expect(await pageOverflow(page), "zoom viewer at 200% text").toBeLessThanOrEqual(0);
  const viewer = page.getByRole("dialog", { name: "Image viewer" });
  for (const name of ["Zoom out", "Zoom in", "Reset zoom", "Close", "Previous image", "Next image"]) {
    const box = (await viewer.getByRole("button", { name }).boundingBox())!;
    expect(Math.min(box.width, box.height), `${name} target`).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width, `${name} inside the viewport`).toBeLessThanOrEqual(360);
  }
  await page.keyboard.press("Escape");

  await page.goto("/#/shop?cat=shirts");
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await page.getByRole("button", { name: `Choose options for ${LONG_NAME}` }).click();
  const quickView = page.getByRole("dialog", { name: `Quick view: ${LONG_NAME}` });
  await expect(quickView).toBeVisible();
  expect(await pageOverflow(page), "Quick View at 200% text").toBeLessThanOrEqual(0);
  const scroller = quickView.locator(".overflow-y-auto");
  expect(await scroller.evaluate((element) => element.scrollWidth - element.clientWidth), "Quick View scrolls only vertically").toBeLessThanOrEqual(0);
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
});

test("the sample-image label stays legible over white artwork on the stage and in the zoom viewer", async ({ page, context }) => {
  // White artwork is the worst backdrop for the label's light text.
  const white = `<svg xmlns="http://www.w3.org/2000/svg" width="${IMAGE_SIZE.width}" height="${IMAGE_SIZE.height}"><rect width="100%" height="100%" fill="#fff"/></svg>`;
  await context.route("https://res.cloudinary.com/**", (route) => route.fulfill({ contentType: "image/svg+xml", body: white }));
  await page.goto(productRoute(campShirt.id));
  const stage = page.getByRole("list", { name: `Images of ${LONG_NAME}` });
  await expect.poll(() => stage.locator("img").first().evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(await backdropContrast(page, stage.getByText("Sample image").first()), "label on the stage").toBeGreaterThanOrEqual(4.5);
  await page.getByRole("button", { name: "Zoom image 1 of 5" }).click();
  const viewer = page.getByRole("dialog", { name: "Image viewer" });
  await expect.poll(() => viewer.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(await backdropContrast(page, viewer.getByText("Sample image")), "label in the viewer").toBeGreaterThanOrEqual(4.5);
});

test("the zoom viewer opened from Quick View keeps focus nested and hands it back step by step", async ({ page }) => {
  await page.goto("/#/shop?cat=shirts");
  const opener = page.getByRole("button", { name: `Choose options for ${LONG_NAME}` });
  await opener.click();
  const quickView = page.getByRole("dialog", { name: `Quick view: ${LONG_NAME}` });
  const zoom = quickView.getByRole("button", { name: "Zoom image 1 of 5" });
  await zoom.click();
  const viewer = page.getByRole("dialog", { name: "Image viewer" });
  const close = viewer.getByRole("button", { name: "Close" });
  await expect(close).toBeFocused();
  // Tab stays inside the viewer, in both directions.
  for (let press = 0; press < 8; press += 1) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest("dialog")?.getAttribute("aria-label"))).toBe("Image viewer");
  }
  for (let press = 0; press < 8; press += 1) {
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => document.activeElement?.closest("dialog")?.getAttribute("aria-label"))).toBe("Image viewer");
  }
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(quickView).toBeVisible();
  await expect(zoom).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(quickView).toHaveCount(0);
  await expect(opener).toBeFocused();
});
