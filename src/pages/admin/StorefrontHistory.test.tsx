import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorefrontDraft, StorefrontRevision } from "../../api/catalog";
import { buildCategoryTree } from "../../store/catalogModel";
import { fixtureSnapshot, fixtureStorefrontSettings } from "../../test-support/catalogFixtures";
import { StorefrontDraftProvider } from "./StorefrontDraft";
import { StorefrontManager } from "./StorefrontManager";
import { UnsavedChangesProvider } from "./unsavedChanges";

const api = vi.hoisted(() => ({
  getStorefrontDraft: vi.fn(),
  saveStorefrontDraft: vi.fn(),
  publishStorefront: vi.fn(),
  getStorefrontRevisions: vi.fn(),
  restoreStorefrontRevision: vi.fn(),
}));
vi.mock("../../api/catalog", async (importOriginal) => ({ ...await importOriginal<typeof import("../../api/catalog")>(), catalogAdminAPI: api }));
const snapshot = fixtureSnapshot({ mode: "admin" });
vi.mock("./AdminCatalogContext", () => ({
  useAdminCatalog: () => ({
    status: "ready", data: { snapshot, stocks: [] }, categories: buildCategoryTree(snapshot.categories),
    error: null, sessionExpired: false, refreshing: false, reload: vi.fn(),
  }),
}));
vi.mock("../../store/StorefrontContext", () => ({ useStorefront: () => ({ mediaById: new Map(), reload: vi.fn() }) }));

const CLAIM = (title: string) => `Section "${title}": headings can't claim a ranking or popularity the store doesn't measure, such as "best sellers", "top rated" or "trending". Use a heading such as "Featured" or "Staff picks".`;

/** Draft 7 holds edits saved after version 6 was published by alice at 14:05 Nairobi time. */
function fixtureDraft(overrides: Partial<StorefrontDraft> = {}): StorefrontDraft {
  return {
    version: 7, publishedVersion: 6, publishedAt: "2026-11-17T11:05:00.000Z", publishedBy: "alice",
    settings: fixtureStorefrontSettings(), media: [], unavailableMediaIds: [], ...overrides,
  };
}
const revision = (version: number, overrides: Partial<StorefrontRevision> = {}): StorefrontRevision => ({
  version, publishedAt: "2026-11-15T07:40:00.000Z", publishedBy: "bob", live: false, ...overrides,
});
/** The history as the API pages it: newest first, 20 a page. */
function servedHistory(revisions: StorefrontRevision[]) {
  return async (page: number) => ({ data: {
    revisions: revisions.slice((page - 1) * 20, page * 20),
    pagination: { page, limit: 20, pages: Math.ceil(revisions.length / 20), total: revisions.length },
  } });
}
const HISTORY = [
  revision(6, { publishedAt: "2026-11-17T11:05:00.000Z", publishedBy: "alice", live: true }),
  revision(4),
  revision(1, { publishedAt: "2026-11-14T06:12:00.000Z", publishedBy: null }),
];

function apiError(status: number, data: Record<string, string>) {
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status, statusText: "", data, headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() },
  });
}

function renderEditor({ canWrite = true } = {}) {
  return render(
    <UnsavedChangesProvider>
      <StorefrontDraftProvider canWrite={canWrite} showToast={vi.fn()}>
        <StorefrontManager canWrite={canWrite} />
      </StorefrontDraftProvider>
    </UnsavedChangesProvider>,
  );
}

const historyToggle = () => screen.getByRole("button", { name: "Publication history" });
const historySection = () => historyToggle().closest("section")!;
/** Opens the history and waits for its list. */
async function openHistory() {
  fireEvent.click(historyToggle());
  await within(historySection()).findByRole("list");
  return historySection();
}
const statusHeading = () => screen.getByRole("heading", { level: 3, name: "Storefront" });
function unloadPrevented() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

beforeEach(() => {
  window.history.replaceState(null, "", "#/admin/storefront/editor");
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  for (const fn of Object.values(api)) fn.mockReset();
  api.getStorefrontDraft.mockResolvedValue({ data: fixtureDraft() });
  api.getStorefrontRevisions.mockImplementation(servedHistory(HISTORY));
});

