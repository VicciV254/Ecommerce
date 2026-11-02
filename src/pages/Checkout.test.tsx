import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../api/auth";
import type { Order, QuoteRequest } from "../api/orders";
import { buildCategoryTree } from "../store/catalogModel";
import type { CatalogValue } from "../store/CatalogContext";
import type { OrderIntent } from "../store/checkoutModel";
import { StoreProvider, useStore, type CartLine } from "../store/StoreContext";
import { fixtureSnapshot, linenShirt, poloShirt } from "../test-support/catalogFixtures";
import {
  fixturePendingOrder,
  fixtureQuote,
  homeAddress,
  linenLine,
  linenPair,
  officeAddress,
  poloLine,
} from "../test-support/checkoutFixtures";
import { fixtureConfirmedAttempt, fixturePaymentOverview } from "../test-support/paymentFixtures";
import { shopperStateKey } from "../utils/storage";
import Cart from "./Cart";
import Checkout from "./Checkout";

const mocks = vi.hoisted(() => ({
  user: null as User | null,
  catalog: null as CatalogValue | null,
  orders: { createQuote: vi.fn(), getQuote: vi.fn(), placeOrder: vi.fn(), getOrder: vi.fn() },
  payments: { getOverview: vi.fn(), requestPrompt: vi.fn(), checkAttempt: vi.fn() },
}));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../store/CatalogContext", () => ({ useCatalog: () => mocks.catalog }));
vi.mock("../api/orders", async (importOriginal) => ({ ...await importOriginal<typeof import("../api/orders")>(), checkoutAPI: mocks.orders }));
vi.mock("../api/mpesa", () => ({ paymentsAPI: mocks.payments, staffPaymentsAPI: {} }));

const WAIT = { timeout: 3000 };
const customerA: User = { id: "customer-a", email: "a@example.test", firstName: "Ada", lastName: "Customer", addresses: [homeAddress, officeAddress] };
const customerB: User = { id: "customer-b", email: "b@example.test", firstName: "Ben", lastName: "Customer", addresses: [officeAddress] };
const linen: CartLine = { productId: linenShirt.id, variantId: "var-linen-m-white", quantity: 1 };
const polo: CartLine = { productId: poloShirt.id, variantId: "var-polo", quantity: 1 };
const linenTwo = fixtureQuote({ id: "quote-two", ...linenPair });
const poloQuote = fixtureQuote({
  id: "quote-b", address: { id: officeAddress.id, street: officeAddress.street, city: officeAddress.city, county: officeAddress.county, postalCode: null },
  lines: [poloLine], subtotal: 2200, discount: 0, discountedSubtotal: 2200, tax: 352, total: 2752,
});

let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return null;
}
const tree = (page: ReactNode) => <StoreProvider><Probe />{page}</StoreProvider>;
const stored = (owner: string) => JSON.parse(localStorage.getItem(shopperStateKey(owner)) ?? "null");
/** Persistence is a passive effect, so after an asynchronous outcome wait for the saved state. */
const persisted = (owner: string, expected: Record<string, unknown>) =>
  waitFor(() => expect(stored(owner)).toMatchObject(expected), WAIT);
const seed = (owner: string, cart: CartLine[], extra: Record<string, unknown> = {}) =>
  localStorage.setItem(shopperStateKey(owner), JSON.stringify({ cart, wishlist: [], ...extra }));

function apiError(status: number | undefined, data: unknown = {}) {
  const config = { headers: new AxiosHeaders() };
  const response = status === undefined ? undefined : { status, statusText: String(status), data, headers: new AxiosHeaders(), config };
  return new AxiosError("Request failed", status === undefined ? "ERR_NETWORK" : "ERR_BAD_REQUEST", config, undefined, response);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function reserveButton() {
  const button = await screen.findByRole("button", { name: "Reserve Order" }, WAIT);
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false), WAIT);
  return button;
}

/** Orders the payment service knows; each is served with payments switched off unless a test says otherwise. */
const paymentOrders = new Map<string, Order>();
const servePayments = (...orders: Order[]) => { for (const placed of orders) paymentOrders.set(placed.id, placed); };

