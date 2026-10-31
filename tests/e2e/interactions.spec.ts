import type { Route } from "@playwright/test";
import { customer, expect, order, signInCustomer, test } from "./fixtures";

test("search supports arrow selection and Escape before dismissing its mobile drawer", async ({ page, isMobile }) => {
  await page.goto("/#/shop");
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
  await expect(input).toHaveAttribute("aria-activedescendant", (await first.getAttribute("id"))!);
  await input.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  if (isMobile) await expect(page.getByRole("dialog", { name: "Navigation menu" })).toBeVisible();
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(page).toHaveURL(/#\/product\/mens-fashion-1$/);
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
  await context.route("**/api/orders?*", (route) => route.fulfill({ json: { orders: [order] } }));
  let capture!: (route: Route) => void;
  const pending = new Promise<Route>((resolve) => { capture = resolve; });
  await context.route("**/api/orders/browser-order/cancel", capture);
  await page.goto("/#/account/orders");
  const details = page.getByRole("button", { name: "Details", exact: true });
  await details.focus();
  await page.keyboard.press("Enter");
  const receipt = page.getByRole("dialog", { name: "Receipt Details" });
  await expect(receipt.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  const cancel = receipt.getByRole("button", { name: "Cancel & Refund" });
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

test("product editor controls remain reachable and save errors are announced inside the modal", async ({ page, context }) => {
  await context.addInitScript(() => {
    localStorage.setItem("adminToken", "browser-only-staff-token");
    localStorage.setItem("adminUser", JSON.stringify({ id: "browser-admin", email: "admin@example.test", username: "Browser staff", role: "ADMIN" }));
  });
  await page.goto("/#/admin");
  await page.getByRole("button", { name: "Catalog", exact: true }).click();
  const product = page.getByRole("button", { name: /Linen Short-Sleeve Shirt/ });
  await product.focus();
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog", { name: "Edit product", exact: true });
  const close = editor.getByRole("button", { name: "Close product editor" });
  await expect(close).toBeInViewport();
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Linen Short-Sleeve Shirt");
  await editor.getByRole("spinbutton", { name: "Price (KES)" }).fill("1000");
  await editor.getByRole("button", { name: "Apply", exact: true }).click();
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
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(product).toBeFocused();
  const save = page.getByRole("button", { name: "Save Changes", exact: true });
  await save.click();
  const confirmation = page.getByRole("dialog", { name: "Save Changes?" });
  await confirmation.getByRole("button", { name: "Yes, Save" }).click();
  await expect(confirmation.getByRole("status")).toContainText("Could not publish changes");
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(save).toBeFocused();
});

test("paused checkout creates no orders or receipts and preserves the cart", async ({ page, context }) => {
  await signInCustomer(page, true);
  const receiptsKey = `nmb-receipts-${customer.id}`;
  const history = JSON.stringify([{
    ...order,
    updatedAt: order.createdAt,
    address: {
      name: "Browser Customer", email: customer.email, phone: customer.phone,
      address: "Test street", city: "Mombasa", county: "Mombasa",
    },
  }]);
  await context.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: receiptsKey, value: history });
  const writes: string[] = [];
  page.on("request", (request) => { if (request.method() !== "GET") writes.push(request.url()); });
  await page.goto("/#/checkout");
  await expect(page.getByRole("heading", { name: "Checkout temporarily unavailable" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Your cart is unchanged");
  await expect(page.locator("main input")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Place Order|Confirm Payment/ })).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), receiptsKey)).toBe(history);
  await page.getByRole("link", { name: "Back to Cart", exact: true }).click();
  await expect(page.getByRole("link", { name: "Linen Short-Sleeve Shirt", exact: true })).toBeVisible();
  const cart = await page.evaluate((id) => JSON.parse(localStorage.getItem(`nmb-store:${id}`)!).cart, customer.id);
  expect(cart).toEqual([{ productId: "mens-fashion-1", qty: 1 }]);
  expect(writes).toEqual([]);
});

test("cart editing remains available while the checkout action is disabled", async ({ page }) => {
  await signInCustomer(page, true);
  await page.goto("/#/cart");
  const checkout = page.getByRole("button", { name: "Checkout temporarily unavailable" });
  await expect(checkout).toBeDisabled();
  await expect(checkout).toHaveAccessibleDescription(/verified payment processing/);
  await page.getByRole("button", { name: "+", exact: true }).click();
  await expect.poll(() => page.evaluate((id) => JSON.parse(localStorage.getItem(`nmb-store:${id}`)!).cart[0].qty, customer.id)).toBe(2);
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
  await context.route("**/api/orders?*", (route) => route.fulfill({ json: { orders: [{ ...order, status: "DELIVERED" }] } }));
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
