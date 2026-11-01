import type { Request, Route } from "@playwright/test";
import {
  ORIGIN,
  adminSnapshot,
  browserQuote,
  customer,
  expect,
  linenCartLine,
  order,
  publishedStorefront,
  shopperState,
  signInCustomer,
  signInStaff,
  storefrontDraft,
  test,
} from "./fixtures";
import { linenPair } from "../../src/test-support/checkoutFixtures";

test("search supports arrow selection and Escape before dismissing its mobile drawer", async ({ page, isMobile }) => {
  await page.goto("/#/shop");
  await expect(page.getByRole("heading", { name: "All Products", exact: true })).toBeVisible();
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (isMobile) {
    await menu.focus();
    await page.keyboard.press("Enter");
  }
  const input = page.getByRole("combobox", { name: "Search products" });
  await input.fill("Linen Short-Sleeve Shirt");
  await input.press("ArrowDown");
  const first = page.getByRole("option").first();
  await expect(first).toContainText("Linen Short-Sleeve Shirt");
  await expect(first).toContainText("KES 900");
  await expect(input).toHaveAttribute("aria-activedescendant", (await first.getAttribute("id"))!);
  await input.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  if (isMobile) await expect(page.getByRole("dialog", { name: "Navigation menu" })).toBeVisible();
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(page).toHaveURL(/#\/product\/prod-linen-shirt$/);
  await expect(page.getByRole("heading", { name: "Linen Short-Sleeve Shirt", exact: true })).toBeVisible();
  if (isMobile) await expect(menu).toBeFocused();
});

test("icon links have names and desktop modifier-click opens a separate tab", async ({ page, context, isMobile }) => {
  await page.goto("/#/shop");
  const header = page.getByRole("banner");
  await expect(header.getByRole("link", { name: "Cart", exact: true })).toHaveAttribute("href", "#/cart");
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
  await expect(page.getByRole("heading", { name: "All Products", exact: true })).toBeVisible();
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  await menu.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Navigation menu" });
  const close = dialog.getByRole("button", { name: "Close menu" });
  await expect(close).toBeFocused();
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await page.locator('header a[href="#/cart"]').evaluate((element: HTMLAnchorElement) => element.focus());
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.locator("a").last()).toBeFocused();
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
  await expect(filters.getByRole("slider")).toHaveAccessibleName(/price/i);
  await page.keyboard.press("Escape");
  await expect(filterButton).toBeFocused();
  await filterButton.click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(filters).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

test("receipt and cancellation dialogs preserve nested focus and expose a failed operation", async ({ page, context }) => {
  await signInCustomer(page);
  await context.route("**/api/orders?*", (route) => route.fulfill({ json: { orders: [order], pagination: { page: 1, limit: 100, total: 1, pages: 1 } } }));
  let capture!: (route: Route) => void;
  const pending = new Promise<Route>((resolve) => { capture = resolve; });
  await context.route("**/api/orders/browser-order/cancel", capture);
  await page.goto("/#/account/orders");
  const details = page.getByRole("button", { name: "Details", exact: true });
  await details.focus();
  await page.keyboard.press("Enter");
  const receipt = page.getByRole("dialog", { name: "Receipt Details" });
  await expect(receipt.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await expect(receipt).toContainText("Payment: M-Pesa (pending)");
  // The order is unpaid, so cancelling it offers no refund.
  const cancel = receipt.getByRole("button", { name: "Cancel Order", exact: true });
  await cancel.focus();
  await page.keyboard.press("Enter");
  const cancellation = page.getByRole("dialog", { name: "Cancel Order", exact: true });
  const reason = cancellation.getByRole("textbox", { name: "Reason for cancellation (optional)" });
  await expect(reason).toBeFocused();
  await reason.fill("Isolated browser test");
  await cancellation.getByRole("button", { name: "Cancel Order", exact: true }).click();
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
  await page.goto("/#/admin");
  await page.getByRole("button", { name: "Catalog", exact: true }).click();
  await expect(page.getByRole("button", { name: `Edit ${adminSnapshot.products.at(-1)!.name}` })).toBeVisible();
  const product = page.getByRole("button", { name: "Edit Linen Short-Sleeve Shirt" });
  await product.focus();
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog", { name: "Edit product", exact: true });
  const close = editor.getByRole("button", { name: "Close product editor" });
  await expect(close).toBeInViewport();
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Linen Short-Sleeve Shirt");
  const price = editor.getByRole("spinbutton", { name: "Price (KES)" });
  await price.fill("1200.25");
  expect(await price.evaluate((element: HTMLInputElement) => element.validity.stepMismatch)).toBe(false);
  const createCategory = editor.getByRole("button", { name: "Create category" });
  await createCategory.focus();
  await page.keyboard.press("Enter");
  const category = page.getByRole("dialog", { name: "Create New Category" });
  await expect(category).toHaveCount(1);
  await expect(category).toBeVisible();
  await expect(category.getByRole("textbox", { name: "Category Name" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(category).toHaveCount(0);
  await expect(createCategory).toBeFocused();

  await editor.getByRole("button", { name: "Save Product" }).click();
  await expect(editor.getByRole("alert")).toHaveText("Invalid request: price: Number must be greater than 0");
  expect(saves).toHaveLength(1);
  expect(saves[0].method).toBe("PUT");
  expect(saves[0].body).toMatchObject({ name: "Linen Short-Sleeve Shirt", price: 1200.25, categoryId: "cat-shirts" });
  expect(saves[0].body).not.toHaveProperty("variants");
  expect(saves[0].body).not.toHaveProperty("images");
  await page.keyboard.press("Escape");
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

  await page.goto("/#/admin");
  await page.getByRole("button", { name: "Storefront", exact: true }).click();
  const storeName = page.getByRole("textbox", { name: "Store name" });
  await storeName.fill("Apex Cart Draft");
  await page.getByRole("button", { name: "Preview Draft" }).click();
  await expect(page.getByRole("region", { name: "Draft preview" })).toContainText("Apex Cart Draft");
  await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();
  await page.getByRole("button", { name: "Save Draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Draft saved" })).toBeVisible();
  expect(writes).toEqual([{ path: "draft", body: expect.objectContaining({ version: 5 }) }]);
  expect(writes[0].body.settings?.brand.name).toBe("Apex Cart Draft");

  const shopper = await context.newPage();
  await shopper.goto("/");
  await expect(shopper.getByRole("link", { name: "Apex Cart home" }).first()).toBeVisible();
  await expect(shopper.getByText("Apex Cart Draft")).toHaveCount(0);

  const reloads: Request[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/settings/storefront") reloads.push(request); });
  await page.getByRole("button", { name: "Publish" }).click();
  await expect.poll(() => writes.at(-1)).toEqual({ path: "publish", body: { version: 6 } });
  await expect.poll(() => reloads.length).toBeGreaterThan(0);
  await shopper.reload();
  await expect(shopper.getByRole("link", { name: "Apex Cart Draft home" }).first()).toBeVisible();
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
  await page.getByRole("link", { name: "Back to Cart", exact: true }).click();
  await expect(page.getByRole("link", { name: "Linen Short-Sleeve Shirt", exact: true })).toBeVisible();
  await expect(page.getByText("Size: M · Color: White")).toBeVisible();
  const proceed = page.getByRole("button", { name: "Continue to Checkout" });
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
  const summary = page.getByRole("region", { name: "Order Summary" });
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
  await page.getByRole("link", { name: "Continue Shopping", exact: true }).click();
  await expect(page).toHaveURL(/#\/shop$/);
});

test("empty checkout retains the route back to shopping", async ({ page }) => {
  await page.goto("/#/checkout");
  await expect(page.getByRole("heading", { name: "Your cart is empty" })).toBeVisible();
  await page.getByRole("link", { name: "Go Shopping", exact: true }).click();
  await expect(page).toHaveURL(/#\/shop$/);
});

test("return failure feedback stays in the active receipt dialog", async ({ page, context }) => {
  await signInCustomer(page);
  await context.route("**/api/orders?*", (route) => route.fulfill({ json: { orders: [{ ...order, status: "DELIVERED" }], pagination: { page: 1, limit: 100, total: 1, pages: 1 } } }));
  await context.route("**/api/orders/browser-order/return", (route) => route.fulfill({ status: 503, json: { error: "Return unavailable in this test" } }));
  await page.goto("/#/account/orders");
  await page.getByRole("button", { name: "Details", exact: true }).click();
  const receipt = page.getByRole("dialog", { name: "Receipt Details" });
  await receipt.getByRole("button", { name: "Return", exact: true }).click();
  const returnForm = page.getByRole("dialog", { name: "Return Order", exact: true });
  await returnForm.getByPlaceholder("Please explain why you want to return this order...").fill("Isolated return test");
  await returnForm.getByRole("button", { name: "Submit Return" }).click();
  await expect(returnForm).toHaveCount(0);
  await expect(receipt.getByRole("status")).toHaveText("Return unavailable in this test");
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
