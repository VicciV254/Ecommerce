import type { Page } from "@playwright/test";
import { ADMIN_PLACES, layoutProblems, serveAdminData, waitForPlace } from "./adminFixtures";
import { backdropContrast, expect, expectWholeFocusRing, signInStaff, test } from "./fixtures";

type Place = { route: string; h1: string; open?: (page: Page) => Promise<void> };

/** The places a role can reach, plus the not-found state, the drawer and the product dialog. */
function placesFor(role: "ADMIN" | "VIEWER"): Place[] {
  const places: Place[] = ADMIN_PLACES.map((place) =>
    role === "VIEWER" && place.route.endsWith("/promotions") ? { route: place.route, h1: "Not available for your role" } : { ...place });
  places.push({ route: "/admin/settings/activity", h1: "Page not found" });
  places.push({
    route: "/admin/orders/orders?order=order-quote-admin-2",
    h1: "Orders",
    open: async (page) => { await expect(page.getByRole("heading", { name: "Order APX-QUOTE-ADMIN-2" })).toBeVisible(); },
  });
  places.push({
    route: "/admin/catalog/products?product=prod-linen-shirt",
    h1: "Products",
    open: async (page) => {
      await expect(page.getByRole("dialog", { name: role === "VIEWER" ? "Product details" : "Edit product", exact: true })).toBeVisible();
    },
  });
  return places;
}

async function sweep(page: Page, role: "ADMIN" | "VIEWER", widths: number[]) {
  await signInStaff(page, role);
  await serveAdminData(page.context());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/admin/overview/dashboard");
  await waitForPlace(page, "Dashboard");
  const failures: string[] = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    for (const scale of [1, 2]) {
      await page.evaluate((size) => { document.documentElement.style.fontSize = size; }, scale > 1 ? "200%" : "");
      for (const place of placesFor(role)) {
        await page.evaluate((to) => { location.hash = to; }, place.route);
        await waitForPlace(page, place.h1);
        await place.open?.(page);
        const label = `${role} ${width}px ${scale * 100}% ${place.route}`;
        const problems = await layoutProblems(page);
        if (problems.overflow > 0 || problems.scrollers.length) failures.push(`${label}: ${JSON.stringify(problems)}`);
      }
      if (width < 1280) {
        await page.evaluate(() => { location.hash = "/admin/overview/dashboard"; });
        await waitForPlace(page, "Dashboard");
        await page.getByRole("button", { name: "Menu" }).click();
        await expect(page.getByRole("dialog", { name: "Admin navigation" })).toBeVisible();
        const problems = await layoutProblems(page);
        if (problems.overflow > 0 || problems.scrollers.length) failures.push(`${role} ${width}px ${scale * 100}% drawer: ${JSON.stringify(problems)}`);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog", { name: "Admin navigation" })).toHaveCount(0);
      }
    }
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  expect(failures, failures.join("\n")).toEqual([]);
}

test.describe("no page-level horizontal overflow (§7 sweep)", () => {
  test.setTimeout(240_000);
  for (const role of ["ADMIN", "VIEWER"] as const) {
    test(`${role}: every module, state, the drawer and the product dialog, at 100% and 200% text`, async ({ page, isMobile }) => {
      await sweep(page, role, isMobile ? [360, 430, 768] : [1024, 1280, 1440]);
    });
  }
});

/** The 3px ring sits 2px outside its control, so it needs this much room below the sticky top bar too. */
const FOCUS_RING_OUTSET = 5;

/**
 * Tabs `presses` times: each control shows its whole ring and, unless it sits in the sticky top bar or in a dialog above
 * the page, it is wholly below the sticky chrome.
 */
