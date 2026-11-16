import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { CatalogCategory, CatalogDesigner } from "../api/catalog";
import { ActiveFilterChips, FilterPanel, applyListingChange } from "../components/ListingFilters";
import { ModalDialog } from "../components/Modal";
import { ProductCard } from "../components/ProductCard";
import { Breadcrumb, Container, DemoCatalogNotice, ErrorPanel } from "../components/ui";
import { Link, parseRoute, useRouteState, type RouteState } from "../router";
import { useCatalog } from "../store/CatalogContext";
import { CLEAR_FILTERS, LISTING_PAGE_SIZE, activeFilters, buildListing, type ActiveFilter, type Listing } from "../store/listingModel";
import { LISTING_SORTS, changeListing, listingRoute, parseListingQuery, type ListingQuery } from "../store/listingQuery";
import { recallListingScroll, rememberListingScroll } from "../store/listingScroll";

/** From this width the filters sit beside the results; below it they open in a sheet. */
const SIDEBAR_QUERY = "(min-width: 1280px)";
/** Page links shown on each side of the current page before the rest are shortened to an ellipsis. */
const PAGE_WINDOW = 1;
const SKELETON_CARDS = 12;

const primaryAction =
  "inline-flex min-h-[44px] items-center justify-center rounded-sm bg-navy-900 px-5 text-sm font-semibold text-white transition-colors duration-(--motion-feedback) hover:bg-gold-500 hover:text-navy-900";
const outlineAction =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-sm border border-navy-900 px-4 text-sm font-semibold text-navy-900 transition-colors duration-(--motion-feedback) hover:bg-navy-900 hover:text-white";

export default function Shop({ route }: { route: string }) {
  const catalog = useCatalog();
  const query = useMemo(() => parseListingQuery(parseRoute(route).params), [route]);

  if (catalog.status === "loading") return <ListingSkeleton />;
  if (catalog.status === "error") {
    // Retrying reloads the catalog only; the address, and with it the search and filters, stays as it is.
    return (
      <Container className="py-16">
        <ErrorPanel title="Products are unavailable" message={catalog.error ?? "The catalog could not be loaded."} onRetry={catalog.reload} />
      </Container>
    );
  }

  const category = query.cat ? catalog.categories.bySlug.get(query.cat) : undefined;
  const designer = query.designer
    ? catalog.designers.find((item) => item.slug === query.designer || item.id === query.designer)
    : undefined;
  if ((query.cat && !category) || (query.designer && !designer)) {
    return (
      <Container className="py-16">
        <ErrorPanel
          title={query.cat && !category ? "Category not found" : "Designer not found"}
          message="This link does not match anything in the current catalog. It may have been renamed, hidden or removed."
        >
          <Link to="/shop" className={primaryAction}>View All Products</Link>
        </ErrorPanel>
      </Container>
    );
  }

  return <ShopListing query={query} category={category} designer={designer} />;
}

