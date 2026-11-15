import { describe, expect, it } from "vitest";
import type { PaymentStatus, RefundStatus } from "../api/orders";
import { REFUND_STATUSES } from "./orderModel";
import { STAFF_REFUND_STATUS, cancellationRefund, refundStatusText } from "./orderCopy";

const CONFIRMED_AT = "2026-11-14T09:30:00.000Z";

describe("refund wording", () => {
  it("never says a refund was sent unless it is confirmed, and only then shows the M-Pesa reference", () => {
    for (const status of REFUND_STATUSES) {
      const confirmed = status === "CONFIRMED";
      const text = refundStatusText({ status, confirmedAt: confirmed ? CONFIRMED_AT : null, providerReference: confirmed ? "QA12BC34DE" : null });
      if (confirmed) {
        expect(text).toMatch(/^Sent by M-Pesa on .+ · M-Pesa reference QA12BC34DE$/);
      } else {
        // The only mention of sending allowed is a negation: "not sent" or "not confirmed as sent".
        expect(text, status).toMatch(/not (confirmed as )?sent/i);
        expect(text.replace(/not (confirmed as )?sent/gi, ""), status).not.toMatch(/sent|refunded|reference|paid/i);
      }
    }
  });

  it("tells staff that approval or sending is not proof of money sent", () => {
    const unsent: RefundStatus[] = ["REQUESTED", "APPROVED", "FAILED", "CANCELLED"];
    for (const status of unsent) expect(STAFF_REFUND_STATUS[status], status).not.toMatch(/^Sent/);
    expect(STAFF_REFUND_STATUS.APPROVED).toBe("Approved — not sent yet");
  });

  it("describes what a cancellation does with money received for every payment state", () => {
    const statuses: PaymentStatus[] = ["PENDING", "FAILED", "PAID", "PARTIALLY_REFUNDED", "REFUNDED"];
    expect(statuses.map(cancellationRefund)).toEqual([null, null, "full", "remaining", "settled"]);
  });
});