async function tabClearOfStickyChrome(page: Page, presses: number) {
  const visited: string[] = [];
  for (let press = 0; press < presses; press += 1) {
    await page.keyboard.press("Tab");
    // A focusable table region taller than the window can't show its whole ring: its top and sides must show.
    const tall = await page.evaluate(() => {
      const control = document.activeElement as HTMLElement;
      const box = control.getBoundingClientRect();
      if (box.height <= window.innerHeight / 2) return null;
      const style = getComputedStyle(control);
      const reach = Number.parseFloat(style.outlineOffset) + Number.parseFloat(style.outlineWidth);
      return { name: control.getAttribute("aria-label") ?? control.tagName, shown: control.matches(":focus-visible") && reach > 0,
        edges: box.top - reach >= 0 && box.left - reach >= 0 && box.right + reach <= window.innerWidth };
    });
    if (tall) {
      expect(tall.shown && tall.edges, `${tall.name}: ring shows along its top and sides`).toBe(true);
    }
    const name = tall ? tall.name : await expectWholeFocusRing(page);
    visited.push(name);
    const place = await page.evaluate(() => {
      const control = document.activeElement as HTMLElement;
      const chrome = Math.max(0, ...[...document.querySelectorAll("[data-sticky-header]")].map((element) => element.getBoundingClientRect().bottom));
      return { top: control.getBoundingClientRect().top, chrome, above: control.closest("[data-sticky-header], dialog[open]") !== null };
    });
    if (!place.above) expect(place.top - FOCUS_RING_OUTSET, `${name}: px of ring below the sticky top bar`).toBeGreaterThanOrEqual(place.chrome - 0.5);
  }
  return visited;
}

test("focus rings stay whole and clear of the sticky top bar: shell, drawer and a long module", async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  await signInStaff(page, "ADMIN");
  await serveAdminData(page.context());
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const scale of [1, 2]) {
    await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1280, height: 900 });
    await page.goto("/#/admin/catalog/stock");
    // A fresh document each round, so Tab starts from the top of the page.
    if (scale > 1) await page.reload();
    await waitForPlace(page, "Stock");
    await page.evaluate((size) => { document.documentElement.style.fontSize = size; }, scale > 1 ? "200%" : "");
    // From the top of the page: the top bar, the column (from 1280px), then down the long stock table.
    // Every stop on the page: the top bar's 2 (1 from 1280px, plus the column's 13), then the module's 21.
    const visited = await tabClearOfStickyChrome(page, isMobile ? 23 : 35);
    expect(visited, `${scale * 100}% text`).toEqual(expect.arrayContaining(isMobile
      ? ["Menu", "Search stock", "Bulk quantity", "Stock by SKU table", "On-hand quantity for VAR-POLO"]
      : ["Sign out", "Dashboard", "Live store", "Draft preview", "Search stock", "Stock by SKU table", "On-hand quantity for VAR-POLO"]));
    // With doubled text the module is longer than the window, so its later controls scrolled in under the top bar.
    if (scale > 1) expect(await page.evaluate(() => window.scrollY), "the long module scrolled under the sticky top bar").toBeGreaterThan(0);

    if (isMobile) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      const drawer = await tabClearOfStickyChrome(page, 16);
      expect(drawer).toEqual(expect.arrayContaining(["Close menu", "Dashboard", "Email promotions", "Live store", "Draft preview"]));
      await page.keyboard.press("Escape");
    }
  }
});

test("customers table: every cell has the same inline padding, headings never run together, and they meet 4.5:1", async ({ page, isMobile }) => {
  await signInStaff(page, "ADMIN");
  await serveAdminData(page.context());
  await page.setViewportSize(isMobile ? { width: 360, height: 800 } : { width: 1280, height: 900 });
  await page.goto("/#/admin/customers/customers");
  await waitForPlace(page, "Customers");
  const table = page.getByRole("region", { name: "Customer accounts table" }).locator("table");
  await expect(table.locator("tbody tr")).toHaveCount(2);
  const padding = await table.locator("th, td").evaluateAll((cells) =>
    [...new Set(cells.map((cell) => `${getComputedStyle(cell).paddingLeft} ${getComputedStyle(cell).paddingRight}`))]);
  expect(padding).toEqual(["12px 12px"]);
  // The space between one heading's text and the next ("Select" then "User", and so on along the row).
  const gaps = await table.locator("thead th").evaluateAll((headings) => {
    const range = document.createRange();
    const boxes = headings.map((heading) => {
      range.selectNodeContents(heading);
      return range.getBoundingClientRect();
    });
    return boxes.slice(1).map((box, index) => box.left - boxes[index].right);
  });
  expect(Math.min(...gaps), JSON.stringify(gaps)).toBeGreaterThanOrEqual(20);
  for (const heading of await table.locator("thead th").all()) {
    expect(await backdropContrast(page, heading), await heading.innerText()).toBeGreaterThanOrEqual(4.5);
  }
});

