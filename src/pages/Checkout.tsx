import { useEffect, useState } from "react";
import { getProduct } from "../data/products";
import { Breadcrumb, Container } from "../components/ui";
import { formatKES, useStore } from "../store/StoreContext";
import { Link, navigate } from "../router";
import { useAuth } from "../contexts/AuthContext";
import { saveReceipt, type LocalReceipt } from "../utils/userReceipts";
import { ordersAPI } from "../api/orders";

const STEPS = ["Shipping", "Delivery", "Payment"];

const DELIVERY = [
  { id: "pickup", label: "In-Store Pickup", desc: "Pick up at Digo Road, Mombasa", price: 0 },
  { id: "same-day", label: "Same-Day Delivery", desc: "Mombasa area only", price: 500 },
  { id: "standard", label: "Standard Delivery", desc: "Nationwide (3–5 business days)", price: 300 },
];

export default function Checkout() {
  const { state, clearCart } = useStore();
  const { user, addAddress } = useAuth();
  const [step, setStep] = useState(0);
  const [delivery, setDelivery] = useState("standard");
  const [orderNo, setOrderNo] = useState("");
  const [copied, setCopied] = useState(false);
  const [saveAddress, setSaveAddress] = useState(true);
  const [paymentError, setPaymentError] = useState("");
  const [paymentNotice, setPaymentNotice] = useState("");
  const [placingOrder, setPlacingOrder] = useState(false);
  const [confirmPaymentOpen, setConfirmPaymentOpen] = useState(false);
  // pending navigation target after the copy-prompt popup
  const [copyPrompt, setCopyPrompt] = useState<null | { dest: string }>(null);
  const [ship, setShip] = useState({
    name: "", email: "", phone: "", address: "", city: "", county: "", zip: "",
  });

  useEffect(() => {
    if (!user) return;
    const defaultAddress = user.addresses?.find((address) => address.isDefault) ?? user.addresses?.[0];
    setShip((current) => ({
      ...current,
      name: current.name || `${user.firstName} ${user.lastName}`.trim(),
      email: current.email || user.email,
      phone: current.phone || user.phone || "",
      address: current.address || defaultAddress?.street || "",
      city: current.city || defaultAddress?.city || "",
      county: current.county || defaultAddress?.county || "",
      zip: current.zip || defaultAddress?.postalCode || "",
    }));
  }, [user]);

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

  if (!user) {
    return (
      <Container className="py-16">
        <Breadcrumb items={[{ label: "Cart", to: "/cart" }, { label: "Checkout" }]} />
        <div className="mx-auto mt-8 max-w-xl rounded-lg bg-white p-8 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-secondary/20 text-brand-primary">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-7 w-7">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 0 0-9 0v3.75m-.75 0h10.5A2.25 2.25 0 0 1 19.5 12.75v6A2.25 2.25 0 0 1 17.25 21H6.75A2.25 2.25 0 0 1 4.5 18.75v-6A2.25 2.25 0 0 1 6.75 10.5z" />
            </svg>
          </div>
          <h1 className="mt-5 font-display text-2xl uppercase tracking-wider text-brand-primary">Sign in to checkout</h1>
          <p className="mt-2 text-sm text-gray-500">
            You can browse freely, but purchases need an account so we can save addresses, receipts, and tracking history.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link to="/login" className="flex-1 rounded-sm bg-brand-primary py-3 text-xs font-bold uppercase tracking-[0.12em] text-white hover:bg-brand-secondary hover:text-brand-primary">
              Sign In
            </Link>
            <Link to="/register" className="flex-1 rounded-sm border border-brand-primary py-3 text-xs font-bold uppercase tracking-[0.12em] text-brand-primary hover:bg-brand-primary hover:text-white">
              Create Account
            </Link>
          </div>
        </div>
      </Container>
    );
  }

  // Confirmation
  if (orderNo) {
    const copyOrder = () => {
      navigator.clipboard.writeText(orderNo).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    };

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
                <button
                  onClick={copyOrder}
                  className="rounded-sm border border-light-gray px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 transition-all hover:border-brand-primary hover:text-brand-primary"
                >
                  {copied ? "✓ Copied" : "Copy"}
                </button>
              </div>
            </div>
            <div className="flex justify-between py-3 text-xs">
              <span className="text-gray-400">Date</span>
              <span className="text-charcoal">{new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span>
            </div>
            <div className="space-y-1 border-t border-light-gray pt-3 text-xs text-charcoal">
              <p>Confirmation saved to your account</p>
              <p>Visual payment confirmed</p>
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
              onClick={() => navigate(`/track?order=${encodeURIComponent(orderNo)}`)}
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
                  Continue Without Copying
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(orderNo);
                    const dest = copyPrompt.dest;
                    setCopyPrompt(null);
                    setCopied(true);
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

  const createPaidOrder = async () => {
    setPlacingOrder(true);
    setPaymentError("");
    setPaymentNotice("");
    const no = "NM-2026-" + Math.floor(100000 + Math.random() * 900000);
    const now = new Date().toISOString();

    const receipt: LocalReceipt = {
      id: crypto.randomUUID?.() ?? no,
      orderNumber: no,
      items: lines.map((line, index) => ({
        productId: line.c.productId,
        productName: line.product!.name,
        productPrice: line.product!.price,
        quantity: line.c.qty,
        subtotal: line.product!.price * line.c.qty,
        productImage: line.product!.image,
        size: line.c.size,
        color: line.c.color,
        id: `${no}-${index}`,
      })),
      subtotal,
      tax,
      shippingCost: deliveryFee,
      total,
      status: "PROCESSING",
      paymentMethod: "VISUAL",
      paymentStatus: "PAID",
      deliveryMethod: delivery,
      address: ship,
      createdAt: now,
      updatedAt: now,
    } as LocalReceipt;

    try {
      await ordersAPI.createCheckout({
        orderNumber: no,
        items: receipt.items,
        subtotal,
        tax,
        shippingCost: deliveryFee,
        total,
        paymentMethod: "card",
        paymentStatus: "PAID",
        deliveryMethod: delivery,
        address: ship,
        notes: "Visual payment confirmed by customer",
      });
    } catch (error: any) {
      setPaymentError(error?.response?.data?.error || "Order could not be saved to the backend. Please restart the backend and try again.");
      setPlacingOrder(false);
      return;
    }

    saveReceipt(user, receipt);

    if (saveAddress && ship.address && ship.city && ship.county) {
      await addAddress({
        street: ship.address,
        city: ship.city,
        county: ship.county,
        postalCode: ship.zip,
        isDefault: (user.addresses?.length ?? 0) === 0,
      }).catch(() => undefined);
    }

    setOrderNo(no);
    clearCart();
    setConfirmPaymentOpen(false);
    setPlacingOrder(false);
  };

  const placeOrder = () => {
    setPaymentError("");
    setPaymentNotice("");
    setConfirmPaymentOpen(true);
  };

  return (
    <Container className="py-8">
      <Breadcrumb items={[{ label: "Cart", to: "/cart" }, { label: "Checkout" }]} />

      {/* Stepper */}
      <div className="mx-auto mt-6 flex max-w-2xl items-center justify-between">
        {STEPS.map((s, i) => (
          <div key={s} className="flex flex-1 items-center">
            <div className="flex flex-col items-center">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${
                  i <= step ? "bg-brand-secondary text-brand-primary" : "bg-light-gray text-gray-400"
                }`}
              >
                {i + 1}
              </div>
              <span className={`mt-1 text-xs ${i <= step ? "text-brand-primary" : "text-gray-400"}`}>{s}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`mx-2 h-0.5 flex-1 ${i < step ? "bg-brand-secondary" : "bg-light-gray"}`} />
            )}
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="rounded-xl bg-white p-6 shadow-[0_2px_20px_rgba(0,0,0,0.06)]">
          {step === 0 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setStep(1);
              }}
            >
              <h2 className="font-body text-lg font-bold uppercase tracking-wide text-brand-primary">Shipping Details</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {[
                  ["name", "Full Name", "sm:col-span-2"],
                  ["email", "Email"],
                  ["phone", "Phone"],
                  ["address", "Address", "sm:col-span-2"],
                  ["city", "City"],
                  ["county", "County"],
                  ["zip", "ZIP Code"],
                ].map(([key, label, span]) => (
                  <div key={key} className={span ?? ""}>
                    <label className="mb-1 block text-xs font-medium text-charcoal">{label}</label>
                    <input
                      required={key !== "zip"}
                      type={key === "email" ? "email" : "text"}
                      value={(ship as any)[key]}
                      onChange={(e) => setShip({ ...ship, [key]: e.target.value })}
                      className="w-full rounded border border-light-gray px-3 py-2.5 text-sm outline-none focus:border-brand-secondary"
                    />
                  </div>
                ))}
              </div>
              <label className="mt-4 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={saveAddress}
                  onChange={(e) => setSaveAddress(e.target.checked)}
                  className="accent-brand-secondary"
                />
                Save this address for future orders
              </label>
              <button className="mt-6 rounded bg-brand-secondary px-6 py-3 text-sm font-semibold uppercase tracking-wide text-brand-primary hover:bg-brand-accent">
                Continue to Delivery →
              </button>
            </form>
          )}

          {step === 1 && (
            <div>
              <h2 className="font-body text-lg font-bold uppercase tracking-wide text-brand-primary">Delivery Method</h2>
              <div className="mt-4 space-y-3">
                {DELIVERY.map((d) => (
                  <label
                    key={d.id}
                    className={`flex cursor-pointer items-center justify-between rounded-lg border p-4 ${
                      delivery === d.id ? "border-brand-secondary bg-brand-secondary/10" : "border-light-gray"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        checked={delivery === d.id}
                        onChange={() => setDelivery(d.id)}
                        className="accent-brand-secondary"
                      />
                      <div>
                        <p className="font-medium text-brand-primary">{d.label}</p>
                        <p className="text-xs text-gray-500">{d.desc}</p>
                      </div>
                    </div>
                    <span className="font-semibold text-brand-primary">
                      {d.price === 0 ? "Free" : formatKES(d.price)}
                    </span>
                  </label>
                ))}
              </div>
              <div className="mt-6 flex gap-3">
                <button onClick={() => setStep(0)} className="rounded border border-light-gray px-6 py-3 text-sm font-semibold uppercase tracking-wide">
                  Back
                </button>
                <button onClick={() => setStep(2)} className="rounded bg-brand-secondary px-6 py-3 text-sm font-semibold uppercase tracking-wide text-brand-primary hover:bg-brand-accent">
                  Continue to Payment →
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="font-body text-lg font-bold uppercase tracking-wide text-brand-primary">Payment</h2>
              <div className="mt-4 rounded-lg border border-brand-secondary/40 bg-brand-secondary/10 p-5">
                <p className="font-medium text-brand-primary">Visual payment mode</p>
                <p className="mt-1 text-sm text-gray-500">
                  No real money is collected. Confirming payment will mark the order as paid and move it straight into processing.
                </p>
              </div>
              <div className="mt-6 flex gap-3">
                <button onClick={() => setStep(1)} className="rounded border border-light-gray px-6 py-3 text-sm font-semibold uppercase tracking-wide">
                  Back
                </button>
                <button disabled={placingOrder} onClick={placeOrder} className="rounded bg-ocean-blue px-6 py-3 text-sm font-semibold uppercase tracking-wide text-white hover:bg-ocean-blue-dark disabled:cursor-not-allowed disabled:bg-gray-300">
                  {placingOrder ? "Processing..." : "Place Order"}
                </button>
              </div>
              {paymentNotice && <p className="mt-3 rounded-sm bg-success/10 p-3 text-sm text-success">{paymentNotice}</p>}
              {paymentError && <p className="mt-3 rounded-sm bg-error/10 p-3 text-sm text-error">{paymentError}</p>}
            </div>
          )}
        </div>

        {/* Order summary */}
        <div className="h-fit rounded-xl bg-white p-6 shadow-[0_2px_20px_rgba(0,0,0,0.06)]">
          <h2 className="font-body text-lg font-bold uppercase tracking-wide text-brand-primary">Order Summary</h2>
          <div className="mt-4 space-y-3">
            {lines.map((l, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="flex-1 pr-2 text-charcoal">
                  {l.product!.name} <span className="text-gray-400">×{l.c.qty}</span>
                </span>
                <span>{formatKES(l.product!.price * l.c.qty)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-2 border-t border-light-gray pt-4 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{formatKES(subtotal)}</span></div>
            <div className="flex justify-between"><span>Delivery</span><span>{deliveryFee === 0 ? "Free" : formatKES(deliveryFee)}</span></div>
            <div className="flex justify-between"><span>Tax (16%)</span><span>{formatKES(tax)}</span></div>
            <div className="flex justify-between border-t border-light-gray pt-2 font-display text-xl text-brand-primary">
              <span>Total</span><span>{formatKES(total)}</span>
            </div>
          </div>
        </div>
      </div>

      {confirmPaymentOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <button className="absolute inset-0 bg-black/50" aria-label="Close payment confirmation" onClick={() => setConfirmPaymentOpen(false)} />
          <div className="relative w-full max-w-md rounded-lg bg-white p-6 shadow-2xl">
            <h3 className="font-display text-xl uppercase tracking-wider text-brand-primary">Confirm Payment</h3>
            <p className="mt-2 text-sm text-gray-500">
              This is a visual payment. Confirming will mark this order as paid and start processing.
            </p>
            <div className="mt-5 space-y-2 rounded-md bg-off-white p-4 text-sm">
              <div className="flex justify-between"><span>Subtotal</span><span>{formatKES(subtotal)}</span></div>
              <div className="flex justify-between"><span>Delivery</span><span>{deliveryFee === 0 ? "Free" : formatKES(deliveryFee)}</span></div>
              <div className="flex justify-between"><span>Tax</span><span>{formatKES(tax)}</span></div>
              <div className="flex justify-between border-t border-light-gray pt-2 font-bold text-brand-primary"><span>Total</span><span>{formatKES(total)}</span></div>
            </div>
            <div className="mt-6 flex gap-3">
              <button onClick={() => setConfirmPaymentOpen(false)} className="flex-1 rounded-sm border border-light-gray py-3 text-xs font-bold uppercase tracking-wider text-charcoal hover:bg-off-white">
                Back
              </button>
              <button disabled={placingOrder} onClick={createPaidOrder} className="flex-1 rounded-sm bg-brand-primary py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary disabled:opacity-50">
                {placingOrder ? "Confirming..." : "Confirm Payment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Container>
  );
}


