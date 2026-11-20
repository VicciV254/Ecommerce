import { describe, expect, it } from "vitest";
import type { DeliveryMethod, OrderStatus, PaymentStatus, RefundStatus } from "../api/orders";
import { fixturePendingOrder, fixtureQuote } from "../test-support/checkoutFixtures";
import { fixtureCustomerOrder, fixtureDeliveredOrder, fixtureRefund, fixtureReturn } from "../test-support/orderFixtures";
import { REFUND_STATUSES } from "./orderModel";
import {
  ACTOR_LABELS, ORDER_STATUS_LABELS, REFUND_METHOD_LABELS, STAFF_REFUND_STATUS, cancellationNotice, cancellationRefund,
  orderStatusLabel, paymentLabel, productReturnFact, refundStatusText, returnNotice, returnPolicyTerms, returnRuleText,
  returnStatusText, returnWindowText, sampleRetentionText, shopperOrderStatusLabel,
} from "./orderCopy";

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

describe("demonstration labels and wording", () => {
  const sample = fixturePendingOrder(fixtureQuote(), { isDemo: true });
  const paidByDemonstration = { ...sample, paymentMethod: "DEMONSTRATION", paymentStatus: "PAID" as const };

  it("names the demonstration payment, its refunds and its actor, and never shows an M-Pesa reference for them", () => {
    expect(paymentLabel(paidByDemonstration)).toBe("Demonstration payment (paid)");
    expect(paymentLabel({ ...sample, paymentStatus: "PAID" })).toBe("M-Pesa (paid)");
    expect(paymentLabel({ ...sample, paymentMethod: "BANK_TRANSFER" })).toBe("bank transfer (pending)");
    expect(paymentLabel({ ...sample, paymentMethod: "constructor" })).toBe("constructor (pending)");
    expect(REFUND_METHOD_LABELS).toEqual({ MPESA_MANUAL: "M-Pesa", DEMONSTRATION: "Demonstration refund (no money sent)" });
    expect(ACTOR_LABELS.DEMONSTRATION).toBe("Demonstration");
    const recorded = refundStatusText({ status: "CONFIRMED", confirmedAt: CONFIRMED_AT, providerReference: null, method: "DEMONSTRATION" });
    expect(recorded).toMatch(/^Recorded on .+; no money was sent$/);
    expect(recorded).not.toMatch(/M-Pesa|reference/);
    for (const status of REFUND_STATUSES.filter((value) => value !== "CONFIRMED")) {
      const text = refundStatusText({ status, confirmedAt: null, providerReference: null, method: "DEMONSTRATION" });
      expect(text.replace(/not sent/gi, ""), status).not.toMatch(/M-Pesa|reference|sent/i);
    }
  });

  it("promises no email and describes refunds without money for a demonstration-paid order", () => {
    const refund = fixtureRefund({ source: "CANCELLATION", amount: 1244, method: "DEMONSTRATION" });
    const cancelled = { orderNumber: sample.orderNumber, refunds: [refund] };
    expect(cancellationNotice({ ...cancelled, paymentMethod: "DEMONSTRATION" })).not.toMatch(/email/i);
    expect(cancellationNotice({ ...cancelled, paymentMethod: "MPESA", refunds: [{ ...refund, method: "MPESA_MANUAL" }] }))
      .toMatch(/We will email you when it is sent\.$/);
    const requested = fixtureReturn(sample);
    expect(returnNotice(requested, { returns: [requested], refunds: [], paymentMethod: "DEMONSTRATION" }))
      .toBe(`Return ${requested.number} requested. Nothing is refunded until the items are received and checked.`);
    expect(returnNotice(requested, { returns: [requested], refunds: [], paymentMethod: "MPESA" })).toMatch(/We will email you/);
    const policy = fixtureDeliveredOrder(sample).returnEligibility.policy;
    const terms = returnPolicyTerms(policy, "DEMONSTRATION");
    expect(terms).toContain("Refunds of demonstration payments are recorded without moving money.");
    expect(terms.join(" ")).not.toMatch(/M-Pesa|email/);
    expect(returnPolicyTerms(policy, "MPESA")).toContain(
      "Refunds are sent by M-Pesa after staff receive and check the items. We will email you when your refund is sent.");
  });

  it("reads a sample order's returns as played in the demonstration, however it was paid", () => {
    expect(returnStatusText("APPROVED", { isDemo: true })).toBe("Approved in the demonstration");
    expect(returnStatusText("RECEIVED", { isDemo: true })).toBe("Marked as received in the demonstration");
    expect(returnStatusText("REQUESTED", { isDemo: true })).toBe("Awaiting review");
    expect(returnStatusText("APPROVED", { isDemo: false })).toBe("Approved — staff will arrange the return");
    expect(returnStatusText("RECEIVED", {})).toBe("Received and checked");
    const received = fixtureReturn(sample, { status: "RECEIVED", receivedAt: CONFIRMED_AT, merchantFaultConfirmed: false });
    expect(returnNotice(received, { returns: [received], refunds: [], paymentMethod: "MPESA", isDemo: true }))
      .toBe(`Return ${received.number}: Marked as received in the demonstration. No refund is due for it.`);
    expect(returnNotice(received, { returns: [received], refunds: [], paymentMethod: "MPESA", isDemo: false }))
      .toBe(`Return ${received.number}: Received and checked. No refund is due for it.`);
  });

  it("states the delivery-fee term without staff for a demonstration-paid order, and keeps it for M-Pesa", () => {
    const policy = fixtureDeliveredOrder(sample).returnEligibility.policy;
    expect(policy.deliveryFeeRefund).toBe("MERCHANT_FAULT_ONLY");
    const demonstration = returnPolicyTerms(policy, "DEMONSTRATION");
    expect(demonstration).toContain("The delivery fee is refunded only for a faulty, damaged or wrong item.");
    expect(demonstration.join(" ")).not.toMatch(/staff/i);
    expect(returnPolicyTerms(policy, "MPESA")).toContain("The delivery fee is refunded only if staff confirm an item was faulty, damaged or wrong.");
    expect(returnPolicyTerms({ ...policy, deliveryFeeRefund: "ALWAYS" }, "DEMONSTRATION"))
      .toContain("The delivery fee is included in your first accepted return refund.");
  });

  it("says a sample product's refunds move no money only where sample orders take demonstration payments", () => {
    const terms = { windowDays: 7, deliveryFeeRefund: "MERCHANT_FAULT_ONLY" as const };
    const fee = "delivery fee refunded only for faulty, damaged or wrong items.";
    expect(productReturnFact("STANDARD", terms, true).refunds).toBe(`Refunds of demonstration payments move no money; ${fee}`);
    expect(productReturnFact("STANDARD", terms, false).refunds).toBe(`Refunds by M-Pesa; ${fee}`);
    expect(productReturnFact("FAULT_ONLY", terms).refunds).toBe(`Refunds by M-Pesa; ${fee}`);
  });
});