function ShopListing({ query, category, designer }: { query: ListingQuery; category?: CatalogCategory; designer?: CatalogDesigner }) {
  const catalog = useCatalog();
  const navigation = useRouteState();
  const heading = useRef<HTMLHeadingElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const [showFilters, setShowFilters] = useState(false);
  const path = useMemo(() => (category ? catalog.categories.path(category.id) : []), [catalog.categories, category]);
  // Specification filters come from the department and any narrower category that names its own keys.
  const specKeys = useMemo(() => [...new Set(path.flatMap((item) => item.attributeKeys))], [path]);
  const listing = useMemo(
    () => buildListing(catalog.products, query, { category, designerId: designer?.id, specKeys }),
    [catalog.products, query, category, designer, specKeys],
  );
  useListingEntry(navigation, heading, results);

  const applied = listing.applied;
  const filters = activeFilters(applied, designer?.name);
  const clearable = filters.filter((filter) => filter.id !== "q").length;
  const total = listing.results.length;
  const closeFilters = () => setShowFilters(false);

  const title = designer?.name ?? category?.name ?? (applied.q ? `Results for "${applied.q}"` : applied.featured ? "Featured products" : "All Products");
  const crumbs = category
    ? [
      { label: "Shop", to: "/shop" },
      ...path.map((item, index) => ({ label: item.name, to: index < path.length - 1 ? listingRoute({ cat: item.slug }) : undefined })),
    ]
    : [{ label: "Shop" }];
  const panel = (onNavigate?: () => void) => (
    <FilterPanel listing={listing} query={applied} category={category} categories={catalog.categories} designers={catalog.designers} onNavigate={onNavigate} />
  );

  return (
    <Container className="py-6 md:py-8">
      <Breadcrumb items={crumbs} />
      <div className="mt-4"><DemoCatalogNotice /></div>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 ref={heading} tabIndex={-1} className="type-h1 break-words text-navy-900">{title}</h1>
          <p aria-live="polite" className="mt-1 text-sm text-muted">{total} {total === 1 ? "product" : "products"} found</p>
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap items-end gap-3">
          <label className="flex min-w-0 max-w-full flex-col text-sm font-semibold text-navy-900">
            Sort by
            <select
              value={applied.sort}
              onChange={(event) => applyListingChange(applied, {
                sort: LISTING_SORTS.find((option) => option.value === event.target.value)?.value ?? "featured",
              })}
              className="mt-1 min-h-[44px] min-w-0 max-w-full rounded-sm border border-control bg-surface px-3 font-normal text-navy-900"
            >
              {LISTING_SORTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setShowFilters(true)}
            aria-haspopup="dialog"
            aria-expanded={showFilters}
            className={`${outlineAction} xl:hidden`}
          >
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-5"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" /></svg>
            Filters
            {clearable > 0 && (
              <span className="rounded-full bg-navy-900 px-2 text-xs font-bold leading-5 text-white">
                {clearable}<span className="sr-only"> active</span>
              </span>
            )}
          </button>
        </div>
      </div>

      {/* With nothing to show, the empty state carries these chips instead, so they are never listed twice. */}
      {filters.length > 0 && listing.page.length > 0 && (
        <div className="mt-4">
          <ActiveFilterChips filters={filters} query={applied} clearAll={clearable ? CLEAR_FILTERS : null} />
        </div>
      )}

      <div className="mt-6 xl:grid xl:grid-cols-[240px_minmax(0,1fr)] xl:gap-8">
        <aside aria-label="Filters" className="hidden xl:block">{panel()}</aside>
        <div ref={results} className="min-w-0">
          {listing.page.length ? (
            <>
              <ul aria-label="Products" className="product-grid">
                {listing.page.map((product) => <li key={product.id} className="min-w-0"><ProductCard product={product} /></li>)}
              </ul>
              <Pagination listing={listing} query={applied} />
            </>
          ) : (
            <EmptyListing listing={listing} query={applied} filters={filters} category={category} clearable={clearable > 0} />
          )}
        </div>
      </div>

      {showFilters && (
        <ModalDialog open label="Product filters" placement="sheet" dismissAt={SIDEBAR_QUERY} onClose={closeFilters}>
          <div className="on-light flex h-full w-full flex-col bg-surface text-navy-800 shadow-overlay animate-fade-in md:h-auto md:max-h-[min(90dvh,48rem)] md:max-w-lg md:rounded-lg">
            <div className="flex items-center justify-between gap-3 border-b border-divider py-1 pl-5 pr-2">
              <h2 className="type-h3 text-navy-900">Filters</h2>
              <button type="button" aria-label="Close filters" onClick={closeFilters} className="flex size-[44px] items-center justify-center rounded-full text-navy-900 hover:bg-surface-soft">
                <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">{panel(closeFilters)}</div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider px-5 py-3">
              {clearable > 0 ? (
                <button type="button" onClick={() => applyListingChange(applied, CLEAR_FILTERS)} className="inline-flex min-h-[44px] items-center px-1 text-sm font-semibold text-link underline underline-offset-4 hover:text-link-hover">
                  Clear all
                </button>
              ) : <span />}
              <button type="button" onClick={closeFilters} className={primaryAction}>
                Show {total} {total === 1 ? "result" : "results"}
              </button>
            </div>
            {/* Announces the live count inside the sheet, which makes the page behind it inert. */}
            <p role="status" className="sr-only">{total} {total === 1 ? "product matches" : "products match"}</p>
          </div>
        </ModalDialog>
      )}
    </Container>
  );
}

function EmptyListing({ listing, query, filters, category, clearable }: {
  listing: Listing; query: ListingQuery; filters: readonly ActiveFilter[]; category?: CatalogCategory; clearable: boolean;
}) {
  const named = filters.map((filter) => filter.label).join("; ");
  let message: string;
  if (listing.scoped.length && filters.length) message = `Nothing here matches ${named}. Remove a filter or clear them all.`;
  else if (query.q) message = `Nothing matches "${query.q}"${category ? ` in ${category.name}` : ""}. Check the spelling or try a broader search.`;
  else if (filters.length) message = `Nothing matches ${named}.`;
  else message = category ? `Nothing is listed in ${category.name} yet.` : "No products are listed yet.";
  return (
    <div className="rounded-lg border border-divider bg-surface p-6 text-center shadow-card md:p-10">
      <h2 className="type-h3 text-navy-900">No matching products</h2>
      <p className="mx-auto mt-2 max-w-xl break-words text-navy-800">{message}</p>
      {filters.length > 0 && (
        <div className="mt-5 flex justify-center">
          <ActiveFilterChips filters={filters} query={query} clearAll={clearable ? CLEAR_FILTERS : null} />
        </div>
      )}
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        {category && <Link to={changeListing(query, { cat: "" }).route} className={outlineAction}>Search all departments</Link>}
        <Link to="/departments" className={outlineAction}>Browse departments</Link>
      </div>
    </div>
  );
}

/** Page numbers to show: the first, the last and a window around the current page, with gaps marked by null. */
function pageNumbers(current: number, count: number): (number | null)[] {
  const pages: (number | null)[] = [];
  for (let page = 1; page <= count; page += 1) {
    if (page === 1 || page === count || Math.abs(page - current) <= PAGE_WINDOW) pages.push(page);
    else if (pages[pages.length - 1] !== null) pages.push(null);
  }
  return pages;
}

