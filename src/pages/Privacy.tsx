import type { ReactNode } from "react";
import { inlineLinkClass } from "../components/checkout";
import { InfoPage, infoList, infoParagraph, type InfoSection } from "../components/InfoPage";
import { EmailLink, PhoneLink } from "../components/StoreContacts";
import { Link } from "../router";
import { useCatalog } from "../store/CatalogContext";
import { STORE_FACTS } from "../store/storeFacts";

/** A list item that opens with its topic in bold ("Your account: …"). */
function Topic({ name, children }: { name: string; children: ReactNode }) {
  return <li><strong className="font-semibold text-navy-900">{name}:</strong> {children}</li>;
}

/** The regulator's sites, opened in the same tab with the addresses shown as written. */
const ODPC_SITE = "https://www.odpc.go.ke/";
const ODPC_COMPLAINTS = "https://cie.odpc.go.ke/";

/**
 * The privacy notice: what the site collects, why, who sees and receives it, how long it is kept and people's rights.
 * Each statement was checked against the code (see the P8.4 Part 2 progress log); the user reviews it before publication.
 */
export default function Privacy() {
  const { operator } = STORE_FACTS;
  // Where sample orders take demonstration payments the notice says so; otherwise (or until the catalog loads) today's.
  const { status, demonstrationOrders, sampleOrderRetentionDays } = useCatalog();
  const demonstration = demonstrationOrders === true;
  // Sample-order deletion is stated only where the catalog states its period.
  const retention = demonstration && sampleOrderRetentionDays !== null
    ? `${sampleOrderRetentionDays} ${sampleOrderRetentionDays === 1 ? "day" : "days"} after they're placed`
    : null;
  const contact = (
    <>
      <EmailLink className={inlineLinkClass} /> or <PhoneLink className={inlineLinkClass} /> ({STORE_FACTS.hours})
    </>
  );

  const sections: InfoSection[] = [
    {
      id: "who-is-responsible",
      title: "Who is responsible",
      content: (
        <p className={infoParagraph}>
          {operator} (a trading name) decides how this site uses personal information. Contact {contact}.
        </p>
      ),
    },
    {
      id: "what-we-collect",
      title: "What we collect and why",
      content: (
        <>
          <ul className={infoList}>
            <Topic name="Your account">
              your name, email address and password (stored only as a one-way hash), and, if you choose, your phone number
              and a profile photo (the image itself is stored with your account). Used to create your account, sign you in
              and show your details. Name, email and password are needed for an account; the rest is optional.
            </Topic>
            <Topic name="Addresses you save">
              street, town or city, county and optional postal code. Used to work out delivery options and fees at
              checkout.
            </Topic>
            <Topic name="Checkout quotes, orders, payments and returns">
              when checkout prices a cart for ordering, it saves the items, prices and a copy of the delivery address; an
              order then keeps what was ordered, prices, the delivery address and method and its progress, with M-Pesa
              payment details (the phone number paid from, the amount, the receipt number and the results Safaricom sends)
              and any return requests with their reasons and comments.{" "}
              {!demonstration && "The sample products can't be ordered on this site, so checkout saves none of these here."}
              {demonstration && (
                <>
                  {retention ? (
                    <>
                      Orders for sample products record the same details as any order, and are scheduled for deletion{" "}
                      {retention} unless an M-Pesa sandbox payment was tried for them.
                    </>
                  ) : "Orders for sample products are kept like any order."}{" "}
                  A demonstration payment records the method, amount and time, but no mobile-money or provider details.
                </>
              )}
            </Topic>
            <Topic name="Email verification and password resets">
              one-time codes and links. They stop working when they expire (verification codes after 10 minutes,
              verification links after 24 hours, reset links after an hour), but expired records aren't deleted
              automatically.
            </Topic>
            <li>
              <strong className="font-semibold text-navy-900">Promotional emails</strong>, only if you ask for them in the
              footer, at sign-up or in your account: your email address and whether you're subscribed. You can withdraw at
              any time.
            </li>
            <Topic name="Messages you send us">
              the contact form emails your name, email address, phone number if given and message to our mailbox. We don't
              save them in the store's database; they're kept in the mailbox.
            </Topic>
            <Topic name="Security records">
              the server logs requests with your network (IP) address, the time, what was requested and your browser's
              identification. Staff sign-ins also record the network address and browser.
            </Topic>
          </ul>
          <p className={infoParagraph}>We don't use advertising or analytics trackers.</p>
        </>
      ),
    },
    {
      id: "why-we-use-it",
      title: "Why we may use it",
      content: (
        <p className={infoParagraph}>
          To provide the account and features you ask to use; with your consent for promotional emails, which you can
          withdraw at any time; and to keep the site secure and working, which is in our legitimate interest.
        </p>
      ),
    },
    {
      id: "who-can-see-it",
      title: "Who can see it",
      content: (
        <p className={infoParagraph}>
          {operator}'s authorised staff, including read-only staff accounts, can see customer accounts and any orders with
          their delivery addresses, to run the store and answer requests. Administrators can also see the promotional
          email list.
        </p>
      ),
    },
    {
      id: "who-else-receives-it",
      title: "Who else receives information",
      content: (
        <>
          <p className={infoParagraph}>Only services the site needs, each receiving only what its part requires:</p>
          <ul className={infoList}>
            <Topic name="Vercel (hosting) and our database provider">
              run the site and store its data, including your network address in routine logs.
            </Topic>
            <Topic name="Our email service">
              sends account and promotional emails, and delivers contact-form messages to our mailbox.
            </Topic>
            <Topic name="Google (Gmail)">
              hosts our mailbox, where messages to us are kept.
            </Topic>
            <Topic name="Safaricom (M-Pesa)">
              the phone number, amount and an order reference, if a payment is requested.{" "}
              {demonstration ? "On this site, prompts can only be sent to the owner's approved test numbers." : "That can't happen on this site."}
            </Topic>
            <li>
              Cloudinary, Unsplash and Pexels deliver the store's images, and Google Fonts supplies its typefaces. Your
              browser requests these directly, so they receive your network address and normal browser information. We
              don't add your account or order details to those requests.
            </li>
          </ul>
          <p className={infoParagraph}>
            Some of these providers process information outside Kenya, including in the United States. We don't sell
            personal information.
          </p>
        </>
      ),
    },
    {
      id: "how-long-we-keep-it",
      title: "How long we keep it",
      content: (
        <p className={infoParagraph}>
          {retention ? (
            <>
              This is a demonstration. Sample orders, with the delivery details copied onto them and their history, are
              scheduled for deletion {retention}, unless an M-Pesa sandbox payment was tried for them. Nothing else is
              deleted automatically yet: your account, your saved addresses and other checkout records stay until they're
              deleted on request or the demonstration is reset.
            </>
          ) : (
            <>
              This is a demonstration, and there's no automatic deletion yet. Account, address and checkout records stay
              until they're deleted on request or the demonstration is reset.
            </>
          )}{" "}
          Promotional subscriptions stay until you ask us to remove them: unsubscribing stops the emails, and your address
          stays on the list marked as unsubscribed. Contact messages stay in our mailbox. Request logs are kept by our
          hosting provider for its standard period. We review stored information when the demonstration is reset or
          retired and delete what isn't needed.
        </p>
      ),
    },
    {
      id: "your-browser",
      title: "Your browser",
      content: (
        <>
          <p className={infoParagraph}>
            The application doesn't set its own cookies. It uses your browser's storage on this device for:
          </p>
          <ul className={infoList}>
            <li>
              your sign-in and a copy of your account details (name, email, phone, photo, saved addresses and
              preferences), until you sign out;
            </li>
            <li>
              your cart, wishlist, checkout choices and recent order references, kept separately for each account and for
              guests;
            </li>
            <li>
              requests that were sent but not yet confirmed, such as a payment prompt (with its phone number) or a return
              request (with its reason), so they aren't sent twice. They're removed once settled; otherwise they stay until
              you clear the site's storage;
            </li>
            <li>
              for the current tab only: an address you're typing at checkout, your place in product lists, and, just after
              you sign in, which account a guest cart is joining.
            </li>
          </ul>
          <p className={infoParagraph}>
            Signing out removes your sign-in, the account copy and any address you were typing. Everything else stays on
            this device until you clear it in your browser's settings for this site.
          </p>
        </>
      ),
    },
    {
      id: "your-rights",
      title: "Your rights",
      content: (
        <>
          <p className={infoParagraph}>
            Under Kenya's Data Protection Act, 2019, you can ask to be told how your information is used, to get a copy of
            it, to have it corrected or deleted, to object to its use, and to receive it in a portable format. You can
            withdraw consent to promotional emails at any time.
          </p>
          <ul className={infoList}>
            <li>
              Change your name, phone number, photo, addresses and email preferences in{" "}
              <Link to="/account" className={inlineLinkClass}>your account</Link>.
            </li>
            <li>
              For anything else, email <EmailLink className={inlineLinkClass} /> from your account's address, so we can
              check it's you. We may ask for more information if we can't confirm it. If we can't do what you ask, we'll
              explain why.
            </li>
            <li>
              You can complain to the Office of the Data Protection Commissioner (
              <a href={ODPC_SITE} className={inlineLinkClass}>www.odpc.go.ke</a>), including through its complaints portal
              (<a href={ODPC_COMPLAINTS} className={inlineLinkClass}>cie.odpc.go.ke</a>).
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "children",
      title: "Children",
      content: (
        <p className={infoParagraph}>
          The site isn't intended for children under 18, and we don't knowingly collect their information. Sign-up doesn't
          check ages. If you think a child has created an account,{" "}
          <Link to="/contact" className={inlineLinkClass}>contact us</Link> and we'll delete it.
        </p>
      ),
    },
    {
      id: "security",
      title: "Security",
      content: (
        <p className={infoParagraph}>
          Passwords are stored only as one-way hashes. Payments are approved on the customer's phone in M-Pesa, so the
          store never sees an M-Pesa PIN.{demonstration && " A demonstration payment involves no M-Pesa at all."} Staff tools
          need a staff account.
        </p>
      ),
    },
    {
      id: "changes",
      title: "Changes",
      content: <p className={infoParagraph}>If this notice changes, the new version is posted here with its date.</p>,
    },
  ];

  return (
    <InfoPage title="Privacy notice" updated={STORE_FACTS.policiesUpdated} sections={sections} ready={status !== "loading"}>
      <p>
        {operator} is a demonstration store built as a personal project: its products are samples and nothing is sold. This
        notice explains what personal information the site collects, why, who can see it, who else receives it, how long
        it's kept and your rights. "We" means {operator}.
      </p>
    </InfoPage>
  );
}
