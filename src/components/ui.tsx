import { useEffect, useState, type ReactNode } from "react";
import type { CatalogProduct, MediaAsset } from "../api/catalog";
import { Link, navigate } from "../router";
import { useStore } from "../store/StoreContext";
import { useCatalog } from "../store/CatalogContext";
import { activeVariants, primaryImage, productPriceView, productStock, stockLevel, type StockLevel } from "../store/catalogModel";
import { useAuth } from "../contexts/AuthContext";
import { formatKES } from "../utils/format";

const ADDED_FEEDBACK_MS = 1500;

/* ---------- Stars (only for real review data) ---------- */
export function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <span className="inline-flex items-center gap-px" style={{ fontSize: size }} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="leading-none" style={{ color: i < full || (i === full && half) ? "#d4a73c" : "#d1d5db" }}>
          ★
        </span>
      ))}
    </span>
  );
}

/* ---------- Images ---------- */
export function SampleImageLabel({ className = "" }: { className?: string }) {
  return (
    <span className={`pointer-events-none absolute bottom-2 left-2 rounded-sm bg-black/65 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white ${className}`}>
      Sample image
    </span>
  );
}

export function MissingImage({ label = "Image not yet available" }: { label?: string }) {
  return (
    <div role="img" aria-label={label} className="flex h-full w-full flex-col items-center justify-center gap-1 bg-warm-beige p-3 text-center text-gray-500">
      <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-7 w-7">
        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
      </svg>
      <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
    </div>
  );
}

/** A catalog image with its sample label, or an intentional placeholder when none exists. */
export function MediaImage({
  asset, alt, className = "", loading = "lazy",
}: { asset: MediaAsset | undefined; alt: string; className?: string; loading?: "lazy" | "eager" }) {
  if (!asset) return <MissingImage />;
  return (
    <>
      <img src={asset.url} alt={asset.alt || alt} loading={loading} className={`h-full w-full object-cover ${className}`} />
      {asset.isPlaceholder && <SampleImageLabel />}
    </>
  );
}

export function ProductImage({ product, className = "" }: { product: Pick<CatalogProduct, "name" | "images">; className?: string }) {
  return <MediaImage asset={primaryImage(product)} alt={product.name} className={className} />;
}

/* ---------- Badges ---------- */
const STOCK_BADGES: Record<StockLevel, { cls: string; label: string }> = {
  in: { cls: "bg-success text-white", label: "In Stock" },
  low: { cls: "bg-warning text-white", label: "Low Stock" },
  out: { cls: "bg-error text-white", label: "Out of Stock" },
};

export function StockBadge({ level }: { level: StockLevel }) {
  const badge = STOCK_BADGES[level];
  return (
    <span className={`inline-block rounded-sm px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${badge.cls}`}>
      {badge.label}
    </span>
  );
}

export function DemoBadge({ className = "" }: { className?: string }) {
  return (
    <span title="Sample listing for review; not real inventory" className={`inline-block rounded-sm bg-ocean-blue px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white ${className}`}>
      Demo
    </span>
  );
}

