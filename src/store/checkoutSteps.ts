/**
 * The checkout's three steps and which of them the current state allows. The step on screen always follows from real
 * state: a step requested by the address (`#/checkout?step=…`) is honoured only while the state allows it, otherwise
 * the furthest allowed step is shown instead.
 */

export type CheckoutStep = "delivery" | "review" | "payment";

export const CHECKOUT_STEPS: readonly CheckoutStep[] = ["delivery", "review", "payment"];

export const STEP_LABELS: Record<CheckoutStep, string> = {
  delivery: "Delivery",
  review: "Review and reserve",
  payment: "Payment",
};

export type StepFacts = {
  /** A reservation is placed: a placed submission, or a durable order of this account named by the address. */
  placed: boolean;
  /** An earlier submission's outcome is still being settled (checking, unresolved, or the same request re-sent). */
  settling: boolean;
  /** An address and a delivery method are chosen, so the cart is quoted (or its own problem is explained). */
  deliveryChosen: boolean;
};

export type StepView = {
  /** The step on screen. */
  current: CheckoutStep;
  /** Steps that can be entered now; the others are shown as text. */
  reachable: readonly CheckoutStep[];
  /** Steps already done; once an order is reserved they can no longer be changed. */
  completed: readonly CheckoutStep[];
};

/** What the state allows, and the step to show for the step `requested` by the address (if any). */
export function checkoutSteps(facts: StepFacts, requested: CheckoutStep | null): StepView {
  let reachable: CheckoutStep[];
  let completed: CheckoutStep[];
  if (facts.placed) {
    // The reservation exists: its delivery and review are settled, and only payment remains.
    reachable = ["payment"];
    completed = ["delivery", "review"];
  } else if (facts.settling) {
    // The stored request is settled (or re-sent with its own key) before anything else, and never shown as payment.
    reachable = ["review"];
    completed = ["delivery"];
  } else if (facts.deliveryChosen) {
    reachable = ["delivery", "review"];
    completed = ["delivery"];
  } else {
    reachable = ["delivery"];
    completed = [];
  }
  const furthest = reachable[reachable.length - 1];
  const current = requested !== null && reachable.includes(requested) ? requested : furthest;
  return { current, reachable, completed };
}

/* ------------------------------------------------------------------ */
/* The checkout's address                                             */
/* ------------------------------------------------------------------ */

const CHECKOUT_PATH = "/checkout";
/** Order identifiers as the API issues them; anything else in the address is ignored. */
export const ORDER_ID = /^[A-Za-z0-9:_-]{1,128}$/;

const isStep = (value: string | null): value is CheckoutStep => CHECKOUT_STEPS.some((step) => step === value);

/** The step and order named by a checkout route; unknown values read as absent, and a malformed order is flagged. */
export function parseCheckoutRoute(route: string): { step: CheckoutStep | null; orderId: string | null; malformedOrder: boolean } {
  const params = new URLSearchParams(route.split("?")[1] ?? "");
  const step = params.get("step");
  const orderId = step === "payment" ? params.get("order") : null;
  const valid = orderId !== null && ORDER_ID.test(orderId);
  return {
    step: isStep(step) ? step : null,
    orderId: valid ? orderId : null,
    // Never sent to the server: it cannot name an order, so it is reported as not found.
    malformedOrder: orderId !== null && !valid,
  };
}

/** The checkout route for `step`; the payment step can name the reserved order, so a reload can show it again. */
export function checkoutRoute(step: CheckoutStep | null = null, orderId: string | null = null) {
  if (step === null) return CHECKOUT_PATH;
  const params = new URLSearchParams({ step });
  if (step === "payment" && orderId !== null && ORDER_ID.test(orderId)) params.set("order", orderId);
  return `${CHECKOUT_PATH}?${params.toString()}`;
}
