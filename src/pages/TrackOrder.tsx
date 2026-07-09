import { useState, useEffect } from "react";
import { Breadcrumb, Container } from "../components/ui";
import { parseRoute } from "../router";
import { ordersAPI } from "../api/orders";
import { findReceiptByOrderNumber, type LocalReceipt } from "../utils/userReceipts";

type TrackEvent = {
  status: string;
  description: string;
  location?: string;
  createdAt: string;
};

type BackendTracking = {
  orderNumber: string;
  status: string;
  trackingHistory: TrackEvent[];
};

const fallbackTimeline: TrackEvent[] = [
  { status: "OUT_FOR_DELIVERY", description: "Out for Delivery", location: "Mombasa CBD Hub", createdAt: new Date().toISOString() },
  { status: "SHIPPED", description: "Arrived at Sorting Facility", location: "Mombasa Main Station", createdAt: new Date().toISOString() },
  { status: "SHIPPED", description: "Order Shipped", location: "Dispatched from warehouse", createdAt: new Date().toISOString() },
  { status: "PROCESSING", description: "Order Processed", location: "No Maneno Bazaar Warehouse", createdAt: new Date().toISOString() },
  { status: "PENDING", description: "Order Placed", location: "Payment confirmed", createdAt: new Date().toISOString() },
];

function formatStatus(status: string) {
  return status.replace(/_/g, " ");
}

function formatTrackTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-KE", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function TrackOrder({ route }: { route: string }) {
  const { params } = parseRoute(route);
  const prefilledOrder = params.get("order") ?? "";

  const [orderId, setOrderId] = useState(prefilledOrder);
  const [status, setStatus] = useState<null | "searching" | "found" | "not-found">(null);
  const [copied, setCopied] = useState(false);
  const [receipt, setReceipt] = useState<LocalReceipt | null>(null);
  const [backendTracking, setBackendTracking] = useState<BackendTracking | null>(null);

  const runTrack = async (number: string) => {
    const trimmed = number.trim();
    if (!trimmed) return;
    setStatus("searching");
    setReceipt(null);
    setBackendTracking(null);

    try {
      const response = (await ordersAPI.track(trimmed)) as { data: BackendTracking };
      setBackendTracking(response.data);
      setStatus("found");
      return;
    } catch {
      const localReceipt = findReceiptByOrderNumber(trimmed);
      setReceipt(localReceipt);
      setStatus(localReceipt ? "found" : "not-found");
    }
  };

  useEffect(() => {
    if (prefilledOrder) {
      setOrderId(prefilledOrder);
      runTrack(prefilledOrder);
    }
  }, [prefilledOrder]);

  const handleTrack = (e: React.FormEvent) => {
    e.preventDefault();
    runTrack(orderId);
  };

  const copyOrderId = () => {
    navigator.clipboard.writeText(orderId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const timeline = backendTracking?.trackingHistory?.length
    ? backendTracking.trackingHistory
    : receipt
      ? [
          { status: receipt.status, description: formatStatus(receipt.status), location: "No Maneno Bazaar", createdAt: receipt.updatedAt },
          { status: "PENDING", description: "Order Placed", location: "Payment confirmed", createdAt: receipt.createdAt },
        ]
      : fallbackTimeline;

  const currentStatus = backendTracking?.status || receipt?.status || "IN_TRANSIT";

  return (
    <Container className="py-8">
      <div className="flex items-center justify-between">
        <Breadcrumb items={[{ label: "Track Order" }]} />
        <button onClick={() => window.history.back()} className="text-[11px] font-bold uppercase tracking-wider text-brand-primary hover:text-brand-secondary">
          Back
        </button>
      </div>

      <div className="mx-auto mt-10 max-w-xl rounded-lg bg-light-pink p-8 shadow-sm">
        <h1 className="font-display text-2xl uppercase tracking-wider text-brand-primary">Track Your Order</h1>
        <p className="mt-2 text-sm text-gray-400">Enter your order number to see current status and location.</p>

        <form onSubmit={handleTrack} className="mt-8 flex flex-col gap-3 sm:flex-row">
          <input
            required
            value={orderId}
            onChange={(e) => { setOrderId(e.target.value); setStatus(null); }}
            placeholder="Order Number (e.g. NM-2026-123456)"
            className="flex-1 rounded-sm border border-light-gray bg-off-white px-4 py-3 text-sm outline-none focus:border-brand-secondary"
          />
          <button type="submit" className="rounded-sm bg-brand-primary px-8 py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary">
            Track
          </button>
        </form>

        {status === "searching" && (
          <div className="mt-10 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-brand-secondary border-t-transparent" />
            <p className="mt-3 text-xs text-gray-400">Searching...</p>
          </div>
        )}

        {status === "not-found" && (
          <div className="mt-8 rounded-md border border-error/20 bg-error/10 p-4 text-sm text-error">
            We could not find that order number. Check the number on your receipt and try again.
          </div>
        )}

        {status === "found" && (
          <div className="mt-10 animate-fade-in space-y-6">
            <div className="flex items-center justify-between rounded-md bg-off-white p-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Order Number</p>
                <p className="mt-0.5 font-mono text-sm font-bold text-brand-primary">{orderId}</p>
              </div>
              <button
                onClick={copyOrderId}
                className={`rounded-sm border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${
                  copied
                    ? "border-success bg-success/5 text-success"
                    : "border-light-gray text-gray-400 hover:border-brand-primary hover:text-brand-primary"
                }`}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

            <div className="flex items-center justify-between border-b border-light-gray pb-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Status</p>
                <p className="text-sm font-bold uppercase tracking-wide text-success">
                  {formatStatus(currentStatus)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Last Update</p>
                <p className="text-sm font-semibold text-brand-primary">
                  {timeline[0] ? formatTrackTime(timeline[0].createdAt) : "Pending"}
                </p>
              </div>
            </div>

            {receipt && (
              <div className="rounded-md bg-off-white p-4 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-gray-500">Total</span>
                  <span className="font-bold text-brand-primary">KES {receipt.total.toLocaleString("en-KE")}</span>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Delivering to {receipt.address.address}, {receipt.address.city}, {receipt.address.county}
                </p>
              </div>
            )}

            <div className="relative space-y-0 pl-6">
              {timeline.map((step, i, arr) => (
                <div key={`${step.status}-${step.createdAt}-${i}`} className="relative flex gap-4 pb-8 last:pb-0">
                  {i < arr.length - 1 && (
                    <div className="absolute -left-[18.5px] top-5 h-full w-px bg-light-gray" />
                  )}
                  <div className={`absolute -left-6 top-1 z-10 h-3.5 w-3.5 rounded-full border-2 ${
                    i === 0
                      ? "border-success bg-success shadow-[0_0_0_3px_rgba(39,174,96,0.15)]"
                      : "border-brand-secondary bg-brand-secondary"
                  }`} />
                  <div className="ml-1">
                    <p className={`text-sm font-semibold ${i === 0 ? "text-success" : "text-brand-primary"}`}>{step.description || formatStatus(step.status)}</p>
                    <p className="text-xs text-gray-400">{step.location || formatStatus(step.status)}</p>
                    <p className="mt-0.5 text-[10px] text-gray-300">{formatTrackTime(step.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Container>
  );
}
