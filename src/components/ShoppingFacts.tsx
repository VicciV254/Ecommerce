import { useId, useMemo, type ReactNode } from "react";
import { Link } from "../router";
import { useCatalog } from "../store/CatalogContext";
import { VAT_SHORT_FACT, deliveryShortFact, paymentShortFact, returnRestrictions, returnsShortFact } from "../store/shoppingFacts";
import { sectionRoute } from "./InfoPage";
import { Container } from "./ui";

/** The FAQ topic that answers how prices and payment work. */
const HOW_IT_IS_SET_UP = sectionRoute("/faq", "how-the-store-is-set-up");

/** A simple line icon on a 24px grid, drawn in the text colour. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-6">
      {children}
    </svg>
  );
}

const ICONS = {
  prices: <Icon><path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z" /><circle cx="8" cy="8" r="1.5" /></Icon>,
  delivery: <Icon><path d="M2.5 6.5h11v10h-11z" /><path d="M13.5 9.5h4l3 3.5v3.5h-7" /><circle cx="6.5" cy="17.5" r="1.75" /><circle cx="16.5" cy="17.5" r="1.75" /></Icon>,
  payment: <Icon><rect x="7" y="2.5" width="10" height="19" rx="1.5" /><path d="M11 18.5h2" /></Icon>,
  returns: <Icon><path d="M9 14.5 4.5 10 9 5.5" /><path d="M4.5 10h10a5 5 0 0 1 0 10H11" /></Icon>,
};

/**
 * Four facts about buying here, in their short forms (`shoppingFacts.ts`), each leading to the page that states it in
 * full: 2 by 2 on phones, one row from 768px. The section's heading names the strip for screen readers; it isn't shown.
 * It needs nothing but the catalog's settings, so it shows while the catalog loads, in neutral wording until then.
 */
export function ShoppingFacts({ title }: { title: string }) {
  const { categories, delivery, demonstrationOrders, returnPolicy } = useCatalog();
  const restrictions = useMemo(() => returnRestrictions([...categories.byId.values()]), [categories]);
  const headingId = useId();
  const facts = [
    { fact: VAT_SHORT_FACT, to: HOW_IT_IS_SET_UP, icon: ICONS.prices },
    { fact: deliveryShortFact(delivery), to: "/delivery", icon: ICONS.delivery },
    { fact: paymentShortFact(demonstrationOrders), to: HOW_IT_IS_SET_UP, icon: ICONS.payment },
    { fact: returnsShortFact(returnPolicy?.windowDays ?? null, demonstrationOrders, restrictions), to: "/returns", icon: ICONS.returns },
  ];
  return (
    <Container className="py-6 md:py-8">
      <h2 id={headingId} className="sr-only">{title}</h2>
      <ul aria-labelledby={headingId} className="facts-grid">
        {facts.map(({ fact, to, icon }) => (
          <li key={fact.title} className="flex min-w-0">
            <Link
              to={to}
              className="group flex w-full min-w-0 flex-col gap-2 rounded-lg border border-divider bg-surface p-4 text-navy-800 shadow-card transition-colors duration-(--motion-feedback) hover:border-navy-900"
            >
              <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-warm text-navy-900">{icon}</span>
              <span className="block font-semibold text-navy-900 underline-offset-4 group-hover:underline">{fact.title}</span>{" "}
              <span className="block text-sm hyphenate-long-words [overflow-wrap:break-word]">{fact.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Container>
  );
}
