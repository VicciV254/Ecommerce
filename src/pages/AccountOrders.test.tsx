import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../api/auth";
import type { CustomerOrder } from "../api/orders";
import { fixturePendingOrder, fixtureQuote } from "../test-support/checkoutFixtures";
import { fixtureCustomerOrder, fixtureDeliveredOrder, fixtureRefund, fixtureReturn } from "../test-support/orderFixtures";
import { PAYABLE, PAYMENT_MESSAGES, fixtureConfirmedAttempt, fixturePaymentOverview } from "../test-support/paymentFixtures";
import { named } from "../test-support/text";
import { formatKES } from "../utils/format";
import AccountOrders from "./AccountOrders";

const mocks = vi.hoisted(() => ({
  user: null as User | null,
  orders: {
    getMyOrders: vi.fn(), get: vi.fn(), cancel: vi.fn(), requestReturn: vi.fn(), cancelReturn: vi.fn(), track: vi.fn(), playDemonstration: vi.fn(),
  },
  payments: { getOverview: vi.fn(), requestPrompt: vi.fn(), checkAttempt: vi.fn() },
}));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../store/StorefrontContext", () => ({ useStorefront: () => ({ brandName: "Apex Cart", storefront: null, mediaById: new Map() }) }));
vi.mock("../api/orders", async (importOriginal) => ({ ...await importOriginal<typeof import("../api/orders")>(), ordersAPI: mocks.orders }));
vi.mock("../api/mpesa", () => ({ paymentsAPI: mocks.payments, staffPaymentsAPI: {} }));

const WAIT = { timeout: 3000 };
const customer: User = { id: "customer-a", email: "a@example.test", firstName: "Ada", lastName: "Customer" };
const placed = fixtureCustomerOrder(fixturePendingOrder(fixtureQuote()));
const legacy: CustomerOrder = {
  ...fixtureCustomerOrder(fixturePendingOrder(fixtureQuote({ id: "quote-legacy" }))), id: "order-legacy", orderNumber: "APX-LEGACY", quoteId: null,
};
const page = (orders: CustomerOrder[]) => ({ data: { orders, pagination: { page: 1, limit: 100, total: orders.length, pages: 1 } } });
const refusal = (code: string, error: string) => {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError("Conflict", "ERR_BAD_REQUEST", config, undefined, { status: 409, statusText: "Conflict", data: { error, code }, headers: new AxiosHeaders(), config });
};

beforeEach(() => {
  mocks.user = customer;
  for (const fn of [...Object.values(mocks.orders), ...Object.values(mocks.payments)]) fn.mockReset();
  mocks.orders.getMyOrders.mockResolvedValue(page([placed, legacy]));
});

