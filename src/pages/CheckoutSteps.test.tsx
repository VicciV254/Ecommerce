import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, User } from "../api/auth";
import { buildCategoryTree } from "../store/catalogModel";
import type { CatalogValue } from "../store/CatalogContext";
import { StoreProvider, type CartLine } from "../store/StoreContext";
import { fixtureSnapshot, linenShirt } from "../test-support/catalogFixtures";
import { fixturePendingOrder, fixtureQuote, homeAddress } from "../test-support/checkoutFixtures";
import { fixturePaymentOverview } from "../test-support/paymentFixtures";
import { STORAGE_KEYS, shopperStateKey } from "../utils/storage";
import Checkout from "./Checkout";

/** A signed-in account whose saved addresses change when one is added, as AuthProvider's state does. */
const auth = vi.hoisted(() => {
  let state: { user: User | null } = { user: null };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(user: User | null) {
      state = { user };
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    addAddress: vi.fn(),
  };
});
const mocks = vi.hoisted(() => ({
  catalog: null as CatalogValue | null,
  orders: { createQuote: vi.fn(), getQuote: vi.fn(), placeOrder: vi.fn(), getOrder: vi.fn() },
  payments: { getOverview: vi.fn(), requestPrompt: vi.fn(), checkAttempt: vi.fn() },
}));
vi.mock("../contexts/AuthContext", async () => {
  const { useSyncExternalStore } = await import("react");
  return { useAuth: () => ({ ...useSyncExternalStore(auth.subscribe, auth.get), addAddress: auth.addAddress }) };
});
vi.mock("../store/CatalogContext", () => ({ useCatalog: () => mocks.catalog }));
vi.mock("../store/StorefrontContext", () => ({ useStorefront: () => ({ brandName: "Apex Cart", storefront: null, mediaById: new Map() }) }));
vi.mock("../api/orders", async (importOriginal) => ({ ...await importOriginal<typeof import("../api/orders")>(), checkoutAPI: mocks.orders }));
vi.mock("../api/mpesa", () => ({ paymentsAPI: mocks.payments, staffPaymentsAPI: {} }));

const WAIT = { timeout: 3000 };
const newcomer: User = { id: "customer-new", email: "new@example.test", firstName: "Nia", lastName: "Shopper", addresses: [] };
const returning: User = { ...newcomer, id: "customer-back", addresses: [homeAddress] };
const linen: CartLine = { productId: linenShirt.id, variantId: "var-linen-m-white", quantity: 1 };
const placed = fixturePendingOrder(fixtureQuote());

const seed = (owner: string, cart: CartLine[]) =>
  localStorage.setItem(shopperStateKey(owner), JSON.stringify({ cart, wishlist: [] }));
const page = () => <StoreProvider><Checkout /></StoreProvider>;
const steps = () => within(screen.getByRole("navigation", { name: "Checkout steps" })).getAllByRole("listitem");
const summary = () => screen.getByRole("region", { name: "Order summary" });

function apiError(status: number | undefined, data: unknown = {}) {
  const config = { headers: new AxiosHeaders() };
  const response = status === undefined ? undefined : { status, statusText: String(status), data, headers: new AxiosHeaders(), config };
  return new AxiosError("Request failed", status === undefined ? "ERR_NETWORK" : "ERR_BAD_REQUEST", config, undefined, response);
}

beforeEach(() => {
  window.history.replaceState(null, "", "#/checkout");
  const snapshot = fixtureSnapshot({ mode: "live" });
  mocks.catalog = {
    status: "ready", error: null, mode: "live", products: snapshot.products,
    productsById: new Map(snapshot.products.map((product) => [product.id, product])),
    categories: buildCategoryTree(snapshot.categories), designers: [], discounts: [], returnPolicy: snapshot.returnPolicy, reload: vi.fn(),
  };
  for (const fn of [...Object.values(mocks.orders), ...Object.values(mocks.payments), auth.addAddress]) fn.mockReset();
  mocks.orders.createQuote.mockResolvedValue({ data: fixtureQuote() });
  mocks.payments.getOverview.mockResolvedValue({ data: fixturePaymentOverview(placed) });
  auth.set(newcomer);
});

