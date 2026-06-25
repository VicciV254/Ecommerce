import { useEffect, useState, useCallback } from "react";

export function useRoute() {
  const [route, setRoute] = useState<string>(
    () => window.location.hash.replace(/^#/, "") || "/"
  );

  useEffect(() => {
    const onHash = () => {
      setRoute(window.location.hash.replace(/^#/, "") || "/");
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
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
