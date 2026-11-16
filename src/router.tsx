import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type RefObject,
} from "react";

/** Retired pages, by first path segment, whose old links still land somewhere useful. */
const RETIRED_ROUTES = new Map([["showroom", "/shop"]]);

/**
 * How the current route was reached: the page load, an in-app `navigate()`/`Link` that added a history entry,
 * an in-place update that replaced the entry, or Back/Forward (any other change of the address counts as one).
 */
export type NavigationKind = "load" | "push" | "replace" | "traverse";
export type RouteState = { route: string; kind: NavigationKind; previous: string | null };

function readRoute() {
  const hashRoute = window.location.hash.replace(/^#/, "");
  if (hashRoute) return hashRoute;

  const pathRoute = `${window.location.pathname}${window.location.search}`;
  return pathRoute === "/" ? "/" : pathRoute;
}

/** The current route; a retired one is swapped in place for its replacement, adding no history entry. */
function currentRoute() {
  const route = readRoute();
  const replacement = RETIRED_ROUTES.get(parseRoute(route).parts[0] ?? "");
  if (replacement === undefined) return route;
  window.history.replaceState(window.history.state, "", `#${replacement}`);
  return replacement;
}

/* One shared route store: every reader sees the same route and navigation kind, and the page scrolls once per change. */
let state: RouteState | null = null;
/** The route a `navigate()` call is pushing, so its hash change is told apart from Back/Forward. */
let pendingPush: string | null = null;
const subscribers = new Set<() => void>();

function publish(next: RouteState) {
  state = next;
  if (next.kind !== "replace") window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  for (const notify of subscribers) notify();
}

/** Browsers announce one hash navigation with both `popstate` and `hashchange`; the second finds nothing new. */
function onLocationChange() {
  // The address as it arrived, before a retired route is swapped: what `navigate()` recorded for its push.
  const arrived = readRoute();
  const route = currentRoute();
  const pushed = pendingPush !== null && pendingPush === arrived;
  pendingPush = null;
  if (state?.route === route) return;
  publish({ route, kind: pushed ? "push" : "traverse", previous: state?.route ?? null });
}

function subscribe(notify: () => void) {
  if (!subscribers.size) {
    window.addEventListener("hashchange", onLocationChange);
    window.addEventListener("popstate", onLocationChange);
  }
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
    if (subscribers.size) return;
    window.removeEventListener("hashchange", onLocationChange);
    window.removeEventListener("popstate", onLocationChange);
  };
}

function getState(): RouteState {
  // Unwatched, the address may have changed unseen (before the first reader mounts, or between tests).
  if (!subscribers.size) {
    const route = currentRoute();
    if (state?.route !== route) state = { route, kind: "load", previous: null };
  }
  return state!;
}

export function useRouteState(): RouteState {
  return useSyncExternalStore(subscribe, getState);
}

export function useRoute() {
  return useRouteState().route;
}

/**
 * On an in-app arrival (a followed link, or Back/Forward), focus moves to the page's H1 unless it stayed in the site
 * header; a fresh load leaves focus where the browser put it. Call it where the heading first renders.
 */
export function useEntryFocus(heading: RefObject<HTMLElement | null>) {
  const { kind } = useRouteState();
  const arrival = useRef(kind);
  useLayoutEffect(() => {
    if (arrival.current !== "push" && arrival.current !== "traverse") return;
    if (document.activeElement?.closest("[data-site-header]")) return;
    heading.current?.focus({ preventScroll: true });
  }, [heading]);
}

/**
 * Moves to `to`. A push adds a history entry and starts at the top of the page; `replace` swaps the current entry
 * in place, keeping the scroll position, so Back skips the intermediate states.
 */
export function navigate(to: string, { replace = false }: { replace?: boolean } = {}) {
  if (!replace) {
    // The browser stores the fragment percent-encoded; a URL applies the same encoding, so the arrival is recognisable.
    const target = new URL(window.location.href);
    target.hash = to;
    // The same address adds no history entry and fires no event.
    if (target.hash === window.location.hash) return;
    // Recorded before the assignment: browsers fire `popstate` synchronously inside it (`hashchange` follows later).
    pendingPush = target.hash.slice(1);
    window.location.hash = to;
    return;
  }
  window.history.replaceState(window.history.state, "", `#${to}`);
  const route = currentRoute();
  if (state?.route !== route) publish({ route, kind: "replace", previous: state?.route ?? null });
}

type LinkProps = Omit<ComponentPropsWithoutRef<"a">, "href"> & { to: string };

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({
  to, onClick, target, download, children, ...props
}, ref) {
  const handle = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e);
      if (
        e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ||
        (target && target !== "_self") || (download !== undefined && download !== false)
      ) return;
      e.preventDefault();
      navigate(to);
    },
    [to, onClick, target, download]
  );
  return (
    <a {...props} ref={ref} href={`#${to}`} target={target} download={download} onClick={handle}>
      {children}
    </a>
  );
});

export function parseRoute(route: string) {
  const [path, query] = route.split("?");
  const parts = path.split("/").filter(Boolean);
  const params = new URLSearchParams(query || "");
  return { parts, params };
}

export function useLocation() {
  const route = useRoute();
  const pathname = route.split("?")[0] || "/";
  return { pathname };
}
