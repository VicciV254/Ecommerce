import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { catalogAPI, type MediaAsset, type PublishedStorefront } from "../api/catalog";
import { describeApiError } from "../api/errors";
import { DEFAULT_BRAND_NAME, StorefrontFormatError, parsePublishedStorefront } from "./storefrontModel";
import { ensureFontStylesheet, themeVariables } from "./storefrontTheme";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; storefront: PublishedStorefront }
  | { status: "error"; message: string };

type StorefrontValue = {
  status: LoadState["status"];
  error: string | null;
  /** Published presentation settings; drafts are never served here. */
  storefront: PublishedStorefront | null;
  brandName: string;
  mediaById: ReadonlyMap<string, MediaAsset>;
  reload: () => void;
};

const StorefrontContext = createContext<StorefrontValue | null>(null);

function describeStorefrontError(error: unknown) {
  if (error instanceof StorefrontFormatError) return `${error.message} Try again later.`;
  return describeApiError(error, "Storefront content could not be loaded.");
}

/** Applies the published theme to the document; nothing is cached in browser storage. */
function usePublishedTheme(storefront: PublishedStorefront | null) {
  useEffect(() => {
    if (!storefront) return;
    const root = document.documentElement.style;
    const variables = themeVariables(storefront.settings.theme);
    for (const [name, value] of Object.entries(variables)) root.setProperty(name, value);
    ensureFontStylesheet(storefront.settings.theme.fontId);
    return () => {
      for (const name of Object.keys(variables)) root.removeProperty(name);
    };
  }, [storefront]);
}

export function StorefrontProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => {
    setState((current) => (current.status === "error" ? { status: "loading" } : current));
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let current = true;
    catalogAPI.getStorefront()
      .then(({ data }) => {
        const storefront = parsePublishedStorefront(data);
        if (current) setState({ status: "ready", storefront });
      })
      .catch((error: unknown) => {
        if (current) setState({ status: "error", message: describeStorefrontError(error) });
      });
    return () => { current = false; };
  }, [attempt]);

  const storefront = state.status === "ready" ? state.storefront : null;
  usePublishedTheme(storefront);
  const brandName = storefront?.settings.brand.name || DEFAULT_BRAND_NAME;

  useEffect(() => {
    document.title = brandName;
  }, [brandName]);

  const value = useMemo<StorefrontValue>(() => ({
    status: state.status,
    error: state.status === "error" ? state.message : null,
    storefront,
    brandName,
    mediaById: new Map((storefront?.media ?? []).map((asset) => [asset.id, asset])),
    reload,
  }), [state, storefront, brandName, reload]);

  return <StorefrontContext.Provider value={value}>{children}</StorefrontContext.Provider>;
}

export function useStorefront() {
  const context = useContext(StorefrontContext);
  if (!context) throw new Error("useStorefront must be used within StorefrontProvider");
  return context;
}
