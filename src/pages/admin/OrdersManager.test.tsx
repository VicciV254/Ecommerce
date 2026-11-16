import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../api/orders";
import { fixturePendingOrder, fixtureQuote } from "../../test-support/checkoutFixtures";
import { fixtureAttention, fixtureStaffOrder } from "../../test-support/orderFixtures";
import { OrdersManager } from "./OrdersManager";

const admin = vi.hoisted(() => ({
  orders: { getAll: vi.fn(), get: vi.fn(), applyAction: vi.fn() },
  attention: { getAll: vi.fn(), markRead: vi.fn() },
  notifications: { retry: vi.fn() },
}));
vi.mock("../../api/admin", async (importOriginal) => ({ ...await importOriginal<typeof import("../../api/admin")>(), adminAPI: admin }));

const WAIT = { timeout: 3000 };
const base = fixturePendingOrder(fixtureQuote());
const paid: Order = { ...base, paymentStatus: "PAID", reservationStatus: "COMMITTED", reservationExpiresAt: null };
const processing = fixtureStaffOrder({ ...paid, status: "PROCESSING" }, { allowedActions: ["DISPATCH", "CANCEL"] });
const failedEmail = fixtureAttention({
  key: "notification:email-1:DEAD:6", type: "NOTIFICATION_FAILED", severity: "high", entityId: "email-1",
  title: "order received email stopped retrying", detail: "Last error: MAIL_TIMEOUT.",
  orderId: base.id, orderNumber: base.orderNumber,
});

beforeEach(() => {
  // The open order lives in the address; every test starts on the Orders module with nothing open.
  window.history.replaceState(null, "", "#/admin/orders/orders");
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  for (const group of Object.values(admin)) for (const fn of Object.values(group)) fn.mockReset();
  admin.orders.getAll.mockResolvedValue({ data: { orders: [processing], pagination: { page: 1, limit: 20, total: 1, pages: 1 } } });
  admin.orders.get.mockResolvedValue({ data: processing });
  admin.attention.getAll.mockResolvedValue({ data: { items: [failedEmail] } });
});

describe("staff order roles", () => {
  it("gives a viewer every record but no control that changes an order, refund or email", async () => {
    render(<OrdersManager canWrite={false} showToast={vi.fn()} />);
    expect(await screen.findByText(/View only: your role can see orders, returns and refunds/, undefined, WAIT)).toBeTruthy();
    // jsdom drops the space before visually hidden text in accessible names; browsers keep it.
    const open = await screen.findAllByRole("button", { name: new RegExp(`^Open\\s*order ${base.orderNumber}$`) }, WAIT);
    expect((await screen.findAllByText(failedEmail.title, undefined, WAIT)).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^Retry email/ })).toBeNull();
    expect(screen.queryAllByRole("button", { name: /^(Dispatch|Cancel order)/ })).toEqual([]);

    fireEvent.click(open[0]);
    expect(await screen.findByText("View only: your role can see this order but cannot change it.", undefined, WAIT)).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: /^(Dispatch|Cancel order)/ })).toEqual([]);
    expect(admin.orders.applyAction).not.toHaveBeenCalled();
  });
});
