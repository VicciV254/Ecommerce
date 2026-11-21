import type { CatalogCategory } from "../api/catalog";
import { Link } from "../router";
import { listingRoute } from "../store/listingQuery";
import { RailControls, useRail } from "./Rail";
import { useReveal } from "./reveal";
import { MissingImage, ResponsiveImage, SectionTitle } from "./ui";

/** Tile width: at least 9rem, else 42% of the rail on phones (a third tile peeks in), 22% from 768px, 15% from 1280px. */
const TILE_WIDTH = "basis-[max(42%,9rem)] md:basis-[max(22%,9rem)] xl:basis-[max(15%,9rem)]";
/** The tile widths above as image slot sizes (the 9rem floor only matters on the narrowest phones). */
export const DEPARTMENT_TILE_SIZES = "(min-width: 90em) 208px, (min-width: 80em) 15vw, (min-width: 48em) 22vw, 42vw";
/** Grid tiles: 2 columns on phones, 4 from 768px and 7 from 1280px (`department-grid`), within the page's padding. */
const DEPARTMENT_GRID_SIZES =
  "(min-width: 90em) 187px, (min-width: 80em) calc((100vw - 136px) / 7), (min-width: 64em) calc((100vw - 100px) / 4), (min-width: 48em) calc((100vw - 84px) / 4), (min-width: 40em) calc((100vw - 60px) / 2), calc((100vw - 44px) / 2)";
/** Tiles a grid shows: 8 on phones, 12 from 768px and every one from 1280px; "All departments" leads to them all. */
const gridVisibility = (index: number) => (index < 8 ? "" : index < 12 ? "hidden md:block" : "hidden xl:block");

const allDepartmentsClass = "inline-flex min-h-[44px] items-center px-1 font-semibold text-link underline underline-offset-4 hover:text-link-hover";

/**
 * Departments in a rail the shopper scrolls themselves (swipe, scroll or Tab), with Previous/Next buttons shown only
 * when the rail can move that way. Nothing moves on its own and every tile is a single tab stop.
 */
export function DepartmentRail({ title, items }: { title: string; items: readonly CatalogCategory[] }) {
  const rail = useRail(items);
  return (
    <>
      <SectionTitle action={
        <div className="flex items-center gap-2">
          <Link ref={rail.link} to="/departments" className={allDepartmentsClass}>
            All departments
          </Link>
          <RailControls rail={rail} previousLabel="Previous departments" nextLabel="Next departments" />
        </div>
      }>
        {title}
      </SectionTitle>
      {/* An intentional horizontal scroller: the partly shown last tile signals that more follow. */}
      <ul ref={rail.list} aria-label={title} className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-1">
        {items.map((category) => (
          <li key={category.id} className={`shrink-0 snap-start ${TILE_WIDTH}`}>
            <DepartmentTile category={category} />
          </li>
        ))}
      </ul>
    </>
  );
}

/** The same tiles as a grid that shows the first 8, 12 or all of them by width; "All departments" lists the rest. */
export function DepartmentGrid({ title, items }: { title: string; items: readonly CatalogCategory[] }) {
  const reveal = useReveal<HTMLLIElement>({ stagger: true });
  return (
    <>
      <SectionTitle action={<Link to="/departments" className={allDepartmentsClass}>All departments</Link>}>
        {title}
      </SectionTitle>
      <ul aria-label={title} className="department-grid">
        {items.map((category, index) => (
          <li key={category.id} ref={reveal} className={`min-w-0 ${gridVisibility(index)}`}>
            <DepartmentTile category={category} sizes={DEPARTMENT_GRID_SIZES} />
          </li>
        ))}
      </ul>
    </>
  );
}

function DepartmentTile({ category, sizes = DEPARTMENT_TILE_SIZES }: { category: CatalogCategory; sizes?: string }) {
  return (
    <Link to={listingRoute({ cat: category.slug })} className="group relative block aspect-[4/5] overflow-hidden rounded-lg bg-surface-warm">
      {category.image ? (
        <ResponsiveImage
          url={category.image}
          preset="card"
          sizes={sizes}
          alt=""
          fade
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
        />
      ) : (
        <span className="absolute inset-0"><MissingImage label="No department image" iconOnly /></span>
      )}
      {/*
        The caption has its own dim band, so it stays legible over any artwork, plain white included. Its minimum height
        fits a two-line name, so the bands line up along the rail whether a name takes one line or two.
      */}
      <span className="absolute inset-x-0 bottom-0 flex min-h-[4.75rem] flex-col justify-end bg-navy-950/85 px-3 py-2.5 md:min-h-[5.75rem] md:px-4 md:py-3">
        <span className="block break-words font-display text-sm uppercase tracking-wider text-white sm:text-base">{category.name}</span>
        <span className="mt-0.5 block text-xs text-on-navy-muted">
          {category.productCount} {category.productCount === 1 ? "product" : "products"}
        </span>
      </span>
    </Link>
  );
}

/** The rail's shape while the catalog loads. */
export function DepartmentRailSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="skeleton mb-5 h-8 w-64 max-w-full rounded-sm" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className={`skeleton aspect-[4/5] shrink-0 rounded-lg ${TILE_WIDTH}`} />
        ))}
      </div>
    </div>
  );
}

/** The grid's shape while the catalog loads: the tiles it shows at each width for a store of 14 departments. */
export function DepartmentGridSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="skeleton mb-5 h-8 w-64 max-w-full rounded-sm" />
      <div className="department-grid">
        {Array.from({ length: 14 }, (_, index) => (
          <div key={index} className={`skeleton aspect-[4/5] rounded-lg ${gridVisibility(index)}`} />
        ))}
      </div>
    </div>
  );
}
