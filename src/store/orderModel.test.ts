import { describe, expect, it } from "vitest";
import type { DemonstrationAction } from "../api/orders";
import { fixturePendingOrder, fixtureQuote } from "../test-support/checkoutFixtures";
import {
  fixtureCustomerOrder, fixtureDeliveredOrder, fixtureRefund, fixtureReturn, fixtureStaffOrder, fixtureStaffRefund,
} from "../test-support/orderFixtures";
import { OrderFormatError, parseCustomerOrder, parseOrderTracking, parseStaffOrder } from "./orderModel";

const order = fixturePendingOrder(fixtureQuote());

describe("order view validation", () => {
  it("accepts the server's customer and staff views and checks the order identity", () => {
    const delivered = fixtureDeliveredOrder(order);
    expect(parseCustomerOrder(delivered, order.id).customerActions).toEqual(["REQUEST_RETURN"]);
    const staff = fixtureStaffOrder(order, { refundRequestOptions: [{ source: "CANCELLATION", maxAmount: 1244 }] });
    expect(parseStaffOrder(staff, order.id).allowedActions).toEqual(["CANCEL"]);
    expect(() => parseCustomerOrder(delivered, "another-order")).toThrow(/order identity/);
  });

  it("refuses records that could misstate money, status or permitted actions", () => {
    const delivered = fixtureDeliveredOrder(order);
    const invalid: [unknown, RegExp][] = [
      [{ ...delivered, refunds: [fixtureRefund({ status: "APPROVED", providerReference: "QA12BC34DE" })] }, /refunds/],
      [{ ...delivered, status: "AWAITING_REFUND" }, /order status/],
      [{ ...delivered, paymentStatus: "SENT" }, /order status/],
      [{ ...delivered, customerActions: ["CONFIRM_PICKUP"] }, /customer actions/],
      [{ ...delivered, returnEligibility: { ...delivered.returnEligibility, reasonCode: "WINDOW_CLOSED" } }, /return eligibility/],
    ];
    for (const [data, detail] of invalid) expect(() => parseCustomerOrder(data)).toThrow(detail);

    const staff = fixtureStaffOrder(order);
    const invalidStaff: [unknown, RegExp][] = [
      [{ ...staff, allowedActions: undefined }, /staff actions/],
      [{ ...staff, refunds: [{ ...fixtureStaffRefund(order.id), allowedActions: ["send"] }] }, /refunds/],
      [{ ...staff, refundRequestOptions: [{ source: "RETURN", maxAmount: 100 }] }, /refund request options/],
      [{ ...staff, refundRequestOptions: [{ source: "CANCELLATION", maxAmount: 0 }] }, /refund request options/],
    ];
    for (const [data, detail] of invalidStaff) expect(() => parseStaffOrder(data)).toThrow(detail);
    expect(() => parseStaffOrder(null)).toThrow(OrderFormatError);
  });
});

describe("sample-order deletion", () => {
  it("reads whether a customer order is scheduled for deletion; an older backend that omits it schedules none", () => {
    const customer = fixtureCustomerOrder(order);
    expect(parseCustomerOrder({ ...customer, scheduledForDeletion: true }).scheduledForDeletion).toBe(true);
    expect(parseCustomerOrder({ ...customer, scheduledForDeletion: false }).scheduledForDeletion).toBe(false);
    const { scheduledForDeletion: _omitted, ...older } = { ...customer, scheduledForDeletion: true };
    expect(parseCustomerOrder(older).scheduledForDeletion).toBe(false);
    for (const value of ["true", 1, null, {}]) {
      expect(() => parseCustomerOrder({ ...customer, scheduledForDeletion: value }), JSON.stringify(value)).toThrow(/scheduled deletion/);
    }
  });
});

