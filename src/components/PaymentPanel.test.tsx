import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../api/auth";
import type { PaymentAttempt, PaymentOverview } from "../api/mpesa";
import { paymentIntentKey, type PaymentIntent } from "../store/paymentModel";
import { fixturePendingOrder, fixtureQuote } from "../test-support/checkoutFixtures";
import {
  PAYABLE,
  PAYMENT_MESSAGES,
  fixtureAttempt,
  fixtureConfirmedAttempt,
  fixtureDemonstrationOverview,
  fixtureDemonstrationPaidOverview,
  fixturePaymentOverview,
} from "../test-support/paymentFixtures";
import { fixtureCustomerOrder } from "../test-support/orderFixtures";
import { named, withoutSoftHyphens } from "../test-support/text";
import { PaymentPanel, StaffPaymentPanel } from "./PaymentPanel";

const mocks = vi.hoisted(() => ({
  user: null as User | null,
  customer: { getOverview: vi.fn(), requestPrompt: vi.fn(), checkAttempt: vi.fn(), payWithDemonstration: vi.fn() },
  staff: { getOverview: vi.fn(), checkAttempt: vi.fn() },
}));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../api/mpesa", () => ({ paymentsAPI: mocks.customer, staffPaymentsAPI: mocks.staff }));

const WAIT = { timeout: 3000 };
const REQUEST_KEY = /^[A-Za-z0-9:_-]{16,128}$/;
const customerA: User = { id: "customer-a", email: "a@example.test", firstName: "Ada", lastName: "Customer", phone: "0712 345 678" };
const customerB: User = { id: "customer-b", email: "b@example.test", firstName: "Ben", lastName: "Customer" };
const order = fixturePendingOrder(fixtureQuote());
const pending = fixtureAttempt(order);

const payable = (overrides: Partial<PaymentOverview> = {}) => fixturePaymentOverview(order, { ...PAYABLE, ...overrides });
/** What the server reports once an attempt is open: no new prompt may be requested. */
const withOpen = (attempt: PaymentAttempt, overrides: Partial<PaymentOverview> = {}) =>
  payable({ available: false, reasonCode: "PAYMENT_EXISTS", message: PAYMENT_MESSAGES.exists, attempts: [attempt], ...overrides });
const reply = (data: unknown) => ({ data });
const storedIntent = (owner = "customer-a") => JSON.parse(localStorage.getItem(paymentIntentKey(owner, order.id)) ?? "null");

function apiError(status: number | undefined, data: unknown = {}) {
  const config = { headers: new AxiosHeaders() };
  const response = status === undefined ? undefined : { status, statusText: String(status), data, headers: new AxiosHeaders(), config };
  return new AxiosError("Request failed", status === undefined ? "ERR_NETWORK" : "ERR_BAD_REQUEST", config, undefined, response);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

/** Advances fake time one step at a time, letting React render and re-run effects between steps. */
async function advance(totalMs: number, stepMs = 5_000) {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(stepMs, totalMs - elapsed)); });
  }
}

function seedIntent(overrides: Partial<PaymentIntent> = {}) {
  const intent: PaymentIntent = {
    ownerId: "customer-a", orderId: order.id, idempotencyKey: "stored-key-0123456789", phone: "254712345678",
    priorAttemptIds: [], createdAt: new Date().toISOString(), ...overrides,
  };
  localStorage.setItem(paymentIntentKey(intent.ownerId, intent.orderId), JSON.stringify(intent));
  return intent;
}

const region = () => screen.getByRole("region", { name: "Pay with M-Pesa" });
const sendButton = () => screen.findByRole("button", { name: "Send M-Pesa prompt" }, WAIT);

async function confirmPrompt(phone = "0712 345 678") {
  const send = await sendButton();
  fireEvent.change(screen.getByLabelText("M-Pesa phone number"), { target: { value: phone } });
  fireEvent.click(send);
  return send;
}

