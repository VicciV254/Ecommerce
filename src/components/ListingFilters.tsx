import { useId, useState, type FormEvent } from "react";
import type { CatalogCategory, CatalogDesigner } from "../api/catalog";
import { Link, navigate } from "../router";
import type { CategoryTree } from "../store/catalogModel";
import { countByCategory, type ActiveFilter, type Facet, type Listing } from "../store/listingModel";
import { changeListing, toggleSelection, type ListingQuery } from "../store/listingQuery";
import { COLOR_MAP } from "../utils/colors";
import { formatKES } from "../utils/format";

const WHOLE_AMOUNT = /^\d{1,12}$/;
const groupHeading = "text-sm font-semibold uppercase tracking-[0.12em] text-navy-900";
const optionRow =
  "flex min-h-[44px] cursor-pointer items-center gap-3 rounded-sm px-2 text-navy-800 transition-colors duration-(--motion-feedback) hover:bg-surface-soft";
const navRow =
  "flex min-h-[44px] items-center justify-between gap-3 rounded-sm px-2 text-navy-800 transition-colors duration-(--motion-feedback) hover:bg-surface-soft hover:text-navy-900";

/** Applies a filter change in place (filters replace the history entry; scope changes push one). */
export function applyListingChange(query: ListingQuery, change: Partial<ListingQuery>) {
  const { route, replace } = changeListing(query, change);
  navigate(route, { replace });
}

function Count({ value }: { value: number }) {
  return <span className="ml-auto shrink-0 text-sm tabular-nums text-muted">{value}</span>;
}

type FilterPanelProps = {
  listing: Listing;
  query: ListingQuery;
  category?: CatalogCategory;
  categories: CategoryTree;
  designers: readonly CatalogDesigner[];
  /** Runs before a category or designer link navigates (the phone sheet closes). */
  onNavigate?: () => void;
};

