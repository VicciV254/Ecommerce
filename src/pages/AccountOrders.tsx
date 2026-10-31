import { useCallback, useEffect, useState } from "react";
import { Link, navigate } from "../router";
import { useAuth, type User } from "../contexts/AuthContext";
import { ordersAPI, type Order } from "../api/orders";
import { describeApiError } from "../api/errors";
import { formatKES } from "../utils/format";
import { useStorefront } from "../store/StorefrontContext";
import CancelOrderModal from "../components/CancelOrderModal";
import ReturnOrderModal from "../components/ReturnOrderModal";
import { ConfirmModal, ModalDialog } from "../components/Modal";
import { ErrorPanel, LoadingPanel } from "../components/ui";

const ORDER_PAGE_LIMIT = 100;
/** Existing pickup return window enforced by the API; policy changes belong to a later phase. */
const PICKUP_RETURN_WINDOW_MINUTES = 5;

const statusLabels: Record<string, string> = {
  PENDING: "Pending",
  PROCESSING: "Processing",
  SHIPPED: "Shipped",
  READY_FOR_PICKUP: "Ready for pickup",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  AWAITING_REFUND: "Awaiting Refund",
  RETURNED: "Returned",
};

const statusClasses: Record<string, string> = {
  PENDING: "bg-warning/15 text-warning",
  PROCESSING: "bg-ocean-blue/10 text-ocean-blue",
  SHIPPED: "bg-brand-secondary/20 text-brand-accent",
  READY_FOR_PICKUP: "bg-coral/10 text-coral",
  DELIVERED: "bg-success/10 text-success",
  CANCELLED: "bg-error/10 text-error",
  AWAITING_REFUND: "bg-orange-100 text-orange-600",
  RETURNED: "bg-gray-100 text-gray-600",
};

type OrdersState =
  | { status: "loading" }
  | { status: "ready"; orders: Order[] }
  | { status: "error"; message: string };

function paymentLabel(order: Order) {
  const method = order.paymentMethod === "MPESA" ? "M-Pesa" : order.paymentMethod.replace(/_/g, " ").toLowerCase();
  return `${method} (${order.paymentStatus.toLowerCase()})`;
}

function deliveryAddress(order: Order) {
  return order.address ? `${order.address.street}, ${order.address.city}, ${order.address.county}` : "Not provided";
}

function customerName(user: User | null) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Customer";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function receiptTheme() {
  const styles = getComputedStyle(document.documentElement);
  return {
    primary: styles.getPropertyValue("--color-brand-primary").trim(),
    secondary: styles.getPropertyValue("--color-brand-secondary").trim(),
    background: styles.getPropertyValue("--color-light-pink").trim(),
  };
}

