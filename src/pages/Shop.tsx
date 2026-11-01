import { useMemo, useState } from "react";
import type { CatalogCategory, CatalogProduct } from "../api/catalog";
import { Breadcrumb, Container, DemoCatalogNotice, ErrorPanel, LoadingPanel, ProductCard } from "../components/ui";
import { ModalDialog } from "../components/Modal";
import { Link, parseRoute } from "../router";
import { useCatalog } from "../store/CatalogContext";
import { activeVariants, inCategory, optionLabel, productPriceView } from "../store/catalogModel";
import { COLOR_MAP } from "../utils/colors";
import { searchProducts } from "../utils/search";

const PER_PAGE = 12;
const PRICE_STEP = 100;

const SORTS = [
  { value: "featured", label: "Featured" },
  { value: "price-asc", label: "Price: Low → High" },
  { value: "price-desc", label: "Price: High → Low" },
  { value: "rating", label: "Customer rating" },
] as const;
type Sort = (typeof SORTS)[number]["value"];
type Selections = Record<string, string[]>;

function shopRoute(params: { cat?: string; q?: string; designer?: string }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `/shop?${text}` : "/shop";
}

/** Option names and values offered by the products in scope, in first-seen order. */
function facetsFor(products: readonly CatalogProduct[]) {
  const facets = new Map<string, string[]>();
  for (const product of products) {
    for (const variant of activeVariants(product)) {
      for (const [key, value] of Object.entries(variant.attributes)) {
        const values = facets.get(key) ?? [];
        if (!values.includes(value)) values.push(value);
        facets.set(key, values);
      }
    }
  }
  return [...facets];
}

/** A product matches when one active SKU satisfies every selected option. */
function matchesSelections(product: CatalogProduct, selections: Selections) {
  const chosen = Object.entries(selections).filter(([, values]) => values.length);
  if (!chosen.length) return true;
  return activeVariants(product).some((variant) =>
    chosen.every(([key, values]) => values.includes(variant.attributes[key] ?? "")));
}

export default function Shop({ route }: { route: string }) {
  const catalog = useCatalog();
  const { params } = parseRoute(route);
  const catSlug = params.get("cat") ?? "";
  const designerParam = params.get("designer") ?? "";
  const q = params.get("q") ?? "";

  if (catalog.status === "loading") {
    return <Container className="py-16"><LoadingPanel label="Loading products…" /></Container>;
  }
  if (catalog.status === "error") {
    return (
      <Container className="py-16">
        <ErrorPanel title="Products are unavailable" message={catalog.error ?? "The catalog could not be loaded."} onRetry={catalog.reload} />
      </Container>
    );
  }

  const category = catSlug ? catalog.categories.bySlug.get(catSlug) : undefined;
  const designer = designerParam
    ? catalog.designers.find((item) => item.slug === designerParam || item.id === designerParam)
    : undefined;
  if ((catSlug && !category) || (designerParam && !designer)) {
    return (
      <Container className="py-16">
        <ErrorPanel
          title={catSlug && !category ? "Category not found" : "Designer not found"}
          message="This link does not match anything in the current catalog. It may have been renamed, hidden or removed."
        >
          <Link to="/shop" className="rounded-sm bg-brand-primary px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary">
            View All Products
          </Link>
        </ErrorPanel>
      </Container>
    );
  }

  return <ShopListing key={route} category={category} designerId={designer?.id} designerName={designer?.name} q={q} designerParam={designerParam} />;
}

