import { useEffect, useRef, useState } from "react";
import { Link } from "../router";
import { CATEGORIES, HERO_IMAGES, PRODUCTS } from "../data/products";
import { Container, ProductCard, Reveal, SectionTitle } from "../components/ui";
import { useStore } from "../store/StoreContext";

const SLIDES = [
  {
    badge: "New Arrivals",
    title: "Fresh Styles Just Arrived",
    sub: "Discover something new across every floor — fashion, home, electronics & more.",
    cta: "/shop",
    ctaLabel: "Shop Now",
    image: "https://my-image-host.victor-f6f.workers.dev/api/img/1782861912145-hero-banner.jpg",
  },
  {
    badge: "Fashion Showroom",
    title: "Where Fashion Comes Alive",
    sub: "Runway shows, curated collections, designer collaborations & stylist consultations — IKO KITU!",
    cta: "/showroom",
    ctaLabel: "Enter the Showroom",
    image: "https://images.pexels.com/photos/20164322/pexels-photo-20164322.jpeg?auto=compress&cs=tinysrgb&w=1200",
  },
  {
    badge: "Back to School",
    title: "Uniforms, Bags & Stationery",
    sub: "Get ready for the new term with up to 20% off school essentials.",
    cta: "/shop?cat=school-office",
    ctaLabel: "Shop Now",
    image: HERO_IMAGES[1],
  },
  {
    badge: "Baby & Nursery Specials",
    title: "Everything for Your Little One",
    sub: "Cots, strollers, toys and more — quality you can trust.",
    cta: "/shop?cat=baby-nursery",
    ctaLabel: "Shop Now",
    image: HERO_IMAGES[2],
  },
];

