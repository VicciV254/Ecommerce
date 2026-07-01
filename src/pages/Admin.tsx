import { useEffect, useMemo, useState } from "react";
import { CATEGORIES, PRODUCTS, stockStatus, type Product } from "../data/products";
import { Container } from "../components/ui";
import {
  formatKES,
  useStore,
  isDiscountActive,
  discountAppliesTo,
  type Discount,
} from "../store/StoreContext";
import { useAdminDraft } from "../store/useAdminDraft";
import { ConfirmModal, Toast } from "../components/Modal";
import { navigate } from "../router";
import { useCustomize, FONT_OPTIONS, COLOR_PRESETS, COLOR_SLOT_LEGEND } from "../store/CustomizeContext";

const TABS = ["Dashboard", "Discounts", "Stock", "Catalog", "Customize", "Orders", "Analytics"] as const;

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function Admin() {
  const { state, commitAdmin } = useStore();
  const draftApi = useAdminDraft(state.admin);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Dashboard");

  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [toast, setToast] = useState("");

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(""), 2500);
  };

  const doSave = () => {
    commitAdmin(draftApi.draft);
    draftApi.markSaved();
    setConfirmSave(false);
    showToast("Changes saved successfully");
  };

  const tryExit = () => {
    if (draftApi.dirty) setConfirmExit(true);
    else navigate("/");
  };

  // Products reflecting DRAFT stock (so admin sees pending edits)
  const draftProducts = PRODUCTS.map((p) => ({
    ...p,
    stock: draftApi.draft.stock[p.id] ?? p.stock,
  }));

  const lowStock = draftProducts.filter((p) => stockStatus(p.stock) === "low");
  const outStock = draftProducts.filter((p) => stockStatus(p.stock) === "out");
  const inventoryValue = draftProducts.reduce((s, p) => s + p.price * p.stock, 0);
  const activeDiscounts = draftApi.draft.discounts.filter((d) => isDiscountActive(d));

  const catTotals = useMemo(() => {
    return CATEGORIES.map((c) => {
      const items = draftProducts.filter((p) => p.categorySlug === c.slug);
      const value = items.reduce((s, p) => s + p.price * p.stock, 0);
      return { ...c, value };
    }).sort((a, b) => b.value - a.value);
  }, [draftProducts]);
  const maxCatValue = Math.max(...catTotals.map((c) => c.value), 1);

  return (
    <div className="min-h-screen bg-off-white text-brand-primary">
      {/* Top bar */}
      <div className="sticky top-0 z-40 bg-brand-primary py-4">
        <Container className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-brand-secondary text-xs font-bold text-brand-primary">NM</div>
            <h1 className="font-display text-lg tracking-wider text-white">Admin Dashboard</h1>
            {draftApi.dirty && (
              <span className="rounded-full bg-warning/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning">
                Unsaved changes
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Undo / Redo */}
            <button
              onClick={draftApi.undo}
              disabled={!draftApi.canUndo}
              title="Undo"
              className="flex h-8 w-8 items-center justify-center rounded-sm bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-30"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4"><path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" /></svg>
            </button>
            <button
              onClick={draftApi.redo}
              disabled={!draftApi.canRedo}
              title="Redo"
              className="flex h-8 w-8 items-center justify-center rounded-sm bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-30"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4"><path strokeLinecap="round" strokeLinejoin="round" d="m15 15 6-6m0 0-6-6m6 6H9a6 6 0 0 0 0 12h3" /></svg>
            </button>

            {/* Save */}
            <button
              onClick={() => setConfirmSave(true)}
              disabled={!draftApi.dirty}
              className="rounded-sm bg-brand-secondary px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-primary transition-all hover:bg-white disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/40"
            >
              Save Changes
            </button>

            <button onClick={tryExit} className="ml-1 text-[10px] font-bold uppercase tracking-widest text-white/60 hover:text-white">
              ← Exit
            </button>
          </div>
        </Container>
      </div>

      <Container className="py-6">
        <div className="no-scrollbar mb-6 flex gap-0.5 border-b border-light-gray">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`whitespace-nowrap px-4 py-3 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors ${
                tab === t ? "border-b-2 border-brand-primary text-brand-primary" : "text-gray-400 hover:text-charcoal"
              }`}
            >
              {t}
              {t === "Discounts" && activeDiscounts.length > 0 && (
                <span className="ml-1.5 rounded-full bg-success px-1.5 py-0.5 text-[9px] text-white">{activeDiscounts.length}</span>
              )}
            </button>
          ))}
        </div>

        {(tab === "Dashboard" || tab === "Analytics") && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {[
                ["Products", PRODUCTS.length.toLocaleString(), "bg-ocean-blue"],
                ["Active Discounts", activeDiscounts.length.toString(), "bg-coral"],
                ["Revenue", "KES 14.5M", "bg-brand-secondary"],
                ["Low Stock", lowStock.length.toString(), "bg-warning"],
                ["Out of Stock", outStock.length.toString(), "bg-error"],
              ].map(([label, val, bg]) => (
                <div key={label} className="rounded-lg bg-white p-5 shadow-sm">
                  <div className={`mb-2 h-1 w-8 rounded-full ${bg}`} />
                  <p className="font-display text-2xl text-brand-primary">{val}</p>
                  <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">{label}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div className="rounded-lg bg-white p-6 shadow-sm">
                <h3 className="mb-5 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Inventory Value by Category</h3>
                <div className="space-y-3">
                  {catTotals.map((c) => (
                    <div key={c.slug}>
                      <div className="mb-1 flex justify-between text-xs">
                        <span className="text-charcoal">{c.name}</span>
                        <span className="font-medium text-brand-primary">{formatKES(c.value)}</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-off-white">
                        <div className="h-full rounded-full bg-brand-secondary transition-all" style={{ width: `${(c.value / maxCatValue) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-5 border-t border-light-gray pt-3 text-xs text-gray-500">
                  Total Inventory Value: <strong className="text-brand-primary">{formatKES(inventoryValue)}</strong>
                </p>
              </div>

              <div className="rounded-lg bg-white p-6 shadow-sm">
                <h3 className="mb-4 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Low Stock Alerts ({lowStock.length})</h3>
                <ul className="space-y-2 text-xs">
                  {lowStock.slice(0, 8).map((p) => (
                    <li key={p.id} className="flex justify-between">
                      <span className="text-charcoal">{p.name}</span>
                      <span className="font-semibold text-warning">{p.stock} left</span>
                    </li>
                  ))}
                  {lowStock.length === 0 && <li className="text-gray-400">No low stock items.</li>}
                </ul>
              </div>
            </div>
          </>
        )}

        {tab === "Discounts" && <DiscountManager draftApi={draftApi} />}
        {tab === "Stock" && <StockManager draftApi={draftApi} />}
        {tab === "Catalog" && <CatalogManager draftApi={draftApi} />}
        {tab === "Customize" && <CustomizePanel />}

        {tab === "Orders" && (
          <div className="rounded-lg bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Recent Orders</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-light-gray text-left text-[10px] font-bold uppercase tracking-[0.1em] text-gray-400">
                    <th className="py-2.5">Order #</th><th>Customer</th><th>Total</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["NM-2026-001234", "Jane M.", "KES 31,668", "Delivered", "text-success"],
                    ["NM-2026-001235", "David O.", "KES 12,500", "Shipped", "text-ocean-blue"],
                    ["NM-2026-001236", "Aisha K.", "KES 6,800", "Processing", "text-warning"],
                  ].map(([no, cust, total, status, cls]) => (
                    <tr key={no} className="border-b border-light-gray/60">
                      <td className="py-3 font-medium text-brand-primary">{no}</td>
                      <td>{cust}</td><td>{total}</td>
                      <td className={`font-semibold ${cls}`}>{status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Container>

      {/* Save confirmation */}
      <ConfirmModal
        open={confirmSave}
        title="Save Changes?"
        message="This will publish your stock and discount updates to the live store. Customers will see these changes immediately."
        confirmLabel="Yes, Save"
        onConfirm={doSave}
        onCancel={() => setConfirmSave(false)}
      />

      {/* Exit with unsaved changes */}
      <ConfirmModal
        open={confirmExit}
        title="Discard unsaved changes?"
        message="You have unsaved changes. Leaving now will discard them."
        confirmLabel="Discard & Exit"
        cancelLabel="Keep Editing"
        tone="danger"
        onConfirm={() => { setConfirmExit(false); navigate("/"); }}
        onCancel={() => setConfirmExit(false)}
      />

      <Toast open={!!toast} message={toast} />
    </div>
  );
}

/* ============================================================= */
/* DISCOUNT MANAGER                                              */
/* ============================================================= */
type DraftApi = ReturnType<typeof useAdminDraft>;

function DiscountManager({ draftApi }: { draftApi: DraftApi }) {
  const { draft, addDiscount, updateDiscount, removeDiscount } = draftApi;
  const [confirmStop, setConfirmStop] = useState<string | null>(null);

  // form
  const [scope, setScope] = useState<"all" | "category" | "products">("category");
  const [categorySlug, setCategorySlug] = useState(CATEGORIES[0].slug);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [percent, setPercent] = useState(10);
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO(7));
  const [search, setSearch] = useState("");
  const [confirmAdd, setConfirmAdd] = useState(false);

  const filteredForPick = PRODUCTS.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const resetForm = () => {
    setSelectedProducts([]);
    setPercent(10);
    setStartDate(todayISO());
    setEndDate(todayISO(7));
    setSearch("");
  };

  const handleCreate = () => {
    const name =
      scope === "all"
        ? "All Products Sale"
        : scope === "category"
        ? `${CATEGORIES.find((c) => c.slug === categorySlug)?.name} Sale`
        : `${selectedProducts.length} Item Sale`;
    const d: Discount = {
      id: "disc-" + Date.now(),
      name,
      scope,
      categorySlug: scope === "category" ? categorySlug : undefined,
      productIds: scope === "products" ? selectedProducts : [],
      percent,
      startDate,
      endDate,
    };
    addDiscount(d);
    setConfirmAdd(false);
    resetForm();
  };

  const canCreate = percent > 0 && (scope !== "products" || selectedProducts.length > 0);

  const countAffected = (d: Discount) => {
    if (d.scope === "all") return PRODUCTS.length;
    return PRODUCTS.filter((p) => discountAppliesTo(d, p)).length;
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
      {/* ---- Create form ---- */}
      <div className="h-fit rounded-lg bg-white p-6 shadow-sm">
        <h3 className="mb-5 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Create Discount</h3>

        {/* Scope */}
        <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Apply To</label>
        <div className="mb-4 grid grid-cols-3 gap-1">
          {([["all", "All"], ["category", "Category"], ["products", "Products"]] as const).map(([v, l]) => (
            <button
              key={v}
              onClick={() => setScope(v)}
              className={`rounded-sm border py-2 text-[11px] font-bold ${scope === v ? "border-brand-primary bg-brand-primary text-white" : "border-light-gray text-gray-400"}`}
            >
              {l}
            </button>
          ))}
        </div>

        {scope === "category" && (
          <div className="mb-4">
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Category</label>
            <select
              value={categorySlug}
              onChange={(e) => setCategorySlug(e.target.value)}
              className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2.5 text-sm outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c.slug} value={c.slug}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {scope === "products" && (
          <div className="mb-4">
            <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-gray-400">
              Pick Products ({selectedProducts.length} selected)
            </label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products…"
              className="mb-2 w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-xs outline-none"
            />
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-sm border border-light-gray p-2">
              {filteredForPick.slice(0, 60).map((p) => {
                const checked = selectedProducts.includes(p.id);
                return (
                  <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-xs hover:bg-off-white">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelectedProducts((arr) =>
                          checked ? arr.filter((x) => x !== p.id) : [...arr, p.id]
                        )
                      }
                      className="h-3.5 w-3.5 accent-brand-secondary"
                    />
                    <img src={p.image} alt="" className="h-6 w-6 rounded-sm object-cover" />
                    <span className="flex-1 truncate text-charcoal">{p.name}</span>
                    <span className="text-gray-400">{formatKES(p.price)}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Percent */}
        <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Discount %</label>
        <div className="mb-2 flex gap-1">
          {[5, 10, 15, 20, 25, 50].map((v) => (
            <button
              key={v}
              onClick={() => setPercent(v)}
              className={`flex-1 rounded-sm border py-1.5 text-[11px] font-bold ${percent === v ? "border-brand-primary bg-brand-primary text-white" : "border-light-gray text-gray-400"}`}
            >
              {v}%
            </button>
          ))}
        </div>
        <input
          type="number"
          value={percent}
          min={1}
          max={90}
          onChange={(e) => setPercent(Number(e.target.value))}
          className="mb-4 w-full rounded-sm border border-light-gray bg-off-white px-3 py-2.5 text-sm outline-none"
          placeholder="Custom %"
        />

        {/* Duration */}
        <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Duration</label>
        <div className="mb-5 grid grid-cols-2 gap-2">
          <div>
            <span className="mb-1 block text-[9px] uppercase text-gray-400">Start</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-sm border border-light-gray bg-off-white px-2 py-2 text-xs outline-none" />
          </div>
          <div>
            <span className="mb-1 block text-[9px] uppercase text-gray-400">End</span>
            <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded-sm border border-light-gray bg-off-white px-2 py-2 text-xs outline-none" />
          </div>
        </div>

        <button
          onClick={() => setConfirmAdd(true)}
          disabled={!canCreate}
          className="w-full rounded-sm bg-brand-primary py-3 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-brand-secondary hover:text-brand-primary disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
        >
          Add Discount
        </button>
        <p className="mt-2 text-center text-[10px] text-gray-400">Remember to click <strong>Save Changes</strong> at the top to publish.</p>
      </div>

      {/* ---- Active / scheduled discounts list ---- */}
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">
          Current Discounts ({draft.discounts.length})
        </h3>

        {draft.discounts.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            No discounts yet. Create one using the form on the left.
          </div>
        ) : (
          <div className="space-y-3">
            {draft.discounts.map((d) => {
              const active = isDiscountActive(d);
              return (
                <div key={d.id} className="rounded-md border border-light-gray p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-brand-primary">{d.name}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${active ? "bg-success/15 text-success" : "bg-gray-100 text-gray-400"}`}>
                          {active ? "Active" : "Scheduled / Ended"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-400">
                        {countAffected(d)} products · {d.startDate} → {d.endDate}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="font-display text-2xl text-coral">{d.percent}%</span>
                      <span className="block text-[9px] uppercase tracking-wider text-gray-400">off</span>
                    </div>
                  </div>

                  {/* Inline editing */}
                  <div className="mt-3 grid gap-2 border-t border-light-gray pt-3 sm:grid-cols-3">
                    <div>
                      <span className="mb-1 block text-[9px] uppercase text-gray-400">Percentage</span>
                      <input
                        type="number"
                        value={d.percent}
                        min={1}
                        max={90}
                        onChange={(e) => updateDiscount(d.id, { percent: Number(e.target.value) })}
                        className="w-full rounded-sm border border-light-gray bg-off-white px-2 py-1.5 text-xs outline-none"
                      />
                    </div>
                    <div>
                      <span className="mb-1 block text-[9px] uppercase text-gray-400">Extend End Date</span>
                      <input
                        type="date"
                        value={d.endDate}
                        min={d.startDate}
                        onChange={(e) => updateDiscount(d.id, { endDate: e.target.value })}
                        className="w-full rounded-sm border border-light-gray bg-off-white px-2 py-1.5 text-xs outline-none"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        onClick={() => setConfirmStop(d.id)}
                        className="w-full rounded-sm border border-error/40 py-1.5 text-[10px] font-bold uppercase tracking-wider text-error transition-colors hover:bg-error hover:text-white"
                      >
                        Stop Discount
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add confirm */}
      <ConfirmModal
        open={confirmAdd}
        title="Add this discount?"
        message={`A ${percent}% discount will be created. Don't forget to Save Changes to make it live.`}
        confirmLabel="Add Discount"
        onConfirm={handleCreate}
        onCancel={() => setConfirmAdd(false)}
      />

      {/* Stop confirm */}
      <ConfirmModal
        open={!!confirmStop}
        title="Stop this discount?"
        message="This will permanently remove the discount from the draft."
        confirmLabel="Stop Discount"
        tone="danger"
        onConfirm={() => { if (confirmStop) removeDiscount(confirmStop); setConfirmStop(null); }}
        onCancel={() => setConfirmStop(null)}
      />
    </div>
  );
}

/* ============================================================= */
/* STOCK MANAGER                                                */
/* ============================================================= */
function StockManager({ draftApi }: { draftApi: DraftApi }) {
  const { draft, setStock, bulkStock } = draftApi;
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [bulkVal, setBulkVal] = useState(50);
  const [confirmBulk, setConfirmBulk] = useState<null | { ids: string[]; op: "add" | "sub" | "set"; label: string }>(null);

  const products = PRODUCTS.map((p) => ({ ...p, stock: draft.stock[p.id] ?? p.stock }));
  const list = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) &&
      (!catFilter || p.categorySlug === catFilter)
  );
  const visibleIds = list.map((p) => p.id);
  const allIds = PRODUCTS.map((p) => p.id);

  const runBulk = () => {
    if (confirmBulk) bulkStock(confirmBulk.ids, confirmBulk.op, bulkVal);
    setConfirmBulk(null);
  };

  return (
    <div className="rounded-lg bg-white p-6 shadow-sm">
      <h3 className="mb-4 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Stock Management</h3>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <div className="flex gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="flex-1 rounded-sm border border-light-gray bg-off-white px-3 py-2 text-xs outline-none"
          />
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="rounded-sm border border-light-gray px-3 py-2 text-xs">
            <option value="">All Categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-md bg-off-white p-3 text-xs">
          <span className="font-semibold text-brand-primary">Bulk:</span>
          <input
            type="number"
            value={bulkVal}
            onChange={(e) => setBulkVal(Number(e.target.value))}
            className="w-16 rounded-sm border border-light-gray px-2 py-1.5 text-xs"
          />
          <button onClick={() => setConfirmBulk({ ids: visibleIds, op: "add", label: `Add ${bulkVal} to ${visibleIds.length} filtered products` })} className="rounded-sm bg-success px-3 py-1.5 font-semibold text-white">Add (filtered)</button>
          <button onClick={() => setConfirmBulk({ ids: visibleIds, op: "sub", label: `Subtract ${bulkVal} from ${visibleIds.length} filtered products` })} className="rounded-sm bg-warning px-3 py-1.5 font-semibold text-white">Subtract</button>
          <button onClick={() => setConfirmBulk({ ids: allIds, op: "add", label: `Add ${bulkVal} to ALL ${allIds.length} products` })} className="rounded-sm bg-brand-primary px-3 py-1.5 font-semibold text-white">Add to ALL</button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-light-gray text-left text-[10px] font-bold uppercase tracking-[0.1em] text-gray-400">
              <th className="py-2.5">Product</th><th>Stock</th><th>Max</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 50).map((p) => {
              const s = stockStatus(p.stock);
              const dot = s === "in" ? "text-success" : s === "low" ? "text-warning" : "text-error";
              return (
                <tr key={p.id} className="border-b border-light-gray/50">
                  <td className="py-2.5 pr-2">
                    <div className="flex items-center gap-2">
                      <img src={p.image} alt="" className="h-7 w-7 rounded-sm object-cover" />
                      <span className="font-medium text-brand-primary">{p.name}</span>
                    </div>
                  </td>
                  <td>
                    <input
                      type="number"
                      value={p.stock}
                      onChange={(e) => setStock(p.id, Number(e.target.value))}
                      className="w-16 rounded-sm border border-light-gray px-2 py-1"
                    />
                  </td>
                  <td className="text-gray-400">{p.maxStock}</td>
                  <td className={`whitespace-nowrap font-semibold ${dot}`}>● {s.toUpperCase()}</td>
                  <td>
                    <button onClick={() => setStock(p.id, p.maxStock)} className="rounded-sm bg-brand-primary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary">Restock</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[10px] text-gray-400">Edits update the draft. Click <strong>Save Changes</strong> at the top to publish.</p>

      <ConfirmModal
        open={!!confirmBulk}
        title="Apply bulk update?"
        message={confirmBulk?.label}
        confirmLabel="Apply"
        onConfirm={runBulk}
        onCancel={() => setConfirmBulk(null)}
      />
    </div>
  );
}

/* ============================================================= */
/* CATALOG MANAGER — tags + add/remove products                  */
/* ============================================================= */
function CatalogManager({ draftApi }: { draftApi: DraftApi }) {
  const { draft, addProduct, removeProduct, editProduct, addCategory, addDesigner, removeCategory, removeDesigner } = draftApi;
  const { allCategories, allDesigners } = useStore();

  const [catFilter, setCatFilter] = useState("mens-fashion");
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Merge base + custom + overrides
  const merged: Product[] = [...PRODUCTS, ...draft.customProducts].map((p) => {
    const ov = draft.productOverrides[p.id];
    const tagOv = draft.tagOverrides[p.id];
    let next = p;
    if (ov) next = { ...next, ...ov };
    if (tagOv) next = { ...next, tags: tagOv };
    return next;
  });

  const list = merged.filter(
    (p) => p.categorySlug === catFilter && p.name.toLowerCase().includes(search.toLowerCase())
  );

  /* ---- Add product form ---- */
  const [form, setForm] = useState({
    name: "", category: "mens-fashion", price: "", designerId: "", overview: "",
    d1: "", d2: "", d3: "", d4: "", tags: "",
  });
  const [confirmAdd, setConfirmAdd] = useState(false);
  const canAdd = form.name.trim() && Number(form.price) > 0 && form.overview.trim();

  const doAddProduct = () => {
    const cat = allCategories.find((c) => c.slug === form.category)!;
    const overview = form.overview.trim();
    const gallery = [form.d1, form.d2, form.d3, form.d4].map((s) => s.trim()).filter(Boolean);
    while (gallery.length < 3) gallery.push(overview);
    const id = `custom-${Date.now()}`;
    const p: Product = {
      id, name: form.name.trim(), price: Number(form.price),
      category: cat.name, categorySlug: cat.slug,
      stock: 50, maxStock: 100, rating: 5, reviews: 0,
      image: overview, main_image: overview, gallery_images: gallery.slice(0, 3),
      description: "Added via Admin. Quality you can trust from No Maneno Bazaar — IKO KITU!",
      tags: form.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
      designerId: form.designerId || undefined,
      custom: true,
    };
    addProduct(p);
    setConfirmAdd(false);
    setForm({ ...form, name: "", price: "", overview: "", d1: "", d2: "", d3: "", d4: "", tags: "" });
  };

  /* ---- Add category / designer ---- */
  const [newCat, setNewCat] = useState({ name: "", image: "" });
  const [newDesigner, setNewDesigner] = useState({
    id: "", name: "", specialty: "", location: "Mombasa", image: "",
    spotlightTitle: "", spotlightText: "",
  });
  const [addCatOpen, setAddCatOpen] = useState(false);
  const [addDesignerOpen, setAddDesignerOpen] = useState(false);

  const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const newCatValid = !!newCat.name.trim();
  const submitNewCat = () => {
    if (!newCatValid) return;
    const slug = "custom-" + slugify(newCat.name);
    addCategory({
      name: newCat.name.trim(),
      slug,
      image: newCat.image.trim() || "https://images.pexels.com/photos/5556176/pexels-photo-5556176.jpeg?auto=compress&cs=tinysrgb&w=600",
    });
    setNewCat({ name: "", image: "" });
    setAddCatOpen(false);
    setForm((f) => ({ ...f, category: slug }));
  };

  const newDesignerValid =
    !!newDesigner.id.trim() && !!newDesigner.name.trim() && !!newDesigner.specialty.trim();
  const submitNewDesigner = () => {
    if (!newDesignerValid) return;
    const id = slugify(newDesigner.id);
    addDesigner({
      id,
      name: newDesigner.name.trim(),
      specialty: newDesigner.specialty.trim(),
      location: newDesigner.location.trim() || "Mombasa",
      image: newDesigner.image.trim() || "https://images.pexels.com/photos/20453359/pexels-photo-20453359.jpeg?auto=compress&cs=tinysrgb&w=900",
      spotlightTitle: newDesigner.spotlightTitle.trim() || `${newDesigner.name.trim()}: Featured Designer`,
      spotlightText: newDesigner.spotlightText.trim() || `${newDesigner.name.trim()} brings their signature ${newDesigner.specialty.trim().toLowerCase()} to the No Maneno Bazaar showroom.`,
    });
    setNewDesigner({ id: "", name: "", specialty: "", location: "Mombasa", image: "", spotlightTitle: "", spotlightText: "" });
    setAddDesignerOpen(false);
    setForm((f) => ({ ...f, designerId: id }));
  };

  /* ---- Editor navigation ---- */
  const editingProduct = editingId ? merged.find((p) => p.id === editingId) ?? null : null;
  const editingIndex = editingProduct ? list.findIndex((p) => p.id === editingProduct.id) : -1;
  const goPrev = () => { if (editingIndex > 0) setEditingId(list[editingIndex - 1].id); };
  const goNext = () => { if (editingIndex < list.length - 1) setEditingId(list[editingIndex + 1].id); };

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      {/* Add product form */}
      <div className="h-fit rounded-lg bg-white p-6 shadow-sm">
        <h3 className="mb-5 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Add New Product</h3>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Category</label>
              <select value={form.category} onChange={(e) => { if (e.target.value === "__new__") { setAddCatOpen(true); } else { setForm({ ...form, category: e.target.value }); } }} className="w-full rounded-sm border border-light-gray bg-off-white px-2 py-2 text-xs outline-none">
                {allCategories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                <option value="__new__">+ Add new category…</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Price (KES)</label>
              <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Designer</label>
            <select value={form.designerId} onChange={(e) => { if (e.target.value === "__new__") { setAddDesignerOpen(true); } else { setForm({ ...form, designerId: e.target.value }); } }} className="w-full rounded-sm border border-light-gray bg-off-white px-2 py-2 text-xs outline-none">
              <option value="">— None —</option>
              {allDesigners.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              <option value="__new__">+ Add new designer…</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Overview Picture URL</label>
            <input value={form.overview} onChange={(e) => setForm({ ...form, overview: e.target.value })} placeholder="https://..." className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(["d1","d2","d3","d4"] as const).map((k, i) => (
              <div key={k}>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Detail Pic {i + 1}</label>
                <input value={(form as any)[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} placeholder="https://..." className="w-full rounded-sm border border-light-gray bg-off-white px-2 py-2 text-xs outline-none" />
              </div>
            ))}
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Tags (comma separated)</label>
            <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="shirt, cotton, casual" className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none" />
          </div>
          {form.overview && <img src={form.overview} alt="preview" className="h-24 w-24 rounded-sm object-cover" />}
          <button onClick={() => setConfirmAdd(true)} disabled={!canAdd} className="w-full rounded-sm bg-brand-primary py-3 text-xs font-bold uppercase tracking-widest text-white hover:bg-brand-secondary hover:text-brand-primary disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400">Add Product</button>
          <p className="text-center text-[10px] text-gray-400">Click <strong>Save Changes</strong> at the top to publish.</p>
        </div>
      </div>

      {/* Product list — click to edit */}
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Edit Products — Click any product to open the editor</h3>
        <div className="mb-4 flex flex-wrap gap-2">
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="rounded-sm border border-light-gray px-3 py-2 text-xs">
            {allCategories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products…" className="flex-1 rounded-sm border border-light-gray bg-off-white px-3 py-2 text-xs outline-none" />
        </div>

        <div className="grid max-h-[640px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((p) => (
            <button key={p.id} onClick={() => setEditingId(p.id)} className="group flex flex-col overflow-hidden rounded-md border border-light-gray bg-white text-left transition-all hover:border-brand-secondary hover:shadow-md">
              <div className="aspect-square overflow-hidden bg-warm-beige">
                <img src={p.image} alt="" className="h-full w-full object-cover" />
              </div>
              <div className="p-2">
                <p className="truncate text-xs font-medium text-brand-primary">{p.name}</p>
                <p className="text-[10px] text-gray-400">{formatKES(p.price)}</p>
                {p.custom && <span className="mt-0.5 inline-block rounded-sm bg-brand-secondary/20 px-1.5 text-[9px] font-bold uppercase text-brand-accent">New</span>}
              </div>
            </button>
          ))}
          {list.length === 0 && <p className="col-span-full py-10 text-center text-xs text-gray-400">No products match.</p>}
        </div>

        {/* Manage custom categories & designers */}
        {(draft.customCategories.length > 0 || draft.customDesigners.length > 0) && (
          <div className="mt-6 border-t border-light-gray pt-4">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-brand-accent">Manage Custom Items</p>
            {draft.customCategories.length > 0 && (
              <div className="mb-3">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Custom Categories</p>
                <div className="flex flex-wrap gap-2">
                  {draft.customCategories.map((c) => (
                    <span key={c.slug} className="flex items-center gap-1.5 rounded-full border border-light-gray bg-off-white px-3 py-1 text-[11px]">
                      {c.name}
                      <button onClick={() => removeCategory(c.slug)} className="text-gray-400 hover:text-error" title="Delete category">×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {draft.customDesigners.length > 0 && (
              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Custom Designers</p>
                <div className="flex flex-wrap gap-2">
                  {draft.customDesigners.map((d) => (
                    <span key={d.id} className="flex items-center gap-1.5 rounded-full border border-light-gray bg-off-white px-3 py-1 text-[11px]">
                      {d.name}
                      <button onClick={() => removeDesigner(d.id)} className="text-gray-400 hover:text-error" title="Delete designer">×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      <ConfirmModal
        open={confirmAdd}
        title="Add this product?"
        message={`"${form.name}" will be added to ${allCategories.find((c) => c.slug === form.category)?.name}. Remember to Save Changes.`}
        confirmLabel="Add Product"
        onConfirm={doAddProduct}
        onCancel={() => setConfirmAdd(false)}
      />
      <ConfirmModal
        open={!!confirmDelete}
        title="Remove this product?"
        message="This removes the custom product from the draft."
        confirmLabel="Remove"
        tone="danger"
        onConfirm={() => { if (confirmDelete) removeProduct(confirmDelete); setConfirmDelete(null); }}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* Add category modal */}
      <ConfirmModal
        open={addCatOpen}
        title="Create New Category"
        confirmLabel="Create Category"
        confirmDisabled={!newCatValid}
        onConfirm={submitNewCat}
        onCancel={() => { setAddCatOpen(false); setNewCat({ name: "", image: "" }); }}
      >
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Category Name</label>
            <input
              value={newCat.name}
              onChange={(e) => setNewCat((s) => ({ ...s, name: e.target.value }))}
              placeholder="e.g. Traditional Wear"
              className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Header Image URL</label>
            <input
              value={newCat.image}
              onChange={(e) => setNewCat((s) => ({ ...s, image: e.target.value }))}
              placeholder="https://..."
              className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none"
            />
            {newCat.image && (
              <img src={newCat.image} alt="" className="mt-2 h-20 w-20 rounded-sm object-cover" />
            )}
          </div>
        </div>
      </ConfirmModal>

      {/* Add designer modal */}
      <ConfirmModal
        open={addDesignerOpen}
        title="Create New Designer"
        confirmLabel="Create Designer"
        size="lg"
        confirmDisabled={!newDesignerValid}
        onConfirm={submitNewDesigner}
        onCancel={() => {
          setAddDesignerOpen(false);
          setNewDesigner({ id: "", name: "", specialty: "", location: "Mombasa", image: "", spotlightTitle: "", spotlightText: "" });
        }}
      >
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Designer ID (one word)</label>
              <input
                value={newDesigner.id}
                onChange={(e) => setNewDesigner((s) => ({ ...s, id: e.target.value }))}
                placeholder="e.g. amina"
                className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Full Name</label>
              <input
                value={newDesigner.name}
                onChange={(e) => setNewDesigner((s) => ({ ...s, name: e.target.value }))}
                placeholder="e.g. Amina Mohamed"
                className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Specialty</label>
              <input
                value={newDesigner.specialty}
                onChange={(e) => setNewDesigner((s) => ({ ...s, specialty: e.target.value }))}
                placeholder="e.g. Silk Scarves"
                className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Location (optional)</label>
              <input
                value={newDesigner.location}
                onChange={(e) => setNewDesigner((s) => ({ ...s, location: e.target.value }))}
                placeholder="e.g. Mombasa"
                className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Profile Image URL (optional)</label>
            <input
              value={newDesigner.image}
              onChange={(e) => setNewDesigner((s) => ({ ...s, image: e.target.value }))}
              placeholder="https://..."
              className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none"
            />
            {newDesigner.image && (
              <img src={newDesigner.image} alt="" className="mt-2 h-20 w-20 rounded-sm object-cover" />
            )}
          </div>

          <div className="mt-2 rounded-md border border-light-gray/80 bg-off-white p-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-brand-accent">
              Showroom Spotlight
            </p>
            <p className="mb-3 text-[11px] text-gray-500">
              These two fields populate the "Designer Spotlight" card in the Showroom → Designer Collaborations section.
            </p>
            <div className="space-y-2">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Spotlight Heading</label>
                <input
                  value={newDesigner.spotlightTitle}
                  onChange={(e) => setNewDesigner((s) => ({ ...s, spotlightTitle: e.target.value }))}
                  placeholder='e.g. "Amina Designs: Blending Tradition with Modernity"'
                  className="w-full rounded-sm border border-light-gray bg-white px-3 py-2 text-sm outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">Short Description / Paragraph</label>
                <textarea
                  rows={3}
                  value={newDesigner.spotlightText}
                  onChange={(e) => setNewDesigner((s) => ({ ...s, spotlightText: e.target.value }))}
                  placeholder="A short paragraph (2–3 sentences) about the designer — what they're known for, their inspiration, and what they bring to No Maneno Bazaar."
                  className="w-full rounded-sm border border-light-gray bg-white px-3 py-2 text-sm outline-none"
                />
              </div>
            </div>
          </div>
        </div>
      </ConfirmModal>

      {/* Full-screen product editor */}
      {editingProduct && (
        <ProductEditor
          product={editingProduct}
          allProducts={list}
          index={editingIndex}
          allCategories={allCategories}
          allDesigners={allDesigners}
          onPrev={goPrev}
          onNext={goNext}
          onClose={() => setEditingId(null)}
          onSave={(patch) => { editProduct(editingProduct.id, patch); }}
          onAddCategory={() => setAddCatOpen(true)}
          onAddDesigner={() => setAddDesignerOpen(true)}
          onRemove={editingProduct.custom ? () => { setConfirmDelete(editingProduct.id); setEditingId(null); } : undefined}
        />
      )}
    </div>
  );
}

/* ============================================================= */
/* PRODUCT EDITOR MODAL                                          */
/* ============================================================= */
function ProductEditor({
  product, allProducts, index, allCategories, allDesigners,
  onPrev, onNext, onClose, onSave, onAddCategory, onAddDesigner, onRemove,
}: {
  product: Product;
  allProducts: Product[];
  index: number;
  allCategories: { name: string; slug: string; image: string }[];
  allDesigners: { id: string; name: string }[];
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onSave: (patch: Partial<Product>) => void;
  onAddCategory: () => void;
  onAddDesigner: () => void;
  onRemove?: () => void;
}) {
  // Re-init form when the product changes (next/prev arrows)
  const [form, setForm] = useState({
    name: product.name,
    price: String(product.price),
    categorySlug: product.categorySlug,
    designerId: product.designerId ?? "",
    image: product.image,
    g0: product.gallery_images?.[0] ?? product.image,
    g1: product.gallery_images?.[1] ?? product.image,
    g2: product.gallery_images?.[2] ?? product.image,
    g3: product.gallery_images?.[3] ?? product.image,
    tags: (product.tags ?? []).join(", "),
    description: product.description,
  });
  const [preview, setPreview] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm({
      name: product.name,
      price: String(product.price),
      categorySlug: product.categorySlug,
      designerId: product.designerId ?? "",
      image: product.image,
      g0: product.gallery_images?.[0] ?? product.image,
      g1: product.gallery_images?.[1] ?? product.image,
      g2: product.gallery_images?.[2] ?? product.image,
      g3: product.gallery_images?.[3] ?? product.image,
      tags: (product.tags ?? []).join(", "),
      description: product.description,
    });
    setPreview(false);
    setSaved(false);
  }, [product.id]);

  // Active angle in preview
  const [activeAngle, setActiveAngle] = useState<0 | 1 | 2 | 3 | 4>(0);
  const allImgs = [form.image, form.g0, form.g1, form.g2, form.g3];

  const apply = () => {
    const cat = allCategories.find((c) => c.slug === form.categorySlug);
    onSave({
      name: form.name.trim(),
      price: Number(form.price),
      categorySlug: form.categorySlug,
      category: cat?.name ?? product.category,
      designerId: form.designerId || undefined,
      image: form.image,
      main_image: form.image,
      gallery_images: [form.g0, form.g1, form.g2, form.g3],
      tags: form.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
      description: form.description,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-2 sm:p-6">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative flex h-full max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        {/* Top bar */}
        <div className="flex items-center justify-between border-b border-light-gray px-4 py-3">
          <div className="flex items-center gap-2">
            <button onClick={onPrev} disabled={index <= 0} className="flex h-8 w-8 items-center justify-center rounded-full border border-light-gray text-charcoal disabled:opacity-30">←</button>
            <button onClick={onNext} disabled={index >= allProducts.length - 1} className="flex h-8 w-8 items-center justify-center rounded-full border border-light-gray text-charcoal disabled:opacity-30">→</button>
            <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">{index + 1} of {allProducts.length} in {product.category}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPreview((p) => !p)} className={`rounded-sm border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${preview ? "border-brand-secondary bg-brand-secondary text-brand-primary" : "border-light-gray text-charcoal hover:border-brand-secondary"}`}>{preview ? "Editing View" : "Preview"}</button>
            <button onClick={apply} className="rounded-sm bg-brand-primary px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary">{saved ? "✓ Applied" : "Apply"}</button>
            {onRemove && <button onClick={onRemove} className="rounded-sm border border-error/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-error hover:bg-error hover:text-white">Remove</button>}
            <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-warm-beige">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-5 w-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {preview ? (
            /* PREVIEW MODE — mimics product detail */
            <div className="grid gap-8 p-6 lg:grid-cols-2">
              <div>
                <div className="aspect-square overflow-hidden rounded-lg bg-warm-beige">
                  <img src={allImgs[activeAngle]} alt={form.name} className="h-full w-full object-cover" />
                </div>
                <div className="mt-3 grid grid-cols-5 gap-2">
                  {allImgs.map((img, i) => (
                    <button key={i} onClick={() => setActiveAngle(i as 0|1|2|3|4)} className={`aspect-square overflow-hidden rounded-md border-2 ${i === activeAngle ? "border-brand-primary" : "border-transparent"}`}>
                      <img src={img} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-brand-accent">{allCategories.find((c) => c.slug === form.categorySlug)?.name}</p>
                <h1 className="mt-1.5 font-display text-2xl text-brand-primary sm:text-3xl">{form.name}</h1>
                <p className="mt-3 font-display text-3xl text-brand-primary">{formatKES(Number(form.price))}</p>
                {form.designerId && <p className="mt-2 text-xs text-brand-accent">By {allDesigners.find((d) => d.id === form.designerId)?.name}</p>}
                <p className="mt-4 text-sm leading-relaxed text-charcoal">{form.description}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {form.tags.split(",").map((t) => t.trim()).filter(Boolean).map((t) => (
                    <span key={t} className="rounded-full bg-warm-beige px-2.5 py-0.5 text-[10px] text-charcoal">{t}</span>
                  ))}
                </div>
                <p className="mt-6 text-[10px] uppercase tracking-wider text-gray-400">↑ This is how the product will look. Click <strong>Apply</strong> to save edits to the draft.</p>
              </div>
            </div>
          ) : (
            /* EDIT MODE */
            <div className="grid gap-6 p-6 lg:grid-cols-2">
              <div>
                <h4 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-brand-primary">Images</h4>
                <div className="space-y-3">
                  <Field label="Overview image (main)">
                    <input value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-xs outline-none" />
                  </Field>
                  {form.image && <img src={form.image} alt="" className="h-24 w-24 rounded-sm object-cover" />}
                  <Field label="Detail pic 1"><input value={form.g0} onChange={(e) => setForm({ ...form, g0: e.target.value })} className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-xs outline-none" /></Field>
                  <Field label="Detail pic 2"><input value={form.g1} onChange={(e) => setForm({ ...form, g1: e.target.value })} className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-xs outline-none" /></Field>
                  <Field label="Detail pic 3"><input value={form.g2} onChange={(e) => setForm({ ...form, g2: e.target.value })} className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-xs outline-none" /></Field>
                  <Field label="Detail pic 4"><input value={form.g3} onChange={(e) => setForm({ ...form, g3: e.target.value })} className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-xs outline-none" /></Field>
                  <div className="grid grid-cols-4 gap-2">
                    {[form.g0, form.g1, form.g2, form.g3].map((g, i) => g && <img key={i} src={g} alt="" className="aspect-square w-full rounded-sm object-cover" />)}
                  </div>
                </div>
              </div>
              <div>
                <h4 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-brand-primary">Details</h4>
                <div className="space-y-3">
                  <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none" /></Field>
                  <Field label="Price (KES)"><input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none" /></Field>
                  <Field label="Category">
                    <div className="flex gap-2">
                      <select value={form.categorySlug} onChange={(e) => setForm({ ...form, categorySlug: e.target.value })} className="flex-1 rounded-sm border border-light-gray bg-off-white px-2 py-2 text-xs outline-none">
                        {allCategories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                      </select>
                      <button onClick={onAddCategory} className="rounded-sm border border-brand-primary px-3 py-2 text-[10px] font-bold uppercase text-brand-primary hover:bg-brand-primary hover:text-white">+ New</button>
                    </div>
                  </Field>
                  <Field label="Designer">
                    <div className="flex gap-2">
                      <select value={form.designerId} onChange={(e) => setForm({ ...form, designerId: e.target.value })} className="flex-1 rounded-sm border border-light-gray bg-off-white px-2 py-2 text-xs outline-none">
                        <option value="">— None —</option>
                        {allDesigners.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                      <button onClick={onAddDesigner} className="rounded-sm border border-brand-primary px-3 py-2 text-[10px] font-bold uppercase text-brand-primary hover:bg-brand-primary hover:text-white">+ New</button>
                    </div>
                  </Field>
                  <Field label="Tags (comma separated)">
                    <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="shirt, cotton, summer" className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none" />
                  </Field>
                  <Field label="Description">
                    <textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none" />
                  </Field>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</label>
      {children}
    </div>
  );
}

/* ============================================================= */
/* CUSTOMIZE PANEL — fonts + color presets + custom color         */
/* (Backed by the global CustomizeContext so changes apply        */
/*  everywhere, not just inside the admin route.)                 */
/* ============================================================= */
function CustomizePanel() {
  const {
    fontId, colorId, colors, customColors,
    setFont, setColorPreset, setCustomColor, resetAll,
  } = useCustomize();

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Fonts */}
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <h3 className="mb-5 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Typography</h3>
        <div className="space-y-2">
          {FONT_OPTIONS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFont(f.id)}
              className={`flex w-full items-center justify-between rounded-sm border p-3 text-left transition-all ${
                fontId === f.id ? "border-brand-secondary bg-brand-secondary/10" : "border-light-gray hover:border-brand-accent"
              }`}
            >
              <div>
                <p className="text-sm font-semibold text-brand-primary" style={{ fontFamily: `"${f.display}", serif` }}>{f.label}</p>
                <p className="mt-0.5 text-[11px] text-gray-400" style={{ fontFamily: `"${f.body}", sans-serif` }}>
                  The quick brown fox jumps over the lazy dog.
                </p>
              </div>
              {fontId === f.id && <span className="text-brand-secondary">✓</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Colors */}
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <h3 className="mb-5 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Color Theme</h3>

        <div className="space-y-2">
          {COLOR_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setColorPreset(p.id)}
              className={`flex w-full items-center gap-3 rounded-sm border p-3 text-left transition-all ${
                colorId === p.id ? "border-brand-secondary bg-brand-secondary/10" : "border-light-gray hover:border-brand-accent"
              }`}
            >
              <div className="flex flex-wrap gap-1">
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.primary }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.secondary }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.accent }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.warmBeige }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.oceanBlue }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.oceanBlueDark }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.coral }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.success }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.warning }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.error }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.charcoal }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.offWhite }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.lightGray }} />
                <span className="h-8 w-8 rounded-sm border" style={{ background: p.lightPink }} />
              </div>
              <span className="text-xs font-medium text-brand-primary">{p.name}</span>
              {colorId === p.id && <span className="ml-auto text-brand-secondary">✓</span>}
            </button>
          ))}

          {/* Custom */}
          <button
            onClick={() => setColorPreset("custom")}
            className={`flex w-full items-center gap-3 rounded-sm border p-3 text-left transition-all ${
              colorId === "custom" ? "border-brand-secondary bg-brand-secondary/10" : "border-light-gray hover:border-brand-accent"
            }`}
          >
            <div className="flex flex-wrap gap-1">
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.primary }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.secondary }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.accent }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.warmBeige }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.oceanBlue }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.oceanBlueDark }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.coral }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.success }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.warning }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.error }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.charcoal }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.offWhite }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.lightGray }} />
              <span className="h-8 w-8 rounded-sm border" style={{ background: customColors.lightPink }} />
            </div>
            <span className="text-xs font-medium text-brand-primary">Custom Colors</span>
            {colorId === "custom" && <span className="ml-auto text-brand-secondary">✓</span>}
          </button>
        </div>

        {colorId === "custom" && (
          <div className="mt-4 rounded-md border border-light-gray bg-off-white p-4">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-brand-accent">Edit Custom Colors</p>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-7">
              {(["primary", "secondary", "accent", "warmBeige", "oceanBlue", "oceanBlueDark", "coral", "success", "warning", "error", "charcoal", "offWhite", "lightGray", "lightPink"] as const).map((key) => (
                <div key={key} className="text-center">
                  <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-gray-400">{key}</label>
                  <input
                    type="color"
                    value={colors[key]}
                    onChange={(e) => setCustomColor(key, e.target.value)}
                    className="mx-auto block h-10 w-10 cursor-pointer rounded-sm border-0 bg-transparent"
                  />
                  <span className="mt-0.5 block text-[9px] text-gray-400">{colors[key]}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Color legend */}
      <div className="lg:col-span-2 rounded-lg bg-white p-5 shadow-sm">
        <h4 className="mb-3 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">Color Slot Key</h4>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {COLOR_SLOT_LEGEND.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              <span className="h-5 w-5 shrink-0 rounded-sm border" style={{ background: colors[s.key as keyof typeof colors] }} />
              <div>
                <p className="text-[10px] font-bold text-brand-primary">{i + 1}. {s.key}</p>
                <p className="text-[9px] text-gray-400">{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Reset */}
      <div className="lg:col-span-2">
        <button
          onClick={resetAll}
          className="rounded-sm border border-brand-primary px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-brand-primary transition-colors hover:bg-brand-primary hover:text-white"
        >
          Reset to Defaults
        </button>
        <p className="mt-2 text-[10px] text-gray-400">Restores the original Marcellus + Jost fonts and Classic Gold color theme.</p>
      </div>
    </div>
  );
}
