import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffOrder } from "../../api/admin";
import type { Order } from "../../api/orders";
import { fixturePendingOrder, fixtureQuote } from "../../test-support/checkoutFixtures";
import { fixtureStaffOrder, fixtureStaffRefund, fixtureStaffReturn } from "../../test-support/orderFixtures";
import { OrderWorkspace } from "./OrderWorkspace";

const admin = vi.hoisted(() => ({
  orders: { get: vi.fn(), applyAction: vi.fn() },
  returns: { decide: vi.fn(), receive: vi.fn() },
  refunds: { act: vi.fn(), requestOwed: vi.fn(), requestForPayment: vi.fn() },
}));
vi.mock("../../api/admin", async (importOriginal) => ({ ...await importOriginal<typeof import("../../api/admin")>(), adminAPI: admin }));

const WAIT = { timeout: 3000 };
const base = fixturePendingOrder(fixtureQuote());
const paid: Order = { ...base, paymentStatus: "PAID", reservationStatus: "COMMITTED", reservationExpiresAt: null };
const processing = fixtureStaffOrder({ ...paid, status: "PROCESSING" });

function apiError(status: number, data: unknown) {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", config, undefined, { status, statusText: String(status), data, headers: new AxiosHeaders(), config });
}

function renderWorkspace(canWrite = true) {
  const handlers = { onBack: vi.fn(), onChanged: vi.fn(), showToast: vi.fn() };
  const view = render(<OrderWorkspace orderId={base.id} focus={null} canWrite={canWrite} {...handlers} />);
  return { ...handlers, view };
}

const nextStep = () => screen.findByRole("region", { name: "Next step" }, WAIT);
const buttonNames = (container: HTMLElement) => within(container).queryAllByRole("button").map((button) => button.textContent);

beforeEach(() => {
  for (const group of Object.values(admin)) for (const fn of Object.values(group)) fn.mockReset();
});

