import { useId, useState } from "react";
import { Link } from "../router";
import { Container } from "./ui";
import { BrandLogo } from "./Brand";
import { useCatalog } from "../store/CatalogContext";
import { useStorefront } from "../store/StorefrontContext";
import { SHOPPING_FACTS, returnsFact } from "../store/shoppingFacts";
import { subscriptionsAPI } from "../api/subscriptions";
import { describeApiError } from "../api/errors";
import toast from "react-hot-toast";

const FOOTER_DEPARTMENT_LIMIT = 6;
const columnHeading = "mb-3 text-xs font-bold uppercase tracking-[0.15em] text-gold-400";
const footerLink =
  "inline-flex min-h-[44px] items-center text-on-navy-muted transition-colors duration-(--motion-feedback) hover:text-white md:min-h-[32px]";

const HELP_LINKS = [
  { to: "/track", label: "Track an order" },
  { to: "/account/orders", label: "Orders and returns" },
  { to: "/contact", label: "Contact us" },
  { to: "/about", label: "About Apex Cart" },
];

export function Footer() {
  const { categories, returnPolicy } = useCatalog();
  const { brandName } = useStorefront();
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    try {
      await subscriptionsAPI.subscribe({ email });
      setDone(true);
      setEmail("");
      toast.success("Successfully subscribed!");
    } catch (error) {
      toast.error(describeApiError(error, "Could not subscribe."));
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
            <p className="font-semibold text-gold-400">✓ Thank you for subscribing!</p>
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
                {HELP_LINKS.map((item) => (
                  <li key={item.to}><Link to={item.to} className={footerLink}>{item.label}</Link></li>
                ))}
              </ul>
            </nav>
            <section aria-labelledby="footer-facts" className="col-span-2 lg:col-span-1">
              <h2 id="footer-facts" className={columnHeading}>Shopping here</h2>
              <ul className="space-y-2 leading-relaxed">
                <li>{SHOPPING_FACTS.vat}</li>
                <li>{SHOPPING_FACTS.payment}</li>
                <li>{SHOPPING_FACTS.delivery}</li>
                <li>{returnsFact(returnPolicy?.windowDays ?? null)}</li>
              </ul>
            </section>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-2 border-t border-white/10 pt-6 text-xs md:flex-row">
          <p className="min-w-0 max-w-full text-center [overflow-wrap:break-word] md:text-left">© 2026 {brandName}. All rights reserved.</p>
          <Link to="/admin" className="inline-flex min-h-[44px] items-center transition-colors duration-(--motion-feedback) hover:text-white">
            Staff portal
          </Link>
        </div>
      </Container>
    </footer>
  );
}
