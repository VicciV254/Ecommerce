import { useState } from "react";
import { getProduct } from "../data/products";
import { Breadcrumb, Container, ProductImage } from "../components/ui";
import { formatKES, useStore } from "../store/StoreContext";
import { Link, navigate } from "../router";

export function Cart() {
  const { state, removeFromCart, setQty } = useStore();
  const [promo, setPromo] = useState("");
  const [applied, setApplied] = useState(0);
  const [promoMsg, setPromoMsg] = useState("");

  const lines = state.cart
    .map((c, index) => ({ c, index, product: getProduct(c.productId) }))
    .filter((l) => l.product);

  const subtotal = lines.reduce((s, l) => s + (l.product!.price * l.c.qty), 0);
  const discount = Math.round(subtotal * applied);
  const taxed = subtotal - discount;
  const tax = Math.round(taxed * 0.16);
  const total = taxed + tax;

  const applyPromo = () => {
    if (promo.trim().toUpperCase() === "IKOKITU") {
      setApplied(0.1);
      setPromoMsg("10% discount applied!");
    } else {
      setApplied(0);
      setPromoMsg("Invalid promo code.");
    }
  };

  if (lines.length === 0) {
    return (
      <Container className="py-8">
        <Breadcrumb items={[{ label: "Cart" }]} />
        <div className="mt-10 rounded-lg bg-white p-16 text-center shadow-sm">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor" className="mx-auto h-16 w-16 text-gray-200">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0z" />
          </svg>
          <h1 className="mt-4 font-display text-xl text-brand-primary">Your cart is empty</h1>
          <p className="mt-1 text-sm text-gray-400">Browse our collection and find something you love.</p>
          <Link
            to="/shop"
            className="mt-6 inline-block rounded-sm bg-brand-primary px-8 py-3 text-xs font-bold uppercase tracking-[0.12em] text-white hover:bg-brand-secondary hover:text-brand-primary"
          >
            Start Shopping
          </Link>
        </div>
      </Container>
    );
  }

  return (
    <Container className="py-8">
      <Breadcrumb items={[{ label: "Cart" }]} />
      <h1 className="mt-5 font-display text-2xl uppercase tracking-wider text-brand-primary">
        Shopping Cart
      </h1>
      <p className="mt-1 text-xs text-gray-400">{lines.reduce((s, l) => s + l.c.qty, 0)} items</p>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="divide-y divide-light-gray rounded-lg bg-white shadow-sm">
          {lines.map(({ c, index, product }) => (
            <div key={index} className="flex gap-4 p-4">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md bg-warm-beige">
                <ProductImage product={product!} />
              </div>
              <div className="flex flex-1 flex-col">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/product/${product!.id}`} className="text-sm font-medium text-brand-primary hover:text-brand-secondary">
                    {product!.name}
                  </Link>
                  <button onClick={() => removeFromCart(index)} className="text-gray-300 hover:text-error">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                  </button>
                </div>
                <p className="mt-0.5 text-[11px] text-gray-400">
                  {c.size && `Size: ${c.size}`} {c.color && `· Color: ${c.color}`}
                </p>
                <div className="mt-auto flex items-end justify-between pt-2">
                  <div className="flex items-center rounded-sm border border-light-gray">
                    <button onClick={() => setQty(index, c.qty - 1)} className="px-2.5 py-1 text-xs text-gray-500">−</button>
                    <span className="w-7 text-center text-xs">{c.qty}</span>
                    <button onClick={() => setQty(index, c.qty + 1)} className="px-2.5 py-1 text-xs text-gray-500">+</button>
                  </div>
                  <p className="font-display text-base text-brand-primary">
                    {formatKES(product!.price * c.qty)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="h-fit rounded-lg bg-white p-6 shadow-sm">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Cart Summary</h2>
          <div className="mt-4 space-y-2.5 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatKES(subtotal)}</span></div>
            {discount > 0 && (
              <div className="flex justify-between text-success"><span>Discount</span><span>−{formatKES(discount)}</span></div>
            )}
            <div className="flex justify-between"><span className="text-gray-500">Shipping</span><span className="text-success text-xs font-semibold">FREE</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Tax (16%)</span><span>{formatKES(tax)}</span></div>
            <div className="flex justify-between border-t border-light-gray pt-3 font-display text-xl text-brand-primary">
              <span>Total</span><span>{formatKES(total)}</span>
            </div>
          </div>

          <div className="mt-5">
            <div className="flex">
              <input
                value={promo}
                onChange={(e) => setPromo(e.target.value)}
                placeholder="Promo Code (try IKOKITU)"
                className="w-full rounded-l-sm border border-light-gray bg-off-white px-3 py-2.5 text-xs outline-none"
              />
              <button onClick={applyPromo} className="rounded-r-sm bg-brand-primary px-4 text-xs font-bold text-white">Apply</button>
            </div>
            {promoMsg && <p className={`mt-1.5 text-[11px] ${applied ? "text-success" : "text-error"}`}>{promoMsg}</p>}
          </div>

          <button
            onClick={() => navigate("/checkout")}
            className="mt-5 w-full rounded-sm bg-brand-primary py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-white transition-all hover:bg-brand-secondary hover:text-brand-primary"
          >
            Proceed to Checkout
          </button>
          <Link to="/shop" className="mt-3 block text-center text-[11px] text-gray-400 underline-offset-4 hover:text-brand-primary hover:underline">
            Continue Shopping
          </Link>
        </div>
      </div>
    </Container>
  );
}
