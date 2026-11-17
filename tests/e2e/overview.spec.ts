import type { Page } from "@playwright/test";
import { nairobiDate } from "../../src/utils/nairobiDate";
import { layoutProblems, serveAdminData, waitForPlace } from "./adminFixtures";
import { expect, signInStaff, test } from "./fixtures";
import { fixtureAttention } from "../../src/test-support/orderFixtures";

/** An address as an exact URL pattern. */
const exactly = (route: string) => new RegExp(`#${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

/** The query of every staff order-list request, oldest first. */
function listRequests(page: Page) {
  const queries: Record<string, string>[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/orders/admin/all") queries.push(Object.fromEntries(url.searchParams.entries()));
  });
  return queries;
}

test.describe("worklist filters in the address", () => {
  test("a filtered Orders deep link sends its filters, survives a reload, and Back from an opened order returns to it", async ({ page }) => {
    await signInStaff(page, "ADMIN");
    const [processing] = await serveAdminData(page.context());
    const queries = listRequests(page);
    const today = nairobiDate(new Date().toISOString());
    const address = `/admin/orders/orders?view=all&delivery=${processing.deliveryMethod}&from=${today}&to=${today}&status=PROCESSING&payment=PAID`;
    const sent = { deliveryMethod: processing.deliveryMethod, orderedFrom: today, orderedTo: today, status: "PROCESSING", paymentStatus: "PAID", page: "1", limit: "20" };

    await page.goto(`/#${address}`);
    await waitForPlace(page, "Orders");
    const list = page.getByRole("region", { name: "All orders" });
    await expect(list.getByText("1 order", { exact: true })).toBeVisible();
    expect(queries).toEqual([sent]);

    await page.reload();
    await waitForPlace(page, "Orders");
    await expect(page).toHaveURL(exactly(address));
    await expect(list.getByText("1 order", { exact: true })).toBeVisible();
    expect(queries.at(-1)).toEqual(sent);
    await expect(page.getByLabel("Order status")).toHaveValue("PROCESSING");
    await expect(page.getByLabel("Payment")).toHaveValue("PAID");
    await expect(page.getByLabel("Ordered from")).toHaveValue(today);
    await expect(page.getByLabel("Ordered to")).toHaveValue(today);

    await list.getByRole("button", { name: `Open order ${processing.orderNumber}` }).click();
    await expect(page).toHaveURL(exactly(`${address}&order=${processing.id}`));
    await expect(page.getByRole("heading", { name: `Order ${processing.orderNumber}` })).toBeFocused();
    await page.goBack();
    await expect(page).toHaveURL(exactly(address));
    await expect(page.getByRole("heading", { name: `Order ${processing.orderNumber}` })).toHaveCount(0);
    await expect(list.getByRole("button", { name: `Open order ${processing.orderNumber}` })).toBeVisible();
    await expect(page.getByLabel("Order status")).toHaveValue("PROCESSING");

    // Whole Nairobi days: a range ending yesterday lists nothing placed today, and the filter replaces the entry.
    const yesterday = nairobiDate(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    const entries = await page.evaluate(() => history.length);
    await page.getByLabel("Ordered to").fill(yesterday);
    await expect(list.getByText("No orders match these filters.")).toBeVisible();
    expect(queries.at(-1)).toMatchObject({ orderedFrom: yesterday, orderedTo: yesterday, page: "1" });
    expect(await page.evaluate(() => history.length)).toBe(entries);
  });

  test("malformed filters are corrected in place and never sent", async ({ page }) => {
    await signInStaff(page, "ADMIN");
    await serveAdminData(page.context());
    const queries = listRequests(page);
    await page.goto("/#/admin/orders/orders?view=all&delivery=DRONE&from=2026-02-30&status=toString&page=0");
    await waitForPlace(page, "Orders");
    await expect(page).toHaveURL(exactly("/admin/orders/orders?view=all"));
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) expect(query).toEqual({ page: "1", limit: "20" });
  });
});

