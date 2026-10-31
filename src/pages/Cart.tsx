import { Breadcrumb, Container, DemoBadge, DemoCatalogNotice, ErrorPanel, LoadingPanel, ProductImage } from "../components/ui";
import { useAuth } from "../contexts/AuthContext";
import { Link } from "../router";
import { useCatalog } from "../store/CatalogContext";
import { describeVariant } from "../store/catalogModel";
import { useStore } from "../store/StoreContext";
import { formatKES } from "../utils/format";

export default function Cart() {
  const { state, removeFromCart, setQuantity } = useStore();
  const catalog = useCatalog();
  const { user } = useAuth();

  if (!user) {
    return (
      <Container className="py-16">
        <Breadcrumb items={[{ label: "Cart" }]} />
        <div className="mx-auto mt-8 max-w-xl rounded-lg bg-white p-8 text-center shadow-sm">
          <h1 className="font-display text-2xl text-brand-primary">Sign in to use your cart</h1>
          <p className="mt-2 text-sm text-gray-500">You can browse products freely, but saving cart items requires an account.</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link to="/login" className="flex-1 rounded-sm bg-brand-primary py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary">Sign In</Link>
            <Link to="/register" className="flex-1 rounded-sm border border-brand-primary py-3 text-xs font-bold uppercase tracking-wider text-brand-primary hover:bg-brand-primary hover:text-white">Create Account</Link>
          </div>
        </div>
      </Container>
    );
  }

  if (state.cart.length === 0) {
    return (
      <Container className="py-8">
        <Breadcrumb items={[{ label: "Cart" }]} />
        <div className="mt-10 rounded-lg bg-white p-16 text-center shadow-sm">
          <h1 className="font-display text-xl text-brand-primary">Your cart is empty</h1>
          <p className="mt-1 text-sm text-gray-500">Browse the shop and find something you love.</p>
          <Link to="/shop" className="mt-6 inline-block rounded-sm bg-brand-primary px-8 py-3 text-xs font-bold uppercase tracking-[0.12em] text-white hover:bg-brand-secondary hover:text-brand-primary">
            Start Shopping
          </Link>
        </div>
      </Container>
    );
  }

  if (catalog.status !== "ready") {
    return (
      <Container className="py-8">
        <Breadcrumb items={[{ label: "Cart" }]} />
        <div className="mt-8">
          {catalog.status === "loading"
            ? <LoadingPanel label="Loading current prices for your cart…" />
            : <ErrorPanel title="Cart prices are unavailable" message={`${catalog.error ?? "The catalog could not be loaded."} Your cart is unchanged.`} onRetry={catalog.reload} />}
        </div>
      </Container>
    );
  }

  const lines = state.cart.map((line, index) => {
    const product = catalog.productsById.get(line.productId);
    const variant = product?.variants.find((item) => item.id === line.variantId && item.isActive);
    return { line, index, product, variant };
  });
  let subtotal = 0;
  let itemCount = 0;
  for (const { line, product, variant } of lines) {
    if (!product || !variant) continue;
    subtotal += catalog.priceOfVariant(product, variant).price * line.quantity;
    itemCount += line.quantity;
  }
  const unavailableCount = lines.filter((entry) => !entry.product || !entry.variant).length;

  return (
    <Container className="py-8">
      <Breadcrumb items={[{ label: "Cart" }]} />
      <h1 className="mt-5 font-display text-2xl uppercase tracking-wider text-brand-primary">Shopping Cart</h1>
      <p className="mt-1 text-xs text-gray-500">{itemCount} {itemCount === 1 ? "item" : "items"}</p>
      <div className="mt-4"><DemoCatalogNotice /></div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_360px]">
        <ul className="divide-y divide-light-gray rounded-lg bg-white shadow-sm">
          {lines.map(({ line, index, product, variant }) => {
            if (!product || !variant) {
              return (
                <li key={`${index}:${line.variantId}`} className="flex items-center justify-between gap-4 p-4">
                  <div>
                    <p className="text-sm font-medium text-brand-primary">This item is no longer available</p>
                    <p className="mt-0.5 text-xs text-gray-500">It was removed from the catalog or its options changed. It will not be ordered.</p>
                  </div>
                  <button type="button" onClick={() => removeFromCart(index)} className="shrink-0 rounded-sm border border-error/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-error hover:bg-error hover:text-white">
                    Remove
                  </button>
                </li>
              );
            }
            const price = catalog.priceOfVariant(product, variant);
            const stock = Math.max(0, variant.stock);
            const options = describeVariant(variant);
            return (
              <li key={`${index}:${line.variantId}`} className="flex gap-4 p-4">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md bg-warm-beige">
                  <ProductImage product={product} />
                </div>
                <div className="flex flex-1 flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link to={`/product/${encodeURIComponent(product.id)}`} className="text-sm font-medium text-brand-primary hover:text-brand-secondary">
                        {product.name}
                      </Link>
                      {product.isDemo && <DemoBadge className="ml-2 align-middle" />}
                    </div>
                    <button type="button" aria-label={`Remove ${product.name} from cart`} onClick={() => removeFromCart(index)} className="text-gray-400 hover:text-error">
                      <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                  {options && <p className="mt-0.5 text-[11px] text-gray-500">{options}</p>}
                  {stock === 0 ? (
                    <p className="mt-1 text-[11px] font-semibold text-error">Out of stock: this item cannot currently be ordered.</p>
                  ) : line.quantity > stock ? (
                    <p className="mt-1 text-[11px] font-semibold text-warning">Only {stock} available. Reduce the quantity to continue.</p>
                  ) : null}
                  <div className="mt-auto flex items-end justify-between pt-2">
                    <div className="flex items-center rounded-sm border border-light-gray">
                      <button type="button" aria-label={`Decrease quantity of ${product.name}`} disabled={line.quantity <= 1} onClick={() => setQuantity(index, line.quantity - 1)} className="px-2.5 py-1 text-xs text-gray-500 disabled:opacity-40">−</button>
                      <span aria-live="polite" className="w-7 text-center text-xs">{line.quantity}</span>
                      <button type="button" aria-label={`Increase quantity of ${product.name}`} disabled={line.quantity >= stock} onClick={() => setQuantity(index, line.quantity + 1)} className="px-2.5 py-1 text-xs text-gray-500 disabled:opacity-40">+</button>
                    </div>
                    <p className="text-right">
                      {price.comparePrice !== null && (
                        <span className="mr-2 text-xs text-gray-500 line-through">{formatKES(price.comparePrice * line.quantity)}</span>
                      )}
                      <span className="font-display text-base text-brand-primary">{formatKES(price.price * line.quantity)}</span>
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="h-fit rounded-lg bg-white p-6 shadow-sm">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Cart Summary</h2>
          <dl className="mt-4 space-y-2.5 text-sm">
            <div className="flex justify-between"><dt className="text-gray-500">Items subtotal</dt><dd>{formatKES(subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500">Delivery and taxes</dt><dd className="text-xs font-semibold">Not yet calculated</dd></div>
          </dl>
          <p className="mt-3 text-xs text-gray-500">
            Item prices include current catalog promotions. The final total is confirmed when checkout is available.
          </p>
          {unavailableCount > 0 && (
            <p className="mt-3 text-xs font-semibold text-error">
              {unavailableCount} unavailable {unavailableCount === 1 ? "item is" : "items are"} excluded from the subtotal.
            </p>
          )}

          <button
            type="button"
            disabled
            aria-describedby="checkout-unavailable"
            className="mt-5 w-full cursor-not-allowed rounded-sm bg-light-gray py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-charcoal"
          >
            Checkout temporarily unavailable
          </button>
          <p id="checkout-unavailable" className="mt-2 text-center text-xs text-charcoal">
            Checkout is paused until verified payment processing is available. Your cart is unchanged.
          </p>
          <Link to="/shop" className="mt-3 block text-center text-[11px] text-gray-500 underline-offset-4 hover:text-brand-primary hover:underline">
            Continue Shopping
          </Link>
        </div>
      </div>
    </Container>
  );
}
