import { useMemo, type ReactNode } from "react";
import { inlineLinkClass } from "../components/checkout";
import { InfoPage, infoList, infoParagraph, type InfoSection } from "../components/InfoPage";
import { EmailLink, PhoneLink } from "../components/StoreContacts";
import type { CatalogDelivery } from "../api/catalog";
import { Link } from "../router";
import { usePageReady } from "../components/pageReady";
import { useCatalog } from "../store/CatalogContext";
import { DELIVERY_LABELS } from "../store/checkoutModel";
import { returnRestrictions, returnsWindow } from "../store/shoppingFacts";
import { STORE_FACTS, deliveryDescription } from "../store/storeFacts";

/** A topic's questions, divided by hairlines. */
function Questions({ children }: { children: ReactNode }) {
  return <div className="mt-4 border-t border-divider">{children}</div>;
}

/**
 * One question, closed until it is opened by tap, click, Enter or Space (a native disclosure, so a closed answer holds no
 * focus targets). The question isn't a heading, because browsers don't reliably expose a heading inside `<summary>`; the
 * topics above stay the page's headings.
 */
function Question({ question, children }: { question: string; children: ReactNode }) {
  return (
    <details className="group border-b border-divider">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 py-4 text-lg font-semibold leading-snug text-navy-900 hover:text-link group-open:pb-2 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">{question}</span>
        {/* One line tall, so the chevron stays beside the question's first line when it wraps. */}
        <span aria-hidden="true" className="flex h-[1.375em] shrink-0 items-center">
          <svg viewBox="0 0 20 20" fill="currentColor" className="size-5 transition-transform duration-(--motion-feedback) group-open:rotate-180 motion-reduce:transition-none">
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
          </svg>
        </span>
      </summary>
      <div className="pb-5 [&>:first-child]:mt-0">{children}</div>
    </details>
  );
}

const SeeDelivery = () => <>See <Link to="/delivery" className={inlineLinkClass}>Delivery</Link>.</>;
const SeeReturns = () => <>See <Link to="/returns" className={inlineLinkClass}>Returns and refunds</Link>.</>;

/** Where the store delivers, from the methods checkout offers; until they load (or if they fail), a general answer. */
function DeliveryAnswer({ delivery }: { delivery: readonly CatalogDelivery[] | null }) {
  if (!delivery) return <p className={infoParagraph}>Delivery options and fees are shown at checkout. <SeeDelivery /></p>;
  const pickupOffered = delivery.some(({ method }) => method === "STORE_PICKUP");
  return (
    <>
      <ul className={infoList}>
        {delivery.map((option) => <li key={option.method}>{DELIVERY_LABELS[option.method]}: {deliveryDescription(option)}.</li>)}
      </ul>
      <p className={infoParagraph}>{pickupOffered ? null : "Pickup isn't offered. "}<SeeDelivery /></p>
    </>
  );
}

/** Answers to common questions about this demonstration store; catalog facts fill in delivery and returns. */
export default function Faq() {
  const { status, categories, delivery, returnPolicy, demonstrationOrders } = useCatalog();
  usePageReady(status !== "loading");
  const restrictions = useMemo(() => returnRestrictions([...categories.byId.values()]), [categories]);
  const { operator } = STORE_FACTS;
  // Where sample orders take demonstration payments the answers say so; otherwise (or until the catalog loads) today's.
  const demonstration = demonstrationOrders === true;

  const sections: InfoSection[] = [
    {
      id: "about-this-store",
      title: "About this store",
      content: (
        <Questions>
          <Question question={`Is ${operator} a real shop?`}>
            <p className={infoParagraph}>
              No. {operator} is a demonstration store built as a personal project. Its products are samples, and nothing is
              sold or delivered.
            </p>
          </Question>
          <Question question="What can I try?">
            {demonstration ? (
              <p className={infoParagraph}>
                You can browse and search the products, fill a cart and a wishlist, create an account, save addresses, and
                order sample products with a demonstration payment, which takes no money. You can then play the store's part
                for your own order: dispatch, delivery, a return and its refund.
              </p>
            ) : (
              <p className={infoParagraph}>
                You can browse and search the products, fill a cart and a wishlist, create an account, save addresses and see
                the delivery options at checkout. The products are samples, so on this site checkout stops before an order is
                placed.
              </p>
            )}
          </Question>
          <Question question="Will I be charged?">
            {demonstration ? (
              <p className={infoParagraph}>
                No. A demonstration payment takes no money and sends no phone prompt. M-Pesa is set up in Safaricom's test
                sandbox, and its prompts can only be sent to the owner's approved test numbers.
              </p>
            ) : (
              <p className={infoParagraph}>No. Nothing can be bought here, and the site takes no real payments.</p>
            )}
          </Question>
        </Questions>
      ),
    },
    {
      id: "how-the-store-is-set-up",
      title: "How the store is set up",
      content: (
        <Questions>
          <Question question="How are prices shown?">
            <p className={infoParagraph}>
              Prices exclude VAT. At checkout, 16% VAT is added to items, and the delivery fee, which has no VAT, is shown
              before an order is reserved.
            </p>
          </Question>
          <Question question="Do I need an account?">
            <p className={infoParagraph}>
              Not to browse or fill a cart. Checkout asks you to sign in or create an account, and your cart comes with you.
            </p>
          </Question>
          <Question question="How does payment work?">
            <p className={infoParagraph}>
              The store is set up for M-Pesa: the customer approves a prompt on their phone, so the store never sees an
              M-Pesa PIN.
              {demonstration && " On this site, sample orders are paid with a demonstration payment, unless an approved test number is used."}
            </p>
          </Question>
          <Question question="Where does the store deliver?">
            <DeliveryAnswer delivery={delivery} />
          </Question>
          <Question question="What can be returned?">
            <p className={infoParagraph}>
              {returnPolicy
                ? `${returnsWindow(returnPolicy.windowDays, restrictions, "")} Each product page shows its rule. `
                : "Each product page shows its return rule. "}
              <SeeReturns />
            </p>
          </Question>
        </Questions>
      ),
    },
    {
      id: "your-account-and-privacy",
      title: "Your account and privacy",
      content: (
        <Questions>
          <Question question="How do I stop promotional emails?">
            <p className={infoParagraph}>
              Use the unsubscribe link in any promotional email, or turn promotional emails off in{" "}
              <Link to="/account" className={inlineLinkClass}>your account</Link>.
            </p>
          </Question>
          <Question question="How do I delete my account or my information?">
            <p className={infoParagraph}>
              Email <EmailLink className={inlineLinkClass} /> from the address on your account. Accounts are deleted on
              request; an account with orders is disabled instead, which keeps its data. Deleting an account doesn't end a
              newsletter subscription, so ask us to remove that too, or use its unsubscribe link. See the{" "}
              <Link to="/privacy" className={inlineLinkClass}>Privacy notice</Link>.
            </p>
          </Question>
        </Questions>
      ),
    },
    {
      id: "contact",
      title: "Contact",
      content: (
        <Questions>
          <Question question="How do I contact you?">
            <p className={infoParagraph}>
              Email <EmailLink className={inlineLinkClass} /> or call <PhoneLink className={inlineLinkClass} /> ({STORE_FACTS.hours}),
              or use the <Link to="/contact" className={inlineLinkClass}>contact form</Link>.
            </p>
          </Question>
        </Questions>
      ),
    },
  ];

  return <InfoPage title="FAQ" note={<p>{STORE_FACTS.demonstration}</p>} sections={sections} ready={status !== "loading"} />;
}
