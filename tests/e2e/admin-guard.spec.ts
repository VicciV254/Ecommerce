import type { Page } from "@playwright/test";
import { serveAdminData, waitForPlace } from "./adminFixtures";
import { expect, publishedStorefront, signInStaff, storefrontDraft, test } from "./fixtures";

const guard = (page: Page) => page.getByRole("dialog", { name: "Discard unsaved changes?" });

/** Follows a navigation link: from the drawer below 1280px, from the persistent column above. */
async function navigateTo(page: Page, name: string) {
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    await page.getByRole("dialog", { name: "Admin navigation" }).getByRole("link", { name, exact: true }).click();
  } else {
    await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name, exact: true }).click();
  }
}

async function signOut(page: Page) {
  const account = page.getByRole("button", { name: /^Account/ });
  if (await account.isVisible()) await account.click();
  await page.getByRole("button", { name: "Sign out" }).filter({ visible: true }).click();
}

/** Accepts draft saves as the API does; returns the saved bodies. */
async function serveDraftSaves(page: Page) {
  const saves: unknown[] = [];
  let version = storefrontDraft.version;
  let settings = storefrontDraft.settings;
  await page.context().route("**/api/settings/storefront/draft", (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      saves.push(body);
      version += 1;
      settings = body.settings;
    }
    return route.fulfill({ json: { ...storefrontDraft, version, settings } });
  });
  return saves;
}

