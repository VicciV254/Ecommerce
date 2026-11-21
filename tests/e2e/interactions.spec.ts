import type { Page, Request, Route } from "@playwright/test";
import {
  ORIGIN,
  adminSnapshot,
  browserQuote,
  customer,
  expect,
  linenCartLine,
  order,
  orderPage,
  pageOverflow,
  publishedStorefront,
  shopperState,
  signInCustomer,
  signInStaff,
  storefrontDraft,
  test,
} from "./fixtures";
import { linenPair } from "../../src/test-support/checkoutFixtures";
import { fixtureDeliveredOrder } from "../../src/test-support/orderFixtures";

test("search suggestions take arrow selection, and Escape closes the list before clearing the text", async ({ page }) => {
  await page.goto("/#/shop");
  await expect(page.getByRole("heading", { name: "All products", exact: true })).toBeVisible();
  // Phones show the search below the brand row, so it is never only inside the drawer.
  const input = page.getByRole("combobox", { name: "Search products" });
  await input.fill("Linen Short-Sleeve Shirt");
  // Suggestions follow a short pause in typing.
  await expect(page.getByRole("listbox", { name: "Search suggestions" })).toBeVisible();
  await input.press("ArrowDown");
  const first = page.getByRole("option").first();
  await expect(first).toContainText("Linen Short-Sleeve Shirt");
  await expect(first).toContainText("KES 900");
  await expect(input).toHaveAttribute("aria-activedescendant", (await first.getAttribute("id"))!);
  await input.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(input).toHaveValue("Linen Short-Sleeve Shirt");
  await input.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(page).toHaveURL(/#\/product\/prod-linen-shirt$/);
  await expect(page.getByRole("heading", { name: "Linen Short-Sleeve Shirt", exact: true })).toBeVisible();
});

test("icon links have names and desktop modifier-click opens a separate tab", async ({ page, context, isMobile }) => {
  await page.goto("/#/shop");
  const header = page.getByRole("banner");
  // The cart control opens the mini-cart, which links to the full cart page.
  const cart = header.getByRole("button", { name: "Cart", exact: true });
  await expect(cart).toHaveAttribute("aria-haspopup", "dialog");
  await cart.click();
  await expect(page.getByRole("dialog", { name: "Your cart" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(cart).toBeFocused();
  await expect(header.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  const wishlist = header.getByRole("link", { name: "Wishlist", exact: true });
  if (!isMobile) {
    const opened = context.waitForEvent("page");
    await wishlist.click({ modifiers: ["ControlOrMeta"] });
    const tab = await opened;
    await expect(tab).toHaveURL(/#\/wishlist$/);
    await expect(tab.getByRole("heading", { name: "Your wishlist is empty" })).toBeVisible();
    await tab.close();
    await expect(page).toHaveURL(/#\/shop$/);
  }
  await wishlist.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/wishlist$/);
});

test("mobile drawers contain focus, restore it, and adapt from narrow phones to desktop", async ({ page, isMobile }) => {
  test.skip(!isMobile, "The mobile project covers drawer widths and the desktop transition.");
  await page.goto("/#/shop");
  await expect(page.getByRole("heading", { name: "All products", exact: true })).toBeVisible();
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  await menu.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Navigation menu" });
  const close = dialog.getByRole("button", { name: "Close menu" });
  await expect(close).toBeFocused();
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await page.locator('header button[aria-label="Cart"]').evaluate((element: HTMLButtonElement) => element.focus());
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  // The drawer ends with the department list, whose entries open their groups.
  await expect(dialog.locator("a, button").last()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(menu).toBeFocused();
  await menu.click();
  await page.mouse.click(8, 400);
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/#\/shop$/);

  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 640 });
    await menu.click();
    const bounds = await dialog.boundingBox();
    expect(bounds?.width).toBe(width);
    await expect(dialog.locator(".animate-fade-in")).toHaveCSS("animation-name", "none");
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
  }
  await menu.click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(dialog).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const filterButton = page.getByRole("button", { name: "Filters", exact: true });
  await filterButton.focus();
  await page.keyboard.press("Enter");
  const filters = page.getByRole("dialog", { name: "Product filters" });
  await expect(filters.getByRole("button", { name: "Close filters" })).toBeFocused();
  await expect(filters.getByRole("textbox", { name: "Minimum price" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(filterButton).toBeFocused();
  await filterButton.click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(filters).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

test("receipt and cancellation dialogs preserve nested focus and expose a failed operation", async ({ page, context }) => {
  await signInCustomer(page);
  await context.route("**/api/orders?*", (route) => route.fulfill({ json: orderPage([order]) }));
  let capture!: (route: Route) => void;
  const pending = new Promise<Route>((resolve) => { capture = resolve; });
  await context.route("**/api/orders/browser-order/cancel", capture);
  await page.goto("/#/account/orders");
  const details = page.getByRole("button", { name: "Details", exact: true });
  await details.focus();
  await page.keyboard.press("Enter");
  const receipt = page.getByRole("dialog", { name: "Receipt details" });
  await expect(receipt.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await expect(receipt).toContainText("Payment: M-Pesa (pending)");
  // The order is unpaid, so cancelling it offers no refund.
  const cancel = receipt.getByRole("button", { name: "Cancel order", exact: true });
  await cancel.focus();
  await page.keyboard.press("Enter");
  const cancellation = page.getByRole("dialog", { name: "Cancel order", exact: true });
  const reason = cancellation.getByRole("textbox", { name: "Reason for cancellation (optional)" });
  await expect(reason).toBeFocused();
  await reason.fill("Isolated browser test");
  await cancellation.getByRole("button", { name: "Cancel order", exact: true }).click();
  const request = await pending;
  await expect(cancellation.getByRole("button", { name: "Cancelling..." })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(cancellation).toBeVisible();
  await request.fulfill({ status: 503, json: { error: "Cancellation unavailable in this test" } });
  await expect(cancellation.getByRole("alert")).toHaveText("Cancellation unavailable in this test");
  await page.keyboard.press("Escape");
  await expect(cancellation).toHaveCount(0);
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(receipt).toHaveCount(0);
  await expect(details).toBeFocused();
});

test("an unavailable order history is reported instead of shown as empty", async ({ page }) => {
  await signInCustomer(page);
  await page.goto("/#/account/orders");
  await expect(page.getByRole("heading", { name: "Orders are unavailable" })).toBeVisible();
  await expect(page.getByText("No orders yet.")).toHaveCount(0);
});

test("product editor controls remain reachable and save errors are announced inside the modal", async ({ page, context }) => {
  await signInStaff(page);
  const saves: { method: string; body: unknown }[] = [];
  await context.route("**/api/products/prod-linen-shirt", async (route) => {
    if (route.request().method() === "GET") return route.fallback();
    saves.push({ method: route.request().method(), body: route.request().postDataJSON() });
    return route.fulfill({ status: 400, json: { error: "Invalid request", details: [{ path: "price", message: "Number must be greater than 0" }] } });
  });
  await page.goto("/#/admin/catalog/products");
  await expect(page.getByRole("button", { name: `Edit ${adminSnapshot.products.at(-1)!.name}` })).toBeVisible();
  const product = page.getByRole("button", { name: "Edit Linen Short-Sleeve Shirt" });
  await product.focus();
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog", { name: "Edit product", exact: true });
  const close = editor.getByRole("button", { name: "Close product editor" });
  await expect(close).toBeInViewport();
  // A 44px target, as in the read-only product details (it was 32px before the P7 close).
  expect(await close.boundingBox()).toMatchObject({ width: 44, height: 44 });
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Linen Short-Sleeve Shirt");
  const price = editor.getByRole("spinbutton", { name: "Price (KES)" });
  await price.fill("1200.25");
  expect(await price.evaluate((element: HTMLInputElement) => element.validity.stepMismatch)).toBe(false);
  const createCategory = editor.getByRole("button", { name: "Create category" });
  await createCategory.focus();
  await page.keyboard.press("Enter");
  const category = page.getByRole("dialog", { name: "Create new category" });
  await expect(category).toHaveCount(1);
  await expect(category).toBeVisible();
  await expect(category.getByRole("textbox", { name: "Category name" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(category).toHaveCount(0);
  await expect(createCategory).toBeFocused();

  await editor.getByRole("button", { name: "Save product" }).click();
  await expect(editor.getByRole("alert")).toHaveText("Invalid request: price: Number must be greater than 0");
  expect(saves).toHaveLength(1);
  expect(saves[0].method).toBe("PUT");
  expect(saves[0].body).toMatchObject({ name: "Linen Short-Sleeve Shirt", price: 1200.25, categoryId: "cat-shirts" });
  expect(saves[0].body).not.toHaveProperty("variants");
  expect(saves[0].body).not.toHaveProperty("images");
  await page.keyboard.press("Escape");
  // The failed save left the edit unsaved, so closing the editor asks first.
  const guard = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await expect(guard).toContainText("Product editor has unsaved changes.");
  await guard.getByRole("button", { name: "Discard changes" }).click();
  await expect(editor).toHaveCount(0);
  await expect(product).toBeFocused();
});

test("storefront drafts save and publish with versions without leaking to shoppers", async ({ page, context }) => {
  await signInStaff(page);
  const writes: { path: string; body: { version: number; settings?: { brand: { name: string } } } }[] = [];
  let publishedName = publishedStorefront.settings.brand.name;
  let draftVersion = storefrontDraft.version;
  let draftSettings = storefrontDraft.settings;
  await context.route("**/api/settings/storefront/draft", async (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      const body = request.postDataJSON();
      writes.push({ path: "draft", body });
      if (body.version !== draftVersion) return route.fulfill({ status: 409, json: { error: "The storefront changed. Reload before saving your draft." } });
      draftVersion += 1;
      draftSettings = body.settings;
    }
    return route.fulfill({ json: { ...storefrontDraft, version: draftVersion, settings: draftSettings } });
  });
  await context.route("**/api/settings/storefront/publish", async (route) => {
    const body = route.request().postDataJSON();
    writes.push({ path: "publish", body });
    publishedName = draftSettings.brand.name;
    draftVersion += 1;
    return route.fulfill({ json: { ...publishedStorefront, version: draftVersion, settings: draftSettings } });
  });
  await context.route("**/api/settings/storefront", (route) =>
    route.fulfill({ json: { ...publishedStorefront, settings: { ...publishedStorefront.settings, brand: { ...publishedStorefront.settings.brand, name: publishedName } } } }));

  await page.goto("/#/admin/storefront/editor");
  const storeName = page.getByRole("textbox", { name: "Store name" });
  await storeName.fill("Apex Cart Draft");
  // The draft preview is its own page, reached from the editor; returning keeps the edit.
  await page.getByRole("main").getByRole("link", { name: "Draft preview" }).click();
  await expect(page.locator('iframe[title^="Storefront draft at"]').contentFrame().getByText("Apex Cart Draft", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to editor" }).click();
  await expect(storeName).toHaveValue("Apex Cart Draft");
  await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Draft saved" })).toBeVisible();
  expect(writes).toEqual([{ path: "draft", body: expect.objectContaining({ version: 5 }) }]);
  expect(writes[0].body.settings?.brand.name).toBe("Apex Cart Draft");

  const shopper = await context.newPage();
  await shopper.goto("/");
  await expect(shopper.getByRole("banner").getByRole("link", { name: "Apex Cart", exact: true })).toBeVisible();
  await expect(shopper.getByText("Apex Cart Draft")).toHaveCount(0);

  const reloads: Request[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/settings/storefront") reloads.push(request); });
  await page.getByRole("button", { name: "Publish" }).click();
  await expect.poll(() => writes.at(-1)).toEqual({ path: "publish", body: { version: 6 } });
  await expect.poll(() => reloads.length).toBeGreaterThan(0);
  await shopper.reload();
  await expect(shopper.getByRole("banner").getByRole("link", { name: "Apex Cart Draft", exact: true })).toBeVisible();
  await shopper.close();
});

test("checkout explains unavailable ordering, creates no order and preserves the cart", async ({ page, context }) => {
  await signInCustomer(page, [linenCartLine]);
  const legacyReceipts = JSON.stringify([{ orderNumber: "NM-LEGACY", status: "DELIVERED", paymentStatus: "PAID" }]);
  await context.addInitScript(({ key, value, origin }) => {
    if (location.origin === origin) localStorage.setItem(key, value);
  }, { key: `nmb-receipts-${customer.id}`, value: legacyReceipts, origin: ORIGIN });
  // The server quote reports that order reservations are switched off.
  await context.route("**/api/orders/quotes", (route) => route.fulfill({ status: 201, json: browserQuote({ reservationsEnabled: false }) }));
  const writes: string[] = [];
  page.on("request", (request) => { if (request.method() !== "GET") writes.push(new URL(request.url()).pathname); });
  await page.goto("/#/checkout");
  await expect(page.getByRole("heading", { name: "Ordering is not available yet" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Your cart is unchanged" })).toBeVisible();
  await expect(page.locator("main input")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Reserve|Place Order|Confirm Payment|Pay/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Back to cart", exact: true }).click();
  await expect(page.getByRole("link", { name: "Linen Short-Sleeve Shirt", exact: true })).toBeVisible();
  await expect(page.getByText("Size: M · Color: White")).toBeVisible();
  const proceed = page.getByRole("button", { name: "Continue to checkout" });
  await expect(proceed).toBeDisabled();
  await expect(proceed).toHaveAccessibleDescription(/Ordering is not available yet/);
  expect((await shopperState(page)).cart).toEqual([linenCartLine]);
  expect(await page.evaluate((key) => localStorage.getItem(key), `nmb-receipts-${customer.id}`)).toBe(legacyReceipts);
  expect(writes.length).toBeGreaterThan(0);
  expect(writes.filter((path) => path !== "/api/orders/quotes")).toEqual([]);
});

test("cart edits re-quote the whole cart and keep every line editable", async ({ page, context }) => {
  await signInCustomer(page, [linenCartLine]);
  const quoted: { items: { quantity: number }[] }[] = [];
  await context.route("**/api/orders/quotes", async (route) => {
    const body = route.request().postDataJSON();
    quoted.push(body);
    return route.fulfill({ status: 201, json: body.items[0].quantity === 2 ? browserQuote({ id: "quote-two", ...linenPair }) : browserQuote() });
  });
  await page.goto("/#/cart");
  const summary = page.getByRole("region", { name: "Order summary" });
  await expect(summary.getByText("KES 1,244")).toBeVisible();
  const increase = page.getByRole("button", { name: "Increase quantity of Linen Short-Sleeve Shirt" });
  await increase.click();
  await expect.poll(async () => (await shopperState(page)).cart[0].quantity).toBe(2);
  await expect(increase).toBeDisabled();
  await expect(summary.getByText("KES 2,288")).toBeVisible();
  await expect(summary.getByText("KES 1,244")).toHaveCount(0);
  expect(quoted.at(-1)?.items).toEqual([{ ...linenCartLine, quantity: 2 }]);
  await page.getByRole("button", { name: "Decrease quantity of Linen Short-Sleeve Shirt" }).click();
  await expect(summary.getByText("KES 1,244")).toBeVisible();
  await page.getByRole("link", { name: "Continue shopping", exact: true }).click();
  await expect(page).toHaveURL(/#\/shop$/);
});

test("empty checkout retains the route back to shopping", async ({ page }) => {
  await page.goto("/#/checkout");
  await expect(page.getByRole("heading", { name: "Your cart is empty" })).toBeVisible();
  await page.getByRole("link", { name: "Go shopping", exact: true }).click();
  await expect(page).toHaveURL(/#\/shop$/);
});

test("return failure feedback stays in the active return dialog and keeps the same request for a retry", async ({ page, context }) => {
  await signInCustomer(page);
  const delivered = fixtureDeliveredOrder(order);
  await context.route("**/api/orders?*", (route) => route.fulfill({ json: orderPage([delivered]) }));
  const keys: (string | undefined)[] = [];
  await context.route("**/api/orders/browser-order/returns", (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    return route.fulfill({ status: 503, json: { error: "Return unavailable in this test" } });
  });
  await page.goto("/#/account/orders");
  await page.getByRole("button", { name: "Details", exact: true }).click();
  const receipt = page.getByRole("dialog", { name: "Receipt details" });
  await receipt.getByRole("button", { name: "Request a return", exact: true }).click();
  const returnForm = page.getByRole("dialog", { name: "Request a return", exact: true });
  await returnForm.getByRole("button", { name: "Return one more Linen Short-Sleeve Shirt" }).click();
  await returnForm.getByRole("combobox", { name: "Reason for return" }).selectOption({ label: "Arrived damaged" });
  await returnForm.getByRole("button", { name: "Submit return request" }).click();
  // The outcome is unknown, so the message stays in the active dialog with the same request offered again.
  await expect(returnForm.getByRole("alert")).toHaveText(/We could not confirm whether your return request was received\./);
  await returnForm.getByRole("button", { name: "Retry the same request" }).click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[1]).toBe(keys[0]);
  // Settled again (not sending), and still unresolved after the second unknown outcome.
  await expect(returnForm.getByRole("button", { name: "Retry the same request" })).toHaveAttribute("aria-disabled", "false");
  await expect(returnForm.getByRole("alert")).toHaveText(/We could not confirm whether your return request was received\./);
  await page.keyboard.press("Escape");
  await expect(returnForm).toHaveCount(0);
  await expect(receipt).toBeVisible();
});

test("password visibility can be reached and changed using the keyboard", async ({ page }) => {
  await page.goto("/#/login");
  const password = page.locator('input[type="password"]');
  await password.focus();
  await page.keyboard.press("Tab");
  const toggle = page.getByRole("button", { name: "Show password" });
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
});

/** Scrolls the window by `delta` at once, then lets two frames pass so the page can react. */
async function scrollPageBy(page: Page, delta: number) {
  await page.evaluate((top) => window.scrollBy({ top, behavior: "instant" }), delta);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Goes `screens` screens down the page, then a little back up: the gesture that offers "Back to top". */
async function scrollDownThenUp(page: Page, screens: number) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  const height = await page.evaluate(() => window.innerHeight);
  for (let step = 0; step < screens * 2; step += 1) await scrollPageBy(page, height / 2);
  await scrollPageBy(page, -200);
}

test("back to top appears only while scrolling up a long page, and returns the page and keyboard focus to the top", async ({ page }) => {
  await page.goto("/#/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const back = page.getByRole("button", { name: "Back to top" });
  const height = await page.evaluate(() => window.innerHeight);
  expect(await page.evaluate(() => document.documentElement.scrollHeight), "a page several screens long").toBeGreaterThan(height * 3);
  /** Whether a script can give it focus: never while it is hidden. */
  const focusable = () => page.locator("[data-back-to-top]").evaluate((element: HTMLElement) => {
    element.focus();
    const focused = document.activeElement === element;
    element.blur();
    return focused;
  });

  for (let step = 0; step < 6; step += 1) await scrollPageBy(page, height / 2);
  await expect(back, "scrolling down").toBeHidden();
  await scrollPageBy(page, -200);
  await expect(back, "scrolling up").toBeVisible();
  const box = (await back.boundingBox())!;
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  expect(Math.min(box.width, box.height), "a whole touch target").toBeGreaterThanOrEqual(44);
  expect(width - (box.x + box.width), "clear of the right edge").toBeGreaterThanOrEqual(12);
  expect(height - (box.y + box.height), "clear of the bottom edge").toBeGreaterThanOrEqual(12);
  await scrollPageBy(page, 150);
  await expect(back, "down again").toBeHidden();
  await expect(back, "out of the accessibility tree while hidden").toHaveCount(0);
  expect(await focusable(), "and out of reach of focus").toBe(false);

  // Enter takes the page to the top and focus to its first control, the store's home link.
  await scrollPageBy(page, -200);
  await expect(back).toBeVisible();
  await back.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("banner").getByRole("link", { name: "Apex Cart", exact: true })).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(back).toBeHidden();
  // A short scroll from the top never offers it.
  await scrollPageBy(page, height / 2);
  await scrollPageBy(page, -100);
  await expect(back).toBeHidden();
});

test("back to top steps aside at once for focus it covers, so the focused control takes a tap straight away", async ({ page }) => {
  await page.goto("/#/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const back = page.getByRole("button", { name: "Back to top" });
  await scrollDownThenUp(page, 3);
  await expect(back).toBeVisible();
  // A control under the button (a form's last button in the screen's corner) takes focus; a moment later, while the
  // button is still fading out, a tap there must reach the control.
  const reached = await page.locator("[data-back-to-top]").evaluate((button) => {
    const box = button.getBoundingClientRect();
    const control = document.createElement("button");
    control.textContent = "Covered";
    control.style.cssText = `position: fixed; left: ${box.left}px; top: ${box.top}px; width: ${box.width}px; height: ${box.height}px; z-index: 1;`;
    document.body.append(control);
    control.focus();
    return new Promise<string>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      control.remove();
      resolve(target === control ? "the control" : target?.closest("[data-back-to-top]") ? "Back to top" : String(target?.tagName));
    })));
  });
  expect(reached, "what a tap on the covered control reaches while Back to top fades out").toBe("the control");
  await expect(back).toBeHidden();
});

test("back to top glides to the top, or jumps there for shoppers who prefer reduced motion", async ({ page }) => {
  await page.goto("/#/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const back = page.getByRole("button", { name: "Back to top" });
  for (const motion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion: motion });
    await scrollDownThenUp(page, 3);
    await expect(back).toBeVisible();
    await back.click();
    const soon = await page.evaluate(() => new Promise<number>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.scrollY)));
    }));
    if (motion === "reduce") expect(soon, "reduced motion: at once").toBe(0);
    else expect(soon, "on its way up").toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  }
});

test("back to top names itself on hover and keyboard focus, whole even at 360px with doubled text", async ({ page, isMobile }) => {
  if (isMobile) await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/#/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const back = page.getByRole("button", { name: "Back to top" });
  const label = back.getByText("Back to top", { exact: true });
  const widthOf = async () => (await back.boundingBox())!.width;
  const whole = async (state: string) => {
    await expect.poll(widthOf, `${state}: opened`).toBeGreaterThan(100);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
    const [button, text] = [(await back.boundingBox())!, (await label.boundingBox())!];
    const width = await page.evaluate(() => document.documentElement.clientWidth);
    expect(text.x, `${state}: the label starts inside the button`).toBeGreaterThanOrEqual(button.x - 0.5);
    expect(text.x + text.width, `${state}: and ends inside it`).toBeLessThanOrEqual(button.x + button.width + 0.5);
    expect(button.x, `${state}: on screen`).toBeGreaterThanOrEqual(0);
    expect(button.x + button.width, `${state}: on screen`).toBeLessThanOrEqual(width);
    expect(await pageOverflow(page), `${state}: page overflow`).toBeLessThanOrEqual(0);
  };
  for (const size of ["", "200%"]) {
    const text = size || "100%";
    await page.evaluate((value) => { document.documentElement.style.fontSize = value; }, size);
    await scrollDownThenUp(page, 3);
    await expect(back).toBeVisible();
    await expect.poll(widthOf, `${text}: just the arrow`).toBeLessThan(60);
    if (!isMobile) {
      await back.hover();
      await whole(`hover at ${text}`);
      await page.mouse.move(5, 5);
      await expect.poll(widthOf).toBeLessThan(60);
    }
    await page.keyboard.press("Shift");
    await back.focus();
    await whole(`keyboard focus at ${text}`);
    await back.blur();
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
});

test("back to top stays distinct over the navy footer, also with keyboard focus (WCAG 1.4.11)", async ({ page }) => {
  await page.goto("/#/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const back = page.getByRole("button", { name: "Back to top" });
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await scrollPageBy(page, 0);
  await scrollPageBy(page, -60);
  await expect(back).toBeVisible();
  await page.waitForTimeout(400);
  /** The best contrast of the button's edge or fill against what lies behind its middle, and what that is. */
  const distinct = () => back.evaluate((button: HTMLElement) => {
    const channels = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = (value: string) => {
      const [r, g, b] = channels(value).slice(0, 3).map((channel) => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (high + 0.05) / (low + 0.05);
    };
    const opaque = (value: string) => (channels(value)[3] ?? 1) > 0.5;
    const box = button.getBoundingClientRect();
    let behind = document.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2).find((element) => !button.contains(element)) ?? null;
    while (behind && !opaque(getComputedStyle(behind).backgroundColor)) behind = behind.parentElement;
    const backdrop = behind ? getComputedStyle(behind).backgroundColor : "rgb(255, 255, 255)";
    const style = getComputedStyle(button);
    const edges = [style.borderTopColor, style.backgroundColor].filter(opaque);
    return {
      overFooter: Boolean(behind?.closest("footer")),
      contrast: Math.max(0, ...edges.map((edge) => ratio(edge, backdrop))),
      fill: style.backgroundColor,
    };
  });
  const resting = await distinct();
  expect(resting.overFooter, "the button sits over the footer").toBe(true);
  expect(resting.contrast, "its edge or fill against the footer").toBeGreaterThanOrEqual(3);
  await page.keyboard.press("Shift");
  await back.focus();
  await page.waitForTimeout(400);
  expect((await distinct()).contrast, "with keyboard focus").toBeGreaterThanOrEqual(3);
  // Keyboard focus changes the fill itself, so it shows even where the ring is faint against the navy.
  const focusChange = await back.evaluate((button: HTMLElement, resting: string) => {
    const luminance = (value: string) => {
      const [r, g, b] = (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((channel) => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [high, low] = [luminance(getComputedStyle(button).backgroundColor), luminance(resting)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  }, resting.fill);
  expect(focusChange, "focused fill against the resting fill").toBeGreaterThanOrEqual(3);
});
