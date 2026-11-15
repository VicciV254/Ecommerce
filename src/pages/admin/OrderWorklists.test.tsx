import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListedRefund, StaffOrder, StaffOrderFilters } from "../../api/admin";
import type { Order } from "../../api/orders";
import { fixturePendingOrder, fixtureQuote } from "../../test-support/checkoutFixtures";
import { fixtureStaffOrder, fixtureStaffRefund } from "../../test-support/orderFixtures";
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
    const view = render(<RefundsQueue {...props} reloadToken={0} />);
    expect(await screen.findByText("1–20 of 21 refunds", undefined, WAIT)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("21–21 of 21 refunds", undefined, WAIT)).toBeTruthy();

    refunds = refunds.slice(0, 20);
    await act(async () => view.rerender(<RefundsQueue {...props} reloadToken={1} />));
    await vi.waitFor(() => expect(admin.refunds.getAll.mock.lastCall?.[0]).toMatchObject({ page: 1 }), WAIT);
    expect(await screen.findAllByRole("button", { name: /^Open order/ }, WAIT)).toHaveLength(20);
    expect(screen.getByText("20 refunds")).toBeTruthy();
    expect(screen.queryByText("No refunds match this filter.")).toBeNull();
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

    render(<OrdersManager role="ADMIN" showToast={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Refunds" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Open\s*order/ }, WAIT));

    const workspace = await screen.findByRole("region", { name: `Order ${order.orderNumber}` }, WAIT);
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe(refund.number), WAIT);
    expect(workspace.contains(document.activeElement)).toBe(true);
  });
});
