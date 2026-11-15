import { forwardRef, useEffect, useState, useCallback, type ComponentPropsWithoutRef, type MouseEvent } from "react";

/** Retired pages, by first path segment, whose old links still land somewhere useful. */
const RETIRED_ROUTES = new Map([["showroom", "/shop"]]);

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

export function useRoute() {
  const [route, setRoute] = useState<string>(() => currentRoute());

  useEffect(() => {
    const onRouteChange = () => {
      setRoute(currentRoute());
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    };
    window.addEventListener("hashchange", onRouteChange);
    window.addEventListener("popstate", onRouteChange);
    return () => {
      window.removeEventListener("hashchange", onRouteChange);
      window.removeEventListener("popstate", onRouteChange);
    };
  }, []);

  return route;
}

export function navigate(to: string) {
  window.location.hash = to;
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