beforeEach(() => {
  mocks.user = customerA;
  for (const fn of [...Object.values(mocks.customer), ...Object.values(mocks.staff)]) fn.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("customer M-Pesa payment", () => {
  it("shows the saved total before confirmation, saves the request before sending it and never treats an accepted prompt as paid", async () => {
    mocks.customer.getOverview.mockResolvedValueOnce(reply(payable())).mockResolvedValue(reply(withOpen(pending)));
    let savedAtSend: unknown;
    mocks.customer.requestPrompt.mockImplementation(async () => {
      savedAtSend = storedIntent();
      return reply(pending);
    });
    const changes = vi.fn();
    render(<PaymentPanel orderId={order.id} onOrderChange={changes} />);

    await sendButton();
    expect(within(region()).getByText("KES 1,244")).toBeTruthy();
    expect(within(region()).getByText(/Enter your M-Pesa PIN only on your phone/)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "M-Pesa phone number" })).toHaveProperty("value", "0712 345 678");
    expect(screen.queryByLabelText(/PIN/i, { selector: "input" })).toBeNull();
    expect(mocks.customer.requestPrompt).not.toHaveBeenCalled();

    await confirmPrompt("+254 712-345-678");
    expect(await screen.findByText("Approve the payment on your phone", undefined, WAIT)).toBeTruthy();
    expect(mocks.customer.requestPrompt).toHaveBeenCalledTimes(1);
    const [orderId, phone, key] = mocks.customer.requestPrompt.mock.calls[0];
    expect([orderId, phone]).toEqual([order.id, "254712345678"]);
    expect(key).toMatch(REQUEST_KEY);
    expect(savedAtSend).toMatchObject({ ownerId: "customer-a", orderId: order.id, idempotencyKey: key, phone: "254712345678", priorAttemptIds: [] });
    await waitFor(() => expect(storedIntent()).toBeNull(), WAIT);

    expect(screen.queryByText("Payment confirmed")).toBeNull();
    expect(screen.getByText(/This order is not paid until M-Pesa confirms the payment\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull();
    expect(changes).toHaveBeenLastCalledWith(expect.objectContaining({ id: order.id, paymentStatus: "PENDING" }));
  });

  it("keeps a lost request open, never repeats it on its own and retries only the identical request when asked", async () => {
    mocks.customer.getOverview
      .mockResolvedValueOnce(reply(payable()))
      .mockResolvedValueOnce(reply(payable()))
      .mockResolvedValue(reply(withOpen(pending)));
    const lost = deferred<never>();
    mocks.customer.requestPrompt.mockReturnValueOnce(lost.promise).mockResolvedValue(reply(pending));
    render(<PaymentPanel orderId={order.id} />);
    const send = await confirmPrompt();

    // In flight, the confirmed form stays in place and inert; nothing claims an outcome yet.
    expect(send.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Requesting your M-Pesa prompt…")).toBeTruthy();
    expect(screen.queryByText("Your payment request has not been confirmed")).toBeNull();
    fireEvent.click(send);
    expect(mocks.customer.requestPrompt).toHaveBeenCalledTimes(1);
    await act(async () => lost.reject(apiError(undefined)));

    const retry = await screen.findByRole("button", { name: "Retry the same request" }, WAIT);
    expect(screen.getByText("Your payment request has not been confirmed")).toBeTruthy();
    expect(screen.getByText(/so it can create at most one prompt/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull();
    expect(mocks.customer.requestPrompt).toHaveBeenCalledTimes(1);
    const [first] = mocks.customer.requestPrompt.mock.calls;
    expect(storedIntent()).toMatchObject({ idempotencyKey: first[2], phone: "254712345678" });

    retry.focus();
    fireEvent.click(retry);
    expect(retry.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(retry);
    expect(await screen.findByText("Approve the payment on your phone", undefined, WAIT)).toBeTruthy();
    expect(mocks.customer.requestPrompt.mock.calls).toEqual([first, first]);
    expect(storedIntent()).toBeNull();
  });

  it("settles a lost request from the server's record instead of sending it again", async () => {
    const unknown = fixtureAttempt(order, {
      status: "UNKNOWN", reasonCode: "PROVIDER_REFERENCE_PENDING", message: PAYMENT_MESSAGES.unknown, canReconcile: false,
    });
    mocks.customer.getOverview.mockResolvedValueOnce(reply(payable())).mockResolvedValue(reply(withOpen(unknown)));
    mocks.customer.requestPrompt.mockRejectedValue(apiError(503, { code: "PAYMENT_PERSISTENCE_UNKNOWN", error: "Check this payment" }));
    render(<PaymentPanel orderId={order.id} />);
    await confirmPrompt();

    expect(await screen.findByText("Payment not confirmed yet", undefined, WAIT)).toBeTruthy();
    expect(screen.getByText(/Do not pay again; check this attempt instead\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry the same request" })).toBeNull();
    expect(storedIntent()).toBeNull();

    // This attempt cannot be checked with M-Pesa yet: only the server's record is read again.
    fireEvent.click(screen.getByRole("button", { name: "Check payment status" }));
    expect(await screen.findByText("Payment status checked just now.", undefined, WAIT)).toBeTruthy();
    expect(mocks.customer.checkAttempt).not.toHaveBeenCalled();
    expect(mocks.customer.getOverview).toHaveBeenCalledTimes(3);
    expect(mocks.customer.requestPrompt).toHaveBeenCalledTimes(1);
  });

  it("recovers a request saved before a reload with the same key, only when the customer asks", async () => {
    const intent = seedIntent({ priorAttemptIds: ["attempt-0"] });
    const earlier = fixtureAttempt(order, { id: "attempt-0", status: "FAILED", message: PAYMENT_MESSAGES.cancelled, canReconcile: false });
    mocks.customer.getOverview.mockResolvedValueOnce(reply(payable({ attempts: [earlier] }))).mockResolvedValue(reply(withOpen(pending)));
    mocks.customer.requestPrompt.mockResolvedValue(reply(pending));
    render(<PaymentPanel orderId={order.id} />);

    const retry = await screen.findByRole("button", { name: "Retry the same request" }, WAIT);
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull();
    expect(mocks.customer.requestPrompt).not.toHaveBeenCalled();
    fireEvent.click(retry);
    expect(await screen.findByText("Approve the payment on your phone", undefined, WAIT)).toBeTruthy();
    expect(mocks.customer.requestPrompt.mock.calls).toEqual([[order.id, intent.phone, intent.idempotencyKey]]);
    expect(storedIntent()).toBeNull();
  });

  it("forgets a reloaded request once the server shows the attempt it created, without sending anything", async () => {
    seedIntent();
    mocks.customer.getOverview.mockResolvedValue(reply(withOpen(pending)));
    render(<PaymentPanel orderId={order.id} />);
    expect(await screen.findByText("Approve the payment on your phone", undefined, WAIT)).toBeTruthy();
    expect(storedIntent()).toBeNull();
    expect(mocks.customer.requestPrompt).not.toHaveBeenCalled();
  });

  it("keeps one customer's saved request and phone number away from the next customer", async () => {
    seedIntent();
    mocks.user = customerB;
    mocks.customer.getOverview.mockResolvedValue(reply(payable()));
    render(<PaymentPanel orderId={order.id} />);
    await sendButton();
    expect(screen.queryByText("Your payment request has not been confirmed")).toBeNull();
    expect(screen.getByRole("textbox", { name: "M-Pesa phone number" })).toHaveProperty("value", "");
    expect(storedIntent("customer-a")).toMatchObject({ idempotencyKey: "stored-key-0123456789" });
    expect(storedIntent("customer-b")).toBeNull();
  });

  it("ignores a late answer to the previous customer's request after the account changes", async () => {
    const late = deferred<{ data: unknown }>();
    mocks.customer.getOverview.mockResolvedValue(reply(payable()));
    mocks.customer.requestPrompt.mockReturnValue(late.promise);
    const changes = vi.fn();
    const view = render(<PaymentPanel orderId={order.id} onOrderChange={changes} />);
    await confirmPrompt();
    await waitFor(() => expect(mocks.customer.requestPrompt).toHaveBeenCalledTimes(1), WAIT);
    const sentKey = mocks.customer.requestPrompt.mock.calls[0][2];

    mocks.user = customerB;
    mocks.customer.getOverview.mockReset().mockRejectedValue(apiError(404, { code: "ORDER_NOT_FOUND", error: "Order not found." }));
    view.rerender(<PaymentPanel orderId={order.id} onOrderChange={changes} />);
    expect(await screen.findByText("Order not found.", undefined, WAIT)).toBeTruthy();
    changes.mockClear();

    await act(async () => late.resolve(reply(pending)));
    expect(screen.queryByText("Approve the payment on your phone")).toBeNull();
    expect(changes).not.toHaveBeenCalled();
    expect(storedIntent("customer-b")).toBeNull();
    // The first customer's request stays saved under their account, to be settled on their next visit.
    expect(storedIntent("customer-a")).toMatchObject({ idempotencyKey: sentKey });
  });

  it("renders nothing and requests nothing without a signed-in customer", () => {
    mocks.user = null;
    const { container } = render(<PaymentPanel orderId={order.id} />);
    expect(container.innerHTML).toBe("");
    expect(mocks.customer.getOverview).not.toHaveBeenCalled();
  });

  it("explains that payments are switched off and offers no prompt", async () => {
    mocks.customer.getOverview.mockResolvedValue(reply(fixturePaymentOverview(order)));
    render(<PaymentPanel orderId={order.id} />);
    expect(await screen.findByText("M-Pesa payment unavailable", undefined, WAIT)).toBeTruthy();
    expect(screen.getByText(PAYMENT_MESSAGES.disabled)).toBeTruthy();
    expect(within(region()).getByText("KES 1,244")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull();
    expect(screen.queryByText(/Sandbox test|Live M-Pesa payment/)).toBeNull();
    expect(mocks.customer.requestPrompt).not.toHaveBeenCalled();
  });

  it("shows a fractional total exactly and never offers to round it", async () => {
    const fractional = fixturePaymentOverview({ ...order, total: 1244.5 }, {
      environment: "production", reasonCode: "MPESA_AMOUNT_UNSUPPORTED", message: PAYMENT_MESSAGES.fractional,
    });
    mocks.customer.getOverview.mockResolvedValue(reply(fractional));
    render(<PaymentPanel orderId={order.id} />);
    expect(await screen.findByText(PAYMENT_MESSAGES.fractional, undefined, WAIT)).toBeTruthy();
    expect(within(region()).getByText("KES 1,244.50")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull();
  });

  it("labels a sandbox payment prominently before and after the prompt is requested", async () => {
    const sandboxPending = fixtureAttempt(order, { environment: "sandbox" });
    mocks.customer.getOverview
      .mockResolvedValueOnce(reply(payable({ environment: "sandbox" })))
      .mockResolvedValue(reply(withOpen(sandboxPending, { environment: "sandbox" })));
    mocks.customer.requestPrompt.mockResolvedValue(reply(sandboxPending));
    render(<PaymentPanel orderId={order.id} />);
    await sendButton();
    expect(within(region()).getByText("Sandbox test: real funds may be deducted")).toBeTruthy();
    expect(mocks.customer.requestPrompt).not.toHaveBeenCalled();
    await confirmPrompt();
    expect(await screen.findByText("Approve the payment on your phone", undefined, WAIT)).toBeTruthy();
    expect(within(region()).getByText("Sandbox test: real funds may be deducted")).toBeTruthy();
    expect(screen.queryByText("Live M-Pesa payment")).toBeNull();
  });

  it("explains a failed attempt and sends a new prompt only after the customer confirms again", async () => {
    const failed = fixtureAttempt(order, { status: "FAILED", message: PAYMENT_MESSAGES.cancelled, canReconcile: false });
    const second = fixtureAttempt(order, { id: "attempt-2" });
    mocks.customer.getOverview
      .mockResolvedValueOnce(reply(payable({ attempts: [failed] })))
      .mockResolvedValue(reply(withOpen(second, { attempts: [second, failed] })));
    let savedAtSend: unknown;
    mocks.customer.requestPrompt.mockImplementation(async () => {
      savedAtSend = storedIntent();
      return reply(second);
    });
    render(<PaymentPanel orderId={order.id} />);
    const send = await screen.findByRole("button", { name: "Send new M-Pesa prompt" }, WAIT);
    expect(screen.getByText("Payment not completed")).toBeTruthy();
    expect(screen.getByText(PAYMENT_MESSAGES.cancelled)).toBeTruthy();
    expect(mocks.customer.requestPrompt).not.toHaveBeenCalled();

    fireEvent.click(send);
    expect(await screen.findByText("Approve the payment on your phone", undefined, WAIT)).toBeTruthy();
    expect(mocks.customer.requestPrompt).toHaveBeenCalledTimes(1);
    expect(savedAtSend).toMatchObject({ priorAttemptIds: [failed.id] });
  });

  it("asks the customer to wait while the server refuses a new prompt after a failure, keeping focus in the panel", async () => {
    const failed = fixtureAttempt(order, { status: "FAILED", message: PAYMENT_MESSAGES.insufficientFunds, canReconcile: false });
    mocks.customer.getOverview
      .mockResolvedValueOnce(reply(payable({ available: false, reasonCode: "PAYMENT_COOLDOWN", message: PAYMENT_MESSAGES.cooldown, attempts: [failed] })))
      .mockResolvedValue(reply(payable({ attempts: [failed] })));
    render(<PaymentPanel orderId={order.id} />);
    expect(await screen.findByText("Try again shortly", undefined, WAIT)).toBeTruthy();
    expect(screen.getByText(PAYMENT_MESSAGES.cooldown)).toBeTruthy();
    expect(screen.getByText(PAYMENT_MESSAGES.insufficientFunds)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull();

    const again = screen.getByRole("button", { name: "Check again" });
    again.focus();
    fireEvent.click(again);
    expect(await screen.findByRole("button", { name: "Send new M-Pesa prompt" }, WAIT)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Pay with M-Pesa" }));
    expect(mocks.customer.requestPrompt).not.toHaveBeenCalled();
  });

  it("separates received money awaiting staff review from a confirmed payment and never asks for another", async () => {
    const received = fixtureConfirmedAttempt(order, {
      status: "REVIEW", reviewRequired: true, reasonCode: "RESERVATION_UNAVAILABLE", message: PAYMENT_MESSAGES.receivedReview,
    });
    const paidOrder = { ...order, paymentStatus: "PAID" as const, reservationStatus: "COMMITTED" as const, reservationExpiresAt: null };
    mocks.customer.getOverview.mockResolvedValue(reply(fixturePaymentOverview(paidOrder, {
      environment: "production", reasonCode: "PAYMENT_EXISTS", message: PAYMENT_MESSAGES.exists, attempts: [received],
    })));
    render(<PaymentPanel orderId={order.id} />);
    expect(await screen.findByText("Payment received: staff review needed", undefined, WAIT)).toBeTruthy();
    expect(screen.getByText("SBX1234567")).toBeTruthy();
    expect(screen.getByText(/needs staff review before it is fulfilled or refunded\. Do not pay again\./)).toBeTruthy();
    expect(screen.queryByText("Payment confirmed")).toBeNull();
    expect(screen.queryByText(/RESERVATION_UNAVAILABLE/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Send|Check payment status/ })).toBeNull();
  });

  it("follows a late confirmation found by a check and keeps it paid when staff review is flagged afterwards", async () => {
    const unknown = fixtureAttempt(order, { status: "UNKNOWN", message: PAYMENT_MESSAGES.unknown });
    const confirmed = fixtureConfirmedAttempt(order, { reviewRequired: true, reasonCode: "CONFLICTING_CALLBACK" });
    const paidOrder = { ...order, paymentStatus: "PAID" as const, reservationStatus: "COMMITTED" as const, reservationExpiresAt: null };
    mocks.customer.getOverview
      .mockResolvedValueOnce(reply(withOpen(unknown)))
      // Even if availability were reported, money already received is never followed by another prompt.
      .mockResolvedValue(reply(fixturePaymentOverview(paidOrder, { ...PAYABLE, attempts: [confirmed] })));
    mocks.customer.checkAttempt.mockResolvedValue(reply(confirmed));
    const changes = vi.fn();
    render(<PaymentPanel orderId={order.id} onOrderChange={changes} />);

    fireEvent.click(await screen.findByRole("button", { name: "Check payment status" }, WAIT));
    expect(await screen.findByText("Payment confirmed", undefined, WAIT)).toBeTruthy();
    expect(mocks.customer.checkAttempt).toHaveBeenCalledWith(unknown.id);
    expect(screen.getByText("SBX1234567")).toBeTruthy();
    expect(screen.getByText("Your order is paid and awaiting fulfilment by our staff.")).toBeTruthy();
    expect(screen.getByText(/Staff need to review this payment/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send|Check payment status/ })).toBeNull();
    expect(changes).toHaveBeenLastCalledWith(expect.objectContaining({ paymentStatus: "PAID", reservationStatus: "COMMITTED" }));
  });

  it("keeps an invalid or refused number in the form, with focus on it and nothing saved", async () => {
    mocks.customer.getOverview.mockResolvedValue(reply(payable({ environment: "sandbox" })));
    mocks.customer.requestPrompt.mockRejectedValue(apiError(400, { code: "SANDBOX_PHONE_NOT_ALLOWED", error: "Use an authorized sandbox test number." }));
    render(<PaymentPanel orderId={order.id} />);
    await confirmPrompt("0712 34");
    const input = screen.getByRole("textbox", { name: "M-Pesa phone number" });
    expect(await screen.findByText("Enter a Kenyan mobile number beginning with 07, 01 or +254.", undefined, WAIT)).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(input), WAIT);
    expect(mocks.customer.requestPrompt).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "0799 999 999" } });
    expect(input.getAttribute("aria-invalid")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Send M-Pesa prompt" }));
    expect(await screen.findByText("Use an authorized sandbox test number.", undefined, WAIT)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(input), WAIT);
    expect(storedIntent()).toBeNull();
    expect(screen.getByRole("button", { name: "Send M-Pesa prompt" })).toBeTruthy();
  });

  it("sends nothing when the browser cannot save the request", async () => {
    mocks.customer.getOverview.mockResolvedValue(reply(payable()));
    render(<PaymentPanel orderId={order.id} />);
    await sendButton();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Quota exceeded", "QuotaExceededError"); });
    await confirmPrompt();
    expect(await screen.findByText(/could not save your payment request, so no prompt was sent/, undefined, WAIT)).toBeTruthy();
    expect(mocks.customer.requestPrompt).not.toHaveBeenCalled();
  });

  it("keeps the check button mounted, focused and inert while a check runs, so presses cannot overlap", async () => {
    const slow = deferred<{ data: unknown }>();
    mocks.customer.getOverview.mockResolvedValue(reply(withOpen(pending)));
    mocks.customer.checkAttempt.mockReturnValue(slow.promise);
    render(<PaymentPanel orderId={order.id} />);
    const check = await screen.findByRole("button", { name: "Check payment status" }, WAIT);
    check.focus();
    fireEvent.click(check);
    expect(check.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Checking this payment with M-Pesa…")).toBeTruthy();
    fireEvent.click(check);
    expect(mocks.customer.checkAttempt).toHaveBeenCalledTimes(1);

    await act(async () => slow.resolve(reply(pending)));
    await waitFor(() => expect(check.getAttribute("aria-disabled")).toBe("false"), WAIT);
    expect(document.activeElement).toBe(check);
    expect(mocks.customer.requestPrompt).not.toHaveBeenCalled();
  });

  it("checks an open attempt automatically, one request at a time, and stops after five minutes", async () => {
    vi.useFakeTimers();
    mocks.customer.getOverview.mockResolvedValue(reply(withOpen(pending)));
    mocks.customer.checkAttempt.mockResolvedValue(reply(pending));
    render(<PaymentPanel orderId={order.id} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("Approve the payment on your phone")).toBeTruthy();
    expect(mocks.customer.checkAttempt).not.toHaveBeenCalled();

    await advance(10_000);
    expect(mocks.customer.checkAttempt).toHaveBeenCalledTimes(1);
    // Order expiry/cancellation can change even while the attempt status remains the same.
    expect(mocks.customer.getOverview).toHaveBeenCalledTimes(2);

    await advance(5 * 60_000);
    const checks = mocks.customer.checkAttempt.mock.calls.length;
    expect(checks).toBeGreaterThan(1);
    expect(checks).toBeLessThanOrEqual(31);
    expect(screen.getByText(/Automatic checks have stopped/)).toBeTruthy();
    await advance(10 * 60_000);
    expect(mocks.customer.checkAttempt).toHaveBeenCalledTimes(checks);
    expect(mocks.customer.requestPrompt).not.toHaveBeenCalled();
  });

  it("pauses automatic checks while the page is hidden", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(Document.prototype, "visibilityState", "get").mockReturnValue("hidden");
    mocks.customer.getOverview.mockResolvedValue(reply(withOpen(pending)));
    mocks.customer.checkAttempt.mockResolvedValue(reply(pending));
    render(<PaymentPanel orderId={order.id} />);
    await advance(60_000);
    expect(mocks.customer.checkAttempt).not.toHaveBeenCalled();

    visibility.mockReturnValue("visible");
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await advance(10_000);
    expect(mocks.customer.checkAttempt).toHaveBeenCalledTimes(1);
  });

  it("refreshes a cancelled order even when the pending attempt is unchanged and stops asking for PIN approval", async () => {
    vi.useFakeTimers();
    const cancelled = { ...order, status: "CANCELLED" as const, reservationStatus: "RELEASED" as const };
    mocks.customer.getOverview.mockResolvedValueOnce(reply(withOpen(pending))).mockResolvedValue(reply(
      fixturePaymentOverview(cancelled, { environment: "production", reasonCode: "ORDER_NOT_PAYABLE", message: "Order cancelled", attempts: [pending] }),
    ));
    mocks.customer.checkAttempt.mockResolvedValue(reply(pending));
    const changed = vi.fn();
    render(<PaymentPanel orderId={order.id} onOrderChange={changed} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("Approve the payment on your phone")).toBeTruthy();
    await advance(10_000);
    expect(screen.queryByText("Approve the payment on your phone")).toBeNull();
    expect(screen.getByText("Payment pending on an inactive order")).toBeTruthy();
    expect(screen.getByText(/Do not approve an outstanding prompt/)).toBeTruthy();
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ status: "CANCELLED" }));
    expect(mocks.customer.requestPrompt).not.toHaveBeenCalled();
  });
});

describe("customer demonstration payment", () => {
  const sample = fixturePendingOrder(fixtureQuote(), { isDemo: true });
  const offered = (overrides: Partial<PaymentOverview> = {}) => fixtureDemonstrationOverview(sample, overrides);
  const paidOrder = fixtureCustomerOrder({ ...sample, paymentMethod: "DEMONSTRATION", paymentStatus: "PAID", reservationStatus: "COMMITTED" });
  const payButton = () => screen.findByRole("button", { name: named("Pay with a demonstration payment") }, WAIT);
  const sandboxDisclosure = () => screen.getByText("Pay with M-Pesa sandbox instead").closest("details")!;
  const NO_MONEY = "No money is taken and no phone prompt is sent.";

  it("offers the demonstration payment first, with the M-Pesa sandbox form closed in a disclosure below", async () => {
    mocks.customer.getOverview.mockResolvedValue(reply(offered()));
    render(<PaymentPanel orderId={sample.id} />);
    const pay = await payButton();
    expect(screen.getByRole("region", { name: "Payment" })).toBeTruthy();
    const described = (pay.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent);
    expect(described).toContain(NO_MONEY);
    expect(described.some((text) => text?.includes("KES 1,244"))).toBe(true);
    const disclosure = sandboxDisclosure();
    expect(disclosure.open).toBe(false);
    expect(pay.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const text of ["Sandbox test: real funds may be deducted", "Prompts can only be sent to approved test numbers."]) {
      expect(within(disclosure).getByText(text)).toBeTruthy();
    }
    expect(within(disclosure).getByLabelText("M-Pesa phone number")).toBeTruthy();
    expect(within(disclosure).getByRole("button", { name: "Send M-Pesa prompt" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: named(/Pay with a demonstration payment/) })).toHaveLength(1);
  });

  it("records it once, then shows the order paid by demonstration payment and returns focus to the panel heading", async () => {
    const paid = deferred<{ data: unknown }>();
    mocks.customer.getOverview.mockResolvedValueOnce(reply(offered())).mockResolvedValue(reply(fixtureDemonstrationPaidOverview(sample)));
    mocks.customer.payWithDemonstration.mockReturnValue(paid.promise);
    const onOrderChange = vi.fn();
    render(<PaymentPanel orderId={sample.id} onOrderChange={onOrderChange} />);
    const pay = await payButton();
    pay.focus();
    fireEvent.click(pay);
    fireEvent.click(pay);
    expect(pay.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Recording the demonstration payment…");
    await act(async () => paid.resolve(reply(paidOrder)));
    await screen.findByText("Paid with a demonstration payment", undefined, WAIT);
    expect(mocks.customer.payWithDemonstration).toHaveBeenCalledTimes(1);
    expect(mocks.customer.payWithDemonstration).toHaveBeenCalledWith(sample.id);
    expect(mocks.customer.requestPrompt).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("Demonstration payment recorded. No money was taken.");
    expect(screen.getByText(/^No money was taken\. Your order is waiting to be prepared\.$/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: named("Pay with a demonstration payment") })).toBeNull();
    expect(screen.queryByText("Pay with M-Pesa sandbox instead")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Payment" }));
    expect(onOrderChange).toHaveBeenLastCalledWith(expect.objectContaining({ paymentMethod: "DEMONSTRATION", paymentStatus: "PAID" }));
  });

  it("shows the server's refusal and refreshes, offering nothing the server would refuse", async () => {
    mocks.customer.getOverview.mockResolvedValueOnce(reply(offered())).mockResolvedValue(reply(offered({
      available: false, reasonCode: "PAYMENT_EXISTS", message: PAYMENT_MESSAGES.exists, attempts: [fixtureAttempt(sample)],
      demonstration: { available: false, reasonCode: "PAYMENT_EXISTS" },
    })));
    const refusal = "An M-Pesa payment for this order is still open. Check it instead of paying another way.";
    mocks.customer.payWithDemonstration.mockRejectedValue(apiError(409, { error: refusal, code: "PAYMENT_EXISTS" }));
    render(<PaymentPanel orderId={sample.id} />);
    fireEvent.click(await payButton());
    expect((await screen.findByRole("alert", undefined, WAIT)).textContent).toBe(refusal);
    expect(await screen.findByText("Approve the payment on your phone", undefined, WAIT)).toBeTruthy();
    expect(screen.queryByRole("button", { name: named("Pay with a demonstration payment") })).toBeNull();
    expect(mocks.customer.getOverview).toHaveBeenCalledTimes(2);
  });

  it("stays available when M-Pesa is switched off or cannot take a fractional total", async () => {
    mocks.customer.getOverview.mockResolvedValue(reply(offered({
      available: false, environment: null, reasonCode: "MPESA_DISABLED", message: PAYMENT_MESSAGES.disabled,
    })));
    const off = render(<PaymentPanel orderId={sample.id} />);
    await payButton();
    expect(within(sandboxDisclosure()).getByText("M-Pesa payment unavailable")).toBeTruthy();
    expect(within(sandboxDisclosure()).getByText(PAYMENT_MESSAGES.disabled)).toBeTruthy();
    expect(screen.queryByText("Sandbox test: real funds may be deducted")).toBeNull();
    expect(screen.queryByLabelText("M-Pesa phone number")).toBeNull();
    off.unmount();

    mocks.customer.getOverview.mockResolvedValue(reply(fixtureDemonstrationOverview({ ...sample, total: 1244.01 })));
    render(<PaymentPanel orderId={sample.id} />);
    await payButton();
    expect(screen.getAllByText("KES 1,244.01").length).toBeGreaterThan(0);
    expect(within(sandboxDisclosure()).getByText(/cannot be collected through M-Pesa without rounding/)).toBeTruthy();
    expect(screen.queryByLabelText("M-Pesa phone number")).toBeNull();
  });

  it("shows paid and refunded demonstration orders with no M-Pesa receipt, phone or prompt", async () => {
    for (const paymentStatus of ["PAID", "REFUNDED"] as const) {
      const overview = fixtureDemonstrationPaidOverview(sample);
      overview.order = { ...overview.order, paymentStatus };
      mocks.customer.getOverview.mockResolvedValue(reply(overview));
      const view = render(<PaymentPanel orderId={sample.id} />);
      expect(await screen.findByText("Paid with a demonstration payment", undefined, WAIT)).toBeTruthy();
      for (const absent of [/M-Pesa receipt/, /Send M-Pesa prompt/, /\+254/, /Pay with a demonstration payment/]) {
        expect(withoutSoftHyphens(document.body.textContent), `${paymentStatus} ${absent}`).not.toMatch(absent);
      }
      view.unmount();
    }
  });

  it("is never offered for a live order, whose M-Pesa form stays as it was", async () => {
    mocks.customer.getOverview.mockResolvedValue(reply(payable()));
    render(<PaymentPanel orderId={order.id} />);
    await sendButton();
    expect(screen.getByRole("region", { name: "Pay with M-Pesa" })).toBeTruthy();
    expect(screen.queryByText("Pay with M-Pesa sandbox instead")).toBeNull();
    expect(screen.queryByRole("button", { name: named("Pay with a demonstration payment") })).toBeNull();
  });
});

describe("staff M-Pesa payments", () => {
  const failed = fixtureAttempt(order, { id: "attempt-1", status: "FAILED", message: PAYMENT_MESSAGES.cancelled, canReconcile: false });
  const unknown = fixtureAttempt(order, {
    id: "attempt-2", status: "UNKNOWN", reasonCode: "PROVIDER_QUERY_PENDING", message: PAYMENT_MESSAGES.unknown, canReconcile: true,
  });

  it("shows each attempt's status, masked phone, receipt and review guidance, with no way to start or settle a payment", async () => {
    const received = fixtureConfirmedAttempt(order, {
      id: "attempt-3", status: "REVIEW", reviewRequired: true, reasonCode: "RESERVATION_UNAVAILABLE", message: PAYMENT_MESSAGES.receivedReview,
    });
    mocks.staff.getOverview.mockResolvedValue(reply(withOpen(received, { attempts: [received, failed] })));
    render(<StaffPaymentPanel orderId={order.id} canCheck />);
    const panel = await screen.findByRole("region", { name: "M-Pesa payments" }, WAIT);
    const items = await within(panel).findAllByRole("listitem", undefined, WAIT);
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("Money received, review required")).toBeTruthy();
    expect(within(items[0]).getByText("Review required")).toBeTruthy();
    expect(within(items[0]).getByText("SBX1234567")).toBeTruthy();
    expect(within(items[0]).getByText("+254 *** 5678")).toBeTruthy();
    expect(within(items[0]).getByText(/Check stock, then decide fulfilment or refund\./)).toBeTruthy();
    expect(within(items[1]).getByText("Did not complete")).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Check with M-Pesa" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /Send|refund|paid/i })).toBeNull();
    expect(within(panel).queryByRole("textbox")).toBeNull();
    expect(mocks.customer.getOverview).not.toHaveBeenCalled();
  });

  it("lets administrators ask M-Pesa about an attempt that allows it, then reloads the record", async () => {
    const confirmed = fixtureConfirmedAttempt(order, { id: "attempt-2" });
    mocks.staff.getOverview
      .mockResolvedValueOnce(reply(withOpen(unknown, { attempts: [unknown, failed] })))
      .mockResolvedValue(reply(withOpen(confirmed, { attempts: [confirmed, failed] })));
    mocks.staff.checkAttempt.mockResolvedValue(reply(confirmed));
    render(<StaffPaymentPanel orderId={order.id} canCheck />);
    expect(await screen.findByText("M-Pesa has not reported a final result yet.", undefined, WAIT)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check with M-Pesa" }));
    expect(await screen.findByText("Paid", undefined, WAIT)).toBeTruthy();
    expect(mocks.staff.checkAttempt).toHaveBeenCalledWith("attempt-2");
    expect(mocks.staff.getOverview).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Check with M-Pesa" })).toBeNull();
    expect(mocks.customer.checkAttempt).not.toHaveBeenCalled();
  });

  it("shows viewers the record but blocks their checks", async () => {
    mocks.staff.getOverview.mockResolvedValue(reply(withOpen(unknown)));
    render(<StaffPaymentPanel orderId={order.id} canCheck={false} />);
    const check = await screen.findByRole("button", { name: "Check with M-Pesa" }, WAIT);
    expect(check.getAttribute("aria-disabled")).toBe("true");
    const note = document.getElementById(check.getAttribute("aria-describedby") ?? "");
    expect(note?.textContent).toBe("Your role can view payments but cannot request M-Pesa checks.");
    fireEvent.click(check);
    expect(mocks.staff.checkAttempt).not.toHaveBeenCalled();
  });

  it("reads a demonstration payment as paid with no money taken, with nothing for staff to collect", async () => {
    const sample = fixturePendingOrder(fixtureQuote(), { isDemo: true });
    mocks.staff.getOverview.mockResolvedValue(reply(fixtureDemonstrationPaidOverview(sample)));
    render(<StaffPaymentPanel orderId={sample.id} canCheck />);
    const panel = await screen.findByRole("region", { name: "M-Pesa payments" }, WAIT);
    await within(panel).findByText("Demonstration payment", undefined, WAIT);
    expect(within(panel).getByText("Paid with a demonstration payment: no money was taken and there is nothing to collect.")).toBeTruthy();
    expect(within(panel).queryByText(/The customer can request a new M-Pesa prompt/)).toBeNull();
  });
});
