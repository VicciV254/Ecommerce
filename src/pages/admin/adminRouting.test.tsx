import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../api/orders";
import { buildCategoryTree } from "../../store/catalogModel";
import { fixtureSnapshot } from "../../test-support/catalogFixtures";
import { fixturePendingOrder, fixtureQuote } from "../../test-support/checkoutFixtures";
import { fixtureStaffOrder } from "../../test-support/orderFixtures";
import { CatalogManager } from "./CatalogManager";
import { OrdersManager } from "./OrdersManager";
import { UnsavedChangesProvider, useUnsavedChanges } from "./unsavedChanges";

const api = vi.hoisted(() => ({
  orders: { getAll: vi.fn(), get: vi.fn(), applyAction: vi.fn() },
  attention: { getAll: vi.fn(), markRead: vi.fn() },
  returns: { getAll: vi.fn() },
  refunds: { getAll: vi.fn() },
}));
vi.mock("../../api/admin", async (importOriginal) => ({ ...await importOriginal<typeof import("../../api/admin")>(), adminAPI: api }));

const snapshot = fixtureSnapshot({ mode: "admin" });
vi.mock("./AdminCatalogContext", () => ({
  useAdminCatalog: () => ({
    status: "ready", data: { snapshot, stocks: [] }, categories: buildCategoryTree(snapshot.categories),
    error: null, sessionExpired: false, refreshing: false, reload: vi.fn(),
  }),
}));
vi.mock("../../store/StoreContext", () => ({ useStore: () => ({ state: { wishlist: [] }, addToCart: vi.fn(), toggleWish: vi.fn() }) }));
vi.mock("../../store/CatalogContext", () => ({ useCatalog: () => ({ mode: "live" }) }));
vi.mock("../../contexts/AuthContext", () => ({ useAuth: () => ({ user: null }) }));

const WAIT = { timeout: 3000 };
const paid: Order = { ...fixturePendingOrder(fixtureQuote()), status: "PROCESSING", paymentStatus: "PAID", reservationStatus: "COMMITTED", reservationExpiresAt: null };
const processing = fixtureStaffOrder(paid, { allowedActions: ["DISPATCH"] });

function refused(status: number, code?: string) {
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status, statusText: "", data: { error: "Order not found", ...(code ? { code } : {}) }, headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() },
  });
}

/** An editor with unsaved changes that no route keeps open. */
const leavesOnAnyChange = () => false;
function DirtyEditor() {
  useUnsavedChanges(true, "Storefront draft", leavesOnAnyChange);
  return null;
}

function at(route: string) {
  window.history.replaceState(null, "", `#${route}`);
}

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  for (const group of Object.values(api)) for (const fn of Object.values(group)) fn.mockReset();
  api.orders.getAll.mockResolvedValue({ data: { orders: [processing], pagination: { page: 1, limit: 20, total: 1, pages: 1 } } });
  api.orders.get.mockResolvedValue({ data: processing });
  api.attention.getAll.mockResolvedValue({ data: { items: [] } });
});