function ShopListing({ category, designerId, designerName, designerParam, q }: {
  category?: CatalogCategory; designerId?: string; designerName?: string; designerParam: string; q: string;
}) {
  const catalog = useCatalog();
  const [sort, setSort] = useState<Sort>("featured");
  const [selections, setSelections] = useState<Selections>({});
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  const scoped = useMemo(() => {
    const base = q ? searchProducts(q, catalog.products) : catalog.products;
    return base.filter((product) =>
      (!category || inCategory(product, category.id)) && (!designerId || product.designerId === designerId));
  }, [catalog.products, q, category, designerId]);

  const prices = useMemo(() => new Map(scoped.flatMap((product) => {
    const price = productPriceView(product);
    return price ? [[product.id, price.price] as const] : [];
  })), [scoped]);
  const priceCeiling = Math.max(PRICE_STEP, Math.ceil(Math.max(0, ...prices.values()) / PRICE_STEP) * PRICE_STEP);
  const priceLimit = maxPrice ?? priceCeiling;
  const facets = useMemo(() => facetsFor(scoped), [scoped]);

  const filtered = useMemo(() => {
    const list = scoped.filter((product) =>
      (prices.get(product.id) ?? 0) <= priceLimit && matchesSelections(product, selections));
    const price = (product: CatalogProduct) => prices.get(product.id) ?? 0;
    if (sort === "price-asc") return [...list].sort((a, b) => price(a) - price(b));
    if (sort === "price-desc") return [...list].sort((a, b) => price(b) - price(a));
    if (sort === "rating") return [...list].sort((a, b) => b.rating - a.rating || b.reviewsCount - a.reviewsCount);
    return list;
  }, [scoped, prices, priceLimit, selections, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const current = Math.min(page, totalPages);
  const pageItems = filtered.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  const toggleOption = (key: string, value: string) => {
    setSelections((existing) => {
      const values = existing[key] ?? [];
      return { ...existing, [key]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value] };
    });
    setPage(1);
  };
  const clearAll = () => {
    setSelections({});
    setMaxPrice(null);
    setPage(1);
  };

  const path = category ? catalog.categories.path(category.id) : [];
  const children = category ? catalog.categories.children(category.id) : catalog.categories.roots;
  const scopeParams = { q, designer: designerParam };

  const filterPanel = (
    <div className="space-y-7">
      <nav aria-label="Departments">
        <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">
          {category ? category.name : "Departments"}
        </h2>
        {category && (
          <Link to={shopRoute({ ...scopeParams, cat: path.length > 1 ? path[path.length - 2].slug : undefined })} className="mb-2 block text-xs font-semibold text-ocean-blue hover:underline">
            ← {path.length > 1 ? path[path.length - 2].name : "All departments"}
          </Link>
        )}
        {children.length > 0 ? (
          <ul className="space-y-1.5">
            {children.map((child) => (
              <li key={child.id}>
                <Link to={shopRoute({ ...scopeParams, cat: child.slug })} className="flex justify-between gap-2 text-sm text-charcoal hover:text-brand-secondary">
                  <span>{child.name}</span>
                  <span className="text-xs text-gray-500">{child.productCount}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-500">No sub-categories.</p>
        )}
      </nav>

      {catalog.designers.length > 0 && (
        <nav aria-label="Designers">
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Designers</h2>
          <ul className="space-y-1.5">
            {designerId && (
              <li>
                <Link to={shopRoute({ q, cat: category?.slug })} className="text-xs font-semibold text-ocean-blue hover:underline">← All designers</Link>
              </li>
            )}
            {catalog.designers.map((item) => (
              <li key={item.id}>
                <Link
                  to={shopRoute({ q, cat: category?.slug, designer: item.slug })}
                  aria-current={item.id === designerId ? "true" : undefined}
                  className={`text-sm hover:text-brand-secondary ${item.id === designerId ? "font-bold text-brand-primary" : "text-charcoal"}`}
                >
                  {item.name}
                  {item.isDemo && <span className="ml-1 text-[10px] font-bold uppercase text-ocean-blue">Demo</span>}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div>
        <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Price Range</h2>
        <input
          type="range"
          aria-label="Maximum price"
          min={0}
          max={priceCeiling}
          step={PRICE_STEP}
          value={priceLimit}
          onChange={(event) => { setMaxPrice(Number(event.target.value)); setPage(1); }}
          className="w-full accent-brand-secondary"
        />
        <p className="mt-1 text-xs text-gray-500">KES 0 — KES {priceLimit.toLocaleString("en-KE")}</p>
      </div>

      {facets.map(([key, values]) => (
        <fieldset key={key}>
          <legend className="mb-3 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">{optionLabel(key)}</legend>
          <div className="flex flex-wrap gap-1.5">
            {values.map((value) => {
              const selected = (selections[key] ?? []).includes(value);
              const swatch = key === "color" ? COLOR_MAP[value] : undefined;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  aria-label={swatch ? value : undefined}
                  title={value}
                  onClick={() => toggleOption(key, value)}
                  style={swatch ? { background: swatch } : undefined}
                  className={swatch
                    ? `h-7 w-7 rounded-full border-2 ${selected ? "border-brand-primary ring-2 ring-brand-secondary/50 ring-offset-1" : "border-gray-300"}`
                    : `rounded-sm border px-2.5 py-1.5 text-[11px] font-medium ${selected ? "border-brand-primary bg-brand-primary text-white" : "border-light-gray text-charcoal hover:border-brand-accent"}`}
                >
                  {swatch ? null : value}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      <button
        type="button"
        onClick={clearAll}
        className="w-full rounded-sm border border-brand-primary py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-primary transition-colors hover:bg-brand-primary hover:text-white"
      >
        Clear All Filters
      </button>
    </div>
  );

  const heading = designerName ?? category?.name ?? (q ? `Results for "${q}"` : "All Products");
  const crumbs = [
    { label: "Shop", to: "/shop" },
    ...path.map((item, index) => ({ label: item.name, to: index < path.length - 1 ? shopRoute({ cat: item.slug }) : undefined })),
  ];

  return (
    <Container className="py-8">
      <Breadcrumb items={category ? crumbs : [{ label: "Shop" }]} />
      <div className="mt-4"><DemoCatalogNotice /></div>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl uppercase tracking-wider text-brand-primary sm:text-3xl">{heading}</h1>
          <p className="mt-1 text-xs text-gray-500">{filtered.length} {filtered.length === 1 ? "product" : "products"} found</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Sort products"
            value={sort}
            onChange={(event) => {
              setSort(SORTS.find((option) => option.value === event.target.value)?.value ?? "featured");
              setPage(1);
            }}
            className="rounded-sm border border-light-gray bg-white px-3 py-2 text-xs outline-none"
          >
            {SORTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button
            type="button"
            onClick={() => setShowFilters((open) => !open)}
            aria-haspopup="dialog"
            aria-expanded={showFilters}
            className="flex items-center gap-1.5 rounded-sm border border-light-gray px-3 py-2 text-xs lg:hidden"
          >
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-3.5 w-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" /></svg>
            Filters
          </button>
        </div>
      </div>

      <div className="mt-6 flex gap-8">
        <aside className="hidden w-60 shrink-0 lg:block">
          <div className="sticky top-40">{filterPanel}</div>
        </aside>

        {showFilters && (
          <ModalDialog open={showFilters} label="Product filters" placement="end" dismissAt="(min-width: 1024px)" onClose={() => setShowFilters(false)}>
            <div className="h-full w-80 max-w-full overflow-y-auto overscroll-contain bg-white p-6">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="font-display text-lg">Filters</h2>
                <button type="button" aria-label="Close filters" onClick={() => setShowFilters(false)} className="text-gray-500 hover:text-brand-primary">
                  <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                </button>
              </div>
              {filterPanel}
            </div>
          </ModalDialog>
        )}

        <div className="min-w-0 flex-1">
          {pageItems.length === 0 ? (
            <div className="rounded-lg bg-white p-16 text-center shadow-sm">
              <p className="font-display text-2xl text-brand-primary">No matching products</p>
              <p className="mt-3 text-sm text-gray-500">
                {scoped.length ? "Try adjusting your filters." : "Nothing is listed here yet. Try another department or search."}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {pageItems.map((product) => <ProductCard key={product.id} product={product} />)}
              </div>

              {totalPages > 1 && (
                <nav aria-label="Pagination" className="mt-10 flex flex-wrap items-center justify-center gap-1.5">
                  <button type="button" disabled={current === 1} onClick={() => setPage(current - 1)} className="rounded-sm border border-light-gray px-3 py-2 text-xs disabled:opacity-30">
                    ← Prev
                  </button>
                  {Array.from({ length: totalPages }, (_, index) => index + 1).map((number) => (
                    <button
                      key={number}
                      type="button"
                      aria-current={number === current ? "page" : undefined}
                      onClick={() => setPage(number)}
                      className={`h-8 w-8 rounded-sm text-xs ${number === current ? "bg-brand-primary text-white" : "border border-light-gray hover:bg-warm-beige"}`}
                    >
                      {number}
                    </button>
                  ))}
                  <button type="button" disabled={current === totalPages} onClick={() => setPage(current + 1)} className="rounded-sm border border-light-gray px-3 py-2 text-xs disabled:opacity-30">
                    Next →
                  </button>
                </nav>
              )}

              <p className="mt-4 text-center text-[11px] text-gray-500">
                Showing {(current - 1) * PER_PAGE + 1}–{Math.min(current * PER_PAGE, filtered.length)} of {filtered.length} products
              </p>
            </>
          )}
        </div>
      </div>
    </Container>
  );
}
