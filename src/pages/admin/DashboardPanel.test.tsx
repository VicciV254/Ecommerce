import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardMetrics } from "../../api/admin";
import { NOTHING_WAITING, fixtureDashboard } from "../../test-support/overviewFixtures";
import { DashboardPanel } from "./DashboardPanel";

const api = vi.hoisted(() => ({ analytics: { getDashboard: vi.fn() } }));
vi.mock("../../api/admin", async (importOriginal) => ({ ...await importOriginal<typeof import("../../api/admin")>(), adminAPI: api }));

const WAIT = { timeout: 3000 };
const answer = (data: DashboardMetrics) => ({ data: JSON.parse(JSON.stringify(data)) });
const offline = () => new AxiosError("Network Error", "ERR_NETWORK");

/** A request the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function at(route: string) {
  window.history.replaceState(null, "", `#${route}`);
}

/** A figure's link, named "<label> <value>" ("Net sales KES 12,450"). */
const figure = (name: string) => screen.getByRole("link", { name: new RegExp(`^${name}\\s+(KES\\s)?[\\d,]+$`) });
const values = () => ["Net sales", "Paid orders", "Orders placed", "Cancelled", "Refunded"]
  .map((label) => within(screen.getByRole("region", { name: "Figures for this period" })).getByText(label).nextElementSibling?.textContent);

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  api.analytics.getDashboard.mockReset();
  at("/admin/overview/dashboard");
});

describe("overview states", () => {
  it("shows placeholders while loading, never zeros", () => {
    api.analytics.getDashboard.mockReturnValue(new Promise(() => undefined));
    render(<DashboardPanel activeDiscounts={undefined} />);
    expect(screen.getByRole("status").textContent).toBe("Loading figures…");
    expect(values()).toEqual(Array(5).fill("Loading"));
    expect(screen.queryByText(/^(0|KES 0)$/)).toBeNull();
    expect(screen.queryByText("Nothing needs action right now.")).toBeNull();
    expect(api.analytics.getDashboard).toHaveBeenCalledWith("month");
  });

  it("says a first load failed, with Retry, and reads every figure as Unavailable", async () => {
    api.analytics.getDashboard.mockRejectedValueOnce(offline()).mockResolvedValueOnce(answer(fixtureDashboard()));
    render(<DashboardPanel activeDiscounts={2} />);
    const alert = await screen.findByRole("alert", undefined, WAIT);
    expect(alert.textContent).toMatch(/^The figures couldn't be loaded\. Could not reach the server/);
    expect(values()).toEqual(Array(5).fill("Unavailable"));
    expect(screen.getAllByText("Unavailable")).toHaveLength(7);
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("KES 12,450", undefined, WAIT)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the last figures when a refresh fails, marked with their time, and offers Retry", async () => {
    api.analytics.getDashboard.mockResolvedValueOnce(answer(fixtureDashboard())).mockRejectedValueOnce(offline());
    render(<DashboardPanel activeDiscounts={2} />);
    expect(await screen.findByText("Updated 14:05", undefined, WAIT)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    const alert = await screen.findByRole("alert", undefined, WAIT);
    expect(alert.textContent).toMatch(/^Last updated 14:05\. Couldn't refresh\./);
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(values()).toEqual(["KES 12,450", "5", "7", "1", "KES 1,160"]);
    expect(screen.getByText("1–17 November 2026 · Nairobi time (EAT)")).toBeTruthy();
  });

  it("drops an older answer when the period changes while it is in flight", async () => {
    const month = deferred<{ data: unknown }>();
    const week = deferred<{ data: unknown }>();
    api.analytics.getDashboard.mockImplementation((period: string) => (period === "week" ? week.promise : month.promise));
    const entries = window.history.length;
    render(<DashboardPanel activeDiscounts={2} />);
    fireEvent.click(screen.getByRole("link", { name: "This week" }));
    expect(window.location.hash).toBe("#/admin/overview/dashboard?period=week");
    expect(window.history.length).toBe(entries);
    await act(async () => week.resolve(answer(fixtureDashboard("week", { figures: { ...fixtureDashboard().figures, netSales: 4100 } }))));
    await act(async () => month.resolve(answer(fixtureDashboard("month"))));
    expect(screen.getByText("16–17 November 2026 · Nairobi time (EAT)")).toBeTruthy();
    expect(values()[0]).toBe("KES 4,100");
    expect(screen.getByRole("link", { name: "This week" }).getAttribute("aria-current")).toBe("true");
  });

  it("starts a new period with placeholders rather than the previous period's figures", async () => {
    api.analytics.getDashboard.mockResolvedValueOnce(answer(fixtureDashboard())).mockReturnValueOnce(new Promise(() => undefined));
    render(<DashboardPanel activeDiscounts={2} />);
    await screen.findByText("KES 12,450", undefined, WAIT);
    fireEvent.click(screen.getByRole("link", { name: "This year" }));
    await waitFor(() => expect(values()).toEqual(Array(5).fill("Loading")));
    expect(screen.queryByText("KES 12,450")).toBeNull();
  });
});

describe("period and range", () => {
  it("offers four periods in one labelled group, marks this month by default and links each with a replace", async () => {
    api.analytics.getDashboard.mockResolvedValue(answer(fixtureDashboard()));
    render(<DashboardPanel activeDiscounts={2} />);
    const group = screen.getByRole("group", { name: "Period" });
    const links = within(group).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("aria-current")])).toEqual([
      ["Today", "#/admin/overview/dashboard?period=today", null],
      ["This week", "#/admin/overview/dashboard?period=week", null],
      ["This month", "#/admin/overview/dashboard", "true"],
      ["This year", "#/admin/overview/dashboard?period=year", null],
    ]);
    expect(await screen.findByText("1–17 November 2026 · Nairobi time (EAT)", undefined, WAIT)).toBeTruthy();
    expect(screen.getByText("Updated 14:05")).toBeTruthy();
  });

  it("corrects an unknown period in place and never sends it", async () => {
    api.analytics.getDashboard.mockResolvedValue(answer(fixtureDashboard()));
    at("/admin/overview/dashboard?period=day");
    const entries = window.history.length;
    render(<DashboardPanel activeDiscounts={2} />);
    await waitFor(() => expect(window.location.hash).toBe("#/admin/overview/dashboard"));
    expect(window.history.length).toBe(entries);
    expect(api.analytics.getDashboard.mock.calls.map(([period]) => period)).toEqual(["month"]);
  });
});

