import { useEffect, useId, useRef, useState } from "react";
import type { AdminSession } from "../../api/staffSession";
import { BrandLogo } from "../../components/Brand";
import { useStickyHeaderOffset } from "../../components/stickyHeader";
import { useRoute } from "../../router";
import { roleLabel } from "./permissions";

/** The role in plain words, as a badge; gold on the navy bar, gold text on light panels. */
function RoleBadge({ role, tone }: { role: string; tone: "navy" | "light" }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 text-xs font-semibold leading-5 ${
      tone === "navy" ? "border-gold-400 text-gold-400" : "border-gold-text text-gold-text"
    }`}>
      {roleLabel(role)}
    </span>
  );
}

/**
 * Below 1280px: a button showing the name and role opens a small account panel with "Sign out". The panel closes on
 * Escape, on a press outside it and on any route change.
 */
function AccountMenu({ admin, onSignOut }: { admin: AdminSession; onSignOut: () => void }) {
  const route = useRoute();
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === route;
  const panelId = useId();
  const area = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !area.current?.contains(event.target)) setOpenAt(null);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  return (
    <div
      ref={area}
      className="relative ml-auto flex min-w-0 items-center"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        setOpenAt(null);
        button.current?.focus();
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpenAt(open ? null : route)}
        className="-mr-[8px] flex min-h-[44px] min-w-0 items-center gap-2 rounded-sm px-[8px] text-left transition-colors duration-(--motion-feedback) hover:bg-white/10"
      >
        <span className="sr-only">Account: </span>
        <span className="min-w-0">
          <span className="block max-w-[160px] truncate text-sm font-semibold text-white">{admin.username}</span>{" "}
          <span className="block text-xs text-on-navy-muted">{roleLabel(admin.role)}</span>
        </span>
        <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={`size-[16px] shrink-0 text-on-navy-muted ${open ? "rotate-180" : ""}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div id={panelId} className="on-light absolute right-0 top-full z-50 mt-1 w-[272px] max-w-[calc(100vw-32px)] rounded-lg bg-surface p-[16px] text-navy-800 shadow-overlay [overflow-wrap:anywhere]">
          <p className="text-sm text-muted">Signed in as</p>
          <p className="font-semibold text-navy-900">{admin.username}</p>
          <p className="text-sm text-muted">{admin.email}</p>
          <p className="mt-2"><RoleBadge role={admin.role} tone="light" /></p>
          <button
            type="button"
            onClick={() => {
              setOpenAt(null);
              onSignOut();
            }}
            className="mt-4 flex min-h-[44px] w-full items-center justify-center rounded-sm border border-navy-900 px-[16px] text-sm font-semibold text-navy-900 transition-colors duration-(--motion-feedback) hover:bg-surface-soft"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The sticky navy top bar. Its first row holds the menu button (below 1280px), the brand with its "Admin" label and,
 * from 1280px, the account's name, role and "Sign out". Below 1280px a second row shows the current location beside
 * the account button; it stops sticking when both rows would cover too much of a short or zoomed screen.
 */
export function AdminTopBar({ brandName, location, refreshing, admin, menuOpen, drawerId, onMenu, onSignOut }: {
  brandName: string;
  location: string;
  refreshing: boolean;
  admin: AdminSession;
  menuOpen: boolean;
  drawerId: string;
  onMenu: () => void;
  onSignOut: () => void;
}) {
  const bar = useRef<HTMLElement>(null);
  const locationRow = useRef<HTMLDivElement>(null);
  const compact = useStickyHeaderOffset(bar, locationRow);
  return (
    <>
      <header ref={bar} data-sticky-header className="on-navy sticky top-0 z-40 bg-navy-900 text-white">
        {/* 6px of padding keeps the 5px focus ring of a 44px control inside the window's top edge. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-[6px] sm:px-6 lg:px-8">
          <button
            type="button"
            aria-label="Menu"
            aria-expanded={menuOpen}
            aria-controls={drawerId}
            aria-haspopup="dialog"
            onClick={onMenu}
            className="-ml-[10px] flex size-[44px] shrink-0 items-center justify-center rounded-full transition-colors duration-(--motion-feedback) hover:bg-white/10 xl:hidden"
          >
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-[24px]">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <div className="mr-auto flex min-h-[44px] min-w-0 max-w-full flex-wrap items-center gap-x-2.5 gap-y-1">
            <BrandLogo name={brandName} surface="navy" size="sm" />
            <span className="rounded-sm border border-gold-400 px-1.5 text-xs font-bold leading-5 text-gold-400">Admin</span>
          </div>
          <div className="hidden min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 xl:flex">
            <p className="sr-only">Current page: {location}</p>
            {refreshing && <span role="status" className="text-xs font-semibold text-on-navy-muted">Refreshing…</span>}
            <span className="min-w-0 truncate text-sm font-semibold text-white">{admin.username}</span>
            <RoleBadge role={admin.role} tone="navy" />
            <button
              type="button"
              onClick={onSignOut}
              className="flex min-h-[44px] items-center rounded-sm border border-white/60 px-[14px] text-sm font-semibold text-white transition-colors duration-(--motion-feedback) hover:bg-white/10"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <div
        ref={locationRow}
        data-sticky-header={compact ? undefined : ""}
        className={`on-navy z-30 border-t border-white/10 bg-navy-900 text-white xl:hidden ${compact ? "" : "sticky top-(--sticky-brand-height)"}`}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-[6px] sm:px-6 lg:px-8">
          <p className="min-w-0 flex-[1_1_12rem] text-sm text-on-navy-muted [overflow-wrap:break-word]">
            <span className="sr-only">Current page: </span>
            {location}
          </p>
          {refreshing && <span role="status" className="text-xs font-semibold text-on-navy-muted">Refreshing…</span>}
          <AccountMenu admin={admin} onSignOut={onSignOut} />
        </div>
      </div>
    </>
  );
}