describe("sample-order deletion", () => {
  it("says when a sample order scheduled for deletion is deleted, only while the catalog states a period", () => {
    expect(sampleRetentionText({ scheduledForDeletion: true }, 7)).toBe("Sample orders are scheduled for deletion 7 days after they're placed.");
    expect(sampleRetentionText({ scheduledForDeletion: true }, 1)).toBe("Sample orders are scheduled for deletion 1 day after they're placed.");
    expect(sampleRetentionText({ scheduledForDeletion: true }, null)).toBeNull();
    // Kept orders (an M-Pesa attempt or money evidence), live orders and older backends that omit the answer.
    expect(sampleRetentionText({ scheduledForDeletion: false }, 7)).toBeNull();
    expect(sampleRetentionText({}, 7)).toBeNull();
  });
});

describe("an order's return wording", () => {
  it("names the order's own handover: delivery for delivered orders, collection for pickup orders", () => {
    const window = (deliveryMethod: DeliveryMethod) => returnWindowText(fixtureCustomerOrder(fixturePendingOrder(fixtureQuote())).returnEligibility, deliveryMethod);
    expect(DELIVERY_METHODS.map((method) => [method, returnRuleText("STANDARD", 7, method), window(method)])).toEqual([
      ["STANDARD", "Returnable for any reason within 7 days of delivery.", "Returns open for 7 days after delivery."],
      ["SAME_DAY", "Returnable for any reason within 7 days of delivery.", "Returns open for 7 days after delivery."],
      ["STORE_PICKUP", "Returnable for any reason within 7 days of collection.", "Returns open for 7 days after collection."],
    ]);
    for (const method of DELIVERY_METHODS) expect(window(method)).not.toContain("delivery or collection");
  });
});
