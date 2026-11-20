import type { BrowserContext, Locator, Page } from "@playwright/test";
import type { AdminCatalogCategory, AdminCatalogSnapshot } from "../../src/api/catalog";
import { fixtureCategory, staffRecord } from "../../src/test-support/catalogFixtures";
import { layoutProblems, waitForPlace } from "./adminFixtures";
import { adminSnapshot, expect, publicSnapshot, signInStaff, test } from "./fixtures";

/*
 * P8.2 catalog editing: two staff editors and a stale save, category order with Up and Down, the private product
 * preview, the products list's filters in the address, and the responsive matrix (contract §6).
 */
const PRODUCT_CHANGED = "Someone else changed this product after you opened it. Reload it to see their changes, then make yours again.";
const SIBLINGS_CHANGED = "The categories here changed after you opened them. Reload and try again.";
const HIDDEN_PREVIEW = "Preview: shoppers can't see this product";

type Write = { path: string; body: Record<string, unknown>; status: number };

/**
 * The staff catalog as the API keeps it: saves are checked against the version the editor sent (`expectedUpdatedAt`),
 * reorders against the current set of siblings, and each write moves the record's version. Shoppers read the same
 * categories (without versions).
 */
async function serveCatalog(context: BrowserContext) {
  const state: AdminCatalogSnapshot = structuredClone(adminSnapshot);
  const writes: Write[] = [];
  let clock = Date.parse("2026-11-17T08:00:00.000Z");
  const nextVersion = () => new Date((clock += 1000)).toISOString();
  const shopperCatalog = () => ({ ...publicSnapshot, categories: state.categories.map(({ updatedAt: _version, ...category }) => category) });

  await context.route("**/api/admin/catalog", (route) => route.fulfill({ json: state }));
  await context.route("**/api/catalog", (route) => route.fulfill({ json: shopperCatalog() }));
  await context.route(/\/api\/products\/[^/?]+$/, (route) => {
    const request = route.request();
    if (request.method() !== "PUT") return route.fallback();
    const id = decodeURIComponent(new URL(request.url()).pathname.split("/").pop() ?? "");
    const body = request.postDataJSON() as Record<string, unknown>;
    const index = state.products.findIndex((product) => product.id === id);
    const stale = body.expectedUpdatedAt !== state.products[index]?.updatedAt;
    writes.push({ path: `/products/${id}`, body, status: stale ? 409 : 200 });
    if (stale) return route.fulfill({ status: 409, json: { error: PRODUCT_CHANGED, code: "PRODUCT_CHANGED" } });
    const { expectedUpdatedAt: _sent, variants: _variants, images: _images, ...fields } = body;
    state.products[index] = { ...state.products[index], ...fields, updatedAt: nextVersion() };
    return route.fulfill({ json: state.products[index] });
  });
  await context.route("**/api/categories/reorder", (route) => {
    const body = route.request().postDataJSON() as { parentId: string | null; orderedIds: string[] };
    const siblings = state.categories.filter((category) => category.parentId === body.parentId);
    const same = body.orderedIds.length === siblings.length && siblings.every((category) => body.orderedIds.includes(category.id));
    writes.push({ path: "/categories/reorder", body, status: same ? 200 : 409 });
    if (!same) return route.fulfill({ status: 409, json: { error: SIBLINGS_CHANGED, code: "CATEGORY_SIBLINGS_CHANGED" } });
    state.categories = state.categories.map((category) => body.orderedIds.includes(category.id)
      ? { ...category, order: body.orderedIds.indexOf(category.id), updatedAt: nextVersion() }
      : category);
    return route.fulfill({ json: { categories: body.orderedIds.map((id) => state.categories.find((category) => category.id === id)) } });
  });
  return {
    writes,
    product: (id: string) => state.products.find((product) => product.id === id)!,
    /** Another editor adds a department, after this browser loaded the catalog. */
    addDepartment(category: AdminCatalogCategory) {
      state.categories = [...state.categories, category];
    },
  };
}

const editorOf = (page: Page) => page.getByRole("dialog", { name: "Edit product", exact: true });

