import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import type { CatalogProduct, MediaAsset } from "../api/catalog";
import { Link } from "../router";
import { useCatalog } from "../store/CatalogContext";
import { primaryImage, type StockLevel } from "../store/catalogModel";
import { imageRendition, type ImagePreset } from "../store/mediaModel";
import { prefersReducedMotion } from "./motion";
import { useReveal, type RevealOptions } from "./reveal";

/** How long a lazily loaded image takes to fade in. */
const IMAGE_FADE_MS = 300;

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
    <span className={`pointer-events-none absolute bottom-2 left-2 rounded-sm bg-black/65 px-1.5 py-0.5 text-[0.5625rem] font-bold uppercase tracking-wider text-white ${className}`}>
      Sample image
    </span>
  );
}

/** `iconOnly` keeps the label for assistive technology but leaves room for a caption laid over the lower part. */
export function MissingImage({ label = "Image not yet available", iconOnly = false }: { label?: string; iconOnly?: boolean }) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`flex h-full w-full flex-col items-center gap-1 bg-warm-beige p-3 text-center text-gray-500 ${iconOnly ? "justify-start pt-[30%]" : "justify-center"}`}
    >
      <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-7 w-7">
        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
      </svg>
      {!iconOnly && <span className="text-[0.625rem] font-semibold uppercase tracking-wider">{label}</span>}
    </div>
  );
}

/**
 * A stored image address delivered at a preset's renditions; lazy unless it is the page's priority image. With `fade`,
 * an image that is off screen and not yet loaded when it mounts fades in once it loads; one already on screen or loaded
 * (cached), the priority image and one that fails show at once, and nothing fades under reduced motion.
 */
export function ResponsiveImage({
  url, preset, alt, className = "", sizes, width, height, priority = false, fade = false, onLoad, onError,
}: {
  url: string;
  preset: ImagePreset;
  alt: string;
  className?: string;
  /** Replaces the preset's `sizes` where a layout renders the image at other widths. */
  sizes?: string;
  /** Intrinsic dimensions, when the catalog knows them. */
  width?: number | null;
  height?: number | null;
  /** Only for the product-detail cover: loads eagerly with high fetch priority. */
  priority?: boolean;
  fade?: boolean;
  onLoad?: () => void;
  onError?: () => void;
}) {
  const rendition = imageRendition(url, preset, sizes);
  const image = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const element = image.current;
    if (!fade || priority || !element || element.complete || prefersReducedMotion()) return;
    const box = element.getBoundingClientRect();
    if (box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth) return;
    element.style.opacity = "0";
    const settle = (event: Event) => {
      element.style.opacity = "";
      if (event.type === "load") element.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: IMAGE_FADE_MS, easing: "ease-out" });
    };
    element.addEventListener("load", settle, { once: true });
    element.addEventListener("error", settle, { once: true });
    return () => {
      element.removeEventListener("load", settle);
      element.removeEventListener("error", settle);
    };
  }, [fade, priority]);
  return (
    <img
      ref={image}
      src={rendition.src}
      srcSet={rendition.srcSet}
      sizes={rendition.sizes}
      width={width ?? undefined}
      height={height ?? undefined}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      onLoad={onLoad}
      onError={onError}
      className={className}
    />
  );
}

/** A catalog image with its sample label, or an intentional placeholder when none exists; `fade` as for `ResponsiveImage`. */
export function MediaImage({
  asset, alt, className = "", preset = "card", sizes, fade = false,
}: { asset: MediaAsset | undefined; alt: string; className?: string; preset?: ImagePreset; sizes?: string; fade?: boolean }) {
  if (!asset) return <MissingImage />;
  return (
    <>
      <ResponsiveImage
        url={asset.url}
        preset={preset}
        sizes={sizes}
        alt={asset.alt || alt}
        width={asset.width}
        height={asset.height}
        fade={fade}
        className={`h-full w-full object-cover ${className}`}
      />
      {asset.isPlaceholder && <SampleImageLabel />}
    </>
  );
}

export function ProductImage({
  product, className = "", preset, sizes, fade = false,
}: { product: Pick<CatalogProduct, "name" | "images">; className?: string; preset?: ImagePreset; sizes?: string; fade?: boolean }) {
  return <MediaImage asset={primaryImage(product)} alt={product.name} className={className} preset={preset} sizes={sizes} fade={fade} />;
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
    <span className={`inline-block rounded-sm px-2.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider ${badge.cls}`}>
      {badge.label}
    </span>
  );
}

export function DemoBadge({ className = "" }: { className?: string }) {
  return (
    <span title="Sample listing for review; not real inventory" className={`inline-block rounded-sm bg-ocean-blue px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wider text-white ${className}`}>
      Demo
    </span>
  );
}

