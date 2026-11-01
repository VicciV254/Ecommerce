import { AxiosError, AxiosHeaders, CanceledError } from "axios";
import { describe, expect, it } from "vitest";
import {
  CheckoutFormatError,
  classifyOrderFailure,
  isOrderIntent,
  newIdempotencyKey,
  normalizeCouponCode,
  orderHoldsItems,
  parseOrder,
  parseQuote,
  quoteMatchesRequest,
  quoteRequestFor,
  requestSignature,
  reviewCart,
  samePricing,
  subtractOrderedItems,
} from "./checkoutModel";
import { fixtureSnapshot, linenShirt } from "../test-support/catalogFixtures";
import { fixturePendingOrder, fixtureQuote, homeAddress, linenLine, poloLine } from "../test-support/checkoutFixtures";

function apiError(status: number | undefined, data: unknown = {}) {
  const config = { headers: new AxiosHeaders() };
  const response = status === undefined ? undefined : { status, statusText: String(status), data, headers: new AxiosHeaders(), config };
  return new AxiosError("Request failed", status === undefined ? "ERR_NETWORK" : "ERR_BAD_RESPONSE", config, undefined, response);
}

const linenCart = [{ productId: linenShirt.id, variantId: "var-linen-m-white", quantity: 1 }];
const request = quoteRequestFor(linenCart, { addressId: homeAddress.id, deliveryMethod: "STANDARD", couponCode: null });

describe("quote and order boundary", () => {
  it("accepts a server quote and rejects malformed or unbounded money instead of guessing totals", () => {
    expect(parseQuote(fixtureQuote()).total).toBe(1244);
    expect(parseQuote(fixtureQuote({ tax: 197.44, total: 1431.44 })).tax).toBe(197.44);
    for (const broken of [
      { ...fixtureQuote(), total: undefined },
      { ...fixtureQuote(), total: "1244" },
      { ...fixtureQuote(), tax: 144.005 },
      { ...fixtureQuote(), shippingCost: -200 },
      { ...fixtureQuote(), currency: "USD" },
      { ...fixtureQuote(), version: 2 },
      { ...fixtureQuote(), lines: [] },
      { ...fixtureQuote(), lines: [{ ...linenLine, quantity: 0 }] },
      { ...fixtureQuote(), reservationsEnabled: "yes" },
      { ...fixtureQuote(), expiresAt: "soon" },
    ]) {
      expect(() => parseQuote(broken)).toThrow(CheckoutFormatError);
    }
  });

  it("accepts only quote-based pending orders with valid items, statuses and totals", () => {
    const order = fixturePendingOrder(fixtureQuote());
    expect(parseOrder(order).orderNumber).toBe("APX-QUOTE-1");
    expect(orderHoldsItems(order)).toBe(true);
    expect(orderHoldsItems({ ...order, status: "CANCELLED", reservationStatus: "RELEASED" })).toBe(false);
    expect(orderHoldsItems({ ...order, status: "CANCELLED", reservationStatus: "EXPIRED" })).toBe(false);
    for (const broken of [
      { ...order, quoteId: null },
      { ...order, status: "UNKNOWN" },
      { ...order, reservationStatus: undefined },
      { ...order, total: 1244.001 },
      { ...order, items: [{ ...order.items[0], variantId: null }] },
      { ...order, items: [] },
    ]) {
      expect(() => parseOrder(broken)).toThrow(CheckoutFormatError);
    }
  });

  it("only treats a quote as current when it priced exactly the requested cart and choices", () => {
    const quote = fixtureQuote();
    expect(quoteMatchesRequest(quote, request)).toBe(true);
    expect(quoteMatchesRequest(quote, { ...request, items: [{ ...request.items[0], quantity: 2 }] })).toBe(false);
    expect(quoteMatchesRequest(quote, { ...request, addressId: "addr-office" })).toBe(false);
    expect(quoteMatchesRequest(quote, { ...request, deliveryMethod: "SAME_DAY" })).toBe(false);
    expect(quoteMatchesRequest(quote, { ...request, couponCode: "SAVE10" })).toBe(false);
    expect(quoteMatchesRequest({ ...quote, lines: [linenLine, poloLine] }, request)).toBe(false);
  });

  it("orders request lines so the same cart always has the same signature", () => {
    const polo = { productId: "prod-polo-shirt", variantId: "var-polo", quantity: 1 };
    const options = { addressId: homeAddress.id, deliveryMethod: "STANDARD" as const, couponCode: null };
    expect(requestSignature(quoteRequestFor([polo, ...linenCart], options))).toBe(requestSignature(quoteRequestFor([...linenCart, polo], options)));
    expect(quoteRequestFor(linenCart, options)).toEqual({
      items: linenCart, addressId: homeAddress.id, deliveryMethod: "STANDARD", couponCode: null, notes: null,
    });
  });

  it("compares quotes by what they charge, not by identity", () => {
    expect(samePricing(fixtureQuote(), fixtureQuote({ id: "quote-2", expiresAt: "2030-01-01T00:00:00.000Z" }))).toBe(true);
    expect(samePricing(fixtureQuote(), fixtureQuote({ id: "quote-2", tax: 160, total: 1260 }))).toBe(false);
    expect(samePricing(fixtureQuote(), fixtureQuote({ lines: [{ ...linenLine, unitPrice: 1000, total: 1000 }] }))).toBe(false);
  });
});