test("two staff editors: the stale save is refused with a plain message, and Reload product shows the other editor's change", async ({ page, context }) => {
  await signInStaff(page);
  const catalog = await serveCatalog(context);
  const opened = catalog.product("prod-linen-shirt").updatedAt;
  const second = await context.newPage();
  for (const tab of [page, second]) {
    await tab.goto("/#/admin/catalog/products?product=prod-linen-shirt");
    await expect(editorOf(tab).getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Linen Short-Sleeve Shirt");
  }

  // Editor A changes the price and saves.
  await editorOf(page).getByRole("spinbutton", { name: "Price (KES)" }).fill("1500");
  await editorOf(page).getByRole("button", { name: "Save product" }).click();
  await expect(editorOf(page)).toHaveCount(0);
  // Editor B changes only the description, but its form still holds the old price.
  const editorB = editorOf(second);
  await editorB.getByRole("textbox", { name: "Description" }).fill("Editor B's description of the linen shirt.");
  await editorB.getByRole("button", { name: "Save product" }).click();
  await expect(editorB.getByRole("alert")).toHaveText(PRODUCT_CHANGED);
  expect(catalog.writes.map(({ status, body }) => [status, body.expectedUpdatedAt])).toEqual([[200, opened], [409, opened]]);
  expect(catalog.product("prod-linen-shirt")).toMatchObject({ price: 1500, description: "Linen Short-Sleeve Shirt described for automated tests." });

  // The failed save kept B's edit; reloading discards it (after asking) and shows A's price.
  await editorB.getByRole("button", { name: "Reload product" }).click();
  const guard = second.getByRole("dialog", { name: "Discard unsaved changes?" });
  await expect(guard).toContainText("Product editor has unsaved changes.");
  await guard.getByRole("button", { name: "Discard changes" }).click();
  await expect(editorB.getByRole("spinbutton", { name: "Price (KES)" })).toHaveValue("1500");
  await expect(editorB.getByRole("alert")).toHaveCount(0);
  await editorB.getByRole("textbox", { name: "Description" }).fill("Editor B's description of the linen shirt.");
  await editorB.getByRole("button", { name: "Save product" }).click();
  await expect(editorB).toHaveCount(0);
  expect(catalog.product("prod-linen-shirt")).toMatchObject({ price: 1500, description: "Editor B's description of the linen shirt." });
  await second.close();
});

test("category order: Up and Down work from the keyboard, focus stays put, and shoppers see the new order after a reload", async ({ page, context }) => {
  await signInStaff(page);
  const catalog = await serveCatalog(context);
  const shopper = await context.newPage();
  await shopper.goto("/#/departments");
  const departments = shopper.getByRole("main").getByRole("heading", { level: 2 });
  await expect(departments).toHaveText(["Phones & Tablets", "Fashion"]);

  await page.goto("/#/admin/catalog/products");
  await waitForPlace(page, "Products");
  const status = page.getByRole("status").filter({ hasText: /^Moved / });
  const up = page.getByRole("button", { name: "Move Fashion up" });
  const down = page.getByRole("button", { name: "Move Fashion down" });
  await expect(down).toHaveAttribute("aria-disabled", "true");
  await up.focus();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText("Moved Fashion above Phones & Tablets");
  // Fashion is first now: Up is disabled (with its reason), and focus moved to its pair.
  await expect(up).toHaveAttribute("aria-disabled", "true");
  await expect(up).toHaveAccessibleDescription("Already first here.");
  await expect(down).toBeFocused();
  await page.keyboard.press("Space");
  await expect(status).toHaveText("Moved Fashion below Phones & Tablets");
  await expect(up).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText("Moved Fashion above Phones & Tablets");
  expect(catalog.writes.map(({ body }) => body)).toEqual([
    { parentId: null, orderedIds: ["cat-fashion", "cat-phones-tablets"] },
    { parentId: null, orderedIds: ["cat-phones-tablets", "cat-fashion"] },
    { parentId: null, orderedIds: ["cat-fashion", "cat-phones-tablets"] },
  ]);
  await shopper.reload();
  await expect(departments).toHaveText(["Fashion", "Phones & Tablets"]);

  // Another editor added a department since this list loaded: the move is refused, said plainly, and the list reloads.
  catalog.addDepartment(staffRecord(fixtureCategory({ id: "cat-garden", name: "Garden", order: 2 })));
  await page.getByRole("button", { name: "Move Phones & Tablets up" }).click();
  await expect(page.getByRole("alert")).toHaveText(SIBLINGS_CHANGED);
  await expect(page.getByRole("button", { name: "Move Garden up" })).toBeVisible();
  await shopper.close();
});

/** Requests that could change a cart, wishlist, order or payment. */
function watchShopperWrites(page: Page) {
  const seen: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/^\/api\/(cart|wishlist|orders|mpesa)\b/.test(path)) seen.push(`${request.method()} ${path}`);
  });
  return seen;
}

