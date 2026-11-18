import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerOrder, ReturnRequestBody } from "../api/orders";
import { returnIntentKey } from "../store/returnRequestModel";
import { fixturePendingOrder, fixtureQuote, linenLine, poloLine } from "../test-support/checkoutFixtures";
import { fixtureDeliveredOrder, fixtureReturn } from "../test-support/orderFixtures";
import ReturnOrderModal from "./ReturnOrderModal";

const mocks = vi.hoisted(() => ({ requestReturn: vi.fn() }));
vi.mock("../api/orders", async (importOriginal) => ({
  ...await importOriginal<typeof import("../api/orders")>(),
  ordersAPI: { requestReturn: mocks.requestReturn },
}));

const OWNER = "customer-a";
const REQUEST_KEY = /^[A-Za-z0-9:_-]{16,128}$/;
const WAIT = { timeout: 3000 };

/** Two linen shirts (STANDARD), milk (FAULT_ONLY) and face cream (UNOPENED_OR_FAULT), delivered yesterday. */
const delivered: CustomerOrder = fixtureDeliveredOrder(
  fixturePendingOrder(fixtureQuote({
    lines: [
      { ...linenLine, quantity: 2, total: 1800 },
      { ...poloLine, productId: "prod-milk", variantId: "var-milk", sku: "MILK", productName: "Fresh Milk 1L" },
      { ...poloLine, productId: "prod-cream", variantId: "var-cream", sku: "CREAM", productName: "Face Cream" },
    ],
  })),
  { rules: { "item-2": "FAULT_ONLY", "item-3": "UNOPENED_OR_FAULT" } },
);

function apiError(status: number | undefined, data: unknown = {}) {
  const config = { headers: new AxiosHeaders() };
  const response = status === undefined ? undefined : { status, statusText: String(status), data, headers: new AxiosHeaders(), config };
  return new AxiosError("Request failed", status === undefined ? "ERR_NETWORK" : "ERR_BAD_REQUEST", config, undefined, response);
}

function renderModal(order: CustomerOrder = delivered) {
  const handlers = { onClose: vi.fn(), onReturned: vi.fn(), onRefresh: vi.fn() };
  const view = render(<ReturnOrderModal order={order} ownerId={OWNER} {...handlers} />);
  return { ...handlers, view, dialog: screen.getByRole("dialog", { name: "Request a return" }) };
}

const quantity = (name: string) => screen.getByRole("spinbutton", { name: `Quantity of ${name} to return` });
const more = (name: string) => fireEvent.click(screen.getByRole("button", { name: `Return one more ${name}` }));
const reason = () => screen.getByRole("combobox", { name: "Reason for return" });
const reasonOptions = () => within(reason()).getAllByRole("option").map((option) => option.textContent);
const choose = (value: string) => fireEvent.change(reason(), { target: { value } });
const submit = (name = "Submit return request") => fireEvent.click(screen.getByRole("button", { name }));
const savedIntent = () => localStorage.getItem(returnIntentKey(OWNER, delivered.id));
const ALL_REASONS = ["Changed my mind", "Faulty or not working", "Arrived damaged", "Wrong item sent", "Another reason"];
const FAULT_REASONS = ["Faulty or not working", "Arrived damaged", "Wrong item sent"];

function accepted(body: ReturnRequestBody) {
  const request = fixtureReturn(delivered, {
    reason: body.reason,
    lines: body.lines.map((line, index) => ({
      id: `return-line-${index + 1}`, orderItemId: line.orderItemId, quantity: line.quantity, returnRule: "STANDARD",
      receivedQuantity: null, refundableQuantity: null, productName: "Linen Short-Sleeve Shirt", purchased: 2,
    })),
  });
  return { status: 201, data: { returnRequest: request, order: { ...delivered, returns: [request] } } };
}

beforeEach(() => {
  mocks.requestReturn.mockReset();
});

