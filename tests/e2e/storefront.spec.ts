import type { Request } from "@playwright/test";
import { customer, expect, linenCartLine, ORIGIN, publishedStorefront, shopperState, signInCustomer, test } from "./fixtures";
import { STORAGE_KEYS, shopperStateKey } from "../../src/utils/storage";

test("storefront renders published sections and browses the canonical catalog", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Shop by department" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Shop by department" }).getByRole("link")).toHaveCount(2);
  await expect(page.getByRole("note")).toContainText("Demo catalog");
  await expect(page.getByRole("link", { name: `${publishedStorefront.settings.brand.name} home` }).first()).toBeVisible();
  await page.goto("/#/shop");
  await expect(page.getByRole("heading", { name: "All Products", exact: true })).toBeVisible();
  await page.goto("/#/shop?q=linen");
  await expect(page.getByRole("heading", { name: 'Results for "linen"', exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Linen Short-Sleeve Shirt", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Linen Short-Sleeve Shirt", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to Cart", exact: true }).first()).toBeDisabled();
});

test("a campaign without mobile artwork keeps shared copy and uses the mobile crop on phones", async ({ page, context, isMobile }) => {
  const settings = {
    ...publishedStorefront.settings,
    sections: [{ id: "hero", type: "campaign", title: "Hero", enabled: true, productIds: [], categoryIds: [], campaignId: "launch" }],
    campaigns: [{
      id: "launch", title: "Workspace week", body: "Desks and laptops for home offices.", conditions: "While stocks last.",
      cta: { label: "Shop phones", target: "category", targetId: "cat-smartphones" },
      desktopMediaId: "media-campaign-desktop", mobileMediaId: null,
      desktopFocal: { x: 30, y: 40 }, mobileFocal: { x: 70, y: 20 }, layout: "overlay",
    }],
  };
  await context.route("**/api/settings/storefront", (route) => route.fulfill({ json: { ...publishedStorefront, settings } }));
  await page.goto("/");
  const campaign = page.getByRole("region", { name: "Workspace week" });
  await expect(campaign.getByText("While stocks last.")).toBeVisible();
  await expect(campaign.getByRole("link", { name: "Shop phones" })).toHaveAttribute("href", "#/shop?cat=smartphones");
  const image = campaign.locator("picture img");
  await expect(campaign.locator("picture source")).toHaveCount(0);
  await expect(image).toHaveAttribute("src", "https://media.example.test/campaign-desktop.jpg");
  await expect(image).toHaveCSS("object-position", isMobile ? "70% 20%" : "30% 40%");
});

test("multi-SKU cards require option choices and the exact SKU is added", async ({ page }) => {
  await signInCustomer(page);
  await page.goto("/#/shop?cat=shirts");
  await expect(page.getByRole("heading", { level: 1, name: "Shirts", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Choose options for Linen Short-Sleeve Shirt" })).toBeVisible();
  await page.getByRole("button", { name: "Add to Cart" }).first().click();
  await expect.poll(async () => (await shopperState(page)).cart).toEqual([{ productId: "prod-polo-shirt", variantId: "var-polo", quantity: 1 }]);

  await page.getByRole("link", { name: "Choose options for Linen Short-Sleeve Shirt" }).click();
  const add = page.getByRole("button", { name: "Add to Cart", exact: true }).first();
  await expect(add).toBeDisabled();
  await expect(page.getByText("Select size and color to continue.")).toBeVisible();
  await page.getByRole("button", { name: "M", exact: true }).click();
  await page.getByRole("button", { name: "Blue", exact: true }).click();
  await expect(page.getByRole("button", { name: "Out of Stock", exact: true }).first()).toBeDisabled();
  await page.getByRole("button", { name: "White", exact: true }).click();
  await add.click();
  await expect.poll(async () => (await shopperState(page)).cart).toEqual([
    { productId: "prod-polo-shirt", variantId: "var-polo", quantity: 1 },
    linenCartLine,
  ]);
});

test("retired product URLs and unknown categories fail honestly", async ({ page }) => {
  await page.goto("/#/product/mens-fashion-1");
  await expect(page.getByRole("heading", { name: "Product not found" })).toBeVisible();
  await expect(page.getByText("Linen Short-Sleeve Shirt")).toHaveCount(0);
  await page.goto("/#/shop?cat=mens-fashion");
  await expect(page.getByRole("heading", { name: "Category not found" })).toBeVisible();
  await expect(page.getByText(/products found/)).toHaveCount(0);
});

test("an unavailable catalog API yields an error state, never static products", async ({ page, context }) => {
  await context.route("**/api/catalog", (route) => route.fulfill({ status: 503, json: { error: "Catalog temporarily unavailable" } }));
  await page.goto("/#/shop");
  await expect(page.getByRole("heading", { name: "Products are unavailable" })).toBeVisible();
  await expect(page.getByText("Catalog temporarily unavailable")).toBeVisible();
  await expect(page.getByRole("link", { name: /Shirt/ })).toHaveCount(0);
});

test("a returning browser's obsolete session, theme, cart and receipts are ignored but not deleted", async ({ page, context }) => {
  const legacy = {
    token: "legacy-customer-token",
    refreshToken: "legacy-refresh",
    user: JSON.stringify(customer),
    adminToken: "legacy-staff-token",
    adminUser: JSON.stringify({ id: "legacy-admin", email: "old@example.test", username: "Old", role: "ADMIN" }),
    [`nmb-store:${customer.id}`]: JSON.stringify({ cart: [{ productId: "mens-fashion-1", qty: 2 }], wishlist: ["mens-fashion-1"] }),
    "nmb-admin-store": JSON.stringify({ admin: { customProducts: [{ id: "custom-1", name: "Legacy Custom Product" }] } }),
    [`nmb-receipts-${customer.id}`]: JSON.stringify([{ orderNumber: "NM-2026-LEGACY", status: "DELIVERED", paymentStatus: "PAID", items: [] }]),
    "nmb-colors": "custom",
    "nmb-colors-custom": JSON.stringify({ primary: "#ff0000" }),
    "unrelated-app-key": "keep me",
  };
  await context.addInitScript(({ entries, origin }) => {
    if (location.origin !== origin || sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
  }, { entries: legacy, origin: ORIGIN });
  const requests: Request[] = [];
  context.on("request", (request) => { if (request.url().startsWith(`${ORIGIN}/api/`)) requests.push(request); });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Shop by department" })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "Cart", exact: true })).toHaveText("");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-brand-primary").trim()))
    .toBe(publishedStorefront.settings.theme.colors.primary);

  await page.goto("/#/account/orders");
  await expect(page.getByText("Please sign in to view your account.")).toBeVisible();
  await expect(page.getByText("NM-2026-LEGACY")).toHaveCount(0);
  await page.goto("/#/admin");
  await expect(page.getByRole("heading", { name: "Admin Login" })).toBeVisible();

  const paths = requests.map((request) => new URL(request.url()).pathname);
  expect(paths).not.toContain("/api/settings/admin-data");
  expect(paths).not.toContain("/api/settings/theme");
  expect(paths).not.toContain("/api/auth/me");
  expect(requests.filter((request) => request.headers().authorization)).toEqual([]);
  const stored = await page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)), Object.keys(legacy));
  expect(stored).toEqual(Object.values(legacy));
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.customerToken)).toBeNull();
  expect(await page.evaluate((key) => localStorage.getItem(key), shopperStateKey(customer.id))).toBeNull();
});
