import { describe, expect, it } from "vitest";
import { fixturePendingOrder, fixtureQuote } from "../test-support/checkoutFixtures";
import { fixtureDeliveredOrder, fixtureRefund, fixtureStaffOrder, fixtureStaffRefund } from "../test-support/orderFixtures";
import { OrderFormatError, parseCustomerOrder, parseStaffOrder } from "./orderModel";

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