/** Category and designer scope, price, availability and the facets the scoped products actually have. */
export function FilterPanel({ listing, query, category, categories, designers, onNavigate }: FilterPanelProps) {
  const parent = category?.parentId ? categories.byId.get(category.parentId) : undefined;
  const children = category ? categories.children(category.id) : categories.roots;
  const counts = countByCategory(listing.results, children);
  const shownChildren = children.filter((child) => (counts.get(child.id) ?? 0) > 0);
  const designerRows = designers.filter((designer) =>
    (listing.designerCounts.get(designer.id) ?? 0) > 0 || designer.slug === query.designer || designer.id === query.designer);
  const selectedDesigner = query.designer !== "";

  return (
    <div className="space-y-6">
      <nav aria-label="Categories">
        <h3 className={groupHeading}>Category</h3>
        <ul className="mt-2 space-y-0.5">
          {category && (
            <li>
              <Link to={changeListing(query, { cat: parent?.slug ?? "" }).route} onClick={onNavigate} className={`${navRow} font-semibold text-link`}>
                <span><span aria-hidden="true">← </span>{parent ? `Back to ${parent.name}` : "All departments"}</span>
              </Link>
            </li>
          )}
          {shownChildren.map((child) => (
            <li key={child.id}>
              <Link to={changeListing(query, { cat: child.slug }).route} onClick={onNavigate} className={navRow}>
                <span className="min-w-0 break-words">{child.name}</span>
                <Count value={counts.get(child.id) ?? 0} />
              </Link>
            </li>
          ))}
        </ul>
        {!shownChildren.length && <p className="mt-2 px-2 text-sm text-muted">No narrower categories.</p>}
      </nav>

      <PriceFilter query={query} range={listing.priceRange} />

      <fieldset className="border-t border-divider pt-5">
        <legend className={`${groupHeading} float-left mb-2 w-full`}>Availability</legend>
        <label className={`${optionRow} clear-left`}>
          <input
            type="checkbox"
            checked={query.inStock}
            onChange={() => applyListingChange(query, { inStock: !query.inStock })}
            className="size-5 shrink-0 accent-navy-900"
          />
          <span>In stock only</span>
          <Count value={listing.inStockCount} />
        </label>
      </fieldset>

      {listing.facets.map((facet) => <FacetGroup key={`${facet.kind}:${facet.key}`} facet={facet} query={query} />)}

      {designerRows.length > 0 && (
        <nav aria-label="Designers" className="border-t border-divider pt-5">
          <h3 className={groupHeading}>Designer</h3>
          <ul className="mt-2 space-y-0.5">
            {selectedDesigner && (
              <li>
                <Link to={changeListing(query, { designer: "" }).route} onClick={onNavigate} className={`${navRow} font-semibold text-link`}>
                  <span><span aria-hidden="true">← </span>All designers</span>
                </Link>
              </li>
            )}
            {designerRows.map((designer) => {
              const current = designer.slug === query.designer || designer.id === query.designer;
              return (
                <li key={designer.id}>
                  <Link
                    to={changeListing(query, { designer: designer.slug }).route}
                    onClick={onNavigate}
                    aria-current={current ? "true" : undefined}
                    className={`${navRow} ${current ? "font-semibold text-navy-900" : ""}`}
                  >
                    <span className="min-w-0 break-words">
                      {designer.name}
                      {designer.isDemo && <span className="ml-1.5 text-xs font-bold uppercase text-link">Demo</span>}
                    </span>
                    <Count value={listing.designerCounts.get(designer.id) ?? 0} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}

function FacetGroup({ facet, query }: { facet: Facet; query: ListingQuery }) {
  const field = facet.kind === "attribute" ? "attributes" : "specs";
  return (
    <fieldset className="border-t border-divider pt-5">
      {/* Floated so the legend sits inside the fieldset's padding like the other group headings. */}
      <legend className={`${groupHeading} float-left mb-2 w-full`}>{facet.label}</legend>
      <ul className="clear-left space-y-0.5">
        {facet.values.map(({ value, count, selected }) => {
          const swatch = facet.kind === "attribute" && facet.key === "color" ? COLOR_MAP[value] : undefined;
          return (
            <li key={value}>
              <label className={optionRow}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => applyListingChange(query, { [field]: toggleSelection(query[field], facet.key, value) })}
                  className="size-5 shrink-0 accent-navy-900"
                />
                {swatch && <span aria-hidden="true" className="size-5 shrink-0 rounded-full border border-control" style={{ background: swatch }} />}
                <span className="min-w-0 break-words">{value}</span>
                <Count value={count} />
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

const amountText = (amount: number | null) => (amount === null ? "" : String(amount));

/** Whole-KES bounds, applied on submit or when a field is left; nothing is applied while an entry is invalid. */
function PriceFilter({ query, range }: { query: ListingQuery; range: Listing["priceRange"] }) {
  const id = useId();
  const [min, setMin] = useState(amountText(query.min));
  const [max, setMax] = useState(amountText(query.max));
  const [error, setError] = useState<string | null>(null);
  // Bounds changed elsewhere (a removed chip, Back) replace the entries; the fields stay mounted so focus is kept.
  const [shown, setShown] = useState({ min: query.min, max: query.max });
  if (shown.min !== query.min || shown.max !== query.max) {
    setShown({ min: query.min, max: query.max });
    setMin(amountText(query.min));
    setMax(amountText(query.max));
    setError(null);
  }

  const apply = () => {
    const [low, high] = [min.trim(), max.trim()];
    if ((low && !WHOLE_AMOUNT.test(low)) || (high && !WHOLE_AMOUNT.test(high))) {
      setError("Enter whole amounts in KES, using digits only.");
      return;
    }
    const next = { min: low ? Number(low) : null, max: high ? Number(high) : null };
    if (next.min !== null && next.max !== null && next.min > next.max) {
      setError("The minimum must not be above the maximum.");
      return;
    }
    setError(null);
    if (next.min !== query.min || next.max !== query.max) applyListingChange(query, next);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    apply();
  };
  const field = "min-w-0 w-full rounded-sm border border-control bg-surface px-3 py-2 text-navy-900 placeholder:text-muted";

  return (
    <form onSubmit={submit} noValidate aria-labelledby={`${id}-heading`} className="border-t border-divider pt-5">
      <h3 id={`${id}-heading`} className={groupHeading}>Price (KES)</h3>
      {range && <p className="mt-1 text-sm text-muted">From {formatKES(range.min)} to {formatKES(range.max)} here</p>}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="min-w-0 text-sm text-navy-800">
          Minimum price
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={min}
            onChange={(event) => setMin(event.target.value)}
            onBlur={apply}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className={`mt-1 ${field}`}
          />
        </label>
        <label className="min-w-0 text-sm text-navy-800">
          Maximum price
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={max}
            onChange={(event) => setMax(event.target.value)}
            onBlur={apply}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className={`mt-1 ${field}`}
          />
        </label>
      </div>
      {error && <p id={`${id}-error`} role="alert" className="mt-2 text-sm text-error">{error}</p>}
      <button
        type="submit"
        className="mt-3 inline-flex min-h-[44px] items-center rounded-sm border border-navy-900 px-4 text-sm font-semibold text-navy-900 transition-colors duration-(--motion-feedback) hover:bg-navy-900 hover:text-white"
      >
        Apply price
      </button>
    </form>
  );
}

/** Removable chips for the applied search and filters, plus Clear all when any filter is set. */
export function ActiveFilterChips({ filters, query, clearAll }: {
  filters: readonly ActiveFilter[];
  query: ListingQuery;
  clearAll: Partial<ListingQuery> | null;
}) {
  if (!filters.length) return null;
  return (
    <ul aria-label="Active filters" className="flex flex-wrap items-center gap-2">
      {filters.map((filter) => (
        <li key={filter.id} className="min-w-0 max-w-full">
          <button
            type="button"
            aria-label={`Remove ${filter.label}`}
            onClick={() => applyListingChange(query, filter.without)}
            className="inline-flex min-h-[44px] max-w-full items-center gap-2 rounded-full border border-control bg-surface px-4 text-sm text-navy-900 transition-colors duration-(--motion-feedback) hover:bg-surface-soft"
          >
            <span className="min-w-0 break-words text-left">{filter.label}</span>
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="size-4 shrink-0">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </li>
      ))}
      {clearAll && (
        <li>
          <button
            type="button"
            onClick={() => applyListingChange(query, clearAll)}
            className="inline-flex min-h-[44px] items-center px-2 text-sm font-semibold text-link underline underline-offset-4 hover:text-link-hover"
          >
            Clear all
          </button>
        </li>
      )}
    </ul>
  );
}
