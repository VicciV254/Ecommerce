import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, navigate } from "../router";
import { useAuth } from "../contexts/AuthContext";
import { ordersAPI } from "../api/orders";
import { formatKES } from "../store/StoreContext";
import { getReceipts, type LocalReceipt } from "../utils/userReceipts";
import CancelOrderModal from "../components/CancelOrderModal";
import ReturnOrderModal from "../components/ReturnOrderModal";

type OrderStatus = LocalReceipt["status"] | "CANCELLED" | "AWAITING_REFUND" | "RETURNED";
type AccountOrder = Omit<LocalReceipt, "status" | "paymentStatus"> & {
  status: OrderStatus;
  paymentStatus: "PENDING" | "PAID" | "FAILED" | "REFUNDED";
  source?: "backend" | "local";
  pickedUpAt?: string;
};

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

function mapBackendOrder(order: any, fallbackUser: ReturnType<typeof useAuth>["user"]): AccountOrder {
  const address = order.address || {};
  const user = order.user || fallbackUser;
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    items: (order.items || []).map((item: any) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      productPrice: Number(item.productPrice || 0),
      quantity: Number(item.quantity || 0),
      subtotal: Number(item.subtotal || 0),
      productImage: item.productImage || undefined,
    })),
    subtotal: Number(order.subtotal || 0),
    tax: Number(order.tax || 0),
    shippingCost: Number(order.shippingCost || 0),
    total: Number(order.total || 0),
    status: order.status || "PENDING",
    paymentMethod: String(order.paymentMethod || "MPESA").toLowerCase().replace(/_/g, "-"),
    paymentStatus: order.paymentStatus || "PAID",
    deliveryMethod: order.deliveryMethod || "STANDARD",
    address: {
      name: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.name || "Customer",
      email: user?.email || "",
      phone: user?.phone || "",
      address: address.address || address.street || "Not provided",
      city: address.city || "Not provided",
      county: address.county || "Not provided",
      zip: address.zip || address.postalCode || "",
    },
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    source: "backend",
    pickedUpAt: order.pickedUpAt,
  };
}

function receiptLogoUrl() {
  const img = document.querySelector<HTMLImageElement>('img[src*="logo"]');
  return img?.src || `${window.location.origin}/images/logo.png`;
}

function receiptTheme() {
  const styles = getComputedStyle(document.documentElement);
  return {
    primary: styles.getPropertyValue("--color-brand-primary").trim() || "#2b1b12",
    secondary: styles.getPropertyValue("--color-brand-secondary").trim() || "#d7a84f",
    accent: styles.getPropertyValue("--color-brand-accent").trim() || "#8a4f2a",
    background: styles.getPropertyValue("--color-light-pink").trim() || "#fff6f7",
  };
}

function paymentLabel(order: AccountOrder) {
  if (order.paymentMethod === "visual" || (order.paymentMethod === "card" && order.paymentStatus === "PAID")) {
    return "visual payment";
  }
  return order.paymentMethod.replace("-", " ");
}

function printReceipt(order: AccountOrder) {
  const theme = receiptTheme();
  const logoUrl = receiptLogoUrl();
  const lines = order.items
    .map(
      (item) =>
        `<tr><td>${item.productName}</td><td>${item.quantity}</td><td>${formatKES(item.productPrice)}</td><td>${formatKES(item.subtotal)}</td></tr>`
    )
    .join("");

  const popup = window.open("", "_blank", "width=720,height=900");
  if (!popup) return;

  popup.document.write(`
    <html>
      <head>
        <title>Receipt ${order.orderNumber}</title>
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
          .label { color: #777; font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
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
            <img src="${logoUrl}" alt="No Maneno Bazaar logo" />
            <div>
              <h1>No Maneno Bazaar</h1>
              <p>Official receipt for ${order.orderNumber}</p>
            </div>
          </section>
          <section class="content">
            <div class="grid">
              <div class="box"><div class="label">Date</div><div class="value">${new Date(order.createdAt).toLocaleString()}</div></div>
              <div class="box"><div class="label">Status</div><div class="value">${statusLabels[order.status] || order.status}</div></div>
              <div class="box"><div class="label">Customer</div><div class="value">${order.address.name}<br>${order.address.email}<br>${order.address.phone}</div></div>
              <div class="box"><div class="label">Delivery</div><div class="value">${order.address.address}, ${order.address.city}, ${order.address.county}</div></div>
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
          <section class="footer">Thank you for shopping with No Maneno Bazaar.</section>
        </main>
      </body>
    </html>
  `);
  popup.document.close();
  popup.focus();
  popup.print();
}

