import { useEffect, useId, useRef, useState, type Ref } from "react";
import type { CatalogCategory, CatalogProduct } from "../api/catalog";
import { Link, navigate, useRoute } from "../router";
import { useCatalog } from "../store/CatalogContext";
import { primaryImage, productPriceView, type CategoryTree } from "../store/catalogModel";
import { MAX_SEARCH_LENGTH, listingRoute } from "../store/listingQuery";
import { formatKES } from "../utils/format";
import { searchCategories, searchSuggestions } from "../utils/search";
import { ResponsiveImage } from "./ui";

/** Suggestions start once this many characters are typed. */
export const SUGGEST_MIN_LENGTH = 2;
/** Pause in typing before the suggestions follow the text. */
export const SUGGEST_DELAY_MS = 150;
const PRODUCT_SUGGESTIONS = 5;
const CATEGORY_SUGGESTIONS = 3;
/**
 * The keyboard-active suggestion: its tint alone is 1.12:1 against the list, so it also takes the focus ring's look,
 * inset so the list's edge never clips it (and outlines survive forced colours).
 */
const activeOptionClass = "bg-surface-soft [outline:var(--focus-ring-width)_solid_var(--focus-ring)] [outline-offset:calc(-1*var(--focus-ring-width))]";

/** Field and button colours for the surface the search sits on; the white field needs no border on navy. */
const SEARCH_TONES = {
  navy: { field: "border-transparent", button: "bg-gold-500 text-navy-900 hover:bg-gold-400" },
  light: { field: "border-control", button: "bg-navy-900 text-white hover:bg-gold-500 hover:text-navy-900" },
} as const;

type Option =
  | { kind: "category"; key: string; route: string; category: CatalogCategory; context: string }
  | { kind: "product"; key: string; route: string; product: CatalogProduct };

function categoryContext(category: CatalogCategory, tree: CategoryTree) {
  const ancestors = tree.path(category.id).slice(0, -1);
  return ancestors.length ? `in ${ancestors.map((item) => item.name).join(" › ")}` : "Department";
}

