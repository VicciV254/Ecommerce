import { useEffect, useId, useRef, useState } from "react";
import { Link, navigate } from "../router";
import { useCatalog } from "../store/CatalogContext";
import { primaryImage, productPriceView } from "../store/catalogModel";
import { formatKES } from "../utils/format";
import { searchSuggestions } from "../utils/search";
import { ResponsiveImage } from "./ui";

/** Field and button colours for the surface the search sits on; the white field needs no border on navy. */
const SEARCH_TONES = {
  navy: { field: "border-transparent", button: "bg-gold-500 text-navy-900 hover:bg-gold-400" },
  light: { field: "border-control", button: "bg-navy-900 text-white hover:bg-gold-500 hover:text-navy-900" },
} as const;

export function ProductSearch({ onNavigate, tone = "light" }: { onNavigate?: () => void; tone?: keyof typeof SEARCH_TONES }) {
  const { products, status } = useCatalog();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const activeOption = useRef<HTMLButtonElement>(null);
  const term = query.trim();
  const suggestions = term ? searchSuggestions(term, products, 6) : [];
  const expanded = focused && Boolean(term);
  const activeIndex = Math.min(active, suggestions.length - 1);

  useEffect(() => {
    activeOption.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const close = () => {
    setFocused(false);
    setActive(-1);
  };
  const select = (id: string) => {
    close();
    setQuery("");
    onNavigate?.();
    navigate(`/product/${id}`);
  };
  const search = () => {
    close();
    onNavigate?.();
    navigate(`/shop?q=${encodeURIComponent(term)}`);
  };

  return (
    <div
      className="relative min-w-0"
      onBlur={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <form onSubmit={(event) => { event.preventDefault(); search(); }} className="flex">
        <input
          type="search"
          name="q"
          role="combobox"
          aria-label="Search products"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-activedescendant={expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActive(-1); setFocused(true); }}
          onFocus={() => setFocused(true)}
          onKeyDown={(event) => {
            if ((event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.length) {
              event.preventDefault();
              setFocused(true);
              setActive((current) => event.key === "ArrowDown"
                ? (current + 1) % suggestions.length
                : (current <= 0 ? suggestions.length - 1 : current - 1));
            } else if (event.key === "Enter" && expanded && activeIndex >= 0) {
              event.preventDefault();
              select(suggestions[activeIndex].id);
            } else if (event.key === "Escape" && expanded) {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
          placeholder="Search products"
          className={`min-w-0 w-full rounded-l-sm border bg-surface px-4 py-2.5 text-navy-900 placeholder:text-muted ${SEARCH_TONES[tone].field}`}
        />
        <button type="submit" aria-label="Submit product search" className={`rounded-r-sm px-4 transition-colors duration-(--motion-feedback) ${SEARCH_TONES[tone].button}`}>
          <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z" />
          </svg>
        </button>
      </form>
      {expanded && (
        <div className="on-light absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-sm border border-divider bg-surface text-navy-800 shadow-overlay">
          <div id={listId} role="listbox" aria-label="Product suggestions" className="max-h-[50dvh] overflow-y-auto overscroll-contain">
            {suggestions.map((product, index) => {
              const image = primaryImage(product);
              const price = productPriceView(product);
              return (
              <button
                key={product.id}
                ref={index === activeIndex ? activeOption : undefined}
                id={`${listId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(product.id)}
                className={`flex w-full items-center gap-2 border-b border-light-gray/60 px-3 py-2 text-left last:border-0 hover:bg-warm-beige ${index === activeIndex ? "bg-warm-beige" : ""}`}
              >
                {image ? (
                  <ResponsiveImage url={image.url} preset="thumbnail" width={image.width} height={image.height} alt="" className="h-10 w-10 shrink-0 rounded-sm object-cover" />
                ) : (
                  <span aria-hidden="true" className="h-10 w-10 shrink-0 rounded-sm bg-warm-beige" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-brand-primary">{product.name}</span>
                  <span className="block text-xs text-gray-500">{product.isDemo ? `Demo · ${product.categoryName}` : product.categoryName}</span>
                </span>
                {price && (
                  <span className="shrink-0 text-xs font-bold text-brand-primary">
                    {price.isFromPrice ? "From " : ""}{formatKES(price.price)}
                  </span>
                )}
              </button>
              );
            })}
          </div>
          {!suggestions.length && (
            <p role="status" className="px-3 py-4 text-sm text-gray-500">
              {status === "ready" ? "No matches. Press Enter to search." : status === "loading" ? "Loading the catalog…" : "Suggestions are unavailable. Press Enter to search."}
            </p>
          )}
          <Link to={`/shop?q=${encodeURIComponent(term)}`} onClick={() => { close(); onNavigate?.(); }} className="block bg-brand-primary px-3 py-2.5 text-center text-xs font-semibold text-white hover:bg-brand-secondary hover:text-brand-primary">
            See all results for &quot;{term}&quot;
          </Link>
        </div>
      )}
    </div>
  );
}
