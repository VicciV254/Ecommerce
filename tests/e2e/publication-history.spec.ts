import type { Locator, Page } from "@playwright/test";
import type { StorefrontDraft, StorefrontRevision } from "../../src/api/catalog";
import { fixtureStorefrontSettings } from "../../src/test-support/catalogFixtures";
import { LONG_STAFF_NAME, layoutProblems, serveAdminData, serveStaffHistory, storefrontRevisions, waitForPlace } from "./adminFixtures";
import { clippedWithin, expect, publishedStorefront, signInStaff, staff, storefrontDraft, test } from "./fixtures";

/** Serves the staff draft from `current()`, so a test decides what the editor's next read returns. */
async function serveDraft(page: Page, current: () => StorefrontDraft) {
  await page.context().route("**/api/settings/storefront/draft", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: current() }) : route.fallback());
}

async function openEditor(page: Page) {
  await page.goto("/#/admin/storefront/editor");
  await waitForPlace(page, "Storefront editor");
}

const history = (page: Page) => page.getByRole("region", { name: "Publication history" });
async function openHistory(page: Page) {
  await page.getByRole("button", { name: "Publication history" }).click();
  await expect(history(page).getByRole("listitem").first()).toBeVisible();
  return history(page);
}

/** Controls narrower or shorter than 44px, by name. */
const smallerThan44 = (controls: Locator) => controls.evaluateAll((elements) => elements
  .filter((element) => (element as HTMLElement).offsetParent !== null)
  .map((element) => ({ name: element.getAttribute("aria-label") ?? element.textContent?.trim(), box: element.getBoundingClientRect() }))
  .filter(({ box }) => box.height < 43.5 || box.width < 43.5)
  .map(({ name, box }) => `${name} ${Math.round(box.width)}x${Math.round(box.height)}`));

test.beforeEach(async ({ page }) => {
  await signInStaff(page, "ADMIN");
  await serveAdminData(page.context());
});

test("publishing names the publisher in the status line and at the top of the publication history", async ({ page }) => {
  let draft: StorefrontDraft = { ...storefrontDraft, publishedBy: "alice" };
  let revisions: StorefrontRevision[] = storefrontRevisions.map((item) => (item.live ? { ...item, publishedBy: "alice" } : item));
  await serveDraft(page, () => draft);
  await serveStaffHistory(page.context(), undefined, () => revisions);
  const sent: unknown[] = [];
  await page.context().route("**/api/settings/storefront/publish", (route) => {
    sent.push(route.request().postDataJSON());
    const at = "2026-11-17T12:30:00.000Z";
    draft = { ...draft, version: 6, publishedVersion: 6, publishedAt: at, publishedBy: staff.username };
    revisions = [{ version: 6, publishedAt: at, publishedBy: staff.username, live: true }, ...revisions.map((item) => ({ ...item, live: false }))];
    return route.fulfill({ json: { ...publishedStorefront, version: 6, publishedAt: at } });
  });

  await openEditor(page);
  await expect(page.getByText("Last published 31 Oct 2026, 03:00 by alice (version 3). Times are Nairobi time.")).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Last published 17 Nov 2026, 15:30 by Browser staff (version 6). Times are Nairobi time.")).toBeVisible();
  expect(sent).toEqual([{ version: 5 }]);

  const section = await openHistory(page);
  const newest = section.getByRole("listitem").first();
  await expect(newest).toContainText("Version 6");
  await expect(newest.getByText("Live", { exact: true })).toBeVisible();
  await expect(newest).toContainText("17 Nov 2026, 15:30 · Browser staff");
  await expect(section.getByRole("listitem").nth(1)).toContainText("31 Oct 2026, 03:00 · alice");
  await expect(section.getByRole("listitem").nth(1).getByText("Live", { exact: true })).toHaveCount(0);
});

