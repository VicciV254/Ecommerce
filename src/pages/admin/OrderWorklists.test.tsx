import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListedRefund, StaffOrder, StaffOrderFilters } from "../../api/admin";
import type { Order, RefundStatus } from "../../api/orders";
import { fixturePendingOrder, fixtureQuote } from "../../test-support/checkoutFixtures";
import { fixtureStaffOrder, fixtureStaffRefund } from "../../test-support/orderFixtures";
import type { RecordListFilters } from "./adminRoutes";
import { OrderQueue, RefundsQueue } from "./OrderWorklists";
import { OrdersManager } from "./OrdersManager";

const admin = vi.hoisted(() => ({
  orders: { getAll: vi.fn(), get: vi.fn(), applyAction: vi.fn() },
  refunds: { getAll: vi.fn(), act: vi.fn() },
  attention: { getAll: vi.fn(), markRead: vi.fn() },
}));
vi.mock("../../api/admin", async (importOriginal) => ({ ...await importOriginal<typeof import("../../api/admin")>(), adminAPI: admin }));

const WAIT = { timeout: 3000 };
const PROCESSING: StaffOrderFilters = { status: "PROCESSING" };

/** Serves `records` a page at a time, exactly as the list endpoints report pagination. */
function servePages<T>(records: () => T[], key: "orders" | "refunds") {
  return async (params: { page?: number; limit?: number }) => {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const all = records();
    return { data: { [key]: all.slice((page - 1) * limit, page * limit), pagination: { page, limit, total: all.length, pages: Math.ceil(all.length / limit) } } };
  };
}

const paidOrder = (index: number): StaffOrder => {
  const placed: Order = { ...fixturePendingOrder(fixtureQuote({ id: `quote-${index}` })), status: "PROCESSING", paymentStatus: "PAID", reservationStatus: "COMMITTED" };
  return fixtureStaffOrder(placed);
};
const listedRefund = (index: number): ListedRefund => ({
  ...fixtureStaffRefund(`order-${index}`, { id: `refund-${index}`, number: `RF-${index}`, status: "APPROVED" }), orderNumber: `APX-${index}`, isDemo: false,
});

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  for (const group of Object.values(admin)) for (const fn of Object.values(group)) fn.mockReset();
});

