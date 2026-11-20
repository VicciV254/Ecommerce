import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "../router";
import { Container } from "./ui";
import { BrandLogo } from "./Brand";
import { useCatalog } from "../store/CatalogContext";
import { useStorefront } from "../store/StorefrontContext";
import { SHOPPING_FACTS, deliveryFact, paymentFact, returnRestrictions, returnsFact } from "../store/shoppingFacts";
import { STORE_FACTS } from "../store/storeFacts";
import { subscriptionsAPI } from "../api/subscriptions";
import { describeApiError } from "../api/errors";
import { useAuth } from "../contexts/AuthContext";

const FOOTER_DEPARTMENT_LIMIT = 6;
const columnHeading = "mb-3 text-xs font-bold uppercase tracking-[0.15em] text-gold-400";
/** At least 44px each way on phones, so even a short label ("FAQ", "Terms") is an easy target. */
const footerLink =
  "inline-flex min-h-[44px] min-w-[44px] items-center text-on-navy-muted transition-colors duration-(--motion-feedback) hover:text-white md:min-h-[32px]";

const HELP_LINKS = [
  { to: "/track", label: "Track an order" },
  { to: "/account/orders", label: "Your orders" },
  { to: "/delivery", label: "Delivery" },
  { to: "/returns", label: "Returns" },
  { to: "/faq", label: "FAQ" },
  { to: "/contact", label: "Contact us" },
];

const BOTTOM_LINKS = [
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
  { to: "/admin", label: "Staff portal" },
];

