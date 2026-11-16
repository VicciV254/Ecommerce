import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../api/auth";
import type { CustomerOrder, OrderTracking } from "../api/orders";
import { fixturePendingOrder, fixtureQuote } from "../test-support/checkoutFixtures";
import { fixtureCustomerOrder } from "../test-support/orderFixtures";
import TrackOrder from "./TrackOrder";

const mocks = vi.hoisted(() => ({
  user: null as User | null,
  orders: { track: vi.fn(), getMyOrders: vi.fn() },
}));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../api/orders", async (importOriginal) => ({ ...await importOriginal<typeof import("../api/orders")>(), ordersAPI: mocks.orders }));

const WAIT = { timeout: 3000 };
const shopper: User = { id: "customer-a", email: "a@example.test", firstName: "Ada", lastName: "Customer" };
/** Public tracking as the API returns it: newest step first, each with the time it was recorded. */
const shipped: OrderTracking = {
  orderNumber: "APX-TRACK-1",
  status: "SHIPPED",
  trackingHistory: [
    { id: "event-3", status: "SHIPPED", description: "Shipped", location: null, createdAt: "2026-11-14T09:30:00.000Z", actorType: null },
    { id: "event-2", status: "PROCESSING", description: "Processing", location: null, createdAt: "2026-11-13T08:00:00.000Z", actorType: null },
    { id: "event-1", status: "PENDING", description: "Order placed", location: null, createdAt: "2026-11-12T07:15:00.000Z", actorType: null },
  ],
};
const order = (id: string, status: CustomerOrder["status"]) =>
  fixtureCustomerOrder(fixturePendingOrder(fixtureQuote({ id })), { status, orderNumber: `APX-${id.toUpperCase()}` });
const page = (orders: CustomerOrder[]) => ({ data: { orders, pagination: { page: 1, limit: 100, total: orders.length, pages: 1 } } });

function apiError(status: number | undefined, data: unknown = {}) {
  const config = { headers: new AxiosHeaders() };
  const response = status === undefined ? undefined : { status, statusText: String(status), data, headers: new AxiosHeaders(), config };
  return new AxiosError("Request failed", status === undefined ? "ERR_NETWORK" : "ERR_BAD_REQUEST", config, undefined, response);
}

const field = () => screen.getByRole("textbox", { name: "Order number" });
function lookUp(number: string) {
  fireEvent.change(field(), { target: { value: number } });
  fireEvent.click(screen.getByRole("button", { name: "Track order" }));
}

beforeEach(() => {
  mocks.user = null;
  for (const fn of Object.values(mocks.orders)) fn.mockReset();
});

