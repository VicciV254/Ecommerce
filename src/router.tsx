import { useEffect, useState, useCallback } from "react";

function currentRoute() {
  const hashRoute = window.location.hash.replace(/^#/, "");
  if (hashRoute) return hashRoute;

  const pathRoute = `${window.location.pathname}${window.location.search}`;
  return pathRoute === "/" ? "/" : pathRoute;
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

export function Link({
  to,
  className,
  children,
  onClick,
}: {
  to: string;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const handle = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onClick?.();
      navigate(to);
    },
    [to, onClick]
  );
  return (
    <a href={`#${to}`} className={className} onClick={handle}>
      {children}
    </a>
  );
}

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
