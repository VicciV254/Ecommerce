import { AxiosError, AxiosHeaders, CanceledError } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaymentOverview } from "../api/mpesa";
import { fixtureQuote, fixturePendingOrder } from "../test-support/checkoutFixtures";
import {
  PAYABLE,
  PAYMENT_MESSAGES,
  fixtureAttempt,
  fixtureConfirmedAttempt,
  fixtureDemonstrationOverview,
  fixtureDemonstrationPaidOverview,
  fixturePaymentOverview,
} from "../test-support/paymentFixtures";
import {
  AUTO_CHECK_HORIZON_MS,
  PaymentFormatError,
  autoCheckDelay,
  classifyPromptFailure,
  clearPaymentIntent,
  hasNewAttempt,
  normalizeMpesaPhone,
  parsePaymentAttempt,
  parsePaymentOverview,
  paymentIntentKey,
  paymentView,
  readPaymentIntent,
  savePaymentIntent,
  staffGuidance,
  withPaymentSummary,
  type PaymentIntent,
} from "./paymentModel";

const order = fixturePendingOrder(fixtureQuote());
const payable = (overrides: Partial<PaymentOverview> = {}) => fixturePaymentOverview(order, { ...PAYABLE, ...overrides });

function apiError(status: number | undefined, data: unknown = {}) {
  const config = { headers: new AxiosHeaders() };
  const response = status === undefined ? undefined : { status, statusText: String(status), data, headers: new AxiosHeaders(), config };
  return new AxiosError("Request failed", status === undefined ? "ERR_NETWORK" : "ERR_BAD_REQUEST", config, undefined, response);
}

function intent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    ownerId: "customer-a", orderId: order.id, idempotencyKey: "intent-key-0123456789", phone: "254712345678",
    priorAttemptIds: [], createdAt: new Date().toISOString(), ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("M-Pesa phone numbers", () => {
  it.each([
    ["0712345678", "254712345678"],
    ["0112 345 678", "254112345678"],
    ["+254 712-345-678", "254712345678"],
    ["254712345678", "254712345678"],
    ["712345678", "254712345678"],
    [" (0712) 345 678 ", "254712345678"],
  ])("normalizes %s the way the server does", (input, expected) => {
    expect(normalizeMpesaPhone(input)).toBe(expected);
  });

  it.each(["", "0201234567", "071234567", "+2540712345678", "0712 345 67a", "2547123456789", "++254712345678", "1".repeat(40)])(
    "rejects %s", (input) => {
      expect(normalizeMpesaPhone(input)).toBeNull();
    },
  );
});

describe("payment responses", () => {
  it("accepts the server overview for the requested order only", () => {
    const overview = payable({ attempts: [fixtureAttempt(order)] });
    expect(parsePaymentOverview(JSON.parse(JSON.stringify(overview)), order.id)).toEqual(overview);
    expect(() => parsePaymentOverview(overview, "another-order")).toThrow(PaymentFormatError);
    expect(() => parsePaymentOverview(payable({ attempts: [fixtureAttempt({ id: "another-order", total: 1244 })] }), order.id))
      .toThrow(PaymentFormatError);
  });

  it.each([
    ["an unknown status", { status: "PAID" }],
    ["a non-positive amount", { amount: 0 }],
    ["a fractional provider amount", { amount: 1244.5 }],
    ["an unparseable time", { createdAt: "yesterday" }],
    ["a missing message", { message: undefined }],
  ])("rejects an attempt with %s", (_label, change) => {
    expect(() => parsePaymentAttempt({ ...fixtureAttempt(order), ...change })).toThrow(PaymentFormatError);
  });

  it("rejects an attempt that is not the one asked about", () => {
    expect(() => parsePaymentAttempt(fixtureAttempt(order), { id: "attempt-2" })).toThrow(PaymentFormatError);
    expect(() => parsePaymentAttempt(fixtureAttempt(order), { orderId: "another-order" })).toThrow(PaymentFormatError);
  });
});