test.describe("unsaved-change guard", () => {
  test.beforeEach(async ({ page }) => {
    await signInStaff(page, "ADMIN");
    await serveAdminData(page.context());
  });

  test("in-app navigation, Live store and Sign out ask before discarding storefront edits", async ({ page }) => {
    await page.goto("/#/admin/storefront/editor");
    await waitForPlace(page, "Storefront editor");
    const storeName = page.getByRole("textbox", { name: "Store name" });
    await storeName.fill("Apex Cart Draft");

    await navigateTo(page, "Dashboard");
    await expect(guard(page)).toBeVisible();
    await expect(guard(page)).toContainText("Storefront draft has unsaved changes. Leaving now discards them.");
    await guard(page).getByRole("button", { name: "Keep editing" }).click();
    await expect(guard(page)).toHaveCount(0);
    await expect(page).toHaveURL(/#\/admin\/storefront\/editor$/);
    await expect(storeName).toHaveValue("Apex Cart Draft");

    await signOut(page);
    await expect(guard(page)).toBeVisible();
    await guard(page).getByRole("button", { name: "Keep editing" }).click();
    await expect(storeName).toHaveValue("Apex Cart Draft");

    const menu = page.getByRole("button", { name: "Menu", exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole("link", { name: "Live store" }).filter({ visible: true }).click();
    await expect(guard(page)).toBeVisible();
    await guard(page).getByRole("button", { name: "Discard changes" }).click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByRole("banner").getByRole("link", { name: publishedStorefront.settings.brand.name, exact: true })).toBeVisible();

    // Discarded: the editor opens clean, so signing out asks nothing.
    await page.goto("/#/admin/storefront/editor");
    await waitForPlace(page, "Storefront editor");
    await expect(storeName).toHaveValue(storefrontDraft.settings.brand.name);
    await signOut(page);
    await expect(guard(page)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Staff sign-in" })).toBeVisible();
  });

  test("after the session expires, Sign in again asks first while edits are unsaved, then signs out", async ({ page }) => {
    // The server no longer accepts the staff token for the catalog: the shell reports the session as expired.
    await page.context().route("**/api/admin/catalog", (route) => route.fulfill({ status: 401, json: { error: "Invalid token" } }));
    await page.goto("/#/admin/storefront/editor");
    await waitForPlace(page, "Storefront editor");
    const expired = page.getByRole("alert").filter({ hasText: "Your staff session has expired." });
    await expect(expired).toBeVisible();
    const storeName = page.getByRole("textbox", { name: "Store name" });
    await storeName.fill("Apex Cart Draft");
    await expired.getByRole("button", { name: "Sign in again" }).click();
    await expect(guard(page)).toContainText("Storefront draft has unsaved changes.");
    await guard(page).getByRole("button", { name: "Keep editing" }).click();
    await expect(storeName).toHaveValue("Apex Cart Draft");
    await expired.getByRole("button", { name: "Sign in again" }).click();
    await guard(page).getByRole("button", { name: "Discard changes" }).click();
    await expect(page.getByRole("heading", { name: "Staff sign-in" })).toBeVisible();
    await expect(page).toHaveURL(/#\/admin$/);
  });

  test("Back and Forward keep the edits on Keep editing, and Discard continues the same way", async ({ page }) => {
    await page.goto("/#/admin/overview/dashboard");
    await waitForPlace(page, "Dashboard");
    await navigateTo(page, "Storefront editor");
    await waitForPlace(page, "Storefront editor");
    await navigateTo(page, "Stock");
    await waitForPlace(page, "Stock");
    await page.goBack();
    await waitForPlace(page, "Storefront editor");
    const storeName = page.getByRole("textbox", { name: "Store name" });
    await storeName.fill("Apex Cart Draft");

    await page.goForward();
    await expect(guard(page)).toBeVisible();
    await expect(page).toHaveURL(/#\/admin\/storefront\/editor$/);
    await guard(page).getByRole("button", { name: "Keep editing" }).click();
    await expect(storeName).toHaveValue("Apex Cart Draft");

    await page.goBack();
    await expect(guard(page)).toHaveCount(1);
    await expect(page).toHaveURL(/#\/admin\/storefront\/editor$/);
    await expect(storeName).toHaveValue("Apex Cart Draft");
    await guard(page).getByRole("button", { name: "Discard changes" }).click();
    await waitForPlace(page, "Dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeFocused();
    // Nothing was lost from the history: both later entries are still ahead.
    await page.goForward();
    await waitForPlace(page, "Storefront editor");
    await expect(storeName).toHaveValue(storefrontDraft.settings.brand.name);
    await page.goForward();
    await waitForPlace(page, "Stock");
  });

  test("the browser asks before unloading while something is unsaved, and not after saving", async ({ page }) => {
    const saves = await serveDraftSaves(page);
    await page.goto("/#/admin/storefront/editor");
    await waitForPlace(page, "Storefront editor");
    await page.getByRole("textbox", { name: "Store name" }).fill("Apex Cart Draft");
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.type());
      void dialog.dismiss();
    });
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => dialogs).toEqual(["beforeunload"]);
    expect(page.isClosed()).toBe(false);

    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Draft saved. Shoppers still see the published version.")).toBeVisible();
    expect(saves).toHaveLength(1);
    // Saved: leaving asks nothing.
    await navigateTo(page, "Dashboard");
    await waitForPlace(page, "Dashboard");
    await expect(guard(page)).toHaveCount(0);
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => page.isClosed()).toBe(true);
    expect(dialogs).toEqual(["beforeunload"]);
  });

  test("the product editor asks when closed or left with unsaved values, and not when untouched", async ({ page }) => {
    await page.goto("/#/admin/catalog/products");
    await waitForPlace(page, "Products");
    await page.getByRole("button", { name: "Edit Linen Short-Sleeve Shirt" }).click();
    const editor = page.getByRole("dialog", { name: "Edit product", exact: true });
    await editor.getByRole("button", { name: "Close product editor" }).click();
    await expect(editor).toHaveCount(0);
    await expect(guard(page)).toHaveCount(0);

    await page.getByRole("button", { name: "Edit Linen Short-Sleeve Shirt" }).click();
    const name = editor.getByRole("textbox", { name: "Name", exact: true });
    await name.fill("Linen Shirt, renamed");
    await page.keyboard.press("Escape");
    await expect(guard(page)).toContainText("Product editor has unsaved changes. Leaving now discards them.");
    await guard(page).getByRole("button", { name: "Keep editing" }).click();
    await expect(name).toHaveValue("Linen Shirt, renamed");
    await expect(page).toHaveURL(/product=prod-linen-shirt$/);

    await page.goBack();
    await expect(guard(page)).toBeVisible();
    await expect(page).toHaveURL(/product=prod-linen-shirt$/);
    await guard(page).getByRole("button", { name: "Discard changes" }).click();
    await expect(editor).toHaveCount(0);
    await expect(page).toHaveURL(/#\/admin\/catalog\/products$/);
    // Focus returns to the product that opened the editor.
    await expect(page.getByRole("button", { name: "Edit Linen Short-Sleeve Shirt" })).toBeFocused();
  });

  test("each registered editor asks before in-app navigation", async ({ page }) => {
    const cases: { route: string; h1: string; edit: (page: Page) => Promise<void>; label: string }[] = [
      { route: "/admin/catalog/stock", h1: "Stock", label: "Stock changes",
        edit: async (current) => { await current.getByRole("spinbutton", { name: "On-hand quantity for VAR-POLO" }).fill("3"); } },
      { route: "/admin/catalog/stock", h1: "Stock", label: "Stock changes",
        edit: async (current) => { await current.getByRole("spinbutton", { name: "Bulk quantity" }).fill("25"); } },
      { route: "/admin/customers/discounts", h1: "Discounts", label: "Discount form",
        edit: async (current) => { await current.getByLabel("Coupon code (optional)").fill("SAVE10"); } },
      { route: "/admin/customers/promotions", h1: "Email promotions", label: "Email promotion",
        edit: async (current) => { await current.getByRole("textbox", { name: "Subject" }).fill("Weekend offer"); } },
    ];
    for (const item of cases) {
      await page.goto(`/#${item.route}`);
      await waitForPlace(page, item.h1);
      await item.edit(page);
      await navigateTo(page, "Dashboard");
      await expect(guard(page), item.label).toContainText(`${item.label} has unsaved changes.`);
      await guard(page).getByRole("button", { name: "Discard changes" }).click();
      await waitForPlace(page, "Dashboard");
    }

    await page.goto("/#/admin/catalog/products");
    await waitForPlace(page, "Products");
    await page.getByRole("button", { name: "+ Department" }).click();
    const form = page.getByRole("dialog", { name: "Create new category" });
    await form.getByRole("textbox", { name: "Category name" }).fill("Garden");
    await form.getByRole("button", { name: "Cancel" }).click();
    await expect(guard(page)).toContainText("Category form has unsaved changes.");
    await guard(page).getByRole("button", { name: "Keep editing" }).click();
    await expect(form.getByRole("textbox", { name: "Category name" })).toHaveValue("Garden");
    await page.keyboard.press("Escape");
    await guard(page).getByRole("button", { name: "Discard changes" }).click();
    await expect(form).toHaveCount(0);
  });
});

test.describe("storefront draft preview", () => {
  test("shows unsaved edits, keeps them on the way back, and never reaches shoppers or browser storage", async ({ page, context }) => {
    await signInStaff(page, "ADMIN");
    await serveAdminData(context);
    await page.goto("/#/admin/storefront/editor");
    await waitForPlace(page, "Storefront editor");
    const storeName = page.getByRole("textbox", { name: "Store name" });
    await storeName.fill("Apex Cart Draft");
    await page.getByRole("combobox", { name: "Fonts" }).selectOption("lora");

    await page.getByRole("main").getByRole("link", { name: "Draft preview" }).click();
    await waitForPlace(page, "Draft preview: shoppers can't see this");
    await expect(guard(page)).toHaveCount(0);
    await expect(page.getByText("Includes unsaved changes")).toBeVisible();
    await expect(page.getByRole("region", { name: "Draft preview" })).toContainText("Apex Cart Draft");
    await expect(page.locator("#apex-cart-preview-font-link")).toHaveAttribute("href", /family=Lora/);
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toContain("Apex Cart Draft");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-display"))).not.toContain("Lora");

    // Browser Back to the editor is not leaving: no prompt, and the edit is still there.
    await page.goBack();
    await waitForPlace(page, "Storefront editor");
    await expect(guard(page)).toHaveCount(0);
    await expect(storeName).toHaveValue("Apex Cart Draft");
    await expect(page.locator("#apex-cart-preview-font-link")).toHaveCount(0);
    await page.goForward();
    await waitForPlace(page, "Draft preview: shoppers can't see this");
    await page.getByRole("link", { name: "Back to editor" }).click();
    await waitForPlace(page, "Storefront editor");
    await expect(storeName).toHaveValue("Apex Cart Draft");

    const shopper = await context.newPage();
    await shopper.goto("/");
    await expect(shopper.getByRole("banner").getByRole("link", { name: publishedStorefront.settings.brand.name, exact: true })).toBeVisible();
    await expect(shopper.getByText("Apex Cart Draft")).toHaveCount(0);
    await shopper.close();
  });

  test("a signed-out preview address shows the sign-in and asks for no draft", async ({ page, context }) => {
    await serveAdminData(context);
    const drafts: string[] = [];
    page.on("request", (request) => { if (request.url().includes("/api/settings/storefront/draft")) drafts.push(request.url()); });
    await page.goto("/#/admin/storefront/preview");
    await expect(page.getByRole("heading", { name: "Staff sign-in" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Draft preview" })).toHaveCount(0);
    expect(drafts).toEqual([]);
  });
});