test.describe("overview", () => {
  test.beforeEach(async ({ page }) => {
    await signInStaff(page, "ADMIN");
  });

  test("figures, needs-action rows and recent orders open the records behind them", async ({ page }) => {
    const [processing] = await serveAdminData(page.context());
    const queries = listRequests(page);
    await page.goto("/#/admin/overview/dashboard");
    await waitForPlace(page, "Dashboard");
    const main = page.getByRole("main");
    await expect(main.getByText("1–17 November 2026 · Nairobi time (EAT)")).toBeVisible();
    await expect(main.getByRole("group", { name: "Period" }).getByRole("link", { name: "This month" })).toHaveAttribute("aria-current", "true");
    const back = async () => {
      await page.goBack();
      await waitForPlace(page, "Dashboard");
    };

    await main.getByRole("link", { name: "Orders placed 2", exact: true }).click();
    await waitForPlace(page, "Orders");
    await expect(page).toHaveURL(exactly("/admin/orders/orders?view=all&from=2026-11-01&to=2026-11-17"));
    expect(queries.at(-1)).toEqual({ orderedFrom: "2026-11-01", orderedTo: "2026-11-17", page: "1", limit: "20" });
    await back();

    await main.getByRole("link", { name: "Cancelled 0", exact: true }).click();
    await waitForPlace(page, "Orders");
    await expect(page).toHaveURL(exactly("/admin/orders/orders?view=all&from=2026-11-01&to=2026-11-17&status=CANCELLED"));
    expect(queries.at(-1)).toEqual({ orderedFrom: "2026-11-01", orderedTo: "2026-11-17", status: "CANCELLED", page: "1", limit: "20" });
    await back();

    await main.getByRole("link", { name: "Net sales KES 2,488", exact: true }).click();
    await waitForPlace(page, "Sales report");
    await expect(page).toHaveURL(exactly("/admin/overview/analytics"));
    const figures = main.getByRole("region", { name: "Figures for this period" });
    await expect(figures.getByText("KES 2,488")).toBeVisible();
    await expect(main.getByText("1–17 November 2026 · Nairobi time (EAT)")).toBeVisible();
    await back();

    await main.getByRole("link", { name: "Refunds being sent: 1", exact: true }).click();
    await waitForPlace(page, "Refunds");
    await expect(page).toHaveURL(exactly("/admin/orders/refunds?status=PROCESSING"));
    await expect(main.getByText("1 refund", { exact: true })).toBeVisible();
    await back();

    for (const [name, status, rows] of [["Low-stock SKUs: 1", "LOW_STOCK", 1], ["Out-of-stock SKUs: 2", "OUT_OF_STOCK", 2]] as const) {
      await main.getByRole("link", { name, exact: true }).click();
      await waitForPlace(page, "Stock");
      await expect(page).toHaveURL(exactly(`/admin/catalog/stock?status=${status}`));
      await expect(main.getByRole("region", { name: "Stock by SKU table" }).locator("tbody tr")).toHaveCount(rows);
      await back();
    }

    await main.getByRole("link", { name: "Orders being prepared: 1", exact: true }).click();
    await waitForPlace(page, "Orders");
    await expect(page).toHaveURL(exactly("/admin/orders/orders"));
    await expect(main.getByRole("region", { name: "Processing", exact: true }).getByText("1 order", { exact: true })).toBeVisible();
    await back();

    await main.getByRole("link", { name: new RegExp(`^Order ${processing.orderNumber}, Wanjiku Kamau-Odhiambo, Processing, KES`) }).click();
    await expect(page.getByRole("heading", { name: `Order ${processing.orderNumber}` })).toBeVisible();
    await expect(page).toHaveURL(exactly(`/admin/orders/orders?view=all&order=${processing.id}`));
    await back();

    // Another period: the address, the range line and every money link follow it.
    await main.getByRole("link", { name: "This week", exact: true }).click();
    await expect(page).toHaveURL(exactly("/admin/overview/dashboard?period=week"));
    await expect(main.getByText("16–17 November 2026 · Nairobi time (EAT)")).toBeVisible();
    await expect(main.getByRole("link", { name: "Net sales KES 2,488", exact: true })).toHaveAttribute("href", "#/admin/overview/analytics?period=week");
  });

  test("a failed first load reads Unavailable with Retry; a failed refresh keeps the last figures, marked", async ({ page }) => {
    await serveAdminData(page.context());
    let failing = true;
    await page.context().route("**/api/admin/analytics/dashboard*", (route) => (failing
      ? route.fulfill({ status: 503, json: { error: "Service unavailable" } })
      : route.fallback()));
    await page.goto("/#/admin/overview/dashboard");
    await waitForPlace(page, "Dashboard");
    const main = page.getByRole("main");
    const alert = main.getByRole("alert");
    await expect(alert).toContainText("The figures couldn't be loaded.");
    await expect(main.getByRole("region", { name: "Figures for this period" }).getByText("Unavailable")).toHaveCount(5);
    await expect(main.getByText(/^(0|KES 0)$/)).toHaveCount(0);

    failing = false;
    await alert.getByRole("button", { name: "Retry" }).click();
    await expect(main.getByText("Updated 14:05")).toBeVisible();
    await expect(main.getByRole("link", { name: "Net sales KES 2,488", exact: true })).toBeVisible();

    failing = true;
    await main.getByRole("button", { name: "Refresh" }).click();
    await expect(main.getByRole("alert")).toContainText("Last updated 14:05. Couldn't refresh.");
    await expect(main.getByRole("link", { name: "Net sales KES 2,488", exact: true })).toBeVisible();
    await expect(main.getByRole("alert").getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("Orders in the navigation names this staff member's unread alerts, and follows marking one read", async ({ page, isMobile }) => {
    await serveAdminData(page.context());
    const items = [0, 1].map((index) => fixtureAttention({
      key: `order-fulfil:order-${index}`, title: `Order APX-${index} is paid and awaiting preparation`, orderId: null, orderNumber: null,
    }));
    await page.context().route("**/api/admin/attention", (route) => route.fulfill({ json: { items } }));
    await page.context().route("**/api/admin/attention/read", (route) => {
      const { keys } = route.request().postDataJSON() as { keys: string[] };
      for (const item of items) if (keys.includes(item.key)) item.read = true;
      return route.fulfill({ json: { read: keys.length } });
    });
    await page.goto("/#/admin/orders/orders");
    await waitForPlace(page, "Orders");
    const navigation = async () => {
      if (isMobile) {
        await page.getByRole("button", { name: "Menu", exact: true }).click();
        return page.getByRole("dialog", { name: "Admin navigation" }).getByRole("navigation", { name: "Admin" });
      }
      return page.getByRole("navigation", { name: "Admin" });
    };
    let nav = await navigation();
    await expect(nav.getByRole("link", { name: "Orders, 2 unread alerts", exact: true })).toBeVisible();
    if (isMobile) await page.keyboard.press("Escape");

    await page.getByRole("region", { name: "Needs attention" }).getByRole("button", { name: /^Mark read Order APX-0 / }).click();
    nav = await navigation();
    await expect(nav.getByRole("link", { name: "Orders, 1 unread alert", exact: true })).toBeVisible();
  });
});

/** Distinct rounded values, for counting rows (tops) and columns (lefts). */
const distinct = (values: number[]) => new Set(values.map((value) => Math.round(value))).size;

test("overview matrix: period, figures and lists by width, at 100% and 200% text", async ({ page, isMobile }) => {
  test.setTimeout(180_000);
  await signInStaff(page, "ADMIN");
  await serveAdminData(page.context());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/admin/overview/dashboard");
  await waitForPlace(page, "Dashboard");
  const failures: string[] = [];
  for (const width of isMobile ? [360, 390, 430] : [768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const scale of [1, 2]) {
      await page.evaluate((size) => { document.documentElement.style.fontSize = size; }, scale > 1 ? "200%" : "");
      // As the layout sweep does: the screen is drawn afresh at this text size, then measured once it holds still.
      await page.evaluate(() => { location.hash = "/admin/overview/analytics"; });
      await waitForPlace(page, "Sales report");
      await page.evaluate(() => { location.hash = "/admin/overview/dashboard"; });
      await waitForPlace(page, "Dashboard");
      const label = `${width}px ${scale * 100}%`;
      let previous = "";
      await expect.poll(async () => {
        const now = await page.evaluate(() => JSON.stringify([...document.querySelectorAll('main li, main a')].map((element) => {
          const rect = element.getBoundingClientRect();
          return [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width)];
        })));
        const steady = now === previous;
        previous = now;
        return steady;
      }, { message: `${label}: layout holds still`, intervals: [50, 100, 200] }).toBe(true);
      const shape = await page.evaluate(() => {
        const main = document.querySelector("main")!;
        const box = (element: Element) => element.getBoundingClientRect();
        const period = [...main.querySelectorAll('[role="group"][aria-label="Period"] a')].map(box);
        const figures = [...main.querySelectorAll('[aria-label="Figures for this period"] li')].map(box);
        const [needs, recent] = ["Needs action now", "Recent orders"].map((name) =>
          [...main.querySelectorAll("section")].find((section) => section.querySelector("h2")?.textContent === name)!);
        const range = [...main.querySelectorAll("p")].find((p) => p.textContent?.endsWith("Nairobi time (EAT)"))!;
        const targets = [...main.querySelectorAll("a, button")].filter((element) => box(element).width > 0)
          .map((element) => ({ name: element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 30), height: box(element).height, width: box(element).width }))
          .filter((target) => target.height < 44 || target.width < 44);
        const order = [main.querySelector('[role="group"][aria-label="Period"]')!, range, main.querySelector('[aria-label="Figures for this period"]')!, needs, recent];
        const inDocumentOrder = order.every((element, index) => index === 0 || (order[index - 1].compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
        return {
          period: { tops: period.map((rect) => rect.top), lefts: period.map((rect) => rect.left) },
          figures: { tops: figures.map((rect) => rect.top), lefts: figures.map((rect) => rect.left) },
          needs: box(needs).toJSON() as DOMRect, recent: box(recent).toJSON() as DOMRect,
          rangeBelowPeriod: box(range).top >= Math.max(...period.map((rect) => rect.bottom)),
          figuresBelowRange: Math.min(...figures.map((rect) => rect.top)) >= box(range).bottom,
          targets, inDocumentOrder, h1: document.querySelectorAll("h1").length,
        };
      });
      const periodColumns = distinct(shape.period.lefts);
      const figureColumns = distinct(shape.figures.lefts);
      const sideBySide = Math.abs(shape.needs.top - shape.recent.top) < 1;
      const expected = isMobile
        ? (scale === 1 ? { periodColumns: 2, figureColumns: 2, sideBySide: false } : { periodColumns: 1, figureColumns: 1, sideBySide: false })
        : scale === 1
          ? width === 768 ? { periodColumns: 4, figureColumns: 3, sideBySide: false } : { periodColumns: 4, figureColumns: 5, sideBySide: true }
          : null;
      if (expected) {
        const actual = { periodColumns, figureColumns, sideBySide };
        if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`${label}: ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`);
      }
      if (sideBySide && !(shape.recent.width > shape.needs.width && shape.needs.left < shape.recent.left)) {
        failures.push(`${label}: needs action first and recent orders wider: ${JSON.stringify([shape.needs, shape.recent])}`);
      }
      if (!shape.inDocumentOrder || !shape.rangeBelowPeriod || !shape.figuresBelowRange) failures.push(`${label}: reading order`);
      if (shape.targets.length) failures.push(`${label}: small targets ${JSON.stringify(shape.targets)}`);
      if (shape.h1 !== 1) failures.push(`${label}: ${shape.h1} H1s`);
      const problems = await layoutProblems(page);
      if (problems.overflow > 0 || problems.scrollers.length) failures.push(`${label}: ${JSON.stringify(problems)}`);
    }
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
  expect(failures, failures.join("\n")).toEqual([]);
});