describe("drill-down", () => {
  it("links each figure to the records that make up its number", async () => {
    api.analytics.getDashboard.mockResolvedValue(answer(fixtureDashboard("week")));
    at("/admin/overview/dashboard?period=week");
    render(<DashboardPanel activeDiscounts={2} />);
    await screen.findByText("KES 12,450", undefined, WAIT);
    expect(figure("Net sales").getAttribute("href")).toBe("#/admin/overview/analytics?period=week");
    expect(figure("Paid orders").getAttribute("href")).toBe("#/admin/overview/analytics?period=week");
    expect(figure("Refunded").getAttribute("href")).toBe("#/admin/overview/analytics?period=week");
    expect(figure("Orders placed").getAttribute("href")).toBe("#/admin/orders/orders?view=all&from=2026-11-16&to=2026-11-17");
    expect(figure("Cancelled").getAttribute("href")).toBe("#/admin/orders/orders?view=all&from=2026-11-16&to=2026-11-17&status=CANCELLED");
    expect(screen.getByRole("link", { name: "Net sales KES 12,450" }).getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Net sales KES 12,450", description: "Paid orders placed in this period, less refunds confirmed on them" })).toBeTruthy();
    expect(screen.getByText("1 refund")).toBeTruthy();
  });

  it("lists what needs action now, each row linking to its list, and says when nothing does", async () => {
    api.analytics.getDashboard.mockResolvedValueOnce(answer(fixtureDashboard())).mockResolvedValueOnce(answer(fixtureDashboard("month", { current: NOTHING_WAITING })));
    render(<DashboardPanel activeDiscounts={2} />);
    const section = await screen.findByRole("region", { name: "Needs action now" }, WAIT);
    await within(section).findByRole("link", { name: "Payments needing review: 1" }, WAIT);
    expect(within(section).getAllByRole("link").map((link) => [link.getAttribute("aria-label"), link.getAttribute("href")])).toEqual([
      ["Payments needing review: 1", "#/admin/orders/orders"],
      ["Failed refunds: 1", "#/admin/orders/refunds?status=FAILED"],
      ["Paid orders waiting to start: 2", "#/admin/orders/orders"],
      ["Orders being prepared: 1", "#/admin/orders/orders"],
      ["Dispatched, awaiting delivery confirmation: 1", "#/admin/orders/orders"],
      ["Returns awaiting a decision: 1", "#/admin/orders/returns?status=REQUESTED"],
      ["Refunds approved, not yet sent: 1", "#/admin/orders/refunds?status=APPROVED"],
      ["Out-of-stock SKUs: 1", "#/admin/catalog/stock?status=OUT_OF_STOCK"],
      ["Low-stock SKUs: 3", "#/admin/catalog/stock?status=LOW_STOCK"],
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await within(section).findByText("Nothing needs action right now.", undefined, WAIT)).toBeTruthy();
    expect(within(section).queryAllByRole("link")).toEqual([]);
  });

  it("links each recent order to its workspace, with the customer, staff status and total", async () => {
    api.analytics.getDashboard.mockResolvedValue(answer(fixtureDashboard()));
    render(<DashboardPanel activeDiscounts={2} />);
    const section = await screen.findByRole("region", { name: "Recent orders" }, WAIT);
    const orders = await within(section).findAllByRole("link", undefined, WAIT);
    expect(orders.map((link) => [link.getAttribute("aria-label"), link.getAttribute("href")])).toEqual([
      ["Order APX-261117-0001, Ana Mwangi, Processing, KES 2,488", "#/admin/orders/orders?view=all&order=order-recent-1"],
      ["Order APX-261116-0042, Customer, Collected, KES 1,044", "#/admin/orders/orders?view=all&order=order-recent-2"],
    ]);
    expect(screen.getByRole("link", { name: "Active discounts: 2" }).getAttribute("href")).toBe("#/admin/customers/discounts");
  });
});
