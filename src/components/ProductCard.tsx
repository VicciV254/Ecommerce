import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CatalogProduct } from "../api/catalog";
import { Link } from "../router";
import { activeVariants, productPriceView, productStock, stockLevel } from "../store/catalogModel";
import { useStore } from "../store/StoreContext";
import { addedMessage, useAddToCart } from "../store/useProductSelection";
import { formatKES } from "../utils/format";
import { useMiniCart } from "./MiniCart";
import { QuickView } from "./QuickView";
import { DemoBadge, ProductImage, Stars, StockBadge } from "./ui";

const cardAction =
  "mt-3 flex min-h-[44px] w-full items-center justify-center rounded-sm px-2 text-center font-body text-xs font-bold uppercase tracking-[0.1em] transition-colors duration-200";

/**
 * Display prices are the server's per-SKU projection, shown once without client arithmetic. A product with one SKU is
 * added directly (the mini-cart opens); one with several opens Quick View to choose, never a default.
 */
export function ProductCard({ product }: { product: CatalogProduct }) {
  const { toggleWish, state } = useStore();
  const addLine = useAddToCart();
  const miniCart = useMiniCart();
  const [quickView, setQuickView] = useState(false);
  const price = productPriceView(product);
  const variants = activeVariants(product);
  const stock = productStock(product);
  const level = stockLevel(stock.quantity, stock.lowThreshold);
  const wished = state.wishlist.includes(product.id);
  const productRoute = `/product/${encodeURIComponent(product.id)}`;

  const addSingleVariant = () => {
    const outcome = addLine(product, variants[0], 1);
    miniCart?.open({ message: addedMessage(product.name, "", outcome) });
  };

  let action: ReactNode;
  if (!variants.length || level === "out") {
    action = (
      <button type="button" disabled className={`${cardAction} cursor-not-allowed bg-surface-soft text-muted`}>
        {variants.length ? "Out of stock" : "Unavailable"}
      </button>
    );
  } else if (variants.length > 1) {
    action = (
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`Choose options for ${product.name}`}
        onClick={() => setQuickView(true)}
        className={`${cardAction} border border-navy-900 text-navy-900 hover:bg-navy-900 hover:text-white`}
      >
        Choose options
      </button>
    );
  } else {
    action = (
      <button type="button" onClick={addSingleVariant} className={`${cardAction} bg-navy-900 text-white hover:bg-gold-500 hover:text-navy-900`}>
        Add to cart
      </button>
    );
  }

  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-lg bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
      {/* Duplicate of the title link for pointer users; hidden from keyboard and screen readers. */}
      <Link to={productRoute} tabIndex={-1} aria-hidden="true" className="relative block">
        <div className="relative aspect-square overflow-hidden bg-warm-beige">
          <ProductImage product={product} className="transition-transform duration-700 group-hover:scale-110" />
          {product.isDemo && <DemoBadge className="absolute left-3 top-3 shadow-sm" />}
          {price && price.discountPercent > 0 ? (
            <span className="absolute right-3 top-3 rounded-sm bg-coral px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm">
              -{price.discountPercent}%
            </span>
          ) : price?.comparePrice != null ? (
            <span className="absolute right-3 top-3 rounded-sm bg-brand-secondary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-primary shadow-sm">
              Sale
            </span>
          ) : null}
        </div>
      </Link>

      <button
        type="button"
        onClick={() => toggleWish(product.id)}
        aria-label={wished ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`}
        aria-pressed={wished}
        className={`absolute right-2 top-12 z-10 flex size-[44px] items-center justify-center rounded-full bg-white shadow-md transition-all duration-200 hover:scale-110 ${
          wished ? "text-error" : "text-gray-500 hover:text-error"
        }`}
      >
        <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={wished ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} className="h-4 w-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
        </svg>
      </button>

      <div className="flex flex-1 flex-col p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-accent">{product.categoryName}</p>
        <Link to={productRoute}>
          <h3 className="mt-1 line-clamp-2 font-body text-sm font-medium leading-snug text-brand-primary transition-colors hover:text-brand-secondary">
            {product.name}
          </h3>
        </Link>
        {product.reviewsCount > 0 && (
          <p className="mt-1.5 flex items-center gap-1.5">
            <Stars rating={product.rating} size={12} />
            <span className="text-[10px] text-gray-500">
              {product.rating.toFixed(1)} ({product.reviewsCount} {product.reviewsCount === 1 ? "review" : "reviews"})
            </span>
          </p>
        )}
        {price && (
          <div className="mt-2 flex items-baseline gap-2">
            <span className="type-price-card text-navy-900">
              {price.isFromPrice && <span className="text-xs font-normal">From </span>}
              {formatKES(price.price)}
            </span>
            {price.comparePrice !== null && <span className="text-xs text-gray-500 line-through">{formatKES(price.comparePrice)}</span>}
          </div>
        )}
        <div className="mt-2"><StockBadge level={level} /></div>
        <div className="mt-auto">{action}</div>
      </div>
      {/* Outside the card's own elements, so hovering the dialog never restyles the card behind it. */}
      {quickView && createPortal(<QuickView product={product} onClose={() => setQuickView(false)} />, document.body)}
    </div>
  );
}