/** The smallest target a row action may offer (the brief's touch-target rule). */
const TARGET_SIZE = 44;

test("customers table: each row's checkbox is named for its customer, and its actions are 44px targets that keep their names", async ({ page, isMobile }) => {
  await signInStaff(page, "ADMIN");
  await serveAdminData(page.context());
  await page.setViewportSize(isMobile ? { width: 360, height: 800 } : { width: 1280, height: 900 });
  await page.goto("/#/admin/customers/customers");
  await waitForPlace(page, "Customers");
  const table = page.getByRole("region", { name: "Customer accounts table" }).locator("table");
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(2);
  // One checkbox per row and no other (unnamed) selection control.
  await expect(table.getByRole("checkbox")).toHaveCount(2);
  for (const [index, customerName] of ["Wanjiku Kamau-Odhiambo", "Unverified Shopper"].entries()) {
    const row = rows.nth(index);
    // Soft, so one run reports every unnamed checkbox and every small target.
    await expect.soft(row.getByRole("checkbox")).toHaveAccessibleName(`Select ${customerName}`);
    for (const action of ["Verify", "Disable", "Delete"]) {
      const box = await row.getByRole("button", { name: action, exact: true }).boundingBox();
      expect(box, `${customerName}: ${action} is rendered`).not.toBeNull();
      expect.soft(Math.min(box?.width ?? 0, box?.height ?? 0), `${customerName}: ${action} target ${box?.width}x${box?.height}`)
        .toBeGreaterThanOrEqual(TARGET_SIZE);
    }
  }
  // The wider actions may make the table scroll inside its labelled region, never the page.
  const problems = await layoutProblems(page);
  expect(problems.overflow, JSON.stringify(problems)).toBeLessThanOrEqual(0);
  expect(problems.scrollers).toEqual([]);
});

test("subscriptions table: the Customers table's rules too: padded cells, headings apart and at 4.5:1, and a 44px Delete", async ({ page, isMobile }) => {
  await signInStaff(page, "ADMIN");
  await serveAdminData(page.context());
  await page.setViewportSize(isMobile ? { width: 360, height: 800 } : { width: 1280, height: 900 });
  await page.goto("/#/admin/customers/promotions");
  await waitForPlace(page, "Email promotions");
  const table = page.getByRole("region", { name: "Subscriptions table" }).locator("table");
  const rows = table.locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  const padding = await table.locator("th, td").evaluateAll((cells) =>
    [...new Set(cells.map((cell) => `${getComputedStyle(cell).paddingLeft} ${getComputedStyle(cell).paddingRight}`))]);
  expect.soft(padding).toEqual(["12px 12px"]);
  const gaps = await table.locator("thead th").evaluateAll((headings) => {
    const range = document.createRange();
    const boxes = headings.map((heading) => {
      range.selectNodeContents(heading);
      return range.getBoundingClientRect();
    });
    return boxes.slice(1).map((box, index) => box.left - boxes[index].right);
  });
  expect.soft(Math.min(...gaps), JSON.stringify(gaps)).toBeGreaterThanOrEqual(20);
  for (const heading of await table.locator("thead th").all()) {
    expect.soft(await backdropContrast(page, heading), await heading.innerText()).toBeGreaterThanOrEqual(4.5);
  }
  for (const row of await rows.all()) {
    const box = await row.getByRole("button", { name: "Delete", exact: true }).boundingBox();
    expect(box, "Delete is rendered").not.toBeNull();
    expect.soft(Math.min(box?.width ?? 0, box?.height ?? 0), `Delete target ${box?.width}x${box?.height}`).toBeGreaterThanOrEqual(TARGET_SIZE);
  }
  const problems = await layoutProblems(page);
  expect(problems.overflow, JSON.stringify(problems)).toBeLessThanOrEqual(0);
  expect(problems.scrollers).toEqual([]);
});
