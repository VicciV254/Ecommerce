import { useMemo, useState } from "react";
import { CATEGORIES, COLOR_MAP, PRODUCTS } from "../data/products";
import { Breadcrumb, Container, ProductCard } from "../components/ui";
import { useStore } from "../store/StoreContext";
import { parseRoute } from "../router";

const ALL_SIZES = ["S", "M", "L", "XL", "30", "32", "34", "36", "One Size"];
const ALL_COLORS = ["White", "Black", "Blue", "Red", "Green", "Grey", "Gold", "Pink", "Brown", "Navy"];
const PER_PAGE = 12;

export function Shop({ route }: { route: string }) {
  const { productWithStock } = useStore();
  const { params } = parseRoute(route);
  const initialCat = params.get("cat") ?? "";
  const q = params.get("q") ?? "";

  const [cats, setCats] = useState<string[]>(initialCat ? [initialCat] : []);
  const [maxPrice, setMaxPrice] = useState(30000);
  const [sizes, setSizes] = useState<string[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [sort, setSort] = useState("featured");
  const [page, setPage] = useState(1);

  const toggle = (arr: string[], set: (v: string[]) => void, val: string) => {
    set(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);
    setPage(1);
  };

  const filtered = useMemo(() => {
    let list = PRODUCTS.filter((p) => {
      if (cats.length && !cats.includes(p.categorySlug)) return false;
      if (p.price > maxPrice) return false;
      if (sizes.length && !(p.sizes ?? []).some((s) => sizes.includes(s))) return false;
      if (colors.length && !(p.colors ?? []).some((c) => colors.includes(c))) return false;
      if (q && !p.name.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
    if (sort === "price-asc") list = [...list].sort((a, b) => a.price - b.price);
    else if (sort === "price-desc") list = [...list].sort((a, b) => b.price - a.price);
    else if (sort === "rating") list = [...list].sort((a, b) => b.rating - a.rating);
    return list;
  }, [cats, maxPrice, sizes, colors, q, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const cur = Math.min(page, totalPages);
  const pageItems = filtered.slice((cur - 1) * PER_PAGE, cur * PER_PAGE);

  const clearAll = () => {
    setCats([]);
    setMaxPrice(30000);
    setSizes([]);
    setColors([]);
    setPage(1);
  };

  const FilterPanel = (
    <div className="space-y-7">
      <div>
        <h4 className="mb-3 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Category</h4>
        <div className="space-y-2">
          {CATEGORIES.map((c) => (
            <label key={c.slug} className="flex cursor-pointer items-center gap-2.5 text-sm text-charcoal">
              <input
                type="checkbox"
                checked={cats.includes(c.slug)}
                onChange={() => toggle(cats, setCats, c.slug)}
                className="h-3.5 w-3.5 accent-brand-secondary"
              />
              {c.name}
            </label>
          ))}
        </div>
      </div>

      <div>
        <h4 className="mb-3 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Price Range</h4>
        <input
          type="range"
          min={500}
          max={30000}
          step={500}
          value={maxPrice}
          onChange={(e) => { setMaxPrice(Number(e.target.value)); setPage(1); }}
          className="w-full accent-brand-secondary"
        />
        <p className="mt-1 text-xs text-gray-400">KES 0 — KES {maxPrice.toLocaleString()}</p>
      </div>

      <div>
        <h4 className="mb-3 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Size</h4>
        <div className="flex flex-wrap gap-1.5">
          {ALL_SIZES.map((s) => (
            <button
              key={s}
              onClick={() => toggle(sizes, setSizes, s)}
              className={`rounded-sm border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                sizes.includes(s)
                  ? "border-brand-primary bg-brand-primary text-white"
                  : "border-light-gray text-charcoal hover:border-brand-accent"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h4 className="mb-3 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Color</h4>
        <div className="flex flex-wrap gap-2">
          {ALL_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => toggle(colors, setColors, c)}
              title={c}
              className={`h-6 w-6 rounded-full border-2 transition-all ${
                colors.includes(c) ? "border-brand-primary ring-2 ring-brand-secondary/50 ring-offset-1" : "border-gray-200 hover:border-gray-400"
              }`}
              style={{ background: COLOR_MAP[c] }}
            />
          ))}
        </div>
      </div>

      <button
        onClick={clearAll}
        className="w-full rounded-sm border border-brand-primary py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-primary transition-colors hover:bg-brand-primary hover:text-white"
      >
        Clear All Filters
      </button>
    </div>
  );

  const [showFilters, setShowFilters] = useState(false);

  return (
    <Container className="py-8">
      <Breadcrumb items={[{ label: "Shop" }]} />
      <div className="mt-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl uppercase tracking-wider text-brand-primary sm:text-3xl">
            {cats.length === 1 ? CATEGORIES.find((c) => c.slug === cats[0])?.name : q ? `Results for "${q}"` : "All Products"}
          </h1>
          <p className="mt-1 text-xs text-gray-400">{filtered.length} products found</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded-sm border border-light-gray bg-light-pink px-3 py-2 text-xs outline-none"
          >
            <option value="featured">Featured</option>
            <option value="price-asc">Price: Low → High</option>
            <option value="price-desc">Price: High → Low</option>
            <option value="rating">Top Rated</option>
          </select>
          <button
            onClick={() => setShowFilters((s) => !s)}
            className="flex items-center gap-1.5 rounded-sm border border-light-gray px-3 py-2 text-xs lg:hidden"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-3.5 w-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" /></svg>
            Filters
          </button>
        </div>
      </div>

      <div className="mt-6 flex gap-8">
        <aside className="hidden w-60 shrink-0 lg:block">
          <div className="sticky top-40">{FilterPanel}</div>
        </aside>

        {showFilters && (
          <div className="fixed inset-0 z-50 flex lg:hidden">
            <div className="flex-1 bg-black/30" onClick={() => setShowFilters(false)} />
            <div className="w-80 max-w-[85%] overflow-y-auto bg-light-pink p-6">
              <div className="mb-5 flex items-center justify-between">
                <h3 className="font-display text-lg">Filters</h3>
                <button onClick={() => setShowFilters(false)} className="text-gray-400 hover:text-brand-primary">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                </button>
              </div>
              {FilterPanel}
            </div>
          </div>
        )}

        <div className="flex-1">
          {pageItems.length === 0 ? (
            <div className="rounded-lg bg-light-pink p-16 text-center shadow-sm">
              <p className="text-4xl text-gray-200">No results</p>
              <p className="mt-3 text-sm text-gray-400">Try adjusting your filters or search terms.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {pageItems.map((p) => (
                  <ProductCard key={p.id} product={productWithStock(p)} />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="mt-10 flex flex-wrap items-center justify-center gap-1.5">
                  <button
                    disabled={cur === 1}
                    onClick={() => setPage(cur - 1)}
                    className="rounded-sm border border-light-gray px-3 py-2 text-xs disabled:opacity-30"
                  >
                    ← Prev
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      onClick={() => setPage(n)}
                      className={`h-8 w-8 rounded-sm text-xs ${
                        n === cur ? "bg-brand-primary text-white" : "border border-light-gray hover:bg-warm-beige"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    disabled={cur === totalPages}
                    onClick={() => setPage(cur + 1)}
                    className="rounded-sm border border-light-gray px-3 py-2 text-xs disabled:opacity-30"
                  >
                    Next →
                  </button>
                </div>
              )}

              <p className="mt-4 text-center text-[11px] text-gray-400">
                Showing {(cur - 1) * PER_PAGE + 1}–{Math.min(cur * PER_PAGE, filtered.length)} of {filtered.length} products
              </p>
            </>
          )}
        </div>
      </div>
    </Container>
  );
}