export default function AccountOrders() {
  const { user } = useAuth();
  const [selected, setSelected] = useState<AccountOrder | null>(null);
  const [backendOrders, setBackendOrders] = useState<AccountOrder[]>([]);
  const [actionMessage, setActionMessage] = useState("");
  const [actionLoading, setActionLoading] = useState("");
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [orderToCancel, setOrderToCancel] = useState<AccountOrder | null>(null);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [orderToReturn, setOrderToReturn] = useState<AccountOrder | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: (() => void) | null }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: null
  });

  const loadBackendOrders = useCallback(async () => {
    if (!user) {
      setBackendOrders([]);
      return;
    }

    const { data } = await ordersAPI.getMyOrders({ limit: 100 }) as any;
    setBackendOrders((data.orders || []).map((order: any) => mapBackendOrder(order, user)));
  }, [user]);

  useEffect(() => {
    loadBackendOrders().catch(() => setBackendOrders([]));
  }, [loadBackendOrders]);

  const applyUpdatedOrder = (order: any) => {
    const mapped = mapBackendOrder(order, user);
    setBackendOrders((current) => current.map((item) => item.id === mapped.id ? mapped : item));
    setSelected((current) => current?.id === mapped.id ? mapped : current);
  };

  const cancelOrder = async (order: AccountOrder) => {
    setOrderToCancel(order);
    setCancelModalOpen(true);
  };

  const handleOrderCancelled = () => {
    loadBackendOrders();
    setActionMessage("Order cancelled successfully");
  };

  const isWithinReturnWindow = (pickedUpAt: string) => {
    if (!pickedUpAt) return false;
    const pickupTime = new Date(pickedUpAt);
    const now = new Date();
    const diffMinutes = (now.getTime() - pickupTime.getTime()) / (1000 * 60);
    return diffMinutes <= 5;
  };

  const pickupOrder = async (order: AccountOrder) => {
    setConfirmModal({
      isOpen: true,
      title: "Confirm Pickup",
      message: "Confirm that you have picked up this order from No Maneno Bazaar?",
      onConfirm: async () => {
        setConfirmModal({ isOpen: false, title: "", message: "", onConfirm: null });
        setActionLoading(`${order.id}-pickup`);
        setActionMessage("");
        try {
          const { data } = await ordersAPI.pickup(order.id);
          applyUpdatedOrder(data);
          setActionMessage("Pickup confirmed. The order is now marked as delivered.");
        } catch (error: any) {
          setActionMessage(error?.response?.data?.error || "Could not confirm pickup.");
        } finally {
          setActionLoading("");
        }
      }
    });
  };

  const returnOrder = async (order: AccountOrder) => {
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
      }) as any;
      applyUpdatedOrder(returnData);
      setActionMessage(returnData.rma ? `Return started. Your RMA is ${returnData.rma}.` : "Return started.");
    } catch (error: any) {
      setActionMessage(error?.response?.data?.error || "Could not start this return.");
    } finally {
      setActionLoading("");
    }
  };

  const localOrders = useMemo<AccountOrder[]>(() => getReceipts(user).map((receipt) => ({ ...receipt, source: "local" })), [user]);
  const orders = useMemo(() => {
    const seen = new Set<string>();
    return [...backendOrders, ...localOrders].filter((order) => {
      if (seen.has(order.orderNumber)) return false;
      seen.add(order.orderNumber);
      return true;
    });
  }, [backendOrders, localOrders]);

  if (orders.length === 0) {
    return (
      <div className="py-12 text-center">
        <h2 className="font-display text-2xl text-brand-primary">Orders & Receipts</h2>
        <p className="mt-3 text-sm text-gray-500">No orders yet. Your receipts will appear here after checkout.</p>
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

      {actionMessage && (
        <div className="mt-4 rounded-md border border-brand-secondary/30 bg-light-pink p-3 text-sm text-brand-primary">
          {actionMessage}
        </div>
      )}

      <div className="mt-6 space-y-4">
        {orders.map((order) => {
          const isBackend = order.source === "backend";
          const canCancel = isBackend && ["PENDING", "PROCESSING"].includes(order.status);
          const canPickup = isBackend && order.status === "READY_FOR_PICKUP" && !order.pickedUpAt;
          const canReturn = isBackend && order.status === "DELIVERED" && !order.pickedUpAt || (isBackend && order.status === "DELIVERED" && order.pickedUpAt && isWithinReturnWindow(order.pickedUpAt));
          const isPickedUp = !!order.pickedUpAt;
          return (
          <div key={`${order.source}-${order.id}`} className="overflow-hidden rounded-lg border border-light-gray bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-light-gray p-4">
              <div>
                <p className="font-mono text-sm font-bold text-brand-primary">{order.orderNumber}</p>
                <p className="text-xs text-gray-500">{new Date(order.createdAt).toLocaleDateString()}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClasses[order.status] || statusClasses.PENDING}`}>
                {statusLabels[order.status] || order.status}
              </span>
            </div>

            <div className="p-4">
              <div className="space-y-2">
                {order.items.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 text-sm">
                    {item.productImage && <img src={item.productImage} alt="" className="h-12 w-12 rounded-sm object-cover" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-brand-primary">{item.productName}</p>
                      <p className="text-xs text-gray-500">Qty {item.quantity}{item.size ? ` - ${item.size}` : ""}{item.color ? ` - ${item.color}` : ""}</p>
                    </div>
                    <p className="font-semibold">{formatKES(item.subtotal)}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-light-gray pt-4">
                <div>
                  <p className="text-xs text-gray-500">Paid with {paymentLabel(order)}</p>
                  <p className="font-display text-xl text-brand-primary">{formatKES(order.total)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setSelected(order)} className="rounded-sm border border-light-gray px-3 py-2 text-[11px] font-bold uppercase tracking-wider hover:border-brand-primary">
                    Details
                  </button>
                  <button onClick={() => printReceipt(order)} className="rounded-sm border border-brand-primary px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-brand-primary hover:bg-brand-primary hover:text-white">
                    Receipt
                  </button>
                  <button onClick={() => navigate(`/track?order=${encodeURIComponent(order.orderNumber)}`)} className="rounded-sm bg-brand-primary px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary">
                    Track Order
                  </button>
                  {canCancel && (
                    <button disabled={actionLoading === `${order.id}-cancel`} onClick={() => cancelOrder(order)} className="rounded-sm border border-error px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-error hover:bg-error hover:text-white disabled:opacity-50">
                      Cancel & Refund
                    </button>
                  )}
                  {canPickup && (
                    <button disabled={actionLoading === `${order.id}-pickup`} onClick={() => pickupOrder(order)} className="rounded-sm border border-success px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-success hover:bg-success hover:text-white disabled:opacity-50">
                      Pick Up
                    </button>
                  )}
                  {isPickedUp && (
                    <button disabled className="rounded-sm border border-gray-300 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-400 cursor-not-allowed">
                      Already Picked
                    </button>
                  )}
                  {canReturn && (
                    <button disabled={actionLoading === `${order.id}-return`} onClick={() => returnOrder(order)} className="rounded-sm border border-brand-accent px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-brand-accent hover:bg-brand-accent hover:text-white disabled:opacity-50">
                      Return
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );})}
      </div>

      {selected && (
        <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
          <button className="absolute inset-0 bg-black/30" aria-label="Close receipt details" onClick={() => setSelected(null)} />
          <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-xl text-brand-primary">Receipt Details</h3>
                <p className="font-mono text-sm text-gray-500">{selected.orderNumber}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-brand-primary">Close</button>
            </div>
            <div className="mt-5 space-y-3 text-sm">
              <p><strong>Customer:</strong> {selected.address.name}</p>
              <p><strong>Email:</strong> {selected.address.email}</p>
              <p><strong>Delivery:</strong> {selected.address.address}, {selected.address.city}, {selected.address.county}</p>
              <p><strong>Payment:</strong> {paymentLabel(selected)} ({selected.paymentStatus})</p>
              <p><strong>Total:</strong> {formatKES(selected.total)}</p>
            </div>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              <button onClick={() => navigate(`/track?order=${encodeURIComponent(selected.orderNumber)}`)} className="rounded-sm bg-brand-primary py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary">
                Track Order
              </button>
              <button onClick={() => printReceipt(selected)} className="rounded-sm border border-brand-primary py-3 text-xs font-bold uppercase tracking-wider text-brand-primary hover:bg-brand-primary hover:text-white">
                Print Receipt
              </button>
              {selected.source === "backend" && ["PENDING", "PROCESSING"].includes(selected.status) && (
                <button disabled={actionLoading === `${selected.id}-cancel`} onClick={() => cancelOrder(selected)} className="rounded-sm border border-error py-3 text-xs font-bold uppercase tracking-wider text-error hover:bg-error hover:text-white disabled:opacity-50">
                  Cancel & Refund
                </button>
              )}
              {selected.source === "backend" && selected.status === "READY_FOR_PICKUP" && !selected.pickedUpAt && (
                <button disabled={actionLoading === `${selected.id}-pickup`} onClick={() => pickupOrder(selected)} className="rounded-sm border border-success py-3 text-xs font-bold uppercase tracking-wider text-success hover:bg-success hover:text-white disabled:opacity-50">
                  Pick Up
                </button>
              )}
              {selected.source === "backend" && selected.pickedUpAt && (
                <button disabled className="rounded-sm border border-gray-300 py-3 text-xs font-bold uppercase tracking-wider text-gray-400 cursor-not-allowed">
                  Already Picked
                </button>
              )}
              {selected.source === "backend" && selected.status === "DELIVERED" && (!selected.pickedUpAt || isWithinReturnWindow(selected.pickedUpAt)) && (
                <button disabled={actionLoading === `${selected.id}-return`} onClick={() => returnOrder(selected)} className="rounded-sm border border-brand-accent py-3 text-xs font-bold uppercase tracking-wider text-brand-accent hover:bg-brand-accent hover:text-white disabled:opacity-50">
                  Return
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <CancelOrderModal
        isOpen={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        orderId={orderToCancel?.id || ''}
        onOrderCancelled={handleOrderCancelled}
      />
      <ReturnOrderModal
        isOpen={returnModalOpen}
        onClose={() => setReturnModalOpen(false)}
        orderId={orderToReturn?.id || ''}
        onReturn={handleReturnSubmit}
      />
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg bg-white p-6 shadow-lg max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-brand-primary mb-2">{confirmModal.title}</h3>
            <p className="text-sm text-gray-600 mb-4">{confirmModal.message}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmModal({ isOpen: false, title: "", message: "", onConfirm: null })}
                className="px-4 py-2 rounded-sm border border-light-gray text-sm font-medium text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmModal.onConfirm || (() => {})}
                className="px-4 py-2 rounded-sm bg-brand-primary text-sm font-medium text-white hover:bg-brand-secondary"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
