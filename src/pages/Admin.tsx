import { useMemo, useState } from "react";
import { CATEGORIES, PRODUCTS, stockStatus } from "../data/products";
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

const TABS = ["Dashboard", "Discounts", "Stock", "Orders", "Analytics"] as const;

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
    <div className="min-h-screen bg-white text-brand-primary">
      {/* Top bar — dark header matching screenshot */}
      <div className="sticky top-0 z-40 border-b border-white/10" style={{ backgroundColor: "#1a1a1a" }}>
        <Container className="flex flex-wrap items-center justify-between gap-3 py-3.5">
          <div className="flex items-center gap-3">
            {/* Gold NM badge */}
            <div className="flex h-8 w-8 items-center justify-center rounded-sm text-xs font-bold" style={{ backgroundColor: "#e8a838", color: "#1a1a1a" }}>NM</div>
            <h1 className="font-body text-base font-semibold tracking-wide text-white">Admin Dashboard</h1>
            {draftApi.dirty && (
              <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider" style={{ backgroundColor: "rgba(248,196,113,0.2)", color: "#e8a838" }}>
                Unsaved changes
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Undo */}
            <button
              onClick={draftApi.undo}
              disabled={!draftApi.canUndo}
              title="Undo"
              className="flex h-8 w-8 items-center justify-center rounded-sm text-white/60 transition-colors hover:text-white disabled:opacity-25"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4"><path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" /></svg>
            </button>
            {/* Redo */}
            <button
              onClick={draftApi.redo}
              disabled={!draftApi.canRedo}
              title="Redo"
              className="flex h-8 w-8 items-center justify-center rounded-sm text-white/60 transition-colors hover:text-white disabled:opacity-25"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4"><path strokeLinecap="round" strokeLinejoin="round" d="m15 15 6-6m0 0-6-6m6 6H9a6 6 0 0 0 0 12h3" /></svg>
            </button>

            {/* Save — solid white button like screenshot */}
            <button
              onClick={() => setConfirmSave(true)}
              disabled={!draftApi.dirty}
              className="rounded-sm px-5 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all disabled:cursor-not-allowed"
              style={{ backgroundColor: draftApi.dirty ? "#ffffff" : "rgba(255,255,255,0.15)", color: draftApi.dirty ? "#1a1a1a" : "rgba(255,255,255,0.3)" }}
            >
              Save Changes
            </button>

            <button onClick={tryExit} className="ml-1 text-[11px] font-semibold tracking-widest text-white/50 hover:text-white">
              ← Exit
            </button>
          </div>
        </Container>
      </div>

      <Container className="py-6">
        <div className="no-scrollbar mb-6 flex gap-0 border-b border-light-gray">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`whitespace-nowrap px-5 py-3.5 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors ${
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
                <div key={label} className="rounded-lg bg-white p-5 shadow-sm border border-light-gray">
                  <div className={`mb-2 h-1 w-8 rounded-full ${bg}`} />
                  <p className="font-display text-2xl text-brand-primary">{val}</p>
                  <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">{label}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div className="rounded-lg bg-white p-6 shadow-sm border border-light-gray">
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

              <div className="rounded-lg bg-white p-6 shadow-sm border border-light-gray">
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

        {tab === "Orders" && (
          <div className="rounded-lg bg-white p-6 shadow-sm border border-light-gray">
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
      <div className="rounded-lg bg-white p-6 shadow-sm border border-light-gray">
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
    <div className="rounded-lg bg-white p-6 shadow-sm border border-light-gray">
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