describe("orders in the address", () => {
  it("switches views with links that replace the entry, so Back leaves the module", async () => {
    at("/admin/orders/orders");
    const entries = window.history.length;
    render(<OrdersManager canWrite showToast={vi.fn()} />);
    const views = screen.getByRole("navigation", { name: "Order worklists" });
    expect(within(views).getAllByRole("link").map((link) => link.textContent)).toEqual(["Needs action", "All orders", "Closed"]);
    expect(within(views).getByRole("link", { name: "Needs action" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(within(views).getByRole("link", { name: "All orders" }));
    expect(window.location.hash).toBe("#/admin/orders/orders?view=all");
    expect(window.history.length).toBe(entries);
    await waitFor(() => expect(within(views).getByRole("link", { name: "All orders" }).getAttribute("aria-current")).toBe("page"));
    expect(await screen.findByRole("region", { name: "All orders" }, WAIT)).toBeTruthy();
  });

  it("asks before a view link leaves an editor with unsaved changes", async () => {
    at("/admin/orders/orders");
    render(<UnsavedChangesProvider><DirtyEditor /><OrdersManager canWrite showToast={vi.fn()} /></UnsavedChangesProvider>);
    fireEvent.click(screen.getByRole("link", { name: "All orders" }));
    const guard = screen.getByRole("dialog", { name: "Discard unsaved changes?" });
    expect(within(guard).getByText("Storefront draft has unsaved changes. Leaving now discards them.")).toBeTruthy();
    expect(window.location.hash).toBe("#/admin/orders/orders");
    fireEvent.click(within(guard).getByRole("button", { name: "Discard changes" }));
    expect(window.location.hash).toBe("#/admin/orders/orders?view=all");
  });

  it("falls back from an unknown view to Needs action, correcting the address in place", async () => {
    at("/admin/orders/orders?view=toString");
    const entries = window.history.length;
    render(<OrdersManager canWrite showToast={vi.fn()} />);
    await waitFor(() => expect(window.location.hash).toBe("#/admin/orders/orders"));
    expect(window.history.length).toBe(entries);
    expect(screen.getByRole("link", { name: "Needs action" }).getAttribute("aria-current")).toBe("page");
  });

  it("never sends a malformed order id: it reads as not found and is dropped", async () => {
    at(`/admin/orders/orders?view=all&order=${encodeURIComponent("../orders/admin/all")}`);
    render(<OrdersManager canWrite showToast={vi.fn()} />);
    expect(await screen.findByText("That order wasn't found.", undefined, WAIT)).toBeTruthy();
    expect(window.location.hash).toBe("#/admin/orders/orders?view=all");
    expect(api.orders.get).not.toHaveBeenCalled();
  });

  it.each([[400], [403], [404], [409, "ORDER_NOT_FOUND"]] as [number, string?][])(
    "reads a %i answer as not found and drops the order from the address", async (status, code) => {
      api.orders.get.mockRejectedValue(refused(status, code));
      at("/admin/orders/returns?order=order-gone");
      render(<OrdersManager module="returns" canWrite showToast={vi.fn()} />);
      expect(await screen.findByText("That order wasn't found.", undefined, WAIT)).toBeTruthy();
      expect(window.location.hash).toBe("#/admin/orders/returns");
      expect(api.orders.get).toHaveBeenCalledWith("order-gone");
      expect(screen.queryByRole("heading", { name: /^Order / })).toBeNull();
    });

  it("opens an order with a push, so Back closes it and focus returns to the Open button", async () => {
    at("/admin/orders/orders");
    const entries = window.history.length;
    render(<OrdersManager canWrite showToast={vi.fn()} />);
    // Every Needs action queue is served the same order here; the first copy is opened.
    const [open] = await screen.findAllByRole("button", { name: new RegExp(`^Open\\s*order ${paid.orderNumber}$`) }, WAIT);
    open.focus();
    fireEvent.click(open);
    expect(window.location.hash).toBe(`#/admin/orders/orders?order=${paid.id}`);
    expect(window.history.length).toBe(entries + 1);
    const heading = await screen.findByRole("heading", { name: `Order ${paid.orderNumber}` }, WAIT);
    await waitFor(() => expect(document.activeElement).toBe(heading));

    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole("heading", { name: `Order ${paid.orderNumber}` })).toBeNull(), WAIT);
    expect(window.location.hash).toBe("#/admin/orders/orders");
    await waitFor(() => expect(document.activeElement).toBe(open));
  });

  it("closing the workspace replaces the address without the order", async () => {
    at("/admin/orders/orders");
    render(<OrdersManager canWrite showToast={vi.fn()} />);
    fireEvent.click((await screen.findAllByRole("button", { name: new RegExp(`^Open\\s*order ${paid.orderNumber}$`) }, WAIT))[0]);
    await screen.findByRole("heading", { name: `Order ${paid.orderNumber}` }, WAIT);
    const entries = window.history.length;
    fireEvent.click(screen.getByRole("button", { name: "← Back to orders" }));
    expect(window.location.hash).toBe("#/admin/orders/orders");
    expect(window.history.length).toBe(entries);
  });

  it("reopens a deep-linked order after a reload without moving focus", async () => {
    at(`/admin/orders/refunds?order=${paid.id}`);
    render(<OrdersManager module="refunds" canWrite={false} showToast={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: `Order ${paid.orderNumber}` }, WAIT)).toBeTruthy();
    expect(screen.getByText("View only: your role can see this order but cannot change it.")).toBeTruthy();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("worklist filters in the address", () => {
  const filtered = "/admin/orders/orders?view=all&delivery=SAME_DAY&from=2026-11-01&to=2026-11-17&status=PROCESSING&payment=PAID";
  const page = (orders: unknown[], total: number, current = 1) => ({ data: { orders, pagination: { page: current, limit: 20, total, pages: Math.ceil(total / 20) } } });

  it("sends a deep link's filters and page with the request and shows them in the fields", async () => {
    at(`${filtered}&page=2`);
    api.orders.getAll.mockResolvedValue(page([processing], 21, 2));
    render(<OrdersManager canWrite showToast={vi.fn()} />);
    await waitFor(() => expect(api.orders.getAll).toHaveBeenCalledWith({
      deliveryMethod: "SAME_DAY", orderedFrom: "2026-11-01", orderedTo: "2026-11-17", status: "PROCESSING", paymentStatus: "PAID", page: 2, limit: 20,
    }));
    expect(api.orders.getAll).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("Delivery") as HTMLSelectElement).value).toBe("SAME_DAY");
    expect((screen.getByLabelText("Ordered from") as HTMLInputElement).value).toBe("2026-11-01");
    expect((screen.getByLabelText("Ordered to") as HTMLInputElement).value).toBe("2026-11-17");
    expect((screen.getByLabelText("Order status") as HTMLSelectElement).value).toBe("PROCESSING");
    expect((screen.getByLabelText("Payment") as HTMLSelectElement).value).toBe("PAID");
    expect(await screen.findByText("21–21 of 21 orders", undefined, WAIT)).toBeTruthy();
  });

  it("replaces the entry on a filter change, back to page 1, and on a page change", async () => {
    at(`${filtered}&page=2`);
    api.orders.getAll.mockImplementation(async (params: { page?: number }) => page([processing], 41, params.page));
    const entries = window.history.length;
    render(<OrdersManager canWrite showToast={vi.fn()} />);
    await screen.findByText("21–40 of 41 orders", undefined, WAIT);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(window.location.hash).toBe(`#${filtered}&page=3`);
    fireEvent.change(screen.getByLabelText("Payment"), { target: { value: "REFUNDED" } });
    expect(window.location.hash).toBe("#/admin/orders/orders?view=all&delivery=SAME_DAY&from=2026-11-01&to=2026-11-17&status=PROCESSING&payment=REFUNDED");
    fireEvent.change(screen.getByLabelText("Delivery"), { target: { value: "" } });
    expect(window.location.hash).toBe("#/admin/orders/orders?view=all&from=2026-11-01&to=2026-11-17&status=PROCESSING&payment=REFUNDED");
    expect(window.history.length).toBe(entries);
    await waitFor(() => expect(api.orders.getAll).toHaveBeenLastCalledWith({
      orderedFrom: "2026-11-01", orderedTo: "2026-11-17", status: "PROCESSING", paymentStatus: "REFUNDED", page: 1, limit: 20,
    }));
  });

  it("never lets a date range run backwards: moving one end past the other moves both", async () => {
    at("/admin/orders/orders?from=2026-11-01&to=2026-11-17");
    render(<OrdersManager canWrite showToast={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Ordered from"), { target: { value: "2026-11-20" } });
    expect(window.location.hash).toBe("#/admin/orders/orders?from=2026-11-20&to=2026-11-20");
    fireEvent.change(screen.getByLabelText("Ordered to"), { target: { value: "2026-11-05" } });
    expect(window.location.hash).toBe("#/admin/orders/orders?from=2026-11-05&to=2026-11-05");
    fireEvent.change(screen.getByLabelText("Ordered from"), { target: { value: "" } });
    expect(window.location.hash).toBe("#/admin/orders/orders?to=2026-11-05");
  });

  it("opens an order with its filters kept, and Back returns to the same filtered list", async () => {
    at(filtered);
    const entries = window.history.length;
    render(<OrdersManager canWrite showToast={vi.fn()} />);
    const open = await screen.findByRole("button", { name: new RegExp(`^Open\\s*order ${paid.orderNumber}$`) }, WAIT);
    const listRequests = api.orders.getAll.mock.calls.length;
    fireEvent.click(open);
    expect(window.location.hash).toBe(`#${filtered}&order=${paid.id}`);
    expect(window.history.length).toBe(entries + 1);
    await screen.findByRole("heading", { name: `Order ${paid.orderNumber}` }, WAIT);
    act(() => window.history.back());
    await waitFor(() => expect(window.location.hash).toBe(`#${filtered}`), WAIT);
    await waitFor(() => expect(screen.queryByRole("heading", { name: `Order ${paid.orderNumber}` })).toBeNull(), WAIT);
    expect((screen.getByLabelText("Order status") as HTMLSelectElement).value).toBe("PROCESSING");
    // The list kept its request: opening and closing an order sends no new list request.
    expect(api.orders.getAll).toHaveBeenCalledTimes(listRequests);
    expect(api.orders.getAll.mock.calls.every(([params]) => params.status === "PROCESSING" && params.orderedFrom === "2026-11-01")).toBe(true);
    // Forward reopens the order with the same filters (and leaves no forward entry for later tests).
    act(() => window.history.forward());
    await screen.findByRole("heading", { name: `Order ${paid.orderNumber}` }, WAIT);
    expect(window.location.hash).toBe(`#${filtered}&order=${paid.id}`);
    fireEvent.click(screen.getByRole("button", { name: "← Back to orders" }));
    expect(window.location.hash).toBe(`#${filtered}`);
  });

  it("corrects unknown or malformed values in place and never sends them", async () => {
    at("/admin/orders/orders?view=all&delivery=DRONE&from=2026-02-30&to=2026-11-17&status=toString&payment=PAID&page=0");
    const entries = window.history.length;
    render(<OrdersManager canWrite showToast={vi.fn()} />);
    await waitFor(() => expect(window.location.hash).toBe("#/admin/orders/orders?view=all&to=2026-11-17&payment=PAID"));
    expect(window.history.length).toBe(entries);
    for (const [params] of api.orders.getAll.mock.calls) {
      expect(params).toEqual({ orderedTo: "2026-11-17", paymentStatus: "PAID", page: 1, limit: 20 });
    }
  });

  it("drops All orders filters from the other views", async () => {
    at("/admin/orders/orders?view=closed&status=PENDING&delivery=STORE_PICKUP");
    render(<OrdersManager canWrite showToast={vi.fn()} />);
    await waitFor(() => expect(window.location.hash).toBe("#/admin/orders/orders?view=closed&delivery=STORE_PICKUP"));
    expect(api.orders.getAll.mock.calls.every(([params]) => params.status !== "PENDING" && params.deliveryMethod === "STORE_PICKUP")).toBe(true);
    expect(within(screen.getByRole("navigation", { name: "Order worklists" })).getByRole("link", { name: "All orders" }).getAttribute("href"))
      .toBe("#/admin/orders/orders?view=all&delivery=STORE_PICKUP");
  });

  it("keeps the Returns status and page in the address, and corrects a status from another list", async () => {
    api.returns.getAll.mockResolvedValue({ data: { returns: [], pagination: { page: 2, limit: 20, total: 21, pages: 2 } } });
    at("/admin/orders/returns?status=REQUESTED&page=2");
    const entries = window.history.length;
    const view = render(<OrdersManager module="returns" canWrite showToast={vi.fn()} />);
    await waitFor(() => expect(api.returns.getAll).toHaveBeenCalledWith({ status: "REQUESTED", page: 2, limit: 20 }));
    fireEvent.change(screen.getByLabelText("Return status"), { target: { value: "APPROVED" } });
    expect(window.location.hash).toBe("#/admin/orders/returns?status=APPROVED");
    expect(window.history.length).toBe(entries);
    view.unmount();

    api.returns.getAll.mockClear();
    at("/admin/orders/returns?status=UNRESOLVED");
    render(<OrdersManager module="returns" canWrite showToast={vi.fn()} />);
    await waitFor(() => expect(window.location.hash).toBe("#/admin/orders/returns"));
    expect(api.returns.getAll.mock.calls.every(([params]) => !("status" in params))).toBe(true);
  });
});

describe("products in the address", () => {
  it("opens the editor with a push and closes it with a replace", async () => {
    at("/admin/catalog/products");
    const entries = window.history.length;
    render(<CatalogManager canWrite showToast={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Linen Short-Sleeve Shirt" }));
    expect(window.location.hash).toBe("#/admin/catalog/products?product=prod-linen-shirt");
    expect(window.history.length).toBe(entries + 1);
    const editor = await screen.findByRole("dialog", { name: "Edit product" });
    fireEvent.click(within(editor).getByRole("button", { name: "Close product editor" }));
    expect(window.location.hash).toBe("#/admin/catalog/products");
    expect(window.history.length).toBe(entries + 1);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit product" })).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Add product" }));
    expect(window.location.hash).toBe("#/admin/catalog/products?product=new");
    expect(await screen.findByRole("dialog", { name: "Add product" })).toBeTruthy();
  });

  it("reopens a deep-linked product", () => {
    at("/admin/catalog/products?product=prod-linen-shirt");
    render(<CatalogManager canWrite showToast={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Edit product" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveProperty("value", "Linen Short-Sleeve Shirt");
  });

  it.each([["prod-missing"], ["%3Cimg%20src%3Dx%3E"], [""]])("reads product=%s as not found and drops it", async (id) => {
    at(`/admin/catalog/products?product=${id}`);
    render(<CatalogManager canWrite showToast={vi.fn()} />);
    expect(await screen.findByText("That product wasn't found.")).toBeTruthy();
    expect(window.location.hash).toBe("#/admin/catalog/products");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