/** Every link in `scope` stays inside the admin. */
const linksOutsideAdmin = (scope: Locator) => scope.locator("a[href]").evaluateAll((links) =>
  links.map((link) => link.getAttribute("href") ?? "").filter((href) => !href.startsWith("#/admin/")));

test("a hidden product's private preview: buying off, no shopper links, no cart, wishlist, order or payment request", async ({ page, context }) => {
  await signInStaff(page);
  await serveCatalog(context);
  const writes = watchShopperWrites(page);
  await page.goto("/#/admin/catalog/products?status=hidden");
  await waitForPlace(page, "Products");
  await page.getByRole("button", { name: "Edit Hidden Draft Jacket" }).click();
  const editor = editorOf(page);
  await expect(editor.getByText("Hidden (draft)", { exact: true })).toBeVisible();
  await editor.getByRole("link", { name: "Preview" }).click();
  await waitForPlace(page, HIDDEN_PREVIEW);
  await expect(page).toHaveURL(/#\/admin\/catalog\/preview\?product=prod-hidden-draft$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await expect(page.getByText("Hidden (draft): only staff can see it. This shows the saved product: changes not yet saved in the editor are not included.")).toBeVisible();
  const preview = page.getByRole("region", { name: "Product preview" });
  await expect(preview.getByRole("heading", { level: 2, name: "Hidden Draft Jacket" })).toBeVisible();
  await expect(preview.getByText("Buying is off in this preview.")).toBeVisible();
  await expect(preview.getByRole("button", { name: /add to cart|choose options|wishlist/i })).toHaveCount(0);
  await expect(page.locator("[data-purchase-bar]")).toHaveCount(0);
  expect(await linksOutsideAdmin(preview)).toEqual([]);
  // The navigation shows where the preview belongs.
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (await menu.isVisible()) await menu.click();
  await expect(page.getByRole("navigation", { name: "Admin" }).filter({ visible: true }).getByRole("link", { name: "Products" })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");

  // Back to product reopens the editor on the same filtered list.
  await page.getByRole("link", { name: "Back to product" }).click();
  await expect(editor).toBeVisible();
  await expect(page).toHaveURL(/#\/admin\/catalog\/products\?status=hidden&product=prod-hidden-draft$/);
  // Leaving a dirty editor for the preview asks first.
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Hidden Draft Jacket, renamed");
  await editor.getByRole("link", { name: "Preview" }).click();
  const guard = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await expect(guard).toContainText("Product editor has unsaved changes.");
  await guard.getByRole("button", { name: "Keep editing" }).click();
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Hidden Draft Jacket, renamed");
  await editor.getByRole("link", { name: "Preview" }).click();
  await guard.getByRole("button", { name: "Discard changes" }).click();
  await waitForPlace(page, HIDDEN_PREVIEW);
  // The preview was a push: Back returns to the editor, as saved.
  await page.goBack();
  await expect(editor.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Hidden Draft Jacket");
  expect(writes).toEqual([]);
});

test("every staff role can open the preview; an unknown or malformed product id returns to the products list, saying so", async ({ page, context }) => {
  await signInStaff(page, "VIEWER");
  await serveCatalog(context);
  const writes = watchShopperWrites(page);
  await page.goto("/#/admin/catalog/products");
  await waitForPlace(page, "Products");
  await page.getByRole("link", { name: "Preview Hidden Draft Jacket" }).click();
  await waitForPlace(page, HIDDEN_PREVIEW);
  await page.getByRole("link", { name: "Back to product" }).click();
  const details = page.getByRole("dialog", { name: "Product details" });
  // Under the name and as the Visibility fact.
  await expect(details.getByText("Hidden (draft)", { exact: true })).toHaveCount(2);
  await details.getByRole("link", { name: "Preview" }).click();
  await waitForPlace(page, HIDDEN_PREVIEW);
  await page.goto("/#/admin/catalog/preview?product=prod-linen-shirt");
  await waitForPlace(page, "Preview of the live product");
  await expect(page.getByText(/^Visible to shoppers\./)).toBeVisible();
  for (const id of ["prod-missing", "%3Cimg%3E", "new"]) {
    await page.goto(`/#/admin/catalog/preview?product=${id}`);
    await expect(page.getByText("That product wasn't found.")).toBeVisible();
    await expect(page).toHaveURL(/#\/admin\/catalog\/products$/);
    await waitForPlace(page, "Products");
  }
  expect(writes).toEqual([]);
});

test("the products list keeps status, readiness and category in the address; opening a product keeps them for Back", async ({ page, context }) => {
  await signInStaff(page);
  await serveCatalog(context);
  await page.goto("/#/admin/catalog/products");
  await waitForPlace(page, "Products");
  const length = await page.evaluate(() => history.length);
  await page.getByLabel("Filter products by status").selectOption("hidden");
  await expect(page).toHaveURL(/#\/admin\/catalog\/products\?status=hidden$/);
  await page.getByRole("button", { name: /^Needs images \(\d+\)$/ }).click();
  await expect(page).toHaveURL(/#\/admin\/catalog\/products\?status=hidden&readiness=needs-images$/);
  await page.getByLabel("Filter products by category").selectOption("cat-shirts");
  await expect(page).toHaveURL(/#\/admin\/catalog\/products\?status=hidden&readiness=needs-images&category=cat-shirts$/);
  expect(await page.evaluate(() => history.length), "filter changes replace the entry").toBe(length);
  await expect(page.getByText("1 of 5 products")).toBeVisible();

  await page.getByRole("button", { name: "Edit Hidden Draft Jacket" }).click();
  await expect(page).toHaveURL(/category=cat-shirts&product=prod-hidden-draft$/);
  await expect(editorOf(page)).toBeVisible();
  await page.goBack();
  await expect(editorOf(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#\/admin\/catalog\/products\?status=hidden&readiness=needs-images&category=cat-shirts$/);
  await page.reload();
  await waitForPlace(page, "Products");
  await expect(page.getByLabel("Filter products by status")).toHaveValue("hidden");
  await expect(page.getByLabel("Filter products by readiness")).toHaveValue("needs-images");
  await expect(page.getByLabel("Filter products by category")).toHaveValue("cat-shirts");
  await expect(page.getByRole("button", { name: /^Needs images \(\d+\)$/ })).toHaveAttribute("aria-pressed", "true");

  // Unknown values are corrected in place and never applied.
  await page.goto("/#/admin/catalog/products?status=bogus&readiness=ready&category=cat-nowhere");
  await expect(page).toHaveURL(/#\/admin\/catalog\/products\?readiness=ready$/);
  await expect(page.getByText("0 of 5 products")).toBeVisible();
});

/** Sets the root text size and reopens `route`, so every measurement is taken from a fresh render at that size. */
async function openAt(page: Page, route: string, h1: string, scale: number) {
  await page.evaluate((size) => { document.documentElement.style.fontSize = size; }, scale > 1 ? "200%" : "");
  await page.evaluate(() => { location.hash = "/admin/overview/dashboard"; });
  await waitForPlace(page, "Dashboard");
  await page.evaluate((to) => { location.hash = to; }, route);
  await waitForPlace(page, h1);
}

/** Page-level overflow and stray sideways scrollers, once two measurements agree. */
async function settledProblems(page: Page) {
  let last = "";
  await expect.poll(async () => {
    const next = JSON.stringify(await layoutProblems(page));
    const settled = next === last;
    last = next;
    return settled;
  }).toBe(true);
  return JSON.parse(last) as Awaited<ReturnType<typeof layoutProblems>>;
}

const smallerThan44 = (controls: Locator) => controls.evaluateAll((elements) => elements
  .filter((element) => (element as HTMLElement).offsetParent !== null)
  .map((element) => ({ name: element.getAttribute("aria-label") ?? element.textContent?.trim(), box: element.getBoundingClientRect() }))
  .filter(({ box }) => box.height < 43.5 || box.width < 43.5)
  .map(({ name, box }) => `${name} ${Math.round(box.width)}x${Math.round(box.height)}`));

test("§6 matrix: the products list, category tree, editor checklist and preview fit at 100% and 200% text with 44px targets", async ({ page, context, isMobile }) => {
  test.setTimeout(300_000);
  await signInStaff(page);
  await serveCatalog(context);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/admin/overview/dashboard");
  await waitForPlace(page, "Dashboard");
  const failures: string[] = [];
  const check = (label: string, problems: Awaited<ReturnType<typeof layoutProblems>>) => {
    if (problems.overflow > 0 || problems.scrollers.length) failures.push(`${label}: ${JSON.stringify(problems)}`);
  };
  for (const width of isMobile ? [360, 390, 430, 768] : [1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const scale of [1, 2]) {
      const label = `${width}px ${scale * 100}%`;

      // Products list with a filter applied: labels in words, one filter per row on phones.
      await openAt(page, "/admin/catalog/products?status=hidden", "Products", scale);
      check(`${label} list`, await settledProblems(page));
      const card = page.getByRole("button", { name: "Edit Hidden Draft Jacket" });
      await expect(card.getByText("Hidden (draft)", { exact: true })).toBeVisible();
      await expect(card.getByText("Out of stock", { exact: true })).toBeVisible();
      // Labels wrap between words, never inside one: a label has at most one line per word.
      const splitWords = await page.getByRole("main").locator("li button > span:last-child > span:last-child > span").evaluateAll((labels) =>
        labels.flatMap((label) => {
          const range = document.createRange();
          range.selectNodeContents(label);
          const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
          const words = (label.textContent ?? "").trim().split(/\s+/).length;
          return lines > words ? [`"${label.textContent}" ${lines} lines`] : [];
        }));
      failures.push(...splitWords.map((item) => `${label} label splits a word: ${item}`));
      const filters = page.getByRole("main").locator("select, input[aria-label='Search products']");
      failures.push(...(await smallerThan44(filters)).map((item) => `${label} filter ${item}`));
      failures.push(...(await smallerThan44(page.getByRole("link", { name: /^Preview / }))).map((item) => `${label} ${item}`));
      if (width < 768) {
        const [status, readiness] = await Promise.all([
          page.getByLabel("Filter products by status").boundingBox(), page.getByLabel("Filter products by readiness").boundingBox(),
        ]);
        if (!status || !readiness || readiness.y < status.y + status.height) failures.push(`${label}: filters share a row on a phone`);
      }

      // Category tree: 44px move buttons, beside the name from 768px and below it on phones at 200% text.
      const moves = page.getByRole("button", { name: /^Move .+ (up|down)$/ });
      failures.push(...(await smallerThan44(moves)).map((item) => `${label} tree ${item}`));
      const row = page.locator("[data-category-row='cat-fashion'] > div");
      const [name, up] = await Promise.all([row.locator("[data-category-name]").boundingBox(), page.getByRole("button", { name: "Move Fashion up" }).boundingBox()]);
      if (!name || !up) failures.push(`${label}: tree row not measured`);
      else if (width >= 768 && scale === 1 && up.y >= name.y + name.height) failures.push(`${label}: move buttons wrapped below the name`);
      else if (width < 768 && scale === 2 && up.y < name.y + name.height) failures.push(`${label}: move buttons beside the name at 200% text`);

      // The editor's checklist: open while checks are open, above the details below 1024px and beside them from 1024px.
      await openAt(page, "/admin/catalog/products?product=prod-hidden-draft", "Products", scale);
      const editor = editorOf(page);
      const checklist = editor.locator("details").filter({ hasText: "Before publishing" });
      await expect(checklist).toHaveAttribute("open", "");
      failures.push(...(await smallerThan44(checklist.locator("summary, button, a"))).map((item) => `${label} checklist ${item}`));
      const [list, details] = await Promise.all([checklist.boundingBox(), editor.getByRole("heading", { name: "Details" }).boundingBox()]);
      if (!list || !details) failures.push(`${label}: checklist not measured`);
      else if (width >= 1024 && list.x <= details.x + details.width) failures.push(`${label}: checklist not beside the details column`);
      else if (width < 1024 && list.y >= details.y) failures.push(`${label}: checklist not above the details`);
      // Nothing in the editor clips its content or scrolls sideways, but a labelled table region (and the name's
      // deliberate ellipsis, and 1px visually hidden text).
      const editorOverflow = await editor.evaluate((dialog) => [dialog, ...dialog.querySelectorAll<HTMLElement>("*")]
        .filter((element) => {
          const style = getComputedStyle(element);
          return style.overflowX !== "visible" && style.textOverflow !== "ellipsis" && element.clientWidth > 1 && !element.matches("input, textarea, select") &&
            !(element.getAttribute("role") === "region" && element.hasAttribute("aria-label")) && element.scrollWidth > element.clientWidth + 1;
        })
        .map((element) => `${element.tagName} ${element.textContent?.slice(0, 30)} ${element.scrollWidth}>${element.clientWidth}`));
      failures.push(...editorOverflow.map((item) => `${label} editor overflows: ${item}`));

      // The preview of a hidden product: the shoppers' page at this size, one H1, the buying note in place of the actions.
      await openAt(page, "/admin/catalog/preview?product=prod-hidden-draft", HIDDEN_PREVIEW, scale);
      check(`${label} preview`, await settledProblems(page));
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByText("Buying is off in this preview.")).toBeVisible();
      failures.push(...(await smallerThan44(page.getByRole("link", { name: "Back to product" }))).map((item) => `${label} ${item}`));
    }
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  expect(failures, failures.join("\n")).toEqual([]);
});

test("the checklist's steps move to their section inside the editor and keep the header with Save in view, except where it scrolls with the form", async ({ page, context, isMobile }) => {
  await signInStaff(page);
  await serveCatalog(context);
  for (const [width, scale] of isMobile ? [[360, 1], [360, 2], [390, 1]] : [[1280, 1], [1024, 2]]) {
    const label = `${width}px ${scale * 100}%`;
    // On a phone with enlarged text the pinned header would take most of the screen (O-g): it scrolls with the form.
    const pinned = !(isMobile && scale > 1);
    // A fresh tab at this size and text size, so nothing is left scrolled or edited from the previous one.
    const tab = await context.newPage();
    await tab.setViewportSize({ width, height: 800 });
    await tab.addInitScript((size) => {
      // The tab's first, blank document has no root element yet.
      const apply = () => { if (document.documentElement) document.documentElement.style.fontSize = size; };
      apply();
      document.addEventListener("DOMContentLoaded", apply);
    }, scale > 1 ? "200%" : "");
    await tab.goto("/#/admin/catalog/products?product=prod-hidden-draft");
    const editor = editorOf(tab);
    const save = editor.getByRole("button", { name: "Save product" });
    await expect(save).toBeInViewport();
    const frameTop = () => editor.evaluate((dialog) => dialog.querySelector("div")!.getBoundingClientRect().top);
    /** Where a step's section ends up: with the header pinned, Save stays in view; otherwise the section starts at the
     *  top of the editor, the header (and Save) having scrolled away with the form. */
    const expectSectionShown = async (heading: typeof save, step: string) => {
      await expect(heading, label).toBeFocused();
      await expect(heading, label).toBeInViewport();
      if (pinned) {
        await expect(save, `${label} ${step}: Save stays in view`).toBeInViewport();
        return;
      }
      const offset = await heading.evaluate((element) => element.getBoundingClientRect().top) - await frameTop();
      expect(offset, `${label} ${step}: the section starts at the top of the editor`).toBeLessThan(40);
      await expect(save, `${label} ${step}: Save scrolled away with the header`).not.toBeInViewport();
    };
    // Playwright scrolls a target into view before clicking it, which could scroll the dialog itself; these steps start
    // in view (the checklist is at the top of the editor body), so any scrolling seen is the editor's own.
    await editor.getByRole("button", { name: "Go to Images" }).click();
    await expectSectionShown(editor.getByRole("heading", { name: "Images", exact: true }), "Go to Images");

    // Back at the top of the editor, Save is there; turn the only option off: "No active option" opens with its own step.
    await editor.evaluate((dialog) => { for (const scroller of dialog.querySelectorAll<HTMLElement>("[data-editor-scroller]")) scroller.scrollTop = 0; });
    await expect(save, `${label}: Save at the top of the editor`).toBeInViewport();
    await editor.getByRole("checkbox", { name: "Variant 1 active" }).dispatchEvent("click");
    await editor.getByRole("button", { name: "Go to Variants" }).click();
    await expectSectionShown(editor.getByRole("heading", { name: "Variants (sellable SKUs)", exact: true }), "Go to Variants");
    if (pinned) await expect(editor.getByRole("button", { name: "Close product editor" }), label).toBeInViewport();
    await tab.close();
  }
});
