import type { Page } from "@playwright/test";
import { ADMIN_PLACES, serveAdminData, waitForPlace } from "./adminFixtures";
import { STAFF_TOKEN, expect, publishedStorefront, staff, test } from "./fixtures";
import { signInStaff } from "./fixtures";
import { STORAGE_KEYS } from "../../src/utils/storage";

const BRAND = publishedStorefront.settings.brand.name;
const title = (name: string) => `${name} · Admin · ${BRAND}`;

/** Follows a navigation link: from the drawer below 1280px, from the persistent column above. */
async function openModule(page: Page, name: string | RegExp) {
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    await page.getByRole("dialog", { name: "Admin navigation" }).getByRole("link", { name, exact: typeof name === "string" }).click();
  } else {
    await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name, exact: typeof name === "string" }).click();
  }
}

/** The navigation that is showing: the drawer's below 1280px (opened for the check), the column's above. */
async function visibleNavigation(page: Page) {
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    return page.getByRole("dialog", { name: "Admin navigation" }).getByRole("navigation", { name: "Admin" });
  }
  return page.getByRole("navigation", { name: "Admin" });
}

const historyLength = (page: Page) => page.evaluate(() => history.length);

test.describe("routed modules", () => {
  test.beforeEach(async ({ page }) => {
    await signInStaff(page, "ADMIN");
    await serveAdminData(page.context());
  });

  test("every module keeps its place through a deep link and a refresh, with its title and current link", async ({ page }) => {
    for (const place of ADMIN_PLACES) {
      await page.goto(`/#${place.route}`);
      await waitForPlace(page, place.h1);
      const name = place.route.endsWith("/preview") ? "Draft preview" : place.h1;
      await expect(page, place.route).toHaveTitle(title(name));
      await page.reload();
      await waitForPlace(page, place.h1);
      await expect(page).toHaveURL(new RegExp(`#${place.route.replace(/[?]/g, "\\?")}$`));
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      // A fresh load leaves focus where the browser put it.
      await expect(page.getByRole("heading", { level: 1 })).not.toBeFocused();
      const navigation = await visibleNavigation(page);
      if (place.route.endsWith("/preview")) {
        await expect(page.getByRole("link", { name: "Draft preview" }).filter({ visible: true }).first()).toHaveAttribute("aria-current", "page");
      } else {
        await expect(navigation.locator("[aria-current=page]")).toHaveText(new RegExp(`^${name}`));
      }
      await page.keyboard.press("Escape");
    }
  });

  test("Back and Forward move between modules and focus each H1", async ({ page }) => {
    await page.goto("/#/admin/overview/dashboard");
    await waitForPlace(page, "Dashboard");
    await openModule(page, "Stock");
    await waitForPlace(page, "Stock");
    await expect(page.getByRole("heading", { level: 1, name: "Stock" })).toBeFocused();
    await openModule(page, "Customers");
    await waitForPlace(page, "Customers");
    await page.goBack();
    await waitForPlace(page, "Stock");
    await expect(page.getByRole("heading", { level: 1, name: "Stock" })).toBeFocused();
    await expect(page).toHaveTitle(title("Stock"));
    await page.goBack();
    await waitForPlace(page, "Dashboard");
    await page.goForward();
    await waitForPlace(page, "Stock");
    await expect(page.getByRole("heading", { level: 1, name: "Stock" })).toBeFocused();
    await page.goForward();
    await waitForPlace(page, "Customers");
  });

  test("the bare entry and the Staff portal link open the dashboard without an extra history entry", async ({ page }) => {
    await page.goto("/#/");
    await page.getByRole("contentinfo").getByRole("link", { name: "Staff portal" }).click();
    await waitForPlace(page, "Dashboard");
    await expect(page).toHaveURL(/#\/admin\/overview\/dashboard$/);
    await page.goBack();
    await expect(page).toHaveURL(/#\/$/);
  });

  test("the Orders view and open order live in the address", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => { if (request.url().includes("/api/orders/admin/")) requests.push(new URL(request.url()).pathname); });
    await page.goto("/#/admin/orders/orders?view=bogus");
    await waitForPlace(page, "Orders");
    await expect(page).toHaveURL(/#\/admin\/orders\/orders$/);
    const views = page.getByRole("navigation", { name: "Order worklists" });
    await expect(views.getByRole("link", { name: "Needs action" })).toHaveAttribute("aria-current", "page");

    const before = await historyLength(page);
    await views.getByRole("link", { name: "All orders" }).click();
    await expect(page).toHaveURL(/#\/admin\/orders\/orders\?view=all$/);
    await views.getByRole("link", { name: "Closed" }).click();
    await expect(page).toHaveURL(/view=closed$/);
    expect(await historyLength(page)).toBe(before);
    await views.getByRole("link", { name: "All orders" }).click();

    const open = page.getByRole("button", { name: "Open order APX-QUOTE-ADMIN-2" });
    await open.click();
    await expect(page).toHaveURL(/view=all&order=order-quote-admin-2$/);
    await expect(page.getByRole("heading", { name: "Order APX-QUOTE-ADMIN-2" })).toBeFocused();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Order APX-QUOTE-ADMIN-2" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Order APX-QUOTE-ADMIN-2" })).toHaveCount(0);
    await expect(page).toHaveURL(/view=all$/);

    for (const [order, sent] of [["%3Cscript%3E", false], ["order-missing", true]] as const) {
      requests.length = 0;
      await page.goto(`/#/admin/orders/refunds?order=${order}`);
      await expect(page.getByText("That order wasn't found.")).toBeVisible();
      await expect(page).toHaveURL(/#\/admin\/orders\/refunds$/);
      expect(requests.some((path) => path.endsWith(`/admin/${order}`)), `${order} was requested`).toBe(sent);
      expect(requests.filter((path) => path.includes("script")), "a malformed id never reaches the server").toEqual([]);
    }
  });

  test("the open product lives in the address", async ({ page }) => {
    await page.goto("/#/admin/catalog/products");
    await waitForPlace(page, "Products");
    await page.getByRole("button", { name: "Edit Linen Short-Sleeve Shirt" }).click();
    await expect(page).toHaveURL(/product=prod-linen-shirt$/);
    await page.reload();
    const editor = page.getByRole("dialog", { name: "Edit product", exact: true });
    await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Linen Short-Sleeve Shirt");
    await editor.getByRole("button", { name: "Close product editor" }).click();
    await expect(editor).toHaveCount(0);
    await expect(page).toHaveURL(/#\/admin\/catalog\/products$/);
    await page.getByRole("button", { name: "Edit Linen Short-Sleeve Shirt" }).click();
    await expect(editor).toBeVisible();
    await page.goBack();
    await expect(editor).toHaveCount(0);
    for (const product of ["prod-missing", "%3Cimg%3E"]) {
      await page.goto(`/#/admin/catalog/products?product=${product}`);
      await expect(page.getByText("That product wasn't found.")).toBeVisible();
      await expect(page).toHaveURL(/#\/admin\/catalog\/products$/);
    }
  });

  test("an unknown address shows Page not found in the shell, with ways back", async ({ page }) => {
    await page.goto("/#/admin/settings/no-such-page");
    await waitForPlace(page, "Page not found");
    await expect(page).toHaveTitle(title("Page not found"));
    await page.getByRole("main").getByRole("link", { name: "Products" }).click();
    await waitForPlace(page, "Products");
  });
});

test.describe("sign-in", () => {
  async function serveLogin(page: Page, role: string) {
    await page.context().route("**/api/admin/login", (route) =>
      route.fulfill({ json: { admin: { ...staff, role }, token: STAFF_TOKEN, refreshToken: "browser-only-staff-refresh" } }));
  }

  async function signInWithForm(page: Page) {
    const form = page.getByRole("main");
    await form.getByLabel("Email").fill("admin@example.test");
    await form.getByLabel("Password", { exact: true }).fill("browser-only-password");
    await form.getByRole("button", { name: "Sign in" }).click();
  }

  test("a signed-out deep link shows the sign-in, loads nothing, then lands on that page", async ({ page }) => {
    await serveAdminData(page.context());
    await serveLogin(page, "ADMIN");
    const staffReads: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (/^\/api\/(admin|orders\/admin|settings\/storefront\/draft|subscriptions\/admin)/.test(path) && path !== "/api/admin/login") staffReads.push(path);
    });
    await page.goto("/#/admin/catalog/stock");
    await expect(page.getByRole("heading", { name: "Staff sign-in" })).toBeVisible();
    await expect(page).toHaveTitle(title("Sign in"));
    expect(staffReads).toEqual([]);
    await signInWithForm(page);
    await waitForPlace(page, "Stock");
    await expect(page).toHaveURL(/#\/admin\/catalog\/stock$/);

    // Phones and tablets keep "Sign out" in the account panel; desktops show it in the bar.
    const account = page.getByRole("button", { name: /^Account/ });
    if (await account.isVisible()) await account.click();
    await page.getByRole("button", { name: "Sign out" }).filter({ visible: true }).click();
    await expect(page.getByRole("heading", { name: "Staff sign-in" })).toBeVisible();
    await expect(page).toHaveURL(/#\/admin$/);
  });

  test("a viewer who asked for email promotions lands on the dashboard", async ({ page }) => {
    await serveAdminData(page.context());
    await serveLogin(page, "VIEWER");
    const promotions: string[] = [];
    page.on("request", (request) => { if (request.url().includes("/api/subscriptions/admin")) promotions.push(request.url()); });
    await page.goto("/#/admin/customers/promotions");
    const before = await historyLength(page);
    await signInWithForm(page);
    await waitForPlace(page, "Dashboard");
    await expect(page).toHaveURL(/#\/admin\/overview\/dashboard$/);
    expect(await historyLength(page)).toBe(before);
    expect(promotions).toEqual([]);
  });
});

test.describe("staff session across tabs", () => {
  const UNSAVED_NAME = "Unsaved under the first account";
  const secondStaff = { id: "browser-admin-2", email: "viewer@example.test", username: "Second staff", role: "VIEWER" };

  test.beforeEach(async ({ page }) => {
    await signInStaff(page, "ADMIN");
    await serveAdminData(page.context());
    await page.goto("/#/admin/storefront/editor");
    await waitForPlace(page, "Storefront editor");
    await page.getByRole("textbox", { name: "Store name" }).fill(UNSAVED_NAME);
  });

  /**
   * Another tab of this browser changes the shared staff session without reloading: it signs out, then signs in as
   * `next` (or stays signed out); or, with `signOutFirst: false`, writes `next`'s session over the current one, as a
   * new sign-in or a refreshed token for the same account would. This tab's next request would carry whatever is left.
   */
  async function changeSessionElsewhere(page: Page, next: typeof secondStaff | typeof staff | null, { signOutFirst = true } = {}) {
    const other = await page.context().newPage();
    await other.goto("/#/about");
    await other.evaluate(({ keys, admin, signOut }) => {
      if (signOut) for (const key of [keys.adminToken, keys.adminRefreshToken, keys.adminUser]) localStorage.removeItem(key);
      if (!admin) return;
      localStorage.setItem(keys.adminToken, "browser-only-next-staff-token");
      localStorage.setItem(keys.adminRefreshToken, "browser-only-next-staff-refresh");
      localStorage.setItem(keys.adminUser, JSON.stringify(admin));
    }, { keys: STORAGE_KEYS, admin: next, signOut: signOutFirst });
    await other.close();
    await page.bringToFront();
  }

  test("signing out in another tab signs this tab out too, and its edits end with the session", async ({ page }) => {
    await changeSessionElsewhere(page, null);
    await expect(page.getByRole("heading", { name: "Staff sign-in" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Store name" })).toHaveCount(0);
  });

  test("signing in as someone else in another tab switches this tab to that account, without the first one's edits", async ({ page }) => {
    await changeSessionElsewhere(page, secondStaff);
    await expect(page.getByText(secondStaff.username, { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByText("View only", { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await waitForPlace(page, "Storefront editor");
    // The view-only account reads the saved draft; the first account's unsaved name is nowhere on the page.
    await expect(page.getByRole("textbox", { name: "Store name" })).toHaveCount(0);
    await expect(page.getByText(UNSAVED_NAME)).toHaveCount(0);
  });

  test("a new session for the same account written elsewhere keeps this tab and its edits", async ({ page }) => {
    await changeSessionElsewhere(page, staff, { signOutFirst: false });
    await expect(page.getByRole("textbox", { name: "Store name" })).toHaveValue(UNSAVED_NAME);
    await expect(page.getByText(staff.username, { exact: true }).filter({ visible: true })).toBeVisible();
  });

  test("another account's session written over this one, without a sign-out between, still switches this tab", async ({ page }) => {
    await changeSessionElsewhere(page, secondStaff, { signOutFirst: false });
    await expect(page.getByText(secondStaff.username, { exact: true }).filter({ visible: true })).toBeVisible();
    await waitForPlace(page, "Storefront editor");
    await expect(page.getByText(UNSAVED_NAME)).toHaveCount(0);
  });
});

test.describe("navigation drawer and column", () => {
  test("phones: a labelled drawer traps focus, closes on Escape and on navigation, and shows where you are", async ({ page, isMobile }) => {
    test.skip(!isMobile, "The drawer is the navigation below 1280px; the desktop project checks the column.");
    await signInStaff(page, "ADMIN");
    await serveAdminData(page.context());
    await page.goto("/#/admin/orders/refunds");
    await waitForPlace(page, "Refunds");
    await expect(page.getByText(/Orders and returns › Refunds$/).filter({ visible: true })).toBeVisible();
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    const drawer = page.getByRole("dialog", { name: "Admin navigation" });
    await expect(drawer).toBeVisible();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    const controls = await menu.getAttribute("aria-controls");
    await expect(drawer.locator(`[id="${controls}"]`)).toHaveCount(1);
    // Opens at the start edge, and the page behind is inert.
    expect((await drawer.locator(`[id="${controls}"]`).boundingBox())?.x).toBe(0);
    expect(await drawer.evaluate((dialog) => dialog.matches(":modal"))).toBe(true);
    await expect(drawer.getByRole("link", { name: "Refunds" })).toHaveAttribute("aria-current", "page");
    for (let press = 0; press < 20; press += 1) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest("dialog[open]")))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(menu).toBeFocused();

    await menu.click();
    await drawer.getByRole("link", { name: "Sales report" }).click();
    await expect(drawer).toHaveCount(0);
    await waitForPlace(page, "Sales report");
    await expect(page.getByRole("heading", { level: 1, name: "Sales report" })).toBeFocused();
    await expect(page.getByText(/Overview › Sales report$/).filter({ visible: true })).toBeVisible();
  });

  test("with reduced motion the drawer opens without animation", async ({ page, isMobile }) => {
    test.skip(!isMobile, "The drawer is the navigation below 1280px.");
    await signInStaff(page, "ADMIN");
    await serveAdminData(page.context());
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#/admin/overview/dashboard");
    await waitForPlace(page, "Dashboard");
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Admin navigation" }).locator("> div");
    expect(await panel.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  });

  test("desktop: a persistent grouped column beside the content, with no menu button", async ({ page, isMobile }) => {
    test.skip(isMobile, "The column appears from 1280px.");
    await signInStaff(page, "VIEWER");
    await serveAdminData(page.context());
    await page.goto("/#/admin/catalog/products");
    await waitForPlace(page, "Products");
    await expect(page.getByRole("button", { name: "Menu", exact: true })).toBeHidden();
    const column = page.getByRole("navigation", { name: "Admin" });
    const box = await column.boundingBox();
    const main = await page.getByRole("main").boundingBox();
    expect(box && main).toBeTruthy();
    expect(Math.round((await column.evaluate((nav) => nav.parentElement!.parentElement!.parentElement!.getBoundingClientRect().width)))).toBe(240);
    expect(main!.x).toBeGreaterThanOrEqual(box!.x + box!.width);
    await expect(column.getByRole("link", { name: "Products" })).toHaveAttribute("aria-current", "page");
    await expect(column.getByRole("link", { name: "Email promotions" })).toHaveCount(0);
    await expect(page.getByRole("banner").getByText("View only", { exact: true })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("button", { name: "Sign out" })).toBeVisible();
    for (const target of [44]) {
      for (const link of await column.getByRole("link").all()) {
        expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(target);
      }
    }
  });
});