function Pagination({ listing, query }: { listing: Listing; query: ListingQuery }) {
  const { pageNumber: current, pageCount, results, page } = listing;
  const start = (current - 1) * LISTING_PAGE_SIZE + 1;
  const link = (number: number) => changeListing(query, { page: number }).route;
  const pageLink = "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm px-3 text-sm font-semibold transition-colors duration-(--motion-feedback)";
  return (
    <>
      {pageCount > 1 && (
        <nav aria-label="Pagination" className="mt-10 flex flex-wrap items-center justify-center gap-2">
          {current > 1 && <Link to={link(current - 1)} className={`${pageLink} border border-control text-navy-900 hover:bg-surface-soft`}>Previous</Link>}
          <ul className="flex flex-wrap items-center justify-center gap-1">
            {pageNumbers(current, pageCount).map((number, index) => (
              <li key={number ?? `gap-${index}`}>
                {number === null ? (
                  <span aria-hidden="true" className="px-1 text-muted">…</span>
                ) : number === current ? (
                  <span aria-current="page" className={`${pageLink} bg-navy-900 text-white`}>
                    <span className="sr-only">Page </span>{number}
                  </span>
                ) : (
                  <Link to={link(number)} className={`${pageLink} border border-control text-navy-900 hover:bg-surface-soft`}>
                    <span className="sr-only">Page </span>{number}
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {current < pageCount && <Link to={link(current + 1)} className={`${pageLink} border border-control text-navy-900 hover:bg-surface-soft`}>Next</Link>}
        </nav>
      )}
      <p className="mt-4 text-center text-sm text-muted">
        Showing {start}–{start + page.length - 1} of {results.length} {results.length === 1 ? "product" : "products"}
      </p>
    </>
  );
}

/** Keeps the listing's layout while the catalog loads, without animation. */
function ListingSkeleton() {
  const bar = "rounded-sm bg-surface-soft";
  return (
    <Container className="py-6 md:py-8">
      <p role="status" className="sr-only">Loading products…</p>
      <div aria-hidden="true">
        <div className={`h-4 w-40 ${bar}`} />
        <div className={`mt-9 h-9 w-56 max-w-full ${bar}`} />
        <div className={`mt-2 h-4 w-28 ${bar}`} />
        <div className="mt-6 xl:grid xl:grid-cols-[240px_minmax(0,1fr)] xl:gap-8">
          <div className="hidden space-y-3 xl:block">
            {Array.from({ length: 6 }, (_, index) => <div key={index} className={`h-6 ${bar}`} />)}
          </div>
          <div className="product-grid">
            {Array.from({ length: SKELETON_CARDS }, (_, index) => (
              <div key={index} className="overflow-hidden rounded-lg bg-surface shadow-card">
                <div className="aspect-square bg-surface-soft" />
                <div className="space-y-2 p-4">
                  <div className={`h-3 w-1/2 ${bar}`} />
                  <div className={`h-4 w-3/4 ${bar}`} />
                  <div className={`h-5 w-1/3 ${bar}`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Container>
  );
}

/** Whether this document was reloaded or brought back by Back/Forward from another site. */
function reopened() {
  if (typeof performance.getEntriesByType !== "function") return false;
  const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return entry?.type === "reload" || entry?.type === "back_forward";
}

/** Focus left in the site header (the menu button after the drawer closed, the search field) stays where it is. */
const focusInHeader = () => document.activeElement?.closest("[data-site-header]") != null;

/**
 * Route entry. Returning (Back/Forward, or a reload) puts the listing back where the shopper left it, with focus on
 * the product they came back from; other entries start at the top with focus on the heading. Filter changes, which
 * replace the entry, leave focus and scroll alone.
 */
function useListingEntry(navigation: RouteState, heading: RefObject<HTMLElement | null>, results: RefObject<HTMLElement | null>) {
  const handled = useRef<RouteState | null>(null);
  useLayoutEffect(() => {
    if (handled.current === navigation) return;
    handled.current = navigation;
    const { kind, route, previous } = navigation;
    if (kind === "replace") return;
    const saved = kind === "traverse" || (kind === "load" && reopened()) ? recallListingScroll(route) : null;
    if (saved !== null) window.scrollTo({ top: saved, behavior: "instant" as ScrollBehavior });
    if (kind === "load" || focusInHeader()) return;
    const card = saved !== null && previous
      ? [...(results.current?.querySelectorAll<HTMLAnchorElement>("a[href]:not([tabindex='-1'])") ?? [])]
        .find((link) => link.getAttribute("href") === `#${previous}`)
      : undefined;
    (card ?? heading.current)?.focus({ preventScroll: true });
  }, [navigation, heading, results]);

  useEffect(() => {
    let frame = 0;
    const save = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (window.location.hash === `#${navigation.route}`) rememberListingScroll(navigation.route, window.scrollY);
      });
    };
    window.addEventListener("scroll", save, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", save);
    };
  }, [navigation.route]);
}
