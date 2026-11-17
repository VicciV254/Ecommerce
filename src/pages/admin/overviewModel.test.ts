import { describe, expect, it } from "vitest";
import { NOTHING_WAITING, fixtureDashboard, fixtureRange, fixtureSalesReport } from "../../test-support/overviewFixtures";
import { FIGURES, OverviewFormatError, needsActionRows, parseDashboard, parseSalesReport, rangeInWords, salesExportName, salesExportTitle, storeSlug } from "./overviewModel";

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

describe("dashboard answers", () => {
  it("accepts a complete answer as sent", () => {
    const sent = fixtureDashboard();
    expect(parseDashboard(copy(sent))).toEqual(sent);
  });

  it.each([
    ["no range", (data: Record<string, unknown>) => { delete data.range; }],
    ["a range in another time zone", (data: Record<string, unknown>) => { data.range = { ...fixtureRange(), timeZone: "UTC" }; }],
    ["a missing figure", (data: Record<string, unknown>) => { data.figures = { netSales: 1, paidOrders: 1, ordersPlaced: 1, refunds: { count: 0, amount: 0 } }; }],
    ["a text amount", (data: Record<string, unknown>) => { data.figures = { ...fixtureDashboard().figures, netSales: "12450" }; }],
    ["a fractional count", (data: Record<string, unknown>) => { data.figures = { ...fixtureDashboard().figures, paidOrders: 1.5 }; }],
    ["a negative count", (data: Record<string, unknown>) => { data.current = { ...NOTHING_WAITING, paymentsNeedingReview: -1 }; }],
    ["a missing refund status", (data: Record<string, unknown>) => { data.current = { ...NOTHING_WAITING, refunds: { REQUESTED: 0 } }; }],
    ["the old all-time shape", (data: Record<string, unknown>) => { delete data.figures; data.sales = { total: 0 }; }],
    ["an unknown order status", (data: Record<string, unknown>) => { data.recentOrders = [{ ...fixtureDashboard().recentOrders[0], status: "LOST" }]; }],
    ["a bad timestamp", (data: Record<string, unknown>) => { data.generatedAt = "soon"; }],
  ])("refuses %s, so nothing reads as zero", (_label, change) => {
    const data = copy(fixtureDashboard()) as unknown as Record<string, unknown>;
    change(data);
    expect(() => parseDashboard(data)).toThrow(OverviewFormatError);
  });

  it("checks the sales report's figures and range the same way", () => {
    const sent = fixtureSalesReport("week");
    expect(parseSalesReport(copy(sent))).toEqual(sent);
    expect(() => parseSalesReport({ ...copy(sent), paidOrders: undefined })).toThrow(OverviewFormatError);
    expect(() => parseSalesReport({ ...copy(sent), range: undefined })).toThrow(OverviewFormatError);
  });
});

describe("figures and their meaning", () => {
  it("lists the five figures in reading order, each with a one-line definition", () => {
    expect(FIGURES.map((figure) => figure.label)).toEqual(["Net sales", "Paid orders", "Orders placed", "Cancelled", "Refunded"]);
    expect(FIGURES[0].definition).toBe("Paid orders placed in this period, less refunds confirmed on them");
    for (const figure of FIGURES) expect(figure.definition).not.toMatch(/\n/);
  });

  it("names the range in words with its time zone", () => {
    expect(rangeInWords(fixtureRange("month"))).toBe("1–17 November 2026 · Nairobi time (EAT)");
    expect(rangeInWords(fixtureRange("today"))).toBe("17 November 2026 · Nairobi time (EAT)");
  });
});

describe("needs action now", () => {
  it("keeps only non-zero counts, most urgent first, each linking to the list that shows them", () => {
    expect(needsActionRows(fixtureDashboard().current)).toEqual([
      { key: "payment-reviews", label: "Payments needing review", count: 1, to: "/admin/orders/orders" },
      { key: "refunds-failed", label: "Failed refunds", count: 1, to: "/admin/orders/refunds?status=FAILED" },
      { key: "orders-awaiting-start", label: "Paid orders waiting to start", count: 2, to: "/admin/orders/orders" },
      { key: "orders-processing", label: "Orders being prepared", count: 1, to: "/admin/orders/orders" },
      { key: "orders-dispatched", label: "Dispatched, awaiting delivery confirmation", count: 1, to: "/admin/orders/orders" },
      { key: "returns-requested", label: "Returns awaiting a decision", count: 1, to: "/admin/orders/returns?status=REQUESTED" },
      { key: "refunds-approved", label: "Refunds approved, not yet sent", count: 1, to: "/admin/orders/refunds?status=APPROVED" },
      { key: "stock-out", label: "Out-of-stock SKUs", count: 1, to: "/admin/catalog/stock?status=OUT_OF_STOCK" },
      { key: "stock-low", label: "Low-stock SKUs", count: 3, to: "/admin/catalog/stock?status=LOW_STOCK" },
    ]);
  });

  it("has no rows when nothing waits", () => {
    expect(needsActionRows(NOTHING_WAITING)).toEqual([]);
  });

  it("links every kind of count to a list filtered by that status", () => {
    const every = {
      orders: { awaitingStart: 1, processing: 1, readyForPickup: 1, dispatched: 1 }, paymentsNeedingReview: 1,
      returns: { REQUESTED: 1, APPROVED: 1 }, refunds: { REQUESTED: 1, APPROVED: 1, PROCESSING: 1, FAILED: 1, UNRESOLVED: 1 },
      stock: { LOW_STOCK: 1, OUT_OF_STOCK: 1 },
    };
    const routes = needsActionRows(every).map((row) => row.to);
    expect(routes).toHaveLength(14);
    expect(routes).toEqual(expect.arrayContaining([
      "/admin/orders/returns?status=APPROVED", "/admin/orders/refunds?status=REQUESTED", "/admin/orders/refunds?status=PROCESSING",
      "/admin/orders/refunds?status=UNRESOLVED",
    ]));
  });
});

describe("sales report exports", () => {
  it("names the file after the published store and the Nairobi dates", () => {
    expect(salesExportName("Apex Cart", fixtureRange("month"), "csv")).toBe("apex-cart-sales-2026-11-01-to-2026-11-17.csv");
    expect(salesExportName("Apex Cart", fixtureRange("today"), "pdf")).toBe("apex-cart-sales-2026-11-17.pdf");
    expect(salesExportName("Duka la Mama Wanjirũ & Sons", fixtureRange("week"), "xlsx")).toBe("duka-la-mama-wanjiru-sons-sales-2026-11-16-to-2026-11-17.xlsx");
    expect(salesExportName("☆☆☆", fixtureRange("year"), "csv")).toBe("sales-2026-01-01-to-2026-11-17.csv");
  });

  it("titles the export with the dates in Nairobi time", () => {
    expect(salesExportTitle(fixtureRange("month"))).toBe("Sales report, 1–17 November 2026 (Nairobi time)");
    expect(salesExportTitle(fixtureRange("year"))).toBe("Sales report, 1 January – 17 November 2026 (Nairobi time)");
  });

  it("slugs a store name to lower-case letters, digits and single hyphens", () => {
    expect(storeSlug("  Apex   Cart!! ")).toBe("apex-cart");
    expect(storeSlug("Café Nairobi 254")).toBe("cafe-nairobi-254");
  });
});
