import { useId, type ReactNode } from "react";
import { Link } from "../../router";
import { ADMIN_GROUPS, ADMIN_PREVIEW_ROUTE, adminModuleRoute, type AdminModuleId } from "./adminRoutes";

const moduleLink =
  "flex min-h-[44px] items-center justify-between gap-2 rounded-sm px-[12px] py-[8px] text-sm font-medium transition-colors duration-(--motion-feedback) [overflow-wrap:anywhere]";
const utilityLink =
  "flex min-h-[44px] items-center gap-2 rounded-sm border px-[12px] py-[8px] text-sm font-semibold transition-colors duration-(--motion-feedback) [overflow-wrap:anywhere]";

function StoreIcon() {
  return (
    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-[20px] shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
    </svg>
  );
}

function PreviewIcon() {
  return (
    <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-[20px] shrink-0">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

/**
 * The admin's grouped navigation: group names are plain labels, modules are links, and only the modules the role may
 * open are listed. "Live store" and "Draft preview" sit apart, below the groups, in their own styles.
 */
export function AdminNavigation({ permitted, current, previewCurrent, showPreview, activeDiscounts, onNavigate }: {
  permitted: readonly AdminModuleId[];
  current: AdminModuleId | null;
  previewCurrent: boolean;
  showPreview: boolean;
  /** Active discounts for the Discounts badge; unknown while the catalog loads. */
  activeDiscounts: number | undefined;
  onNavigate?: () => void;
}) {
  const idBase = useId();
  const groups = ADMIN_GROUPS
    .map((group) => ({ ...group, modules: group.modules.filter((module) => permitted.includes(module.id)) }))
    .filter((group) => group.modules.length > 0);

  return (
    <div className="flex flex-col gap-4 p-[12px]">
      <nav aria-label="Admin" className="flex flex-col gap-3">
        {groups.map((group) => {
          const labelId = `${idBase}-${group.id}`;
          return (
            <div key={group.id}>
              <p id={labelId} className="px-[12px] pb-1 text-xs font-semibold text-muted">{group.label}</p>
              <ul aria-labelledby={labelId} className="flex flex-col gap-0.5">
                {group.modules.map((module) => {
                  const active = module.id === current;
                  const badge: ReactNode = module.id === "discounts" && activeDiscounts ? (
                    <>
                      <span aria-hidden="true" className="shrink-0 rounded-full bg-gold-400 px-2 text-xs font-bold leading-5 tabular-nums text-navy-900">{activeDiscounts}</span>
                      <span className="sr-only">, {activeDiscounts} active</span>
                    </>
                  ) : null;
                  return (
                    <li key={module.id}>
                      <Link
                        to={adminModuleRoute(module.id)}
                        aria-current={active ? "page" : undefined}
                        onClick={onNavigate}
                        className={`${moduleLink} ${active ? "bg-navy-900 text-white" : "text-navy-900 hover:bg-surface-soft"}`}
                      >
                        <span className="min-w-0">{module.label}</span>
                        {badge}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="flex flex-col gap-2 border-t border-divider pt-4">
        <Link to="/" onClick={onNavigate} className={`${utilityLink} border-control text-navy-900 hover:bg-surface-soft`}>
          <StoreIcon />
          Live store
        </Link>
        {showPreview && (
          <Link
            to={ADMIN_PREVIEW_ROUTE}
            aria-current={previewCurrent ? "page" : undefined}
            onClick={onNavigate}
            className={`${utilityLink} border-dashed ${previewCurrent ? "border-gold-text bg-surface-warm text-gold-text" : "border-gold-text text-gold-text hover:bg-surface-warm"}`}
          >
            <PreviewIcon />
            Draft preview
          </Link>
        )}
      </div>
    </div>
  );
}
