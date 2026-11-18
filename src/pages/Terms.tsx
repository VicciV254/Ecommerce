import { inlineLinkClass } from "../components/checkout";
import { InfoPage, infoParagraph, type InfoSection } from "../components/InfoPage";
import { EmailLink, PhoneLink } from "../components/StoreContacts";
import { Link } from "../router";
import { STORE_FACTS } from "../store/storeFacts";

/** The terms of use of this demonstration store; the user reviews them before publication. */
export default function Terms() {
  const { operator } = STORE_FACTS;
  const sections: InfoSection[] = [
    {
      id: "a-demonstration-store",
      title: "A demonstration store",
      content: (
        <p className={infoParagraph}>
          {operator} is a demonstration store built as a personal project. Its products, prices, descriptions and images
          are samples, and many images are placeholders from Unsplash and Pexels. Nothing is sold or delivered, and the
          site takes no real payments: on this site, checkout stops before an order is placed.
        </p>
      ),
    },
    {
      id: "how-the-store-is-set-up",
      title: "How the store is set up",
      content: (
        <p className={infoParagraph}>
          <Link to="/delivery" className={inlineLinkClass}>Delivery</Link>,{" "}
          <Link to="/returns" className={inlineLinkClass}>Returns and refunds</Link> and the{" "}
          <Link to="/faq" className={inlineLinkClass}>FAQ</Link> describe how the store is set up to work. Prices are in
          Kenyan shillings and exclude VAT; at checkout, 16% VAT is added to items, and the delivery fee is shown before an
          order is reserved.
        </p>
      ),
    },
    {
      id: "using-the-site",
      title: "Using the site",
      content: (
        <p className={infoParagraph}>
          Use it lawfully. Don't try to break or overload it, or to get into accounts or areas that aren't yours. We may
          suspend accounts that misuse the site.
        </p>
      ),
    },
    {
      id: "your-account",
      title: "Your account",
      content: (
        <p className={infoParagraph}>
          Keep your password to yourself. You can ask us to delete your account (see the{" "}
          <Link to="/privacy" className={inlineLinkClass}>Privacy notice</Link>).
        </p>
      ),
    },
    {
      id: "availability",
      title: "Availability",
      content: (
        <p className={infoParagraph}>
          The site is provided as it is. It may change, be unavailable at times, or be reset, which removes accounts and
          their data.
        </p>
      ),
    },
    {
      id: "liability",
      title: "Liability",
      content: (
        <p className={infoParagraph}>
          As far as the law allows, {operator} isn't liable for losses from using this demonstration site. Nothing here
          limits rights you have under Kenyan law that can't be limited.
        </p>
      ),
    },
    {
      id: "law",
      title: "Law",
      content: <p className={infoParagraph}>These terms are governed by the laws of Kenya.</p>,
    },
    {
      id: "contact",
      title: "Contact",
      content: (
        <p className={infoParagraph}>
          <EmailLink className={inlineLinkClass} /> · <PhoneLink className={inlineLinkClass} /> · {STORE_FACTS.hours}.
        </p>
      ),
    },
  ];

  return (
    <InfoPage
      title="Terms of use"
      updated={STORE_FACTS.policiesUpdated}
      note={<p>{STORE_FACTS.demonstration}</p>}
      sections={sections}
    />
  );
}
