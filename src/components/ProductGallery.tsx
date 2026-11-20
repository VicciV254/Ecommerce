import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { MediaAsset } from "../api/catalog";
import { Lightbox, imageAlt } from "./Lightbox";
import { MissingImage, ResponsiveImage, SampleImageLabel } from "./ui";

/** A swipe or scroll counts as finished once the stage has been still this long. */
const SCROLL_SETTLE_MS = 100;

const wrap = (index: number, count: number) => ((index % count) + count) % count;

const stageButton =
  "absolute z-10 flex size-[44px] items-center justify-center rounded-full border-2 border-navy-900 bg-white text-navy-900 shadow-card transition-colors duration-(--motion-feedback) hover:bg-surface-soft";
const icon = (path: string) => (
  <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="size-5">
    <path strokeLinecap="round" strokeLinejoin="round" d={path} />
  </svg>
);

export type GalleryLayout = {
  /** Rendered width of the main stage, as an `<img sizes>` value. */
  sizes: string;
  /** Rendered width of one thumbnail button. */
  thumbnailSizes: string;
  /** Classes for the thumbnail list (a grid on the product page, a row in Quick View). */
  thumbnails: string;
  /** Classes for each thumbnail's list item, where the list does not size them itself. */
  thumbnailItem?: string;
  /** Classes limiting the stage's width, where it should not fill its column. */
  stage?: string;
};

/**
 * The product images shared by the product page and Quick View: a stage that swipes natively (scroll snapping), 44px
 * Previous/Next buttons, an "n of m" count, thumbnails, ←/→ while the gallery has focus, and a zoom button that opens
 * the full-screen viewer. Nothing moves on its own. A new `resetKey` (a changed choice) returns to the first image.
 */
export function ProductGallery({ name, images, resetKey, layout, priority = false, zoom = true }: {
  name: string;
  images: readonly MediaAsset[];
  resetKey: string;
  layout: GalleryLayout;
  /** Only the product page's first image loads eagerly with high priority. */
  priority?: boolean;
  zoom?: boolean;
}) {
  const stage = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);
  const [viewing, setViewing] = useState(false);
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const shownKey = useRef(resetKey);
  const count = images.length;
  const current = Math.min(index, Math.max(0, count - 1));

  // "auto" follows the stage's CSS: smooth, unless the shopper prefers reduced motion.
  const scrollToIndex = (target: number, smooth: boolean) => {
    const element = stage.current;
    if (!element) return;
    element.scrollTo({ left: target * element.clientWidth, behavior: smooth ? "auto" : "instant" });
  };
  const go = (target: number, smooth = true) => {
    if (!count) return;
    const next = wrap(target, count);
    setIndex(next);
    scrollToIndex(next, smooth);
  };

  // A changed choice shows the first image of the new set.
  useLayoutEffect(() => {
    if (shownKey.current === resetKey) return;
    shownKey.current = resetKey;
    setIndex(0);
    stage.current?.scrollTo({ left: 0, behavior: "instant" });
  }, [resetKey]);

  // A swipe (or any scroll of the stage) settles on the nearest image.
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    let timer = 0;
    const settle = () => {
      const width = element.clientWidth;
      if (width > 0) setIndex(Math.min(count - 1, Math.max(0, Math.round(element.scrollLeft / width))));
    };
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(settle, SCROLL_SETTLE_MS);
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      element.removeEventListener("scroll", onScroll);
    };
  }, [count]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (count < 2 || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    go(current + (event.key === "ArrowLeft" ? -1 : 1));
  };

  if (!count) {
    return (
      <div className={layout.stage}>
        <div className="relative aspect-square overflow-hidden rounded-lg bg-surface-warm">
          <MissingImage label="Product images are not yet available" />
        </div>
      </div>
    );
  }

  const image = images[current];
  // Only the shown image and its neighbours (the next swipe either way) are requested; the rest wait their turn.
  const nearby = new Set([current - 1, current, current + 1]);
  return (
    <div onKeyDown={onKeyDown} className={layout.stage}>
      <div className="relative">
        <ul
          ref={stage}
          aria-label={`Images of ${name}`}
          tabIndex={-1}
          className="no-scrollbar flex aspect-square snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-lg bg-surface-warm motion-safe:scroll-smooth"
        >
          {images.map((item, position) => {
            const isCurrent = position === current;
            const broken = failed.has(item.url);
            const requested = nearby.has(position) || loaded.has(item.url);
            return (
              <li key={item.id} aria-hidden={isCurrent ? undefined : true} className="relative w-full shrink-0 snap-center snap-always">
                {broken ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-muted">
                    <p className="text-sm font-medium">Image unavailable</p>
                    <p className="mt-1 text-xs">Try another image.</p>
                  </div>
                ) : requested && (
                  <ResponsiveImage
                    url={item.url}
                    preset="detail"
                    sizes={layout.sizes}
                    width={item.width}
                    height={item.height}
                    priority={priority && position === 0}
                    alt={imageAlt(item, name, position, count)}
                    className="absolute inset-0 h-full w-full object-cover"
                    onLoad={() => setLoaded((set) => new Set(set).add(item.url))}
                    onError={() => setFailed((set) => new Set(set).add(item.url))}
                  />
                )}
                {isCurrent && !broken && !loaded.has(item.url) && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-gold-500 border-t-transparent" />
                    <p className="mt-3 text-xs text-muted">Loading image...</p>
                  </div>
                )}
                {item.isPlaceholder && <SampleImageLabel />}
              </li>
            );
          })}
        </ul>
        {count > 1 && (
          <>
            <button type="button" aria-label="Previous image" onClick={() => go(current - 1)} className={`${stageButton} left-2 top-1/2 -translate-y-1/2`}>
              {icon("M15.75 19.5 8.25 12l7.5-7.5")}
            </button>
            <button type="button" aria-label="Next image" onClick={() => go(current + 1)} className={`${stageButton} right-2 top-1/2 -translate-y-1/2`}>
              {icon("m8.25 4.5 7.5 7.5-7.5 7.5")}
            </button>
          </>
        )}
        {zoom && (
          <button type="button" aria-label={`Zoom image ${current + 1} of ${count}`} aria-haspopup="dialog" onClick={() => setViewing(true)} className={`${stageButton} right-2 top-2`}>
            {icon("m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607ZM10.5 7.5v6m3-3h-6")}
          </button>
        )}
      </div>
      {count > 1 && (
        <>
          <p aria-live="polite" className="mt-2 text-sm text-muted">Image {current + 1} of {count}</p>
          <ul aria-label="Choose an image" className={`mt-2 ${layout.thumbnails}`}>
            {images.map((item, position) => (
              <li key={item.id} className={layout.thumbnailItem ?? "min-w-0"}>
                <button
                  type="button"
                  aria-label={`Image ${position + 1} of ${count}`}
                  aria-current={position === current ? "true" : undefined}
                  onClick={() => go(position)}
                  className={`relative block aspect-square w-full overflow-hidden rounded-md border-2 bg-surface-warm transition-colors duration-(--motion-feedback) ${
                    position === current ? "border-navy-900" : "border-transparent hover:border-gold-600 forced-colors:border-[color:Canvas]"
                  }`}
                >
                  <ResponsiveImage url={item.url} preset="thumbnail" sizes={layout.thumbnailSizes} width={item.width} height={item.height} alt="" className="h-full w-full object-cover" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {viewing && image && (
        <Lightbox
          name={name}
          images={images}
          index={current}
          onIndexChange={(next) => go(next, false)}
          onClose={() => setViewing(false)}
        />
      )}
    </div>
  );
}
