import { useEffect, useState } from "react";
import { Container, DemoBadge, ErrorPanel, LoadingPanel, MissingImage, Reveal, ProductCard } from "../components/ui";
import { formatKES } from "../utils/format";
import { navigate } from "../router";
import { useCatalog } from "../store/CatalogContext";
import {
  SHOWROOM_STATS, RUNWAY_SLIDES, EVENTS,
  STYLISTS, STYLING_SERVICES, WORKSHOPS, BTS_CLIPS, COMMUNITY_POSTS,
  BLOG_POSTS, SECTIONS, YT_HOME,
} from "../data/showroom";

const COLLECTION_PRODUCT_LIMIT = 8;
const DESIGNER_PRODUCT_LIMIT = 6;

function Heading({ kicker, title, sub }: { kicker?: string; title: string; sub?: string }) {
  return (
    <div className="mb-8 text-center">
      {kicker && <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-brand-secondary">{kicker}</p>}
      <h2 className="mt-2 font-display text-3xl uppercase tracking-wider text-brand-primary sm:text-4xl">{title}</h2>
      {sub && <p className="mt-2 text-sm italic text-gray-400">{sub}</p>}
    </div>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }).toUpperCase();
}

export default function Showroom() {
  const catalog = useCatalog();
  const [chosenCollection, setCollection] = useState<string | null>(null);
  const [activeRunway, setActiveRunway] = useState(0);
  const [chosenDesigner, setActiveDesigner] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2500); };

  // Auto-advance runway slideshow
  useEffect(() => {
    const t = setInterval(() => setActiveRunway((i) => (i + 1) % RUNWAY_SLIDES.length), 3500);
    return () => clearInterval(t);
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Scroll to a section on load (e.g. /showroom?go=events)
  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, "");
    const qs = raw.split("?")[1] ?? "";
    const go = new URLSearchParams(qs).get("go");
    if (go) setTimeout(() => scrollTo(go), 300);
  }, []);

  /* Collections and designers come only from the canonical catalog. */
  const collections = [...new Set(catalog.products.flatMap((product) => product.collection ?? []))];
  const collection = chosenCollection !== null && collections.includes(chosenCollection) ? chosenCollection : collections[0];
  const collectionProducts = catalog.products.filter((product) => product.collection === collection).slice(0, COLLECTION_PRODUCT_LIMIT);
  const designers = catalog.designers;
  const activeDesignerObj = designers.find((designer) => designer.id === chosenDesigner) ?? designers[0];
  const dProducts = activeDesignerObj ? catalog.products.filter((product) => product.designerId === activeDesignerObj.id) : [];
  const sections = SECTIONS.filter((section) =>
    (section.id !== "collections" || collections.length > 0) && (section.id !== "designers" || designers.length > 0));

  return (
    <div>
      {/* ===== HERO ===== */}
      <div className="relative h-[600px] overflow-hidden bg-brand-primary">
        {RUNWAY_SLIDES.map((sl, i) => (
          <img
            key={sl.id}
            src={sl.img}
            alt="Runway"
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1500 ease-in-out ${i === activeRunway ? "opacity-50" : "opacity-0"}`}
          />
        ))}
        <div className="absolute inset-0 bg-linear-to-t from-brand-primary via-brand-primary/40 to-brand-primary/70" />
        <Container className="relative flex h-full flex-col items-center justify-center text-center text-white">
          <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-brand-secondary">IKO KITU! — Where Fashion Comes Alive</p>
          <h1 className="mt-4 font-display text-4xl uppercase leading-tight tracking-wider sm:text-6xl">No Maneno Bazaar<br />Fashion Showroom</h1>
          <p className="mt-4 max-w-lg text-sm text-white/80">Where style meets substance. Curated collections, live runway shows, and Mombasa's premier fashion destination.</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a href={YT_HOME} target="_blank" rel="noreferrer" className="rounded-sm bg-brand-secondary px-8 py-3.5 text-xs font-bold uppercase tracking-[0.15em] text-brand-primary transition-all hover:bg-white">▶ Watch the Show</a>
            <button onClick={() => scrollTo("events")} className="rounded-sm border border-white/40 px-8 py-3.5 text-xs font-bold uppercase tracking-[0.15em] transition-all hover:bg-white hover:text-brand-primary">📅 Upcoming Events</button>
          </div>
          <div className="mt-12 grid grid-cols-2 gap-6 sm:grid-cols-4 sm:gap-12">
            {SHOWROOM_STATS.map((s) => (
              <div key={s.label}>
                <p className="font-display text-3xl text-brand-secondary sm:text-4xl">{s.value}</p>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.15em] text-white/70">{s.label}</p>
              </div>
            ))}
          </div>
        </Container>
      </div>

      {/* ===== SECTION NAV (full width, functional) ===== */}
      <div className="sticky top-[68px] z-30 border-b border-light-gray bg-white/95 backdrop-blur-md lg:top-[84px]">
        <Container>
          <div className="no-scrollbar flex items-center justify-between gap-1 overflow-x-auto py-2">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className="flex-1 whitespace-nowrap px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-widest text-charcoal/70 transition-colors hover:text-brand-secondary"
              >
                {s.label}
              </button>
            ))}
          </div>
        </Container>
      </div>

      {/* ===== COLLECTIONS ===== */}
      {catalog.status !== "ready" ? (
        <section id="collections" className="scroll-mt-44 py-16">
          <Container>
            {catalog.status === "loading"
              ? <LoadingPanel label="Loading collections…" />
              : <ErrorPanel title="Collections are unavailable" message={catalog.error ?? "The catalog could not be loaded."} onRetry={catalog.reload} />}
          </Container>
        </section>
      ) : collections.length > 0 && (
        <section id="collections" className="scroll-mt-44 py-16">
          <Container>
            <Heading kicker="Discover the Latest Looks" title="Current Collections" />
            <div className="mb-8 flex flex-wrap justify-center gap-2">
              {collections.map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={collection === name}
                  onClick={() => setCollection(name)}
                  className={`rounded-sm border px-4 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                    collection === name ? "border-brand-primary bg-brand-primary text-white" : "border-light-gray text-charcoal hover:border-brand-accent"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
            {/* One scrollable row on small/medium, grid on large */}
            <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-4 lg:gap-4 lg:overflow-visible lg:px-0">
              {collectionProducts.map((p) => (
                <div key={p.id} className="w-[200px] shrink-0 sm:w-60 lg:w-auto">
                  <ProductCard product={p} />
                </div>
              ))}
            </div>
          </Container>
        </section>
      )}

      {/* ===== VIRTUAL RUNWAY (text left, slideshow right) ===== */}
      <section id="runway" className="scroll-mt-44 bg-brand-primary py-16 text-white">
        <Container>
          <div className="grid items-center gap-10 lg:grid-cols-2">
            {/* Left — explanatory text */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-brand-secondary">Front Row Seat, Anytime, Anywhere</p>
              <h2 className="mt-2 font-display text-3xl uppercase tracking-wider sm:text-4xl">Virtual Runway Experience</h2>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-white/75">
                Couldn't make it to the show? Take a front-row seat. This is a live slideshow of looks
                straight off the No Maneno Bazaar catwalk — real models showcasing pieces from our resident
                and guest designers, season after season.
              </p>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-white/75">
                Use the arrows or thumbnails to browse each runway look, then head to the shop to make it yours.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <a href={YT_HOME} target="_blank" rel="noreferrer" className="rounded-sm bg-brand-secondary px-6 py-3 text-[11px] font-bold uppercase tracking-wider text-brand-primary hover:bg-white">▶ Watch Full Show</a>
                <button onClick={() => scrollTo("collections")} className="rounded-sm border border-white/40 px-6 py-3 text-[11px] font-bold uppercase tracking-wider hover:bg-white hover:text-brand-primary">Shop Collections</button>
              </div>
            </div>

            {/* Right — slideshow */}
            <div>
              <div className="relative overflow-hidden rounded-lg">
                <div className="relative aspect-3/4 w-full sm:aspect-4/5">
                  {RUNWAY_SLIDES.map((sl, i) => (
                    <img
                      key={sl.id}
                      src={sl.img}
                      alt={sl.label}
                      className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1200 ease-in-out ${i === activeRunway ? "opacity-100" : "opacity-0"}`}
                    />
                  ))}
                </div>
                <div className="absolute inset-0 flex items-center justify-between px-4">
                  <button onClick={() => setActiveRunway((i) => (i - 1 + RUNWAY_SLIDES.length) % RUNWAY_SLIDES.length)} className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur hover:bg-black/60">‹</button>
                  <button onClick={() => setActiveRunway((i) => (i + 1) % RUNWAY_SLIDES.length)} className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur hover:bg-black/60">›</button>
                </div>
                <div className="absolute bottom-0 left-0 right-0 bg-linear-to-t from-black/80 to-transparent p-4">
                  <p className="font-display text-lg">{RUNWAY_SLIDES[activeRunway].label}</p>
                  <p className="text-xs text-white/70">Look {activeRunway + 1} of {RUNWAY_SLIDES.length} · Summer 2026 Runway</p>
                </div>
              </div>
              <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
                {RUNWAY_SLIDES.map((s, i) => (
                  <button key={s.id} onClick={() => setActiveRunway(i)} className={`relative aspect-3/4 w-14 shrink-0 overflow-hidden rounded-sm border-2 transition-all ${i === activeRunway ? "border-brand-secondary" : "border-transparent opacity-60"}`}>
                    <img src={s.img} alt={s.label} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* ===== EVENTS ===== */}
      <section id="events" className="scroll-mt-44 py-16">
        <Container>
          <Heading kicker="Be Part of the Fashion Moment" title="Fashion Events & Tickets" />
          <div className="mx-auto max-w-3xl space-y-5">
            {EVENTS.map((ev, i) => (
              <Reveal key={ev.id} delay={i * 80}>
                <div className="overflow-hidden rounded-lg bg-white shadow-sm">
                  <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
                    <div className="flex w-20 shrink-0 flex-col items-center justify-center rounded-md bg-brand-primary py-3 text-white">
                      <span className="font-display text-2xl leading-none">{new Date(ev.date).getDate()}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider">{new Date(ev.date).toLocaleDateString("en-GB", { month: "short" })}</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-brand-secondary">{fmtDate(ev.date)} · {ev.time}</p>
                      <h3 className="mt-0.5 font-display text-lg text-brand-primary">{ev.title}</h3>
                      <p className="text-xs text-gray-400">📍 {ev.location}</p>
                      <p className="mt-1 text-xs text-charcoal">{ev.details}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {ev.features.map((f) => <span key={f} className="rounded-full bg-warm-beige px-2.5 py-0.5 text-[10px] font-medium text-charcoal">{f}</span>)}
                        {ev.dressCode && <span className="rounded-full bg-brand-secondary/20 px-2.5 py-0.5 text-[10px] font-medium text-brand-accent">Dress: {ev.dressCode}</span>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="mb-2 space-y-0.5">
                        {ev.tickets.map((t) => (
                          <p key={t.type} className="text-xs"><span className="text-gray-400">{t.type}: </span><span className="font-bold text-brand-primary">{t.price === null ? "Invite Only" : formatKES(t.price)}</span></p>
                        ))}
                      </div>
                      <button onClick={() => showToast(`✓ ${ev.cta === "Request Invitation" ? "Invitation requested" : "Tickets reserved"} for "${ev.title}"`)} className="rounded-sm bg-brand-primary px-5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white transition-colors hover:bg-brand-secondary hover:text-brand-primary">{ev.cta}</button>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* ===== DESIGNERS ===== */}
      {catalog.status === "ready" && activeDesignerObj && (
        <section id="designers" className="scroll-mt-44 bg-warm-beige/40 py-16">
          <Container>
            <Heading kicker="Where Designers Meet the Store" title="Designer Collaborations" />
            {/* Fixed-size cards (2-up on mobile, 4-up on large); extra designers scroll horizontally. */}
            <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
              {designers.map((d, i) => (
                <Reveal
                  key={d.id}
                  delay={i * 80}
                  className="w-[calc(50%-0.5rem)] shrink-0 lg:w-[calc(25%-0.75rem)]"
                >
                  <button
                    type="button"
                    aria-pressed={activeDesignerObj.id === d.id}
                    onClick={() => setActiveDesigner(d.id)}
                    className={`group block w-full overflow-hidden rounded-lg bg-white text-left shadow-sm transition-all ${activeDesignerObj.id === d.id ? "ring-2 ring-brand-secondary" : ""}`}
                  >
                    <div className="relative aspect-square overflow-hidden">
                      {d.image
                        ? <img src={d.image} alt="" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" />
                        : <MissingImage label="No designer photo" />}
                      {d.isDemo && <DemoBadge className="absolute left-2 top-2" />}
                    </div>
                    <div className="p-4 text-center">
                      <h3 className="font-display text-base text-brand-primary">{d.name}</h3>
                      <p className="text-[11px] text-brand-accent">{d.specialty}</p>
                      {d.location && <p className="mt-0.5 text-[10px] text-gray-500">{d.location}</p>}
                    </div>
                  </button>
                </Reveal>
              ))}
            </div>

            {(activeDesignerObj.spotlightTitle || activeDesignerObj.spotlightText) && (
              <div className="mt-8 rounded-lg bg-brand-primary p-8 text-center text-white">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary">Designer Spotlight</p>
                {activeDesignerObj.spotlightTitle && <h3 className="mt-2 font-display text-xl">{activeDesignerObj.spotlightTitle}</h3>}
                {activeDesignerObj.spotlightText && <p className="mx-auto mt-2 max-w-2xl text-sm text-white/80">{activeDesignerObj.spotlightText}</p>}
              </div>
            )}

            <div className="mb-4 mt-8 flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-accent">{activeDesignerObj.name} — Collection ({dProducts.length} {dProducts.length === 1 ? "piece" : "pieces"})</p>
              {dProducts.length > 0 && (
                <button type="button" onClick={() => navigate(`/shop?designer=${encodeURIComponent(activeDesignerObj.slug)}`)} className="text-[11px] font-bold uppercase tracking-wider text-brand-primary underline-offset-4 hover:text-brand-secondary hover:underline">View All →</button>
              )}
            </div>
            {dProducts.length ? (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                {dProducts.slice(0, DESIGNER_PRODUCT_LIMIT).map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            ) : (
              <p className="rounded-lg bg-white p-6 text-center text-sm text-gray-500 shadow-sm">No pieces are listed for this designer yet.</p>
            )}
          </Container>
        </section>
      )}

      {/* ===== STYLISTS ===== */}
      <section id="stylists" className="scroll-mt-44 bg-warm-beige/40 py-16">
        <Container>
          <Heading kicker="Your Personal Style Partner" title="Stylist Consultations" />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {STYLISTS.map((s, i) => (
              <Reveal key={s.id} delay={i * 70}>
                <div className="overflow-hidden rounded-lg bg-white text-center shadow-sm">
                  <div className="aspect-square overflow-hidden"><img src={s.image} alt={s.name} className="h-full w-full object-cover" /></div>
                  <div className="p-4">
                    <h3 className="font-display text-base text-brand-primary">{s.name}</h3>
                    <p className="text-[11px] text-gray-400">{s.experience}</p>
                    <p className="text-[11px] text-brand-accent">{s.specialty}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STYLING_SERVICES.map((sv) => (
              <div key={sv.name} className="rounded-lg bg-white p-5 text-center shadow-sm">
                <h4 className="font-display text-sm text-brand-primary">{sv.name}</h4>
                <p className="mt-2 font-display text-xl text-brand-secondary">{formatKES(sv.price)}</p>
                <p className="text-[10px] uppercase tracking-wider text-gray-400">{sv.unit}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center">
            <button onClick={() => showToast("✓ Consultation request sent! Our team will call you shortly.")} className="rounded-sm bg-brand-primary px-8 py-3 text-xs font-bold uppercase tracking-[0.15em] text-white hover:bg-brand-secondary hover:text-brand-primary">Book a Consultation</button>
          </div>
        </Container>
      </section>

      {/* ===== WORKSHOPS ===== */}
      <section id="workshops" className="scroll-mt-44 py-16">
        <Container>
          <Heading kicker="Learn from the Best" title="Workshops & Masterclasses" sub="From Runway to Real Life" />
          <div className="mx-auto max-w-3xl space-y-4">
            {WORKSHOPS.map((w, i) => (
              <Reveal key={w.id} delay={i * 70}>
                <div className="flex flex-col items-start justify-between gap-3 rounded-lg bg-white p-5 shadow-sm sm:flex-row sm:items-center">
                  <div>
                    <h3 className="font-display text-base text-brand-primary">{w.title}</h3>
                    <p className="mt-0.5 text-xs text-gray-400">📅 {fmtDate(w.date)} · 🕐 {w.time} · 👩‍🏫 {w.instructor}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-display text-lg text-brand-secondary">{formatKES(w.price)}</span>
                    <button onClick={() => showToast(`✓ Booked "${w.title}"`)} className="rounded-sm bg-brand-primary px-5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary">Book Now</button>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* ===== BEHIND THE SCENES (YouTube) ===== */}
      <section className="scroll-mt-44 bg-brand-primary py-16 text-white">
        <Container>
          <div className="mb-8 text-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-brand-secondary">The Magic of Fashion</p>
            <h2 className="mt-2 font-display text-3xl uppercase tracking-wider sm:text-4xl">Behind the Scenes</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {BTS_CLIPS.map((c, i) => (
              <Reveal key={i} delay={(i % 4) * 70}>
                <a href={c.youtube} target="_blank" rel="noreferrer" className="group relative block aspect-square overflow-hidden rounded-lg">
                  <img src={c.image} alt={c.title} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 transition-colors group-hover:bg-black/20">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-brand-primary">▶</span>
                  </div>
                  <p className="absolute bottom-2 left-2 right-2 text-center text-[11px] font-bold uppercase tracking-wider">{c.title}</p>
                </a>
              </Reveal>
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-white/70">📸 Follow us: <span className="font-bold text-brand-secondary">@NoManenoBazaarFashion</span> · #IKOKITU #MombasaFashion</p>
        </Container>
      </section>

      {/* ===== COMMUNITY ===== */}
      <section id="community" className="scroll-mt-44 py-16">
        <Container>
          <Heading kicker="Connect, Share, Inspire" title="Fashion Community" />
          <div className="grid gap-6 md:grid-cols-3">
            {COMMUNITY_POSTS.map((post, i) => (
              <Reveal key={post.id} delay={i * 80}>
                <div className="overflow-hidden rounded-lg bg-white shadow-sm">
                  <div className="aspect-square overflow-hidden"><img src={post.image} alt="Community post" className="h-full w-full object-cover" /></div>
                  <div className="p-4">
                    <div className="flex items-center gap-2">
                      <img src={post.avatar} alt={post.user} className="h-8 w-8 rounded-full object-cover" />
                      <span className="text-sm font-semibold text-brand-primary">{post.user}</span>
                    </div>
                    <p className="mt-2 text-sm text-charcoal">{post.content}</p>
                    <div className="mt-3 flex gap-4 text-xs text-gray-400"><span>❤️ {post.likes} likes</span><span>💬 {post.comments} comments</span></div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
          <div className="mt-8 text-center">
            <button onClick={() => showToast("✓ Welcome to the No Maneno Fashion Community!")} className="rounded-sm bg-brand-primary px-8 py-3 text-xs font-bold uppercase tracking-[0.15em] text-white hover:bg-brand-secondary hover:text-brand-primary">Share Your Style</button>
          </div>
        </Container>
      </section>

      {/* ===== JOURNAL ===== */}
      <section id="journal" className="scroll-mt-44 bg-warm-beige/40 py-16">
        <Container>
          <Heading kicker="The Latest in Style" title="Fashion Journal" />
          <div className="grid gap-6 md:grid-cols-3">
            {BLOG_POSTS.map((b, i) => (
              <Reveal key={b.id} delay={i * 80}>
                <div className="group h-full overflow-hidden rounded-lg bg-white shadow-sm">
                  <div className="aspect-16/10 overflow-hidden"><img src={b.image} alt={b.title} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" /></div>
                  <div className="p-5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-brand-accent">{b.date} · {b.readTime} read</p>
                    <h3 className="mt-2 font-display text-base leading-snug text-brand-primary">{b.title}</h3>
                    <p className="mt-2 text-xs text-gray-500">{b.excerpt}</p>
                    <button onClick={() => showToast("📖 Article opening soon — stay tuned!")} className="mt-3 text-[11px] font-bold uppercase tracking-wider text-brand-primary underline-offset-4 hover:text-brand-secondary hover:underline">Read More →</button>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* ===== CTA ===== */}
      <section className="bg-brand-primary py-16 text-center text-white">
        <Container>
          <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-brand-secondary">IKO KITU!</p>
          <h2 className="mt-3 font-display text-3xl uppercase tracking-wider sm:text-4xl">Where Fashion Comes Alive</h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-white/70">Shop the collections, attend a show, or book a stylist — your style journey starts here.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <button onClick={() => navigate("/shop")} className="rounded-sm bg-brand-secondary px-8 py-3.5 text-xs font-bold uppercase tracking-[0.15em] text-brand-primary hover:bg-white">Shop All Fashion</button>
            <button onClick={() => scrollTo("events")} className="rounded-sm border border-white/40 px-8 py-3.5 text-xs font-bold uppercase tracking-[0.15em] hover:bg-white hover:text-brand-primary">View Events</button>
          </div>
        </Container>
      </section>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-110 -translate-x-1/2 animate-fade-in">
          <div className="rounded-sm bg-brand-primary px-5 py-3 text-xs font-bold uppercase tracking-wider text-white shadow-xl">{toast}</div>
        </div>
      )}
    </div>
  );
}
