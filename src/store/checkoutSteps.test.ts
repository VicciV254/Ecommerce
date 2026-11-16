import { describe, expect, it } from "vitest";
import { checkoutRoute, checkoutSteps, parseCheckoutRoute, type CheckoutStep, type StepFacts } from "./checkoutSteps";

const facts = (overrides: Partial<StepFacts> = {}): StepFacts => ({ placed: false, settling: false, deliveryChosen: false, ...overrides });
const STEPS: (CheckoutStep | null)[] = [null, "delivery", "review", "payment"];

describe("checkout step derivation", () => {
  it("stays on Delivery until an address and method are chosen, whatever step is asked for", () => {
    for (const requested of STEPS) {
      expect(checkoutSteps(facts(), requested)).toEqual({ current: "delivery", reachable: ["delivery"], completed: [] });
    }
  });

  it("shows Review and reserve once delivery is chosen, and lets the shopper go back to Delivery", () => {
    expect(checkoutSteps(facts({ deliveryChosen: true }), null).current).toBe("review");
    expect(checkoutSteps(facts({ deliveryChosen: true }), "review").current).toBe("review");
    expect(checkoutSteps(facts({ deliveryChosen: true }), "delivery")).toEqual({
      current: "delivery", reachable: ["delivery", "review"], completed: ["delivery"],
    });
  });

  it("never shows Payment before a reservation is placed: a requested Payment falls back to the furthest allowed step", () => {
    expect(checkoutSteps(facts({ deliveryChosen: true }), "payment").current).toBe("review");
    expect(checkoutSteps(facts(), "payment").current).toBe("delivery");
  });

  it("keeps an unresolved submission on Review, never Payment, and locks Delivery while it settles", () => {
    for (const requested of STEPS) {
      expect(checkoutSteps(facts({ settling: true, deliveryChosen: true }), requested)).toEqual({
        current: "review", reachable: ["review"], completed: ["delivery"],
      });
    }
    // Settling without a chosen address (for example after the address was deleted) still settles on Review.
    expect(checkoutSteps(facts({ settling: true }), "delivery").current).toBe("review");
  });

  it("moves to Payment once the reservation is placed, with the earlier steps done and locked", () => {
    for (const requested of STEPS) {
      expect(checkoutSteps(facts({ placed: true, deliveryChosen: true }), requested)).toEqual({
        current: "payment", reachable: ["payment"], completed: ["delivery", "review"],
      });
    }
    // A placed order outranks a settling flag and a missing address.
    expect(checkoutSteps(facts({ placed: true, settling: true }), "review").current).toBe("payment");
  });
});

describe("checkout routes", () => {
  it("round-trips each step and names the reserved order only on the payment step", () => {
    expect(checkoutRoute()).toBe("/checkout");
    expect(checkoutRoute("delivery")).toBe("/checkout?step=delivery");
    expect(checkoutRoute("review", "order-1")).toBe("/checkout?step=review");
    expect(checkoutRoute("payment", "order-quote-1")).toBe("/checkout?step=payment&order=order-quote-1");
    expect(parseCheckoutRoute("/checkout?step=payment&order=order-quote-1")).toEqual({ step: "payment", orderId: "order-quote-1", malformedOrder: false });
    expect(parseCheckoutRoute("/checkout?step=review&order=order-quote-1")).toEqual({ step: "review", orderId: null, malformedOrder: false });
    expect(parseCheckoutRoute("/checkout")).toEqual({ step: null, orderId: null, malformedOrder: false });
  });

  it.each([
    "/checkout?step=shipping", "/checkout?step=", "/checkout?step=PAYMENT", "/checkout?step=payment&order=",
    "/checkout?step=payment&order=..%2Fadmin", "/checkout?step=payment&order=a%20b", `/checkout?step=payment&order=${"a".repeat(129)}`,
  ])("ignores what %s cannot mean", (route) => {
    const parsed = parseCheckoutRoute(route);
    expect(parsed.orderId).toBeNull();
    if (!route.includes("step=payment")) expect(parsed.step).toBeNull();
    // An order the payment step names but no order identifier can match is reported, never sent to the server.
    expect(parsed.malformedOrder).toBe(route.includes("step=payment&order="));
  });
});