/* ---------- Product Card ---------- */
/** Display prices are the server's per-SKU projection, shown once without client arithmetic. */
export function ProductCard({ product }: { product: CatalogProduct }) {
  const { addToCart, toggleWish, state } = useStore();
  const { user } = useAuth();
  const [added, setAdded] = useState(false);
  const price = productPriceView(product);
  const variants = activeVariants(product);
  const stock = productStock(product);
  const level = stockLevel(stock.quantity, stock.lowThreshold);
  const wished = state.wishlist.includes(product.id);
  const productRoute = `/product/${encodeURIComponent(product.id)}`;

  useEffect(() => {
    if (!added) return;
    const timer = window.setTimeout(() => setAdded(false), ADDED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [added]);

  const addSingleVariant = () => {
    if (!user) {
      navigate("/login");
      return;
    }
    addToCart({ productId: product.id, variantId: variants[0].id, quantity: 1 });
    setAdded(true);
  };

  const actionClass = "mt-3 block w-full rounded-sm py-2.5 text-center font-body text-xs font-bold uppercase tracking-[0.1em] transition-all duration-200";
  let action: ReactNode;
  if (!variants.length || level === "out") {
    action = (
      <button type="button" disabled className={`${actionClass} cursor-not-allowed bg-gray-100 text-gray-500`}>
        {variants.length ? "Out of Stock" : "Unavailable"}
      </button>
    );
  } else if (variants.length > 1) {
    action = (
      <Link to={productRoute} aria-label={`Choose options for ${product.name}`} className={`${actionClass} border border-brand-primary text-brand-primary hover:bg-brand-primary hover:text-white`}>
        Choose Options
      </Link>
    );
  } else {
    action = (
      <button type="button" onClick={addSingleVariant} className={`${actionClass} ${added ? "bg-success text-white" : "bg-brand-primary text-white hover:bg-brand-secondary hover:text-brand-primary"}`}>
        {added ? "✓ Added to Cart" : "Add to Cart"}
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
        className={`absolute right-3 top-14 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-md transition-all duration-200 hover:scale-110 ${
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
            <span className="font-display text-lg text-brand-primary">
              {price.isFromPrice && <span className="text-xs font-body">From </span>}
              {formatKES(price.price)}
            </span>
            {price.comparePrice !== null && <span className="text-xs text-gray-500 line-through">{formatKES(price.comparePrice)}</span>}
          </div>
        )}
        <div className="mt-2"><StockBadge level={level} /></div>
        <div className="mt-auto">{action}</div>
      </div>
    </div>
  );
}

/* ---------- Async status panels ---------- */
export function LoadingPanel({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-3 rounded-lg bg-white p-12 text-center shadow-sm">
      <span aria-hidden="true" className="h-8 w-8 animate-spin rounded-full border-2 border-brand-secondary border-t-transparent" />
      <p className="text-sm text-gray-500">{label}</p>
    </div>
  );
}

export function ErrorPanel({ title, message, onRetry, children }: { title: string; message: string; onRetry?: () => void; children?: ReactNode }) {
  return (
    <div role="alert" className="rounded-lg border border-error/30 bg-white p-8 text-center shadow-sm">
      <h2 className="font-display text-xl text-brand-primary">{title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm text-charcoal">{message}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        {onRetry && (
          <button type="button" onClick={onRetry} className="rounded-sm bg-brand-primary px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary">
            Try Again
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

/** Notice shown wherever demo catalog records are visible to shoppers. */
export function DemoCatalogNotice() {
  const { mode } = useCatalog();
  if (mode !== "demo") return null;
  return (
    <p role="note" className="rounded-md border border-ocean-blue/30 bg-ocean-blue/10 px-4 py-2 text-xs text-ocean-blue-dark">
      <strong>Demo catalog:</strong> listings marked Demo use sample details, prices, stock and images for review. They are not real inventory.
    </p>
  );
}

/* ---------- Breadcrumb ---------- */
export function Breadcrumb({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-xs tracking-wide text-gray-500">
      <Link to="/" className="transition-colors hover:text-brand-secondary">
        Home
      </Link>
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flex items-center gap-1.5">
          <span aria-hidden="true">/</span>
          {item.to ? (
            <Link to={item.to} className="transition-colors hover:text-brand-secondary">
              {item.label}
            </Link>
          ) : (
            <span aria-current="page" className="font-medium text-brand-primary">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/* ---------- Section heading ---------- */
export function SectionTitle({
  children,
  subtitle,
  action,
}: {
  children: ReactNode;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex items-end justify-between gap-4">
      <div>
        <h2 className="font-display text-2xl uppercase tracking-[0.08em] text-brand-primary sm:text-3xl">
          {children}
        </h2>
        {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ---------- Scroll reveal ---------- */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <div className={className} data-aos="fade-up" data-aos-delay={delay}>
      {children}
    </div>
  );
}

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>;
}