describe("saved prompt requests", () => {
  it("are saved before sending, scoped to one customer and order, and refused while another is unresolved", () => {
    const saved = intent();
    expect(savePaymentIntent(saved)).toBe(true);
    expect(readPaymentIntent("customer-a", order.id)).toEqual(saved);
    expect(readPaymentIntent("customer-b", order.id)).toBeNull();
    expect(readPaymentIntent("customer-a", "another-order")).toBeNull();
    expect(savePaymentIntent(intent({ idempotencyKey: "second-key-0123456789" }))).toBe(false);
    expect(readPaymentIntent("customer-a", order.id)?.idempotencyKey).toBe("intent-key-0123456789");
  });

  it("are only cleared by the request they belong to", () => {
    savePaymentIntent(intent());
    clearPaymentIntent(intent({ idempotencyKey: "other-key-0123456789" }));
    expect(readPaymentIntent("customer-a", order.id)).not.toBeNull();
    clearPaymentIntent(intent());
    expect(localStorage.getItem(paymentIntentKey("customer-a", order.id))).toBeNull();
  });

  it("report failure when storage cannot keep them, so nothing is sent", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Quota exceeded", "QuotaExceededError"); });
    expect(savePaymentIntent(intent())).toBe(false);
    expect(readPaymentIntent("customer-a", order.id)).toBeNull();
  });

  it("drop an entry stored under the key for a different customer", () => {
    localStorage.setItem(paymentIntentKey("customer-a", order.id), JSON.stringify(intent({ ownerId: "customer-b" })));
    expect(readPaymentIntent("customer-a", order.id)).toBeNull();
    expect(localStorage.getItem(paymentIntentKey("customer-a", order.id))).toBeNull();
  });

  it("recognise the server's record of a request by an attempt that did not exist before", () => {
    const earlier = fixtureAttempt(order, { id: "attempt-0", status: "FAILED" });
    expect(hasNewAttempt(payable({ attempts: [earlier] }), intent({ priorAttemptIds: ["attempt-0"] }))).toBe(false);
    expect(hasNewAttempt(payable({ attempts: [fixtureAttempt(order), earlier] }), intent({ priorAttemptIds: ["attempt-0"] }))).toBe(true);
  });
});

describe("prompt request failures", () => {
  it.each([
    ["a lost response", apiError(undefined)],
    ["an unsaved provider result", apiError(503, { code: "PAYMENT_PERSISTENCE_UNKNOWN", error: "Check this payment" })],
    ["a storage error", apiError(503, { code: "PAYMENT_STORAGE_ERROR", error: "Payment data could not be saved" })],
    ["a concurrent update", apiError(409, { code: "PAYMENT_RETRY", error: "Retry the same request" })],
    ["an unexplained server error", apiError(500)],
    ["a malformed success", new PaymentFormatError("attempt")],
  ])("keep the request open after %s", (_label, error) => {
    expect(classifyPromptFailure(error).kind).toBe("unknown");
  });

  it("are definite refusals when payments are switched off, the phone is wrong or another attempt exists", () => {
    expect(classifyPromptFailure(apiError(503, { code: "MPESA_DISABLED", error: PAYMENT_MESSAGES.disabled })))
      .toEqual({ kind: "rejected", code: "MPESA_DISABLED", field: null, message: PAYMENT_MESSAGES.disabled });
    expect(classifyPromptFailure(apiError(400, { code: "SANDBOX_PHONE_NOT_ALLOWED", error: "Use an authorized sandbox test number." })))
      .toMatchObject({ kind: "rejected", field: "phone", message: "Use an authorized sandbox test number." });
    expect(classifyPromptFailure(apiError(409, { code: "PAYMENT_EXISTS", error: PAYMENT_MESSAGES.exists })))
      .toMatchObject({ kind: "rejected", code: "PAYMENT_EXISTS", field: null });
  });

  it("are ignored once the session that sent them has changed", () => {
    expect(classifyPromptFailure(new CanceledError("Customer session changed"))).toEqual({ kind: "cancelled" });
  });
});

