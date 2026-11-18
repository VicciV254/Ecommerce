import type { BrowserContext, Route } from "@playwright/test";
import type { CatalogSnapshot } from "../../src/api/catalog";
import type { ActorType, CustomerOrder, DemonstrationOrderStep, OrderFulfilment, OrderStatus, ReturnReason, TrackingEvent } from "../../src/api/orders";
import { fixturePendingOrder } from "../../src/test-support/checkoutFixtures";
import { fixtureCustomerOrder, fixtureDeliveredOrder, fixtureRefund, fixtureReturn } from "../../src/test-support/orderFixtures";
import { PAYMENT_MESSAGES, fixtureDemonstrationOverview, fixturePaymentOverview } from "../../src/test-support/paymentFixtures";
import { CUSTOMER_TOKEN, browserQuote, orderPage, publicSnapshot } from "./fixtures";

/** A demonstration store's public catalog: every product is a sample, and sample orders are on. */
export const demonstrationSnapshot: CatalogSnapshot = {
  ...publicSnapshot, demonstrationOrders: true, products: publicSnapshot.products.map((product) => ({ ...product, isDemo: true })),
};

/** The server's quote for one sample linen shirt (`linenCartLine`). */
export const sampleQuote = browserQuote({ id: "quote-sample", mode: "demo" });

/** A merchant-fault return of the whole order refunds the delivery fee too (the fixture policy). */
const RETURN_REFUND = sampleQuote.total;

/** One request a demonstration control or the customer sent, by its path below the order. */
export type SentStep = { step: string; body: unknown };

/** Delivery steps; the sample order is delivered, so the pickup steps never apply. */
type OrderStep = Exclude<DemonstrationOrderStep, "MARK_READY_FOR_PICKUP" | "CONFIRM_PICKUP">;
const ORDER_STEPS: Record<OrderStep, { to: OrderStatus; stamp: keyof OrderFulfilment; description: string }> = {
  START_PROCESSING: { to: "PROCESSING", stamp: "processingAt", description: "Order accepted and being prepared" },
  DISPATCH: { to: "SHIPPED", stamp: "shippedAt", description: "Dispatched for delivery" },
  CONFIRM_DELIVERY: { to: "DELIVERED", stamp: "deliveredAt", description: "Delivered" },
};
const NEXT_STEP: Partial<Record<OrderStatus, OrderStep>> = { PENDING: "START_PROCESSING", PROCESSING: "DISPATCH", SHIPPED: "CONFIRM_DELIVERY" };

/**
 * One sample order on a demonstration store, from checkout to a recorded refund, answered as the API does (wording from
 * the backend's services). A control is accepted only with the status the order view listed (otherwise 409
 * `ORDER_CHANGED`), and each answer lists exactly the next step. `requests` keeps every write, in order.
 */
