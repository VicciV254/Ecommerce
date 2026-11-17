import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCategoryTree } from "../../store/catalogModel";
import { OVERVIEW_NOW, fixtureSalesReport } from "../../test-support/overviewFixtures";
import { AnalyticsPanel } from "./AnalyticsPanel";

const api = vi.hoisted(() => ({ analytics: { getSales: vi.fn() } }));
const exports = vi.hoisted(() => ({ downloadCsv: vi.fn(), downloadExcel: vi.fn(), downloadPdf: vi.fn() }));
const store = vi.hoisted(() => ({ brandName: "Apex Cart" }));
vi.mock("../../api/admin", async (importOriginal) => ({ ...await importOriginal<typeof import("../../api/admin")>(), adminAPI: api }));
vi.mock("./reportExports", () => exports);
vi.mock("../../store/StorefrontContext", () => ({ useStorefront: () => ({ brandName: store.brandName }) }));
vi.mock("./AdminCatalogContext", () => ({ useAdminCatalog: () => ({ data: null, categories: buildCategoryTree([]), error: null }) }));

const WAIT = { timeout: 3000 };

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  api.analytics.getSales.mockReset();
  for (const fn of Object.values(exports)) fn.mockReset();
  store.brandName = "Apex Cart";
  api.analytics.getSales.mockImplementation(async (period: string) => ({ data: JSON.parse(JSON.stringify(fixtureSalesReport(period))) }));
});

describe("sales report", () => {
  it("reads its period from the address and shows the dashboard's figures, labels and range line", async () => {
    window.history.replaceState(null, "", "#/admin/overview/analytics?period=week");
    render(<AnalyticsPanel />);
    expect(await screen.findByText("16–17 November 2026 · Nairobi time (EAT)", undefined, WAIT)).toBeTruthy();
    expect(api.analytics.getSales).toHaveBeenCalledWith("week");
    const group = screen.getByRole("group", { name: "Period" });
    expect(within(group).getByRole("link", { name: "This week" }).getAttribute("aria-current")).toBe("true");
    expect(within(group).getByRole("link", { name: "This month" }).getAttribute("href")).toBe("#/admin/overview/analytics");
    const figures = screen.getByRole("region", { name: "Figures for this period" });
    expect(["Net sales", "Paid orders", "Orders placed", "Cancelled", "Refunded"].map((label) => within(figures).getByText(label).nextElementSibling?.textContent))
      .toEqual(["KES 12,450", "5", "7", "1", "KES 1,160"]);
    expect(within(figures).getByText("Value of cancelled orders: KES 900 · Refunded for returned items: KES 1,160")).toBeTruthy();
  });

  it("names downloads after the published store and the report's Nairobi dates", async () => {
    store.brandName = "Duka la Mama";
    window.history.replaceState(null, "", "#/admin/overview/analytics");
    render(<AnalyticsPanel />);
    expect(await screen.findByText("duka-la-mama-sales-2026-11-01-to-2026-11-17.csv", undefined, WAIT)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download report" }));
    expect(exports.downloadCsv).toHaveBeenCalledWith("duka-la-mama-sales-2026-11-01-to-2026-11-17.csv", expect.any(Array));
    fireEvent.change(screen.getByLabelText("Download format"), { target: { value: "pdf" } });
    fireEvent.click(screen.getByRole("button", { name: "Download report" }));
    expect(exports.downloadPdf).toHaveBeenCalledWith("duka-la-mama-sales-2026-11-01-to-2026-11-17.pdf", expect.any(Array),
      "Sales report, 1–17 November 2026 (Nairobi time)", "Duka la Mama", OVERVIEW_NOW);
    fireEvent.change(screen.getByLabelText("Download format"), { target: { value: "excel" } });
    fireEvent.click(screen.getByRole("button", { name: "Download report" }));
    expect(exports.downloadExcel).toHaveBeenCalledWith("duka-la-mama-sales-2026-11-01-to-2026-11-17.xlsx", expect.any(Array),
      "Sales report, 1–17 November 2026 (Nairobi time)");
  });

  it("names a single day once, and corrects an unknown period without sending it", async () => {
    window.history.replaceState(null, "", "#/admin/overview/analytics?period=quarter");
    const view = render(<AnalyticsPanel />);
    await waitFor(() => expect(window.location.hash).toBe("#/admin/overview/analytics"));
    expect(api.analytics.getSales.mock.calls.map(([period]) => period)).toEqual(["month"]);
    view.unmount();
    window.history.replaceState(null, "", "#/admin/overview/analytics?period=today");
    render(<AnalyticsPanel />);
    expect(await screen.findByText("apex-cart-sales-2026-11-17.csv", undefined, WAIT)).toBeTruthy();
  });
});