describe("payment view", () => {
  it("never treats an accepted prompt as payment", () => {
    const view = paymentView(payable({ available: false, reasonCode: "PAYMENT_EXISTS", attempts: [fixtureAttempt(order)] }), null);
    expect(view).toMatchObject({ kind: "attempt", stage: "waiting" });
    const unconfirmedSuccess = fixtureAttempt(order, { status: "SUCCEEDED", confirmedAt: null });
    expect(paymentView(payable({ attempts: [unconfirmedSuccess] }), null)).toMatchObject({ stage: "verifying" });
  });

  it("separates received money that needs review from a confirmed payment", () => {
    const received = fixtureConfirmedAttempt(order, { status: "REVIEW", reviewRequired: true, reasonCode: "RESERVATION_UNAVAILABLE" });
    expect(paymentView(payable({ available: false, attempts: [received] }), null)).toMatchObject({ stage: "received-review" });
    expect(paymentView(payable({ available: false, attempts: [fixtureConfirmedAttempt(order)] }), null)).toMatchObject({ stage: "paid" });
  });

  it("lets money received on an earlier attempt outrank a newer one", () => {
    const failed = fixtureAttempt(order, { id: "attempt-2", status: "FAILED" });
    const confirmed = fixtureConfirmedAttempt(order, { status: "REVIEW", reviewRequired: true });
    expect(paymentView(payable({ attempts: [failed, confirmed] }), null)).toMatchObject({ kind: "attempt", attempt: { id: "attempt-1" } });
  });

  it("offers a new prompt after a failure only while the server allows one", () => {
    const failed = fixtureAttempt(order, { status: "FAILED", message: PAYMENT_MESSAGES.cancelled });
    expect(paymentView(payable({ attempts: [failed] }), null)).toEqual({ kind: "payable", failed, demonstration: false });
    expect(paymentView(payable({ available: false, reasonCode: "PAYMENT_COOLDOWN", message: PAYMENT_MESSAGES.cooldown, attempts: [failed] }), null))
      .toEqual({ kind: "unavailable", failed, message: PAYMENT_MESSAGES.cooldown, waiting: true, demonstration: false });
  });

  it("does not offer a prompt for a fractional total, even if the server says payments are available", () => {
    const fractional = fixturePaymentOverview({ ...order, total: 1244.5 }, PAYABLE);
    expect(paymentView(fractional, null)).toMatchObject({ kind: "unavailable", waiting: false });
    const refused = fixturePaymentOverview({ ...order, total: 1244.5 }, { reasonCode: "MPESA_AMOUNT_UNSUPPORTED", message: PAYMENT_MESSAGES.fractional });
    expect(paymentView(refused, null)).toMatchObject({ kind: "unavailable", message: PAYMENT_MESSAGES.fractional });
  });

  it("shows an unresolved request instead of anything new, retryable only once checked", () => {
    expect(paymentView(payable(), { checked: false })).toEqual({ kind: "unresolved", retryable: false });
    expect(paymentView(payable(), { checked: true })).toEqual({ kind: "unresolved", retryable: true });
  });
});

