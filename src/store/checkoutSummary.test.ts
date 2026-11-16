import { describe, expect, it } from "vitest";
import { fixturePendingOrder, fixtureQuote, linenLine } from "../test-support/checkoutFixtures";
import { PENDING_REASONS, pendingReason, summaryRows, summaryTotal, type CheckoutFigures } from "./checkoutSummary";

const pending: CheckoutFigures = { kind: "pending", estimate: 900, excluded: 0, reason: PENDING_REASONS.address };

describe("checkout summary figures", () => {
  it("before a current quote, estimates only the items and leaves every fee and the total pending, never 0", () => {
    expect(summaryRows(pending)).toEqual([
      { label: "Items (estimate, excl. VAT)", amount: 900 },
      { label: "Delivery", amount: null },
      { label: "VAT (16%)", amount: null },
      { label: "Total", amount: null, tone: "total" },
    ]);
    expect(summaryTotal(pending)).toBeNull();
    // Even an empty estimate never turns a fee into a known zero.
    const rows = summaryRows({ ...pending, estimate: 0 });
    expect(rows.slice(1).every((row) => row.amount === null)).toBe(true);
  });

  it("with a current quote shows only the server's figures, savings included", () => {
    const quote = fixtureQuote({ couponCode: "SAVE10", couponApplied: true });
    expect(summaryRows({ kind: "quote", quote })).toEqual([
      { label: "Items subtotal", amount: 1000 },
      { label: "Savings (incl. coupon SAVE10)", amount: 100, tone: "saving" },
      { label: "Subtotal after savings", amount: 900 },
      { label: "VAT (16%)", amount: 144 },
      { label: "Standard delivery", amount: 200 },
      { label: "Total", amount: 1244, tone: "total" },
    ]);
    expect(summaryTotal({ kind: "quote", quote })).toBe(1244);
    const plain = fixtureQuote({ lines: [{ ...linenLine, unitPrice: 1000, total: 1000, discount: 0 }], discount: 0, discountedSubtotal: 1000, tax: 160, total: 1360 });
    expect(summaryRows({ kind: "quote", quote: plain }).map((row) => row.label)).toEqual(["Items subtotal", "VAT (16%)", "Standard delivery", "Total"]);
  });

  it("for a reserved order shows its stored amounts", () => {
    const order = fixturePendingOrder(fixtureQuote({ deliveryMethod: "STORE_PICKUP" }));
    expect(summaryRows({ kind: "order", order })).toEqual([
      { label: "Items subtotal", amount: 1000 },
      { label: "Savings", amount: 100, tone: "saving" },
      { label: "Subtotal after savings", amount: 900 },
      { label: "VAT (16%)", amount: 144 },
      { label: "Store pickup", amount: 200 },
      { label: "Total", amount: 1244, tone: "total" },
    ]);
    expect(summaryRows({ kind: "order", order: { ...order, pricingSnapshot: null } }).map((row) => row.label))
      .toEqual(["Items subtotal", "Savings", "Tax", "Store pickup", "Total"]);
  });

  it("names why the total is pending, in the order the checks apply", () => {
    const base = { settling: false, addressChosen: true, blocker: null, status: "loading" as const, expired: false };
    expect(pendingReason({ ...base, settling: true, addressChosen: false })).toBe(PENDING_REASONS.settling);
    expect(pendingReason({ ...base, addressChosen: false, blocker: "Remove unavailable items." })).toBe(PENDING_REASONS.address);
    expect(pendingReason({ ...base, blocker: "Remove unavailable items." })).toBe("Remove unavailable items.");
    expect(pendingReason({ ...base, status: "error" })).toBe(PENDING_REASONS.failed);
    expect(pendingReason({ ...base, status: "ready", expired: true })).toBe(PENDING_REASONS.expired);
    expect(pendingReason(base)).toBe(PENDING_REASONS.calculating);
  });
});
