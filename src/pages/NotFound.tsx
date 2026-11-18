import { useRef } from "react";
import { textLinkClass } from "../components/checkout";
import { Container } from "../components/ui";
import { Link, useEntryFocus } from "../router";
import { usePageTitle, useStorefront } from "../store/StorefrontContext";

/** Any address the shop doesn't know: says so plainly and offers the ways on. */
export default function NotFound() {
  const { brandName } = useStorefront();
  usePageTitle(`Page not found · ${brandName}`);
  const heading = useRef<HTMLHeadingElement>(null);
  useEntryFocus(heading);

  return (
    <Container className="py-8 md:py-12">
      <div className="max-w-2xl [overflow-wrap:break-word]">
        <h1 ref={heading} tabIndex={-1} className="type-h1 text-navy-900">We can't find that page</h1>
        <p className="mt-3 text-navy-800">The address may be mistyped, or the page may have moved.</p>
        <ul className="mt-4">
          <li><Link to="/" className={textLinkClass}>Go to the home page</Link></li>
          <li><Link to="/shop" className={textLinkClass}>Browse the shop</Link></li>
          <li><Link to="/contact" className={textLinkClass}>Contact us</Link></li>
        </ul>
      </div>
    </Container>
  );
}
