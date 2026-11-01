import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { catalogAdminAPI, type CatalogSnapshot, type CatalogStock } from "../../api/catalog";
import { apiStatus } from "../../api/errors";
import { StaffSessionRequiredError } from "../../api/staffSession";
import { describeCatalogError } from "../../store/CatalogContext";
import { buildCategoryTree, parseCatalogSnapshot, CatalogFormatError, type CategoryTree } from "../../store/catalogModel";
import { isRecord } from "../../utils/storage";

type AdminCatalogData = { snapshot: CatalogSnapshot; stocks: CatalogStock[] };

type AdminCatalogValue = {
  status: "loading" | "ready" | "error";
  /** Last loaded staff snapshot; kept visible if a later refresh fails. */
  data: AdminCatalogData | null;
  categories: CategoryTree;
  error: string | null;
  /** The staff credentials were rejected; signing in again is the only fix. */
  sessionExpired: boolean;
  refreshing: boolean;
  reload: () => void;
};

const STOCK_STATUSES = ["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"];

function isStock(value: unknown): value is CatalogStock {
  return isRecord(value) && ["id", "variantId", "sku", "productId", "productName", "categoryId"].every((key) => typeof value[key] === "string") &&
    isRecord(value.attributes) && typeof value.isDemo === "boolean" && STOCK_STATUSES.includes(String(value.status)) &&
    ["quantity", "reserved", "available", "maxStock", "minThreshold"].every((key) => typeof value[key] === "number");
}

function parseStocks(data: unknown): CatalogStock[] {
  if (!isRecord(data) || !Array.isArray(data.stocks) || !data.stocks.every(isStock)) throw new CatalogFormatError("stock");
  return data.stocks;
}

const AdminCatalogContext = createContext<AdminCatalogValue | null>(null);

export function AdminCatalogProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AdminCatalogData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => {
    setRefreshing(true);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let current = true;
    Promise.all([catalogAdminAPI.getSnapshot(), catalogAdminAPI.getStock()])
      .then(([snapshot, stock]) => {
        const next = { snapshot: parseCatalogSnapshot(snapshot.data, ["admin"]), stocks: parseStocks(stock.data) };
        if (!current) return;
        setData(next);
        setError(null);
        setSessionExpired(false);
      })
      .catch((reason: unknown) => {
        if (!current) return;
        setError(describeCatalogError(reason));
        setSessionExpired(reason instanceof StaffSessionRequiredError || apiStatus(reason) === 401);
      })
      .finally(() => { if (current) setRefreshing(false); });
    return () => { current = false; };
  }, [attempt]);

  const categories = useMemo(() => buildCategoryTree(data?.snapshot.categories ?? []), [data]);
  const value = useMemo<AdminCatalogValue>(() => ({
    status: data ? "ready" : error ? "error" : "loading",
    data,
    categories,
    error,
    sessionExpired,
    refreshing,
    reload,
  }), [data, categories, error, sessionExpired, refreshing, reload]);

  return <AdminCatalogContext.Provider value={value}>{children}</AdminCatalogContext.Provider>;
}

export function useAdminCatalog() {
  const context = useContext(AdminCatalogContext);
  if (!context) throw new Error("useAdminCatalog must be used within AdminCatalogProvider");
  return context;
}
