import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "../router";
import { type Product, stockStatus } from "../data/products";
import { formatKES, useStore } from "../store/StoreContext";

/* ---------- Stars ---------- */
export function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return (
    <span className="inline-flex items-center gap-px" style={{ fontSize: size }}>
      {[0, 1, 2, 3, 4].map((i) => {
        const filled = i < full;
        const isHalf = i === full && half;
        return (
          <span key={i} className="leading-none" style={{ color: filled || isHalf ? "#e8a838" : "#d1d5db" }}>
            ★
          </span>
        );
      })}
    </span>
  );
}

/* ---------- Product Image ---------- */
export function ProductImage({
  product,
  className = "",
}: {
  product: Product;
  className?: string;
}) {
  return (
    <img
      src={product.image}
      alt={product.name}
      loading="lazy"
      className={`h-full w-full object-cover ${className}`}
    />
  );
}

/* ---------- Stock badge ---------- */
export function StockBadge({ stock }: { stock: number }) {
  const s = stockStatus(stock);
  const map = {
    in: { cls: "bg-success/90 text-white", label: "In Stock" },
    low: { cls: "bg-warning/90 text-white", label: "Low Stock" },
    out: { cls: "bg-error/90 text-white", label: "Out of Stock" },
  } as const;
  const m = map[s];
  return (
    <span className={`inline-block rounded-sm px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${m.cls}`}>
      {m.label}
    </span>
  );
}

/* ---------- Product Card ---------- */
export function ProductCard({ product }: { product: Product }) {
  const { addToCart, toggleWish, state, productWithStock } = useStore();
  const p = productWithStock(product);
  const wished = state.wishlist.includes(p.id);
  const out = p.stock <= 0;

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
      <Link to={`/product/${p.id}`} className="relative block">
        <div className="relative aspect-square overflow-hidden bg-warm-beige">
          <ProductImage
            product={p}
            className="transition-transform duration-700 group-hover:scale-110"
          />
          {p.bestSeller && (
            <span className="absolute left-3 top-3 rounded-sm bg-coral px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm">
              Best Seller
            </span>
          )}
          {p.discountPercent ? (
            <span className="absolute right-3 top-3 rounded-sm bg-coral px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm">
              -{p.discountPercent}%
            </span>
          ) : p.comparePrice ? (
            <span className="absolute right-3 top-3 rounded-sm bg-brand-secondary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-primary shadow-sm">
              Sale
            </span>
          ) : null}
          {/* Hover overlay */}
          <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100">
            <span className="mb-4 rounded-sm bg-white/95 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-brand-primary shadow">
              Quick View
            </span>
          </div>
        </div>
      </Link>

      <button
        onClick={() => toggleWish(p.id)}
        aria-label="Toggle wishlist"
        className={`absolute right-3 top-14 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-md transition-all duration-200 hover:scale-110 ${
          wished ? "text-error" : "text-gray-400 hover:text-error"
        }`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={wished ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} className="h-4 w-4">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
        </svg>
      </button>

      <div className="flex flex-1 flex-col p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-accent">
          {p.category}
        </p>
        <Link to={`/product/${p.id}`}>
          <h3 className="mt-1 line-clamp-2 font-body text-sm font-medium leading-snug text-brand-primary transition-colors hover:text-brand-secondary">
            {p.name}
          </h3>
        </Link>
        <div className="mt-1.5 flex items-center gap-1.5">
          <Stars rating={p.rating} size={12} />
          <span className="text-[10px] text-gray-400">({p.reviews})</span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-display text-lg text-brand-primary">{formatKES(p.price)}</span>
          {p.comparePrice && (
            <span className="text-xs text-gray-400 line-through">{formatKES(p.comparePrice)}</span>
          )}
        </div>
        <div className="mt-2">
          <StockBadge stock={p.stock} />
        </div>
        <button
          disabled={out}
          onClick={() =>
            addToCart({
              productId: p.id,
              qty: 1,
              size: p.sizes?.[0],
              color: p.colors?.[0],
            })
          }
          className={`mt-3 w-full rounded-sm py-2.5 font-body text-xs font-bold uppercase tracking-[0.1em] transition-all duration-200 ${
            out
              ? "cursor-not-allowed bg-gray-100 text-gray-400"
              : "bg-brand-primary text-white hover:bg-brand-secondary hover:text-brand-primary"
          }`}
        >
          {out ? "Out of Stock" : "Add to Cart"}
        </button>
      </div>
    </div>
  );
}

/* ---------- Breadcrumb ---------- */
export function Breadcrumb({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5 text-xs tracking-wide text-gray-400">
      <Link to="/" className="transition-colors hover:text-brand-secondary">
        Home
      </Link>
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <span>/</span>
          {it.to ? (
            <Link to={it.to} className="transition-colors hover:text-brand-secondary">
              {it.label}
            </Link>
          ) : (
            <span className="font-medium text-brand-primary">{it.label}</span>
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
        {subtitle && <p className="mt-1 text-sm text-gray-400">{subtitle}</p>}
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
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          obs.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "translateY(0)" : "translateY(20px)",
        transition: `opacity 0.6s ease ${delay}ms, transform 0.6s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>;
}
