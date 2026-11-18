import { useCallback, useEffect, useLayoutEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { Link, parseRoute, useEntryFocus, useRouteState } from "../router";
import { usePageTitle, useStorefront } from "../store/StorefrontContext";
import { textLinkClass } from "./checkout";
import { Breadcrumb, Container } from "./ui";

/** One h2 section of a long page, listed under "On this page"; `id` names it in the page's address. */
export type InfoSection = { id: string; title: string; content: ReactNode };

/** Body text styles shared by the information pages, so every page keeps the same rhythm. */
export const infoParagraph = "mt-3";
export const infoList = "mt-3 list-disc space-y-2 pl-5";

const UPDATED = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** A section's address: the page's own route with `?section=`, because the hash is the route (never a bare `#id`). */
export function sectionRoute(pathname: string, id: string) {
  return `${pathname}?section=${encodeURIComponent(id)}`;
}

const isPlainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/** A section's h2 inside the page content; only ids from the page's own sections reach the selector. */
function sectionHeading(content: HTMLElement | null, id: string) {
  return content?.querySelector<HTMLElement>(`h2[id="${id}"]`) ?? null;
}

/**
 * The reading layout of the public information pages: breadcrumb, a focusable h1, an optional "Last updated" line and
 * opening note, then the content at a comfortable measure. Long pages pass `sections`, which adds "On this page"
 * (a list under the h1 on phones and tablets, a sticky column from 1024px) and moves to `?section=<id>`:
 * - in-app arrival at, or change to, a known section (link, Back/Forward): its h2 scrolls to the top and takes focus;
 * - in-app change to no section (Back to the page itself): the router has scrolled to the top; the h1 takes focus;
 * - a click on the section the address already names (where navigating does nothing): the same scroll and focus;
 * - a fresh load at a section: scrolls only, once `ready` and the fonts have loaded, unless the person has already
 *   scrolled or moved focus. Unknown sections count as none.
 */
export function InfoPage({ title, updated, note, sections = [], ready = true, children }: {
  title: string;
  /** ISO date of the last change, shown as "Last updated 18 November 2026". */
  updated?: string;
  /** The opening note: the demonstration statement and the page's purpose. */
  note?: ReactNode;
  sections?: readonly InfoSection[];
  /** False while the content still depends on data being loaded, so a fresh load's scroll waits for its final layout. */
  ready?: boolean;
  /** Content before the sections, or the whole content of a short page. */
  children?: ReactNode;
}) {
  const { brandName } = useStorefront();
  usePageTitle(`${title} · ${brandName}`);
  const { route, kind } = useRouteState();
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useEntryFocus(heading);

  const pathname = route.split("?")[0] || "/";
  const requested = parseRoute(route).params.get("section");
  const section = sections.some(({ id }) => id === requested) ? requested : null;

  const reveal = useCallback((id: string) => {
    const target = sectionHeading(content.current, id);
    if (!target) return;
    // The root's scroll-padding-top already keeps it below the sticky header.
    target.scrollIntoView({ block: "start", behavior: window.matchMedia(REDUCED_MOTION).matches ? "instant" : "smooth" });
    target.focus({ preventScroll: true });
  }, []);

  const shownRoute = useRef<string | null>(null);
  useLayoutEffect(() => {
    const arriving = shownRoute.current === null;
    shownRoute.current = route;
    if (kind !== "push" && kind !== "traverse") return;
    if (section !== null) reveal(section);
    // Arriving without a section, useEntryFocus has placed focus already.
    else if (!arriving) heading.current?.focus({ preventScroll: true });
  }, [route, kind, section, reveal]);

  // Where the page started, to tell whether the person has scrolled or moved focus before a fresh load's scroll.
  const start = useRef<{ scrollY: number; focus: Element | null }>({ scrollY: 0, focus: null });
  useLayoutEffect(() => {
    start.current = { scrollY: window.scrollY, focus: document.activeElement };
  }, []);
  const loadedAt = kind === "load" ? section : null;
  useEffect(() => {
    if (loadedAt === null || !ready) return;
    let live = true;
    void document.fonts.ready.then(() => {
      const moved = Math.abs(window.scrollY - start.current.scrollY) > 1 || document.activeElement !== start.current.focus;
      // Like an anchor on page load: an instant jump, and focus stays where the browser put it.
      if (live && !moved) sectionHeading(content.current, loadedAt)?.scrollIntoView({ block: "start", behavior: "instant" });
    });
    return () => { live = false; };
  }, [loadedAt, ready]);

  const followSection = (id: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    // The address already names this section, so navigating would do nothing: scroll and focus here instead.
    if (!isPlainClick(event) || sectionRoute(pathname, id) !== route) return;
    event.preventDefault();
    reveal(id);
  };

  return (
    <Container className="py-8 md:py-12">
      <Breadcrumb items={[{ label: title }]} />
      <h1 ref={heading} tabIndex={-1} className="mt-5 type-h1 text-navy-900 [overflow-wrap:break-word]">{title}</h1>
      {updated && (
        <p className="mt-2 text-sm text-muted">
          Last updated <time dateTime={updated}>{UPDATED.format(new Date(`${updated}T00:00:00Z`))}</time>
        </p>
      )}
      <div className={`mt-6 ${sections.length ? "lg:grid lg:grid-cols-[minmax(0,15rem)_minmax(0,68ch)] lg:items-start lg:gap-x-12" : ""}`}>
        {sections.length > 0 && (
          /* Sticky beside the content only where the window is tall enough to keep it in view; padded so the focus
             rings of the links stay visible inside its own scrolling. */
          <nav
            aria-label="On this page"
            className="focus-scroll-room -mx-1.5 mb-6 min-w-0 p-1.5 lg:mb-0 lg:[@media(min-height:600px)]:sticky lg:[@media(min-height:600px)]:top-[calc(var(--sticky-header-height,0px)_+_1rem)] lg:[@media(min-height:600px)]:max-h-[calc(100dvh_-_var(--sticky-header-height,0px)_-_2rem)] lg:[@media(min-height:600px)]:overflow-y-auto"
          >
            <p aria-hidden="true" className="text-xs font-bold uppercase tracking-[0.15em] text-muted">On this page</p>
            <ul className="mt-1">
              {sections.map(({ id, title: label }) => (
                <li key={id}>
                  <Link to={sectionRoute(pathname, id)} onClick={followSection(id)} className={textLinkClass}>{label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <div ref={content} className="min-w-0 max-w-[68ch] text-base leading-relaxed text-navy-800 [overflow-wrap:break-word]">
          {note && <div role="note" className="mb-6 rounded-md border border-ocean-blue/30 bg-info-tint px-4 py-3">{note}</div>}
          {children}
          {sections.map(({ id, title: label, content: body }) => (
            <section key={id} className="mt-10 first:mt-0">
              <h2 id={id} tabIndex={-1} className="type-h2 text-navy-900">{label}</h2>
              {body}
            </section>
          ))}
        </div>
      </div>
    </Container>
  );
}
