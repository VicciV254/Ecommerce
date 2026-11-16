import type { Locator, Page } from "@playwright/test";
import { linenShirt, poloShirt } from "../../src/test-support/catalogFixtures";
import { STORAGE_KEYS, shopperStateKey } from "../../src/utils/storage";
import {
  ORIGIN,
  customer,
  expect,
  otherCustomer,
  pageOverflow,
  serveSignIn,
  shopperState,
  signInWithForm,
  tabThroughRings,
  test,
} from "./fixtures";

const linenM = { productId: linenShirt.id, variantId: "var-linen-m-white", quantity: 1 };
const linenBlue = { productId: linenShirt.id, variantId: "var-linen-m-blue", quantity: 1 };
const polo = { productId: poloShirt.id, variantId: "var-polo", quantity: 1 };

/** Seeds browser storage once per test (not on every reload): the guest cart and any account carts. */
async function seedCarts(page: Page, carts: Record<string, unknown[]>) {
  await page.context().addInitScript(({ entries, origin }) => {
    if (location.origin !== origin || sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    for (const [key, cart] of Object.entries(entries)) localStorage.setItem(key, JSON.stringify({ cart, wishlist: [] }));
  }, { entries: Object.fromEntries(Object.entries(carts).map(([owner, cart]) => [shopperStateKey(owner === "guest" ? null : owner), cart])), origin: ORIGIN });
}

/** What a cart view shows: each line's name, options, quantity and line subtotal, then the estimated subtotal. */
async function cartView(scope: Locator, list: string) {
  const lines = await scope.getByRole("list", { name: list }).getByRole("listitem").evaluateAll((items) => items
    .filter((item) => item.querySelector("[data-remove-key]"))
    .map((item) => [
      item.querySelector("a")?.textContent ?? "",
      item.querySelector("a + p, a ~ p")?.textContent ?? "",
      (item.querySelector("input") as HTMLInputElement).value,
      item.querySelector("span.tabular-nums")?.textContent ?? "",
    ]));
  const subtotal = await scope.getByText("Subtotal (excl. VAT)").evaluate((term) => term.nextElementSibling?.textContent);
  return { lines, subtotal };
}

/** Adds a single-SKU product from the shirts listing, then closes the mini-cart that opens. */
async function addFromListing(page: Page, name: string) {
  await page.getByRole("listitem").filter({ hasText: name }).getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByRole("dialog", { name: "Your cart" })).toBeVisible();
  await page.keyboard.press("Escape");
}

const openMiniCart = async (page: Page) => {
  await page.getByRole("banner").getByRole("button", { name: "Cart", exact: true }).click();
  return page.getByRole("dialog", { name: "Your cart" });
};

