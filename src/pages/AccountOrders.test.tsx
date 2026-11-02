import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../api/auth";
import type { Order } from "../api/orders";
import { fixturePendingOrder, fixtureQuote } from "../test-support/checkoutFixtures";
import { PAYABLE, fixtureConfirmedAttempt, fixturePaymentOverview } from "../test-support/paymentFixtures";
import AccountOrders from "./AccountOrders";

const mocks = vi.hoisted(() => ({
  user: null as User | null,
  orders: { getMyOrders: vi.fn(), cancel: vi.fn(), pickup: vi.fn(), returnOrder: vi.fn(), track: vi.fn() },
  payments: { getOverview: vi.fn(), requestPrompt: vi.fn(), checkAttempt: vi.fn() },
}));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../store/StorefrontContext", () => ({ useStorefront: () => ({ brandName: "Apex Cart", storefront: null, mediaById: new Map() }) }));
vi.mock("../api/orders", async (importOriginal) => ({ ...await importOriginal<typeof import("../api/orders")>(), ordersAPI: mocks.orders }));
vi.mock("../api/mpesa", () => ({ paymentsAPI: mocks.payments, staffPaymentsAPI: {} }));

const WAIT = { timeout: 3000 };
const customer: User = { id: "customer-a", email: "a@example.test", firstName: "Ada", lastName: "Customer" };
const placed = fixturePendingOrder(fixtureQuote());
const legacy: Order = { ...fixturePendingOrder(fixtureQuote({ id: "quote-legacy" })), id: "order-legacy", orderNumber: "APX-LEGACY", quoteId: null };

beforeEach(() => {
  mocks.user = customer;
  for (const fn of [...Object.values(mocks.orders), ...Object.values(mocks.payments)]) fn.mockReset();
  mocks.orders.getMyOrders.mockResolvedValue({ data: { orders: [placed, legacy], pagination: { page: 1, limit: 100, total: 2, pages: 1 } } });
});

describe("order history payments", () => {
  it("loads payments only for an opened quote-based receipt and keeps the list in step with a confirmed payment", async () => {
    const paid = { ...placed, paymentStatus: "PAID" as const, reservationStatus: "COMMITTED" as const, reservationExpiresAt: null };
    mocks.payments.getOverview.mockResolvedValue({ data: fixturePaymentOverview(paid, {
      environment: "production", reasonCode: "ORDER_NOT_PAYABLE", message: "This order is not awaiting payment on an active reservation.",
      attempts: [fixtureConfirmedAttempt(placed)],
    }) });
    render(<AccountOrders />);
    const [placedDetails, legacyDetails] = await screen.findAllByRole("button", { name: "Details" }, WAIT);
    expect(screen.getAllByText("Payment: M-Pesa (pending)")).toHaveLength(2);
    expect(mocks.payments.getOverview).not.toHaveBeenCalled();

    fireEvent.click(legacyDetails);
    const legacyReceipt = screen.getByRole("dialog", { name: "Receipt Details" });
    expect(within(legacyReceipt).queryByRole("region", { name: "Pay with M-Pesa" })).toBeNull();
    fireEvent.click(within(legacyReceipt).getByRole("button", { name: "Close" }));
    expect(mocks.payments.getOverview).not.toHaveBeenCalled();

    fireEvent.click(placedDetails);
    const receipt = screen.getByRole("dialog", { name: "Receipt Details" });
    expect(await within(receipt).findByText("Payment confirmed", undefined, WAIT)).toBeTruthy();
    expect(mocks.payments.getOverview.mock.calls).toEqual([[placed.id]]);
    expect(within(receipt).getByText("M-Pesa (paid)")).toBeTruthy();
    expect(within(receipt).getByRole("button", { name: "Cancel & Refund" })).toBeTruthy();
    expect(screen.getByText("Payment: M-Pesa (paid)")).toBeTruthy();
    expect(screen.getByText("Payment: M-Pesa (pending)")).toBeTruthy();
    expect(mocks.payments.requestPrompt).not.toHaveBeenCalled();
  });

  it("updates the open receipt and reloads payment eligibility immediately after cancellation", async () => {
    const cancelled = { ...placed, status: "CANCELLED" as const, reservationStatus: "RELEASED" as const };
    mocks.orders.cancel.mockResolvedValue({ data: cancelled });
    mocks.payments.getOverview.mockResolvedValueOnce({ data: fixturePaymentOverview(placed, PAYABLE) })
      .mockResolvedValue({ data: fixturePaymentOverview(cancelled, {
        environment: "production", reasonCode: "ORDER_NOT_PAYABLE", message: "This order is no longer payable.",
      }) });
    render(<AccountOrders />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Details" }, WAIT))[0]);
    const receipt = screen.getByRole("dialog", { name: "Receipt Details" });
    await within(receipt).findByRole("button", { name: "Send M-Pesa prompt" }, WAIT);
    fireEvent.click(within(receipt).getByRole("button", { name: "Cancel Order" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Cancel Order" })).getByRole("button", { name: "Cancel Order" }));
    expect(await within(receipt).findByText("This order is no longer payable.", undefined, WAIT)).toBeTruthy();
    expect(within(receipt).queryByRole("button", { name: "Send M-Pesa prompt" })).toBeNull();
    expect(within(receipt).queryByRole("button", { name: "Cancel Order" })).toBeNull();
    expect(mocks.orders.getMyOrders).toHaveBeenCalledTimes(1);
  });

  it("closes the previous account's receipt before loading another customer's orders", async () => {
    mocks.payments.getOverview.mockResolvedValue({ data: fixturePaymentOverview(placed) });
    const view = render(<AccountOrders />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Details" }, WAIT))[0]);
    await screen.findByText("M-Pesa payment unavailable", undefined, WAIT);
    mocks.user = { ...customer, id: "customer-b", email: "b@example.test" };
    mocks.orders.getMyOrders.mockResolvedValue({ data: { orders: [], pagination: { page: 1, limit: 100, total: 0, pages: 0 } } });
    view.rerender(<AccountOrders />);
    expect(screen.queryByRole("dialog", { name: "Receipt Details" })).toBeNull();
    expect(await screen.findByText(/No orders yet\./, undefined, WAIT)).toBeTruthy();
    expect(mocks.payments.getOverview.mock.calls).toEqual([[placed.id]]);
  });
});
