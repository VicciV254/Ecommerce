import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import type { AdminSession } from "../../api/staffSession";
import { ModalDialog, Toast } from "../../components/Modal";
import { Link, navigate, useEntryFocus, useRoute } from "../../router";
import { isDiscountActive } from "../../store/catalogModel";
import { usePageTitle, useStorefront } from "../../store/StorefrontContext";
import { AdminCatalogProvider, useOptionalAdminCatalog } from "./AdminCatalogContext";
import { AdminNavigation } from "./AdminNavigation";
import { AdminTopBar } from "./AdminTopBar";
import { adminGroupLabel, adminModule, adminModuleRoute, parseAdminPlace, type AdminModuleId } from "./adminRoutes";
import { AnalyticsPanel } from "./AnalyticsPanel";
import { CarriedNoticeProvider } from "./carriedNotice";
import { CatalogManager } from "./CatalogManager";
import { CustomersManager } from "./CustomersManager";
import { DashboardPanel } from "./DashboardPanel";
import { DiscountManager } from "./DiscountManager";
import { OrdersManager } from "./OrdersManager";
import { canRead, canWrite, firstPermittedModule, isStaffRole, permittedModules, roleLabel } from "./permissions";
import { ProductPreview } from "./ProductPreview";
import { PromotionsManager } from "./PromotionsManager";
import { StaffActivity } from "./StaffActivity";
import { StockManager } from "./StockManager";
import { StorefrontDraftProvider } from "./StorefrontDraft";
import { StorefrontManager } from "./StorefrontManager";
import { StorefrontPreview } from "./StorefrontPreview";
import { UnsavedChangesProvider, useLeaveGuard } from "./unsavedChanges";
import { UnreadAlertsRefresh, useUnreadAlerts } from "./unreadAlerts";

const TOAST_MS = 2500;
/** From this width the navigation is a persistent column, and an open drawer closes itself. */
const COLUMN_QUERY = "(min-width: 1280px)";
/** Modules that need the staff catalog before they can show anything. */
const CATALOG_MODULES: readonly AdminModuleId[] = ["products", "stock", "discounts"];

/** What the content area shows for the address and the signed-in role. */
type View =
  | { kind: "module"; module: AdminModuleId }
  | { kind: "preview" }
  | { kind: "product-preview" }
  | { kind: "not-found" }
  | { kind: "not-permitted"; label: string }
  | { kind: "no-access" };

function resolveView(route: string, role: string): View {
  const first = firstPermittedModule(role);
  if (!first) return { kind: "no-access" };
  const place = parseAdminPlace(route);
  switch (place.kind) {
    // Shown while the bare entry replaces itself with the first module.
    case "home": return { kind: "module", module: first };
    case "module": return canRead(role, place.module) ? place : { kind: "not-permitted", label: adminModule(place.module).label };
    case "preview": return canRead(role, "storefront") ? place : { kind: "not-permitted", label: "Draft preview" };
    case "product-preview": return canRead(role, "products") ? place : { kind: "not-permitted", label: "Product preview" };
    default: return { kind: "not-found" };
  }
}

/** The view's name (H1 and title), where it sits (top bar), and a key that changes on every arrival at a new place. */
function describeView(view: View, route: string) {
  switch (view.kind) {
    case "module": {
      const module = adminModule(view.module);
      return { key: view.module, title: module.label, location: `${adminGroupLabel(module.group)} › ${module.label}` };
    }
    case "preview":
      return { key: "preview", title: "Draft preview", location: "Storefront › Draft preview" };
    // Each product's preview is its own arrival, so its banner heading takes focus.
    case "product-preview":
      return { key: `product-preview:${route}`, title: "Product preview", location: `${adminGroupLabel("catalog")} › Product preview` };
    case "not-found":
      return { key: `not-found:${route}`, title: "Page not found", location: "Page not found" };
    case "not-permitted":
      return { key: `not-permitted:${route}`, title: "Not available for your role", location: "Not available" };
    default:
      return { key: "no-access", title: "No admin access", location: "No admin access" };
  }
}

/**
 * The signed-in admin: one shell per staff account (keyed by the caller), with grouped navigation (a drawer below
 * 1280px, a 240px column above), the current location, routed modules and the shared unsaved-change guard.
 */
export function AdminShell({ admin, onSignOut }: { admin: AdminSession; onSignOut: () => void }) {
  return (
    <UnsavedChangesProvider>
      <CarriedNoticeProvider>
        {/* An unrecognised role reads nothing, so its shell never loads staff data. */}
        {isStaffRole(admin.role)
          ? <AdminCatalogProvider><ShellFrame admin={admin} onSignOut={onSignOut} /></AdminCatalogProvider>
          : <ShellFrame admin={admin} onSignOut={onSignOut} />}
      </CarriedNoticeProvider>
    </UnsavedChangesProvider>
  );
}