test("the mini-cart and the cart page agree after adding, removing, undoing, changing a quantity and reloading", async ({ page }) => {
  await page.goto("/#/shop?cat=shirts");
  await page.getByRole("listitem").filter({ hasText: poloShirt.name }).getByRole("button", { name: "Add to cart" }).click();
  const drawer = page.getByRole("dialog", { name: "Your cart" });
  // Opening moves focus to the drawer's heading.
  await expect(drawer.getByRole("heading", { name: "Your cart (1 item)" })).toBeFocused();
  await expect(drawer.getByRole("status").filter({ hasText: "Added Cotton Polo Shirt to your cart." })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);

  await page.goto(`/#/product/${linenShirt.id}`);
  await page.getByRole("button", { name: "M", exact: true }).click();
  await page.getByRole("button", { name: "White", exact: true }).click();
  await page.getByRole("button", { name: "Increase quantity", exact: true }).click();
  const add = page.getByRole("main").getByRole("button", { name: "Add to cart", exact: true }).first();
  await add.click();
  await expect(drawer.getByRole("heading", { name: "Your cart (3 items)" })).toBeFocused();
  const afterAdd = await cartView(drawer, "Items in your cart");
  expect(afterAdd).toEqual({
    lines: [["Cotton Polo Shirt", "", "1", "KES 2,200"], ["Linen Short-Sleeve Shirt", "Size: M · Color: White", "2", "KES 1,800"]],
    subtotal: "KES 4,000",
  });
  await expect(drawer.getByText("Calculated at checkout")).toBeVisible();
  await page.keyboard.press("Escape");
  // Closing returns focus to the control that opened it.
  await expect(add).toBeFocused();

  await page.getByRole("banner").getByRole("button", { name: "Cart", exact: true }).click();
  await drawer.getByRole("link", { name: "View cart" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your cart" })).toBeVisible();
  const cartPage = page.getByRole("main");
  expect(await cartView(cartPage, "Cart items")).toEqual(afterAdd);

  // Remove in the drawer: focus lands on Undo, which puts the line back in place.
  await openMiniCart(page);
  await drawer.getByRole("button", { name: "Remove Cotton Polo Shirt from cart" }).click();
  const undo = drawer.getByRole("button", { name: "Undo removing Cotton Polo Shirt" });
  await expect(undo).toBeFocused();
  const removed = await cartView(drawer, "Items in your cart");
  expect(removed).toEqual({ lines: [afterAdd.lines[1]], subtotal: "KES 1,800" });
  await undo.click();
  await expect(drawer.getByRole("button", { name: "Remove Cotton Polo Shirt from cart" })).toBeFocused();
  expect(await cartView(drawer, "Items in your cart")).toEqual(afterAdd);
  await page.keyboard.press("Escape");

  // Change a quantity on the page, then compare both again, and after a reload.
  await cartPage.getByRole("button", { name: "Decrease quantity of Linen Short-Sleeve Shirt" }).click();
  const changed = await cartView(cartPage, "Cart items");
  expect(changed.subtotal).toBe("KES 3,100");
  expect(await cartView(await openMiniCart(page), "Items in your cart")).toEqual(changed);
  await page.keyboard.press("Escape");
  await page.reload();
  expect(await cartView(cartPage, "Cart items")).toEqual(changed);
  expect(await cartView(await openMiniCart(page), "Items in your cart")).toEqual(changed);
  await expect(page.getByRole("banner").getByRole("button", { name: "Cart", exact: true })).toHaveText(/^2/);

  // Removing on the page keeps focus too, and Undo is in the removed line's place.
  await page.keyboard.press("Escape");
  await cartPage.getByRole("button", { name: "Remove Cotton Polo Shirt from cart" }).click();
  await expect(cartPage.getByRole("button", { name: "Undo removing Cotton Polo Shirt" })).toBeFocused();
});

test("a guest's cart joins the account on sign-in: summed, clamped, unavailable lines left out, and reported once", async ({ page, context }) => {
  await serveSignIn(context);
  // Earlier in this guest session a blue linen shirt went into the cart; it has since sold out. The account already
  // holds one white linen shirt.
  await seedCarts(page, { guest: [linenBlue], [customer.id]: [linenM] });
  await page.goto(`/#/product/${linenShirt.id}`);
  // The guest adds both remaining white linen shirts and a polo.
  await page.getByRole("button", { name: "M", exact: true }).click();
  await page.getByRole("button", { name: "White", exact: true }).click();
  await page.getByRole("button", { name: "Increase quantity", exact: true }).click();
  await page.getByRole("main").getByRole("button", { name: "Add to cart", exact: true }).first().click();
  const drawer = page.getByRole("dialog", { name: "Your cart" });
  await expect(drawer.getByText("Out of stock. Remove it to continue.")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("region", { name: /^More in/ }).locator(".product-grid > *").filter({ hasText: poloShirt.name })
    .getByRole("button", { name: "Add to cart" }).click();
  await expect(drawer.getByRole("heading", { name: "Your cart (4 items)" })).toBeFocused();
  // Guests check out by signing in first, then come back to checkout.
  await drawer.getByRole("link", { name: "Checkout" }).click();
  await expect(page).toHaveURL(/#\/login\?returnTo=%2Fcheckout$/);
  await signInWithForm(page, customer);
  await expect(page).toHaveURL(/#\/checkout$/);

  const report = page.getByRole("region", { name: "Your guest cart" });
  await expect(report).toBeVisible();
  await expect(report).toContainText("Cotton Polo Shirt: 1 added, 1 in your cart.");
  await expect(report).toContainText("Linen Short-Sleeve Shirt (Size: M · Color: White): only 2 available, so your cart now has 2.");
  await expect(report).toContainText("Linen Short-Sleeve Shirt (Size: M · Color: Blue): sold out.");
  expect((await shopperState(page, customer.id)).cart).toEqual([{ ...linenM, quantity: 2 }, polo]);
  expect((await shopperState(page, null)).cart).toEqual([]);
  await expect(page.getByRole("banner").getByRole("button", { name: "Cart", exact: true })).toHaveText(/^3/);

  // The sign-in page was replaced: Back leaves checkout for the product page. The report does not come back.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`#/product/${linenShirt.id}$`));
  await expect(report).toHaveCount(0);
  await page.reload();
  expect((await shopperState(page, customer.id)).cart).toEqual([{ ...linenM, quantity: 2 }, polo]);
  await expect(report).toHaveCount(0);
});

test("a second account on the same browser receives nothing from the first", async ({ page, context }) => {
  await serveSignIn(context);
  await seedCarts(page, { guest: [polo] });
  await page.goto("/#/login");
  await signInWithForm(page, customer);
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("region", { name: "Your guest cart" })).toContainText("Cotton Polo Shirt: 1 added");
  expect((await shopperState(page, customer.id)).cart).toEqual([polo]);

  await page.goto("/#/account");
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page).toHaveURL(/#\/login$/);
  // Signing out copies nothing into the guest cart.
  expect((await shopperState(page, null)).cart).toEqual([]);
  await expect(page.getByRole("banner").getByRole("button", { name: "Cart", exact: true })).toHaveText("");

  await signInWithForm(page, otherCustomer);
  await expect(page).toHaveURL(/#\/$/);
  expect((await shopperState(page, otherCustomer.id))?.cart ?? []).toEqual([]);
  await expect(page.getByRole("banner").getByRole("button", { name: "Cart", exact: true })).toHaveText("");
  await expect(page.getByRole("region", { name: "Your guest cart" })).toHaveCount(0);
  const drawer = await openMiniCart(page);
  await expect(drawer.getByText("Your cart is empty.")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.customerUser)).toContain(otherCustomer.id);
});

test("sign-in links return only to internal routes", async ({ page, context }) => {
  await serveSignIn(context);
  await page.goto("/#/login?returnTo=%2F%2Fevil.example%2Fcheckout");
  await signInWithForm(page, customer);
  await expect(page).toHaveURL(new RegExp(`^${ORIGIN}/#/$`));
});

test("the mini-cart and cart page reflow at 360px with doubled text, with 44px controls", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone widths are checked in the mobile project.");
  await seedCarts(page, { guest: [{ ...linenM, quantity: 2 }, polo] });
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/#/cart");
  await expect(page.getByRole("heading", { level: 1, name: "Your cart" })).toBeVisible();
  for (const size of ["100%", "200%"]) {
    await page.evaluate((value) => { document.documentElement.style.fontSize = value; }, size);
    expect(await pageOverflow(page), `cart page at ${size} text`).toBeLessThanOrEqual(0);
  }
  const drawer = await openMiniCart(page);
  expect(await pageOverflow(page), "mini-cart at 200% text").toBeLessThanOrEqual(0);
  const panel = (await drawer.locator(":scope > div").boundingBox())!;
  expect([panel.x, panel.width]).toEqual([0, 360]);
  const scroller = drawer.locator(".overflow-y-auto");
  expect(await scroller.evaluate((element) => element.scrollWidth - element.clientWidth), "the drawer scrolls only vertically").toBeLessThanOrEqual(0);
  for (const control of await drawer.getByRole("button").all()) {
    const box = (await control.boundingBox())!;
    expect(Math.min(box.width, box.height), `${await control.getAttribute("aria-label") ?? await control.textContent()} target`).toBeGreaterThanOrEqual(44);
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
});

test("focus rings in the mini-cart and on the cart page are never cut off", async ({ page }) => {
  await seedCarts(page, { guest: [linenM, polo] });
  await page.goto("/#/cart");
  const main = page.getByRole("main");
  await main.getByRole("link", { name: linenShirt.name, exact: true }).first().focus();
  const onPage = await tabThroughRings(page, 8);
  expect(onPage).toEqual(expect.arrayContaining([
    `Decrease quantity of ${linenShirt.name}`, `Quantity of ${linenShirt.name}`, `Increase quantity of ${linenShirt.name}`,
  ]));

  const cart = page.getByRole("banner").getByRole("button", { name: "Cart", exact: true });
  await cart.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Your cart" }).getByRole("heading", { name: "Your cart (2 items)" })).toBeFocused();
  // Round the whole drawer, past its last control and back to the first.
  const inDrawer = await tabThroughRings(page, 16);
  expect(inDrawer).toEqual(expect.arrayContaining([
    "Close cart", `Decrease quantity of ${poloShirt.name}`, `Quantity of ${poloShirt.name}`, `Increase quantity of ${poloShirt.name}`, "View cart",
  ]));
});

test("a guest tab left open follows a sign-in made in another tab and never passes merged lines to another account", async ({ page, context, isMobile }) => {
  test.skip(isMobile, "Tabs behave alike on every screen size; the desktop project covers them.");
  await serveSignIn(context);
  await page.goto("/#/shop?cat=shirts");
  await addFromListing(page, poloShirt.name);

  // A second tab signs in: the guest cart joins the account there, and the guest cart is emptied.
  const second = await context.newPage();
  await second.goto("/#/login");
  await signInWithForm(second, customer);
  await expect(second).toHaveURL(/#\/$/);
  await expect.poll(async () => (await shopperState(second, null)).cart).toEqual([]);
  expect((await shopperState(second, customer.id)).cart).toEqual([polo]);

  // The first tab is now signed in too, and adds to the account's cart.
  await page.bringToFront();
  const banner = page.getByRole("banner");
  await expect(banner.getByRole("link", { name: "Account", exact: true })).toBeVisible();
  await expect(banner.getByRole("button", { name: "Cart", exact: true })).toHaveText(/^1/);
  await addFromListing(page, poloShirt.name);
  await expect.poll(async () => (await shopperState(page, customer.id)).cart).toEqual([{ ...polo, quantity: 2 }]);
  expect((await shopperState(page, null)).cart).toEqual([]);

  // Signing out in the second tab signs the first out as well; then another account signs in there.
  await second.bringToFront();
  await second.goto("/#/account");
  await second.getByRole("button", { name: "Logout" }).click();
  await expect(second).toHaveURL(/#\/login$/);
  await expect(banner.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(banner.getByRole("button", { name: "Cart", exact: true })).toHaveText("");
  await signInWithForm(second, otherCustomer);
  await expect(second).toHaveURL(/#\/$/);
  await expect(banner.getByRole("link", { name: "Account", exact: true })).toBeVisible();
  // The other account receives nothing, in either tab; the first account keeps its cart.
  expect((await shopperState(second, otherCustomer.id))?.cart ?? []).toEqual([]);
  expect((await shopperState(second, null)).cart).toEqual([]);
  expect((await shopperState(second, customer.id)).cart).toEqual([{ ...polo, quantity: 2 }]);
  await expect(banner.getByRole("button", { name: "Cart", exact: true })).toHaveText("");
  await expect(second.getByRole("region", { name: "Your guest cart" })).toHaveCount(0);
});

test("two tabs of one account each add an item, and both lines are kept", async ({ page, context, isMobile }) => {
  test.skip(isMobile, "Tabs behave alike on every screen size; the desktop project covers them.");
  await serveSignIn(context);
  await page.goto("/#/login");
  await signInWithForm(page, customer);
  await expect(page).toHaveURL(/#\/$/);
  // The second tab opens before the first one adds anything.
  const second = await context.newPage();
  await second.goto(`/#/product/${linenShirt.id}`);
  await expect(second.getByRole("heading", { level: 1 })).toBeVisible();

  await page.bringToFront();
  await page.goto("/#/shop?cat=shirts");
  await addFromListing(page, poloShirt.name);
  await expect.poll(async () => (await shopperState(page, customer.id)).cart).toEqual([polo]);

  await second.bringToFront();
  await second.getByRole("button", { name: "M", exact: true }).click();
  await second.getByRole("button", { name: "White", exact: true }).click();
  await second.getByRole("main").getByRole("button", { name: "Add to cart", exact: true }).first().click();
  await expect(second.getByRole("dialog", { name: "Your cart" }).getByRole("heading", { name: "Your cart (2 items)" })).toBeVisible();
  await expect.poll(async () => (await shopperState(second, customer.id)).cart).toEqual([polo, linenM]);
  await page.bringToFront();
  await expect(page.getByRole("banner").getByRole("button", { name: "Cart", exact: true })).toHaveText(/^2/);
});
