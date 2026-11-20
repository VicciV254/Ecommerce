import type { Locator, Page } from "@playwright/test";
import type { StaffOrder } from "../../src/api/admin";
import { fixtureAdminSnapshot, fixtureProduct, fixtureSnapshot, linenShirt, poloShirt } from "../../src/test-support/catalogFixtures";
import { serveAdminData, staffOrders, waitForPlace } from "./adminFixtures";
import { serveDemonstrationStore } from "./demonstrationFixtures";
import { fixtureAttention, fixtureDeliveredOrder } from "../../src/test-support/orderFixtures";
import { backdropContrast, expect, linenCartLine, order, orderPage, pageOverflow, signInCustomer, signInStaff, test } from "./fixtures";

/*
 * P8 open items: phone layouts at 200% text (B1, B7, B8, B10, B11, B16, B18, with B2, B4 and B5 verified there) and
 * forced colours (O28). 200% text is the root font size, as the browser's text-size setting sets it.
 */
const TARGET = 44;
/** Order numbers as the server makes them (NM-<year><month>-<20 hex characters>), from the real-backend check. */
const REAL_ORDER_NUMBERS = ["NM-202611-2342560E16D609D487CA", "NM-202611-B9EC253FB80328677067"];

async function at(page: Page, width: number, scale: 1 | 2) {
  await page.setViewportSize({ width, height: 800 });
  await page.evaluate((size) => { document.documentElement.style.fontSize = size; }, scale === 2 ? "200%" : "");
  // Two frames, so layout and the resize observers it triggers (the sticky header's height) have settled.
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

/** Text lines an element takes (distinct line tops of its text). */
const lines = (element: Locator) => element.evaluate((node) => {
  const range = document.createRange();
  range.selectNodeContents(node);
  return new Set([...range.getClientRects()].filter((rect) => rect.width > 1).map((rect) => Math.round(rect.top))).size;
});

/** Boxes whose own text runs past their edge (a word wider than the box), allowing the last letter's spacing. */
const textPastItsBox = (scope: Locator) => scope.evaluate((root) => {
  const found: string[] = [];
  const seen = new Set<Element>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    let box = node.parentElement;
    while (box && getComputedStyle(box).display === "inline") box = box.parentElement;
    if (!box || seen.has(box)) continue;
    seen.add(box);
    const style = getComputedStyle(box);
    if (box.getClientRects().length === 0 || style.overflowX !== "visible") continue;
    const slack = 1 + (Number.parseFloat(style.letterSpacing) || 0);
    if (box.scrollWidth > box.clientWidth + slack) found.push(`"${box.textContent?.trim().slice(0, 40)}" ${box.clientWidth}px < ${box.scrollWidth}px`);
  }
  return found;
});