describe("checkout steps", () => {
  it("starts a customer without an address on Delivery, with later steps as text and every fee pending", async () => {
    seed(newcomer.id, [linen]);
    render(page());
    expect(screen.getByRole("heading", { level: 1, name: "Checkout" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Delivery" })).toBeTruthy();
    const [delivery, review, payment] = steps();
    expect(delivery.getAttribute("aria-current")).toBe("step");
    expect(within(review).queryByRole("link")).toBeNull();
    expect(within(payment).queryByRole("link")).toBeNull();
    // The figures wait for the server: the items are an estimate and no fee reads as 0 or free.
    const figures = summary();
    expect(within(figures).getByText("Items (estimate, excl. VAT)").nextElementSibling?.textContent).toBe("KES 900");
    expect(within(figures).getAllByText("Pending")).toHaveLength(3);
    expect(within(figures).getByText("Total pending")).toBeTruthy();
    expect(within(figures).getByText("Choose a delivery address to see delivery, VAT and your total.")).toBeTruthy();
    expect(figures.textContent).not.toMatch(/KES 0\b|Free/i);
    expect(mocks.orders.createQuote).not.toHaveBeenCalled();
  });

  it("shows Review and reserve to a customer with an address, with Delivery done and linked back", async () => {
    auth.set(returning);
    seed(returning.id, [linen]);
    render(page());
    expect(await screen.findByRole("heading", { level: 2, name: "Review and reserve" })).toBeTruthy();
    const [delivery, review, payment] = steps();
    expect(review.getAttribute("aria-current")).toBe("step");
    expect(within(delivery).getByRole("link").getAttribute("href")).toBe("#/checkout?step=delivery");
    expect(within(payment).queryByRole("link")).toBeNull();
    const total = screen.getByRole("region", { name: "Order total" });
    expect(await within(total).findByText("KES 1,244", undefined, WAIT)).toBeTruthy();
    // With a current quote the summary shows only the server's figures.
    expect(within(summary()).queryByText("Pending")).toBeNull();
    expect(within(summary()).getByText("Items subtotal")).toBeTruthy();
  });

  it.each([
    ["#/checkout?step=payment", returning, "Review and reserve"],
    ["#/checkout?step=review", newcomer, "Delivery"],
    ["#/checkout?step=shipping", returning, "Review and reserve"],
  ])("falls back from %s to the furthest step the state allows", async (hash, user, heading) => {
    window.history.replaceState(null, "", hash);
    auth.set(user);
    seed(user.id, [linen]);
    render(page());
    expect(await screen.findByRole("heading", { level: 2, name: heading }, WAIT)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Order reserved" })).toBeNull();
  });

  it("goes back to Delivery when asked and keeps the chosen address and method", async () => {
    window.history.replaceState(null, "", "#/checkout?step=delivery");
    auth.set({ ...returning, addresses: [homeAddress, { ...homeAddress, id: "addr-2", street: "2 Office Road", isDefault: false }] });
    seed(returning.id, [linen]);
    render(page());
    expect(screen.getByRole("heading", { level: 2, name: "Delivery" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /2 Office Road/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Same-day delivery" }));
    expect(JSON.parse(localStorage.getItem(shopperStateKey(returning.id))!).checkout).toEqual({ addressId: "addr-2", deliveryMethod: "SAME_DAY" });
    fireEvent.click(screen.getByRole("button", { name: "Continue to review" }));
    expect(window.location.hash).toBe("#/checkout?step=review");
    expect(await screen.findByRole("heading", { level: 2, name: "Review and reserve" })).toBeTruthy();
    expect(screen.getByText(/2 Office Road/)).toBeTruthy();
    await waitFor(() => expect(mocks.orders.createQuote).toHaveBeenLastCalledWith(expect.objectContaining({ addressId: "addr-2", deliveryMethod: "SAME_DAY" })), WAIT);
  });
});

describe("first address at checkout", () => {
  const field = (name: string) => screen.getByRole("textbox", { name });

  it("ties each problem to its field and summarises them on submit, sending nothing", async () => {
    seed(newcomer.id, [linen]);
    render(page());
    fireEvent.change(field("Street address"), { target: { value: "12 Moi Avenue" } });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    const problems = await screen.findByRole("alert");
    expect(document.activeElement).toBe(problems);
    expect(within(problems).getAllByRole("button").map((button) => button.textContent)).toEqual(["Enter the town or city.", "Enter the county."]);
    expect(field("Town or city").getAttribute("aria-invalid")).toBe("true");
    expect(field("Town or city").getAttribute("aria-describedby")).toBe(screen.getByText("Enter the town or city.", { selector: "p" }).id);
    expect(field("Street address").getAttribute("aria-invalid")).toBeNull();
    fireEvent.click(within(problems).getByRole("button", { name: "Enter the county." }));
    expect(document.activeElement).toBe(field("County"));
    expect(auth.addAddress).not.toHaveBeenCalled();
    // Every field has the browser's address autocomplete.
    expect(["Street address", "Town or city", "County", "Postal code (optional)"].map((name) => field(name).getAttribute("autocomplete")))
      .toEqual(["street-address", "address-level2", "address-level1", "postal-code"]);
  });

  it("keeps what was typed across a reload, then saves, selects and quotes the address and clears the draft", async () => {
    seed(newcomer.id, [linen]);
    const first = render(page());
    fireEvent.change(field("Street address"), { target: { value: " 12 Moi Avenue " } });
    fireEvent.change(field("Town or city"), { target: { value: "Nairobi" } });
    first.unmount();

    render(page());
    expect((field("Street address") as HTMLInputElement).value).toBe(" 12 Moi Avenue ");
    expect((field("Town or city") as HTMLInputElement).value).toBe("Nairobi");
    fireEvent.change(field("County"), { target: { value: "Nairobi" } });
    const created: Address = { id: "addr-new", street: "12 Moi Avenue", city: "Nairobi", county: "Nairobi", isDefault: true };
    auth.addAddress.mockImplementation(async () => {
      auth.set({ ...newcomer, addresses: [created] });
      return created;
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Review and reserve" }, WAIT)).toBeTruthy();
    expect(auth.addAddress).toHaveBeenCalledWith({ street: "12 Moi Avenue", city: "Nairobi", county: "Nairobi", isDefault: true });
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2, name: "Review and reserve" }));
    expect(sessionStorage.getItem(STORAGE_KEYS.checkoutAddressDraft)).toBeNull();
    await waitFor(() => expect(mocks.orders.createQuote).toHaveBeenLastCalledWith(expect.objectContaining({ addressId: "addr-new" })), WAIT);
    // Back returns to Delivery, where the saved address is now a choice.
    expect(window.location.hash).toBe("#/checkout?step=review");
  });

  it("keeps the typed address when saving fails and says so", async () => {
    seed(newcomer.id, [linen]);
    render(page());
    fireEvent.change(field("Street address"), { target: { value: "12 Moi Avenue" } });
    fireEvent.change(field("Town or city"), { target: { value: "Nairobi" } });
    fireEvent.change(field("County"), { target: { value: "Nairobi" } });
    auth.addAddress.mockRejectedValue(apiError(undefined));
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    const failure = await screen.findByRole("alert", undefined, WAIT);
    expect(failure.textContent).toMatch(/^Your address was not saved/);
    expect((field("Street address") as HTMLInputElement).value).toBe("12 Moi Avenue");
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEYS.checkoutAddressDraft)!)).toMatchObject({ owner: newcomer.id });
    expect(screen.getByRole("heading", { level: 2, name: "Delivery" })).toBeTruthy();
  });

  it("never shows one account's typed address to another", async () => {
    seed(newcomer.id, [linen]);
    seed("customer-other", [linen]);
    const view = render(page());
    fireEvent.change(field("Street address"), { target: { value: "12 Moi Avenue" } });
    await act(async () => auth.set({ ...newcomer, id: "customer-other", email: "other@example.test" }));
    view.rerender(page());
    expect((await screen.findByRole("textbox", { name: "Street address" }) as HTMLInputElement).value).toBe("");
    expect(sessionStorage.getItem(STORAGE_KEYS.checkoutAddressDraft)).toBeNull();
  });
});

describe("payment step from the address", () => {
  it("shows the reserved order named in the address after a reload, without quoting or reserving again", async () => {
    window.history.replaceState(null, "", `#/checkout?step=payment&order=${placed.id}`);
    auth.set(returning);
    seed(returning.id, []);
    mocks.orders.getOrder.mockResolvedValue({ data: placed });
    render(page());
    expect(screen.getByText("Loading your order…")).toBeTruthy();
    expect(await screen.findByRole("heading", { level: 2, name: "Order reserved" }, WAIT)).toBeTruthy();
    expect(mocks.orders.getOrder).toHaveBeenCalledWith(placed.id);
    expect(screen.getByText(/^Unpaid — held until /)).toBeTruthy();
    expect(steps()[2].getAttribute("aria-current")).toBe("step");
    expect(within(steps()[0]).queryByRole("link")).toBeNull();
    expect(mocks.orders.createQuote).not.toHaveBeenCalled();
    expect(mocks.orders.placeOrder).not.toHaveBeenCalled();
    expect(await screen.findByText("M-Pesa payment unavailable", undefined, WAIT)).toBeTruthy();
  });

  it("drops an order this account does not have and continues from the cart", async () => {
    window.history.replaceState(null, "", "#/checkout?step=payment&order=someone-elses-order");
    auth.set(returning);
    seed(returning.id, [linen]);
    mocks.orders.getOrder.mockRejectedValue(apiError(404, { error: "Order not found", code: "ORDER_NOT_FOUND" }));
    render(page());
    expect(await screen.findByRole("heading", { level: 2, name: "Review and reserve" }, WAIT)).toBeTruthy();
    // The notice and the address change come from an effect after the step renders, so wait for them.
    expect(await screen.findByText("That order isn't in your account", undefined, WAIT)).toBeTruthy();
    expect(window.location.hash).toBe("#/checkout");
    expect(screen.queryByRole("heading", { name: "Order reserved" })).toBeNull();
  });

  it.each([
    [403, { error: "Forbidden" }],
    [400, { error: "Invalid order id" }],
  ])("treats an order the server refuses with %i as not found, never as a retryable failure", async (status, body) => {
    window.history.replaceState(null, "", "#/checkout?step=payment&order=refused-order");
    auth.set(returning);
    seed(returning.id, [linen]);
    mocks.orders.getOrder.mockRejectedValue(apiError(status, body));
    render(page());
    expect(await screen.findByText("That order isn't in your account", undefined, WAIT)).toBeTruthy();
    expect(window.location.hash).toBe("#/checkout");
    expect(screen.queryByRole("heading", { name: "Your order could not be loaded" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Order reserved" })).toBeNull();
    expect(await screen.findByRole("heading", { level: 2, name: "Review and reserve" }, WAIT)).toBeTruthy();
  });

  it("reports a malformed order in the address as not found without asking the server", async () => {
    window.history.replaceState(null, "", "#/checkout?step=payment&order=%3Cscript%3E%2F..%2Forders");
    auth.set(returning);
    seed(returning.id, [linen]);
    render(page());
    expect(await screen.findByText("That order isn't in your account", undefined, WAIT)).toBeTruthy();
    expect(window.location.hash).toBe("#/checkout");
    expect(mocks.orders.getOrder).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Order reserved" })).toBeNull();
  });

  it("reports a failure to load that order instead of showing success or an empty checkout", async () => {
    window.history.replaceState(null, "", `#/checkout?step=payment&order=${placed.id}`);
    auth.set(returning);
    seed(returning.id, []);
    mocks.orders.getOrder.mockRejectedValueOnce(apiError(undefined)).mockResolvedValue({ data: placed });
    render(page());
    expect(await screen.findByRole("heading", { name: "Your order could not be loaded" }, WAIT)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Order reserved" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Your cart is empty" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Order reserved" }, WAIT)).toBeTruthy();
  });

  it("says when the hold has lapsed, offers no receipt and never calls the order paid", async () => {
    const expired = { ...placed, reservationStatus: "EXPIRED" as const, reservationExpiresAt: null };
    window.history.replaceState(null, "", `#/checkout?step=payment&order=${expired.id}`);
    auth.set(returning);
    seed(returning.id, []);
    mocks.orders.getOrder.mockResolvedValue({ data: expired });
    mocks.payments.getOverview.mockResolvedValue({ data: fixturePaymentOverview(expired, {
      environment: "production", reasonCode: "ORDER_NOT_PAYABLE", message: "This order is not awaiting payment on an active reservation.",
    }) });
    render(page());
    expect(await screen.findByRole("heading", { level: 2, name: "Order no longer reserved" }, WAIT)).toBeTruthy();
    expect(screen.getByText("Unpaid — no longer held")).toBeTruthy();
    expect(screen.getByText(/This order's hold has ended\. Do not approve an outstanding payment prompt/)).toBeTruthy();
    expect(await screen.findByText("This order is not awaiting payment on an active reservation.", undefined, WAIT)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Print receipt" })).toBeNull();
    expect(screen.queryByText("Payment received")).toBeNull();
  });
});