function ShellFrame({ admin, onSignOut }: { admin: AdminSession; onSignOut: () => void }) {
  const { brandName } = useStorefront();
  const route = useRoute();
  const catalog = useOptionalAdminCatalog();
  const leave = useLeaveGuard();
  const view = resolveView(route, admin.role);
  const label = describeView(view, route);
  usePageTitle(`${label.title} · Admin · ${brandName}`);

  // The bare entry opens the first permitted module and replaces itself, so Back never returns to it.
  const home = parseAdminPlace(route).kind === "home";
  const first = firstPermittedModule(admin.role);
  useEffect(() => {
    if (home && first) navigate(adminModuleRoute(first), { replace: true });
  }, [home, first]);

  // The drawer belongs to the route it was opened on, so any navigation closes it.
  const [drawerAt, setDrawerAt] = useState<string | null>(null);
  const drawerOpen = drawerAt === route;
  const closeDrawer = useCallback(() => setDrawerAt(null), []);
  const drawerId = useId();

  const [toast, setToast] = useState("");
  const toastTimer = useRef<number | undefined>(undefined);
  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), TOAST_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const signOut = () => leave(onSignOut);
  const now = new Date();
  const activeDiscounts = catalog?.data?.snapshot.discounts.filter((discount) => !discount.isDemo && isDiscountActive(discount, now)).length;
  const permitted = permittedModules(admin.role);
  // This staff member's unread alerts beside Orders; an account that cannot open Orders asks for nothing.
  const alerts = useUnreadAlerts(canRead(admin.role, "orders"));
  const navigation = (onNavigate?: () => void) => (
    <AdminNavigation
      permitted={permitted}
      current={view.kind === "module" ? view.module : view.kind === "product-preview" ? "products" : null}
      previewCurrent={view.kind === "preview"}
      showPreview={canRead(admin.role, "storefront")}
      activeDiscounts={activeDiscounts}
      unreadAlerts={alerts.count}
      onNavigate={onNavigate}
    />
  );

  const content = (
    <UnreadAlertsRefresh.Provider value={alerts.refresh}>
      <ShellContent
        key={label.key}
        view={view}
        title={label.title}
        admin={admin}
        activeDiscounts={activeDiscounts}
        showToast={showToast}
        onSignOut={signOut}
      />
    </UnreadAlertsRefresh.Provider>
  );
  const storefrontGroup = view.kind === "preview" || (view.kind === "module" && view.module === "storefront");

  return (
    <div className="flex min-h-screen flex-col bg-surface-page text-navy-800">
      <AdminTopBar
        brandName={brandName}
        location={label.location}
        refreshing={Boolean(catalog?.refreshing && catalog.data)}
        admin={admin}
        menuOpen={drawerOpen}
        drawerId={drawerId}
        onMenu={() => setDrawerAt(drawerOpen ? null : route)}
        onSignOut={signOut}
      />
      {/* Fills the window below the top bar, so the navigation column runs to the bottom on short pages too. */}
      <div className="flex-1 xl:grid xl:grid-cols-[240px_minmax(0,1fr)]">
        <div className="hidden border-r border-divider bg-surface xl:block">
          <div className="focus-scroll-room sticky top-(--sticky-header-height) max-h-[calc(100dvh-var(--sticky-header-height,0px))] overflow-y-auto overscroll-contain">
            {navigation()}
          </div>
        </div>
        <main className="min-w-0 px-4 pb-12 pt-6 sm:px-6 lg:px-8">
          {catalog?.sessionExpired && (
            <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-error/30 bg-error-tint p-4 text-sm font-semibold text-error">
              <span>Your staff session has expired. Sign in again to continue.</span>
              <button type="button" onClick={signOut} className="min-h-[44px] rounded-sm bg-error px-[16px] text-sm font-semibold text-white">Sign in again</button>
            </div>
          )}
          {catalog && !catalog.sessionExpired && catalog.error && (
            <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-error/30 bg-error-tint p-4 text-sm text-error">
              <span>{catalog.data ? `Catalog data may be out of date: ${catalog.error}` : catalog.error}</span>
              <button type="button" onClick={catalog.reload} className="min-h-[44px] font-bold underline">Try again</button>
            </div>
          )}
          {storefrontGroup
            ? <StorefrontDraftProvider canWrite={canWrite(admin.role, "storefront")} showToast={showToast}>{content}</StorefrontDraftProvider>
            : content}
        </main>
      </div>

      {drawerOpen && (
        <ModalDialog open label="Admin navigation" placement="start" dismissAt={COLUMN_QUERY} onClose={closeDrawer}>
          <div id={drawerId} className="on-light focus-scroll-room h-full w-[320px] max-w-[calc(100vw-48px)] overflow-y-auto overscroll-contain bg-surface text-navy-800 shadow-overlay animate-fade-in">
            {/* 6px of padding keeps the close button's focus ring inside the drawer's scrolling panel. */}
            <div className="flex items-center justify-between border-b border-divider py-[6px] pl-[24px] pr-[8px]">
              <span className="text-sm font-semibold text-navy-900">Menu</span>
              <button type="button" onClick={closeDrawer} aria-label="Close menu" className="flex size-[44px] items-center justify-center rounded-full hover:bg-surface-soft">
                <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-[20px]"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
              </button>
            </div>
            {navigation(closeDrawer)}
          </div>
        </ModalDialog>
      )}

      <Toast open={Boolean(toast)} message={toast} />
    </div>
  );
}