/* ---------- Async status panels ---------- */
/**
 * An add button's label and its brief check (`useAddedFeedback`): while `added`, the label fades out under a check, its
 * text staying in place for the button's name. The button must be `relative`.
 */
export function AddedLabel({ added, children }: { added: boolean; children: ReactNode }) {
  return (
    <>
      <span className={`transition-opacity duration-(--motion-feedback) ${added ? "opacity-0" : ""}`}>{children}</span>
      <svg
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2.5}
        stroke="currentColor"
        className={`pointer-events-none absolute inset-0 m-auto size-5 transition-[opacity,transform] duration-(--motion-feedback) ${
          added ? "opacity-100" : "opacity-0 motion-safe:scale-50"
        }`}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
      </svg>
    </>
  );
}

/** A product card's shape while the catalog loads: picture, category, name and price, shimmering briefly. */
export function CardSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`overflow-hidden rounded-lg bg-surface shadow-card ${className}`}>
      <div className="skeleton aspect-square" />
      <div className="space-y-2 p-4">
        <div className="skeleton h-3 w-1/2 rounded-sm" />
        <div className="skeleton h-4 w-3/4 rounded-sm" />
        <div className="skeleton h-5 w-1/3 rounded-sm" />
      </div>
    </div>
  );
}

export function LoadingPanel({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col items-center justify-center gap-3 rounded-lg bg-surface p-12 text-center shadow-card">
      <span aria-hidden="true" className="size-8 animate-spin rounded-full border-2 border-navy-900 border-t-transparent" />
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}

export function ErrorPanel({ title, message, onRetry, children }: { title: string; message: string; onRetry?: () => void; children?: ReactNode }) {
  return (
    <div role="alert" className="rounded-lg border border-error/40 bg-surface p-6 text-center shadow-card sm:p-8">
      <h2 className="type-h3 text-navy-900">{title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-navy-800">{message}</p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
        {onRetry && (
          <button type="button" onClick={onRetry} className="inline-flex min-h-[44px] items-center justify-center rounded-sm bg-navy-900 px-6 text-sm font-bold uppercase tracking-[0.12em] text-white transition-colors duration-(--motion-feedback) hover:bg-gold-500 hover:text-navy-900">
            Try again
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

/** Notice shown wherever demo catalog records are visible to shoppers. */
/**
 * `holdPlace` keeps the notice's space, unseen and unannounced, until the catalog has loaded (also if it fails), so a
 * page whose sections show before the catalog (the home page) doesn't move when the notice appears. This store runs a
 * demo catalog; a live one gives the space back once it has loaded.
 */
export function DemoCatalogNotice({ holdPlace = false }: { holdPlace?: boolean }) {
  const { mode, status } = useCatalog();
  const holding = holdPlace && status !== "ready";
  if (mode !== "demo" && !holding) return null;
  return (
    <p
      role={holding ? undefined : "note"}
      aria-hidden={holding || undefined}
      className={`rounded-md border border-ocean-blue/30 bg-ocean-blue/10 px-4 py-2 text-xs text-ocean-blue-dark ${holding ? "invisible" : ""}`}
    >
      <strong>Demo catalog:</strong> listings marked Demo use sample details, prices, stock and images for review. They are not real inventory.
    </p>
  );
}

/* ---------- Breadcrumb ---------- */
/** `linked={false}` shows the same trail as text (a staff preview never links shoppers' pages). */
export function Breadcrumb({ items, linked = true }: { items: { label: string; to?: string }[]; linked?: boolean }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-xs tracking-wide text-muted">
      {linked ? (
        <Link to="/" className="transition-colors hover:text-link hover:underline">
          Home
        </Link>
      ) : <span>Home</span>}
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flex items-center gap-1.5">
          <span aria-hidden="true">/</span>
          {item.to ? (
            linked ? (
              <Link to={item.to} className="transition-colors hover:text-link hover:underline">
                {item.label}
              </Link>
            ) : <span>{item.label}</span>
          ) : (
            <span aria-current="page" className="font-medium text-navy-900">{item.label}</span>
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
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 className="type-h2 break-words text-navy-900">
          {children}
        </h2>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/* ---------- Scroll reveal ---------- */
/** A block that rises into view as it is scrolled to (`reveal.ts`); `stagger` and `variant` as for `useReveal`. */
export function Reveal({
  children,
  className = "",
  stagger = false,
  variant = "rise",
  ...attributes
}: {
  children: ReactNode;
  className?: string;
} & RevealOptions & Omit<HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  const ref = useReveal<HTMLDivElement>({ stagger, variant });
  return (
    <div ref={ref} className={className} {...attributes}>
      {children}
    </div>
  );
}

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>;
}
