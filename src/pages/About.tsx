import { Breadcrumb, Container, Reveal } from "../components/ui";
import { Link } from "../router";

const FLOORS = [
  ["Ground Floor", "Electronics, Home Appliances, Footwear"],
  ["First Floor", "Men's & Women's Fashion"],
  ["Second Floor", "Children's Wear & Baby Items"],
  ["Third Floor", "Home Decor, Kitchen, Office Supplies"],
];

export default function About() {
  return (
    <div>
      {/* Hero */}
      <div className="relative h-72 overflow-hidden sm:h-80">
        <img
          src="https://images.pexels.com/photos/20177680/pexels-photo-20177680.jpeg?auto=compress&cs=tinysrgb&w=1200"
          alt="Mombasa Market"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-brand-primary/75" />
        <Container className="relative flex h-full flex-col justify-end pb-10">
          <Breadcrumb items={[{ label: "About" }]} />
          <span className="mt-3 text-[11px] font-bold uppercase tracking-[0.2em] text-brand-secondary">IKO KITU!</span>
          <h1 className="mt-1 font-display text-3xl uppercase tracking-wider text-white sm:text-4xl">About Us</h1>
        </Container>
      </div>

      <Container className="py-16">
        <div className="grid gap-14 lg:grid-cols-2">
          <Reveal>
            <h2 className="font-display text-2xl uppercase tracking-wider text-brand-primary">Our Story</h2>
            <div className="mt-5 space-y-4 text-sm leading-relaxed text-charcoal/80">
              <p>
                <strong className="text-brand-primary">No Maneno Bazaar</strong> has been serving the people
                of Mombasa for generations. Located on Digo Road in the heart of Mombasa CBD, we offer an
                extensive range of products under one roof — from fashion and footwear to electronics, home
                essentials, and everything for your little ones.
              </p>
              <p>
                Our name says it all: <em>"No Maneno"</em> — no fuss, no hassle. Just great products at fair
                prices with friendly, helpful service. And as we always say, <strong className="text-brand-secondary">"IKO KITU!"</strong> —
                there's always something for everyone.
              </p>
            </div>

            <div className="mt-8 rounded-lg bg-off-white p-6 text-sm text-charcoal/80">
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-brand-accent">Location</p><p className="mt-1">Digo Road, Mombasa CBD</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-brand-accent">Phone</p><p className="mt-1">+254 720 784379</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-brand-accent">Mon – Sat</p><p className="mt-1">9:00 AM – 6:30 PM</p></div>
                <div><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-brand-accent">Sunday</p><p className="mt-1">10:00 AM – 5:00 PM</p></div>
              </div>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <h2 className="font-display text-2xl uppercase tracking-wider text-brand-primary">Our 4 Floors</h2>
            <div className="mt-5 space-y-3">
              {FLOORS.map(([title, desc], i) => (
                <div key={i} className="flex items-center gap-4 rounded-lg bg-white p-4 shadow-sm">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-brand-primary font-display text-sm font-bold text-brand-secondary">
                    {i}F
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-brand-primary">{title}</p>
                    <p className="text-xs text-gray-500">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 overflow-hidden rounded-lg">
              <img
                src="https://images.pexels.com/photos/36627677/pexels-photo-36627677.jpeg?auto=compress&cs=tinysrgb&w=800"
                alt="Shopping experience"
                className="aspect-[16/9] w-full object-cover"
              />
            </div>
          </Reveal>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-3">
          {[
            ["Trusted for Generations", "A household name in Mombasa, serving families with quality goods for years."],
            ["Fair Prices Always", "Quality products carefully selected to give you the best value for your money."],
            ["Everything Under One Roof", "Over 100 products across 10 departments — your one-stop shop."],
          ].map(([t, d], i) => (
            <Reveal key={i} delay={i * 80}>
              <div className="h-full rounded-lg bg-white p-6 shadow-sm">
                <div className="mb-3 h-1 w-8 rounded-full bg-brand-secondary" />
                <h3 className="font-display text-base text-brand-primary">{t}</h3>
                <p className="mt-2 text-xs leading-relaxed text-gray-500">{d}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <div className="mt-14 text-center">
          <Link
            to="/shop"
            className="inline-block rounded-sm bg-brand-primary px-8 py-3 text-xs font-bold uppercase tracking-[0.12em] text-white transition-all hover:bg-brand-secondary hover:text-brand-primary"
          >
            Explore Our Products
          </Link>
        </div>
      </Container>
    </div>
  );
}