describe("demonstration payments", () => {
  const sample = fixturePendingOrder(fixtureQuote(), { isDemo: true });

  it("keep the overview's payment method and demonstration block, and refuse malformed ones", () => {
    const offered = fixtureDemonstrationOverview(sample);
    expect(parsePaymentOverview(JSON.parse(JSON.stringify(offered)), sample.id)).toEqual(offered);
    const paid = parsePaymentOverview(fixtureDemonstrationPaidOverview(sample), sample.id);
    expect([paid.order.paymentMethod, paid.demonstration]).toEqual(["DEMONSTRATION", { available: false, reasonCode: "ORDER_NOT_PAYABLE" }]);
    expect(parsePaymentOverview(fixturePaymentOverview(order), order.id).demonstration).toBeNull();
    const malformed: unknown[] = [
      { ...offered, demonstration: undefined },
      { ...offered, demonstration: { available: "yes", reasonCode: null } },
      { ...offered, demonstration: { available: false, reasonCode: 7 } },
      { ...offered, demonstration: { available: true } },
      { ...offered, order: { ...offered.order, paymentMethod: "CASH" } },
      { ...offered, order: { ...offered.order, paymentMethod: undefined } },
    ];
    for (const data of malformed) expect(() => parsePaymentOverview(data, sample.id)).toThrow(PaymentFormatError);
  });

  it("are offered beside M-Pesa, including when M-Pesa is off or cannot take a fractional total", () => {
    expect(paymentView(fixtureDemonstrationOverview(sample), null)).toEqual({ kind: "payable", failed: null, demonstration: true });
    const off = fixtureDemonstrationOverview(sample, { available: false, environment: null, reasonCode: "MPESA_DISABLED", message: PAYMENT_MESSAGES.disabled });
    expect(paymentView(off, null)).toEqual({ kind: "unavailable", failed: null, message: PAYMENT_MESSAGES.disabled, waiting: false, demonstration: true });
    const fractional = fixtureDemonstrationOverview({ ...sample, total: 1244.01 });
    expect(paymentView(fractional, null)).toMatchObject({ kind: "unavailable", demonstration: true });
    // Not where the server refuses it, for a live order, or while an earlier M-Pesa request is unresolved.
    const refused = fixtureDemonstrationOverview(sample, { demonstration: { available: false, reasonCode: "ORDER_NOT_PAYABLE" } });
    expect(paymentView(refused, null)).toMatchObject({ kind: "payable", demonstration: false });
    expect(paymentView(fixtureDemonstrationOverview(sample), { checked: true })).toEqual({ kind: "unresolved", retryable: true });
    const open = fixtureDemonstrationOverview(sample, {
      available: false, reasonCode: "PAYMENT_EXISTS", demonstration: { available: false, reasonCode: "PAYMENT_EXISTS" }, attempts: [fixtureAttempt(sample)],
    });
    expect(paymentView(open, null)).toMatchObject({ kind: "attempt", stage: "waiting" });
  });

  it("show a demonstration-paid order as paid by demonstration, with any money M-Pesa later reported", () => {
    expect(paymentView(fixtureDemonstrationPaidOverview(sample), null)).toEqual({ kind: "demonstration-paid", attempt: null });
    const refunded = fixtureDemonstrationPaidOverview(sample);
    refunded.order = { ...refunded.order, paymentStatus: "REFUNDED" };
    expect(paymentView(refunded, null)).toMatchObject({ kind: "demonstration-paid" });
    const late = fixtureConfirmedAttempt(sample, { status: "REVIEW", reviewRequired: true, reasonCode: "EXTRA_PAYMENT" });
    const failedBefore = fixtureAttempt(sample, { id: "attempt-2", status: "FAILED" });
    expect(paymentView(fixtureDemonstrationPaidOverview(sample, { attempts: [late] }), null)).toEqual({ kind: "demonstration-paid", attempt: late });
    expect(paymentView(fixtureDemonstrationPaidOverview(sample, { attempts: [failedBefore] }), null)).toEqual({ kind: "demonstration-paid", attempt: null });
  });

  it("carry the payment method into the order shown beside the panel", () => {
    const summary = fixtureDemonstrationPaidOverview(sample).order;
    const updated = withPaymentSummary(sample, summary);
    expect(updated).toMatchObject({ paymentMethod: "DEMONSTRATION", paymentStatus: "PAID", reservationStatus: "COMMITTED" });
    expect(withPaymentSummary(updated, summary)).toBe(updated);
  });
});

describe("order summary and checks", () => {
  it("updates the order's payment status from the server and keeps the same object when nothing changed", () => {
    const summary = fixturePaymentOverview(order).order;
    expect(withPaymentSummary(order, summary)).toBe(order);
    const paid = withPaymentSummary(order, { ...summary, paymentStatus: "PAID", reservationStatus: "COMMITTED", reservationExpiresAt: null });
    expect(paid).toMatchObject({ id: order.id, paymentStatus: "PAID", reservationStatus: "COMMITTED", reservationExpiresAt: null, total: 1244 });
    expect(withPaymentSummary(order, { ...summary, id: "another-order", paymentStatus: "PAID" })).toBe(order);
  });

  it("schedules automatic checks within bounds of the server's suggested time", () => {
    const now = Date.parse("2026-11-02T12:00:00Z");
    const at = (ms: number) => fixtureAttempt(order, { nextCheckAt: new Date(now + ms).toISOString() });
    expect(autoCheckDelay(at(-60_000), now)).toBe(5_000);
    expect(autoCheckDelay(at(20_000), now)).toBe(20_000);
    expect(autoCheckDelay(at(600_000), now)).toBe(60_000);
    expect(autoCheckDelay(fixtureAttempt(order), now)).toBe(10_000);
    expect(AUTO_CHECK_HORIZON_MS).toBe(300_000);
  });

  it("explains review reasons to staff and shows unknown codes as they are", () => {
    expect(staffGuidance(fixtureAttempt(order))).toBeNull();
    expect(staffGuidance(fixtureAttempt(order, { reasonCode: "EXTRA_PAYMENT" }))).toMatch(/refund is due/);
    expect(staffGuidance(fixtureAttempt(order, { reasonCode: "NEW_CODE" }))).toBe("Reason code: NEW_CODE.");
  });
});