describe("staff order workspace", () => {
  it("shows staff the canonical status of a paid order still to be prepared", async () => {
    admin.orders.get.mockResolvedValue({ data: fixtureStaffOrder(paid) });
    renderWorkspace();
    await nextStep();
    expect(screen.getByText("Pending", { selector: "span" })).toBeTruthy();
    expect(screen.queryByText("Waiting to be prepared")).toBeNull();
    expect(screen.queryByText("Awaiting payment")).toBeNull();
  });

  it("offers exactly the fulfilment steps the server permits", async () => {
    admin.orders.get.mockResolvedValueOnce({ data: processing })
      .mockResolvedValueOnce({ data: { ...processing, allowedActions: [], paymentReviewOpen: true } });
    renderWorkspace();
    expect(buttonNames(await nextStep())).toEqual(["Dispatch", "Cancel order"]);

    fireEvent.click(screen.getByRole("button", { name: "Reload order" }));
    expect(await screen.findByText("Resolve the payment review before any fulfilment step.", undefined, WAIT)).toBeTruthy();
    expect(buttonNames(await nextStep())).toEqual([]);
    expect(screen.getByText(/A payment on this order is under review\. Fulfilment is blocked/)).toBeTruthy();
  });

  it("requires a reason to cancel and sends the status the staff member saw", async () => {
    const cancelled = fixtureStaffOrder({ ...paid, status: "CANCELLED", reservationStatus: "RELEASED" }, { allowedActions: [] });
    admin.orders.get.mockResolvedValue({ data: processing });
    admin.orders.applyAction.mockResolvedValue({ data: cancelled });
    const { showToast, onChanged } = renderWorkspace();
    fireEvent.click(within(await nextStep()).getByRole("button", { name: "Cancel order" }));
    const dialog = screen.getByRole("dialog", { name: `Cancel order · ${base.orderNumber}` });
    expect(within(dialog).getByText(/It is paid, so a refund request for the full KES 1,244 \(including delivery\) is recorded\. No money is sent/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel order" }));
    expect(within(dialog).getByRole("alert").textContent).toBe("Enter a reason for cancelling. The customer sees it in their order history.");
    expect(admin.orders.applyAction).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByRole("textbox", { name: "Reason (required)" }), { target: { value: "  Out of stock  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel order" }));
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith(`Order ${base.orderNumber} is cancelled.`), WAIT);
    expect(admin.orders.applyAction.mock.calls).toEqual([[base.id, { action: "CANCEL", expectedStatus: "PROCESSING", reason: "Out of stock" }]]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("This order is cancelled.")).toBeTruthy();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("reloads a changed order and says that nothing was applied", async () => {
    const shipped = fixtureStaffOrder({ ...paid, status: "SHIPPED" });
    admin.orders.get.mockResolvedValueOnce({ data: processing }).mockResolvedValueOnce({ data: shipped });
    admin.orders.applyAction.mockRejectedValue(apiError(409, { error: "This order changed. Reload it before acting.", code: "ORDER_CHANGED" }));
    renderWorkspace();
    fireEvent.click(within(await nextStep()).getByRole("button", { name: "Dispatch" }));
    const dialog = screen.getByRole("dialog", { name: `Dispatch · ${base.orderNumber}` });
    fireEvent.click(within(dialog).getByRole("button", { name: "Dispatch" }));

    expect(await screen.findByRole("button", { name: "Confirm delivery" }, WAIT)).toBeTruthy();
    expect(screen.getByRole("alert").textContent)
      .toBe("This order changed since it was loaded, so nothing was applied. It has been reloaded; check its status and try again.");
    expect(admin.orders.applyAction.mock.calls).toEqual([[base.id, { action: "DISPATCH", expectedStatus: "PROCESSING" }]]);
    expect(admin.orders.get).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps a dispatched order when a reload started before the dispatch answers late", async () => {
    const shipped = fixtureStaffOrder({ ...paid, status: "SHIPPED" });
    let answerReload: (response: { data: StaffOrder }) => void = () => {};
    admin.orders.get.mockResolvedValueOnce({ data: processing })
      .mockReturnValueOnce(new Promise((resolve) => { answerReload = resolve; }));
    admin.orders.applyAction.mockResolvedValue({ data: shipped });
    renderWorkspace();
    await nextStep();
    fireEvent.click(screen.getByRole("button", { name: "Reload order" }));
    fireEvent.click(within(await nextStep()).getByRole("button", { name: "Dispatch" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: `Dispatch · ${base.orderNumber}` })).getByRole("button", { name: "Dispatch" }));
    expect(await screen.findByRole("button", { name: "Confirm delivery" }, WAIT)).toBeTruthy();

    // The reload answers with the order as it was before the dispatch.
    await act(async () => {
      answerReload({ data: processing });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(admin.orders.get).toHaveBeenCalledTimes(2);
    expect(buttonNames(await nextStep())).toEqual(["Confirm delivery"]);
  });

  it("shows viewers every record without any controls that change it", async () => {
    const busy: StaffOrder = fixtureStaffOrder(paid, {
      returns: [fixtureStaffReturn(paid)],
      refunds: [fixtureStaffRefund(paid.id, { status: "REQUESTED" })],
      refundRequestOptions: [{ source: "CANCELLATION", maxAmount: 1244 }],
    });
    expect(busy.allowedActions).toEqual(["START_PROCESSING", "CANCEL"]);
    admin.orders.get.mockResolvedValue({ data: busy });
    const { view } = renderWorkspace(false);
    expect(await screen.findByText("View only: your role can see this order but cannot change it.", undefined, WAIT)).toBeTruthy();
    expect(screen.getByText(`RMA-${base.orderNumber}-1`)).toBeTruthy();
    expect(screen.getByText("RF-APX-QUOTE-1-1")).toBeTruthy();
    expect(screen.getByText("Requested — awaiting approval")).toBeTruthy();
    expect(buttonNames(view.container)).toEqual(["← Back to orders", "Reload order", `M-Pesa payments for ${base.orderNumber}`]);
  });

  it("tells staff that cancelling or re-requesting for a demonstration-paid order records a demonstration refund", async () => {
    const demonstration = { ...paid, paymentMethod: "DEMONSTRATION", isDemo: true };
    for (const [paymentStatus, recorded] of [["PAID", "It is paid, so a refund request for the full KES 1,244 (including delivery) is recorded."],
      ["PARTIALLY_REFUNDED", "Part of the payment was already refunded, so a refund request for the remaining paid balance is recorded."]] as const) {
      admin.orders.get.mockResolvedValue({ data: fixtureStaffOrder({ ...demonstration, status: "PROCESSING", paymentStatus }) });
      const { view } = renderWorkspace();
      fireEvent.click(within(await nextStep()).getByRole("button", { name: "Cancel order" }));
      const dialog = screen.getByRole("dialog", { name: `Cancel order · ${base.orderNumber}` });
      expect(within(dialog).getByText(`Cancel this order and release or restock its items. ${recorded} Its refund will be a demonstration refund: no money is sent.`)).toBeTruthy();
      expect(dialog.textContent).not.toMatch(/until that refund is confirmed/);
      view.unmount();
    }

    const cancelled = fixtureStaffOrder({ ...demonstration, status: "CANCELLED", reservationStatus: "RELEASED" }, {
      allowedActions: [], refundRequestOptions: [{ source: "CANCELLATION", maxAmount: 1244 }],
    });
    admin.orders.get.mockResolvedValue({ data: cancelled });
    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: "Request remaining refund (up to KES 1,244)" }, WAIT));
    expect(screen.getByText("This only records a new refund request. It will be a demonstration refund: no money is sent.")).toBeTruthy();
    expect(screen.queryByText(/No money is sent until it is approved, sent and confirmed/)).toBeNull();
  });

  it("reads demonstration refunds as moving no money and offers staff only cancelling them", async () => {
    const now = new Date().toISOString();
    const sample = fixtureStaffOrder({ ...paid, status: "CANCELLED", reservationStatus: "RELEASED", paymentMethod: "DEMONSTRATION", isDemo: true }, {
      allowedActions: [],
      refunds: [
        fixtureStaffRefund(base.id, { id: "refund-2", number: "RF-APX-QUOTE-1-2", method: "DEMONSTRATION", status: "REQUESTED", allowedActions: ["cancel"] }),
        fixtureStaffRefund(base.id, { method: "DEMONSTRATION", status: "CONFIRMED", approvedAt: now, processingAt: now, confirmedAt: now, allowedActions: [] }),
      ],
    });
    admin.orders.get.mockResolvedValue({ data: sample });
    renderWorkspace();
    const requested = (await screen.findByRole("heading", { name: "RF-APX-QUOTE-1-2" }, WAIT)).closest("li")!;
    const recorded = screen.getByRole("heading", { name: "RF-APX-QUOTE-1-1" }).closest("li")!;
    const note = "No money is to be sent for a demonstration refund. The customer records it from their order.";
    expect(within(requested).getByText("Requested — no money is to be sent")).toBeTruthy();
    expect(within(requested).getByText("Demonstration refund (no money sent)")).toBeTruthy();
    expect(within(requested).getByText(note)).toBeTruthy();
    expect(buttonNames(requested)).toEqual(["Cancel refund RF-APX-QUOTE-1-2"]);
    expect(requested.textContent).not.toMatch(/M-Pesa|Approval does not send money/);
    expect(within(recorded).getByText("Recorded — no money was sent")).toBeTruthy();
    expect(within(recorded).getByText("Recorded")).toBeTruthy();
    expect(recorded.textContent).not.toMatch(/Confirmed sent|Sending started|M-Pesa/);
  });

  it("tells staff that a demonstration-paid order's receipt and re-requested refunds move no money", async () => {
    const demonstration = { ...paid, status: "DELIVERED" as const, paymentMethod: "DEMONSTRATION", isDemo: true };
    const approved = fixtureStaffReturn(demonstration, { status: "APPROVED" });
    admin.orders.get.mockResolvedValue({ data: fixtureStaffOrder(demonstration, { returns: [approved] }) });
    const refund = fixtureStaffRefund(base.id, { source: "RETURN", returnRequestId: approved.id, method: "DEMONSTRATION", amount: 900 });
    admin.returns.receive.mockResolvedValue({
      data: fixtureStaffOrder(demonstration, { returns: [fixtureStaffReturn(demonstration, { status: "RECEIVED" })], refunds: [refund] }),
    });
    const receipt = renderWorkspace();
    fireEvent.change(await screen.findByLabelText(/^Refundable/, undefined, WAIT), { target: { value: "1" } });
    expect(screen.getByText("1 refundable unit: a refund request is created for them. It will be a demonstration refund: no money is sent.")).toBeTruthy();
    expect(screen.queryByText(/confirmed with an M-Pesa reference/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Record receipt/ }));
    await vi.waitFor(() => expect(receipt.showToast).toHaveBeenCalledWith(
      `Return ${approved.number} received. Demonstration refund ${refund.number} of KES 900 requested; no money will be sent.`), WAIT);
    receipt.view.unmount();

    const cancelled = fixtureStaffOrder({ ...demonstration, status: "CANCELLED", reservationStatus: "RELEASED" }, {
      allowedActions: [], refundRequestOptions: [{ source: "CANCELLATION", maxAmount: 1244 }],
    });
    const requested = fixtureStaffRefund(base.id, { source: "CANCELLATION", amount: 1244, method: "DEMONSTRATION" });
    admin.orders.get.mockResolvedValue({ data: cancelled });
    admin.refunds.requestOwed.mockResolvedValue({ status: 201, data: { refund: requested, order: { ...cancelled, refundRequestOptions: [], refunds: [requested] } } });
    const { showToast } = renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: "Request remaining refund (up to KES 1,244)" }, WAIT));
    fireEvent.change(screen.getByRole("textbox", { name: "Reason (required)" }), { target: { value: "Refund was withdrawn in error" } });
    fireEvent.click(screen.getByRole("button", { name: "Record refund request" }));
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith(`Demonstration refund ${requested.number} of KES 1,244 requested; no money will be sent.`), WAIT);
  });

  it("offers owed refunds again only when the server lists them, requires a reason and posts the exact request", async () => {
    const delivered = fixtureStaffOrder({ ...paid, status: "DELIVERED" }, { returns: [fixtureStaffReturn(paid, { status: "RECEIVED" })] });
    admin.orders.get.mockResolvedValue({ data: delivered });
    const first = renderWorkspace();
    await nextStep();
    expect(screen.queryByRole("button", { name: /Request .*refund/ })).toBeNull();
    first.view.unmount();

    const owed = { ...delivered, refundRequestOptions: [{ source: "RETURN" as const, returnId: "return-1", returnNumber: `RMA-${base.orderNumber}-1`, maxAmount: 900 }] };
    const requested = fixtureStaffRefund(base.id, { id: "refund-2", number: "RF-APX-QUOTE-1-2", amount: 900 });
    admin.orders.get.mockResolvedValue({ data: owed });
    admin.refunds.requestOwed.mockResolvedValue({ status: 201, data: { refund: requested, order: { ...delivered, refunds: [requested] } } });
    const { showToast } = renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: `Request refund for return RMA-${base.orderNumber}-1 again` }, WAIT));
    expect(screen.getByText("This only records a new refund request. No money is sent until it is approved, sent and confirmed.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Record refund request" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter why this refund is being requested again.");
    expect(admin.refunds.requestOwed).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: "Reason (required)" }), { target: { value: " Earlier refund cancelled by mistake " } });
    fireEvent.click(screen.getByRole("button", { name: "Record refund request" }));
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith("Refund RF-APX-QUOTE-1-2 of KES 900 requested. It has not been sent yet."), WAIT);
    expect(admin.refunds.requestOwed.mock.calls).toEqual([[base.id, { source: "RETURN", returnId: "return-1", reason: "Earlier refund cancelled by mistake" }]]);
    expect(screen.queryByRole("button", { name: /Request refund for return/ })).toBeNull();
  });

  it("requests the remaining refund for a cancelled order without a return reference", async () => {
    const cancelled = fixtureStaffOrder({ ...paid, status: "CANCELLED", reservationStatus: "RELEASED" }, {
      allowedActions: [], refundRequestOptions: [{ source: "CANCELLATION", maxAmount: 1244 }],
    });
    const requested = fixtureStaffRefund(base.id, { source: "CANCELLATION", amount: 1244 });
    admin.orders.get.mockResolvedValue({ data: cancelled });
    admin.refunds.requestOwed.mockResolvedValue({ status: 201, data: { refund: requested, order: { ...cancelled, refundRequestOptions: [], refunds: [requested] } } });
    renderWorkspace();
    fireEvent.click(await screen.findByRole("button", { name: "Request remaining refund (up to KES 1,244)" }, WAIT));
    fireEvent.change(screen.getByRole("textbox", { name: "Reason (required)" }), { target: { value: "Refund was withdrawn in error" } });
    fireEvent.click(screen.getByRole("button", { name: "Record refund request" }));
    await vi.waitFor(() => expect(admin.refunds.requestOwed).toHaveBeenCalledTimes(1), WAIT);
    expect(admin.refunds.requestOwed.mock.calls[0]).toEqual([base.id, { source: "CANCELLATION", reason: "Refund was withdrawn in error" }]);
  });
});
