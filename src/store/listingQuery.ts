/**
 * The listing's URL (`#/shop?...`): the one shareable source of truth for search, scope, filters, sort and page.
 * Reading tolerates anything a link can carry; writing is canonical, so equal listings share one address.
 */

export const LISTING_SORTS = [
  { value: "featured", label: "Featured" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "rating", label: "Customer rating" },
] as const;
export type ListingSort = (typeof LISTING_SORTS)[number]["value"];

/** Selected values per key, for variant attributes (`a.<key>`) or specifications (`s.<name>`). */
export type Selections = ReadonlyMap<string, readonly string[]>;

export type ListingQuery = {
  /** Trimmed search text; empty means none. */
  q: string;
  /** Category slug at any level; empty means the whole catalog. */
  cat: string;
  /** Designer ID or slug; empty means any designer. */
  designer: string;
  featured: boolean;
  sort: ListingSort;
  /** 1-based. */
  page: number;
  /** OR within a key, AND across keys. */
  attributes: Selections;
  specs: Selections;
  /** Inclusive bounds on the effective price, in whole KES. */
  min: number | null;
  max: number | null;
  /** Only products that can be bought now. */
  inStock: boolean;
};

export const EMPTY_LISTING: ListingQuery = {
  q: "", cat: "", designer: "", featured: false, sort: "featured", page: 1,
  attributes: new Map(), specs: new Map(), min: null, max: null, inStock: false,
};

const ATTRIBUTE_PREFIX = "a.";
const SPEC_PREFIX = "s.";
const WHOLE_NUMBER = /^\d{1,15}$/;
/** Higher page numbers are certainly past the end; the listing shows its last page instead. */
const MAX_PAGE = 100_000;
/**
 * What a link may select. Beyond these the rest is ignored, so a hand-made or damaged address cannot stall the page:
 * longer than any useful search, more keys than a product may carry (32 specifications), more values than a shopper
 * would tick in one filter.
 */
export const MAX_SEARCH_LENGTH = 200;
export const MAX_SELECTION_KEYS = 32;
export const MAX_SELECTION_VALUES = 50;

const wholeNumber = (value: string | null) => (value !== null && WHOLE_NUMBER.test(value.trim()) ? Number(value.trim()) : null);

function readSelections(params: URLSearchParams, prefix: string): Selections {
  const selections = new Map<string, Set<string>>();
  for (const [name, raw] of params) {
    if (!name.startsWith(prefix)) continue;
    const key = name.slice(prefix.length).trim();
    const value = raw.trim();
    if (!key || !value) continue;
    let values = selections.get(key);
    if (!values) {
      if (selections.size >= MAX_SELECTION_KEYS) continue;
      values = new Set();
      selections.set(key, values);
    }
    if (values.size < MAX_SELECTION_VALUES) values.add(value);
  }
  return new Map([...selections].map(([key, values]) => [key, [...values]]));
}

/** Unknown names and invalid values are ignored rather than rejected, so an old or edited link still lists products. */
export function parseListingQuery(params: URLSearchParams): ListingQuery {
  const sortParam = params.get("sort");
  const sort = LISTING_SORTS.find((option) => option.value === sortParam)?.value ?? "featured";
  const page = wholeNumber(params.get("page"));
  let min = wholeNumber(params.get("min"));
  let max = wholeNumber(params.get("max"));
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  return {
    q: params.get("q")?.trim().slice(0, MAX_SEARCH_LENGTH).trim() ?? "",
    cat: params.get("cat")?.trim() ?? "",
    designer: params.get("designer")?.trim() ?? "",
    featured: params.get("featured") === "1",
    sort,
    page: page !== null && page >= 1 ? Math.min(page, MAX_PAGE) : 1,
    attributes: readSelections(params, ATTRIBUTE_PREFIX),
    specs: readSelections(params, SPEC_PREFIX),
    min,
    max,
    inStock: params.get("stock") === "in",
  };
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function writeSelections(params: URLSearchParams, prefix: string, selections: Selections) {
  for (const key of [...selections.keys()].sort(byCodeUnit)) {
    for (const value of [...(selections.get(key) ?? [])].sort(byCodeUnit)) params.append(`${prefix}${key}`, value);
  }
}

/** Canonical query string, in a fixed order with defaults omitted. */
export function listingSearch(query: ListingQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.cat) params.set("cat", query.cat);
  if (query.designer) params.set("designer", query.designer);
  if (query.featured) params.set("featured", "1");
  writeSelections(params, ATTRIBUTE_PREFIX, query.attributes);
  writeSelections(params, SPEC_PREFIX, query.specs);
  if (query.min !== null) params.set("min", String(query.min));
  if (query.max !== null) params.set("max", String(query.max));
  if (query.inStock) params.set("stock", "in");
  if (query.sort !== "featured") params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  return params.toString();
}

export function listingRoute(query: Partial<ListingQuery> = {}): string {
  const search = listingSearch({ ...EMPTY_LISTING, ...query });
  return search ? `/shop?${search}` : "/shop";
}

/** The route for `change` applied to `current`, and whether it gets a history entry of its own. */
export type ListingChange = { route: string; replace: boolean };

const sameSelections = (a: Selections, b: Selections) => {
  const write = (selections: Selections) => {
    const params = new URLSearchParams();
    writeSelections(params, "", selections);
    return params.toString();
  };
  return write(a) === write(b);
};

/**
 * History rule: search, scope (category, designer, featured) and page changes push an entry; filter, sort and price
 * changes replace the current one, so Back leaves the filtered view instead of undoing each tick. Any change other
 * than the page itself starts again at page 1.
 */
export function changeListing(current: ListingQuery, change: Partial<ListingQuery>): ListingChange {
  const next: ListingQuery = { ...current, ...change, page: change.page ?? 1 };
  const scopeChanged = next.q !== current.q || next.cat !== current.cat || next.designer !== current.designer ||
    next.featured !== current.featured;
  const filtersChanged = next.sort !== current.sort || next.min !== current.min || next.max !== current.max ||
    next.inStock !== current.inStock || !sameSelections(next.attributes, current.attributes) ||
    !sameSelections(next.specs, current.specs);
  const replace = !scopeChanged && (filtersChanged || next.page === current.page);
  return { route: listingRoute(next), replace };
}

/** `selections` with `value` added under `key`, or removed when it is already selected. */
export function toggleSelection(selections: Selections, key: string, value: string): Selections {
  const next = new Map(selections);
  const values = next.get(key) ?? [];
  const toggled = values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  if (toggled.length) next.set(key, toggled);
  else next.delete(key);
  return next;
}