describe("worklist paging", () => {
  it("moves an order queue back to its last page when the page it showed no longer exists", async () => {
    let orders = Array.from({ length: 21 }, (_, index) => paidOrder(index + 1));
    admin.orders.getAll.mockImplementation(servePages(() => orders, "orders"));
    const props = { title: "Processing", filters: PROCESSING, emptyText: "No orders are being prepared.", canWrite: true, onOpen: vi.fn(), onChanged: vi.fn(), showToast: vi.fn() };
    const view = render(<OrderQueue {...props} reloadToken={0} />);
    expect(await screen.findByText("1–20 of 21 orders", undefined, WAIT)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("21–21 of 21 orders", undefined, WAIT)).toBeTruthy();

    // The only order on page 2 is dispatched, so the queue now fits on one page.
    orders = orders.slice(0, 20);
    await act(async () => view.rerender(<OrderQueue {...props} reloadToken={1} />));
    await vi.waitFor(() => expect(admin.orders.getAll.mock.lastCall?.[0]).toMatchObject({ status: "PROCESSING", page: 1 }), WAIT);
    expect(await screen.findAllByRole("button", { name: /^Open\s*order/ }, WAIT)).toHaveLength(20);
    expect(screen.getByText("20 orders")).toBeTruthy();
    expect(screen.queryByText("No orders are being prepared.")).toBeNull();
  });

  it("moves the refund list back to its last page when the page it showed no longer exists", async () => {
    let refunds = Array.from({ length: 21 }, (_, index) => listedRefund(index + 1));
    admin.refunds.getAll.mockImplementation(servePages(() => refunds, "refunds"));
    const props = { canWrite: true, onOpen: vi.fn(), onChanged: vi.fn(), showToast: vi.fn() };
    const onFilters = vi.fn();
    // The list's status and page live in the address; this harness stands in for it.
    function AddressedRefunds({ reloadToken }: { reloadToken: number }) {
      const [filters, setFilters] = useState<RecordListFilters<RefundStatus>>({ status: null, page: 1 });
      return <RefundsQueue {...props} reloadToken={reloadToken} filters={filters} onFilters={(next) => { onFilters(next); setFilters(next); }} />;
    }
    const view = render(<AddressedRefunds reloadToken={0} />);
    expect(await screen.findByText("1–20 of 21 refunds", undefined, WAIT)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onFilters).toHaveBeenLastCalledWith({ status: null, page: 2 });
    expect(await screen.findByText("21–21 of 21 refunds", undefined, WAIT)).toBeTruthy();

    refunds = refunds.slice(0, 20);
    await act(async () => view.rerender(<AddressedRefunds reloadToken={1} />));
    await vi.waitFor(() => expect(admin.refunds.getAll.mock.lastCall?.[0]).toMatchObject({ page: 1 }), WAIT);
    expect(onFilters).toHaveBeenLastCalledWith({ status: null, page: 1 });
    expect(await screen.findAllByRole("button", { name: /^Open order/ }, WAIT)).toHaveLength(20);
    expect(screen.getByText("20 refunds")).toBeTruthy();
    expect(screen.queryByText("No refunds match this filter.")).toBeNull();
  });

  // Between the correction and the last page's answer, the empty page past the end must not be shown as the list.
  it("reads as loading, never as an empty list, while the address moves it back to its last page", async () => {
    let refunds = Array.from({ length: 21 }, (_, index) => listedRefund(index + 1));
    const serve = servePages(() => refunds, "refunds");
    const held: { release?: () => void } = {};
    admin.refunds.getAll.mockImplementation(async (params: { page?: number; limit?: number }) => {
      if (refunds.length === 20 && params.page === 1) await new Promise<void>((resolve) => { held.release = resolve; });
      return serve(params);
    });
    const props = { canWrite: true, onOpen: vi.fn(), onChanged: vi.fn(), showToast: vi.fn() };
    function AddressedRefunds({ reloadToken }: { reloadToken: number }) {
      const [filters, setFilters] = useState<RecordListFilters<RefundStatus>>({ status: null, page: 1 });
      return <RefundsQueue {...props} reloadToken={reloadToken} filters={filters} onFilters={setFilters} />;
    }
    const view = render(<AddressedRefunds reloadToken={0} />);
    expect(await screen.findByText("1–20 of 21 refunds", undefined, WAIT)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("21–21 of 21 refunds", undefined, WAIT)).toBeTruthy();

    refunds = refunds.slice(0, 20);
    await act(async () => view.rerender(<AddressedRefunds reloadToken={1} />));
    await vi.waitFor(() => expect(held.release).toBeDefined(), WAIT);
    expect(screen.getByText("Loading refunds…")).toBeTruthy();
    expect(screen.queryByText("No refunds match this filter.")).toBeNull();
    await act(async () => held.release?.());
    expect(await screen.findAllByRole("button", { name: /^Open order/ }, WAIT)).toHaveLength(20);
  });

  it("reads as loading, never as an empty list, while its own page moves back to the last page", async () => {
    let orders = Array.from({ length: 21 }, (_, index) => paidOrder(index + 1));
    const serve = servePages(() => orders, "orders");
    const held: { release?: () => void } = {};
    admin.orders.getAll.mockImplementation(async (params: { page?: number; limit?: number }) => {
      if (orders.length === 20 && params.page === 1) await new Promise<void>((resolve) => { held.release = resolve; });
      return serve(params);
    });
    const props = { title: "Processing", filters: PROCESSING, emptyText: "No orders are being prepared.", canWrite: true, onOpen: vi.fn(), onChanged: vi.fn(), showToast: vi.fn() };
    const view = render(<OrderQueue {...props} reloadToken={0} />);
    expect(await screen.findByText("1–20 of 21 orders", undefined, WAIT)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("21–21 of 21 orders", undefined, WAIT)).toBeTruthy();

    orders = orders.slice(0, 20);
    await act(async () => view.rerender(<OrderQueue {...props} reloadToken={1} />));
    await vi.waitFor(() => expect(held.release).toBeDefined(), WAIT);
    expect(screen.getByText("Loading orders…")).toBeTruthy();
    expect(screen.queryByText("No orders are being prepared.")).toBeNull();
    await act(async () => held.release?.());
    expect(await screen.findAllByRole("button", { name: /^Open\s*order/ }, WAIT)).toHaveLength(20);
  });
});

describe("refunds list wording", () => {
  it("says how M-Pesa refunds are sent and that demonstration refunds move no money", async () => {
    admin.refunds.getAll.mockImplementation(servePages(() => [listedRefund(1)], "refunds"));
    render(<RefundsQueue canWrite onOpen={vi.fn()} onChanged={vi.fn()} showToast={vi.fn()} reloadToken={0} filters={{ status: null, page: 1 }} onFilters={vi.fn()} />);
    expect(await screen.findAllByRole("button", { name: /^Open order/ }, WAIT)).toHaveLength(1);
    expect(screen.getByText("Refunds are sent manually by M-Pesa. Only a recorded M-Pesa reference marks a refund as sent. "
      + "Demonstration refunds move no money; the customer records them from their order.")).toBeTruthy();
  });
});

describe("opening a record from a worklist", () => {
  it("focuses the refund in the opened order, not its copy in the hidden Refunds list", async () => {
    const order = paidOrder(1);
    const refund = fixtureStaffRefund(order.id, { id: "refund-1", number: "RF-1", status: "APPROVED" });
    admin.attention.getAll.mockResolvedValue({ data: { items: [] } });
    admin.orders.getAll.mockImplementation(servePages(() => [], "orders"));
    admin.refunds.getAll.mockImplementation(servePages(() => [{ ...refund, orderNumber: order.orderNumber, isDemo: false }], "refunds"));
    admin.orders.get.mockResolvedValue({ data: { ...order, refunds: [refund] } });

    window.history.replaceState(null, "", "#/admin/orders/refunds");
    render(<OrdersManager module="refunds" canWrite showToast={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Open\s*order/ }, WAIT));

    const workspace = await screen.findByRole("region", { name: `Order ${order.orderNumber}` }, WAIT);
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe(refund.number), WAIT);
    expect(workspace.contains(document.activeElement)).toBe(true);
  });
});