test("restoring an earlier version sends it with the draft version held, then the editor shows the returned draft", async ({ page }) => {
  const restored: StorefrontDraft = {
    ...storefrontDraft, version: 6,
    settings: fixtureStorefrontSettings({ brand: { name: "Apex Cart, as in version 1", tagline: "", logoMediaId: null, faviconMediaId: null } }),
  };
  const requests: { path: string; body: unknown }[] = [];
  await page.context().route("**/api/settings/storefront/revisions/*/restore", (route) => {
    requests.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    return route.fulfill({ json: restored });
  });

  await openEditor(page);
  const section = await openHistory(page);
  await section.getByRole("button", { name: "Restore to draft: version 1", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Restore version 1 to the draft?" });
  await expect(dialog).toContainText(
    "The draft will match version 1, published 28 Oct 2026, 09:12 (publisher not recorded). Shoppers keep seeing the live version until you publish.");
  await expect(dialog).toContainText("The draft has changes that aren't published. Restoring replaces them.");
  await dialog.getByRole("button", { name: "Restore to draft" }).click();

  await expect(page.getByText("Version 1 is now the draft. Preview it, then publish to show it to shoppers.")).toBeVisible();
  expect(requests).toEqual([{ path: "/api/settings/storefront/revisions/1/restore", body: { version: 5 } }]);
  await expect(page.getByRole("textbox", { name: "Store name" })).toHaveValue("Apex Cart, as in version 1");
  await expect(page.getByText("Draft version 6. Saving a draft never changes what shoppers see; publishing does.")).toBeVisible();
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 3, name: "Storefront", exact: true })).toBeFocused();
});

test("history and restore dialog at 200% text (390px phone, 1280px desktop): nothing overflows or is cut off, 44px targets", async ({ page, isMobile }) => {
  await page.setViewportSize({ width: isMobile ? 390 : 1280, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openEditor(page);
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  const section = await openHistory(page);
  await expect(section).toContainText(LONG_STAFF_NAME);

  expect(await layoutProblems(page)).toMatchObject({ overflow: expect.any(Number), scrollers: [] });
  expect((await layoutProblems(page)).overflow).toBeLessThanOrEqual(0);
  expect(await clippedWithin(section)).toEqual([]);
  expect(await smallerThan44(section.getByRole("button"))).toEqual([]);

  const entry = section.getByRole("listitem").nth(1);
  const [version, time, restore] = await Promise.all([
    entry.getByText("Version 2", { exact: true }).boundingBox(), entry.getByText(LONG_STAFF_NAME, { exact: false }).boundingBox(),
    entry.getByRole("button", { name: "Restore to draft: version 2", exact: true }).boundingBox(),
  ]);
  const item = (await entry.boundingBox())!;
  if (isMobile) {
    // Phones: version, then time and publisher, then a full-width Restore.
    expect(time!.y).toBeGreaterThanOrEqual(version!.y + version!.height - 1);
    expect(restore!.y).toBeGreaterThanOrEqual(time!.y + time!.height - 1);
    expect(restore!.width).toBeGreaterThan(item.width - 2);
  } else {
    // From 768px: version and time share a line, with Restore at its end.
    expect(time!.y < version!.y + version!.height && version!.y < time!.y + time!.height).toBe(true);
    expect(restore!.x + restore!.width).toBeGreaterThan(item.x + item.width - 2);
    expect(restore!.x).toBeGreaterThan(time!.x);
  }

  await entry.getByRole("button", { name: "Restore to draft: version 2", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Restore version 2 to the draft?" });
  await expect(dialog).toContainText(`published 29 Oct 2026, 10:40 by ${LONG_STAFF_NAME}.`);
  expect((await layoutProblems(page)).overflow).toBeLessThanOrEqual(0);
  expect(await clippedWithin(dialog.locator(":scope > div"))).toEqual([]);
  const [cancel, confirm] = await Promise.all(["Cancel", "Restore to draft"].map((name) => dialog.getByRole("button", { name, exact: true }).boundingBox()));
  expect(await smallerThan44(dialog.getByRole("button"))).toEqual([]);
  if (isMobile) expect(confirm!.y).toBeGreaterThanOrEqual(cancel!.y + cancel!.height - 1);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
});