describe("order history payments", () => {
  it("loads payments only for an opened quote-based receipt and keeps the list in step with a confirmed payment", async () => {
    const paid = { ...placed, paymentStatus: "PAID" as const, reservationStatus: "COMMITTED" as const, reservationExpiresAt: null };
    mocks.payments.getOverview.mockResolvedValue({ data: fixturePaymentOverview(paid, {
      environment: "production", reasonCode: "ORDER_NOT_PAYABLE", message: "This order is not awaiting payment on an active reservation.",
      attempts: [fixtureConfirmedAttempt(placed)],
    }) });
    // The changed payment state reloads the order, so its permitted actions come from the server again.
    mocks.orders.get.mockResolvedValue({ data: paid });
    render(<AccountOrders />);
    const [placedDetails, legacyDetails] = await screen.findAllByRole("button", { name: "Details" }, WAIT);
    expect(screen.getAllByText("Payment: M-Pesa (pending)")).toHaveLength(2);
    expect(mocks.payments.getOverview).not.toHaveBeenCalled();

    fireEvent.click(legacyDetails);
    const legacyReceipt = screen.getByRole("dialog", { name: "Receipt details" });
    expect(within(legacyReceipt).queryByRole("region", { name: "Pay with M-Pesa" })).toBeNull();
    fireEvent.click(within(legacyReceipt).getByRole("button", { name: "Close" }));
    expect(mocks.payments.getOverview).not.toHaveBeenCalled();

    fireEvent.click(placedDetails);
    const receipt = screen.getByRole("dialog", { name: "Receipt details" });
    expect(await within(receipt).findByText("Payment confirmed", undefined, WAIT)).toBeTruthy();
    expect(mocks.payments.getOverview.mock.calls).toEqual([[placed.id]]);
    expect(within(receipt).getByText("M-Pesa (paid)")).toBeTruthy();
    expect(await within(receipt).findByRole("button", { name: "Cancel & request refund" }, WAIT)).toBeTruthy();
    expect(mocks.orders.get.mock.calls).toEqual([[placed.id]]);
    expect(screen.getByText("Payment: M-Pesa (paid)")).toBeTruthy();
    expect(screen.getByText("Payment: M-Pesa (pending)")).toBeTruthy();
    expect(mocks.payments.requestPrompt).not.toHaveBeenCalled();
  });

  it("updates the open receipt and reloads payment eligibility immediately after cancellation", async () => {
    const cancelled = { ...placed, status: "CANCELLED" as const, reservationStatus: "RELEASED" as const, customerActions: [] };
    mocks.orders.cancel.mockResolvedValue({ data: cancelled });
    mocks.payments.getOverview.mockResolvedValueOnce({ data: fixturePaymentOverview(placed, PAYABLE) })
      .mockResolvedValue({ data: fixturePaymentOverview(cancelled, {
        environment: "production", reasonCode: "ORDER_NOT_PAYABLE", message: "This order is no longer payable.",
      }) });
    render(<AccountOrders />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Details" }, WAIT))[0]);
    const receipt = screen.getByRole("dialog", { name: "Receipt details" });
    await within(receipt).findByRole("button", { name: "Send M-Pesa prompt" }, WAIT);
    fireEvent.click(within(receipt).getByRole("button", { name: "Cancel order" }));
    const cancellation = screen.getByRole("dialog", { name: "Cancel order" });
    expect(within(cancellation).getByText(`Cancel order ${placed.orderNumber}? Any items held for it will be released.`)).toBeTruthy();
    fireEvent.click(within(cancellation).getByRole("button", { name: "Cancel order" }));
    expect(await within(receipt).findByText("This order is no longer payable.", undefined, WAIT)).toBeTruthy();
    expect(within(receipt).queryByRole("button", { name: "Send M-Pesa prompt" })).toBeNull();
    expect(within(receipt).queryByRole("button", { name: "Cancel order" })).toBeNull();
    expect(mocks.orders.cancel.mock.calls).toEqual([[placed.id, {}]]);
    expect(mocks.orders.getMyOrders).toHaveBeenCalledTimes(1);
  });

  it("closes the previous account's receipt before loading another customer's orders", async () => {
    mocks.payments.getOverview.mockResolvedValue({ data: fixturePaymentOverview(placed) });
    const view = render(<AccountOrders />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Details" }, WAIT))[0]);
    await screen.findByText("M-Pesa payment unavailable", undefined, WAIT);
    mocks.user = { ...customer, id: "customer-b", email: "b@example.test" };
    mocks.orders.getMyOrders.mockResolvedValue(page([]));
    view.rerender(<AccountOrders />);
    expect(screen.queryByRole("dialog", { name: "Receipt details" })).toBeNull();
    expect(await screen.findByText(/No orders yet\./, undefined, WAIT)).toBeTruthy();
    expect(mocks.payments.getOverview.mock.calls).toEqual([[placed.id]]);
  });
});

describe("order actions, returns and refunds", () => {
  const order = (overrides: Partial<CustomerOrder>, number: string) =>
    fixtureCustomerOrder(fixturePendingOrder(fixtureQuote({ id: number.toLowerCase() })), overrides);

  it("says what a pending order is waiting for on its card and in its details, never just \"Pending\"", async () => {
    const paid = order({ id: "order-paid", orderNumber: "APX-PAID", paymentStatus: "PAID", reservationStatus: "COMMITTED", reservationExpiresAt: null }, "Q-PAID");
    mocks.orders.getMyOrders.mockResolvedValue(page([placed, paid]));
    mocks.payments.getOverview.mockResolvedValue({ data: fixturePaymentOverview(paid) });
    render(<AccountOrders />);
    const [unpaidItems, paidItems] = await screen.findAllByRole("list", { name: /^Items in order/ }, WAIT);
    const card = (items: HTMLElement) => items.closest("li")!;
    expect(within(card(unpaidItems)).getByText("Awaiting payment")).toBeTruthy();
    expect(within(card(paidItems)).getByText("Waiting to be prepared")).toBeTruthy();
    expect(within(card(paidItems)).getByText("Payment: M-Pesa (paid)")).toBeTruthy();
    expect(screen.queryByText("Pending")).toBeNull();

    fireEvent.click(within(card(paidItems)).getByRole("button", { name: "Details" }));
    const details = screen.getByRole("dialog");
    expect(within(within(details).getByRole("region", { name: "Order summary" })).getByText("Waiting to be prepared")).toBeTruthy();
    expect(within(details).queryByText("Pending")).toBeNull();
  });

  it("colours a paid order waiting to be prepared as progress, and only an unpaid one as needing attention", async () => {
    const paid = order({ id: "order-paid", orderNumber: "APX-PAID", paymentStatus: "PAID", reservationStatus: "COMMITTED", reservationExpiresAt: null }, "Q-PAID");
    mocks.orders.getMyOrders.mockResolvedValue(page([placed, paid]));
    mocks.payments.getOverview.mockResolvedValue({ data: fixturePaymentOverview(paid) });
    render(<AccountOrders />);
    const [unpaidItems, paidItems] = await screen.findAllByRole("list", { name: /^Items in order/ }, WAIT);
    const badge = (items: HTMLElement, label: string) => within(items.closest("li")!).getByText(label).className.split(/\s+/);
    expect(badge(unpaidItems, "Awaiting payment")).toContain("text-warning");
    expect(badge(paidItems, "Waiting to be prepared")).toContain("text-info");
    expect(badge(paidItems, "Waiting to be prepared")).not.toContain("text-warning");
  });

  it("offers only the actions the server permits, and never a customer pickup confirmation", async () => {
    const reviewing = order({ status: "PROCESSING", paymentStatus: "PAID", customerActions: [] }, "Q-REVIEW");
    const ready = order({ status: "READY_FOR_PICKUP", paymentStatus: "PAID", deliveryMethod: "STORE_PICKUP", customerActions: [] }, "Q-READY");
    const returnable = fixtureDeliveredOrder(fixturePendingOrder(fixtureQuote({ id: "q-returnable" })));
    const closed = fixtureDeliveredOrder(fixturePendingOrder(fixtureQuote({ id: "q-closed" })), {
      deliveredAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    }, { customerActions: [] });
    const closedOrder: CustomerOrder = {
      ...closed, returnEligibility: { ...closed.returnEligibility, eligible: false, reasonCode: "WINDOW_CLOSED" },
    };
    mocks.orders.getMyOrders.mockResolvedValue(page([reviewing, ready, returnable, closedOrder]));
    render(<AccountOrders />);
    const cards = await screen.findAllByRole("list", { name: /^Items in order/ }, WAIT);
    expect(cards).toHaveLength(4);
    // Store pickup is off for new orders, but an order placed with it still shows its method and pickup status.
    expect(screen.getAllByText(/ · Store pickup$/)).toHaveLength(1);
    expect(screen.getAllByText("Ready for pickup").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Cancel/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Pick ?up|Collected|Confirm/i })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Request a return" })).toHaveLength(1);
    expect(screen.getByText(/^The return window closed on /)).toBeTruthy();
    expect(screen.getByText(/^Returns can be requested until /)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Request a return" }));
    expect(screen.getByRole("dialog", { name: "Request a return" })).toBeTruthy();
  });

  it("describes refunds and returns truthfully and shows an M-Pesa reference only for a confirmed refund", async () => {
    const delivered = fixtureDeliveredOrder(fixturePendingOrder(fixtureQuote({ id: "q-refunds" })));
    const withRecords: CustomerOrder = {
      ...delivered,
      returns: [fixtureReturn(delivered, { status: "REJECTED", decisionNote: "The item has been worn." })],
      refunds: [
        fixtureRefund({ id: "refund-2", number: "RF-2", status: "APPROVED", amount: 1244, source: "CANCELLATION", includesDeliveryFee: true }),
        fixtureRefund({ id: "refund-1", number: "RF-1", status: "CONFIRMED", amount: 500, confirmedAt: new Date().toISOString(), providerReference: "QA12BC34DE" }),
      ],
    };
    mocks.orders.getMyOrders.mockResolvedValue(page([withRecords]));
    render(<AccountOrders />);
    expect(await screen.findByText("Refund of KES 1,244: Approved — not sent yet.", undefined, WAIT)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    const receipt = screen.getByRole("dialog", { name: "Receipt details" });
    const approved = within(receipt).getByText("Approved — not sent yet").closest("li");
    const confirmed = within(receipt).getByText(/^Sent by M-Pesa on .+ · M-Pesa reference QA12BC34DE$/).closest("li");
    expect(approved?.textContent).toContain("includes the delivery fee");
    expect(approved?.textContent).not.toMatch(/reference|QA12BC34DE/);
    expect(confirmed?.textContent).toContain("KES 500");
    expect(within(receipt).getByText("Not approved")).toBeTruthy();
    expect(within(receipt).getByText("Note from staff: The item has been worn.")).toBeTruthy();
  });

  const CONFIRMED_SENT = /Sent by M-Pesa on .+ · M-Pesa reference QA12BC34DE/;
  const notice = () => screen.getAllByRole("status").map((element) => element.textContent ?? "").find((text) => text.trim()) ?? "";

  it("reports a replayed cancellation from the refund the server returned, even one already sent", async () => {
    const paidOrder = order({ status: "PROCESSING", paymentStatus: "PAID", reservationStatus: "COMMITTED", reservationExpiresAt: null }, "Q-REPLAY");
    const sent = fixtureRefund({
      source: "CANCELLATION", status: "CONFIRMED", amount: 1244, includesDeliveryFee: true,
      confirmedAt: new Date().toISOString(), providerReference: "QA12BC34DE",
    });
    mocks.orders.getMyOrders.mockResolvedValue(page([paidOrder]));
    // The first answer was lost; by the time the customer retried, staff had already sent the refund.
    mocks.orders.cancel.mockResolvedValue({ data: { ...paidOrder, status: "CANCELLED", customerActions: [], refunds: [sent] } });
    render(<AccountOrders />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel & request refund" }, WAIT));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Cancel order" })).getByRole("button", { name: "Cancel order" }));
    await vi.waitFor(() => expect(notice()).toMatch(/^Order APX-Q-REPLAY cancelled\./), WAIT);
    expect(notice()).toMatch(CONFIRMED_SENT);
    expect(notice()).not.toMatch(/not been sent|not sent/i);
  });

  it("reports a retried return as staff have since handled it, with its refund's recorded status", async () => {
    const delivered = fixtureDeliveredOrder(fixturePendingOrder(fixtureQuote({ id: "q-retried" })));
    const received = fixtureReturn(delivered, {
      status: "RECEIVED", receivedAt: new Date().toISOString(), merchantFaultConfirmed: false,
      lines: [{ ...fixtureReturn(delivered).lines[0], receivedQuantity: 1, refundableQuantity: 1 }],
    });
    const sent = fixtureRefund({ status: "CONFIRMED", amount: 1044, confirmedAt: new Date().toISOString(), providerReference: "QA12BC34DE" });
    mocks.orders.getMyOrders.mockResolvedValue(page([delivered]));
    // A retry with the saved key replays the request as the server records it now.
    mocks.orders.requestReturn.mockResolvedValue({
      status: 200, data: { returnRequest: received, order: { ...delivered, customerActions: [], returns: [received], refunds: [sent] } },
    });
    render(<AccountOrders />);
    fireEvent.click(await screen.findByRole("button", { name: "Request a return" }, WAIT));
    const dialog = screen.getByRole("dialog", { name: "Request a return" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Return one more Linen Short-Sleeve Shirt" }));
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Reason for return" }), { target: { value: "DAMAGED" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit return request" }));
    await vi.waitFor(() => expect(notice()).toMatch(new RegExp(`^Return ${received.number}: Received and checked\\.`)), WAIT);
    expect(notice()).toMatch(CONFIRMED_SENT);
    expect(notice()).not.toMatch(/No refund has been sent/);
  });

  const processingPaid = (id: string) => order({ status: "PROCESSING", paymentStatus: "PAID", reservationStatus: "COMMITTED", reservationExpiresAt: null }, id);
  const tryToCancel = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Cancel & request refund" }, WAIT));
    const dialog = screen.getByRole("dialog", { name: "Cancel order" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel order" }));
    return dialog;
  };

  it("reloads an order whose cancellation was refused because it moved on, so the action disappears", async () => {
    const pending = processingPaid("Q-SHIPPED");
    mocks.orders.getMyOrders.mockResolvedValue(page([pending]));
    mocks.orders.cancel.mockRejectedValue(refusal("ACTION_NOT_ALLOWED", "This order cannot be cancelled at this stage. Request a return after delivery instead."));
    mocks.orders.get.mockResolvedValue({ data: { ...pending, status: "SHIPPED", customerActions: [] } });
    render(<AccountOrders />);
    const dialog = await tryToCancel();
    await vi.waitFor(() => expect(mocks.orders.get.mock.calls).toEqual([[pending.id]]), WAIT);
    expect((await within(dialog).findByRole("alert", undefined, WAIT)).textContent)
      .toBe("This order can no longer be cancelled because it has moved on since this page loaded. The order has been refreshed.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep order" }));
    expect(screen.queryByRole("button", { name: /Cancel/ })).toBeNull();
    expect(screen.getByText("Dispatched")).toBeTruthy();
  });

  it("says inside the dialog when an order refused during payment review could not be refreshed", async () => {
    const reviewing = processingPaid("Q-REVIEWING");
    mocks.orders.getMyOrders.mockResolvedValue(page([reviewing]));
    mocks.orders.cancel.mockRejectedValue(refusal("PAYMENT_REVIEW_REQUIRED", "This payment is under review. Contact support before cancelling."));
    mocks.orders.get.mockRejectedValue(new AxiosError("Offline", "ERR_NETWORK"));
    render(<AccountOrders />);
    const dialog = await tryToCancel();
    await vi.waitFor(() => expect(mocks.orders.get.mock.calls).toEqual([[reviewing.id]]), WAIT);
    expect((await within(dialog).findByRole("alert", undefined, WAIT)).textContent).toBe(
      "This order cannot be cancelled while its payment is under review. We could not refresh it; reload the page to see its current status.",
    );
  });

  const shirtOrder = fixtureDeliveredOrder(fixturePendingOrder(fixtureQuote({ id: "q-reloads" })));
  const recordedReturn = fixtureReturn(shirtOrder);
  const shirtReturned: CustomerOrder = { ...shirtOrder, customerActions: [], returns: [recordedReturn] };
  const returnNote = `Return ${recordedReturn.number}: Awaiting review.`;
  const quantityRefusal = () => refusal("RETURN_QUANTITY_INVALID", "Requested quantity exceeds what can be returned.");

  /** Holds every order reload until the test answers it. */
  const holdReloads = () => {
    const replies: ((order: CustomerOrder) => void)[] = [];
    mocks.orders.get.mockImplementation(() => new Promise((resolve) => { replies.push((order) => resolve({ data: order })); }));
    return replies;
  };
  const answerReload = (reply: (order: CustomerOrder) => void, order: CustomerOrder) => act(async () => {
    reply(order);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  /** Opens the return dialog with the shirt chosen as damaged; each refused request reloads the order. */
  const startShirtReturn = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Request a return" }, WAIT));
    const dialog = screen.getByRole("dialog", { name: "Request a return" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Return one more Linen Short-Sleeve Shirt" }));
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Reason for return" }), { target: { value: "DAMAGED" } });
    return { dialog, submit: () => fireEvent.click(within(dialog).getByRole("button", { name: "Submit return request" })) };
  };

  it("keeps an accepted return when a reload started before it answers with the earlier order", async () => {
    mocks.orders.getMyOrders.mockResolvedValue(page([shirtOrder]));
    mocks.orders.requestReturn.mockRejectedValueOnce(quantityRefusal())
      .mockResolvedValueOnce({ status: 201, data: { returnRequest: recordedReturn, order: shirtReturned } });
    const reloads = holdReloads();
    render(<AccountOrders />);
    const { submit } = await startShirtReturn();
    submit();
    // The second request is accepted while the reload after the first refusal is still in flight.
    await vi.waitFor(() => expect(reloads).toHaveLength(1), WAIT);
    submit();
    expect(await screen.findByText(returnNote, undefined, WAIT)).toBeTruthy();

    await answerReload(reloads[0], shirtOrder);
    expect(screen.getByText(returnNote)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request a return" })).toBeNull();
  });

  it("ignores an order reload that answers after a newer reload of the same order", async () => {
    mocks.orders.getMyOrders.mockResolvedValue(page([shirtOrder]));
    mocks.orders.requestReturn.mockRejectedValue(quantityRefusal());
    const reloads = holdReloads();
    render(<AccountOrders />);
    const { dialog, submit } = await startShirtReturn();
    submit();
    await vi.waitFor(() => expect(reloads).toHaveLength(1), WAIT);
    submit();
    await vi.waitFor(() => expect(reloads).toHaveLength(2), WAIT);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    // The newer reload finds the return recorded; the older one then answers with the order before it.
    await answerReload(reloads[1], shirtReturned);
    expect(screen.getByText(returnNote)).toBeTruthy();
    await answerReload(reloads[0], shirtOrder);
    expect(screen.getByText(returnNote)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request a return" })).toBeNull();
  });

  it("keeps the list when the same account is refreshed, so an accepted cancellation is not overwritten", async () => {
    const paidOrder = processingPaid("Q-ACCOUNT");
    const requested = fixtureRefund({ source: "CANCELLATION", status: "REQUESTED", amount: paidOrder.total, includesDeliveryFee: true });
    let answerListReload: (orders: CustomerOrder[]) => void = () => {};
    mocks.orders.getMyOrders.mockResolvedValueOnce(page([paidOrder]))
      .mockReturnValueOnce(new Promise((resolve) => { answerListReload = (orders) => resolve(page(orders)); }));
    mocks.orders.cancel.mockResolvedValue({ data: { ...paidOrder, status: "CANCELLED", customerActions: [], refunds: [requested] } });
    const view = render(<AccountOrders />);
    await screen.findByRole("button", { name: "Cancel & request refund" }, WAIT);

    // `/me` answers with a fresh copy of the same account, as AuthProvider does on every page load.
    mocks.user = { ...customer };
    view.rerender(<AccountOrders />);
    await tryToCancel();
    await vi.waitFor(() => expect(notice()).toMatch(/^Order APX-Q-ACCOUNT cancelled\./), WAIT);

    // A second list request, if one was sent, answers only now: with the order as it was before cancelling.
    await act(async () => {
      answerListReload([paidOrder]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect.soft(screen.queryByRole("button", { name: "Cancel & request refund" })).toBeNull();
    expect(mocks.orders.getMyOrders).toHaveBeenCalledTimes(1);
  });
});

describe("demonstration orders", () => {
  const now = new Date().toISOString();
  const buttonNames = (container: HTMLElement) => within(container).queryAllByRole("button").map((button) => button.textContent);
  /** A sample order paid with a demonstration payment, being prepared. */
  const paidSample = (overrides: Partial<CustomerOrder> = {}) => fixtureCustomerOrder(fixturePendingOrder(fixtureQuote({ id: "q-sample" }), { isDemo: true }), {
    status: "PROCESSING", paymentStatus: "PAID", paymentMethod: "DEMONSTRATION", reservationStatus: "COMMITTED", reservationExpiresAt: null,
    customerActions: [], ...overrides,
  });
  /** The order as the server holds it now; reloads and the payment overview answer with it. */
  let server: CustomerOrder;
  const answer = (order: CustomerOrder) => {
    server = order;
    return { data: order };
  };

  beforeEach(() => {
    mocks.orders.get.mockImplementation(async () => ({ data: server }));
    mocks.payments.getOverview.mockImplementation(async () => ({ data: fixturePaymentOverview({ ...server, isDemo: true }, {
      environment: "sandbox", reasonCode: "ORDER_NOT_PAYABLE", message: PAYMENT_MESSAGES.notPayable,
      demonstration: { available: false, reasonCode: "ORDER_NOT_PAYABLE" },
    }) }));
  });

  const openReceipt = async (order: CustomerOrder) => {
    server = order;
    mocks.orders.getMyOrders.mockResolvedValue(page([order]));
    render(<AccountOrders />);
    fireEvent.click(await screen.findByRole("button", { name: "Details" }, WAIT));
    const receipt = screen.getByRole("dialog", { name: "Receipt details" });
    return { receipt, controls: () => within(receipt).getByRole("region", { name: named("Demonstration controls") }) };
  };
  /** Plays one listed step, named by its text including any screen-reader suffix; focus moves to its outcome. */
  const play = async (controls: () => HTMLElement, name: string, outcome: string) => {
    const button = within(controls()).getAllByRole("button").find((item) => item.textContent === name);
    expect(button, name).toBeTruthy();
    fireEvent.click(button!);
    const status = await within(controls()).findByText(outcome, undefined, WAIT);
    await vi.waitFor(() => expect(document.activeElement).toBe(status), WAIT);
  };

  it("plays the store's order steps the server lists with the status it expects, keeping focus on each outcome", async () => {
    const processing = paidSample({ demonstrationActions: [{ action: "DISPATCH", expectedStatus: "PROCESSING" }] });
    const shipped = paidSample({ status: "SHIPPED", demonstrationActions: [{ action: "CONFIRM_DELIVERY", expectedStatus: "SHIPPED" }] });
    const delivered = paidSample({ status: "DELIVERED", demonstrationActions: [] });
    mocks.orders.playDemonstration.mockImplementationOnce(async () => answer(shipped)).mockImplementationOnce(async () => answer(delivered));
    const { receipt, controls } = await openReceipt(processing);
    expect(within(controls()).getByText("You play the store's part here. Nothing is shipped and no money moves.")).toBeTruthy();
    expect(buttonNames(controls())).toEqual(["Mark as dispatched"]);

    await play(controls, "Mark as dispatched", `Order ${processing.orderNumber} is marked as dispatched.`);
    expect(buttonNames(controls())).toEqual(["Mark as delivered"]);
    // The last step leaves no buttons; the region stays with its outcome, which keeps focus.
    await play(controls, "Mark as delivered", `Order ${processing.orderNumber} is marked as delivered.`);
    expect(buttonNames(controls())).toEqual([]);
    expect(within(within(receipt).getByRole("region", { name: "Order summary" })).getByText("Delivered")).toBeTruthy();
    expect(mocks.orders.playDemonstration.mock.calls).toEqual([
      [processing.id, { action: "DISPATCH", expectedStatus: "PROCESSING" }],
      [processing.id, { action: "CONFIRM_DELIVERY", expectedStatus: "SHIPPED" }],
    ]);
  });

  it("reloads an order whose step was refused because it changed, and says so", async () => {
    const processing = paidSample({ demonstrationActions: [{ action: "DISPATCH", expectedStatus: "PROCESSING" }] });
    const moved = paidSample({ status: "SHIPPED", demonstrationActions: [{ action: "CONFIRM_DELIVERY", expectedStatus: "SHIPPED" }] });
    mocks.orders.playDemonstration.mockImplementation(async () => {
      server = moved;
      throw refusal("ORDER_CHANGED", "This order changed. Reload it and try again.");
    });
    const { controls } = await openReceipt(processing);
    await play(controls, "Mark as dispatched", "This order changed since it was shown, so that step was not recorded. The order has been refreshed.");
    expect(mocks.orders.get).toHaveBeenCalledWith(processing.id);
    expect(buttonNames(controls())).toEqual(["Mark as delivered"]);
  });

  it("approves and receives a return, then records its demonstration refund, naming each record", async () => {
    const delivered = fixtureDeliveredOrder(fixturePendingOrder(fixtureQuote({ id: "q-sample-return" }), { isDemo: true }), {}, {
      paymentMethod: "DEMONSTRATION", customerActions: [],
    });
    const requested = fixtureReturn(delivered, { reason: "FAULTY" });
    const approved = { ...requested, status: "APPROVED" as const, decidedAt: now };
    const received = {
      ...approved, status: "RECEIVED" as const, receivedAt: now, merchantFaultConfirmed: true,
      lines: requested.lines.map((line) => ({ ...line, receivedQuantity: line.quantity, refundableQuantity: line.quantity })),
    };
    const refund = fixtureRefund({ method: "DEMONSTRATION" });
    const withRequest: CustomerOrder = {
      ...delivered, returns: [requested], demonstrationActions: [{ action: "APPROVE", returnId: requested.id, expectedStatus: "REQUESTED" }],
    };
    const withApproval: CustomerOrder = {
      ...withRequest, returns: [approved], demonstrationActions: [{ action: "RECEIVE", returnId: requested.id, expectedStatus: "APPROVED" }],
    };
    const withRefund: CustomerOrder = {
      ...withRequest, returns: [received], refunds: [refund],
      demonstrationActions: [{ action: "COMPLETE_REFUND", refundId: refund.id, expectedStatus: "REQUESTED" }],
    };
    const recorded: CustomerOrder = {
      ...withRefund, paymentStatus: "PARTIALLY_REFUNDED", demonstrationActions: [],
      refunds: [{ ...refund, status: "CONFIRMED", approvedAt: now, confirmedAt: now }],
    };
    mocks.orders.playDemonstration.mockImplementationOnce(async () => answer(withApproval))
      .mockImplementationOnce(async () => answer(withRefund)).mockImplementationOnce(async () => answer(recorded));
    const { receipt, controls } = await openReceipt(withRequest);

    await play(controls, `Approve the return ${requested.number}`, `Return ${requested.number} is approved.`);
    await play(controls, `Mark the return as received ${requested.number}`, `Return ${requested.number} is marked as received.`);
    await play(controls, `Record the demonstration refund ${refund.number}`,
      `Demonstration refund ${refund.number} of ${formatKES(refund.amount)} is recorded; no money was sent.`);
    expect(buttonNames(controls())).toEqual([]);
    expect(mocks.orders.playDemonstration.mock.calls.map(([, step]) => step)).toEqual([
      { action: "APPROVE", returnId: requested.id, expectedStatus: "REQUESTED" },
      { action: "RECEIVE", returnId: requested.id, expectedStatus: "APPROVED" },
      { action: "COMPLETE_REFUND", refundId: refund.id, expectedStatus: "REQUESTED" },
    ]);
    expect(within(receipt).getByText("Fault confirmed in the demonstration.")).toBeTruthy();
    expect(within(receipt).queryByText(/^Staff confirmed/)).toBeNull();
    const refundRecord = within(receipt).getByText("Demonstration refund (no money sent)").closest("li");
    expect(refundRecord?.textContent).toMatch(/Recorded on .+; no money was sent/);
    expect(refundRecord?.textContent).not.toMatch(/M-Pesa|reference/);
  });

  it("reads a sample order's returns as played in the demonstration even when M-Pesa paid for it, and a live order's as staff's", async () => {
    const sampleOrder = fixtureDeliveredOrder(fixturePendingOrder(fixtureQuote({ id: "q-sandbox" }), { isDemo: true }), {}, { customerActions: [] });
    const approved = fixtureReturn(sampleOrder, { status: "APPROVED", decidedAt: now });
    const [line] = approved.lines;
    const received = fixtureReturn(sampleOrder, {
      id: "return-2", number: `RMA-${sampleOrder.orderNumber}-2`, status: "RECEIVED", decidedAt: now, receivedAt: now, merchantFaultConfirmed: false,
      lines: [{ ...line, id: "return-line-2", receivedQuantity: 1, refundableQuantity: 1 }],
    });
    const liveOrder = fixtureDeliveredOrder(fixturePendingOrder(fixtureQuote({ id: "q-live" })), {}, { customerActions: [] });
    const liveReceived = fixtureReturn(liveOrder, { status: "RECEIVED", decidedAt: now, receivedAt: now, merchantFaultConfirmed: false });
    const sample: CustomerOrder = { ...sampleOrder, paymentMethod: "MPESA", returns: [approved, received] };
    const live: CustomerOrder = { ...liveOrder, returns: [liveReceived] };
    server = sample;
    mocks.orders.getMyOrders.mockResolvedValue(page([sample, live]));
    render(<AccountOrders />);
    expect(await screen.findByText(`Return ${approved.number}: Approved in the demonstration.`, undefined, WAIT)).toBeTruthy();

    const [sampleDetails, liveDetails] = screen.getAllByRole("button", { name: "Details" });
    fireEvent.click(sampleDetails);
    const receipt = screen.getByRole("dialog", { name: "Receipt details" });
    const record = (number: string) => within(receipt).getByText(number, { selector: "p" }).closest("li")!;
    expect(within(record(approved.number)).getByText("Approved in the demonstration")).toBeTruthy();
    expect(within(record(received.number)).getByText("Marked as received in the demonstration")).toBeTruthy();
    expect(within(record(received.number)).getByText("No fault was recorded in the demonstration.")).toBeTruthy();
    expect(receipt.textContent).not.toMatch(/staff will arrange|Received and checked|Staff did not find a fault/);
    fireEvent.click(within(receipt).getByRole("button", { name: "Close" }));

    server = live;
    fireEvent.click(liveDetails);
    const liveReceipt = screen.getByRole("dialog", { name: "Receipt details" });
    expect(within(liveReceipt).getByText("Received and checked")).toBeTruthy();
    expect(within(liveReceipt).getByText("Staff did not find a fault.")).toBeTruthy();
  });

  it("shows no controls for an order the server lists none for", async () => {
    const { receipt } = await openReceipt(fixtureDeliveredOrder(fixturePendingOrder(fixtureQuote({ id: "q-mpesa" }))));
    expect(within(receipt).getByRole("region", { name: "Order summary" })).toBeTruthy();
    expect(within(receipt).queryByRole("region", { name: named("Demonstration controls") })).toBeNull();
  });

  it("promises no email when cancelling an order paid with a demonstration payment", async () => {
    const sample = paidSample({ customerActions: ["CANCEL"] });
    mocks.orders.getMyOrders.mockResolvedValue(page([sample]));
    render(<AccountOrders />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel & request refund" }, WAIT));
    const dialog = screen.getByRole("dialog", { name: "Cancel order" });
    expect(within(dialog).getByText(
      `Order ${sample.orderNumber} is paid. If you cancel, a refund request for the full amount (${formatKES(sample.total)}, including delivery) will be recorded.`,
    )).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/email/i);
  });
});

describe("order links", () => {
  const at = (hash: string) => window.history.replaceState(null, "", hash);

  it("opens the order named in the address once the list loads, then drops it from the address", async () => {
    at(`#/account/orders?order=${legacy.id}`);
    render(<AccountOrders />);
    expect(screen.getByRole("heading", { level: 1, name: "Orders and receipts" })).toBeTruthy();
    const receipt = await screen.findByRole("dialog", { name: "Receipt details" }, WAIT);
    expect(within(receipt).getByText(legacy.orderNumber)).toBeTruthy();
    expect(window.location.hash).toBe("#/account/orders");
    expect(screen.queryByText("That order isn't in your account")).toBeNull();
  });

  it("says an order is not in this account instead of opening anything, so another account's order never shows", async () => {
    at("#/account/orders?order=order-of-another-account");
    render(<AccountOrders />);
    expect(await screen.findByText("That order isn't in your account", undefined, WAIT)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(window.location.hash).toBe("#/account/orders");
    // Only this account's own list was asked for; the named order was never requested on its own.
    expect(mocks.orders.get).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: "Details" })).toHaveLength(2);
  });

  it("keeps one H1 while loading, on failure and when there are no orders", async () => {
    at("#/account/orders");
    let fail!: (error: unknown) => void;
    mocks.orders.getMyOrders.mockReturnValueOnce(new Promise((_, reject) => { fail = reject; })).mockResolvedValue(page([]));
    render(<AccountOrders />);
    expect(screen.getAllByRole("heading", { level: 1 }).map((heading) => heading.textContent)).toEqual(["Orders and receipts"]);
    expect(screen.getByText("Loading your orders…")).toBeTruthy();
    await act(async () => fail(new AxiosError("offline", "ERR_NETWORK")));
    expect(await screen.findByRole("heading", { level: 2, name: "Orders are unavailable" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/No orders yet\./, undefined, WAIT)).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Start shopping" }).getAttribute("href")).toBe("#/shop");
  });
});