export async function serveDemonstrationStore(context: BrowserContext) {
  const requests: SentStep[] = [];
  let order: CustomerOrder | null = null;
  let eventCount = 0;
  const now = () => new Date().toISOString();
  const event = (status: OrderStatus, description: string, actorType: ActorType = "DEMONSTRATION"): TrackingEvent => ({
    id: `event-${(eventCount += 1)}`, status, description, createdAt: now(), actorType,
    location: actorType === "DEMONSTRATION" ? "Demonstration" : "Customer self-service",
  });
  const record = (current: CustomerOrder, changes: Partial<CustomerOrder>, ...events: TrackingEvent[]): CustomerOrder =>
    (order = { ...current, ...changes, trackingHistory: [...current.trackingHistory, ...events] });

  const pay = (current: CustomerOrder) => record(current, {
    paymentStatus: "PAID", paymentMethod: "DEMONSTRATION", reservationStatus: "COMMITTED", reservationExpiresAt: null,
    demonstrationActions: [{ action: "START_PROCESSING", expectedStatus: "PENDING" }],
  }, event("PENDING", "Demonstration payment recorded; no money was taken. Awaiting fulfilment."));

  const moveOn = (current: CustomerOrder, action: OrderStep) => {
    const { to, stamp, description } = ORDER_STEPS[action];
    const next = NEXT_STEP[to];
    const fulfilment = { ...current.fulfilment, [stamp]: now() };
    const stepped = { ...current, status: to, fulfilment, demonstrationActions: next ? [{ action: next, expectedStatus: to }] : [] };
    // Delivery opens the return window, as the server's eligibility reports it.
    const changes = to === "DELIVERED"
      ? { ...fixtureDeliveredOrder(stepped, { deliveredAt: fulfilment.deliveredAt ?? now() }), fulfilment, trackingHistory: current.trackingHistory }
      : { ...stepped, customerActions: to === "PROCESSING" ? current.customerActions : [] };
    return record(current, changes, event(to, description));
  };

  const requestReturn = (current: CustomerOrder, reason: ReturnReason) => {
    const created = fixtureReturn(current, { id: "return-sample", number: `RMA-${current.orderNumber}-1`, reason });
    const lines = current.returnEligibility.lines.map((line) => ({ ...line, requested: line.purchased, returnableQuantity: 0 }));
    const updated = record(current, {
      returns: [created], customerActions: [],
      returnEligibility: { ...current.returnEligibility, eligible: false, reasonCode: "NOTHING_RETURNABLE", lines },
      demonstrationActions: [{ action: "APPROVE", returnId: created.id, expectedStatus: "REQUESTED" }],
    }, event("DELIVERED", `Return ${created.number} requested; awaiting review.`, "CUSTOMER"));
    return { returnRequest: created, order: updated };
  };

  const approve = (current: CustomerOrder) => {
    const [request] = current.returns;
    return record(current, {
      returns: [{ ...request, status: "APPROVED", decidedAt: now() }],
      demonstrationActions: [{ action: "RECEIVE", returnId: request.id, expectedStatus: "APPROVED" }],
    }, event("DELIVERED", `Return ${request.number} approved in the demonstration.`));
  };

  const receive = (current: CustomerOrder) => {
    const [request] = current.returns;
    const refund = fixtureRefund({
      id: "refund-sample", number: `RF-${current.orderNumber}-1`, method: "DEMONSTRATION", source: "RETURN", amount: RETURN_REFUND,
      includesDeliveryFee: true, requestedAt: now(),
    });
    const lines = request.lines.map((line) => ({ ...line, receivedQuantity: line.quantity, refundableQuantity: line.quantity }));
    return record(current, {
      returns: [{ ...request, status: "RECEIVED", receivedAt: now(), merchantFaultConfirmed: true, lines }], refunds: [refund],
      demonstrationActions: [{ action: "COMPLETE_REFUND", refundId: refund.id, expectedStatus: "REQUESTED" }],
    },
    event("DELIVERED", `Demonstration refund ${refund.number} of KES 1,244 requested; no money will be sent.`),
    event("DELIVERED", `Return ${request.number} marked as received in the demonstration; refund of KES 1,244 requested.`));
  };

  const completeRefund = (current: CustomerOrder) => {
    const [refund] = current.refunds;
    return record(current, {
      paymentStatus: "REFUNDED", refunds: [{ ...refund, status: "CONFIRMED", approvedAt: now(), confirmedAt: now() }], demonstrationActions: [],
    }, event("DELIVERED", `Demonstration refund ${refund.number} of KES 1,244 recorded; no money was sent.`));
  };

  const overview = (current: CustomerOrder) => (current.paymentStatus === "PENDING"
    ? fixtureDemonstrationOverview(current)
    : fixturePaymentOverview({ ...current, isDemo: true }, {
      environment: "sandbox", reasonCode: "ORDER_NOT_PAYABLE", message: PAYMENT_MESSAGES.notPayable,
      demonstration: { available: false, reasonCode: "ORDER_NOT_PAYABLE" },
    }));

  /** The listed step with this action, or `null`: anything else is refused as the server would. */
  const listed = (current: CustomerOrder, action: string, expectedStatus: unknown) =>
    current.demonstrationActions.find((item) => item.action === action && item.expectedStatus === expectedStatus) ?? null;
  const changed = (route: Route) =>
    route.fulfill({ status: 409, json: { error: "This order changed since it was loaded. Reload it and try again.", code: "ORDER_CHANGED" } });

  async function answerOrderWrite(route: Route, current: CustomerOrder, step: string, body: { action?: string; expectedStatus?: unknown; reason?: ReturnReason }) {
    if (step === "/demonstration-payment") return route.fulfill({ json: current.paymentStatus === "PENDING" ? pay(current) : current });
    if (step === "/returns") return route.fulfill({ status: 201, json: requestReturn(current, body.reason ?? "OTHER") });
    if (step === "/demonstration-actions") {
      const action = body.action as OrderStep;
      return listed(current, action, body.expectedStatus) ? route.fulfill({ json: moveOn(current, action) }) : changed(route);
    }
    const [request] = current.returns;
    const [refund] = current.refunds;
    if (request && step === `/returns/${request.id}/demonstration-approve`) {
      return listed(current, "APPROVE", body.expectedStatus) ? route.fulfill({ json: approve(current) }) : changed(route);
    }
    if (request && step === `/returns/${request.id}/demonstration-receive`) {
      return listed(current, "RECEIVE", body.expectedStatus) ? route.fulfill({ json: receive(current) }) : changed(route);
    }
    if (refund && step === `/refunds/${refund.id}/demonstration-complete`) {
      return listed(current, "COMPLETE_REFUND", body.expectedStatus) ? route.fulfill({ json: completeRefund(current) }) : changed(route);
    }
    return route.fulfill({ status: 404, json: { error: "Order not found", code: "ORDER_NOT_FOUND" } });
  }

  await context.route((url) => url.pathname === "/api/catalog", (route) => route.fulfill({ json: demonstrationSnapshot }));
  await context.route((url) => url.pathname.startsWith("/api/orders") || url.pathname.startsWith("/api/mpesa/orders/"), async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    // Staff reads and public tracking are served elsewhere.
    if (pathname.startsWith("/api/orders/admin/") || pathname.startsWith("/api/orders/track/")) return route.fallback();
    if (request.headers().authorization !== `Bearer ${CUSTOMER_TOKEN}`) return route.fulfill({ status: 401, json: { error: "Invalid token" } });
    if (pathname === "/api/orders/quotes" && request.method() === "POST") return route.fulfill({ status: 201, json: sampleQuote });
    if (pathname === "/api/orders" && request.method() === "POST") {
      order = fixtureCustomerOrder(fixturePendingOrder(sampleQuote, { isDemo: true }));
      return route.fulfill({ status: 201, json: order });
    }
    if (pathname === "/api/orders" && request.method() === "GET") return route.fulfill({ json: orderPage(order ? [order] : []) });
    if (!order) return route.fulfill({ status: 404, json: { error: "Order not found", code: "ORDER_NOT_FOUND" } });
    if (pathname === `/api/mpesa/orders/${order.id}/payments` && request.method() === "GET") return route.fulfill({ json: overview(order) });
    const base = `/api/orders/${order.id}`;
    if (pathname === base && request.method() === "GET") return route.fulfill({ json: order });
    if (!pathname.startsWith(base) || request.method() !== "POST") return route.fallback();
    const step = pathname.slice(base.length);
    const body = request.postDataJSON() ?? {};
    requests.push({ step, body });
    return answerOrderWrite(route, order, step, body);
  });
  return { requests, current: () => order };
}