function HeroCarousel() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % SLIDES.length), 5000);
    return () => clearInterval(t);
  }, []);
  const s = SLIDES[idx];
  return (
    <div className="relative h-[480px] overflow-hidden bg-brand-primary sm:h-[560px] lg:h-[600px]">
      {SLIDES.map((slide, i) => (
        <div
          key={i}
          className={`absolute inset-0 transition-opacity duration-1000 ${
            i === idx ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <img
            src={slide.image}
            alt={slide.title}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-transparent" />
        </div>
      ))}
      <Container className="relative flex h-full items-center">
        <div className="max-w-lg">
          <span className="mb-4 inline-block rounded-sm bg-brand-secondary px-3 py-1 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">
            {s.badge}
          </span>
          <h1 className="font-display text-4xl uppercase leading-[1.1] tracking-wider text-white sm:text-5xl lg:text-[3.5rem]">
            {s.title}
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/80">{s.sub}</p>
          <Link
            to={s.cta}
            className="mt-8 inline-block rounded-sm bg-brand-secondary px-8 py-3.5 font-body text-xs font-bold uppercase tracking-[0.15em] text-brand-primary transition-all duration-200 hover:bg-white"
          >
            {s.ctaLabel}
          </Link>
        </div>
      </Container>
      <div className="absolute bottom-8 left-0 right-0 flex justify-center gap-2.5">
        {SLIDES.map((_, i) => (
          <button
            key={i}
            onClick={() => setIdx(i)}
            className={`h-1 rounded-full transition-all duration-300 ${
              i === idx ? "w-10 bg-brand-secondary" : "w-4 bg-white/50 hover:bg-white/80"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function HScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => {
    ref.current?.scrollBy({ left: dir * 300, behavior: "smooth" });
  };
  return (
    <div className="relative group/scroll">
      <div ref={ref} className="no-scrollbar flex gap-5 overflow-x-auto pb-2">
        {children}
      </div>
      <button
        onClick={() => scroll(-1)}
        className="absolute -left-4 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-lg transition-all hover:bg-brand-secondary md:flex opacity-0 group-hover/scroll:opacity-100"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
      </button>
      <button
        onClick={() => scroll(1)}
        className="absolute -right-4 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-lg transition-all hover:bg-brand-secondary md:flex opacity-0 group-hover/scroll:opacity-100"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
      </button>
    </div>
  );
}

export function Home() {
  const { productWithStock } = useStore();
  const bestSellers = PRODUCTS.filter((p) => p.bestSeller).slice(0, 10);
  const babySpot = PRODUCTS.filter((p) => p.categorySlug === "baby-nursery").slice(0, 4);
  const kitchenSpot = PRODUCTS.filter((p) => p.categorySlug === "home-kitchen").slice(0, 4);

  const reviews = [
    { text: "Best shopping experience in Mombasa! Wide variety, helpful staff, great prices.", name: "Jane M.", loc: "Mombasa", avatar: "https://images.pexels.com/photos/20453359/pexels-photo-20453359.jpeg?auto=compress&cs=tinysrgb&w=80&h=80&fit=crop" },
    { text: "Found everything I needed for my new home. No Maneno Bazaar is truly the best!", name: "David O.", loc: "Nairobi", avatar: "https://images.pexels.com/photos/27897903/pexels-photo-27897903.jpeg?auto=compress&cs=tinysrgb&w=80&h=80&fit=crop" },
    { text: "Quality baby products at fair prices. My go-to store for the little one. Highly recommend!", name: "Aisha K.", loc: "Mombasa", avatar: "https://images.pexels.com/photos/36990983/pexels-photo-36990983.jpeg?auto=compress&cs=tinysrgb&w=80&h=80&fit=crop" },
  ];

  return (
    <div>
      <HeroCarousel />

      {/* Trust strip */}
      <div className="border-b border-light-gray bg-light-pink">
        <Container className="grid grid-cols-2 gap-4 py-5 text-center md:grid-cols-4">
          {[
            ["Nationwide Delivery", "Fast, reliable shipping across Kenya"],
            ["M-Pesa & Card", "Secure payment options you trust"],
            ["30-Day Returns", "Hassle-free return policy"],
            ["4 Floors of Goods", "Everything under one roof"],
          ].map(([title, sub]) => (
            <div key={title} className="px-2">
              <p className="text-xs font-bold uppercase tracking-wider text-brand-primary">{title}</p>
              <p className="mt-0.5 text-[11px] text-gray-400">{sub}</p>
            </div>
          ))}
        </Container>
      </div>

      {/* Categories */}
      <Container className="py-16">
        <SectionTitle subtitle="Browse our curated departments">Shop by Category</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {CATEGORIES.map((c, i) => (
            <Reveal key={c.slug} delay={i * 50}>
              <Link
                to={`/shop?cat=${c.slug}`}
                className="group relative block aspect-[4/5] overflow-hidden rounded-lg"
              >
                <img
                  src={c.image}
                  alt={c.name}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent transition-all group-hover:from-black/80" />
                <div className="absolute inset-x-0 bottom-0 p-4">
                  <h3 className="font-display text-sm uppercase tracking-wider text-white sm:text-base">
                    {c.name}
                  </h3>
                  <span className="mt-1 inline-block text-[10px] font-semibold uppercase tracking-[0.15em] text-brand-secondary opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                    Shop Now →
                  </span>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </Container>

      {/* Best sellers */}
      <div className="bg-warm-beige/40 py-16">
        <Container>
          <SectionTitle
            subtitle="Our most loved products"
            action={
              <Link to="/shop" className="text-xs font-bold uppercase tracking-[0.12em] text-brand-primary underline-offset-4 hover:text-brand-secondary hover:underline">
                View All →
              </Link>
            }
          >
            Best Sellers
          </SectionTitle>
          <HScroll>
            {bestSellers.map((p) => (
              <div key={p.id} className="w-[240px] shrink-0 sm:w-[260px]">
                <ProductCard product={productWithStock(p)} />
              </div>
            ))}
          </HScroll>
        </Container>
      </div>

      {/* Baby spotlight */}
      <Container className="py-16">
        <SectionTitle
          subtitle="Everything your little one needs"
          action={
            <Link to="/shop?cat=baby-nursery" className="text-xs font-bold uppercase tracking-[0.12em] text-brand-primary underline-offset-4 hover:text-brand-secondary hover:underline">
              View All →
            </Link>
          }
        >
          Baby & Nursery
        </SectionTitle>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {babySpot.map((p, i) => (
            <Reveal key={p.id} delay={i * 80}>
              <ProductCard product={productWithStock(p)} />
            </Reveal>
          ))}
        </div>
      </Container>

      {/* Full-width banner */}
      <div className="relative h-72 overflow-hidden sm:h-80">
        <img
          src="https://images.pexels.com/photos/20177680/pexels-photo-20177680.jpeg?auto=compress&cs=tinysrgb&w=1200"
          alt="No Maneno Bazaar Mombasa"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-brand-primary/70" />
        <Container className="relative flex h-full flex-col items-center justify-center text-center text-white">
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-secondary">IKO KITU!</span>
          <h2 className="mt-2 font-display text-3xl uppercase tracking-wider sm:text-4xl">Visit Our Store</h2>
          <p className="mt-2 max-w-md text-sm text-white/80">Digo Road, Mombasa CBD — 4 floors of quality products for the whole family.</p>
          <Link
            to="/about"
            className="mt-6 rounded-sm border border-white/40 px-6 py-2.5 text-xs font-bold uppercase tracking-[0.15em] transition-all hover:bg-white hover:text-brand-primary"
          >
            Learn More
          </Link>
        </Container>
      </div>

      {/* Kitchen collection */}
      <Container className="py-16">
        <SectionTitle
          subtitle="Quality essentials for your home"
          action={
            <Link to="/shop?cat=home-kitchen" className="text-xs font-bold uppercase tracking-[0.12em] text-brand-primary underline-offset-4 hover:text-brand-secondary hover:underline">
              View All →
            </Link>
          }
        >
          Home & Kitchen
        </SectionTitle>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kitchenSpot.map((p, i) => (
            <Reveal key={p.id} delay={i * 80}>
              <ProductCard product={productWithStock(p)} />
            </Reveal>
          ))}
        </div>
      </Container>

      {/* Showroom glimpse */}
      <div className="relative overflow-hidden">
        <div className="grid lg:grid-cols-2">
          <div className="relative min-h-[320px] overflow-hidden">
            <img
              src="https://images.pexels.com/photos/20164322/pexels-photo-20164322.jpeg?auto=compress&cs=tinysrgb&w=1000"
              alt="Fashion Showroom"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-brand-primary/20" />
          </div>
          <div className="flex flex-col justify-center bg-brand-primary px-8 py-14 text-white sm:px-14">
            <Reveal>
              <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-brand-secondary">IKO KITU! — Fashion Showroom</p>
              <h2 className="mt-3 font-display text-3xl uppercase leading-tight tracking-wider sm:text-4xl">Where Fashion Comes Alive</h2>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-white/75">
                Step into Mombasa's premier fashion destination — curated seasonal collections, live runway
                shows, designer collaborations, a shoppable lookbook, and personal stylist consultations.
              </p>
              <div className="mt-6 grid max-w-md grid-cols-3 gap-4 text-center">
                {[["12+", "Brands"], ["8", "Events / yr"], ["500+", "Attendees"]].map(([v, l]) => (
                  <div key={l}>
                    <p className="font-display text-2xl text-brand-secondary">{v}</p>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-white/60">{l}</p>
                  </div>
                ))}
              </div>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link to="/showroom" className="rounded-sm bg-brand-secondary px-7 py-3 text-xs font-bold uppercase tracking-[0.15em] text-brand-primary hover:bg-white">Explore the Showroom</Link>
                <Link to="/showroom?go=events" className="rounded-sm border border-white/40 px-7 py-3 text-xs font-bold uppercase tracking-[0.15em] hover:bg-white hover:text-brand-primary">View Events</Link>
              </div>
            </Reveal>
          </div>
        </div>
      </div>

      {/* Reviews */}
      <div className="bg-warm-beige/40 py-16">
        <Container>
          <SectionTitle subtitle="Real reviews from our customers">What Our Customers Say</SectionTitle>
          <div className="grid gap-6 md:grid-cols-3">
            {reviews.map((r, i) => (
              <Reveal key={i} delay={i * 100}>
                <div className="flex h-full flex-col rounded-lg bg-light-pink p-6 shadow-sm">
                  <div className="flex items-center gap-1 text-brand-secondary">
                    {[0,1,2,3,4].map(s => <span key={s} className="text-sm">★</span>)}
                  </div>
                  <p className="mt-4 flex-1 text-sm italic leading-relaxed text-charcoal">"{r.text}"</p>
                  <div className="mt-5 flex items-center gap-3 border-t border-light-gray pt-4">
                    <img src={r.avatar} alt={r.name} className="h-9 w-9 rounded-full object-cover" />
                    <div>
                      <p className="text-sm font-semibold text-brand-primary">{r.name}</p>
                      <p className="text-[11px] text-gray-400">{r.loc}</p>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </div>
    </div>
  );
}
