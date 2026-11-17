import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEntry } from "../../api/admin";
import { StaffActivity } from "./StaffActivity";

const admin = vi.hoisted(() => ({ activity: { getAll: vi.fn() } }));
vi.mock("../../api/admin", async (importOriginal) => ({ ...await importOriginal<typeof import("../../api/admin")>(), adminAPI: admin }));

const WAIT = { timeout: 3000 };
const ROUTE = "#/admin/settings/activity";

const entry = (index: number, overrides: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: `entry-${index}`, at: "2026-11-17T11:05:00.000Z", action: "PRODUCT_UPDATED", targetType: "product", targetId: `prod-${index}`,
  details: `Linen Shirt ${index}`, staff: { username: "alice", role: "ADMIN" }, ...overrides,
});
/** Serves `entries` 25 a page, as the API pages them. */
const served = (entries: ActivityEntry[]) => async ({ page }: { type: string; page: number }) => ({ data: {
  entries: entries.slice((page - 1) * 25, page * 25),
  pagination: { page, limit: 25, pages: Math.ceil(entries.length / 25), total: entries.length },
} });

beforeEach(() => {
  window.history.replaceState(null, "", ROUTE);
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  admin.activity.getAll.mockReset();
});

describe("staff activity", () => {
  it("shows each entry's sentence, then who, their role and when in Nairobi time, with a link named for its subject", async () => {
    admin.activity.getAll.mockImplementation(served([
      entry(1, { action: "STOREFRONT_RESTORED", targetType: "storefront", targetId: "4", details: "version 4", staff: { username: "bob", role: "SUPER_ADMIN" } }),
      entry(2, { details: "Linen Shirt" }),
      entry(3, { action: "CUSTOMER_DISABLED", targetType: "customer", targetId: "user-1", details: "" }),
      entry(4, { action: "LOGIN", targetType: null, targetId: null, details: "Admin logged in", at: "2026-11-16T21:00:00.000Z" }),
    ]));
    render(<StaffActivity />);
    const items = await screen.findAllByRole("listitem", {}, WAIT);
    expect(admin.activity.getAll.mock.calls).toEqual([[{ type: "all", page: 1 }]]);
    expect(screen.getByText("4 entries")).toBeTruthy();
    expect(items.map((item) => [...item.querySelectorAll("p")].map((paragraph) => paragraph.textContent))).toEqual([
      ["Restored an earlier storefront version to the draft: version 4", "bob · Super admin · 17 Nov 2026, 14:05"],
      ["Edited a product: Linen Shirt", "alice · Admin · 17 Nov 2026, 14:05"],
      ["Disabled a customer account", "alice · Admin · 17 Nov 2026, 14:05"],
      ["Signed in", "alice · Admin · 17 Nov 2026, 00:00"],
    ]);
    expect(within(items[0]).getByRole("link", { name: "Open storefront editor" }).getAttribute("href")).toBe("#/admin/storefront/editor");
    expect(within(items[1]).getByRole("link", { name: "Open product Linen Shirt" }).getAttribute("href")).toBe("#/admin/catalog/products?product=prod-2");
    expect(within(items[2]).queryByRole("link")).toBeNull();
    expect(within(items[3]).queryByRole("link")).toBeNull();
  });

  it("keeps the filter and page in the address, changing them with a replace", async () => {
    admin.activity.getAll.mockImplementation(served(Array.from({ length: 60 }, (_, index) => entry(index + 1))));
    const entries = window.history.length;
    render(<StaffActivity />);
    await screen.findByText("60 entries", undefined, WAIT);
    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "catalog" } });
    expect(window.location.hash).toBe(`${ROUTE}?type=catalog`);
    await waitFor(() => expect(admin.activity.getAll).toHaveBeenLastCalledWith({ type: "catalog", page: 1 }), WAIT);
    await screen.findByText("Page 1 of 3", undefined, WAIT);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(window.location.hash).toBe(`${ROUTE}?type=catalog&page=2`);
    expect(await screen.findByText("Page 2 of 3", undefined, WAIT)).toBeTruthy();
    expect(admin.activity.getAll).toHaveBeenLastCalledWith({ type: "catalog", page: 2 });
    expect(screen.getAllByRole("listitem")[0].textContent).toContain("Linen Shirt 26");
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(window.location.hash).toBe(`${ROUTE}?type=catalog`);
    // A new filter starts again at page 1.
    fireEvent.click(await screen.findByRole("button", { name: "Next" }, WAIT));
    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "all" } });
    expect(window.location.hash).toBe(ROUTE);
    expect(window.history.length).toBe(entries);
  });

  it("corrects an unknown filter or a malformed page in place, asking only for what it shows", async () => {
    admin.activity.getAll.mockImplementation(served([entry(1)]));
    window.history.replaceState(null, "", `${ROUTE}?type=bogus&page=0`);
    const entries = window.history.length;
    render(<StaffActivity />);
    await waitFor(() => expect(window.location.hash).toBe(ROUTE), WAIT);
    expect(window.history.length).toBe(entries);
    await screen.findByText("1 entry", undefined, WAIT);
    expect(admin.activity.getAll.mock.calls.every(([params]) => params.type === "all" && params.page === 1)).toBe(true);
    expect((screen.getByLabelText("Show") as HTMLSelectElement).value).toBe("all");
  });

  it("moves a page past the end back to the last page, reading as loading until it arrives", async () => {
    const list = Array.from({ length: 30 }, (_, index) => entry(index + 1));
    let release: () => void = () => undefined;
    admin.activity.getAll.mockImplementation(async (params: { type: string; page: number }) => {
      if (params.page === 2) await new Promise<void>((resolve) => { release = resolve; });
      return served(list)(params);
    });
    window.history.replaceState(null, "", `${ROUTE}?page=5`);
    render(<StaffActivity />);
    await waitFor(() => expect(window.location.hash).toBe(`${ROUTE}?page=2`), WAIT);
    expect(screen.getByRole("status").textContent).toBe("Loading staff activity…");
    expect(screen.queryByText("No staff activity yet.")).toBeNull();
    await act(async () => release());
    expect(await screen.findByText("Page 2 of 2", undefined, WAIT)).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
  });

  it("says when there is nothing yet, and when nothing matches a filter", async () => {
    admin.activity.getAll.mockImplementation(served([]));
    const view = render(<StaffActivity />);
    expect(await screen.findByText("No staff activity yet.", undefined, WAIT)).toBeTruthy();
    expect(screen.getByText("0 entries")).toBeTruthy();
    view.unmount();
    window.history.replaceState(null, "", `${ROUTE}?type=promotions`);
    render(<StaffActivity />);
    expect(await screen.findByText("No activity of this type.", undefined, WAIT)).toBeTruthy();
  });

  it("shows loading, then a failure with Try again", async () => {
    admin.activity.getAll.mockRejectedValueOnce(new AxiosError("Offline", "ERR_NETWORK"));
    admin.activity.getAll.mockResolvedValueOnce({ data: { entries: "not a list" } });
    admin.activity.getAll.mockImplementation(served([entry(1)]));
    render(<StaffActivity />);
    expect(screen.getByRole("status").textContent).toBe("Loading staff activity…");
    const failure = await screen.findByRole("alert", {}, WAIT);
    expect(failure.textContent).toContain("Could not reach the server. Check your connection and try again.");
    fireEvent.click(within(failure).getByRole("button", { name: "Try again" }));
    expect((await screen.findByRole("alert", {}, WAIT)).textContent).toContain("Couldn't load staff activity.");
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Edited a product: Linen Shirt 1", undefined, WAIT)).toBeTruthy();
    expect(admin.activity.getAll).toHaveBeenCalledTimes(3);
  });
});