describe("order tracking", () => {
  it("asks for a number before looking anything up, with the problem tied to the field", () => {
    render(<TrackOrder route="/track" />);
    expect(screen.getByRole("heading", { level: 1, name: "Track your order" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Track order" }));
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(field().getAttribute("aria-describedby")!)?.textContent).toBe("Enter your order number.");
    expect(document.activeElement).toBe(field());
    expect(mocks.orders.track).not.toHaveBeenCalled();
    // A guest sees no account section.
    expect(screen.queryByRole("heading", { name: "Your active orders" })).toBeNull();
  });

  it("shows only the status and step times the API returned, newest first, and moves focus to the result", async () => {
    mocks.orders.track.mockResolvedValue({ data: shipped });
    render(<TrackOrder route="/track" />);
    lookUp("  apx-track-1 ");
    expect(screen.getByRole("status").textContent).toMatch(/Looking up order apx-track-1/);
    const heading = await screen.findByRole("heading", { level: 2, name: "Order APX-TRACK-1" }, WAIT);
    expect(document.activeElement).toBe(heading);
    expect(mocks.orders.track).toHaveBeenCalledWith("apx-track-1");
    const result = heading.closest("section")!;
    expect(within(result).getByText("Shipped", { selector: "dd span" })).toBeTruthy();
    const steps = within(within(result).getByRole("list", { name: "Tracking history" })).getAllByRole("listitem");
    expect(steps.map((step) => step.querySelector("time")?.getAttribute("dateTime"))).toEqual(shipped.trackingHistory.map((event) => event.createdAt));
    expect(steps[0].textContent).toContain("(latest)");
    // Every time shown is one the API recorded: the last update is the newest step's time.
    const times = [...result.querySelectorAll("time")].map((time) => time.getAttribute("dateTime"));
    expect(new Set(times)).toEqual(new Set(shipped.trackingHistory.map((event) => event.createdAt)));
  });

  it("says no steps are recorded rather than inventing any", async () => {
    mocks.orders.track.mockResolvedValue({ data: { orderNumber: "APX-NEW", status: "PENDING", trackingHistory: [] } });
    render(<TrackOrder route="/track?order=APX-NEW" />);
    expect(await screen.findByRole("heading", { level: 2, name: "Order APX-NEW" }, WAIT)).toBeTruthy();
    expect(screen.getByText("None recorded yet")).toBeTruthy();
    expect(screen.getByText("No steps have been recorded for this order yet.")).toBeTruthy();
    expect(document.querySelectorAll("time")).toHaveLength(0);
    // A lookup from the address leaves focus where the page put it.
    expect(document.activeElement).not.toBe(screen.getByRole("heading", { level: 2 }));
  });

  it("reports an unknown number as not found, and a failure as unavailable with a retry", async () => {
    mocks.orders.track.mockRejectedValueOnce(apiError(404, { error: "Order not found" }))
      .mockRejectedValueOnce(apiError(undefined))
      .mockResolvedValue({ data: shipped });
    render(<TrackOrder route="/track" />);
    lookUp("APX-MISSING");
    const missing = await screen.findByRole("heading", { level: 2, name: "Order not found" }, WAIT);
    expect(document.activeElement).toBe(missing);
    expect(screen.getByText(/No order has the number/).textContent).toContain("APX-MISSING");

    lookUp("APX-TRACK-1");
    const failed = await screen.findByRole("heading", { level: 2, name: "Tracking is unavailable" }, WAIT);
    expect(document.activeElement).toBe(failed);
    expect(screen.getByText("Could not reach the server. Check your connection and try again.")).toBeTruthy();
    expect(screen.queryByText("Order not found")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Order APX-TRACK-1" }, WAIT)).toBeTruthy();
    expect(mocks.orders.track.mock.calls).toEqual([["APX-MISSING"], ["APX-TRACK-1"], ["APX-TRACK-1"]]);
  });

  it("treats a malformed answer as a failure, never as a status", async () => {
    mocks.orders.track.mockResolvedValue({ data: { orderNumber: "APX-TRACK-1", status: "TELEPORTED", trackingHistory: [] } });
    render(<TrackOrder route="/track" />);
    lookUp("APX-TRACK-1");
    expect(await screen.findByRole("heading", { level: 2, name: "Tracking is unavailable" }, WAIT)).toBeTruthy();
    expect(screen.queryByText(/TELEPORTED/i)).toBeNull();
  });

  it("ignores an answer to an earlier lookup that arrives after a newer one", async () => {
    let answerFirst!: (value: unknown) => void;
    mocks.orders.track.mockReturnValueOnce(new Promise((resolve) => { answerFirst = resolve; }))
      .mockResolvedValueOnce({ data: shipped });
    render(<TrackOrder route="/track" />);
    lookUp("APX-OLD");
    lookUp("APX-TRACK-1");
    expect(await screen.findByRole("heading", { level: 2, name: "Order APX-TRACK-1" }, WAIT)).toBeTruthy();
    await act(async () => answerFirst({ data: { ...shipped, orderNumber: "APX-OLD" } }));
    expect(screen.queryByRole("heading", { name: "Order APX-OLD" })).toBeNull();
  });
});

describe("a signed-in shopper's active orders", () => {
  it("lists orders still in progress, tracks one and links to its details", async () => {
    mocks.user = shopper;
    mocks.orders.getMyOrders.mockResolvedValue(page([order("q-ship", "SHIPPED"), order("q-done", "DELIVERED"), order("q-off", "CANCELLED")]));
    mocks.orders.track.mockResolvedValue({ data: { ...shipped, orderNumber: "APX-Q-SHIP" } });
    render(<TrackOrder route="/track" />);
    const panel = screen.getByRole("region", { name: "Your active orders" });
    expect(within(panel).getByText("Loading your active orders…")).toBeTruthy();
    const items = await within(panel).findAllByRole("listitem", undefined, WAIT);
    expect(items.map((item) => item.querySelector(".font-mono")?.textContent)).toEqual(["APX-Q-SHIP"]);
    expect(within(items[0]).getByRole("link", { name: /View details/ }).getAttribute("href")).toBe("#/account/orders?order=order-q-ship");
    fireEvent.click(within(items[0]).getByRole("button", { name: /Track/ }));
    expect((field() as HTMLInputElement).value).toBe("APX-Q-SHIP");
    expect(await screen.findByRole("heading", { level: 2, name: "Order APX-Q-SHIP" }, WAIT)).toBeTruthy();
    expect(mocks.orders.track).toHaveBeenCalledWith("APX-Q-SHIP");
  });

  it("says whether an active pending order awaits payment or preparation", async () => {
    mocks.user = shopper;
    const paid = { ...order("q-paid", "PENDING"), paymentStatus: "PAID" as const, reservationStatus: "COMMITTED" as const };
    mocks.orders.getMyOrders.mockResolvedValue(page([order("q-unpaid", "PENDING"), paid]));
    render(<TrackOrder route="/track" />);
    const panel = screen.getByRole("region", { name: "Your active orders" });
    const items = await within(panel).findAllByRole("listitem", undefined, WAIT);
    expect(items.map((item) => item.querySelector(".rounded-full")?.textContent)).toEqual(["Awaiting payment", "Waiting to be prepared"]);
    expect(within(panel).queryByText("Pending")).toBeNull();
  });

  it("says when nothing is in progress, and reports a failed load with a retry instead of an empty list", async () => {
    mocks.user = shopper;
    mocks.orders.getMyOrders.mockRejectedValueOnce(apiError(503, { error: "Orders are paused for maintenance." }))
      .mockResolvedValue(page([order("q-done", "DELIVERED")]));
    render(<TrackOrder route="/track" />);
    const panel = screen.getByRole("region", { name: "Your active orders" });
    expect(await within(panel).findByText("Orders are paused for maintenance.", undefined, WAIT)).toBeTruthy();
    expect(within(panel).queryByText(/no orders in progress/)).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Try again" }));
    expect(await within(panel).findByText(/You have no orders in progress\./, undefined, WAIT)).toBeTruthy();
    expect(within(panel).getByRole("link", { name: "your orders" }).getAttribute("href")).toBe("#/account/orders");
  });
});