test.describe("staff portal at phone widths with enlarged text", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(!isMobile, "Phone widths run in the mobile project.");
    await signInStaff(page, "ADMIN");
    await serveAdminData(page.context());
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("customers: a 20px checkbox in a 44px target, a 44px bulk action, and headings apart at 4.5:1, at 100% and 200% text", async ({ page }) => {
    await page.goto("/#/admin/customers/customers");
    await waitForPlace(page, "Customers");
    const table = page.getByRole("region", { name: "Customer accounts table" }).locator("table");
    for (const [width, scale] of [[360, 1], [360, 2], [390, 2]] as const) {
      await at(page, width, scale);
      const label = `${width}px ${scale * 100}%`;
      const box = await table.getByRole("checkbox").first().boundingBox();
      const target = await table.getByRole("checkbox").first().locator("xpath=ancestor::label[1]").boundingBox();
      expect.soft(Math.min(box?.width ?? 0, box?.height ?? 0), `${label}: checkbox box`).toBeGreaterThanOrEqual(20 * scale);
      expect.soft(Math.min(target?.width ?? 0, target?.height ?? 0), `${label}: checkbox target`).toBeGreaterThanOrEqual(TARGET);
      const bulk = await page.getByRole("button", { name: /^Send verification to \d+ selected$/ }).boundingBox();
      expect.soft(bulk?.height ?? 0, `${label}: bulk action height`).toBeGreaterThanOrEqual(TARGET);
      const gaps = await table.locator("thead th").evaluateAll((headings) => {
        const range = document.createRange();
        const boxes = headings.map((heading) => { range.selectNodeContents(heading); return range.getBoundingClientRect(); });
        return boxes.slice(1).map((next, index) => next.left - boxes[index].right);
      });
      expect.soft(Math.min(...gaps), `${label}: heading gaps ${JSON.stringify(gaps)}`).toBeGreaterThanOrEqual(20);
      for (const heading of await table.locator("thead th").all()) {
        expect.soft(await backdropContrast(page, heading), `${label}: ${await heading.innerText()}`).toBeGreaterThanOrEqual(4.5);
      }
      // Staff text grows with the text size (rem, not px): the table headings are 10px at 100%.
      expect.soft(await table.locator("thead th").first().evaluate((cell) => getComputedStyle(cell).fontSize), `${label}: heading size`)
        .toBe(`${10 * scale}px`);
    }
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("catalog: filters show their whole current value, product names wrap, and the editor's close control stays 44px", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/#/admin/catalog/products");
    await waitForPlace(page, "Products");
    await page.getByRole("combobox", { name: "Filter products by status" }).selectOption({ label: "Hidden (draft)" });
    for (const width of [360, 390]) {
      await at(page, width, 2);
      for (const name of ["Filter products by category", "Filter products by status", "Filter products by readiness"]) {
        const select = page.getByRole("combobox", { name });
        const chosen = await select.evaluate((element) => (element as HTMLSelectElement).selectedOptions[0].text);
        // The value is shown as wrapping text beside the native control, never cut short.
        const shown = select.locator("xpath=..").locator("[data-select-value]");
        await expect.soft(shown, `${width}px: ${name}`).toHaveText(chosen, { timeout: 2000 });
        const clipped = await shown.evaluate((element) => element.scrollWidth > element.clientWidth + 1, undefined, { timeout: 2000 }).catch(() => true);
        expect.soft(clipped, `${width}px: ${name} shows "${chosen}" whole`).toBe(false);
      }
      await expect(page.locator("[data-product-name]").first(), "product names are listed").toBeVisible({ timeout: 2000 });
      for (const nameLine of await page.locator("[data-product-name]").all()) {
        const clipped = await nameLine.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
        expect.soft(clipped, `${width}px: ${await nameLine.innerText()} is cut short`).toBe(false);
      }
      expect(await pageOverflow(page), `${width}px`).toBeLessThanOrEqual(0);
    }
    await page.evaluate(() => { location.hash = "/admin/catalog/products?product=prod-linen-shirt"; });
    const close = await page.getByRole("dialog", { name: "Edit product", exact: true }).getByRole("button", { name: "Close product editor" }).boundingBox();
    expect(Math.min(close?.width ?? 0, close?.height ?? 0)).toBeGreaterThanOrEqual(TARGET);
  });

  test("product editor: the enlarged labels and image badges stay inside their boxes; at 100% text the pairs stay side by side", async ({ page }) => {
    await page.goto("/#/admin/catalog/products?product=prod-linen-shirt");
    const dialog = page.getByRole("dialog", { name: "Edit product", exact: true });
    await expect(dialog).toBeVisible();
    const left = (part: Locator) => part.evaluate((element) => Math.round(element.getBoundingClientRect().left));
    for (const [width, scale] of [[360, 2], [390, 2], [360, 1]] as const) {
      await at(page, width, scale);
      const label = `${width}px ${scale * 100}%`;
      expect.soft(await textPastItsBox(dialog), label).toEqual([]);
      // Side by side, the second starts further right; stacked, both start at the column's edge.
      const [price, compareAt] = [await left(dialog.getByLabel("Price (KES)", { exact: true })), await left(dialog.getByLabel("Compare-at price (optional)", { exact: true }))];
      const [preview, heading] = [await left(dialog.locator("ol[aria-label='Product images'] > li > div").first()), await left(dialog.getByRole("heading", { name: /^Image 1\b/ }))];
      expect.soft(compareAt > price, `${label}: price fields side by side`).toBe(scale === 1);
      expect.soft(heading > preview, `${label}: thumbnail beside "Image 1"`).toBe(scale === 1);
    }
  });

  test("storefront editor: section fields get the column at 360px with 200% text", async ({ page }) => {
    await page.goto("/#/admin/storefront/editor");
    await waitForPlace(page, "Storefront editor");
    await at(page, 360, 2);
    const section = page.locator("article").first();
    const field = section.getByRole("textbox").first();
    const [fieldWidth, panelWidth] = [await field.evaluate((element) => element.getBoundingClientRect().width),
      await section.locator("xpath=ancestor::section[1]").evaluate((element) => element.clientWidth)];
    // No card inside the card: the field is as wide as the panel's own content (its padding aside).
    expect(fieldWidth, `field ${fieldWidth}px in a ${panelWidth}px panel`).toBeGreaterThanOrEqual(200);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("real-length order, return and refund numbers and a three-digit readiness count stay inside the phone at 200% text", async ({ page, context }) => {
    test.setTimeout(180_000);
    // The server's numbers: NM-<year><month>-<20 hex characters> (generateOrderNumber), RMA-<order>-<n> and RF-<order>-<n>.
    const fixtures = staffOrders();
    let serialised = JSON.stringify(fixtures);
    fixtures.forEach((item, index) => { serialised = serialised.split(item.orderNumber).join(REAL_ORDER_NUMBERS[index]); });
    const orders: StaffOrder[] = JSON.parse(serialised);
    // Every staff read (orders, worklists, dashboard, sales report) now carries these numbers.
    await serveAdminData(context, orders);
    const [preparing, returned] = orders;
    const [request, refund] = [returned.returns[0], returned.refunds[0]];
    await context.route("**/api/admin/attention", (route) => route.fulfill({ json: { items: [
      fixtureAttention({ key: `order-fulfil:${preparing.id}`, title: `Order ${preparing.orderNumber} is paid and awaiting preparation`, orderId: preparing.id, orderNumber: preparing.orderNumber }),
      fixtureAttention({ key: `return:${request.id}`, type: "RETURN_AWAITING_RECEIPT", title: `Return ${request.number} awaits receipt`, detail: "Record it when it arrives.", orderId: returned.id, orderNumber: returned.orderNumber }),
      fixtureAttention({ key: `refund:${refund.id}`, type: "REFUND_ACTION", title: `Refund ${refund.number} is processing`, detail: "Record the M-Pesa reference once it completes.", orderId: returned.id, orderNumber: returned.orderNumber }),
    ] } }));
    // 230 products still waiting for images, as on the demonstration store: the readiness shortcut shows a three-digit count.
    const products = Array.from({ length: 230 }, (_, index) => fixtureProduct({ id: `prod-sample-${index}`, name: `Sample product ${index + 1}` }));
    await context.route("**/api/admin/catalog", (route) => route.fulfill({ json: fixtureAdminSnapshot({ products }) }));
    for (const [route, h1] of [
      ["/admin/orders/orders?view=all", "Orders"], ["/admin/orders/returns", "Returns"], ["/admin/orders/refunds", "Refunds"],
      ["/admin/overview/dashboard", "Dashboard"], ["/admin/overview/analytics", "Sales report"], ["/admin/catalog/products", "Products"],
    ] as const) {
      await page.goto(`/#${route}`);
      await waitForPlace(page, h1);
      for (const width of [360, 390]) {
        await at(page, width, 2);
        const label = `${h1} at ${width}px, 200% text`;
        expect.soft(await pageOverflow(page), `${label}: page overflow`).toBeLessThanOrEqual(0);
        expect.soft(await textPastItsBox(page.getByRole("main")), `${label}: text past its box`).toEqual([]);
      }
    }
    // The order workspace opened from the list, at the narrowest width.
    await page.goto("/#/admin/orders/orders");
    await waitForPlace(page, "Orders");
    await at(page, 360, 2);
    await page.getByRole("region", { name: "Processing", exact: true }).getByRole("button", { name: `Open order ${preparing.orderNumber}` }).click();
    const workspace = page.getByRole("region", { name: `Order ${preparing.orderNumber}` });
    await expect(workspace).toBeVisible();
    expect.soft(await pageOverflow(page), "order workspace at 360px, 200% text: page overflow").toBeLessThanOrEqual(0);
    expect.soft(await textPastItsBox(workspace), "order workspace at 360px, 200% text: text past its box").toEqual([]);
  });
});

test.describe("storefront at phone widths with enlarged text", () => {
  test("checkout: delivery descriptions read in lines; the sandbox disclosure keeps M-Pesa whole; receipt details stack when narrow", async ({ page, context, isMobile }) => {
    test.skip(!isMobile, "Phone widths run in the mobile project.");
    test.setTimeout(90_000);
    await signInCustomer(page, [linenCartLine]);
    await serveDemonstrationStore(context);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#/checkout");
    await page.getByRole("button", { name: "Change delivery details" }).click();
    const methods = page.getByRole("group", { name: "Delivery method" });
    // The innermost section holding the choices: the delivery step's column.
    const step = page.locator("section").filter({ has: methods }).last();
    for (const width of [360, 390]) {
      await at(page, width, 2);
      // No card around the choices: each choice is as wide as the step's column.
      const column = await step.evaluate((element) => element.getBoundingClientRect().width);
      for (const choice of await methods.locator("label").all()) {
        expect.soft(await choice.evaluate((element) => element.getBoundingClientRect().width), `${width}px: choice spans the column`).toBeGreaterThanOrEqual(column - 1);
      }
      // Read in lines, not a word or two per line: at least two words a line on average.
      for (const description of await methods.locator("[id$='-description']").all()) {
        const words = (await description.innerText()).trim().split(/\s+/).length;
        expect.soft(words / await lines(description), `${width}px: "${await description.innerText()}" words per line`).toBeGreaterThanOrEqual(2);
      }
      expect(await pageOverflow(page), `${width}px checkout`).toBeLessThanOrEqual(0);
    }
    await at(page, 390, 1);
    await page.getByRole("button", { name: "Continue to review", exact: true }).click();
    await page.getByRole("button", { name: /Reserve order/i }).first().click();
    const payment = page.getByRole("region", { name: "Payment", exact: true });
    const summary = payment.locator("summary").filter({ hasText: "sandbox instead" });
    await expect(summary).toBeVisible();
    for (const width of [360, 390]) {
      await at(page, width, 2);
      const tops = await summary.evaluate((root) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const found = new Set<number>();
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const index = node.textContent?.indexOf("M-Pesa") ?? -1;
          if (index < 0) continue;
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + "M-Pesa".length);
          for (const rect of range.getClientRects()) if (rect.width > 1) found.add(Math.round(rect.top));
        }
        return found.size;
      });
      expect.soft(tops, `${width}px: "M-Pesa" lines`).toBe(1);
      expect(await pageOverflow(page), `${width}px payment`).toBeLessThanOrEqual(0);
    }
    await at(page, 390, 1);
    await payment.getByRole("button", { name: "Pay with a demonstration payment" }).click();
    await page.getByRole("link", { name: "View order details" }).click();
    const details = page.getByRole("dialog", { name: "Receipt details" }).getByRole("region", { name: "Order details" });
    const terms = details.locator("dl").first().locator("dt");
    await expect(terms.first()).toBeVisible();
    for (const width of [360, 390]) {
      await at(page, width, 2);
      for (const term of await terms.all()) {
        expect.soft(await lines(term), `${width}px: "${await term.innerText()}" on one line`).toBe(1);
        // Stacked: each value starts below its label, at the label's left edge.
        const [label, value] = [await term.boundingBox(), await term.locator("xpath=following-sibling::dd[1]").boundingBox()];
        expect.soft((value?.y ?? 0) >= (label?.y ?? 0) + (label?.height ?? 0) - 1, `${width}px: "${await term.innerText()}" stacked`).toBe(true);
      }
    }
    await at(page, 1280, 1);
    const [label, value] = [await terms.first().boundingBox(), await terms.first().locator("xpath=following-sibling::dd[1]").boundingBox()];
    expect(Math.abs((value?.y ?? 0) - (label?.y ?? 0)), "side by side where there is room").toBeLessThan(4);
  });
});