describe("the publication line", () => {
  it("names the publisher and the time in Nairobi time, once", async () => {
    renderEditor();
    expect(await screen.findByText("Last published 17 Nov 2026, 14:05 by alice (version 6). Times are Nairobi time.")).toBeTruthy();
    expect(screen.getAllByText(/Nairobi time/)).toHaveLength(1);
  });

  it("says plainly when nobody recorded the publisher, and when nothing is published", async () => {
    api.getStorefrontDraft.mockResolvedValueOnce({ data: fixtureDraft({ publishedAt: "2026-11-14T06:12:00.000Z", publishedBy: null }) });
    const view = renderEditor();
    expect(await screen.findByText("Last published 14 Nov 2026, 09:12 (version 6; publisher not recorded). Times are Nairobi time.")).toBeTruthy();
    view.unmount();
    api.getStorefrontDraft.mockResolvedValueOnce({ data: fixtureDraft({ publishedVersion: 0, publishedAt: null, publishedBy: null }) });
    renderEditor();
    expect(await screen.findByText("Not published yet.")).toBeTruthy();
  });

  it("refuses a draft answer without a publisher field, as it refuses other malformed fields", async () => {
    const { publishedBy: _, ...missing } = fixtureDraft();
    api.getStorefrontDraft.mockResolvedValueOnce({ data: missing });
    renderEditor();
    expect(await screen.findByText("The storefront draft was not in the expected format.")).toBeTruthy();
  });
});

