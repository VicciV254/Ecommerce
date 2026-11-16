/**
 * Where sign-in returns to: `#/login?returnTo=<route>`. Only internal shopper routes are accepted; anything else, such
 * as another site, a staff page or a sign-in page, returns to the home page instead.
 */

/** First path segments a sign-in may return to. */
const RETURN_SEGMENTS = new Set(["", "shop", "departments", "product", "cart", "checkout", "about", "contact", "wishlist", "track", "account"]);
export const MAX_RETURN_LENGTH = 512;
export const HOME_ROUTE = "/";

/** Whitespace, control characters, backslashes (read as "/" by browsers) and nested fragments are never accepted. */
function hasUnsafeCharacter(value: string) {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f || char === "\\" || char === "#" || /\s/.test(char)) return true;
  }
  return false;
}

/** The route itself when it is a safe internal route, otherwise the home page. */
export function safeReturnTo(value: string | null | undefined): string {
  if (typeof value !== "string" || !value || value.length > MAX_RETURN_LENGTH) return HOME_ROUTE;
  // A single leading slash: "//host" (and "https:") would name another site.
  if (!value.startsWith("/") || value.startsWith("//") || hasUnsafeCharacter(value)) return HOME_ROUTE;
  const segments = value.split("?")[0].split("/").slice(1);
  if (!RETURN_SEGMENTS.has(segments[0] ?? "") || segments.some((segment) => segment === "." || segment === "..")) return HOME_ROUTE;
  return value;
}

/** The sign-in page, returning to `route` afterwards when it is a safe internal route other than home. */
export function loginRoute(route?: string | null) {
  const target = safeReturnTo(route);
  return target === HOME_ROUTE ? "/login" : `/login?returnTo=${encodeURIComponent(target)}`;
}

export const CHECKOUT_SIGN_IN = loginRoute("/checkout");
