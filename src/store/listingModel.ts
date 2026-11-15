import type { CatalogCategory, CatalogProduct } from "../api/catalog";
import { formatKES } from "../utils/format";
import { searchProducts } from "../utils/search";
import { activeVariants, inCategory, optionLabel, productPriceView } from "./catalogModel";
import { toggleSelection, type ListingQuery, type Selections } from "./listingQuery";

/** Products per listing page: whole rows at two, three and four columns. */
export const LISTING_PAGE_SIZE = 12;

export type FacetValue = { value: string; count: number; selected: boolean };
export type Facet = {
  kind: "attribute" | "spec";
  /** URL key: the variant attribute or specification name. */
  key: string;
  label: string;
  values: FacetValue[];
};

/** What narrows the products in scope; the scope itself (search, category, designer, featured) is applied first. */
type Filters = Pick<ListingQuery, "attributes" | "specs" | "min" | "max" | "inStock">;

export type Listing = {
  /** Products in scope before filtering. */
  scoped: CatalogProduct[];
  /** Every product matching scope and filters, sorted; `page` is one slice of it. */
  results: CatalogProduct[];
  page: CatalogProduct[];
  pageNumber: number;
  pageCount: number;
  /** The query as applied: selections whose key the scope does not have are dropped. */
  applied: ListingQuery;
  facets: Facet[];
  /** Matches if only available products were shown. */
  inStockCount: number;
  /** Lowest and highest effective price in scope, or null when nothing in scope has a price. */
  priceRange: { min: number; max: number } | null;
  /** Matches per designer with every filter but the designer applied. */
  designerCounts: ReadonlyMap<string, number>;
};

export type ListingScope = {
  /** The category being listed; its descendants are included. */
  category?: CatalogCategory;
  designerId?: string;
  /** Specification names offered as filters: the scoped department's keys. */
  specKeys: readonly string[];
};

const ownValue = (record: Record<string, string>, key: string) =>
  (Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined);

/** Effective payable price: the cheapest active SKU's server projection; null when nothing can be bought. */
export function effectivePrice(product: CatalogProduct): number | null {
  return productPriceView(product)?.price ?? null;
}

/** OR within a key, AND across keys: attributes, availability and price must all hold for one active SKU or product. */
function matches(product: CatalogProduct, filters: Filters, price: number | null) {
  for (const [key, values] of filters.specs) {
    const value = ownValue(product.specifications, key);
    if (value === undefined || !values.includes(value)) return false;
  }
  if (filters.min !== null || filters.max !== null) {
    if (price === null) return false;
    if (filters.min !== null && price < filters.min) return false;
    if (filters.max !== null && price > filters.max) return false;
  }
  if (!filters.attributes.size && !filters.inStock) return true;
  return activeVariants(product).some((variant) => (!filters.inStock || variant.stock > 0) &&
    [...filters.attributes].every(([key, values]) => {
      const value = ownValue(variant.attributes, key);
      return value !== undefined && values.includes(value);
    }));
}

/** Values per key in first-seen order, from each product's `read`. */
function collect(products: readonly CatalogProduct[], read: (product: CatalogProduct) => Iterable<[string, string]>) {
  const found = new Map<string, string[]>();
  for (const product of products) {
    for (const [key, value] of read(product)) {
      const values = found.get(key) ?? [];
      if (!values.includes(value)) values.push(value);
      found.set(key, values);
    }
  }
  return found;
}

function* variantAttributes(product: CatalogProduct): Iterable<[string, string]> {
  for (const variant of activeVariants(product)) yield* Object.entries(variant.attributes);
}

/** Keeps only selections whose key the scope offers; their values stay even when nothing matches them now. */
function knownSelections(selections: Selections, offered: ReadonlyMap<string, readonly string[]>): Selections {
  return new Map([...selections].filter(([key]) => offered.has(key)));
}

function sortProducts(products: CatalogProduct[], sort: ListingQuery["sort"], prices: ReadonlyMap<string, number | null>) {
  // Unpriced products have nothing to compare, so they go last in either price order.
  const price = (product: CatalogProduct, missing: number) => prices.get(product.id) ?? missing;
  if (sort === "price-asc") return [...products].sort((a, b) => price(a, Infinity) - price(b, Infinity));
  if (sort === "price-desc") return [...products].sort((a, b) => price(b, -Infinity) - price(a, -Infinity));
  if (sort === "rating") return [...products].sort((a, b) => b.rating - a.rating || b.reviewsCount - a.reviewsCount);
  return products;
}

/**
 * The listing for `query` over the whole catalog: full result counts, the requested page, and facets whose value
 * counts each apply every other active filter (a selected value with no matches stays listed so it can be removed).
 */