beforeEach(() => {
  mocks.user = customerA;
  const snapshot = fixtureSnapshot({ mode: "live" });
  mocks.catalog = {
    status: "ready", error: null, mode: "live", products: snapshot.products,
    productsById: new Map(snapshot.products.map((product) => [product.id, product])),
    categories: buildCategoryTree(snapshot.categories), designers: [], discounts: [], reload: vi.fn(),
  };
  for (const fn of [...Object.values(mocks.orders), ...Object.values(mocks.payments)]) fn.mockReset();
  mocks.orders.createQuote.mockResolvedValue({ data: fixtureQuote() });
  paymentOrders.clear();
  servePayments(fixturePendingOrder(fixtureQuote()), fixturePendingOrder(poloQuote));
  mocks.payments.getOverview.mockImplementation(async (orderId: string) => {
    const placed = paymentOrders.get(orderId);
    if (!placed) throw apiError(404, { code: "ORDER_NOT_FOUND", error: "Order not found." });
    return { data: fixturePaymentOverview(placed) };
  });
});

describe("checkout reservation", () => {
  it("stores the request before sending it and removes only the ordered units once the server confirms", async () => {
    seed("customer-a", [linen]);
    const placed = deferred<{ data: unknown }>();
    mocks.orders.placeOrder.mockReturnValue(placed.promise);
    render(tree(<Checkout />));
    const reserve = await reserveButton();
    const summary = screen.getByRole("region", { name: "Order Total" });
    expect(within(summary).getByText("VAT (16%)")).toBeTruthy();
    expect(within(summary).getByText("KES 144")).toBeTruthy();
    expect(within(summary).getByText("KES 1,244")).toBeTruthy();
    expect(mocks.orders.createQuote).toHaveBeenLastCalledWith({
      items: [linen], addressId: homeAddress.id, deliveryMethod: "STANDARD", couponCode: null, notes: null,
    });

    fireEvent.click(reserve);
    expect(mocks.orders.placeOrder).toHaveBeenCalledTimes(1);
    const [quoteId, key] = mocks.orders.placeOrder.mock.calls[0];
    expect(quoteId).toBe("quote-1");
    expect(stored("customer-a").pendingOrder).toMatchObject({ quoteId: "quote-1", idempotencyKey: key, total: 1244 });
    const sending = screen.getByRole("button", { name: "Reserving…" });
    expect(sending.hasAttribute("disabled")).toBe(true);
    fireEvent.click(sending);
    expect(mocks.orders.placeOrder).toHaveBeenCalledTimes(1);

    // The customer keeps shopping while the request is in flight.
    act(() => store.addToCart(polo));
    act(() => store.setQuantity(0, 2));
    await act(async () => placed.resolve({ data: fixturePendingOrder(fixtureQuote()) }));

    expect(await screen.findByRole("heading", { name: "Order reserved" }, WAIT)).toBeTruthy();
    expect(screen.getByText("APX-QUOTE-1")).toBeTruthy();
    expect(screen.getByText("Pending · not paid")).toBeTruthy();
    expect(screen.getByText("Items held until")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View or cancel in your orders" }).getAttribute("href")).toBe("#/account/orders");
    await persisted("customer-a", { cart: [linen, polo], pendingOrder: null, acknowledgedOrderIds: ["order-quote-1"] });
    expect(screen.getByText("Your cart still has 2 items that were not part of this order.")).toBeTruthy();
    // Payments are switched off here: that is shown safely and nothing is requested without the customer.
    expect(await screen.findByText("M-Pesa payment unavailable", undefined, WAIT)).toBeTruthy();
    expect(mocks.payments.getOverview).toHaveBeenCalledWith("order-quote-1");
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull();
    expect(mocks.payments.requestPrompt).not.toHaveBeenCalled();
    expect(screen.getByText("Pending · not paid")).toBeTruthy();
  });

  it("updates the reservation summary when the payment service reports the order paid", async () => {
    seed("customer-a", [linen]);
    const placed = fixturePendingOrder(fixtureQuote());
    mocks.orders.placeOrder.mockResolvedValue({ data: placed });
    const paid = { ...placed, paymentStatus: "PAID" as const, reservationStatus: "COMMITTED" as const, reservationExpiresAt: null };
    mocks.payments.getOverview.mockResolvedValue({ data: fixturePaymentOverview(paid, {
      environment: "production", reasonCode: "ORDER_NOT_PAYABLE", message: "This order is not awaiting payment on an active reservation.",
      attempts: [fixtureConfirmedAttempt(placed)],
    }) });
    render(tree(<Checkout />));
    fireEvent.click(await reserveButton());

    expect(await screen.findByRole("heading", { name: "Order reserved" }, WAIT)).toBeTruthy();
    expect(await screen.findByText("Payment received", undefined, WAIT)).toBeTruthy();
    expect(screen.getByText("Payment confirmed")).toBeTruthy();
    expect(screen.getByText("SBX1234567")).toBeTruthy();
    expect(screen.queryByText("Pending · not paid")).toBeNull();
    expect(screen.queryByText(/No payment has been taken/)).toBeNull();
    expect(screen.queryByText("Items held until")).toBeNull();
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull();
    expect(mocks.payments.requestPrompt).not.toHaveBeenCalled();
  });

  it("does not claim no money was taken when received funds still need order attribution review", async () => {
    seed("customer-a", [linen]);
    const placed = fixturePendingOrder(fixtureQuote());
    mocks.orders.placeOrder.mockResolvedValue({ data: placed });
    mocks.payments.getOverview.mockResolvedValue({ data: fixturePaymentOverview(placed, {
      environment: "production", reasonCode: "PAYMENT_EXISTS", message: "Staff review is required",
      attempts: [fixtureConfirmedAttempt(placed, { status: "REVIEW", reviewRequired: true, reasonCode: "ORDER_AMOUNT_CHANGED" })],
    }) });
    render(tree(<Checkout />));
    fireEvent.click(await reserveButton());
    expect(await screen.findByText("Payment received: staff review needed", undefined, WAIT)).toBeTruthy();
    expect(screen.getByText(/Payment has not been confirmed for this order yet/)).toBeTruthy();
    expect(screen.queryByText(/No payment has been taken/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Send.*M-Pesa/ })).toBeNull();
    expect(mocks.payments.requestPrompt).not.toHaveBeenCalled();
  });

  it("keeps the same request key after a lost response and finishes with one order", async () => {
    seed("customer-a", [linen]);
    mocks.orders.placeOrder.mockRejectedValueOnce(apiError(undefined));
    mocks.orders.getQuote.mockResolvedValue({ data: fixtureQuote() });
    render(tree(<Checkout />));
    fireEvent.click(await reserveButton());

    expect(await screen.findByRole("heading", { name: "Finishing your earlier order request" }, WAIT)).toBeTruthy();
    expect(await screen.findByText(/Retry it to complete that same order; it cannot create a second one\./, undefined, WAIT)).toBeTruthy();
    expect(mocks.orders.getQuote).toHaveBeenCalledWith("quote-1");
    const key = mocks.orders.placeOrder.mock.calls[0][1];
    expect(stored("customer-a").pendingOrder.idempotencyKey).toBe(key);
    expect(screen.queryByRole("button", { name: "Reserve Order" })).toBeNull();

    mocks.orders.placeOrder.mockResolvedValueOnce({ data: fixturePendingOrder(fixtureQuote()) });
    fireEvent.click(screen.getByRole("button", { name: "Retry the same request" }));
    expect(await screen.findByRole("heading", { name: "Order reserved" }, WAIT)).toBeTruthy();
    expect(mocks.orders.placeOrder.mock.calls).toEqual([["quote-1", key], ["quote-1", key]]);
    await persisted("customer-a", { cart: [], pendingOrder: null, acknowledgedOrderIds: ["order-quote-1"] });
  });

  it("settles a stored request after a reload from the server's record instead of sending it again", async () => {
    const intent: OrderIntent = {
      quoteId: "quote-1", idempotencyKey: "reload-key-0123456789", signature: "reviewed", total: 1244, createdAt: new Date().toISOString(),
    };
    seed("customer-a", [{ ...linen, quantity: 2 }], { pendingOrder: intent });
    mocks.orders.getQuote.mockResolvedValue({ data: fixtureQuote({ consumed: true, orderId: "order-quote-1" }) });
    mocks.orders.getOrder.mockResolvedValue({ data: fixturePendingOrder(fixtureQuote()) });
    render(tree(<Checkout />));

    expect(await screen.findByRole("heading", { name: "Order reserved" }, WAIT)).toBeTruthy();
    expect(mocks.orders.getOrder).toHaveBeenCalledWith("order-quote-1");
    expect(mocks.orders.placeOrder).not.toHaveBeenCalled();
    expect(mocks.orders.createQuote).not.toHaveBeenCalled();
    await persisted("customer-a", { cart: [linen], pendingOrder: null, acknowledgedOrderIds: ["order-quote-1"] });
  });

  it("keeps the cart when the earlier order's hold already expired and explains why", async () => {
    const intent: OrderIntent = {
      quoteId: "quote-1", idempotencyKey: "expired-key-0123456789", signature: "reviewed", total: 1244, createdAt: new Date().toISOString(),
    };
    seed("customer-a", [linen], { pendingOrder: intent });
    mocks.orders.getQuote.mockResolvedValue({ data: fixtureQuote({ consumed: true, orderId: "order-quote-1" }) });
    mocks.orders.getOrder.mockResolvedValue({
      data: fixturePendingOrder(fixtureQuote(), { status: "CANCELLED", reservationStatus: "EXPIRED" }),
    });
    render(tree(<Checkout />));

    expect(await screen.findByText("Order APX-QUOTE-1 is no longer reserved", undefined, WAIT)).toBeTruthy();
    expect(screen.getByText(/Its reservation expired before payment/)).toBeTruthy();
    await persisted("customer-a", { cart: [linen], pendingOrder: null, acknowledgedOrderIds: [] });
    await reserveButton();
  });

  it("requires explicit review of a changed total before reserving again with a new key", async () => {
    seed("customer-a", [linen]);
    const changed = fixtureQuote({
      id: "quote-2", lines: [{ ...linenLine, unitPrice: 1000, total: 1000, discount: 0, discountId: null }],
      discount: 0, discountedSubtotal: 1000, tax: 160, total: 1360,
    });
    mocks.orders.createQuote.mockResolvedValueOnce({ data: fixtureQuote() }).mockResolvedValue({ data: changed });
    servePayments(fixturePendingOrder(changed));
    mocks.orders.placeOrder.mockRejectedValueOnce(apiError(409, {
      error: "Prices, delivery or the address changed. Request and review a new quote.", code: "QUOTE_CHANGED",
    }));
    render(tree(<Checkout />));
    fireEvent.click(await reserveButton());

    expect(await screen.findByText(/Your total changed from KES 1,244 to KES 1,360\./, undefined, WAIT)).toBeTruthy();
    expect(screen.getByText("Prices, delivery or your address changed since you reviewed this order. Nothing was reserved.")).toBeTruthy();
    const reserve = screen.getByRole("button", { name: "Reserve Order" });
    expect(reserve.hasAttribute("disabled")).toBe(true);
    await persisted("customer-a", { pendingOrder: null });

    fireEvent.click(screen.getByRole("button", { name: "I Have Reviewed the New Total" }));
    expect(reserve.hasAttribute("disabled")).toBe(false);
    mocks.orders.placeOrder.mockResolvedValueOnce({ data: fixturePendingOrder(changed) });
    fireEvent.click(reserve);
    expect(await screen.findByRole("heading", { name: "Order reserved" }, WAIT)).toBeTruthy();
    const [[firstQuote, firstKey], [secondQuote, secondKey]] = mocks.orders.placeOrder.mock.calls;
    expect([firstQuote, secondQuote]).toEqual(["quote-1", "quote-2"]);
    expect(secondKey).not.toBe(firstKey);
  });

  it("does not ask again after the customer reviewed a changed total and prices refresh unchanged", async () => {
    seed("customer-a", [linen]);
    const repriced = {
      lines: [{ ...linenLine, unitPrice: 1000, total: 1000, discount: 0, discountId: null }],
      discount: 0, discountedSubtotal: 1000, tax: 160, total: 1360,
    };
    let calls = 0;
    mocks.orders.createQuote.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ data: fixtureQuote() });
      // The reviewed replacement expires quickly; its refresh charges the same.
      const expiresAt = new Date(Date.now() + (calls === 2 ? 600 : 600_000)).toISOString();
      return Promise.resolve({ data: fixtureQuote({ id: `quote-${calls}`, ...repriced, expiresAt }) });
    });
    mocks.orders.placeOrder.mockRejectedValueOnce(apiError(409, { error: "Changed", code: "QUOTE_CHANGED" }));
    render(tree(<Checkout />));
    fireEvent.click(await reserveButton());
    fireEvent.click(await screen.findByRole("button", { name: "I Have Reviewed the New Total" }, WAIT));

    fireEvent.click(await screen.findByRole("button", { name: "Refresh prices" }, WAIT));
    await waitFor(() => expect(calls).toBe(3), WAIT);
    await reserveButton();
    expect(screen.queryByText("Review the updated total")).toBeNull();
  });

  it("keeps an inconsistent used quote unresolved instead of concluding nothing was reserved", async () => {
    const intent: OrderIntent = {
      quoteId: "quote-1", idempotencyKey: "inconsistent-key-0123", signature: "reviewed", total: 1244, createdAt: new Date().toISOString(),
    };
    seed("customer-a", [linen], { pendingOrder: intent });
    mocks.orders.getQuote.mockResolvedValue({ data: fixtureQuote({ consumed: true, expired: true, orderId: null }) });
    render(tree(<Checkout />));
    expect(await screen.findByText(/We could not check your earlier order request/, undefined, WAIT)).toBeTruthy();
    expect(stored("customer-a").pendingOrder).toEqual(intent);
    expect(mocks.orders.createQuote).not.toHaveBeenCalled();
  });

  it("never shows a quote that answers an older cart", async () => {
    seed("customer-a", [linen]);
    const slow = deferred<{ data: unknown }>();
    mocks.orders.createQuote.mockImplementation((request: QuoteRequest) =>
      request.items[0].quantity === 1 ? slow.promise : Promise.resolve({ data: linenTwo }));
    render(tree(<Checkout />));
    await waitFor(() => expect(mocks.orders.createQuote).toHaveBeenCalledTimes(1), WAIT);

    act(() => store.setQuantity(0, 2));
    const summary = screen.getByRole("region", { name: "Order Total" });
    expect(await within(summary).findByText("KES 2,288", undefined, WAIT)).toBeTruthy();
    await act(async () => slow.resolve({ data: fixtureQuote() }));
    expect(within(summary).queryByText("KES 1,244")).toBeNull();
    expect(within(summary).getByText("KES 2,288")).toBeTruthy();
  });

  it("explains that ordering is unavailable and offers no reservation when the server has it switched off", async () => {
    seed("customer-a", [linen]);
    mocks.orders.createQuote.mockResolvedValue({ data: fixtureQuote({ reservationsEnabled: false }) });
    render(tree(<Checkout />));
    expect(await screen.findByRole("heading", { name: "Ordering is not available yet" }, WAIT)).toBeTruthy();
    expect(screen.getByText(/nothing has been reserved or charged. Your cart is unchanged./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Reserve/ })).toBeNull();
    expect(mocks.orders.placeOrder).not.toHaveBeenCalled();
    expect(stored("customer-a").cart).toEqual([linen]);
  });

  it("never quotes or reserves the previous account's basket after the customer changes", async () => {
    seed("customer-a", [linen]);
    seed("customer-b", [polo]);
    mocks.orders.createQuote.mockImplementation((request: QuoteRequest) =>
      Promise.resolve({ data: request.addressId === homeAddress.id ? fixtureQuote() : poloQuote }));
    const view = render(tree(<Checkout />));
    await reserveButton();
    const before = mocks.orders.createQuote.mock.calls.length;

    mocks.user = customerB;
    view.rerender(tree(<Checkout />));
    const summary = await screen.findByRole("region", { name: "Order Total" }, WAIT);
    expect(await within(summary).findByText("KES 2,752", undefined, WAIT)).toBeTruthy();
    for (const [request] of mocks.orders.createQuote.mock.calls.slice(before)) {
      expect(request).toEqual({ items: [polo], addressId: officeAddress.id, deliveryMethod: "STANDARD", couponCode: null, notes: null });
    }
    mocks.orders.placeOrder.mockResolvedValue({ data: fixturePendingOrder(poloQuote) });
    fireEvent.click(await reserveButton());
    expect(await screen.findByRole("heading", { name: "Order reserved" }, WAIT)).toBeTruthy();
    expect(mocks.orders.placeOrder).toHaveBeenCalledWith("quote-b", expect.any(String));
    await persisted("customer-b", { cart: [], acknowledgedOrderIds: ["order-quote-b"] });
    expect(stored("customer-a")).toMatchObject({ cart: [linen], pendingOrder: null });
  });
});