describe("return request", () => {
  it("offers only the reasons that every selected item's rule allows", () => {
    renderModal();
    expect(reasonOptions()).toEqual(["Choose a reason", ...ALL_REASONS]);

    more("Fresh Milk 1L");
    expect(reasonOptions()).toEqual(["Choose a reason", ...FAULT_REASONS]);
    expect(screen.getByText("Fresh Milk 1L can be returned only if faulty, damaged or wrong.")).toBeTruthy();
    more("Linen Short-Sleeve Shirt");
    expect(reasonOptions()).toEqual(["Choose a reason", ...FAULT_REASONS]);

    fireEvent.click(screen.getByRole("button", { name: "Return one fewer Fresh Milk 1L" }));
    choose("CHANGED_MIND");
    expect(reason()).toHaveProperty("value", "CHANGED_MIND");
    // Adding a fault-only item withdraws a reason it does not accept rather than sending it.
    more("Fresh Milk 1L");
    expect(reason()).toHaveProperty("value", "");
  });

  it("requires the unopened declaration only for unopened-or-fault items returned for a non-fault reason", async () => {
    mocks.requestReturn.mockImplementation(async (_id: string, body: ReturnRequestBody) => accepted(body));
    const { onReturned } = renderModal();
    more("Face Cream");
    choose("CHANGED_MIND");
    expect(screen.getByRole("checkbox", { name: /I confirm Face Cream is unopened/ })).toHaveProperty("checked", false);
    submit();
    expect(screen.getByRole("alert").textContent).toBe("Confirm the items are unopened, or choose faulty, damaged or wrong item as the reason.");
    expect(mocks.requestReturn).not.toHaveBeenCalled();

    choose("FAULTY");
    expect(screen.queryByRole("checkbox")).toBeNull();
    choose("CHANGED_MIND");
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm Face Cream is unopened/ }));
    submit();
    await vi.waitFor(() => expect(onReturned).toHaveBeenCalledTimes(1), WAIT);
    expect(mocks.requestReturn.mock.calls[0][1]).toEqual({
      reason: "CHANGED_MIND", unopenedDeclared: true, lines: [{ orderItemId: "item-3", quantity: 1 }],
    });
  });

  it("keeps each quantity between zero and the units still returnable", () => {
    const partly = {
      ...delivered,
      returnEligibility: {
        ...delivered.returnEligibility,
        lines: delivered.returnEligibility.lines.map((line) => (line.orderItemId === "item-1" ? { ...line, requested: 1, returnableQuantity: 1 } : line)),
      },
    };
    renderModal(partly);
    expect(screen.getByText(/Up to 1 of 2 can be returned\./)).toBeTruthy();
    const linen = quantity("Linen Short-Sleeve Shirt");
    more("Linen Short-Sleeve Shirt");
    more("Linen Short-Sleeve Shirt");
    expect(linen).toHaveProperty("value", "1");
    expect(screen.getByRole("button", { name: "Return one more Linen Short-Sleeve Shirt" }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.change(linen, { target: { value: "99" } });
    expect(linen).toHaveProperty("value", "1");
    fireEvent.change(linen, { target: { value: "-3" } });
    expect(linen).toHaveProperty("value", "0");
    fireEvent.click(screen.getByRole("button", { name: "Return one fewer Linen Short-Sleeve Shirt" }));
    expect(linen).toHaveProperty("value", "0");

    choose("FAULTY");
    submit();
    expect(screen.getByRole("alert").textContent).toBe("Choose at least one item and how many of it to return.");
    expect(document.activeElement).toBe(linen);
    expect(mocks.requestReturn).not.toHaveBeenCalled();
  });

  it("says how the refund is paid back by the order's payment method", () => {
    const terms = () => within(screen.getByRole("region", { name: "Return terms" })).getAllByRole("listitem").map((item) => item.textContent);
    const mpesa = renderModal();
    expect(terms()).toContain("Refunds are sent by M-Pesa after staff receive and check the items. We will email you when your refund is sent.");
    mpesa.view.unmount();

    renderModal({ ...delivered, paymentMethod: "DEMONSTRATION" });
    expect(terms()).toContain("Refunds of demonstration payments are recorded without moving money.");
    expect(terms().join(" ")).not.toMatch(/M-Pesa|email/);
  });

  it("retries a request whose answer was lost with the same key and body, even after a reload", async () => {
    mocks.requestReturn.mockRejectedValueOnce(apiError(undefined))
      .mockImplementation(async (_id: string, body: ReturnRequestBody) => accepted(body));
    const first = renderModal();
    more("Linen Short-Sleeve Shirt");
    choose("CHANGED_MIND");
    fireEvent.change(screen.getByRole("textbox", { name: "Comment (optional)" }), { target: { value: "  Too big  " } });
    submit();
    expect(await screen.findByText(/We could not confirm whether your return request was received\./, undefined, WAIT)).toBeTruthy();
    expect(savedIntent()).not.toBeNull();
    first.view.unmount();

    // A new visit resumes the saved request instead of offering a fresh form.
    const { onReturned } = renderModal();
    expect(screen.getByText("1 × Linen Short-Sleeve Shirt")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Reason for return" })).toBeNull();
    submit("Retry the same request");
    await vi.waitFor(() => expect(onReturned).toHaveBeenCalledTimes(1), WAIT);

    const [[firstId, firstBody, firstKey], [retryId, retryBody, retryKey]] = mocks.requestReturn.mock.calls;
    expect(firstKey).toMatch(REQUEST_KEY);
    expect([retryId, retryBody, retryKey]).toEqual([firstId, firstBody, firstKey]);
    expect(firstBody).toEqual({ reason: "CHANGED_MIND", comment: "Too big", lines: [{ orderItemId: "item-1", quantity: 1 }] });
    expect(savedIntent()).toBeNull();
  });

  it.each([
    { code: "RETURN_WINDOW_CLOSED", status: 409, error: "The return window for this order has closed.", refresh: true,
      message: "The return window for this order has closed, so a return can no longer be requested." },
    { code: "RETURN_REASON_NOT_ALLOWED", status: 409, error: "Fresh Milk 1L can be returned only if it is faulty, damaged or wrong.", refresh: false,
      message: "That reason does not apply to one of the selected items. Fresh Milk 1L can be returned only if it is faulty, damaged or wrong." },
    { code: "RETURN_QUANTITY_INVALID", status: 409, error: "Only 1 of Linen Short-Sleeve Shirt can be returned.", refresh: true,
      message: "Some of those quantities can no longer be returned. Your order has been refreshed; check the quantities and try again. Only 1 of Linen Short-Sleeve Shirt can be returned." },
    { code: "IDEMPOTENCY_CONFLICT", status: 409, error: "This request key was already used with different contents.", refresh: false,
      message: "This return request could not be matched safely, so nothing was submitted. Check your choices and submit again." },
  ])("explains $code and lets the customer send a corrected request", async ({ code, status, error, refresh, message }) => {
    mocks.requestReturn.mockRejectedValueOnce(apiError(status, { error, code }));
    const { onRefresh } = renderModal();
    more("Linen Short-Sleeve Shirt");
    choose("DAMAGED");
    await act(async () => submit());
    expect(screen.getByRole("alert").textContent).toBe(message);
    expect(onRefresh).toHaveBeenCalledTimes(refresh ? 1 : 0);
    expect(savedIntent()).toBeNull();
    expect(screen.getByRole("button", { name: "Submit return request" })).toBeTruthy();
  });
});
