import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { CatalogCategory } from "../api/catalog";
import { Link, parseRoute, useRoute } from "../router";
import { useCatalog } from "../store/CatalogContext";
import type { CategoryTree } from "../store/catalogModel";
import { listingRoute } from "../store/listingQuery";
import { Container } from "./ui";

/** Leaves listed under each group in the desktop panel; the rest are one "View all" away. */
export const PANEL_LEAF_LIMIT = 8;
/** Each panel column scrolls on its own when the viewport below the header is too short for it. */
const panelColumn = "max-h-[calc(100dvh-var(--sticky-header-height,0px)-2rem)] overflow-y-auto overscroll-contain";

const chevron = (direction: "left" | "right" | "down", className = "size-4") => (
  <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={`shrink-0 ${className}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d={{ left: "M15.75 19.5 8.25 12l7.5-7.5", right: "m8.25 4.5 7.5 7.5-7.5 7.5", down: "m19.5 8.25-7.5 7.5-7.5-7.5" }[direction]} />
  </svg>
);

/** The category the current listing shows, if any. */
function listedCategory(route: string, categories: CategoryTree) {
  const { parts, params } = parseRoute(route);
  return parts[0] === "shop" ? categories.bySlug.get(params.get("cat") ?? "") : undefined;
}

/** Loading and failure wording for menus built from the catalog. */
function CatalogMenuState({ tone = "light" }: { tone?: "light" | "navy" }) {
  const { status, reload } = useCatalog();
  if (status === "ready") return null;
  const muted = tone === "navy" ? "text-on-navy-muted" : "text-muted";
  if (status === "loading") return <p role="status" className={`px-3 py-2 text-sm ${muted}`}>Loading departments…</p>;
  return (
    <div role="alert" className={`px-3 py-2 text-sm ${muted}`}>
      Departments could not be loaded.{" "}
      <button type="button" onClick={reload} className="inline-flex min-h-[44px] items-center font-semibold underline underline-offset-4">Try again</button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Drawer: department → groups → leaves, one level at a time          */
/* ------------------------------------------------------------------ */

type DrawerLevel = { department: CatalogCategory; group?: CatalogCategory } | null;

const drawerRow =
  "flex min-h-[44px] w-full items-center justify-between gap-3 rounded-sm px-3 py-1 text-left text-navy-800 transition-colors duration-(--motion-feedback) hover:bg-surface-warm hover:text-navy-900";
const levelHeading = "px-3 type-h3 text-navy-900";

/**
 * The drawer's menu. `root` is the top level (page links and the department list); choosing a department or group
 * replaces it with that level, each with a labelled Back button and a "Shop all" link. Focus follows to the new
 * level's heading. Links call `onNavigate`, which closes the drawer.
 */
export function DrawerMenu({ root, onNavigate }: { root: ReactNode; onNavigate: () => void }) {
  const { categories, status } = useCatalog();
  const [level, setLevel] = useState<DrawerLevel>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  useLayoutEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    heading.current?.focus();
  }, [level]);

  const show = (next: DrawerLevel) => {
    moved.current = true;
    setLevel(next);
  };

  if (!level) {
    return (
      <div className="flex flex-col gap-0.5 px-4 py-4">
        {root}
        <section aria-labelledby="drawer-departments" className="mt-3 border-t border-divider pt-3">
          <h2 id="drawer-departments" ref={heading} tabIndex={-1} className="mb-1 px-3 text-xs font-bold uppercase tracking-[0.15em] text-gold-text">
            Departments
          </h2>
          <CatalogMenuState />
          {status === "ready" && (
            <ul>
              <li>
                <Link to="/departments" onClick={onNavigate} className={`${drawerRow} font-semibold`}>All departments</Link>
              </li>
              {categories.roots.map((department) => (
                <li key={department.id}>
                  <button type="button" onClick={() => show({ department })} className={drawerRow}>
                    <span className="min-w-0 break-words">{department.name}</span>
                    {chevron("right")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  const { department, group } = level;
  const current = group ?? department;
  const entries = categories.children(current.id);
  return (
    <div className="flex flex-col gap-1 px-4 py-4">
      <button type="button" onClick={() => show(group ? { department } : null)} className={`${drawerRow} justify-start font-semibold text-link`}>
        {chevron("left")}
        <span className="min-w-0 break-words">{group ? `Back to ${department.name}` : "Back to menu"}</span>
      </button>
      <h2 ref={heading} tabIndex={-1} className={`${levelHeading} mt-2 break-words`}>{current.name}</h2>
      <ul className="mt-1">
        <li>
          <Link to={listingRoute({ cat: current.slug })} onClick={onNavigate} className={`${drawerRow} font-semibold`}>
            <span className="min-w-0 break-words">Shop all {current.name}</span>
          </Link>
        </li>
        {entries.map((entry) => (
          <li key={entry.id}>
            {!group && categories.children(entry.id).length > 0 ? (
              <button type="button" onClick={() => show({ department, group: entry })} className={drawerRow}>
                <span className="min-w-0 break-words">{entry.name}</span>
                {chevron("right")}
              </button>
            ) : (
              <Link to={listingRoute({ cat: entry.slug })} onClick={onNavigate} className={drawerRow}>
                <span className="min-w-0 break-words">{entry.name}</span>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Desktop: a Departments button opening a non-modal panel             */
/* ------------------------------------------------------------------ */

/**
 * A disclosure panel with the department list (vertical tabs: arrows move, Tab enters the pane) and the selected
 * department's groups. Escape, an outside click, focus leaving it or navigating closes it; Escape and the outside
 * click hand focus back to the button.
 */
export function DepartmentsMenu() {
  const { categories, status } = useCatalog();
  const route = useRoute();
  // Open for the route it was opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const open = openOn === route;
  const departments = categories.roots;
  const selected = departments.find((department) => department.id === selectedId) ?? departments[0];

  const close = (returnFocus: boolean) => {
    setOpenOn(null);
    if (returnFocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Node && wrapper.current?.contains(event.target)) return;
      setOpenOn(null);
      // A click on a field or link keeps its focus; anywhere else, focus returns to the button.
      const active = document.activeElement;
      if (!active || active === document.body || wrapper.current?.contains(active)) button.current?.focus();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [open]);

  const toggle = () => {
    if (open) {
      close(false);
      return;
    }
    const listed = listedCategory(route, categories);
    setSelectedId(listed ? categories.path(listed.id)[0]?.id ?? null : selectedId);
    setOpenOn(route);
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = departments.length - 1;
    const next = { ArrowDown: index >= last ? 0 : index + 1, ArrowUp: index <= 0 ? last : index - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setSelectedId(departments[next].id);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  };

  return (
    <div
      ref={wrapper}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        close(true);
      }}
      onBlur={(event) => {
        if (open && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close(false);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        onClick={toggle}
        className={`flex min-h-[44px] items-center gap-2 rounded-sm px-3 text-sm font-semibold uppercase tracking-[0.12em] transition-colors duration-(--motion-feedback) ${
          open ? "bg-white text-navy-900" : "text-white hover:bg-white/10"
        }`}
      >
        <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>
        Departments
        {chevron("down", `size-4 transition-transform duration-(--motion-feedback) ${open ? "rotate-180" : ""}`)}
      </button>
      {open && (
        <div id={`${id}-panel`} className="on-light absolute inset-x-0 top-full border-t border-divider bg-surface text-navy-800 shadow-overlay">
          <Container className="py-4">
            <CatalogMenuState />
            {status === "ready" && selected && (
              <div className="grid grid-cols-[16rem_minmax(0,1fr)] items-start gap-6">
                <div role="tablist" aria-orientation="vertical" aria-label="Departments" className={`${panelColumn} border-r border-divider pr-3`}>
                  {departments.map((department, index) => {
                    const isSelected = department.id === selected.id;
                    return (
                      <button
                        key={department.id}
                        id={`${id}-tab-${index}`}
                        type="button"
                        role="tab"
                        aria-selected={isSelected}
                        aria-controls={`${id}-pane`}
                        tabIndex={isSelected ? 0 : -1}
                        onClick={() => setSelectedId(department.id)}
                        onKeyDown={(event) => onTabKey(event, index)}
                        className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-sm px-3 text-left transition-colors duration-(--motion-feedback) ${
                          isSelected ? "bg-navy-900 text-white" : "text-navy-800 hover:bg-surface-soft"
                        }`}
                      >
                        <span className="min-w-0 break-words">{department.name}</span>
                        {chevron("right")}
                      </button>
                    );
                  })}
                </div>
                <div
                  id={`${id}-pane`}
                  role="tabpanel"
                  aria-labelledby={`${id}-tab-${departments.indexOf(selected)}`}
                  className={`${panelColumn} pb-2`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                    <h2 className="type-h2 text-navy-900">{selected.name}</h2>
                    <Link to={listingRoute({ cat: selected.slug })} onClick={() => close(false)} className="inline-flex min-h-[44px] items-center font-semibold text-link underline underline-offset-4 hover:text-link-hover">
                      Shop all {selected.name}
                    </Link>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-x-8 gap-y-6">
                    {categories.children(selected.id).map((group) => {
                      const leaves = categories.children(group.id);
                      return (
                        <section key={group.id} aria-labelledby={`${id}-group-${group.id}`} className="min-w-0">
                          <h3 id={`${id}-group-${group.id}`} className="break-words font-semibold text-navy-900">{group.name}</h3>
                          <ul className="mt-1">
                            {leaves.slice(0, PANEL_LEAF_LIMIT).map((leaf) => (
                              <li key={leaf.id}>
                                <Link to={listingRoute({ cat: leaf.slug })} onClick={() => close(false)} className="flex min-h-[44px] items-center break-words py-1 text-navy-800 hover:text-link hover:underline">
                                  {leaf.name}
                                </Link>
                              </li>
                            ))}
                            <li>
                              <Link to={listingRoute({ cat: group.slug })} onClick={() => close(false)} className="flex min-h-[44px] items-center break-words py-1 text-sm font-semibold text-link hover:underline">
                                View all in {group.name}
                              </Link>
                            </li>
                          </ul>
                        </section>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </Container>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Phone: a swipeable department shortcut rail on home and shop pages  */
/* ------------------------------------------------------------------ */

export function DepartmentShortcuts() {
  const { categories, status } = useCatalog();
  const route = useRoute();
  // The row keeps its place while the catalog loads or after it fails (All departments needs no catalog), so the page
  // under it doesn't move when the departments arrive.
  const ready = status === "ready";
  const departments = ready ? categories.roots : [];
  const listed = ready ? listedCategory(route, categories) : undefined;
  const currentDepartment = listed ? categories.path(listed.id)[0] : undefined;
  const pill = "flex min-h-[44px] items-center whitespace-nowrap rounded-full border px-4 text-sm transition-colors duration-(--motion-feedback)";
  return (
    <nav aria-label="Department shortcuts" className="on-light border-b border-divider bg-surface md:hidden">
      {/* An intentional horizontal rail: it scrolls on its own, and a partly shown last pill signals more. */}
      <ul className="no-scrollbar flex gap-2 overflow-x-auto overscroll-x-contain px-4 py-2">
        <li className="shrink-0">
          <Link to="/departments" className={`${pill} border-navy-900 font-semibold text-navy-900 hover:bg-surface-soft`}>All departments</Link>
        </li>
        {departments.map((department) => {
          const current = department.id === currentDepartment?.id;
          return (
            <li key={department.id} className="shrink-0">
              <Link
                to={listingRoute({ cat: department.slug })}
                aria-current={listed?.id === department.id ? "page" : current ? "true" : undefined}
                className={`${pill} ${current ? "border-navy-900 bg-navy-900 text-white" : "border-control text-navy-800 hover:bg-surface-soft"}`}
              >
                {department.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
