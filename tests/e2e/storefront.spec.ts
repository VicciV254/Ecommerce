import { expect, test } from "./fixtures";

test("storefront renders and browses using isolated API/media fixtures", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Shop by Category" })).toBeVisible();
  await page.goto("/#/shop");
  await expect(page.getByRole("heading", { name: "All Products", exact: true })).toBeVisible();
  await page.goto("/#/shop?q=linen");
  await expect(page.getByRole("heading", { name: 'Results for "linen"', exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Linen Short-Sleeve Shirt", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Linen Short-Sleeve Shirt", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to Cart", exact: true }).first()).toBeVisible();
});