function printReceipt(order: Order, user: User | null, brandName: string, logoUrl: string | null) {
  const theme = receiptTheme();
  const brand = escapeHtml(brandName);
  const lines = order.items
    .map((item) =>
      `<tr><td>${escapeHtml(item.productName)}</td><td>${item.quantity}</td><td>${formatKES(item.productPrice)}</td><td>${formatKES(item.subtotal)}</td></tr>`)
    .join("");

  const popup = window.open("", "_blank", "width=720,height=900");
  if (!popup) return;

  popup.document.write(`
    <html>
      <head>
        <title>Order ${escapeHtml(order.orderNumber)}</title>
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Arial, sans-serif; background: ${theme.background}; color: #1f1f1f; }
          .receipt { max-width: 760px; margin: 0 auto; min-height: 100vh; background: #fff; }
          .brand { display: flex; align-items: center; gap: 16px; padding: 28px 32px; color: #fff; background: ${theme.primary}; border-bottom: 6px solid ${theme.secondary}; }
          .brand img { width: 68px; height: 68px; object-fit: contain; border-radius: 8px; background: #fff; padding: 6px; }
          .brand h1 { margin: 0; font-size: 28px; letter-spacing: .04em; }
          .brand p { margin: 4px 0 0; color: rgba(255,255,255,.78); font-size: 13px; }
          .content { padding: 30px 32px 36px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 24px; }
          .box { border: 1px solid #eee; border-left: 4px solid ${theme.secondary}; padding: 14px; }
          .label { color: #555; font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
          .value { margin-top: 5px; font-size: 14px; line-height: 1.45; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          th { background: ${theme.primary}; color: #fff; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
          th, td { border-bottom: 1px solid #eee; padding: 11px 10px; text-align: left; }
          .totals { margin-left: auto; margin-top: 22px; width: 280px; }
          .totals p { display: flex; justify-content: space-between; margin: 8px 0; }
          .grand { border-top: 2px solid ${theme.secondary}; padding-top: 12px; color: ${theme.primary}; font-size: 22px; font-weight: 800; }
          .footer { padding: 18px 32px; background: ${theme.primary}; color: rgba(255,255,255,.78); font-size: 12px; }
        </style>
      </head>
      <body>
        <main class="receipt">
          <section class="brand">
            ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="" />` : ""}
            <div>
              <h1>${brand}</h1>
              <p>Order ${escapeHtml(order.orderNumber)} · Payment ${escapeHtml(order.paymentStatus.toLowerCase())}</p>
            </div>
          </section>
          <section class="content">
            <div class="grid">
              <div class="box"><div class="label">Date</div><div class="value">${new Date(order.createdAt).toLocaleString()}</div></div>
              <div class="box"><div class="label">Status</div><div class="value">${escapeHtml(statusLabels[order.status] ?? order.status)}</div></div>
              <div class="box"><div class="label">Customer</div><div class="value">${escapeHtml(customerName(user))}<br>${escapeHtml(user?.email ?? "")}<br>${escapeHtml(user?.phone ?? "")}</div></div>
              <div class="box"><div class="label">Delivery</div><div class="value">${escapeHtml(deliveryAddress(order))}</div></div>
            </div>
            <table>
              <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Subtotal</th></tr></thead>
              <tbody>${lines}</tbody>
            </table>
            <div class="totals">
              <p><span>Subtotal</span><strong>${formatKES(order.subtotal)}</strong></p>
              <p><span>Tax</span><strong>${formatKES(order.tax)}</strong></p>
              <p><span>Delivery</span><strong>${formatKES(order.shippingCost)}</strong></p>
              <p class="grand"><span>Total</span><span>${formatKES(order.total)}</span></p>
            </div>
          </section>
          <section class="footer">Thank you for shopping with ${brand}.</section>
        </main>
      </body>
    </html>
  `);
  popup.document.close();
  popup.focus();
  popup.print();
}

function isWithinReturnWindow(pickedUpAt: string) {
  const elapsedMinutes = (Date.now() - new Date(pickedUpAt).getTime()) / (1000 * 60);
  return elapsedMinutes <= PICKUP_RETURN_WINDOW_MINUTES;
}

function canReturn(order: Order) {
  return order.status === "DELIVERED" && (!order.pickedUpAt || isWithinReturnWindow(order.pickedUpAt));
}

export default function AccountOrders() {
  const { user } = useAuth();
  const { brandName, storefront, mediaById } = useStorefront();
  const logoId = storefront?.settings.brand.logoMediaId;
  const logoUrl = (logoId && mediaById.get(logoId)?.url) || null;
  const [orders, setOrders] = useState<OrdersState>({ status: "loading" });
  const [selected, setSelected] = useState<Order | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [actionLoading, setActionLoading] = useState("");
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [orderToCancel, setOrderToCancel] = useState<Order | null>(null);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [orderToReturn, setOrderToReturn] = useState<Order | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: (() => void) | null }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: null,
  });

  const loadOrders = useCallback(async () => {
    try {
      const { data } = await ordersAPI.getMyOrders({ limit: ORDER_PAGE_LIMIT });
      setOrders({ status: "ready", orders: data.orders });
    } catch (error) {
      setOrders({ status: "error", message: describeApiError(error, "Your orders could not be loaded.") });
    }
  }, []);

  useEffect(() => {
    if (user) void loadOrders();
  }, [user, loadOrders]);

  const retry = () => {
    setOrders({ status: "loading" });
    void loadOrders();
  };

  const applyUpdatedOrder = (order: Order) => {
    setOrders((current) => current.status === "ready"
      ? { status: "ready", orders: current.orders.map((item) => (item.id === order.id ? order : item)) }
      : current);
    setSelected((current) => (current?.id === order.id ? order : current));
  };

  const cancelOrder = (order: Order) => {
    setOrderToCancel(order);
    setCancelModalOpen(true);
  };

  const handleOrderCancelled = () => {
    void loadOrders();
    setActionMessage("Order cancelled successfully");
  };

  const pickupOrder = (order: Order) => {
    setConfirmModal({
      isOpen: true,
      title: "Confirm Pickup",
      message: `Confirm that you have picked up this order from ${brandName}?`,
      onConfirm: async () => {
        setConfirmModal({ isOpen: false, title: "", message: "", onConfirm: null });
        setActionLoading(`${order.id}-pickup`);
        setActionMessage("");
        try {
          const { data } = await ordersAPI.pickup(order.id);
          applyUpdatedOrder(data);
          setActionMessage("Pickup confirmed. The order is now marked as delivered.");
        } catch (error) {
          setActionMessage(describeApiError(error, "Could not confirm pickup."));
        } finally {
          setActionLoading("");
        }
      },
    });
  };

  const returnOrder = (order: Order) => {
    setOrderToReturn(order);
    setReturnModalOpen(true);
  };

  const handleReturnSubmit = async (data: { reason: string; resolution: string; images: string[] }) => {
    if (!orderToReturn) return;
    setActionLoading(`${orderToReturn.id}-return`);
    setActionMessage("");
    try {
      const { data: returnData } = await ordersAPI.returnOrder(orderToReturn.id, {
        reason: data.reason,
        resolution: data.resolution.toUpperCase().replace(/\s+/g, "_"),
        images: data.images,
      });
      applyUpdatedOrder(returnData);
      setActionMessage(returnData.rma ? `Return started. Your RMA is ${returnData.rma}.` : "Return started.");
    } catch (error) {
      setActionMessage(describeApiError(error, "Could not start this return."));
    } finally {
      setActionLoading("");
    }
  };

  if (orders.status === "loading") return <LoadingPanel label="Loading your orders…" />;
  if (orders.status === "error") return <ErrorPanel title="Orders are unavailable" message={orders.message} onRetry={retry} />;

  if (orders.orders.length === 0) {
    return (
      <div className="py-12 text-center">
        <h2 className="font-display text-2xl text-brand-primary">Orders & Receipts</h2>
        <p className="mt-3 text-sm text-gray-500">No orders yet. Orders you place will appear here.</p>
        <Link to="/shop" className="mt-5 inline-block rounded-sm bg-brand-primary px-6 py-3 text-xs font-bold uppercase tracking-[0.12em] text-white hover:bg-brand-secondary hover:text-brand-primary">
          Start Shopping
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-brand-primary">Orders & Receipts</h2>
          <p className="mt-1 text-sm text-gray-500">Track orders, reprint receipts, and review previous purchases.</p>
        </div>
        <Link to="/track" className="rounded-sm border border-brand-primary px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-brand-primary hover:bg-brand-primary hover:text-white">
          Track an Order
        </Link>
      </div>

      {actionMessage && !selected && (
        <div role="status" className="mt-4 rounded-md border border-brand-secondary/30 bg-light-pink p-3 text-sm text-brand-primary">
          {actionMessage}
        </div>
      )}

      <div className="mt-6 space-y-4">
        {orders.orders.map((order) => {
          const canCancel = ["PENDING", "PROCESSING"].includes(order.status);
          const canPickup = order.status === "READY_FOR_PICKUP" && !order.pickedUpAt;
          return (
            <div key={order.id} className="overflow-hidden rounded-lg border border-light-gray bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-light-gray p-4">
                <div>
                  <p className="font-mono text-sm font-bold text-brand-primary">{order.orderNumber}</p>
                  <p className="text-xs text-gray-500">{new Date(order.createdAt).toLocaleDateString()}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClasses[order.status] ?? statusClasses.PENDING}`}>
                  {statusLabels[order.status] ?? order.status}
                </span>
              </div>

              <div className="p-4">
                <div className="space-y-2">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 text-sm">
                      {item.productImage && <img src={item.productImage} alt="" className="h-12 w-12 rounded-sm object-cover" />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-brand-primary">{item.productName}</p>
                        <p className="text-xs text-gray-500">
                          Qty {item.quantity}
                          {item.variantAttributes && Object.values(item.variantAttributes).length > 0 && ` - ${Object.values(item.variantAttributes).join(" / ")}`}
                        </p>
                      </div>
                      <p className="font-semibold">{formatKES(item.subtotal)}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-light-gray pt-4">
                  <div>
                    <p className="text-xs text-gray-500">Payment: {paymentLabel(order)}</p>
                    <p className="font-display text-xl text-brand-primary">{formatKES(order.total)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => { setActionMessage(""); setSelected(order); }} className="rounded-sm border border-light-gray px-3 py-2 text-[11px] font-bold uppercase tracking-wider hover:border-brand-primary">
                      Details
                    </button>
                    <button type="button" onClick={() => printReceipt(order, user, brandName, logoUrl)} className="rounded-sm border border-brand-primary px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-brand-primary hover:bg-brand-primary hover:text-white">
                      Receipt
                    </button>
                    <button type="button" onClick={() => navigate(`/track?order=${encodeURIComponent(order.orderNumber)}`)} className="rounded-sm bg-brand-primary px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary">
                      Track Order
                    </button>
                    {canCancel && (
                      <button type="button" disabled={actionLoading === `${order.id}-cancel`} onClick={() => cancelOrder(order)} className="rounded-sm border border-error px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-error hover:bg-error hover:text-white disabled:opacity-50">
                        Cancel & Refund
                      </button>
                    )}
                    {canPickup && (
                      <button type="button" disabled={actionLoading === `${order.id}-pickup`} onClick={() => pickupOrder(order)} className="rounded-sm border border-success px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-success hover:bg-success hover:text-white disabled:opacity-50">
                        Pick Up
                      </button>
                    )}
                    {order.pickedUpAt && (
                      <button type="button" disabled className="cursor-not-allowed rounded-sm border border-gray-300 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500">
                        Already Picked
                      </button>
                    )}
                    {canReturn(order) && (
                      <button type="button" disabled={actionLoading === `${order.id}-return`} onClick={() => returnOrder(order)} className="rounded-sm border border-brand-accent px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-brand-accent hover:bg-brand-accent hover:text-white disabled:opacity-50">
                        Return
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <ModalDialog open label="Receipt Details" onClose={() => setSelected(null)}>
          <div className="relative max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-lg bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-xl text-brand-primary">Receipt Details</h3>
                <p className="font-mono text-sm text-gray-500">{selected.orderNumber}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="text-gray-500 hover:text-brand-primary">Close</button>
            </div>
            {actionMessage && <p role="status" className="mt-4 rounded-md border border-brand-secondary/30 bg-light-pink p-3 text-sm text-brand-primary">{actionMessage}</p>}
            <div className="mt-5 space-y-3 text-sm">
              <p><strong>Customer:</strong> {customerName(user)}</p>
              <p><strong>Email:</strong> {user?.email ?? ""}</p>
              <p><strong>Delivery:</strong> {deliveryAddress(selected)}</p>
              <p><strong>Payment:</strong> {paymentLabel(selected)}</p>
              <p><strong>Total:</strong> {formatKES(selected.total)}</p>
            </div>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => navigate(`/track?order=${encodeURIComponent(selected.orderNumber)}`)} className="rounded-sm bg-brand-primary py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary">
                Track Order
              </button>
              <button type="button" onClick={() => printReceipt(selected, user, brandName, logoUrl)} className="rounded-sm border border-brand-primary py-3 text-xs font-bold uppercase tracking-wider text-brand-primary hover:bg-brand-primary hover:text-white">
                Print Receipt
              </button>
              {["PENDING", "PROCESSING"].includes(selected.status) && (
                <button type="button" disabled={actionLoading === `${selected.id}-cancel`} onClick={() => cancelOrder(selected)} className="rounded-sm border border-error py-3 text-xs font-bold uppercase tracking-wider text-error hover:bg-error hover:text-white disabled:opacity-50">
                  Cancel & Refund
                </button>
              )}
              {selected.status === "READY_FOR_PICKUP" && !selected.pickedUpAt && (
                <button type="button" disabled={actionLoading === `${selected.id}-pickup`} onClick={() => pickupOrder(selected)} className="rounded-sm border border-success py-3 text-xs font-bold uppercase tracking-wider text-success hover:bg-success hover:text-white disabled:opacity-50">
                  Pick Up
                </button>
              )}
              {selected.pickedUpAt && (
                <button type="button" disabled className="cursor-not-allowed rounded-sm border border-gray-300 py-3 text-xs font-bold uppercase tracking-wider text-gray-500">
                  Already Picked
                </button>
              )}
              {canReturn(selected) && (
                <button type="button" disabled={actionLoading === `${selected.id}-return`} onClick={() => returnOrder(selected)} className="rounded-sm border border-brand-accent py-3 text-xs font-bold uppercase tracking-wider text-brand-accent hover:bg-brand-accent hover:text-white disabled:opacity-50">
                  Return
                </button>
              )}
            </div>
          </div>
        </ModalDialog>
      )}

      <CancelOrderModal
        isOpen={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        orderId={orderToCancel?.id ?? ""}
        onOrderCancelled={handleOrderCancelled}
      />
      <ReturnOrderModal
        isOpen={returnModalOpen}
        onClose={() => setReturnModalOpen(false)}
        orderId={orderToReturn?.id ?? ""}
        onReturn={handleReturnSubmit}
      />
      <ConfirmModal
        open={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmDisabled={!confirmModal.onConfirm}
        onConfirm={() => confirmModal.onConfirm?.()}
        onCancel={() => setConfirmModal({ isOpen: false, title: "", message: "", onConfirm: null })}
      />
    </div>
  );
}
