import { useMemo, useState } from "react";
import { BULK_STOCK_LIMIT, catalogAdminAPI, type CatalogStock } from "../../api/catalog";
import { describeApiError } from "../../api/errors";
import { ConfirmModal } from "../../components/Modal";
import { describeVariant } from "../../store/catalogModel";
import { useAdminCatalog } from "./AdminCatalogContext";
import { Feedback, Panel, categoryOptions, descendantIds, inputClass, smallButtonClass } from "./shared";

const ROW_LIMIT = 100;
const STATUSES: CatalogStock["status"][] = ["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"];
const STATUS_STYLES: Record<CatalogStock["status"], { cls: string; label: string }> = {
  IN_STOCK: { cls: "text-success", label: "In stock" },
  LOW_STOCK: { cls: "text-warning", label: "Low stock" },
  OUT_OF_STOCK: { cls: "text-error", label: "Out of stock" },
};

type BulkOperation = { op: "add" | "sub"; amount: number; rows: CatalogStock[] };

export function StockManager({ showToast }: { showToast: (message: string) => void }) {
  const { data, categories, reload } = useAdminCatalog();
  const stocks = useMemo(() => data?.stocks ?? [], [data]);
  const options = useMemo(() => categoryOptions(categories), [categories]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | CatalogStock["status"]>("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [bulkAmount, setBulkAmount] = useState(10);
  const [confirmBulk, setConfirmBulk] = useState<BulkOperation | null>(null);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const scope = categoryId ? new Set([categoryId, ...descendantIds(categories, categoryId)]) : null;
    return stocks.filter((row) =>
      (!term || row.productName.toLowerCase().includes(term) || row.sku.toLowerCase().includes(term)) &&
      (!scope || scope.has(row.categoryId)) &&
      (!statusFilter || row.status === statusFilter));
  }, [stocks, search, categoryId, statusFilter, categories]);

  const save = async (row: CatalogStock, quantity: number) => {
    setSaving(row.variantId);
    setError("");
    try {
      await catalogAdminAPI.updateStock(row.variantId, { quantity });
      setDrafts(({ [row.variantId]: _saved, ...rest }) => rest);
      showToast(`Stock saved for ${row.sku}`);
      reload();
    } catch (reason) {
      setError(describeApiError(reason, `Stock for ${row.sku} could not be saved.`));
    } finally {
      setSaving("");
    }
  };

  const runBulk = async (operation: BulkOperation) => {
    setConfirmBulk(null);
    setSaving("bulk");
    setError("");
    // On-hand units can never fall below those reserved for unpaid orders; the API rejects that.
    const updates = operation.rows.map((row) => ({
      variantId: row.variantId,
      quantity: operation.op === "add" ? row.quantity + operation.amount : Math.max(row.reserved, row.quantity - operation.amount),
    }));
    let saved = 0;
    try {
      for (let start = 0; start < updates.length; start += BULK_STOCK_LIMIT) {
        const { data: result } = await catalogAdminAPI.bulkUpdateStock(updates.slice(start, start + BULK_STOCK_LIMIT));
        saved += result.updated;
      }
      showToast(`Stock updated for ${saved} SKUs`);
    } catch (reason) {
      setError(`${describeApiError(reason, "The bulk stock update failed.")} ${saved} of ${updates.length} SKUs were saved before the failure; the failed batch was not applied.`);
    } finally {
      setSaving("");
      reload();
    }
  };

  return (
    <Panel
      title="Stock by SKU"
      description="Stock is tracked for each sellable variant. On hand includes units reserved for unpaid orders; only available units can be sold. Saving writes to the catalog immediately; demo SKUs hold sample quantities only."
    >
      <div className="mb-5 grid gap-3 lg:grid-cols-[1fr_220px_160px]">
        <input aria-label="Search stock" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by product or SKU…" className={inputClass} />
        <select aria-label="Filter stock by category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={inputClass}>
          <option value="">All categories</option>
          {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <select aria-label="Filter stock by status" value={statusFilter} onChange={(event) => setStatusFilter(STATUSES.find((status) => status === event.target.value) ?? "")} className={inputClass}>
          <option value="">All statuses</option>
          {STATUSES.map((status) => <option key={status} value={status}>{STATUS_STYLES[status].label}</option>)}
        </select>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-md bg-off-white p-3 text-xs">
        <span className="font-semibold text-brand-primary">Bulk change for the {filtered.length} filtered SKUs:</span>
        <input type="number" min={1} aria-label="Bulk quantity" value={bulkAmount} onChange={(event) => setBulkAmount(Number(event.target.value))} className="w-20 rounded-sm border border-light-gray px-2 py-1.5 text-xs" />
        <button type="button" disabled={!filtered.length || !(bulkAmount > 0) || saving === "bulk"} onClick={() => setConfirmBulk({ op: "add", amount: bulkAmount, rows: filtered })} className={smallButtonClass}>Add</button>
        <button type="button" disabled={!filtered.length || !(bulkAmount > 0) || saving === "bulk"} onClick={() => setConfirmBulk({ op: "sub", amount: bulkAmount, rows: filtered })} className={smallButtonClass}>Subtract</button>
      </div>

      <Feedback message={error} tone="error" />

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-light-gray text-left text-[10px] font-bold uppercase tracking-widest text-gray-600">
              <th className="py-2.5">Product / SKU</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Max</th><th>Low at</th><th>Status</th><th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, ROW_LIMIT).map((row) => {
              const style = STATUS_STYLES[row.status];
              const draft = drafts[row.variantId];
              const value = draft ?? String(row.quantity);
              const parsed = Number(value);
              const valid = value.trim() !== "" && Number.isInteger(parsed) && parsed >= row.reserved;
              const options = describeVariant(row);
              return (
                <tr key={row.variantId} className="border-b border-light-gray/60 align-top">
                  <td className="py-2.5 pr-2">
                    <p className="font-medium text-brand-primary">
                      {row.productName}
                      {row.isDemo && <span className="ml-1.5 rounded-sm bg-ocean-blue/15 px-1 text-[9px] font-bold uppercase text-ocean-blue">Demo</span>}
                    </p>
                    <p className="text-[11px] text-gray-500">{row.sku}{options ? ` · ${options}` : ""}</p>
                  </td>
                  <td>
                    <input
                      type="number"
                      min={row.reserved}
                      aria-label={`On-hand quantity for ${row.sku}`}
                      aria-invalid={draft !== undefined && !valid}
                      value={value}
                      onChange={(event) => setDrafts((all) => ({ ...all, [row.variantId]: event.target.value }))}
                      className="w-20 rounded-sm border border-light-gray px-2 py-1"
                    />
                    {draft !== undefined && !valid && <p className="mt-1 text-[10px] font-semibold text-error">Whole number, at least {row.reserved}</p>}
                  </td>
                  <td className="text-gray-600">{row.reserved}</td>
                  <td className="text-gray-600">{row.available}</td>
                  <td className="text-gray-600">{row.maxStock}</td>
                  <td className="text-gray-600">{row.minThreshold}</td>
                  <td className={`whitespace-nowrap font-semibold ${style.cls}`}>{style.label}</td>
                  <td className="space-x-1 whitespace-nowrap text-right">
                    <button type="button" disabled={draft === undefined || !valid || saving === row.variantId} onClick={() => void save(row, parsed)} className={smallButtonClass}>Save</button>
                    <button type="button" disabled={saving === row.variantId || row.quantity === row.maxStock || row.maxStock < row.reserved} onClick={() => void save(row, row.maxStock)} className={smallButtonClass}>Restock to max</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!filtered.length && <p className="py-8 text-center text-sm text-gray-500">No SKUs match these filters.</p>}
        {filtered.length > ROW_LIMIT && (
          <p className="mt-3 text-xs text-gray-600">Showing the first {ROW_LIMIT} of {filtered.length} SKUs. Narrow the filters to see the rest.</p>
        )}
      </div>

      <ConfirmModal
        open={Boolean(confirmBulk)}
        title="Apply bulk stock change?"
        message={confirmBulk ? `${confirmBulk.op === "add" ? "Add" : "Subtract"} ${confirmBulk.amount} ${confirmBulk.op === "add" ? "to" : "from"} ${confirmBulk.rows.length} SKUs' on-hand stock. On-hand quantities never drop below their reserved units.` : undefined}
        confirmLabel="Apply"
        onConfirm={() => { if (confirmBulk) void runBulk(confirmBulk); }}
        onCancel={() => setConfirmBulk(null)}
      />
    </Panel>
  );
}
