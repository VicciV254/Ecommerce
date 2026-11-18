import { useRef } from "react";
import { textLinkClass } from "../components/checkout";
import { Breadcrumb, Container } from "../components/ui";
import { Link, useEntryFocus } from "../router";
import { useCatalog } from "../store/CatalogContext";
import { usePageTitle, useStorefront } from "../store/StorefrontContext";
import { SHOPPING_FACTS, deliveryFact, returnsFact } from "../store/shoppingFacts";

const primaryAction =
  "inline-flex min-h-[44px] items-center justify-center rounded-sm bg-navy-900 px-6 text-xs font-bold uppercase tracking-[0.12em] text-white transition-colors duration-(--motion-feedback) hover:bg-gold-500 hover:text-navy-900";
const secondaryAction =
  "inline-flex min-h-[44px] items-center justify-center rounded-sm border border-navy-900 px-6 text-xs font-bold uppercase tracking-[0.12em] text-navy-900 transition-colors duration-(--motion-feedback) hover:bg-navy-900 hover:text-white";

export default function About() {
  const { brandName } = useStorefront();
  usePageTitle(`About · ${brandName}`);
  const heading = useRef<HTMLHeadingElement>(null);
  useEntryFocus(heading);
  const { returnPolicy, delivery } = useCatalog();
  // Delivery and returns are summarised here; their own pages have the details.
  const facts = [
    { title: "Prices and VAT", text: SHOPPING_FACTS.vat },
    { title: "Delivery", text: deliveryFact(delivery), more: { to: "/delivery", label: "See Delivery" } },
    { title: "Payment", text: SHOPPING_FACTS.payment },
    { title: "Returns", text: returnsFact(returnPolicy?.windowDays ?? null), more: { to: "/returns", label: "See Returns and refunds" } },
  ];

  return (
    <Container className="py-8 md:py-12">
      <Breadcrumb items={[{ label: "About" }]} />
      <div className="mt-5 max-w-2xl">
        <h1 ref={heading} tabIndex={-1} className="type-h1 text-navy-900">About {brandName}</h1>
        <p className="mt-3 text-muted">
          {brandName} is an online store with products across departments. Browse by department or search for what you
          need.
        </p>
        <Link to="/shop" className={`mt-5 ${primaryAction}`}>Browse products</Link>
      </div>

      <section aria-labelledby="about-how" className="mt-10">
        <h2 id="about-how" className="type-h2 text-navy-900">How shopping works</h2>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2">
          {facts.map((fact) => (
            <li key={fact.title} className="rounded-lg border border-divider bg-surface p-5 shadow-card">
              <h3 className="type-h3 text-navy-900">{fact.title}</h3>
              <p className="mt-2 text-navy-800">{fact.text}</p>
              {fact.more && <Link to={fact.more.to} className={`mt-1 ${textLinkClass}`}>{fact.more.label}</Link>}
            </li>
          ))}
        </ul>
        <Link to="/faq" className={`mt-3 ${textLinkClass}`}>See the FAQ</Link>
      </section>

      <section aria-labelledby="about-next" className="mt-10 rounded-lg bg-surface-soft p-5 md:p-6">
        <h2 id="about-next" className="type-h3 text-navy-900">Questions about an order?</h2>
        <p className="mt-2 text-navy-800">Track an order with its number, or send us a message.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link to="/track" className={secondaryAction}>Track an order</Link>
          <Link to="/contact" className={secondaryAction}>Contact us</Link>
        </div>
      </section>
    </Container>
  );
}