export function Footer() {
  const { categories, returnPolicy, delivery, demonstrationOrders } = useCatalog();
  const restrictions = useMemo(() => returnRestrictions([...categories.byId.values()]), [categories]);
  const { brandName } = useStorefront();
  const { user, refreshUser } = useAuth();
  const emailId = useId();
  const errorId = useId();
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const thanks = useRef<HTMLParagraphElement>(null);

  // The confirmation replaces the form, so the focused field or button disappears: put focus on the confirmation instead
  // (which also reads it out), unless focus has already moved somewhere else on the page.
  useEffect(() => {
    if (done && (document.activeElement === null || document.activeElement === document.body)) thanks.current?.focus();
  }, [done]);
  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    setError(null);
    try {
      await subscriptionsAPI.subscribe({ email });
      setDone(true);
      setEmail("");
      // The address may be this account's: reload it, so its email preference shows what is now sent.
      if (user) void refreshUser();
    } catch (reason) {
      setError(describeApiError(reason, "Could not subscribe."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <footer className="on-navy mt-20 bg-navy-900 text-sm text-on-navy-muted">
      {/* Newsletter */}
      <div className="border-b border-white/10">
        <Container className="flex flex-col items-center justify-between gap-5 py-10 md:flex-row">
          <div className="text-center md:text-left">
            <h2 className="font-display text-xl text-white">Stay updated</h2>
            <p className="mt-1">Subscribe for offers and new arrivals.</p>
          </div>
          {done ? (
            <p ref={thanks} tabIndex={-1} role="status" className="max-w-md text-center font-semibold text-gold-400 md:text-left">
              Thank you for subscribing. Every email has a link to unsubscribe.
            </p>
          ) : (
            /* Side by side only while the form is at least 20rem wide: rem grows with the text size, so at large text or
               on very narrow screens the field and button stack and the field keeps the full width. */
            <div className="@container w-full max-w-md">
              <form onSubmit={handleSubscribe} className="flex flex-col gap-2 @xs:flex-row @xs:gap-0">
                <label htmlFor={emailId} className="sr-only">Email address</label>
                <input
                  id={emailId}
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Your email address"
                  disabled={loading}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                  className="min-h-[44px] min-w-0 w-full rounded-sm bg-surface px-4 py-2.5 text-navy-900 placeholder:text-muted disabled:bg-surface-soft @xs:rounded-r-none"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="min-h-[44px] shrink-0 rounded-sm bg-gold-500 px-5 text-xs font-bold uppercase tracking-[0.12em] text-navy-900 transition-colors duration-(--motion-feedback) hover:bg-gold-400 disabled:cursor-not-allowed disabled:bg-on-navy-muted @xs:rounded-l-none"
                >
                  {loading ? "Subscribing..." : "Subscribe"}
                </button>
              </form>
              {error && (
                <p id={errorId} role="alert" className="mt-2 rounded-sm bg-error-tint px-3 py-2 text-sm font-semibold text-error [overflow-wrap:break-word]">
                  {error}
                </p>
              )}
            </div>
          )}
        </Container>
      </div>

      <Container className="py-12">
        {/* The brand column is as wide as the lockup needs but never more than 40%, so a long store name wraps instead of
            leaving the link columns no room. */}
        <div className="grid gap-10 [overflow-wrap:anywhere] md:grid-cols-[fit-content(40%)_minmax(0,1fr)] md:gap-14">
          {/* min-w-0: an unbroken store name may break inside the word rather than size the phone column to the word. */}
          <Link to="/" className="min-w-0 max-w-full justify-self-center md:justify-self-start">
            <BrandLogo name={brandName} surface="navy" layout="stacked" size="xl" />
          </Link>
          <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-3">
            <nav aria-labelledby="footer-shop">
              <h2 id="footer-shop" className={columnHeading}>Shop</h2>
              <ul>
                <li><Link to="/shop" className={footerLink}>Shop all</Link></li>
                {categories.roots.slice(0, FOOTER_DEPARTMENT_LIMIT).map((c) => (
                  <li key={c.slug}><Link to={`/shop?cat=${c.slug}`} className={footerLink}>{c.name}</Link></li>
                ))}
                <li><Link to="/wishlist" className={footerLink}>Wishlist</Link></li>
              </ul>
            </nav>
            <nav aria-labelledby="footer-help">
              <h2 id="footer-help" className={columnHeading}>Help</h2>
              <ul>
                {[...HELP_LINKS, { to: "/about", label: `About ${brandName}` }].map((item) => (
                  <li key={item.to}><Link to={item.to} className={footerLink}>{item.label}</Link></li>
                ))}
              </ul>
            </nav>
            <section aria-labelledby="footer-facts" className="col-span-2 lg:col-span-1">
              <h2 id="footer-facts" className={columnHeading}>Shopping here</h2>
              <ul className="space-y-2 leading-relaxed">
                <li>{SHOPPING_FACTS.vat}</li>
                <li>{paymentFact(demonstrationOrders)}</li>
                <li>{deliveryFact(delivery)}</li>
                <li>{returnsFact(returnPolicy?.windowDays ?? null, demonstrationOrders, restrictions)}</li>
              </ul>
            </section>
          </div>
        </div>

        {/* Phones: the demonstration line, the links, then the copyright. From 768px: both lines left, the links right. */}
        <div className="mt-10 grid justify-items-center gap-2 border-t border-white/10 pt-6 text-xs md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:justify-items-start md:gap-x-8">
          <p className="min-w-0 max-w-full text-center [overflow-wrap:break-word] md:text-left">{STORE_FACTS.demonstration}</p>
          {/* Padded links keep the gaps around the dots even (short labels would otherwise centre in their 44px). From 768px
              the list is pulled 8px right so the last label lines up with the edge, which leaves it 8px wider than its
              column: it isn't capped at the column's width there, or the last link would wrap onto a second line. */}
          <ul className="flex min-w-0 max-w-full flex-wrap items-center justify-center md:col-start-2 md:row-span-2 md:row-start-1 md:-mr-2 md:max-w-none">
            {BOTTOM_LINKS.map((item, index) => (
              <li key={item.to} className="flex items-center">
                {index > 0 && <span aria-hidden="true">·</span>}
                <Link to={item.to} className={`${footerLink} justify-center px-2`}>{item.label}</Link>
              </li>
            ))}
          </ul>
          <p className="min-w-0 max-w-full text-center [overflow-wrap:break-word] md:text-left">© 2026 {brandName}. All rights reserved.</p>
        </div>
      </Container>
    </footer>
  );
}
