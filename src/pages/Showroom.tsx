import { useEffect, useState } from "react";
import { Breadcrumb, Container, Reveal, SectionTitle } from "../components/ui";
import { Link } from "../router";

const SLIDES = [
  {
    badge: "Runway Roundup",
    title: "The Best Moments from Our Fashion Events",
    sub: "A curated showcase of bold looks, fresh silhouettes and standout street style from recent shows.",
    image: "https://images.pexels.com/photos/298864/pexels-photo-298864.jpeg?auto=compress&cs=tinysrgb&w=1200",
  },
  {
    badge: "Street Style",
    title: "Urban Fashion Stories",
    sub: "Discover how trendsetters mixed classic pieces with contemporary energy at our latest events.",
    image: "https://images.pexels.com/photos/298863/pexels-photo-298863.jpeg?auto=compress&cs=tinysrgb&w=1200",
  },
  {
    badge: "Designer Spotlight",
    title: "Featured Looks from Local Creators",
    sub: "From tailored jackets to statement accessories, see the pieces that stole the show.",
    image: "https://images.pexels.com/photos/190819/pexels-photo-190819.jpeg?auto=compress&cs=tinysrgb&w=1200",
  },
  {
    badge: "Showroom Edit",
    title: "Highlights from Our Fashion Events",
    sub: "A visual tour of the latest collections, event moments, and product stories from the showroom floor.",
    image: "https://images.pexels.com/photos/1816603/pexels-photo-1816603.jpeg?auto=compress&cs=tinysrgb&w=1200",
  },
];

const STORIES = [
  {
    title: "Runway Reveal",
    event: "Mombasa Fashion Night",
    description: "A lineup of effortless suiting, vibrant prints and well-tailored essentials that drew the crowd.",
    image: "https://images.pexels.com/photos/1055691/pexels-photo-1055691.jpeg?auto=compress&cs=tinysrgb&w=1200",
  },
  {
    title: "Style Stories",
    event: "Streetwear Showcase",
    description: "Bold accessories, layered textures, and contemporary looks made for the city’s fashion-forward shoppers.",
    image: "https://images.pexels.com/photos/1703312/pexels-photo-1703312.jpeg?auto=compress&cs=tinysrgb&w=1200",
  },
  {
    title: "Design Dialogues",
    event: "Emerging Talent Expo",
    description: "Fresh narratives from new designers spotlighting craftsmanship, colour and modern silhouettes.",
    image: "https://images.pexels.com/photos/190819/pexels-photo-190819.jpeg?auto=compress&cs=tinysrgb&w=1200",
  },
];

export function Showroom() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActive((current) => (current + 1) % SLIDES.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div>
      <div className="relative h-[520px] overflow-hidden bg-brand-primary sm:h-[620px]">
        {SLIDES.map((slide, idx) => (
          <div
            key={slide.title}
            className={`absolute inset-0 transition-opacity duration-1000 ${idx === active ? "opacity-100" : "pointer-events-none opacity-0"}`}
          >
            <img
              src={slide.image}
              alt={slide.title}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />
          </div>
        ))}

        <Container className="relative flex h-full items-center">
          <div className="max-w-2xl">
            <span className="mb-4 inline-block rounded-sm bg-brand-secondary px-3 py-1 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">
              {SLIDES[active].badge}
            </span>
            <h1 className="font-display text-4xl uppercase leading-[1.05] tracking-wider text-white sm:text-5xl lg:text-[4rem]">
              {SLIDES[active].title}
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/80">
              {SLIDES[active].sub}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/shop"
                className="rounded-sm bg-brand-secondary px-8 py-3.5 text-xs font-bold uppercase tracking-[0.15em] text-brand-primary transition-all duration-200 hover:bg-white"
              >
                Shop the Look
              </Link>
              <Link
                to="/contact"
                className="rounded-sm border border-white/40 px-8 py-3.5 text-xs font-bold uppercase tracking-[0.15em] text-white transition-all duration-200 hover:bg-white hover:text-brand-primary"
              >
                Book a Visit
              </Link>
            </div>
          </div>
        </Container>

        <div className="absolute bottom-8 left-0 right-0 flex justify-center gap-3">
          {SLIDES.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setActive(idx)}
              className={`h-2.5 rounded-full transition-all duration-300 ${idx === active ? "w-12 bg-brand-secondary" : "w-4 bg-white/50 hover:bg-white/80"}`}
              aria-label={`Slide ${idx + 1}`}
            />
          ))}
        </div>
      </div>

      <Container className="py-16">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-secondary">SHOWROOM STORIES</p>
            <h2 className="mt-3 font-display text-3xl uppercase tracking-[0.08em] text-brand-primary sm:text-4xl">
              Different Fashion Stories
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-charcoal/80">
              Explore the themes, movements and standout looks from our most recent fashion events and showroom moments.
            </p>
          </div>
          <Link
            to="/showroom"
            className="self-start rounded-sm border border-brand-primary px-6 py-3 text-xs font-bold uppercase tracking-[0.12em] text-brand-primary transition-all hover:bg-brand-primary hover:text-white"
          >
            Refresh Stories
          </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {STORIES.map((story, idx) => (
            <Reveal key={story.title} delay={idx * 80}>
              <div className="overflow-hidden rounded-3xl bg-white shadow-lg">
                <div className="h-64 overflow-hidden">
                  <img
                    src={story.image}
                    alt={story.title}
                    className="h-full w-full object-cover transition-transform duration-700 hover:scale-105"
                  />
                </div>
                <div className="p-6">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-brand-accent">{story.event}</p>
                  <h3 className="mt-3 font-display text-xl uppercase tracking-[0.05em] text-brand-primary">
                    {story.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-charcoal/80">{story.description}</p>
                  <Link
                    to="/shop"
                    className="mt-5 inline-block text-xs font-semibold uppercase tracking-[0.15em] text-brand-secondary hover:text-brand-primary"
                  >
                    Shop Featured →
                  </Link>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </div>
  );
}
