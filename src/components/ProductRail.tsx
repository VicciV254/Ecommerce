import type { CatalogProduct } from "../api/catalog";
import { Link } from "../router";
import { ProductCard } from "./ProductCard";
import { RailControls, useRail } from "./Rail";
import { CardSkeleton, SectionTitle } from "./ui";

/**
 * Card width: 42% of the row on phones (part of a third card shows), 30% from 768px, 23% from 1024px and 17.5% from
 * 1280px (five cards and part of the sixth). Never narrower than 9rem, or 9.5rem on phones, where a narrower card
 * breaks its "Add to cart" onto two lines.
 */
const CARD_WIDTH = "basis-[max(42%,9.5rem)] md:basis-[max(30%,9rem)] lg:basis-[max(23%,9rem)] xl:basis-[max(17.5%,9rem)]";
/** The card widths above as image slot sizes: the row spans the page, inside its 16, 24 or 32px padding. */
const RAIL_CARD_SIZES =
  "(min-width: 90em) 241px, (min-width: 80em) calc((100vw - 64px) * 0.175), (min-width: 64em) calc((100vw - 64px) * 0.23), (min-width: 48em) calc((100vw - 48px) * 0.3), (min-width: 40em) calc((100vw - 48px) * 0.42), calc((100vw - 32px) * 0.42)";
/**
 * The row runs to the edges of the page's content box, with the page's own padding inside it, so cards line up with
 * the heading at rest and scroll out to the window's edge. Its padding also leaves room inside the scroller for a
 * card's hover lift (top) and shadow (bottom and sides) and for focus rings, which a scroller would otherwise cut off.
 */
const RAIL_CLASS =
  "no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto overscroll-x-contain px-4 pb-8 pt-2 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:-mx-8 lg:scroll-px-8 lg:px-8";

export const sectionLinkClass = "inline-flex min-h-[44px] items-center px-1 font-semibold text-link underline underline-offset-4 hover:text-link-hover";

/** A section's link to the listing that holds the rest, named for the section in screen-reader text. */
export type SectionLink = { to: string; label: "View all" | "See all" };

/**
 * Products in a row the shopper scrolls themselves (swipe, scroll or Tab), with Previous and Next named for the section
 * (a page can hold several rows) and shown only when the row can move that way. Nothing moves on its own.
 */
export function ProductRail({ title, products, link, note, productPreviewRoute }: {
  title: string;
  products: readonly CatalogProduct[];
  link: SectionLink;
  /** A line under the heading saying how the row was chosen. */
  note?: string;
  productPreviewRoute?: (productId: string) => string;
}) {
  const rail = useRail(products);
  return (
    <>
      <SectionTitle subtitle={note} action={
        <div className="flex items-center gap-2">
          <Link ref={rail.link} to={link.to} className={sectionLinkClass}>
            {link.label}<span className="sr-only"> {title}</span>
          </Link>
          <RailControls rail={rail} previousLabel={`Previous products in ${title}`} nextLabel={`Next products in ${title}`} />
        </div>
      }>
        {title}
      </SectionTitle>
      <ul ref={rail.list} aria-label={title} className={RAIL_CLASS}>
        {products.map((product) => (
          // A grid cell, so the card fills its slot's width and every card in the row matches the tallest.
          <li key={product.id} className={`grid shrink-0 snap-start ${CARD_WIDTH}`}>
            <ProductCard product={product} imageSizes={RAIL_CARD_SIZES} previewRoute={productPreviewRoute?.(product.id)} />
          </li>
        ))}
      </ul>
    </>
  );
}

/** A product row's shape while the catalog loads. */
export function ProductRailSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="skeleton mb-5 h-8 w-56 max-w-full rounded-sm" />
      <div className="flex gap-3 overflow-hidden pb-8 pt-2">
        {Array.from({ length: 6 }, (_, index) => <CardSkeleton key={index} className={`shrink-0 ${CARD_WIDTH}`} />)}
      </div>
    </div>
  );
}