export function buildListing(products: readonly CatalogProduct[], query: ListingQuery, scope: ListingScope): Listing {
  const searched = query.q ? searchProducts(query.q, products) : products;
  const anyDesigner = searched.filter((product) =>
    (!scope.category || inCategory(product, scope.category.id)) && (!query.featured || product.isFeatured));
  const scoped = anyDesigner.filter((product) => !scope.designerId || product.designerId === scope.designerId);
  const prices = new Map(anyDesigner.map((product) => [product.id, effectivePrice(product)]));
  const priceOf = (product: CatalogProduct) => prices.get(product.id) ?? null;

  const attributeValues = collect(scoped, variantAttributes);
  const specKeys = new Set(scope.specKeys);
  const specValues = collect(scoped, (product) =>
    Object.entries(product.specifications).filter(([key, value]) => specKeys.has(key) && value.trim() !== ""));
  const filters: Filters = {
    attributes: knownSelections(query.attributes, attributeValues),
    specs: knownSelections(query.specs, specValues),
    min: query.min,
    max: query.max,
    inStock: query.inStock,
  };
  const count = (applied: Filters) =>
    scoped.reduce((total, product) => total + Number(matches(product, applied, priceOf(product))), 0);

  const facetFor = (kind: Facet["kind"], key: string, values: readonly string[], selected: Selections, label: string): Facet => {
    const chosen = selected.get(key) ?? [];
    const listed = [...values, ...chosen.filter((value) => !values.includes(value))];
    const field = kind === "attribute" ? "attributes" : "specs";
    return {
      kind, key, label,
      values: listed.map((value) => ({
        value,
        selected: chosen.includes(value),
        count: count({ ...filters, [field]: new Map([...selected, [key, [value]]]) }),
      })),
    };
  };
  const facets = [
    ...[...attributeValues].map(([key, values]) => facetFor("attribute", key, values, filters.attributes, optionLabel(key))),
    ...scope.specKeys.filter((key) => specValues.has(key))
      .map((key) => facetFor("spec", key, specValues.get(key) ?? [], filters.specs, key)),
  ];

  const results = sortProducts(scoped.filter((product) => matches(product, filters, priceOf(product))), query.sort, prices);
  const pageCount = Math.max(1, Math.ceil(results.length / LISTING_PAGE_SIZE));
  const pageNumber = Math.min(query.page, pageCount);
  const priced = scoped.map(priceOf).filter((price): price is number => price !== null);
  const designerCounts = new Map<string, number>();
  for (const product of anyDesigner) {
    if (product.designerId === null || !matches(product, filters, priceOf(product))) continue;
    designerCounts.set(product.designerId, (designerCounts.get(product.designerId) ?? 0) + 1);
  }
  return {
    scoped,
    results,
    page: results.slice((pageNumber - 1) * LISTING_PAGE_SIZE, pageNumber * LISTING_PAGE_SIZE),
    pageNumber,
    pageCount,
    applied: { ...query, attributes: filters.attributes, specs: filters.specs },
    facets,
    inStockCount: count({ ...filters, inStock: true }),
    priceRange: priced.length ? { min: Math.min(...priced), max: Math.max(...priced) } : null,
    designerCounts,
  };
}

/** How many of `products` fall in each category of `categories`, counting descendants. */
export function countByCategory(products: readonly CatalogProduct[], categories: readonly CatalogCategory[]) {
  return new Map(categories.map((category) => [category.id, products.filter((product) => inCategory(product, category.id)).length]));
}

/** One removable condition of the listing, with the change that removes it. */
export type ActiveFilter = { id: string; label: string; without: Partial<ListingQuery> };

/** What "Clear all" removes: every filter, keeping the search and the category being browsed. */
export const CLEAR_FILTERS: Partial<ListingQuery> = {
  designer: "", featured: false, attributes: new Map(), specs: new Map(), min: null, max: null, inStock: false,
};

export function priceLabel(min: number | null, max: number | null) {
  if (min !== null && max !== null) return `${formatKES(min)} to ${formatKES(max)}`;
  return min !== null ? `${formatKES(min)} and up` : `Up to ${formatKES(max ?? 0)}`;
}

/** The applied search and filters, in URL order, each removable on its own. */
export function activeFilters(query: ListingQuery, designerName?: string): ActiveFilter[] {
  const filters: ActiveFilter[] = [];
  if (query.q) filters.push({ id: "q", label: `Search: ${query.q}`, without: { q: "" } });
  if (query.designer) filters.push({ id: "designer", label: `Designer: ${designerName ?? query.designer}`, without: { designer: "" } });
  if (query.featured) filters.push({ id: "featured", label: "Featured", without: { featured: false } });
  for (const [key, values] of query.attributes) {
    for (const value of values) {
      filters.push({ id: `a.${key}=${value}`, label: `${optionLabel(key)}: ${value}`, without: { attributes: toggleSelection(query.attributes, key, value) } });
    }
  }
  for (const [key, values] of query.specs) {
    for (const value of values) {
      filters.push({ id: `s.${key}=${value}`, label: `${key}: ${value}`, without: { specs: toggleSelection(query.specs, key, value) } });
    }
  }
  if (query.min !== null || query.max !== null) {
    filters.push({ id: "price", label: `Price: ${priceLabel(query.min, query.max)}`, without: { min: null, max: null } });
  }
  if (query.inStock) filters.push({ id: "stock", label: "In stock", without: { inStock: false } });
  return filters;
}