describe("the publication history", () => {
  it("stays closed until opened, then lists the first page with the live version and each publisher", async () => {
    renderEditor();
    await screen.findByLabelText("Store name");
    expect(historyToggle().getAttribute("aria-expanded")).toBe("false");
    expect(api.getStorefrontRevisions).not.toHaveBeenCalled();
    fireEvent.click(historyToggle());
    expect(historyToggle().getAttribute("aria-expanded")).toBe("true");
    expect(within(historySection()).getByRole("status").textContent).toBe("Loading the publication history…");
    const section = historySection();
    await within(section).findByRole("list");
    expect(api.getStorefrontRevisions.mock.calls).toEqual([[1]]);
    const items = within(section).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Version 6Live17 Nov 2026, 14:05 · aliceRestore to draft",
      "Version 415 Nov 2026, 10:40 · bobRestore to draft",
      "Version 114 Nov 2026, 09:12 · publisher not recordedRestore to draft",
    ]);
    expect(within(items[0]).getByText("Live")).toBeTruthy();
    expect(within(items[1]).queryByText("Live")).toBeNull();
    expect(within(section).queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("appends the next page on Show more, and offers no more on the last page", async () => {
    const many = Array.from({ length: 23 }, (_, index) => revision(30 - index, { live: index === 0 }));
    api.getStorefrontRevisions.mockImplementation(servedHistory(many));
    renderEditor();
    await screen.findByLabelText("Store name");
    const section = await openHistory();
    expect(within(section).getAllByRole("listitem")).toHaveLength(20);
    fireEvent.click(within(section).getByRole("button", { name: "Show more" }));
    await waitFor(() => expect(within(section).getAllByRole("listitem")).toHaveLength(23));
    expect(api.getStorefrontRevisions.mock.calls).toEqual([[1], [2]]);
    expect(within(section).getAllByRole("listitem").map((item) => within(item).getByText(/^Version \d+$/).textContent))
      .toEqual(many.map((item) => `Version ${item.version}${item.live ? "Live" : ""}`));
    expect(within(section).queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("says when nothing has been published yet", async () => {
    api.getStorefrontRevisions.mockImplementation(servedHistory([]));
    renderEditor();
    await screen.findByLabelText("Store name");
    fireEvent.click(historyToggle());
    expect(await screen.findByText("Nothing has been published yet.")).toBeTruthy();
  });

  it("reports a failed or malformed load and tries again", async () => {
    api.getStorefrontRevisions.mockRejectedValueOnce(new AxiosError("Offline", "ERR_NETWORK"));
    api.getStorefrontRevisions.mockResolvedValueOnce({ data: { revisions: [{ version: "6" }], pagination: { page: 1, limit: 20, pages: 1, total: 1 } } });
    renderEditor();
    await screen.findByLabelText("Store name");
    fireEvent.click(historyToggle());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load the publication history.");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.getStorefrontRevisions).toHaveBeenCalledTimes(2));
    fireEvent.click(within(await screen.findByRole("alert")).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Version 6")).toBeTruthy();
    expect(api.getStorefrontRevisions).toHaveBeenCalledTimes(3);
  });
});

describe("restoring a version to the draft", () => {
  const restoreButton = (version: number) => within(historySection()).getByRole("button", { name: `Restore to draft: version ${version}` });
  const dialog = (version: number) => screen.getByRole("dialog", { name: `Restore version ${version} to the draft?` });

  it("names each Restore button with its visible text first, then the version it restores (label in name)", async () => {
    renderEditor();
    await screen.findByLabelText("Store name");
    await openHistory();
    for (const version of [6, 4, 1]) {
      const button = restoreButton(version);
      expect(button.textContent).toBe("Restore to draft");
      expect(button.getAttribute("aria-label")?.startsWith(button.textContent!)).toBe(true);
    }
  });

  it("asks first, naming the version, when and by whom it was published, and that shoppers keep the live version", async () => {
    api.getStorefrontDraft.mockResolvedValueOnce({ data: fixtureDraft({ version: 6 }) });
    renderEditor();
    await screen.findByLabelText("Store name");
    await openHistory();
    fireEvent.click(restoreButton(4));
    const confirm = dialog(4);
    expect(within(confirm).getByText(
      "The draft will match version 4, published 15 Nov 2026, 10:40 by bob. Shoppers keep seeing the live version until you publish.",
    )).toBeTruthy();
    // The saved draft is the live version, so nothing unpublished is replaced.
    expect(within(confirm).queryByText(/aren't published/)).toBeNull();
    expect(within(confirm).getAllByRole("button").map((button) => button.textContent)).toEqual(["Cancel", "Restore to draft"]);
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(restoreButton(1));
    expect(within(dialog(1)).getByText(
      "The draft will match version 1, published 14 Nov 2026, 09:12 (publisher not recorded). Shoppers keep seeing the live version until you publish.",
    )).toBeTruthy();
    expect(api.restoreStorefrontRevision).not.toHaveBeenCalled();
  });

  it("warns that unpublished draft changes are replaced", async () => {
    renderEditor();
    await screen.findByLabelText("Store name");
    await openHistory();
    fireEvent.click(restoreButton(4));
    expect(within(dialog(4)).getByText("The draft has changes that aren't published. Restoring replaces them.")).toBeTruthy();
  });

  it("is unavailable while the editor has unsaved changes, and says why", async () => {
    renderEditor();
    fireEvent.change(await screen.findByLabelText("Store name"), { target: { value: "Apex Cart Unsaved" } });
    await openHistory();
    const button = restoreButton(4);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    const reason = document.getElementById(button.getAttribute("aria-describedby") ?? "");
    expect(reason?.textContent).toBe("Save or discard your changes before restoring.");
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.restoreStorefrontRevision).not.toHaveBeenCalled();
  });

  it("is unavailable while a publish or another restore is running", async () => {
    let finishPublish: (value: unknown) => void = () => undefined;
    api.publishStorefront.mockReturnValue(new Promise((resolve) => { finishPublish = resolve; }));
    let finishRestore: (value: unknown) => void = () => undefined;
    api.restoreStorefrontRevision.mockReturnValue(new Promise((resolve) => { finishRestore = resolve; }));
    renderEditor();
    await screen.findByLabelText("Store name");
    await openHistory();
    fireEvent.click(restoreButton(4));
    fireEvent.click(within(dialog(4)).getByRole("button", { name: "Restore to draft" }));
    expect(restoreButton(4).textContent).toBe("Restoring…");
    expect([restoreButton(6), restoreButton(1)].map((button) => button.getAttribute("aria-disabled"))).toEqual(["true", "true"]);
    expect(screen.getByRole("button", { name: "Publish" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(restoreButton(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => finishRestore({ data: fixtureDraft({ version: 8 }) }));
    await within(historySection()).findByRole("list");

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(restoreButton(4).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(restoreButton(4));
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => finishPublish({ data: {} }));
    expect(api.restoreStorefrontRevision).toHaveBeenCalledTimes(1);
  });

  it("offers view-only staff the history but no restore", async () => {
    renderEditor({ canWrite: false });
    await screen.findByText(/Last published/);
    const section = await openHistory();
    expect(within(section).getAllByRole("listitem")).toHaveLength(3);
    expect(within(section).queryAllByRole("button", { name: /Restore/ })).toEqual([]);
  });

  it("makes the draft that version: the editor adopts it with nothing unsaved, the history refreshes and focus moves to the status panel", async () => {
    const restored = fixtureDraft({ version: 8, settings: fixtureStorefrontSettings({ brand: { name: "Apex Cart Restored", tagline: "", logoMediaId: null, faviconMediaId: null } }) });
    api.restoreStorefrontRevision.mockResolvedValue({ data: restored });
    renderEditor();
    await screen.findByLabelText("Store name");
    await openHistory();
    fireEvent.click(restoreButton(4));
    await act(async () => { fireEvent.click(within(dialog(4)).getByRole("button", { name: "Restore to draft" })); });
    expect(api.restoreStorefrontRevision.mock.calls).toEqual([[4, 7]]);
    expect(await screen.findByText("Version 4 is now the draft. Preview it, then publish to show it to shoppers.")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Store name").value).toBe("Apex Cart Restored");
    expect(screen.getByText("Draft version 8. Saving a draft never changes what shoppers see; publishing does.")).toBeTruthy();
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    expect(unloadPrevented()).toBe(false);
    expect(document.activeElement).toBe(statusHeading());
    await waitFor(() => expect(api.getStorefrontRevisions).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Reload the latest draft" })).toBeNull();
  });

  it.each([
    ["STOREFRONT_CHANGED", "The storefront changed. Reload before restoring."],
    ["CATALOG_CHANGED", "The catalog changed concurrently. Reload and retry your change."],
  ])("treats %s as a stale draft, offering the reload", async (code, error) => {
    api.restoreStorefrontRevision.mockRejectedValue(apiError(409, { error, code }));
    renderEditor();
    await screen.findByLabelText("Store name");
    await openHistory();
    fireEvent.click(restoreButton(4));
    await act(async () => { fireEvent.click(within(dialog(4)).getByRole("button", { name: "Restore to draft" })); });
    expect((await screen.findByRole("alert")).textContent).toBe(error);
    fireEvent.click(screen.getByRole("button", { name: "Reload the latest draft" }));
    await waitFor(() => expect(api.getStorefrontDraft).toHaveBeenCalledTimes(2));
  });

  it.each([
    [409, "REVISION_INVALID", `Version 4 can't be restored: ${CLAIM("Best sellers")}`],
    [409, "REVISION_UNAVAILABLE", "Version 4 can't be restored: a product, category or image it uses has been deleted."],
    [404, "REVISION_NOT_FOUND", "That version isn't in the publication history."],
  ])("shows a %i %s refusal in the server's words, with no reload offer", async (status, code, error) => {
    api.restoreStorefrontRevision.mockRejectedValue(apiError(status, { error, code }));
    renderEditor();
    await screen.findByLabelText("Store name");
    await openHistory();
    fireEvent.click(restoreButton(4));
    await act(async () => { fireEvent.click(within(dialog(4)).getByRole("button", { name: "Restore to draft" })); });
    expect((await screen.findByRole("alert")).textContent).toBe(error);
    expect(screen.queryByRole("button", { name: "Reload the latest draft" })).toBeNull();
    expect(document.activeElement).toBe(statusHeading());
    expect(screen.getByLabelText<HTMLInputElement>("Store name").value).toBe("Apex Cart");
  });

  it("describes any other failure plainly", async () => {
    api.restoreStorefrontRevision.mockRejectedValue(new AxiosError("Offline", "ERR_NETWORK"));
    renderEditor();
    await screen.findByLabelText("Store name");
    await openHistory();
    fireEvent.click(restoreButton(4));
    await act(async () => { fireEvent.click(within(dialog(4)).getByRole("button", { name: "Restore to draft" })); });
    expect((await screen.findByRole("alert")).textContent).toBe("Could not reach the server. Check your connection and try again.");
    expect(screen.queryByRole("button", { name: "Reload the latest draft" })).toBeNull();
  });
});

describe("headings that claim an unmeasured ranking", () => {
  it("are flagged at the Heading field, listed as a problem, and keep Save off", async () => {
    renderEditor();
    const headings = await screen.findAllByLabelText("Heading");
    fireEvent.change(headings[1], { target: { value: "Top-rated jackets" } });
    expect(headings[1].getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(headings[1].getAttribute("aria-describedby") ?? "")?.textContent).toBe(CLAIM("Top-rated jackets"));
    expect(headings[0].getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByText("Fix these before saving or publishing:").nextElementSibling?.textContent).toBe(CLAIM("Top-rated jackets"));
    expect(screen.getByRole("button", { name: "Save draft" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(headings[1], { target: { value: "Staff picks" } });
    expect(headings[1].getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByRole("button", { name: "Save draft" }).hasAttribute("disabled")).toBe(false);
  });

  it("keep Publish off for a draft saved before the rule, saying why", async () => {
    const stored = fixtureStorefrontSettings();
    stored.sections[0] = { ...stored.sections[0], title: "Trending" };
    api.getStorefrontDraft.mockResolvedValueOnce({ data: fixtureDraft({ settings: stored }) });
    renderEditor();
    await screen.findByLabelText("Store name");
    const publish = screen.getByRole("button", { name: "Publish" });
    expect(publish.hasAttribute("disabled")).toBe(true);
    expect(publish.getAttribute("title")).toBe("Fix the problems listed below first");
    expect(screen.getByText("Fix these before saving or publishing:").nextElementSibling?.textContent).toBe(CLAIM("Trending"));
    fireEvent.click(publish);
    expect(api.publishStorefront).not.toHaveBeenCalled();
  });
});
