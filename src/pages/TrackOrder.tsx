import { useState, useEffect } from "react";
import { Breadcrumb, Container } from "../components/ui";
import { parseRoute } from "../router";

export function TrackOrder({ route }: { route: string }) {
  const { params } = parseRoute(route);
  const prefilledOrder = params.get("order") ?? "";

  const [orderId, setOrderId] = useState(prefilledOrder);
  const [status, setStatus] = useState<null | "searching" | "found">(null);
  const [copied, setCopied] = useState(false);

  // Auto-track if order number came from checkout
  useEffect(() => {
    if (prefilledOrder) {
      setOrderId(prefilledOrder);
      setStatus("searching");
      setTimeout(() => setStatus("found"), 1200);
    }
  }, [prefilledOrder]);

  const handleTrack = (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderId.trim()) return;
    setStatus("searching");
    setTimeout(() => setStatus("found"), 1200);
  };

  const copyOrderId = () => {
    navigator.clipboard.writeText(orderId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Container className="py-8">
      <div className="flex items-center justify-between">
        <Breadcrumb items={[{ label: "Track Order" }]} />
        <button onClick={() => window.history.back()} className="text-[11px] font-bold uppercase tracking-wider text-brand-primary hover:text-brand-secondary">
          ← Go Back
        </button>
      </div>

      <div className="mx-auto mt-10 max-w-xl rounded-lg bg-white p-8 shadow-sm">
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

        {status === "found" && (
          <div className="mt-10 animate-fade-in space-y-6">
            {/* Order ID with copy */}
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
                {copied ? (
                  <span className="flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-3 w-3"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                    Copied!
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-3 w-3"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" /></svg>
                    Copy
                  </span>
                )}
              </button>
            </div>

            {/* Status header */}
            <div className="flex items-center justify-between border-b border-light-gray pb-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Status</p>
                <p className="text-sm font-bold uppercase tracking-wide text-success">In Transit</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Expected Delivery</p>
                <p className="text-sm font-semibold text-brand-primary">Jan 22, 2026</p>
              </div>
            </div>

            {/* Timeline */}
            <div className="relative space-y-0 pl-6">
              {[
                { t: "Out for Delivery", d: "Mombasa CBD Hub", time: "Today, 2:15 PM", active: true },
                { t: "Arrived at Sorting Facility", d: "Mombasa Main Station", time: "Today, 8:30 AM", active: false },
                { t: "Order Shipped", d: "Dispatched from warehouse", time: "Jan 19, 5:00 PM", active: false },
                { t: "Order Processed", d: "No Maneno Bazaar Warehouse", time: "Jan 18, 3:45 PM", active: false },
                { t: "Order Placed", d: "Payment confirmed", time: "Jan 18, 11:24 AM", active: false },
              ].map((step, i, arr) => (
                <div key={i} className="relative flex gap-4 pb-8 last:pb-0">
                  {/* Line */}
                  {i < arr.length - 1 && (
                    <div className="absolute -left-[18.5px] top-5 h-full w-px bg-light-gray" />
                  )}
                  {/* Dot */}
                  <div className={`absolute -left-6 top-1 z-10 h-3.5 w-3.5 rounded-full border-2 ${
                    step.active
                      ? "border-success bg-success shadow-[0_0_0_3px_rgba(39,174,96,0.15)]"
                      : "border-brand-secondary bg-brand-secondary"
                  }`} />
                  <div className="ml-1">
                    <p className={`text-sm font-semibold ${step.active ? "text-success" : "text-brand-primary"}`}>{step.t}</p>
                    <p className="text-xs text-gray-400">{step.d}</p>
                    <p className="mt-0.5 text-[10px] text-gray-300">{step.time}</p>
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
