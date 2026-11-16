import { describe, expect, it } from "vitest";
import type { DeliveryMethod, OrderStatus, PaymentStatus, RefundStatus } from "../api/orders";
import { REFUND_STATUSES } from "./orderModel";
import { ORDER_STATUS_LABELS, STAFF_REFUND_STATUS, cancellationRefund, orderStatusLabel, refundStatusText, shopperOrderStatusLabel } from "./orderCopy";

const PAYMENT_STATUSES: PaymentStatus[] = ["PENDING", "PAID", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"];
const ORDER_STATUSES = Object.keys(ORDER_STATUS_LABELS) as OrderStatus[];
const DELIVERY_METHODS: DeliveryMethod[] = ["STANDARD", "SAME_DAY", "STORE_PICKUP"];

describe("shopper order status", () => {
  it("says what a pending order is waiting for: payment, or preparation once paid", () => {
    for (const deliveryMethod of DELIVERY_METHODS) {
      expect(shopperOrderStatusLabel({ status: "PENDING", paymentStatus: "PENDING", deliveryMethod })).toBe("Awaiting payment");
      expect(shopperOrderStatusLabel({ status: "PENDING", paymentStatus: "FAILED", deliveryMethod })).toBe("Awaiting payment");
      expect(shopperOrderStatusLabel({ status: "PENDING", paymentStatus: "PAID", deliveryMethod })).toBe("Waiting to be prepared");
    }
  });

  it("never reads just \"Pending\" for a paid order, and keeps it for money already refunded", () => {
    expect(shopperOrderStatusLabel({ status: "PENDING", paymentStatus: "PAID", deliveryMethod: "STANDARD" })).not.toBe("Pending");
    // Refunded money is neither awaited nor ready to prepare, so these keep the canonical name.
    expect(shopperOrderStatusLabel({ status: "PENDING", paymentStatus: "REFUNDED", deliveryMethod: "STANDARD" })).toBe("Pending");
    expect(shopperOrderStatusLabel({ status: "PENDING", paymentStatus: "PARTIALLY_REFUNDED", deliveryMethod: "STANDARD" })).toBe("Pending");
  });

  it("reads every other status as staff do, including a collected pickup", () => {
    for (const status of ORDER_STATUSES.filter((value) => value !== "PENDING")) {
      for (const paymentStatus of PAYMENT_STATUSES) {
        for (const deliveryMethod of DELIVERY_METHODS) {
          const order = { status, paymentStatus, deliveryMethod };
          expect(shopperOrderStatusLabel(order), `${status}/${paymentStatus}/${deliveryMethod}`).toBe(orderStatusLabel(order));
        }
      }
    }
    expect(shopperOrderStatusLabel({ status: "DELIVERED", paymentStatus: "PAID", deliveryMethod: "STORE_PICKUP" })).toBe("Collected");
    expect(shopperOrderStatusLabel({ status: "SHIPPED", paymentStatus: "PAID", deliveryMethod: "STANDARD" })).toBe("Dispatched");
  });

  it("leaves the canonical staff names unchanged", () => {
    expect(ORDER_STATUS_LABELS.PENDING).toBe("Pending");
    for (const paymentStatus of PAYMENT_STATUSES) {
      expect(orderStatusLabel({ status: "PENDING", deliveryMethod: "STANDARD" }), paymentStatus).toBe("Pending");
    }
  });
});

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