describe("demonstration records", () => {
  const sample = fixturePendingOrder(fixtureQuote(), { isDemo: true, paymentMethod: "DEMONSTRATION", paymentStatus: "PAID" });
  const requested = fixtureReturn(sample);
  const refund = fixtureRefund({ method: "DEMONSTRATION" });
  const steps: DemonstrationAction[] = [
    { action: "START_PROCESSING", expectedStatus: "PENDING" },
    { action: "APPROVE", returnId: requested.id, expectedStatus: "REQUESTED" },
    { action: "COMPLETE_REFUND", refundId: refund.id, expectedStatus: "REQUESTED" },
  ];
  const view = fixtureCustomerOrder(sample, {
    returns: [requested], refunds: [refund], demonstrationActions: steps,
    trackingHistory: [{ id: "event-1", status: "PENDING", description: "Demonstration payment recorded; no money was taken. Awaiting fulfilment.",
      location: "Demonstration", createdAt: "2026-11-18T09:00:00.000Z", actorType: "DEMONSTRATION" }],
  });

  it("accepts the controls the server lists, demonstration events and demonstration refunds", () => {
    const parsed = parseCustomerOrder(JSON.parse(JSON.stringify(view)), sample.id);
    expect(parsed.demonstrationActions).toEqual(steps);
    expect(parsed.trackingHistory[0].actorType).toBe("DEMONSTRATION");
    expect(parsed.refunds[0].method).toBe("DEMONSTRATION");
    // Staff views carry no owner controls.
    expect(parseStaffOrder(fixtureStaffOrder(sample), sample.id)).not.toHaveProperty("demonstrationActions");
  });

  it("refuses controls that the order cannot have, unknown refund methods and unknown actors", () => {
    const invalid: [unknown, RegExp][] = [
      [{ ...view, demonstrationActions: undefined }, /demonstration actions/],
      [{ ...view, demonstrationActions: [{ action: "CANCEL", expectedStatus: "PENDING" }] }, /demonstration actions/],
      [{ ...view, demonstrationActions: [{ action: "DISPATCH", expectedStatus: "PROCESSING" }] }, /demonstration actions/],
      [{ ...view, demonstrationActions: [{ action: "APPROVE", returnId: "another-return", expectedStatus: "REQUESTED" }] }, /demonstration actions/],
      [{ ...view, demonstrationActions: [{ action: "RECEIVE", returnId: requested.id, expectedStatus: "APPROVED" }] }, /demonstration actions/],
      [{ ...view, demonstrationActions: [{ action: "COMPLETE_REFUND", refundId: refund.id, expectedStatus: "CONFIRMED" }] }, /demonstration actions/],
      [{ ...view, demonstrationActions: [steps[0], steps[0]] }, /demonstration actions/],
      [{ ...view, refunds: [{ ...refund, method: "CASH" }] }, /refunds/],
      [{ ...view, trackingHistory: [{ ...view.trackingHistory[0], actorType: "VISITOR" }] }, /tracking history/],
    ];
    for (const [data, detail] of invalid) expect(() => parseCustomerOrder(data)).toThrow(detail);
    // A refund step only for a demonstration refund the order has.
    const mpesa = { ...view, refunds: [{ ...refund, method: "MPESA_MANUAL" }] };
    expect(() => parseCustomerOrder(mpesa)).toThrow(/demonstration actions/);
  });
});

describe("public tracking validation", () => {
  const step = { id: "event-1", status: "SHIPPED", description: "Shipped", location: null, createdAt: "2026-11-14T09:30:00.000Z", actorType: null };

  it("accepts the tracking view as the server projects it, including an order with no steps yet", () => {
    expect(parseOrderTracking({ orderNumber: "APX-1", status: "SHIPPED", trackingHistory: [step] }).trackingHistory).toEqual([step]);
    expect(parseOrderTracking({ orderNumber: "APX-2", status: "PENDING", trackingHistory: [] }).trackingHistory).toEqual([]);
  });

  it.each([
    ["an unknown status", { orderNumber: "APX-1", status: "TELEPORTED", trackingHistory: [] }],
    ["no order number", { orderNumber: "", status: "SHIPPED", trackingHistory: [] }],
    ["a step without a time", { orderNumber: "APX-1", status: "SHIPPED", trackingHistory: [{ ...step, createdAt: "soon" }] }],
    ["a step with an unknown status", { orderNumber: "APX-1", status: "SHIPPED", trackingHistory: [{ ...step, status: "LOST" }] }],
    ["no history list", { orderNumber: "APX-1", status: "SHIPPED" }],
  ])("refuses a view with %s instead of showing it", (_, data) => {
    expect(() => parseOrderTracking(data)).toThrow(OrderFormatError);
  });
});