/** Keeps the active option visible inside the list without scrolling the page around it. */
function revealInList(list: HTMLElement | null, option: HTMLElement | null) {
  if (!list || !option) return;
  const top = option.offsetTop - list.offsetTop;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (top + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + option.offsetHeight - list.clientHeight;
}

/**
 * Product search with a suggestion list (combobox pattern): matching departments or categories and products from the
 * loaded catalog. Submitting always goes to the listing, which reports its own errors if the catalog failed.
 */
export function ProductSearch({ onNavigate, tone = "light", inputRef }: {
  onNavigate?: () => void;
  tone?: keyof typeof SEARCH_TONES;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const { products, categories, status } = useCatalog();
  const route = useRoute();
  const [query, setQuery] = useState("");
  const [settled, setSettled] = useState("");
  // Open for the route it was opened on: Back, Forward or any other navigation closes the list.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === route;
  const setOpen = (value: boolean) => setOpenOn(value ? route : null);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const list = useRef<HTMLUListElement>(null);
  const term = query.trim();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettled(term);
      setActive(-1);
    }, SUGGEST_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [term]);

  const showing = open && term.length >= SUGGEST_MIN_LENGTH && settled.length >= SUGGEST_MIN_LENGTH;
  const ready = status === "ready";
  const categoryOptions: Option[] = showing && ready
    ? searchCategories(settled, categories, CATEGORY_SUGGESTIONS).map((category) => ({
      kind: "category", key: `category-${category.id}`, route: listingRoute({ cat: category.slug }), category,
      context: categoryContext(category, categories),
    }))
    : [];
  const productOptions: Option[] = showing && ready
    ? searchSuggestions(settled, products, PRODUCT_SUGGESTIONS).map((product) => ({
      kind: "product", key: `product-${product.id}`, route: `/product/${encodeURIComponent(product.id)}`, product,
    }))
    : [];
  const options = [...categoryOptions, ...productOptions];
  const groups = [
    { label: "Departments and categories", kind: "category", entries: categoryOptions },
    { label: "Products", kind: "product", entries: productOptions },
  ].filter((group) => group.entries.length);
  const expanded = showing && options.length > 0;
  const activeIndex = expanded ? Math.min(active, options.length - 1) : -1;
  const optionId = (index: number) => `${listId}-option-${index}`;

  useEffect(() => {
    if (activeIndex >= 0) revealInList(list.current, document.getElementById(optionId(activeIndex)));
  });

  let message = "";
  if (showing) {
    if (status === "loading") message = "Loading suggestions…";
    else if (status === "error") message = "Suggestions are unavailable. Press Enter to search.";
    else if (!options.length) message = `No suggestions for "${settled}". Press Enter to search all products.`;
  }
  const announcement = !showing ? "" : expanded ? `${options.length} ${options.length === 1 ? "suggestion" : "suggestions"}` : message;

  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const go = (route: string) => {
    close();
    onNavigate?.();
    navigate(route);
  };
  const choose = (option: Option) => {
    setQuery("");
    go(option.route);
  };

  return (
    <div
      className="relative min-w-0"
      onBlur={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      <form role="search" aria-label="Products" onSubmit={(event) => { event.preventDefault(); go(listingRoute({ q: term })); }} className="flex">
        <input
          ref={inputRef}
          type="search"
          name="q"
          role="combobox"
          aria-label="Search products"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_SEARCH_LENGTH}
          enterKeyHint="search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActive(-1); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if ((event.key === "ArrowDown" || event.key === "ArrowUp") && expanded) {
              event.preventDefault();
              const last = options.length - 1;
              setActive(event.key === "ArrowDown"
                ? (activeIndex >= last ? 0 : activeIndex + 1)
                : (activeIndex <= 0 ? last : activeIndex - 1));
            } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !open) {
              event.preventDefault();
              setOpen(true);
            } else if (event.key === "Enter" && activeIndex >= 0) {
              event.preventDefault();
              choose(options[activeIndex]);
            } else if (event.key === "Escape" && (showing || query)) {
              // First Escape closes the list, the next clears the text; only then may Escape close what holds the search.
              event.preventDefault();
              event.stopPropagation();
              if (showing) close();
              else setQuery("");
            }
          }}
          placeholder="Search products"
          className={`min-w-0 w-full rounded-l-sm border bg-surface px-4 py-2.5 text-navy-900 placeholder:text-muted ${SEARCH_TONES[tone].field}`}
        />
        <button type="submit" aria-label="Submit product search" className={`flex min-w-[44px] items-center justify-center rounded-r-sm px-3 transition-colors duration-(--motion-feedback) ${SEARCH_TONES[tone].button}`}>
          <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="size-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z" />
          </svg>
        </button>
      </form>
      <p role="status" className="sr-only">{announcement}</p>
      {showing && (
        <div className="on-light absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-sm border border-divider bg-surface text-navy-800 shadow-overlay">
          {expanded ? (
            <ul ref={list} id={listId} role="listbox" aria-label="Search suggestions" className="max-h-[min(60dvh,28rem)] overflow-y-auto overscroll-contain py-1">
              {groups.map(({ label, kind, entries }) => {
                const labelId = `${listId}-${kind}`;
                return (
                  <li key={kind} role="presentation">
                    <ul role="group" aria-labelledby={labelId}>
                      <li role="presentation" id={labelId} className="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-[0.12em] text-gold-text">
                        {label}
                      </li>
                      {entries.map((option) => {
                        const index = options.indexOf(option);
                        return (
                          <li
                            key={option.key}
                            id={optionId(index)}
                            role="option"
                            aria-selected={index === activeIndex}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => choose(option)}
                            className={`flex min-h-[44px] cursor-pointer items-center gap-3 px-3 py-1.5 hover:bg-surface-soft ${index === activeIndex ? activeOptionClass : ""}`}
                          >
                            {option.kind === "product" ? <ProductOption product={option.product} /> : (
                              <span className="min-w-0 flex-1">
                                <span className="block break-words font-semibold text-navy-900">{option.category.name}</span>
                                <span className="block text-sm text-muted">{option.context}</span>
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-3 py-4 text-sm text-muted">{message}</p>
          )}
          <Link
            to={listingRoute({ q: term })}
            onClick={() => { close(); onNavigate?.(); }}
            className="flex min-h-[44px] items-center justify-center bg-navy-900 px-3 py-2 text-center text-sm font-semibold text-white hover:bg-gold-500 hover:text-navy-900"
          >
            <span className="min-w-0 break-words">See all results for &quot;{term}&quot;</span>
          </Link>
        </div>
      )}
    </div>
  );
}

function ProductOption({ product }: { product: CatalogProduct }) {
  const image = primaryImage(product);
  const price = productPriceView(product);
  return (
    <>
      {image ? (
        <ResponsiveImage url={image.url} preset="thumbnail" sizes="40px" width={image.width} height={image.height} alt="" className="size-10 shrink-0 rounded-sm object-cover" />
      ) : (
        <span aria-hidden="true" className="size-10 shrink-0 rounded-sm bg-surface-warm" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block break-words text-navy-900">{product.name}</span>
        <span className="block text-sm text-muted">{product.isDemo ? `Demo · ${product.categoryName}` : product.categoryName}</span>
      </span>
      {price && (
        <span className="shrink-0 text-sm font-semibold tabular-nums text-navy-900">
          {price.isFromPrice ? "From " : ""}{formatKES(price.price)}
        </span>
      )}
    </>
  );
}
