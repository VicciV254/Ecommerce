import { useEffect, useRef, useState } from "react";
import { Link, useRoute } from "../router";
import { useStore } from "../store/StoreContext";
import { useCatalog } from "../store/CatalogContext";
import { useStorefront } from "../store/StorefrontContext";
import { useAuth } from "../contexts/AuthContext";
import { listingRoute } from "../store/listingQuery";
import { loginRoute } from "../store/returnTo";
import { Container } from "./ui";
import { ModalDialog } from "./Modal";
import { useMiniCart } from "./MiniCart";
import { ProductSearch } from "./ProductSearch";
import { BrandLogo } from "./Brand";
import { DepartmentShortcuts, DepartmentsMenu, DrawerMenu } from "./HeaderMenus";
import { useStickyHeaderOffset } from "./stickyHeader";

/** Below this width the page links live in the drawer; it is also where the drawer closes itself. */
const INLINE_NAV_QUERY = "(min-width: 1280px)";
/** Pages whose phone layout shows the department shortcuts under the search. */
const SHORTCUT_PAGES = new Set(["/", "/shop"]);
const iconButton =
  "relative flex size-[44px] shrink-0 items-center justify-center rounded-full text-white transition-colors duration-(--motion-feedback) hover:bg-white/10";
const countBadge =
  "absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold-400 px-1 text-[10px] font-bold leading-none text-navy-900";
const drawerLink =
  "flex min-h-[44px] items-center rounded-sm px-3 text-sm font-semibold uppercase tracking-wider transition-colors duration-(--motion-feedback)";

const NAV_LINKS = [
  { to: "/", label: "Home" },
  { to: "/shop", label: "Shop" },
  { to: "/about", label: "About" },
  { to: "/contact", label: "Contact" },
  { to: "/track", label: "Track order" },
];

