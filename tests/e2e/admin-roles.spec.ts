import type { Locator, Page } from "@playwright/test";
import { serveAdminData, waitForPlace } from "./adminFixtures";
import { expect, signInStaff, test } from "./fixtures";

/** Buttons that would change something; none may render for a view-only role. Case-insensitive, so a relabel cannot hide one. */
const WRITE_ACTIONS = /^(Add|Add product|Save|Save product|Save draft|Restock to max|Subtract|Create discount|Stop discount|Delete|Edit|\+ ?Sub|\+ Department|\+ Designer|Hide|Show|Publish|Discard changes|Reload draft|Send verification to selected|Verify|Disable|Enable|Send to \d+ subscribers|\+ Image URL|\+ Variant|\+ Specification|Add option|Dispatch|Cancel order|Start processing|Mark ready.*|Confirm (delivery|pickup)|Retry email|Check with M-Pesa|Record M-Pesa reference.*|Approve.*|Reject.*)$/i;

async function expectNothingEditable(scope: Locator, allowedFields: string[], label: string) {
  const names = await scope.getByRole("button").evaluateAll((buttons) =>
    buttons.filter((button) => (button as HTMLElement).offsetParent !== null).map((button) => (button.textContent ?? "").trim()));
  expect(names.filter((name) => WRITE_ACTIONS.test(name)), `${label}: write actions`).toEqual([]);
  for (const role of ["spinbutton", "checkbox", "radio"] as const) {
    await expect(scope.getByRole(role), `${label}: ${role}`).toHaveCount(0);
  }
  // Only search, filter and view controls are fields.
  const fields = await scope.locator("input:not([type=hidden]), select, textarea").evaluateAll((elements) =>
    elements.filter((element) => (element as HTMLElement).offsetParent !== null)
      .map((element) => element.getAttribute("aria-label") ?? (element as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? element.tagName));
  expect(fields.sort(), `${label}: fields`).toEqual([...allowedFields].sort());
  await expect(scope.locator('input[type="file"]'), `${label}: uploads`).toHaveCount(0);
}

async function visit(page: Page, route: string, h1: string) {
  await page.evaluate((to) => { location.hash = to; }, route);
  await waitForPlace(page, h1);
}

test.describe("view-only role", () => {
  test.beforeEach(async ({ page }) => {
    await signInStaff(page, "VIEWER");
    await serveAdminData(page.context());
  });

  test("email promotions is absent, and its address says it is not available without asking for its data", async ({ page }) => {
    const promotions: string[] = [];
    page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/subscriptions/admin")) promotions.push(request.url()); });
    await page.goto("/#/admin/overview/dashboard");
    await waitForPlace(page, "Dashboard");
    const menu = page.getByRole("button", { name: "Menu", exact: true });
    if (await menu.isVisible()) await menu.click();
    const navigation = page.getByRole("navigation", { name: "Admin" }).filter({ visible: true });
    await expect(navigation.getByRole("link", { name: "Customers" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "Email promotions" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.goto("/#/admin/customers/promotions");
    await waitForPlace(page, "Not available for your role");
    await expect(page.getByText("Your role (View only) can't open Email promotions.")).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "Go to Dashboard" }).click();
    await waitForPlace(page, "Dashboard");
    expect(promotions).toEqual([]);
  });

  test("discounts, stock, products, product details, the storefront editor and customers show nothing editable", async ({ page }) => {
    await page.goto("/#/admin/overview/dashboard");
    await waitForPlace(page, "Dashboard");
    const main = page.getByRole("main");

    await visit(page, "/admin/customers/discounts", "Discounts");
    await expect(main.getByText("View only: your role can see discounts and when they apply but cannot change them.")).toBeVisible();
    await expect(main.getByText("Linen promotion")).toBeVisible();
    await expectNothingEditable(main, [], "Discounts");

    await visit(page, "/admin/catalog/stock", "Stock");
    await expect(main.getByText("View only: your role can see stock levels but cannot change them.")).toBeVisible();
    await expectNothingEditable(main, ["Search stock", "Filter stock by category", "Filter stock by status"], "Stock");

    await visit(page, "/admin/catalog/products", "Products");
    await expect(main.getByText("View only: your role can see products, categories and designers but cannot change them.")).toBeVisible();
    await expectNothingEditable(main, ["Search products", "Filter products by category", "Filter products by status"], "Products");
    await main.getByRole("button", { name: "View Linen Short-Sleeve Shirt" }).click();
    const details = page.getByRole("dialog", { name: "Product details" });
    await expect(details.getByText("View only: your role can see this product but cannot change it.")).toBeVisible();
    await expect(details.getByText("View only: your role can see these images but cannot change them.")).toBeVisible();
    await expectNothingEditable(details, [], "Product details");
    await details.getByRole("button", { name: "Close product details" }).click();
    await expect(details).toHaveCount(0);
    await page.goto("/#/admin/catalog/products?product=new");
    await expect(page.getByText("Adding products is not available for your role.")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await visit(page, "/admin/storefront/editor", "Storefront editor");
    await expect(main.getByText("View only: your role can see the storefront draft and its preview but cannot change them.")).toBeVisible();
    await expect(main.getByText("Store name")).toBeVisible();
    await expectNothingEditable(main, [], "Storefront editor");
    await main.getByRole("link", { name: "Draft preview" }).click();
    await waitForPlace(page, "Draft preview: shoppers can't see this");
    await expect(page.getByRole("region", { name: "Draft preview" })).toBeVisible();

    await visit(page, "/admin/customers/customers", "Customers");
    await expect(main.getByText("View only: your role can see customer accounts but cannot change them.")).toBeVisible();
    await expect(main.getByText("wanjiku.kamau-odhiambo@example.test")).toBeVisible();
    await expectNothingEditable(main, ["Search users", "Filter by verification", "Filter by account status"], "Customers");
  });

  test("a whole view-only journey sends no request but reads", async ({ page }) => {
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/")) writes.push(`${request.method()} ${request.url()}`);
    });
    await page.goto("/#/admin/overview/dashboard");
    await waitForPlace(page, "Dashboard");
    const main = page.getByRole("main");

    await visit(page, "/admin/overview/analytics", "Sales report");
    await main.getByLabel("Report period").selectOption("week");
    await main.getByLabel("Download format").selectOption("csv");
    const download = page.waitForEvent("download");
    await main.getByRole("button", { name: "Download report" }).click();
    expect((await download).suggestedFilename()).toBe("apex-cart-financial-week.csv");

    await visit(page, "/admin/orders/orders", "Orders");
    const views = main.getByRole("navigation", { name: "Order worklists" });
    await views.getByRole("link", { name: "All orders" }).click();
    await main.getByLabel("Order status").selectOption("PROCESSING");
    await main.getByLabel("Delivery").selectOption({ index: 1 });
    await main.getByLabel("Delivery").selectOption("");
    await main.getByLabel("Order status").selectOption("");
    await main.getByRole("button", { name: "Open order APX-QUOTE-ADMIN-1" }).click();
    await expect(main.getByText("View only: your role can see this order but cannot change it.")).toBeVisible();
    await main.getByRole("button", { name: "Reload order" }).click();
    await main.getByRole("button", { name: "← Back to orders" }).click();
    await views.getByRole("link", { name: "Closed" }).click();

    await visit(page, "/admin/orders/returns", "Returns");
    await main.getByLabel("Return status").selectOption("RECEIVED");
    await main.getByRole("button", { name: /^Open return/ }).first().click();
    await expect(main.getByRole("heading", { name: "Order APX-QUOTE-ADMIN-2" })).toBeVisible();

    await visit(page, "/admin/orders/refunds", "Refunds");
    await main.getByLabel("Refund status").selectOption("PROCESSING");
    await main.getByRole("button", { name: /^Open order/ }).first().click();
    await expect(main.getByRole("heading", { name: "Order APX-QUOTE-ADMIN-2" })).toBeVisible();

    await visit(page, "/admin/catalog/products", "Products");
    await main.getByRole("textbox", { name: "Search products" }).fill("shirt");
    await main.getByLabel("Filter products by status").selectOption("hidden");
    await main.getByLabel("Filter products by status").selectOption("all");
    await main.getByRole("button", { name: /^Needs images/ }).click();
    await main.getByRole("button", { name: /^Needs images/ }).click();
    await main.getByRole("button", { name: "View Linen Short-Sleeve Shirt" }).click();
    await page.getByRole("dialog", { name: "Product details" }).getByRole("button", { name: "Close product details" }).click();

    await visit(page, "/admin/catalog/stock", "Stock");
    await main.getByLabel("Search stock").fill("polo");
    await main.getByLabel("Filter stock by status").selectOption("IN_STOCK");

    await visit(page, "/admin/storefront/editor", "Storefront editor");
    await main.getByRole("link", { name: "Draft preview" }).click();
    await waitForPlace(page, "Draft preview: shoppers can't see this");
    await page.getByRole("link", { name: "Back to editor" }).click();
    await waitForPlace(page, "Storefront editor");

    await visit(page, "/admin/customers/customers", "Customers");
    await main.getByLabel("Search users").fill("wanjiku");
    await main.getByRole("button", { name: "Search" }).click();
    await main.getByLabel("Filter by verification").selectOption("true");

    await visit(page, "/admin/customers/discounts", "Discounts");
    await expect(main.getByText("Linen promotion")).toBeVisible();
    expect(writes).toEqual([]);
  });
});
