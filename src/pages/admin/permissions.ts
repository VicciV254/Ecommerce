import {
  ADMIN_MODULE_IDS,
  adminModuleRoute,
  parseAdminPlace,
  type AdminModuleId,
} from "./adminRoutes";

/**
 * What each staff role may read and change, module by module. This mirrors the API's `authorize(...)` lists (sources
 * below, paths under `backend/src/routes/`); the API enforces them. Hiding a control here is presentation, never the
 * protection.
 */
type StaffRole = "SUPER_ADMIN" | "ADMIN" | "VIEWER";

const STAFF_ROLES: readonly StaffRole[] = ["SUPER_ADMIN", "ADMIN", "VIEWER"];
const EVERY_ROLE = STAFF_ROLES;
const WRITERS: readonly StaffRole[] = ["SUPER_ADMIN", "ADMIN"];
const NOBODY: readonly StaffRole[] = [];

type Access = { read: readonly StaffRole[]; write: readonly StaffRole[] };

export const MODULE_ACCESS: Readonly<Record<AdminModuleId, Access>> = {
  // analyticsRoutes.js:15 (dashboard) and :17 (sales) admit all three roles; nothing here writes.
  // The catalog snapshot behind the stock counts: index.js:54 (any signed-in staff).
  dashboard: { read: EVERY_ROLE, write: NOBODY },
  // Exports are built in the browser from the sales report read (analyticsRoutes.js:17).
  analytics: { read: EVERY_ROLE, write: NOBODY },
  // orderRoutes.js:28 staffRead (lines 35-38: lists and one order), :29 staffWrite (lines 39-44: actions, returns,
  // refunds); mpesaRoutes.js:8 reads payments for all three, :9 lets writers query M-Pesa; admin.js:32-33 attention
  // list and "mark read" (any staff), :34 email retry (writers).
  orders: { read: EVERY_ROLE, write: WRITERS },
  returns: { read: EVERY_ROLE, write: WRITERS },
  refunds: { read: EVERY_ROLE, write: WRITERS },
  // index.js:54 staff catalog (any staff); productRoutes.js:27-29, categoryRoutes.js:20-23 (:21 is the reorder),
  // designerRoutes.js:19-21 and index.js:55-56 (media) write for SUPER_ADMIN and ADMIN only.
  products: { read: EVERY_ROLE, write: WRITERS },
  // stockRoutes.js:17-20 read for all three; :21-23 (update, bulk, restock) write for SUPER_ADMIN and ADMIN.
  stock: { read: EVERY_ROLE, write: WRITERS },
  // settingsRoutes.js:7 GET /storefront/draft has no role filter; :8 (save) and :9 (publish) are SUPER_ADMIN and ADMIN.
  storefront: { read: EVERY_ROLE, write: WRITERS },
  // admin.js:26 GET /users has no role filter; :27-30 (verification emails, disable, delete) are SUPER_ADMIN and ADMIN.
  customers: { read: EVERY_ROLE, write: WRITERS },
  // discountRoutes.js:18 lists for all three; :19-21 (create, update, stop) are SUPER_ADMIN and ADMIN.
  discounts: { read: EVERY_ROLE, write: WRITERS },
  // subscriptionRoutes.js:18-20: listing, sending and deleting are all SUPER_ADMIN and ADMIN (VIEWER gets 403 reading).
  promotions: { read: WRITERS, write: WRITERS },
};

const ROLE_LABELS: Readonly<Record<StaffRole, string>> = { SUPER_ADMIN: "Super admin", ADMIN: "Admin", VIEWER: "View only" };

export function isStaffRole(role: string): role is StaffRole {
  return STAFF_ROLES.some((known) => known === role);
}

/** Plain label for the role badge; an unrecognised role is shown as it is stored. */
export function roleLabel(role: string) {
  return isStaffRole(role) ? ROLE_LABELS[role] : role;
}

export function canRead(role: string, module: AdminModuleId) {
  return isStaffRole(role) && MODULE_ACCESS[module].read.includes(role);
}

export function canWrite(role: string, module: AdminModuleId) {
  return isStaffRole(role) && MODULE_ACCESS[module].write.includes(role);
}

/** Modules the role may open, in navigation order; an unknown role gets none. */
export function permittedModules(role: string): AdminModuleId[] {
  return ADMIN_MODULE_IDS.filter((module) => canRead(role, module));
}

export function firstPermittedModule(role: string): AdminModuleId | null {
  return permittedModules(role)[0] ?? null;
}

/**
 * Where the shell should be after signing in at `route`, or `null` to stay. A route the role may open is kept
 * (deep links survive sign-in); the bare entry and modules the role may not open lead to its first permitted module.
 * Unknown routes stay, so they show "Page not found" instead of being redirected silently.
 */
export function landingRoute(role: string, route: string): string | null {
  const first = firstPermittedModule(role);
  if (first === null) return null;
  const place = parseAdminPlace(route);
  switch (place.kind) {
    case "home":
      return adminModuleRoute(first);
    case "module":
      return canRead(role, place.module) ? null : adminModuleRoute(first);
    case "preview":
      return canRead(role, "storefront") ? null : adminModuleRoute(first);
    case "product-preview":
      return canRead(role, "products") ? null : adminModuleRoute(first);
    default:
      return null;
  }
}