describe("cart quote", () => {
  it("shows server line totals, savings, VAT and delivery for the chosen delivery method", async () => {
    seed("customer-a", [linen]);
    mocks.orders.createQuote.mockImplementation((request: QuoteRequest) => Promise.resolve({
      data: request.deliveryMethod === "SAME_DAY" ? fixtureQuote({ id: "quote-same-day", deliveryMethod: "SAME_DAY", shippingCost: 500, total: 1544 }) : fixtureQuote(),
    }));
    render(tree(<Cart />));
    const summary = screen.getByRole("region", { name: "Order Summary" });
    expect(await within(summary).findByText("KES 1,244", undefined, WAIT)).toBeTruthy();
    expect(within(summary).getByText("−KES 100")).toBeTruthy();
    expect(within(summary).getByText("VAT (16%)")).toBeTruthy();
    expect(within(summary).getByText("KES 200")).toBeTruthy();
    const line = screen.getByRole("link", { name: "Linen Short-Sleeve Shirt" }).closest("li")!;
    expect(within(line).getByText("KES 900")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Continue to Checkout" }).getAttribute("href")).toBe("#/checkout");

    fireEvent.click(within(summary).getByRole("radio", { name: "Same-day delivery" }));
    expect(await within(summary).findByText("KES 1,544", undefined, WAIT)).toBeTruthy();
    expect(within(summary).getByText("KES 500")).toBeTruthy();
    expect(stored("customer-a").checkout).toEqual({ addressId: null, deliveryMethod: "SAME_DAY" });
  });

  it("carries the coupon from the cart into the checkout quote", async () => {
    seed("customer-a", [linen]);
    const message = "Existing offers provide an equal or better saving; discounts are not stacked.";
    mocks.orders.createQuote.mockImplementation((request: QuoteRequest) => Promise.resolve({
      data: request.couponCode === "SAVE10" ? fixtureQuote({ id: "quote-coupon", couponCode: "SAVE10", couponMessage: message }) : fixtureQuote(),
    }));
    const cart = render(tree(<Cart />));
    await screen.findByText("KES 1,244", undefined, WAIT);
    fireEvent.change(screen.getByLabelText("Coupon code (optional)"), { target: { value: " save10 " } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(stored("customer-a").couponCode).toBe("SAVE10");
    expect(await screen.findByText(message, undefined, WAIT)).toBeTruthy();
    cart.unmount();

    render(tree(<Checkout />));
    await reserveButton();
    expect(mocks.orders.createQuote).toHaveBeenLastCalledWith(expect.objectContaining({ couponCode: "SAVE10" }));
    expect(screen.getByText("SAVE10")).toBeTruthy();
    expect(screen.getByText(message)).toBeTruthy();
  });

  it("keeps an invalid coupon visible with its reason until the customer removes it", async () => {
    seed("customer-a", [linen], { couponCode: "EXPIRED10" });
    mocks.orders.createQuote.mockImplementation((request: QuoteRequest) => request.couponCode
      ? Promise.reject(apiError(400, { error: "Coupon is expired or does not apply to these items", code: "COUPON_INVALID" }))
      : Promise.resolve({ data: fixtureQuote() }));
    render(tree(<Cart />));
    expect(await screen.findByText("Coupon is expired or does not apply to these items", undefined, WAIT)).toBeTruthy();
    expect(screen.getByText("Your total can't be calculated until the highlighted choice is changed.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue to Checkout" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Remove coupon EXPIRED10" }));
    expect(await screen.findByText("KES 1,244", undefined, WAIT)).toBeTruthy();
    expect(stored("customer-a").couponCode).toBeNull();
  });

  it("does not quote a cart with an unavailable line and keeps it editable", async () => {
    seed("customer-a", [linen, { productId: "prod-retired", variantId: "var-retired", quantity: 1 }]);
    render(tree(<Cart />));
    expect(await screen.findByText("Remove unavailable items to see your total.")).toBeTruthy();
    expect(mocks.orders.createQuote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("KES 1,244", undefined, WAIT)).toBeTruthy();
  });
});
