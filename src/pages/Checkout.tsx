import { useState } from "react";
import { getProduct } from "../data/products";
import { Breadcrumb, Container } from "../components/ui";
import { formatKES, useStore } from "../store/StoreContext";
import { Link, navigate } from "../router";

const STEPS = ["Shipping", "Delivery", "Payment"];

const DELIVERY = [
  { id: "pickup", label: "In-Store Pickup", desc: "Pick up at Digo Road, Mombasa", price: 0 },
  { id: "same-day", label: "Same-Day Delivery", desc: "Mombasa area only", price: 500 },
  { id: "standard", label: "Standard Delivery", desc: "Nationwide (3–5 business days)", price: 300 },
];

const PAYMENTS = [
  { id: "mpesa", label: "M-Pesa (Recommended)", icon: "📱" },
  { id: "card", label: "Card Payment", icon: "💳" },
  { id: "bank", label: "Bank Transfer", icon: "🏦" },
  { id: "cod", label: "Cash on Delivery (Mombasa only)", icon: "💵" },
];

export function Checkout() {
  const { state, clearCart } = useStore();
  const [step, setStep] = useState(0);
  const [delivery, setDelivery] = useState("standard");
  const [payment, setPayment] = useState("mpesa");
  const [orderNo, setOrderNo] = useState("");
  // pending navigation target after the copy-prompt popup
  const [copyPrompt, setCopyPrompt] = useState<null | { dest: string }>(null);
  const [ship, setShip] = useState({
    name: "", email: "", phone: "", address: "", city: "", county: "", zip: "",
  });

  const lines = state.cart
    .map((c) => ({ c, product: getProduct(c.productId) }))
    .filter((l) => l.product);
  const subtotal = lines.reduce((s, l) => s + l.product!.price * l.c.qty, 0);
  const deliveryFee = DELIVERY.find((d) => d.id === delivery)?.price ?? 0;
  const tax = Math.round(subtotal * 0.16);
  const total = subtotal + tax + deliveryFee;

  if (lines.length === 0 && !orderNo) {
    return (
      <Container className="py-20 text-center">
        <p className="text-6xl">🛒</p>
        <h1 className="mt-4 font-display text-2xl">Your cart is empty</h1>
        <Link to="/shop" className="mt-4 inline-block text-ocean-blue underline">Go Shopping</Link>
      </Container>
    );
  }

  // Confirmation
  if (orderNo) {
    return (
      <Container className="py-12">
        <div className="mx-auto max-w-2xl rounded-lg bg-white p-8 text-center shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-8 w-8 text-success"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /></svg>
          </div>
          <h1 className="mt-5 font-display text-2xl uppercase tracking-wider text-brand-primary">Order Confirmed!</h1>
          <p className="mt-2 text-sm text-gray-400">Thank you for shopping at No Maneno Bazaar — IKO KITU!</p>

          <div className="mt-6 rounded-md bg-off-white p-5 text-left text-sm">
            <div className="flex items-center justify-between border-b border-light-gray pb-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Order Number</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-base font-bold text-brand-primary">{orderNo}</span>
              </div>
            </div>
            <div className="flex justify-between py-3 text-xs">
              <span className="text-gray-400">Date</span>
              <span className="text-charcoal">{new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span>
            </div>
            <div className="space-y-1 border-t border-light-gray pt-3 text-xs text-charcoal">
              <p>📧 Confirmation sent to your email</p>
              {payment === "mpesa" && <p>📱 M-Pesa payment confirmation sent to your phone</p>}
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => setCopyPrompt({ dest: "/shop" })}
              className="flex-1 rounded-sm bg-brand-primary py-3 text-xs font-bold uppercase tracking-[0.12em] text-white transition-all hover:bg-brand-secondary hover:text-brand-primary"
            >
              Continue Shopping
            </button>
            <button
              onClick={() => setCopyPrompt({ dest: `/track?order=${encodeURIComponent(orderNo)}` })}
              className="flex-1 rounded-sm border border-brand-primary py-3 text-xs font-bold uppercase tracking-[0.12em] text-brand-primary transition-all hover:bg-brand-primary hover:text-white"
            >
              Track Order
            </button>
          </div>
        </div>

        {/* Copy-tracking-code prompt */}
        {copyPrompt && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/50 animate-fade-in"
              onClick={() => { const dest = copyPrompt.dest; setCopyPrompt(null); navigate(dest); }}
            />
            <div className="relative w-full max-w-sm animate-fade-in rounded-lg bg-white p-6 text-center shadow-2xl">
              <h3 className="font-display text-lg uppercase tracking-wider text-brand-primary">Copy Tracking Code?</h3>
              <p className="mt-2 text-sm text-gray-500">Save your tracking code before you continue.</p>
              <div className="mt-4 rounded-sm bg-off-white px-4 py-3 font-mono text-base font-bold text-brand-primary">
                {orderNo}
              </div>
              <div className="mt-5 flex gap-3">
                <button
                  onClick={() => { const dest = copyPrompt.dest; setCopyPrompt(null); navigate(dest); }}
                  className="flex-1 rounded-sm border border-light-gray py-2.5 text-xs font-bold uppercase tracking-wider text-charcoal transition-colors hover:bg-off-white"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(orderNo);
                    const dest = copyPrompt.dest;
                    setCopyPrompt(null);
                    navigate(dest);
                  }}
                  className="flex-1 rounded-sm bg-brand-primary py-2.5 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-brand-secondary hover:text-brand-primary"
                >
                  Copy Code
                </button>
              </div>
            </div>
          </div>
        )}
      </Container>
    );
  }

  const placeOrder = () => {
    const no = "NM-2026-" + Math.floor(100000 + Math.random() * 900000);
    setOrderNo(no);
    clearCart();
  };

  return (
    <Container className="py-8">
      <Breadcrumb items={[{ label: "Cart", to: "/cart" }, { label: "Checkout" }]} />

      <div className="mx-auto mt-6 flex max-w-2xl items-center justify-between">
        {STEPS.map((s, i) => (
          <div key={s} className="flex flex-1 items-center">
            <div className="flex flex-col items-center">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-sm text-xs font-bold ${
                  i <= step ? "bg-brand-primary text-white" : "bg-light-gray text-gray-400"
                }`}
              >
                {i + 1}
              </div>
              <span className={`mt-1.5 text-[9px] uppercase tracking-wider ${i <= step ? "text-brand-primary" : "text-gray-400"}`}>{s}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`mx-2 h-px flex-1 ${i < step ? "bg-brand-primary" : "bg-light-gray"}`} />
            )}
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="rounded-lg bg-white p-6 shadow-sm">
          {step === 0 && (
            <form onSubmit={(e) => { e.preventDefault(); setStep(1); }}>
              <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Shipping Details</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {[["name", "Full Name", "sm:col-span-2"], ["email", "Email"], ["phone", "Phone"], ["address", "Address", "sm:col-span-2"], ["city", "City"], ["county", "County"], ["zip", "ZIP Code"]].map(([key, label, span]) => (
                  <div key={key} className={span ?? ""}>
                    <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</label>
                    <input
                      required={key !== "zip"}
                      type={key === "email" ? "email" : "text"}
                      value={(ship as any)[key]}
                      onChange={(e) => setShip({ ...ship, [key]: e.target.value })}
                      className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2.5 text-sm outline-none focus:border-brand-secondary"
                    />
                  </div>
                ))}
              </div>
              <button className="mt-6 w-full rounded-sm bg-brand-primary py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-white hover:bg-brand-secondary hover:text-brand-primary">Continue to Delivery</button>
            </form>
          )}

          {step === 1 && (
            <div>
              <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Delivery Method</h2>
              <div className="mt-4 space-y-3">
                {DELIVERY.map((d) => (
                  <label key={d.id} className={`flex cursor-pointer items-center justify-between rounded-sm border p-4 ${delivery === d.id ? "border-brand-primary" : "border-light-gray"}`}>
                    <div className="flex items-center gap-3">
                      <input type="radio" checked={delivery === d.id} onChange={() => setDelivery(d.id)} className="accent-brand-primary" />
                      <div><p className="text-sm font-semibold text-brand-primary">{d.label}</p><p className="text-[10px] text-gray-400">{d.desc}</p></div>
                    </div>
                    <span className="text-xs font-bold text-brand-primary">{d.price === 0 ? "Free" : formatKES(d.price)}</span>
                  </label>
                ))}
              </div>
              <div className="mt-6 flex gap-3">
                <button onClick={() => setStep(0)} className="rounded-sm border border-light-gray px-6 py-3 text-xs font-bold uppercase tracking-wider">Back</button>
                <button onClick={() => setStep(2)} className="rounded-sm bg-brand-primary px-6 py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary">Continue to Payment</button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Payment Method</h2>
              <div className="mt-4 space-y-3">
                {PAYMENTS.map((pm) => (
                  <label key={pm.id} className={`block cursor-pointer rounded-sm border p-4 ${payment === pm.id ? "border-brand-primary" : "border-light-gray"}`}>
                    <div className="flex items-center gap-3">
                      <input type="radio" checked={payment === pm.id} onChange={() => setPayment(pm.id)} className="accent-brand-primary" />
                      <span className="text-lg">{pm.icon}</span>
                      <span className="text-sm font-semibold text-brand-primary">{pm.label}</span>
                    </div>
                  </label>
                ))}
              </div>
              <div className="mt-6 flex gap-3">
                <button onClick={() => setStep(1)} className="rounded-sm border border-light-gray px-6 py-3 text-xs font-bold uppercase tracking-wider">Back</button>
                <button onClick={placeOrder} className="rounded-sm bg-brand-primary px-6 py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary">Place Order</button>
              </div>
            </div>
          )}
        </div>

        <div className="h-fit rounded-lg bg-white p-6 shadow-sm">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Order Summary</h2>
          <div className="mt-4 space-y-3">
            {lines.map((l, i) => (
              <div key={i} className="flex justify-between text-xs text-charcoal">
                <span>{l.product!.name} <span className="text-gray-400">×{l.c.qty}</span></span>
                <span>{formatKES(l.product!.price * l.c.qty)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-2 border-t border-light-gray pt-4 text-xs">
            <div className="flex justify-between text-gray-500"><span>Subtotal</span><span>{formatKES(subtotal)}</span></div>
            <div className="flex justify-between text-gray-500"><span>Delivery</span><span>{deliveryFee === 0 ? "Free" : formatKES(deliveryFee)}</span></div>
            <div className="flex justify-between text-gray-500"><span>Tax (16%)</span><span>{formatKES(tax)}</span></div>
            <div className="flex justify-between border-t border-light-gray pt-2 font-display text-lg text-brand-primary">
              <span>Total</span><span>{formatKES(total)}</span>
            </div>
          </div>
        </div>
      </div>
    </Container>
  );
}
