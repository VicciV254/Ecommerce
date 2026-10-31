import { expect, test } from "@playwright/test";

test("storefront renders and browses using isolated API/media fixtures", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:4173") {
      if (url.pathname === "/api/settings/admin-data" || url.pathname === "/api/settings/theme") {
        await route.fulfill({ json: null });
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        await route.fulfill({ status: 503, json: { error: "No live API is available in this browser test" } });
        return;
      }
      await route.continue();
      return;
    }
    if (route.request().resourceType() === "image") {
      await route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#eee"/></svg>',
      });
      return;
    }
    await route.fulfill({ contentType: "text/plain", body: "" });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Shop by Category" })).toBeVisible();
  await page.goto("/#/shop");
  await expect(page.getByRole("heading", { name: "All Products", exact: true })).toBeVisible();
  await page.goto("/#/shop?q=linen");
  await expect(page.getByRole("heading", { name: 'Results for "linen"', exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Linen Short-Sleeve Shirt", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Linen Short-Sleeve Shirt", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to Cart", exact: true }).first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});