/* ------------------------------------------------------------------ */
/* O28: forced colours                                                 */
/* ------------------------------------------------------------------ */

/** Waits until no transition or animation is running, so colours are final. */
const settled = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))));
/** The colour behind the control as painted: its own background, or the first non-transparent one behind it. */
const background = (control: Locator) => control.evaluate((element) => {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const colour = getComputedStyle(node).backgroundColor;
    if (!/^rgba\(.*,\s*0\)$/.test(colour) && colour !== "transparent") return colour;
  }
  return "rgb(255, 255, 255)";
});
const border = (control: Locator) => control.evaluate((element) => getComputedStyle(element).borderTopColor);

/** WCAG contrast ratio of two computed colours, a translucent one laid over white (the emulated Canvas). */
function contrast(first: string, second: string) {
  const luminance = (colour: string) => {
    const [r, g, b, alpha = 1] = colour.match(/[\d.]+/g)!.map(Number);
    return 0.2126 * channel(r, alpha) + 0.7152 * channel(g, alpha) + 0.0722 * channel(b, alpha);
  };
  const channel = (value: number, alpha: number) => {
    const c = (value * alpha + 255 * (1 - alpha)) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [light, dark] = [luminance(first), luminance(second)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** A selected or current control stands apart from an unselected neighbour by 3:1 or more (its fill, or its border). */
async function expectDistinct(page: Page, label: string, chosen: Locator, other: Locator, part: "fill" | "border" = "fill") {
  await settled(page);
  const read = part === "fill" ? background : border;
  const [on, off] = [await read(chosen), await read(other)];
  expect.soft(contrast(on, off), `${label}: selected ${on} vs unselected ${off}`).toBeGreaterThanOrEqual(3);
}

/** Every visible text inside the control reads at 4.5:1 on what is painted behind it. */
async function expectReadable(page: Page, label: string, control: Locator) {
  await settled(page);
  const texts = await control.evaluate((root) => {
    const found: { text: string; colour: string; behind: string }[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const holder = node.parentElement!;
      const box = holder.getBoundingClientRect();
      if (!node.textContent?.trim() || box.width <= 1 || box.height <= 1) continue;
      let behind = "rgb(255, 255, 255)";
      for (let at: Element | null = holder; at; at = at.parentElement) {
        const colour = getComputedStyle(at).backgroundColor;
        if (!/^rgba\(.*,\s*0\)$/.test(colour) && colour !== "transparent") { behind = colour; break; }
      }
      found.push({ text: node.textContent.trim(), colour: getComputedStyle(holder).color, behind });
    }
    return found;
  });
  expect(texts.length, `${label}: has visible text`).toBeGreaterThan(0);
  for (const { text, colour, behind } of texts) {
    expect.soft(contrast(colour, behind), `${label}: "${text}" ${colour} on ${behind}`).toBeGreaterThanOrEqual(4.5);
  }
}

/** Pressing a toggle changes what is painted behind it by 3:1 or more. */
async function expectToggleShows(page: Page, label: string, toggle: Locator) {
  await settled(page);
  const before = await background(toggle);
  await toggle.click();
  await settled(page);
  const after = await background(toggle);
  expect.soft(contrast(before, after), `${label}: ${before} before pressing, ${after} after`).toBeGreaterThanOrEqual(3);
}

/** Enough products for a second listing page (12 a page). */
const secondPage = Array.from({ length: 14 }, (_, index) => ({
  ...poloShirt, id: `prod-page-${index}`, slug: `page-shirt-${index}`, name: `Listing Shirt ${index + 1}`,
  variants: poloShirt.variants.map((variant) => ({ ...variant, id: `${variant.id}-page-${index}`, sku: `${variant.sku}-PAGE-${index}` })),
}));

test.describe("forced colours", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  });

  test("shoppers' selected and current controls keep their state visible", async ({ page, isMobile }) => {
    await signInCustomer(page, [linenCartLine]);
    await page.goto(`/#/product/${linenShirt.id}`);
    const sizes = page.getByRole("group", { name: /^Size/ });
    await sizes.getByRole("button", { name: "S", exact: true }).click();
    await expectDistinct(page, "variant option", sizes.getByRole("button", { name: "S", exact: true }), sizes.getByRole("button", { name: "M", exact: true }));
    await expectReadable(page, "variant option", sizes.getByRole("button", { name: "S", exact: true }));
    // An image fills the thumbnail: its border carries the state.
    const thumbnails = page.getByRole("list", { name: "Choose an image" }).getByRole("button");
    await expect(thumbnails).toHaveCount(2);
    await expectDistinct(page, "gallery thumbnail", thumbnails.nth(0), thumbnails.nth(1), "border");
    expect.soft(contrast(await border(thumbnails.nth(0)), await background(thumbnails.nth(0).locator("xpath=.."))), "current thumbnail's border on the page")
      .toBeGreaterThanOrEqual(3);
    await expectToggleShows(page, "wishlist toggle", page.getByRole("main").getByRole("button", { name: /wishlist/i }).first());

    if (!isMobile) {
      await page.goto("/#/shop");
      const current = page.locator("header a[aria-current='page']").first();
      await expect(current).toBeVisible();
      await expectDistinct(page, "main navigation", current, page.locator("header nav a:not([aria-current])").first());
      await expectReadable(page, "main navigation", current);
      await page.getByRole("button", { name: "Departments", exact: true }).click();
      const tabs = page.getByRole("tablist", { name: "Departments" }).getByRole("tab");
      await expectDistinct(page, "department tab", tabs.nth(0), tabs.nth(1));
      await expectReadable(page, "department tab", tabs.nth(0));
      await page.keyboard.press("Escape");
    }

    await page.goto("/#/account/profile");
    const account = page.getByRole("navigation", { name: /account/i });
    await expectDistinct(page, "account navigation", account.locator("[aria-current='page']"), account.locator("a:not([aria-current])").first());
    await expectReadable(page, "account navigation", account.locator("[aria-current='page']"));

    await serveDemonstrationStore(page.context());
    await page.goto("/#/checkout");
    // The step itself is marked, not the connector line before it.
    const step = (index: number) => page.getByRole("navigation", { name: "Checkout steps" }).locator("li").nth(index).locator(":scope > :not([aria-hidden='true'])");
    await expect(page.locator("li[aria-current='step']")).toHaveCount(1);
    await expectDistinct(page, "checkout step", step(1), step(2));
    await expectReadable(page, "checkout step", step(1));
  });

  test("listing, menu and sign-in controls keep their current and pressed state visible", async ({ page, isMobile }) => {
    await page.goto("/#/login");
    await page.getByLabel("Password", { exact: true }).fill("sample-password");
    // Its name changes when pressed ("Show password" → "Hide password").
    await expectToggleShows(page, "password toggle", page.getByRole("button", { name: /^(Show|Hide) password$/ }));

    await page.route("**/api/catalog", (route) => route.fulfill({ json: fixtureSnapshot({ products: [...fixtureSnapshot().products, ...secondPage] }) }));
    await page.goto("/#/shop");
    // A hash change keeps the document: reload so the catalog is fetched again.
    await page.reload();
    const pages = page.getByRole("navigation", { name: "Pagination" });
    await expectDistinct(page, "current page", pages.locator("[aria-current='page']"), pages.getByRole("link", { name: /2/ }).first());
    await expectReadable(page, "current page", pages.locator("[aria-current='page']"));

    if (isMobile) {
      await page.goto("/#/shop?cat=fashion");
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      const drawer = page.getByRole("dialog").filter({ has: page.locator("[aria-current]") });
      const department = drawer.locator("a[aria-current]").first();
      await expectDistinct(page, "drawer department", department, drawer.locator("a:not([aria-current])").first());
      await expectReadable(page, "drawer department", department);
    } else {
      // The only designer is the current one: its neighbour is a category in the same filter column.
      await page.goto("/#/shop?designer=test-studio");
      const designer = page.getByRole("navigation", { name: "Designers" }).locator("a[aria-current='true']");
      await expectDistinct(page, "listing filter", designer, page.getByRole("navigation", { name: "Categories" }).locator("a:not([aria-current])").first());
      await expectReadable(page, "listing filter", designer);
    }
  });

  test("staff controls keep their pressed and current state visible", async ({ page, isMobile }) => {
    test.skip(isMobile, "The staff controls are checked at desktop width.");
    await signInStaff(page, "ADMIN");
    await serveAdminData(page.context());
    await page.goto("/#/admin/catalog/products");
    await waitForPlace(page, "Products");
    const navigation = page.getByRole("navigation", { name: /admin/i }).first();
    await expectDistinct(page, "admin navigation", navigation.locator("a[aria-current='page']"), navigation.locator("a:not([aria-current])").first());
    await expectReadable(page, "admin navigation", navigation.locator("a[aria-current='page']"));
    await expectToggleShows(page, "needs-images toggle", page.getByRole("button", { name: /^Needs images/ }));
    await page.evaluate(() => { location.hash = "/admin/customers/discounts"; });
    await waitForPlace(page, "Discounts");
    const presets = page.getByRole("button", { pressed: true }).filter({ hasText: /^(Percentage|Fixed amount)$/ });
    await expect(presets).toHaveCount(1);
    await expectDistinct(page, "discount kind", presets, page.getByRole("button", { pressed: false }).filter({ hasText: /^(Percentage|Fixed amount)$/ }));
    await expectReadable(page, "discount kind", presets);
    await page.evaluate(() => { location.hash = "/admin/storefront/preview"; });
    await waitForPlace(page, "Draft preview: shoppers can't see this");
    await expectDistinct(page, "preview device", page.locator("button[aria-pressed='true']").first(), page.locator("button[aria-pressed='false']").first());
    await expectReadable(page, "preview device", page.locator("button[aria-pressed='true']").first());
  });

  test("the active search suggestion is outlined at 3:1 or more, and stands out in forced colours", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "none" });
    await page.goto("/#/");
    const search = page.getByRole("combobox", { name: "Search products" }).first();
    await search.fill("shirt");
    await expect(page.locator("[role='option']").first()).toBeVisible();
    await search.press("ArrowDown");
    const active = page.locator("[role='option'][aria-selected='true']");
    await expect(active).toHaveCount(1);
    await settled(page);
    const ring = await active.evaluate((element) => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth), color: style.outlineColor, background: style.backgroundColor };
    });
    expect(ring.style).toBe("solid");
    expect(ring.width).toBeGreaterThanOrEqual(2);
    const contrast = await page.evaluate(({ color, background: behind }) => {
      const parse = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const luminance = (rgb: number[]) => {
        const [r, g, b] = rgb.map((channel) => { const c = channel / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const [a, b] = [luminance(parse(color)), luminance(parse(behind))].sort((x, y) => y - x);
      return (a + 0.05) / (b + 0.05);
    }, ring);
    expect(contrast).toBeGreaterThanOrEqual(3);

    await page.emulateMedia({ forcedColors: "active" });
    await expectDistinct(page, "search suggestion", active, page.locator("[role='option'][aria-selected='false']").first());
    await expectReadable(page, "search suggestion", active);
  });
});

