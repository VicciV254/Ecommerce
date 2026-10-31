import { useId, type ReactNode } from "react";
import type { CatalogCategory } from "../../api/catalog";
import type { CategoryTree } from "../../store/catalogModel";

export const inputClass =
  "w-full rounded-sm border border-light-gray bg-off-white px-3 py-2 text-sm outline-none focus:border-brand-secondary";
export const smallButtonClass =
  "rounded-sm border border-brand-primary px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-brand-primary hover:bg-brand-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-50";
export const primaryButtonClass =
  "rounded-sm bg-brand-primary px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600";
export const dangerButtonClass =
  "rounded-sm border border-error/40 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-error hover:bg-error hover:text-white disabled:cursor-not-allowed disabled:opacity-50";

export function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-gray-600">{label}</label>
      {children(id)}
      {hint && <p className="mt-1 text-[11px] text-gray-500">{hint}</p>}
    </div>
  );
}

export function Panel({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-brand-primary">{title}</h3>
          {description && <p className="mt-1 max-w-2xl text-xs text-gray-600">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Feedback inside the active layer (page or dialog) so it is announced and visible. */
export function Feedback({ message, tone }: { message: string; tone: "error" | "success" }) {
  if (!message) return null;
  return tone === "error"
    ? <p role="alert" className="rounded-md border border-error/30 bg-error/10 p-3 text-xs font-semibold text-error">{message}</p>
    : <p role="status" className="rounded-md border border-success/30 bg-success/10 p-3 text-xs font-semibold text-success">{message}</p>;
}

export type CategoryOption = { id: string; label: string; depth: number; category: CatalogCategory };

/** Every category in tree order, labelled with its full path, for pickers. */
export function categoryOptions(tree: CategoryTree): CategoryOption[] {
  const options: CategoryOption[] = [];
  const visit = (category: CatalogCategory, trail: string[], seen: Set<string>) => {
    if (seen.has(category.id)) return;
    const next = new Set(seen).add(category.id);
    const path = [...trail, category.name];
    options.push({ id: category.id, label: path.join(" › "), depth: trail.length, category });
    for (const child of tree.children(category.id)) visit(child, path, next);
  };
  for (const root of tree.roots) visit(root, [], new Set());
  return options;
}

/** Category IDs below `id`, used to keep a category from becoming its own descendant. */
export function descendantIds(tree: CategoryTree, id: string): Set<string> {
  const result = new Set<string>();
  const stack = [...tree.children(id)];
  while (stack.length) {
    const category = stack.pop();
    if (!category || result.has(category.id)) continue;
    result.add(category.id);
    stack.push(...tree.children(category.id));
  }
  return result;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** Local calendar date for a date input. */
export function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Start or end of a local calendar day as an ISO timestamp, so end dates stay inclusive. */
export function fromDateInput(value: string, boundary: "start" | "end"): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = boundary === "start"
    ? new Date(year, month - 1, day, 0, 0, 0, 0)
    : new Date(year, month - 1, day, 23, 59, 59, 999);
  return date.toISOString();
}

export function todayInput(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return toDateInput(date.toISOString());
}

/** HTTPS URLs or the site's own /images/ path, matching what the catalog API accepts. */
export function isAcceptedImageUrl(value: string) {
  if (value.startsWith("/images/")) return !value.includes("..");
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
