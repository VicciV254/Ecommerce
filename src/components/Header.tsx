import { useEffect, useState } from "react";
import { Link, navigate, useRoute, parseRoute } from "../router";
import { useStore } from "../store/StoreContext";
import { CATEGORIES } from "../data/products";
import { Container } from "./ui";

export function Header() {
  const { cartCount, state } = useStore();
  const route = useRoute();
  const { parts } = parseRoute(route);
  const currentPath = parts[0] ?? "";
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`/shop?q=${encodeURIComponent(search)}`);
    setOpen(false);
  };

  const navLinks = [
    { to: "/shop", label: "Shop" },
    { to: "/about", label: "About" },
    { to: "/contact", label: "Contact" },
    { to: "/track", label: "Track Order" },
  ];

  const isActive = (to: string) => {
    if (to === "/track" && currentPath === "track") return true;
    const linkPath = to.replace("/", "");
    return linkPath === currentPath;
  };

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-white/[.97] shadow-[0_2px_16px_rgba(0,0,0,0.07)] backdrop-blur-md"
          : "bg-white"
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

        {/* Search (desktop) — black button like screenshot */}
        <form onSubmit={submitSearch} className="hidden flex-1 max-w-lg md:flex">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products..."
            className="w-full rounded-l-none border border-r-0 border-light-gray bg-off-white px-4 py-2.5 text-sm outline-none transition-colors focus:border-charcoal"
          />
          <button
            type="submit"
            className="rounded-r-none bg-brand-primary px-5 text-white transition-colors hover:bg-charcoal"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z" />
            </svg>
          </button>
        </form>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-7 lg:flex">
          {navLinks.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={`group relative font-body text-[13px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                isActive(l.to)
                  ? "text-brand-secondary"
                  : "text-brand-primary hover:text-brand-secondary"
              }`}
            >
              {l.label}
              <span className={`absolute -bottom-0.5 left-0 h-px bg-brand-secondary transition-all duration-300 ${
                isActive(l.to) ? "w-full" : "w-0 group-hover:w-full"
              }`} />
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1">
          <Link
            to="/wishlist"
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
            to="/cart"
            className="relative flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-warm-beige"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0z" />
            </svg>
            {cartCount > 0 && (
              <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-secondary px-1 text-[9px] font-bold text-white">
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

      {/* Category strip — no border lines, just subtle hover */}
      <div className="hidden lg:block">
        <Container className="no-scrollbar flex items-center gap-0.5 overflow-x-auto py-0">
          {CATEGORIES.map((c) => (
            <Link
              key={c.slug}
              to={`/shop?cat=${c.slug}`}
              className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-charcoal/80 transition-colors hover:bg-warm-beige hover:text-brand-primary"
            >
              {c.name}
            </Link>
          ))}
        </Container>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 bg-white shadow-lg lg:hidden">
          <Container className="flex flex-col gap-0.5 py-4">
            <form onSubmit={submitSearch} className="mb-3 flex">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products…"
                className="w-full border border-r-0 border-light-gray bg-off-white px-4 py-2.5 text-sm outline-none"
              />
              <button type="submit" className="bg-brand-primary px-4 text-white">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z" />
                </svg>
              </button>
            </form>
            {navLinks.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className={`rounded-sm px-3 py-2.5 text-sm font-semibold uppercase tracking-wider transition-colors ${
                  isActive(l.to)
                    ? "bg-brand-secondary text-white"
                    : "text-brand-primary hover:bg-warm-beige"
                }`}
              >
                {l.label}
              </Link>
            ))}
            <div className="mt-3 border-t border-light-gray pt-3">
              <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-brand-accent">Categories</p>
              <div className="grid grid-cols-2 gap-0.5">
                {CATEGORIES.map((c) => (
                  <Link
                    key={c.slug}
                    to={`/shop?cat=${c.slug}`}
                    onClick={() => setOpen(false)}
                    className="rounded-sm px-3 py-2 text-xs text-charcoal hover:bg-warm-beige hover:text-brand-primary"
                  >
                    {c.name}
                  </Link>
                ))}
              </div>
            </div>
          </Container>
        </div>
      )}
    </header>
  );
}
