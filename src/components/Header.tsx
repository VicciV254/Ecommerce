import { useEffect, useState } from "react";
import { Link, navigate, useRoute } from "../router";
import { useStore, formatKES } from "../store/StoreContext";
import { useAuth } from "../contexts/AuthContext";
import { searchSuggestions } from "../utils/search";
import { Container } from "./ui";

export function Header() {
  const { cartCount, state, catalog, allCategories } = useStore();
  const { user } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [focused, setFocused] = useState(false);
  const route = useRoute();

  // Current path + active query (e.g. "/shop", "/shop?cat=mens-fashion")
  const [path, query] = route.split("?");
  const params = new URLSearchParams(query || "");
  const activeCat = params.get("cat");
  const isActive = (to: string) => {
    const toPath = to.split("?")[0];
    if (toPath === "/") return path === "/" || path === "";
    return path === toPath || path.startsWith(toPath);
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const suggestions = search.trim().length >= 1 ? searchSuggestions(search, catalog, 6) : [];

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`/shop?q=${encodeURIComponent(search)}`);
    setFocused(false);
    setOpen(false);
  };

  const pickSuggestion = (id: string) => {
    setSearch("");
    setFocused(false);
    setOpen(false);
    navigate(`/product/${id}`);
  };

  const navLinks = [
    { to: "/", label: "Home" },
    { to: "/shop", label: "Shop" },
    { to: "/showroom", label: "Showroom" },
    { to: "/about", label: "About" },
    { to: "/contact", label: "Contact" },
    { to: "/track", label: "Track Order" },
  ];

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-light-pink/[.97] shadow-[0_1px_20px_rgba(0,0,0,0.06)] backdrop-blur-md"
          : "bg-light-pink border-b border-light-gray"
      }`}
    >


      {/* Main bar */}
      <Container className="flex items-center justify-between gap-4 py-3">
        {/* Logo */}
        <Link to="/" className="flex shrink-0 items-center gap-3">
          <img
            src="/images/logo.png"
            alt="No Maneno Bazaar"
            className="h-12 w-auto sm:h-14"
          />
        </Link>

        {/* Search (desktop) */}
        <div className="relative hidden flex-1 max-w-lg md:block">
          <form onSubmit={submitSearch} className="flex">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              placeholder="Search products, brands & more..."
              className="w-full rounded-l-sm border border-light-gray bg-off-white px-4 py-2.5 text-sm outline-none transition-colors focus:border-brand-secondary"
            />
            <button type="submit" className="rounded-r-sm bg-brand-primary px-5 text-white transition-colors hover:bg-brand-secondary hover:text-brand-primary">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z" />
              </svg>
            </button>
          </form>
          {/* Autocomplete dropdown */}
          {focused && search.trim() && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-sm border border-light-gray bg-white shadow-xl">
              {suggestions.length > 0 ? (
                <>
                  {suggestions.map((s) => (
                    <button
                      key={s.id}
                      onMouseDown={() => pickSuggestion(s.id)}
                      className="flex w-full items-center gap-3 border-b border-light-gray/60 px-3 py-2 text-left transition-colors last:border-0 hover:bg-warm-beige"
                    >
                      <img src={s.image} alt="" className="h-10 w-10 shrink-0 rounded-sm object-cover" />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-sm text-brand-primary">{s.name}</span>
                        <span className="block text-[11px] text-gray-400">{s.category}</span>
                      </span>
                      <span className="shrink-0 text-xs font-bold text-brand-primary">{formatKES(s.price)}</span>
                    </button>
                  ))}
                  <button
                    onMouseDown={() => { navigate(`/shop?q=${encodeURIComponent(search)}`); setFocused(false); }}
                    className="block w-full bg-brand-primary px-3 py-2.5 text-center text-[11px] font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary"
                  >
                    See all results for "{search}"
                  </button>
                </>
              ) : (
                <p className="px-3 py-4 text-center text-xs text-gray-400">No matches — press Enter to search anyway.</p>
              )}
            </div>
          )}
        </div>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-7 lg:flex">
          {navLinks.map((l) => {
            const active = isActive(l.to);
            return (
              <Link
                key={l.to}
                to={l.to}
                className={`group relative font-body text-[13px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                  active ? "text-brand-secondary" : "text-brand-primary hover:text-brand-secondary"
                }`}
              >
                {l.label}
                <span
                  className={`absolute -bottom-0.5 left-0 h-px bg-brand-secondary transition-all duration-300 ${
                    active ? "w-full" : "w-0 group-hover:w-full"
                  }`}
                />
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1">
          <Link
            to="/wishlist"
            aria-label="Wishlist"
            className="relative flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-warm-beige"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
            </svg>
            {state.wishlist.length > 0 && (
              <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-coral px-1 text-[9px] font-bold text-white">
                {state.wishlist.length}
              </span>
            )}
          </Link>
          <Link
            to={user ? "/account" : "/login"}
            aria-label={user ? "Account" : "Sign in"}
            className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full transition-colors hover:bg-warm-beige"
          >
            {user?.profileImage ? (
              <img src={user.profileImage} alt="" className="h-full w-full rounded-full object-cover ring-2 ring-brand-secondary/60" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" fill={user ? "currentColor" : "none"} viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6.75a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0zM4.5 20.25a7.5 7.5 0 0 1 15 0" />
              </svg>
            )}
            {user && !user.profileImage && (
              <span className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-success text-[9px] font-bold uppercase text-white">
                {user.firstName?.[0] ?? "U"}
              </span>
            )}
          </Link>
          <Link
            to="/cart"
            aria-label="Cart"
            className="relative flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-warm-beige"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0z" />
            </svg>
            {cartCount > 0 && (
              <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-secondary px-1 text-[9px] font-bold text-brand-primary">
                {cartCount}
              </span>
            )}
          </Link>
          <button
            onClick={() => setOpen((o) => !o)}
            className="ml-1 flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-warm-beige lg:hidden"
            aria-label="Menu"
          >
            {open ? (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>
            )}
          </button>
        </div>
      </Container>

      {/* Category strip — only on the Shop tab */}
      <div className={`border-t border-light-gray/60 ${path === "/shop" ? "hidden lg:block" : "hidden"}`}>
        <Container className="no-scrollbar flex items-center gap-0.5 overflow-x-auto py-0">
          {allCategories.map((c) => {
            const active = path === "/shop" && activeCat === c.slug;
            return (
              <Link
                key={c.slug}
                to={`/shop?cat=${c.slug}`}
                className={`whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors ${
                  active
                    ? "bg-brand-primary text-white"
                    : "text-charcoal/80 hover:bg-warm-beige hover:text-brand-primary"
                }`}
              >
                {c.name}
              </Link>
            );
          })}
        </Container>
      </div>

      {/* Mobile menu — slide-in drawer (half screen on small, ~40% on medium) */}
      {open && (
        <>
          <div className="fixed inset-0 top-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />
          <div className="fixed right-0 top-0 z-50 h-full w-1/2 min-w-[260px] max-w-sm overflow-y-auto border-l border-light-gray bg-white shadow-2xl animate-fade-in lg:hidden">
            <div className="flex items-center justify-between border-b border-light-gray px-4 py-3">
              <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Menu</span>
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-warm-beige">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex flex-col gap-0.5 px-4 py-4">
            <form onSubmit={submitSearch} className="mb-2 flex">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products…"
                className="w-full rounded-l-sm border border-light-gray bg-off-white px-4 py-2.5 text-sm outline-none"
              />
              <button type="submit" className="rounded-r-sm bg-brand-primary px-4 text-white">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z" />
                </svg>
              </button>
            </form>
            {search.trim() && suggestions.length > 0 && (
              <div className="mb-3 overflow-hidden rounded-sm border border-light-gray">
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => pickSuggestion(s.id)}
                    className="flex w-full items-center gap-2 border-b border-light-gray/60 px-2 py-1.5 text-left last:border-0 hover:bg-warm-beige"
                  >
                    <img src={s.image} alt="" className="h-8 w-8 shrink-0 rounded-sm object-cover" />
                    <span className="flex-1 truncate text-xs text-brand-primary">{s.name}</span>
                  </button>
                ))}
              </div>
            )}
            {navLinks.map((l) => {
              const active = isActive(l.to);
              return (
                <Link
                  key={l.to}
                  to={l.to}
                  onClick={() => setOpen(false)}
                  className={`rounded-sm px-3 py-2.5 text-sm font-semibold uppercase tracking-wider transition-colors ${
                    active
                      ? "bg-brand-primary text-white"
                      : "text-brand-primary hover:bg-warm-beige"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
            <Link
              to={user ? "/account" : "/login"}
              onClick={() => setOpen(false)}
              className="rounded-sm px-3 py-2.5 text-sm font-semibold uppercase tracking-wider text-brand-primary transition-colors hover:bg-warm-beige"
            >
              {user ? "My Account" : "Sign In / Register"}
            </Link>
            <div className="mt-3 border-t border-light-gray pt-3">
              <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-brand-accent">Categories</p>
              <div className="grid grid-cols-2 gap-0.5">
                {allCategories.map((c) => (
                  <Link
                    key={c.slug}
                    to={`/shop?cat=${c.slug}`}
                    onClick={() => setOpen(false)}
                    className={`rounded-sm px-3 py-2 text-xs transition-colors ${
                      path === "/shop" && activeCat === c.slug
                        ? "bg-brand-primary text-white"
                        : "text-charcoal hover:bg-warm-beige hover:text-brand-primary"
                    }`}
                  >
                    {c.name}
                  </Link>
                ))}
              </div>
            </div>
            </div>
          </div>
         </>
      )}
    </header>
  );
}