/* ------------------------------------------------------------------ */
/* The browser's own font-size setting                                 */
/* ------------------------------------------------------------------ */

/**
 * The browser's font-size setting at 20px (Chrome's "Large"): rem and em follow it, in media queries too, so the
 * layout's breakpoints move up by a quarter (80rem is then 1600px). Chromium only.
 */
async function largerDefaultFont(page: Page) {
  const session = await page.context().newCDPSession(page);
  await session.send("Page.setFontSizes", { fontSizes: { standard: 20, fixed: 16 } });
}

/** Two frames: effects that run after a dialog opens (closing it again, say) have run. */
const twoFrames = (page: Page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

test.describe("a larger browser font size", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, "The widths between a pixel and a rem breakpoint are desktop widths.");
    await largerDefaultFont(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("at 1400px, below the 1600px wide layout, the menu and the filters open and stay open", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/#/");
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await twoFrames(page);
    await expect(page.getByRole("dialog", { name: "Navigation menu" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto("/#/shop");
    await page.getByRole("button", { name: /^Filters/ }).click();
    await twoFrames(page);
    await expect(page.getByRole("dialog", { name: "Product filters" })).toBeVisible();
  });

  test("at 1400px the staff navigation opens from the menu and stays open", async ({ page }) => {
    await signInStaff(page);
    await serveAdminData(page.context());
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/#/admin/overview/dashboard");
    await waitForPlace(page, "Dashboard");
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await twoFrames(page);
    await expect(page.getByRole("dialog", { name: "Admin navigation" })).toBeVisible();
  });

  test("at 800px, still the one-column layout, receipt sections start closed as on a phone", async ({ page, context }) => {
    await signInCustomer(page);
    const delivered = fixtureDeliveredOrder(order);
    await context.route("**/api/orders?*", (route) => route.fulfill({ json: orderPage([delivered]) }));
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto("/#/account/orders");
    await page.getByRole("button", { name: "Details", exact: true }).first().click();
    const receipt = page.getByRole("dialog", { name: "Receipt details" });
    const items = receipt.locator("details").filter({ hasText: "Items and totals" });
    await expect(items).toBeVisible();
    expect(await items.evaluate((section: HTMLDetailsElement) => section.open)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Selects, lists and actions at 200% text (O-a, O-c, editor targets)  */
/* ------------------------------------------------------------------ */

/** Picks each enabled select's longest option, so the checks see the widest value it can show. */
async function chooseLongest(scope: Locator) {
  for (const select of await scope.locator("select:not(:disabled)").all()) {
    if (!(await select.isVisible())) continue;
    const label = await select.evaluate((element: HTMLSelectElement) =>
      [...element.options].filter((option) => !option.disabled).map((option) => option.text).sort((a, b) => b.length - a.length)[0] ?? null);
    if (label) await select.selectOption({ label });
  }
}

/**
 * Selects that cut their chosen value short. A wrapping select shows it as text beside the control, which must match
 * and fit; a native select draws it in one line, which must fit its box beside the arrow.
 */
const selectProblems = (scope: Locator) => scope.locator("select").evaluateAll((selects) => selects.flatMap((element) => {
  const select = element as HTMLSelectElement;
  if (select.getClientRects().length === 0) return [];
  const chosen = select.selectedOptions[0]?.text ?? "";
  const label = select.labels?.[0];
  const name = select.getAttribute("aria-label")
    ?? (label ? [...label.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join("").trim() || label.textContent?.trim() : null)
    ?? select.id;
  const shown = select.parentElement?.querySelector<HTMLElement>("[data-select-value]");
  if (shown) {
    // The box also stays inside its card, section or dialog: a wide value must not force its column wider.
    const box = select.parentElement!.getBoundingClientRect();
    const holder = select.parentElement!.parentElement!.closest("li, section, dialog, [role=dialog]");
    const edge = holder ? holder.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(holder).paddingRight) : Infinity;
    if (box.right > edge + 1) return [`${name}: box ends ${Math.round(box.right - edge)}px past its container`];
    return shown.textContent === chosen && shown.scrollWidth <= shown.clientWidth + 1 ? [] : [`${name}: shows "${shown.textContent}" for "${chosen}"`];
  }
  const style = getComputedStyle(select);
  const context = document.createElement("canvas").getContext("2d")!;
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const room = select.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight) - 20;
  const needed = context.measureText(chosen).width;
  return needed <= room ? [] : [`${name}: "${chosen}" needs ${Math.ceil(needed)}px, has ${Math.floor(room)}px`];
}));

async function expectWholeValues(page: Page, label: string, scope: Locator) {
  for (const width of [360, 390]) {
    await at(page, width, 2);
    expect.soft(await selectProblems(scope), `${label} at ${width}px`).toEqual([]);
  }
}

test.describe("staff forms at phone widths with enlarged text", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(!isMobile, "Phone widths run in the mobile project.");
    await signInStaff(page, "ADMIN");
    await serveAdminData(page.context());
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("every select shows its whole value; the product editor's actions are 44px; the history button keeps its text inside", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/#/admin/catalog/products?product=prod-linen-shirt");
    const editor = page.getByRole("dialog", { name: "Edit product", exact: true });
    await expect(editor).toBeVisible();
    for (const scale of [1, 2] as const) {
      await at(page, 360, scale);
      for (const name of ["Save product", "Preview", "Delete", "Close product editor"]) {
        const box = await editor.getByRole(name === "Preview" ? "link" : "button", { name, exact: true }).boundingBox();
        expect.soft(Math.min(box?.width ?? 0, box?.height ?? 0), `360px ${scale * 100}%: ${name}`).toBeGreaterThanOrEqual(TARGET);
      }
    }
    await at(page, 390, 1);
    await chooseLongest(editor);
    await expectWholeValues(page, "product editor", editor);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
    await expect(editor).toBeHidden();

    await page.goto("/#/admin/catalog/products");
    await waitForPlace(page, "Products");
    await at(page, 390, 1);
    await page.getByRole("button", { name: "Edit Shirts" }).click();
    const category = page.getByRole("dialog", { name: "Edit category" });
    await expect(category).toBeVisible();
    await expectWholeValues(page, "category form", category);
    await page.keyboard.press("Escape");

    await page.goto("/#/admin/customers/discounts");
    await waitForPlace(page, "Discounts");
    await at(page, 390, 1);
    await page.getByRole("button", { name: "Category", exact: true }).click();
    await chooseLongest(page.getByRole("main"));
    await expectWholeValues(page, "discounts", page.getByRole("main"));

    await page.goto("/#/admin/storefront/editor");
    await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
    await waitForPlace(page, "Storefront editor");
    await at(page, 390, 1);
    await chooseLongest(page.getByRole("main"));
    await expectWholeValues(page, "storefront editor", page.getByRole("main"));
    await at(page, 360, 2);
    const history = page.getByRole("button", { name: "Publication history" }).locator("xpath=ancestor::section[1]");
    expect.soft(await textPastItsBox(history), "publication history at 360px").toEqual([]);
  });
});

test.describe("staff lists at desktop widths with enlarged text", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop widths run in the desktop project.");
    await signInStaff(page, "ADMIN");
    await serveAdminData(page.context());
  });

  test("at 200% text the order list stacks each order (no columns too narrow for a total), keeping its columns at 100%", async ({ page }) => {
    await page.goto("/#/admin/orders/orders");
    await waitForPlace(page, "Orders");
    const columns = page.getByRole("main").getByText("Placed · delivery", { exact: true });
    for (const width of [1024, 1280]) {
      await at(page, width, 2);
      await expect.soft(columns, `${width}px 200%: stacked, no column headings`).toBeHidden();
      expect.soft(await textPastItsBox(page.getByRole("main")), `${width}px 200%`).toEqual([]);
      expect(await pageOverflow(page), `${width}px 200%`).toBeLessThanOrEqual(0);
      await at(page, width, 1);
      await expect.soft(columns, `${width}px 100%: the column headings show`).toBeVisible();
    }
  });
});

test.describe("shopper selects at phone widths with enlarged text", () => {
  test("the cart's address, the shop's sort and a return's reason show their whole value", async ({ page, context, isMobile }) => {
    test.skip(!isMobile, "Phone widths run in the mobile project.");
    test.setTimeout(120_000);
    await signInCustomer(page, [linenCartLine]);
    const delivered = fixtureDeliveredOrder(order);
    await context.route("**/api/orders?*", (route) => route.fulfill({ json: orderPage([delivered]) }));
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/#/cart");
    await expect(page.getByRole("combobox", { name: "Delivery address" })).toBeVisible();
    await expectWholeValues(page, "cart", page.getByRole("main"));

    await at(page, 390, 1);
    await page.goto("/#/shop");
    await chooseLongest(page.getByRole("main"));
    await expectWholeValues(page, "shop", page.getByRole("main"));

    await at(page, 390, 1);
    await page.goto("/#/account/orders");
    await page.getByRole("button", { name: "Request a return", exact: true }).first().click();
    const request = page.getByRole("dialog", { name: "Request a return" });
    await expect(request).toBeVisible();
    await chooseLongest(request);
    await expectWholeValues(page, "return request", request);
  });
});