/** One place's content: its H1 (focused on in-app arrival), a one-line description, then the module or state. */
function ShellContent({ view, title, admin, activeDiscounts, showToast, onSignOut }: {
  view: View;
  title: string;
  admin: AdminSession;
  activeDiscounts: number | undefined;
  showToast: (message: string) => void;
  onSignOut: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEntryFocus(heading);
  if (view.kind === "preview") return <StorefrontPreview heading={heading} />;
  if (view.kind === "product-preview") return <ProductPreview heading={heading} />;

  const module = view.kind === "module" ? adminModule(view.module) : null;
  let description: ReactNode;
  let body: ReactNode;
  if (view.kind === "module") {
    description = module?.description;
    body = <ModuleBody module={view.module} role={admin.role} activeDiscounts={activeDiscounts} showToast={showToast} />;
  } else if (view.kind === "not-found") {
    description = "There is no admin page at this address.";
    body = <ModuleLinks role={admin.role} />;
  } else if (view.kind === "not-permitted") {
    description = `Your role (${roleLabel(admin.role)}) can't open ${view.label}.`;
    const first = firstPermittedModule(admin.role);
    body = first && (
      <Link to={adminModuleRoute(first)} className={stateLink}>Go to {adminModule(first).label}</Link>
    );
  } else {
    description = `This account's role (${roleLabel(admin.role)}) has no admin access. Sign out, then sign in with a staff account.`;
    body = <button type="button" onClick={onSignOut} className={stateLink}>Sign out</button>;
  }

  return (
    <div className={module?.width === "form" ? "max-w-[72rem]" : undefined}>
      <ContentHeading heading={heading} title={title} description={description} />
      <div className="mt-6">{body}</div>
    </div>
  );
}

const stateLink =
  "inline-flex min-h-[44px] items-center rounded-sm bg-navy-900 px-[16px] text-sm font-semibold text-white transition-colors duration-(--motion-feedback) hover:bg-gold-500 hover:text-navy-900";

function ContentHeading({ heading, title, description }: { heading: RefObject<HTMLHeadingElement | null>; title: string; description: ReactNode }) {
  return (
    <>
      <h1 ref={heading} tabIndex={-1} className="type-h1 text-navy-900 [overflow-wrap:anywhere]">{title}</h1>
      {description && <p className="mt-1 text-muted [overflow-wrap:anywhere]">{description}</p>}
    </>
  );
}

/** The modules this role may open, as a way out of a page that doesn't exist. */
function ModuleLinks({ role }: { role: string }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {permittedModules(role).map((id) => (
        <li key={id}>
          <Link to={adminModuleRoute(id)} className="inline-flex min-h-[44px] items-center rounded-sm border border-control px-[14px] text-sm font-semibold text-navy-900 hover:bg-surface-soft">
            {adminModule(id).label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ModuleBody({ module, role, activeDiscounts, showToast }: {
  module: AdminModuleId;
  role: string;
  activeDiscounts: number | undefined;
  showToast: (message: string) => void;
}) {
  const writable = canWrite(role, module);
  if (CATALOG_MODULES.includes(module)) {
    return <CatalogGate>{module === "products"
      ? <CatalogManager canWrite={writable} showToast={showToast} />
      : module === "stock"
        ? <StockManager canWrite={writable} showToast={showToast} />
        : <DiscountManager canWrite={writable} showToast={showToast} />}
    </CatalogGate>;
  }
  switch (module) {
    case "dashboard": return <DashboardPanel activeDiscounts={activeDiscounts} />;
    case "analytics": return <AnalyticsPanel />;
    case "orders":
    case "returns":
    case "refunds":
      return <OrdersManager module={module} canWrite={writable} showToast={showToast} />;
    case "storefront": return <StorefrontManager canWrite={writable} />;
    case "customers": return <CustomersManager canWrite={writable} showToast={showToast} />;
    case "promotions": return <PromotionsManager showToast={showToast} />;
    case "activity": return <StaffActivity />;
    default: return null;
  }
}

/** Catalog modules wait for the staff catalog; a failure is reported (with "Try again") in the banner above. */
function CatalogGate({ children }: { children: ReactNode }) {
  const catalog = useOptionalAdminCatalog();
  if (catalog?.data) return <>{children}</>;
  if (catalog?.error) return null;
  return <p role="status" className="rounded-lg bg-surface p-6 text-sm text-muted shadow-card">Loading catalog data…</p>;
}
