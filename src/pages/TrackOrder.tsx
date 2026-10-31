import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Breadcrumb, Container } from "../components/ui";
import { Link, parseRoute } from "../router";
import { ordersAPI, type Order, type OrderTracking } from "../api/orders";
import { apiStatus, describeApiError } from "../api/errors";
import { useAuth } from "../contexts/AuthContext";

const ACTIVE_ORDER_LIMIT = 100;
const COPIED_FEEDBACK_MS = 2000;

type TrackState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "found"; tracking: OrderTracking }
  | { status: "not-found" }
  | { status: "error"; message: string };

function formatStatus(status: string) {
  return status.replace(/_/g, " ");
}

function formatTrackTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-KE", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export default function TrackOrder({ route }: { route: string }) {
  const { params } = parseRoute(route);
  const prefilledOrder = params.get("order") ?? "";
  const { user } = useAuth();

  const [orderNumber, setOrderNumber] = useState(prefilledOrder);
  const [result, setResult] = useState<TrackState>({ status: "idle" });
  const [copied, setCopied] = useState(false);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [activeError, setActiveError] = useState("");

  const runTrack = useCallback(async (number: string) => {
    const trimmed = number.trim();
    if (!trimmed) return;
    setResult({ status: "searching" });
    try {
      const { data } = await ordersAPI.track(trimmed);
      setResult({ status: "found", tracking: data });
    } catch (error) {
      setResult(apiStatus(error) === 404
        ? { status: "not-found" }
        : { status: "error", message: describeApiError(error, "Tracking is unavailable right now.") });
    }
  }, []);

  useEffect(() => {
    if (prefilledOrder) void runTrack(prefilledOrder);
  }, [prefilledOrder, runTrack]);

  useEffect(() => {
    if (!user) return;
    ordersAPI.getMyOrders({ limit: ACTIVE_ORDER_LIMIT })
      .then(({ data }) => {
        setActiveError("");
        setActiveOrders(data.orders.filter((order) => !["DELIVERED", "CANCELLED", "RETURNED"].includes(order.status)));
      })
      .catch((error: unknown) => setActiveError(describeApiError(error, "Your active orders could not be loaded.")));
  }, [user]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleTrack = (event: FormEvent) => {
    event.preventDefault();
    void runTrack(orderNumber);
  };

  const copyOrderNumber = (number: string) => {
    navigator.clipboard.writeText(number).then(() => setCopied(true)).catch(() => undefined);
  };

  return (
    <Container className="py-8">
      <div className="flex items-center justify-between">
        <Breadcrumb items={[{ label: "Track Order" }]} />
        <button type="button" onClick={() => window.history.back()} className="text-[11px] font-bold uppercase tracking-wider text-brand-primary hover:text-brand-secondary">
          Back
        </button>
      </div>

      <div className="mx-auto mt-10 max-w-xl rounded-lg bg-white p-8 shadow-sm">
        <h1 className="font-display text-2xl uppercase tracking-wider text-brand-primary">Track Your Order</h1>
        <p className="mt-2 text-sm text-gray-500">Enter your order number to see its current status.</p>

        <form onSubmit={handleTrack} className="mt-8 flex flex-col gap-3 sm:flex-row">
          <input
            required
            aria-label="Order number"
            value={orderNumber}
            onChange={(event) => { setOrderNumber(event.target.value); setResult({ status: "idle" }); }}
            placeholder="Order number"
            className="flex-1 rounded-sm border border-light-gray bg-off-white px-4 py-3 text-sm outline-none focus:border-brand-secondary"
          />
          <button type="submit" className="rounded-sm bg-brand-primary px-8 py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary">
            Track
          </button>
        </form>

        {result.status === "searching" && (
          <div role="status" className="mt-10 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-brand-secondary border-t-transparent" />
            <p className="mt-3 text-xs text-gray-500">Searching...</p>
          </div>
        )}

        {result.status === "not-found" && (
          <div role="alert" className="mt-8 rounded-md border border-error/20 bg-error/10 p-4 text-sm text-error">
            We could not find that order number. Check the number on your receipt and try again.
          </div>
        )}

        {result.status === "error" && (
          <div role="alert" className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-md border border-error/20 bg-error/10 p-4 text-sm text-error">
            <span>{result.message}</span>
            <button type="button" onClick={() => void runTrack(orderNumber)} className="font-bold underline">Try again</button>
          </div>
        )}

        {result.status === "found" && (
          <div className="mt-10 animate-fade-in space-y-6">
            <div className="flex items-center justify-between rounded-md bg-off-white p-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Order Number</p>
                <p className="mt-0.5 font-mono text-sm font-bold text-brand-primary">{result.tracking.orderNumber}</p>
              </div>
              <button
                type="button"
                onClick={() => copyOrderNumber(result.tracking.orderNumber)}
                className={`rounded-sm border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all ${
                  copied ? "border-success bg-success/5 text-success" : "border-light-gray text-gray-500 hover:border-brand-primary hover:text-brand-primary"
                }`}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

            <div className="flex items-center justify-between border-b border-light-gray pb-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Status</p>
                <p className="text-sm font-bold uppercase tracking-wide text-success">{formatStatus(result.tracking.status)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Last Update</p>
                <p className="text-sm font-semibold text-brand-primary">
                  {result.tracking.trackingHistory[0] ? formatTrackTime(result.tracking.trackingHistory[0].createdAt) : "No updates yet"}
                </p>
              </div>
            </div>

            {result.tracking.trackingHistory.length ? (
              <ol className="relative space-y-0 pl-6">
                {result.tracking.trackingHistory.map((step, index, steps) => (
                  <li key={step.id} className="relative flex gap-4 pb-8 last:pb-0">
                    {index < steps.length - 1 && <div className="absolute -left-[18.5px] top-5 h-full w-px bg-light-gray" />}
                    <div className={`absolute -left-6 top-1 z-10 h-3.5 w-3.5 rounded-full border-2 ${
                      index === 0 ? "border-success bg-success shadow-[0_0_0_3px_rgba(35,122,75,0.15)]" : "border-brand-secondary bg-brand-secondary"
                    }`} />
                    <div className="ml-1">
                      <p className={`text-sm font-semibold ${index === 0 ? "text-success" : "text-brand-primary"}`}>{step.description || formatStatus(step.status)}</p>
                      <p className="text-xs text-gray-500">{step.location || formatStatus(step.status)}</p>
                      <p className="mt-0.5 text-[10px] text-gray-500">{formatTrackTime(step.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-gray-500">No tracking events have been recorded for this order yet.</p>
            )}
          </div>
        )}

        {user && activeError && <p role="status" className="mt-8 text-xs text-error">{activeError}</p>}
        {user && activeOrders.length > 0 && (
          <div className="mt-10 animate-fade-in">
            <h2 className="mb-4 font-display text-lg uppercase tracking-wider text-brand-primary">Your Active Orders</h2>
            <div className="space-y-3">
              {activeOrders.map((order) => (
                <div key={order.id} className="rounded-md border border-light-gray bg-white p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-mono text-sm font-bold text-brand-primary">{order.orderNumber}</p>
                      <p className="text-xs text-gray-500">{new Date(order.createdAt).toLocaleDateString()}</p>
                    </div>
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-charcoal">{formatStatus(order.status)}</span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setOrderNumber(order.orderNumber); void runTrack(order.orderNumber); }}
                      className="text-xs font-semibold text-brand-primary hover:text-brand-secondary"
                    >
                      Track
                    </button>
                    <Link to="/account/orders" className="text-xs font-semibold text-gray-500 hover:text-brand-primary">
                      View Details
                    </Link>
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