describe("cart review and acknowledgement", () => {
  it("removes ordered units once from matching lines and keeps everything else", () => {
    const cart = [
      { productId: "p1", variantId: "v1", quantity: 3 },
      { productId: "p2", variantId: "v2", quantity: 1 },
      { productId: "p3", variantId: "v3", quantity: 2 },
    ];
    expect(subtractOrderedItems(cart, [
      { productId: "p1", variantId: "v1", quantity: 2 },
      { productId: "p2", variantId: "v2", quantity: 5 },
      { productId: "p9", variantId: "v9", quantity: 1 },
    ])).toEqual([{ productId: "p1", variantId: "v1", quantity: 1 }, { productId: "p3", variantId: "v3", quantity: 2 }]);
  });

  it("blocks quoting a cart with unavailable or over-stock lines instead of dropping them", () => {
    const productsById = new Map(fixtureSnapshot().products.map((product) => [product.id, product]));
    expect(reviewCart(linenCart, productsById).blocker).toBeNull();
    expect(reviewCart([{ ...linenCart[0], quantity: 3 }], productsById)).toMatchObject({ blocker: "stock", lines: [{ problem: "over-stock" }] });
    expect(reviewCart([{ productId: linenShirt.id, variantId: "var-linen-m-blue", quantity: 1 }], productsById).lines[0].problem).toBe("out-of-stock");
    expect(reviewCart([...linenCart, { productId: "retired", variantId: "gone", quantity: 1 }], productsById).blocker).toBe("unavailable");
  });

  it("normalizes coupon codes the way the server does and rejects impossible ones", () => {
    expect(normalizeCouponCode("  save-10_x ")).toBe("SAVE-10_X");
    for (const value of ["ab", "with space", "percent%", "x".repeat(41)]) expect(normalizeCouponCode(value)).toBeNull();
  });
});

describe("order submission safety", () => {
  it("classifies only definite server refusals as rejections; anything unconfirmed keeps the same request", () => {
    expect(classifyOrderFailure(apiError(undefined))).toMatchObject({ kind: "unknown" });
    expect(classifyOrderFailure(apiError(500, { error: "Database timeout" }))).toMatchObject({ kind: "unknown" });
    expect(classifyOrderFailure(apiError(504))).toMatchObject({ kind: "unknown" });
    expect(classifyOrderFailure(new CheckoutFormatError("order"))).toMatchObject({ kind: "unknown" });
    expect(classifyOrderFailure(new CanceledError("Customer session changed"))).toEqual({ kind: "cancelled" });
    expect(classifyOrderFailure(apiError(409, { error: "Retry", code: "ORDER_RETRY" }))).toMatchObject({ kind: "retry" });
    expect(classifyOrderFailure(apiError(409, { error: "Used", code: "QUOTE_USED" }))).toMatchObject({ kind: "used" });
    expect(classifyOrderFailure(apiError(409, { error: "Changed", code: "QUOTE_CHANGED" }))).toEqual({
      kind: "rejected", code: "QUOTE_CHANGED", message: "Prices, delivery or your address changed since you reviewed this order. Nothing was reserved.",
    });
    expect(classifyOrderFailure(apiError(503, { error: "Order reservations are not enabled.", code: "ORDERING_UNAVAILABLE" })))
      .toEqual({ kind: "rejected", code: "ORDERING_UNAVAILABLE", message: "Order reservations are not enabled." });
    expect(classifyOrderFailure(apiError(409, { error: "Insufficient stock for Linen", code: "OUT_OF_STOCK" })))
      .toMatchObject({ kind: "rejected", message: "Insufficient stock for Linen" });
  });

  it("creates request keys the API accepts, with a fallback where randomUUID is unavailable", () => {
    const keys = new Set([newIdempotencyKey(), newIdempotencyKey()]);
    expect(keys.size).toBe(2);
    for (const key of keys) expect(key).toMatch(/^[A-Za-z0-9:_-]{16,128}$/);
    const own = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      expect(newIdempotencyKey()).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      if (own) Object.defineProperty(crypto, "randomUUID", own);
      else Reflect.deleteProperty(crypto, "randomUUID");
    }
    expect(typeof crypto.randomUUID).toBe("function");
  });

  it("restores only well-formed stored intents", () => {
    const valid = { quoteId: "quote-1", idempotencyKey: "0123456789abcdef", signature: "sig", total: 1244, createdAt: "2026-10-31T12:00:00.000Z" };
    expect(isOrderIntent(valid)).toBe(true);
    expect(isOrderIntent({ ...valid, idempotencyKey: "short" })).toBe(false);
    expect(isOrderIntent({ ...valid, total: 12.345 })).toBe(false);
    expect(isOrderIntent({ ...valid, quoteId: "" })).toBe(false);
  });
});