export function Header() {
  const { cartCount, state, ownerReady } = useStore();
  const miniCart = useMiniCart();
  const { categories } = useCatalog();
  const { brandName } = useStorefront();
  const departments = categories.roots;
  const { user } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const route = useRoute();
  const brandRow = useRef<HTMLElement>(null);
  const searchRow = useRef<HTMLDivElement>(null);
  const phoneSearch = useRef<HTMLInputElement>(null);
  // Over the sticky budget (short or zoomed phone viewports) the search row scrolls away; a button brings it back.
  const compact = useStickyHeaderOffset(brandRow, searchRow);

  // Current path + active query (e.g. "/shop", "/shop?cat=mens-fashion")
  const [pathPart, query] = route.split("?");
  const path = pathPart || "/";
  const params = new URLSearchParams(query || "");
  const activeCat = params.get("cat");
  const isActive = (to: string) => {
    if (to === "/") return path === "/";
    return path === to || path.startsWith(to);
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const revealSearch = () => {
    // The search row sits at the top of the page; the root's scroll-behavior makes this instant under reduced motion.
    window.scrollTo({ top: 0 });
    phoneSearch.current?.focus({ preventScroll: true });
  };
  const closeDrawer = () => setOpen(false);

  const drawerRoot = (
    <>
      {NAV_LINKS.map((l) => {
        const active = isActive(l.to);
        return (
          <Link
            key={l.to}
            to={l.to}
            aria-current={active ? "page" : undefined}
            onClick={closeDrawer}
            className={`${drawerLink} ${active ? "bg-navy-900 text-white" : "text-navy-900 hover:bg-surface-warm"}`}
          >
            {l.label}
          </Link>
        );
      })}
      <Link to={user ? "/account" : loginRoute(route)} onClick={closeDrawer} className={`${drawerLink} text-navy-900 hover:bg-surface-warm`}>
        {user ? "My account" : "Sign in / register"}
      </Link>
    </>
  );

  return (
    <>
      <header
        ref={brandRow}
        data-sticky-header
        data-site-header
        className={`on-navy sticky top-0 z-50 bg-navy-900 text-white transition-shadow duration-(--motion-feedback) ${scrolled ? "shadow-card" : ""}`}
      >
        {/* Brand row */}
        <Container className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 py-2 xl:gap-x-6">
          <Link to="/" className="flex min-h-[44px] shrink-0 items-center">
            <BrandLogo name={brandName} surface="navy" size="md" />
          </Link>

          {/* Search (tablet and desktop); its minimum width wraps the row at large text instead of crushing the field. */}
          <div className="relative hidden min-w-0 flex-1 md:block md:min-w-48 md:max-w-lg xl:max-w-2xl">
            <ProductSearch tone="navy" />
          </div>

          {/* The last 44px target reaches into the container padding so four of them fit beside the lockup at 360px. */}
          <div className="-mr-2 flex min-w-0 max-w-full flex-wrap items-center justify-end">
            {compact && (
              <button type="button" onClick={revealSearch} aria-label="Go to search" className={`${iconButton} md:hidden`}>
                <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z" />
                </svg>
              </button>
            )}
            <Link to="/wishlist" aria-label="Wishlist" className={iconButton}>
              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
              </svg>
              {ownerReady && state.wishlist.length > 0 && <span className={countBadge}>{state.wishlist.length}</span>}
            </Link>
            {/* Opens the mini-cart; the full cart page stays at #/cart, linked from the drawer. */}
            <button
              type="button"
              aria-label="Cart"
              aria-haspopup="dialog"
              aria-expanded={miniCart?.isOpen ?? false}
              aria-describedby={cartCount > 0 ? "header-cart-count" : undefined}
              onClick={() => miniCart?.open()}
              className={iconButton}
            >
              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0z" />
              </svg>
              {cartCount > 0 && (
                <span id="header-cart-count" className={countBadge}>
                  {cartCount}<span className="sr-only"> {cartCount === 1 ? "item" : "items"} in your cart</span>
                </span>
              )}
            </button>
            <Link to={user ? "/account" : loginRoute(route)} aria-label={user ? "Account" : "Sign in"} className={iconButton}>
              {user?.profileImage ? (
                <img src={user.profileImage} alt="" className="size-[32px] rounded-full object-cover" />
              ) : (
                <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill={user ? "currentColor" : "none"} viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6.75a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0zM4.5 20.25a7.5 7.5 0 0 1 15 0" />
                </svg>
              )}
            </Link>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className={`${iconButton} xl:hidden`}
              aria-label="Menu"
              aria-expanded={open}
              aria-haspopup="dialog"
            >
              {open ? (
                <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
              ) : (
                <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>
              )}
            </button>
          </div>
        </Container>

        {/* Desktop: the department panel and page links, below the search-led brand row. */}
        <div className="hidden border-t border-white/10 xl:block">
          {/* Wraps instead of overflowing when text is enlarged. */}
          <Container className="flex flex-wrap items-center gap-x-6 gap-y-1 py-1">
            <DepartmentsMenu />
            <nav aria-label="Main" className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-1">
              {NAV_LINKS.map((l) => {
                const active = isActive(l.to);
                return (
                  <Link
                    key={l.to}
                    to={l.to}
                    aria-current={active ? "page" : undefined}
                    className={`group relative inline-flex min-h-[44px] items-center text-sm font-semibold uppercase tracking-[0.12em] transition-colors duration-(--motion-feedback) ${
                      active ? "text-gold-400" : "text-on-navy-muted hover:text-white"
                    }`}
                  >
                    {l.label}
                    <span
                      className={`absolute bottom-1.5 left-0 h-0.5 bg-gold-400 transition-[width] duration-(--motion-feedback) ${
                        active ? "w-full" : "w-0 group-hover:w-full"
                      }`}
                    />
                  </Link>
                );
              })}
            </nav>
          </Container>
        </div>

        {/* Category strip on the Shop tab, from 1024px until the department panel takes over at 1280px */}
        <div className={`border-t border-white/10 ${path === "/shop" ? "hidden lg:block xl:hidden" : "hidden"}`}>
          <Container className="no-scrollbar flex items-center gap-0.5 overflow-x-auto py-0">
            {departments.map((c) => {
              const active = path === "/shop" && activeCat === c.slug;
              return (
                <Link
                  key={c.slug}
                  to={listingRoute({ cat: c.slug })}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex min-h-[44px] items-center whitespace-nowrap border-b-2 px-4 text-xs font-semibold uppercase tracking-widest transition-colors duration-(--motion-feedback) ${
                    active
                      ? "border-gold-400 text-gold-400"
                      : "border-transparent text-on-navy-muted hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {c.name}
                </Link>
              );
            })}
          </Container>
        </div>

        {open && (
          <ModalDialog open={open} label="Navigation menu" placement="end" dismissAt={INLINE_NAV_QUERY} onClose={closeDrawer}>
            <div className="on-light h-full w-80 max-w-full overflow-y-auto overscroll-contain border-l border-divider bg-surface text-navy-800 shadow-overlay animate-fade-in">
              <div className="flex items-center justify-between border-b border-divider py-1 pl-4 pr-2">
                <span className="text-xs font-bold uppercase tracking-[0.15em] text-navy-900">Menu</span>
                <button type="button" onClick={closeDrawer} aria-label="Close menu" className="flex size-[44px] items-center justify-center rounded-full hover:bg-surface-warm">
                  <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <DrawerMenu root={drawerRoot} onNavigate={closeDrawer} />
            </div>
          </ModalDialog>
        )}
      </header>

      {/* Phone search, directly below the brand row: sticky with it unless that would cover too much of the screen. */}
      <div
        ref={searchRow}
        data-site-header
        data-sticky-header={compact ? undefined : ""}
        className={`on-navy z-40 bg-navy-900 pb-3 md:hidden ${compact ? "" : "sticky top-(--sticky-brand-height)"} ${scrolled && !compact ? "shadow-card" : ""}`}
      >
        <Container>
          <ProductSearch tone="navy" inputRef={phoneSearch} />
        </Container>
      </div>
      {SHORTCUT_PAGES.has(path) && <DepartmentShortcuts />}
    </>
  );
}
