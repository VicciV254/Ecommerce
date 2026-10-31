import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  catalogAPI,
  type CatalogDesigner,
  type CatalogDiscount,
  type CatalogProduct,
  type CatalogSnapshot,
  type CatalogVariant,
} from "../api/catalog";
import { describeApiError } from "../api/errors";
import {
  CatalogFormatError,
  buildCategoryTree,
  parseCatalogSnapshot,
  productPriceView,
  variantPriceView,
  type CategoryTree,
  type PriceView,
} from "./catalogModel";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; snapshot: CatalogSnapshot }
  | { status: "error"; message: string };

export type CatalogValue = {
  status: LoadState["status"];
  /** Actionable message when the snapshot could not be loaded. */
  error: string | null;
  mode: CatalogSnapshot["mode"] | null;
  products: CatalogProduct[];
  productsById: ReadonlyMap<string, CatalogProduct>;
  categories: CategoryTree;
  designers: CatalogDesigner[];
  discounts: CatalogDiscount[];
  reload: () => void;
  /** Card price: lowest active SKU with the single best percentage preview. */
  priceOf: (product: CatalogProduct) => PriceView;
  /** Selected-SKU price with the same preview rules. */
  priceOfVariant: (product: CatalogProduct, variant: CatalogVariant) => PriceView;
};

const EMPTY: CatalogSnapshot = { version: 2, mode: "live", products: [], categories: [], designers: [], discounts: [] };

const CatalogContext = createContext<CatalogValue | null>(null);

export function describeCatalogError(error: unknown) {
  if (error instanceof CatalogFormatError) return `${error.message} Try again later.`;
  return describeApiError(error, "The catalog could not be loaded.");
}

function useCatalogValue(state: LoadState, reload: () => void): CatalogValue {
  const snapshot = state.status === "ready" ? state.snapshot : EMPTY;
  const categories = useMemo(() => buildCategoryTree(snapshot.categories), [snapshot.categories]);
  const productsById = useMemo(() => new Map(snapshot.products.map((product) => [product.id, product])), [snapshot.products]);
  return useMemo<CatalogValue>(() => ({
    status: state.status,
    error: state.status === "error" ? state.message : null,
    mode: state.status === "ready" ? snapshot.mode : null,
    products: snapshot.products,
    productsById,
    categories,
    designers: snapshot.designers,
    discounts: snapshot.discounts,
    reload,
    priceOf: (product) => productPriceView(product, snapshot.discounts, new Date()),
    priceOfVariant: (product, variant) => variantPriceView(product, variant, snapshot.discounts, new Date()),
  }), [state, snapshot, productsById, categories, reload]);
}

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let current = true;
    catalogAPI.getSnapshot()
      .then(({ data }) => {
        const snapshot = parseCatalogSnapshot(data, ["live", "demo"]);
        if (current) setState({ status: "ready", snapshot });
      })
      .catch((error: unknown) => {
        if (current) setState({ status: "error", message: describeCatalogError(error) });
      });
    return () => { current = false; };
  }, [attempt]);

  const value = useCatalogValue(state, reload);
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog() {
  const context = useContext(CatalogContext);
  if (!context) throw new Error("useCatalog must be used within CatalogProvider");
  return context;
}
