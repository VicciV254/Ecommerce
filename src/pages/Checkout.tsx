import { Breadcrumb, Container } from "../components/ui";
import { useStore } from "../store/StoreContext";
import { Link } from "../router";

export default function Checkout() {
  const { state } = useStore();

  return (
    <Container className="py-8">
      <Breadcrumb items={[{ label: "Cart", to: "/cart" }, { label: "Checkout" }]} />
      <section aria-labelledby="checkout-title" className="mx-auto mt-8 max-w-xl rounded-lg bg-white p-6 text-center shadow-sm sm:p-8">
        <h1 id="checkout-title" className="font-display text-2xl text-brand-primary">
          {state.cart.length ? "Checkout temporarily unavailable" : "Your cart is empty"}
        </h1>
        {state.cart.length ? (
          <>
            <p role="status" className="mt-4 text-sm leading-relaxed text-charcoal">
              Checkout is paused while verified payment processing is being implemented.
              Your cart is unchanged, and you can continue browsing.
            </p>
            <p className="mt-3 text-sm text-charcoal">No order or payment is created on this page.</p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link to="/cart" className="flex-1 rounded-sm bg-brand-primary px-5 py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary">
                Back to Cart
              </Link>
              <Link to="/shop" className="flex-1 rounded-sm border border-light-gray px-5 py-3 text-xs font-bold uppercase tracking-wider text-brand-primary hover:border-brand-primary">
                Continue Shopping
              </Link>
            </div>
          </>
        ) : (
          <Link to="/shop" className="mt-6 inline-block rounded-sm bg-brand-primary px-6 py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary">
            Go Shopping
          </Link>
        )}
      </section>
    </Container>
  );
}
