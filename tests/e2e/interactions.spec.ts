import type { Request, Route } from "@playwright/test";
import {
  ORIGIN,
  adminSnapshot,
  browserQuote,
  customer,
  expect,
  linenCartLine,
  order,
  orderPage,
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
  await expect(page.getByRole("region", { name: "Draft preview" })).toContainText("Apex Cart Draft");
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
