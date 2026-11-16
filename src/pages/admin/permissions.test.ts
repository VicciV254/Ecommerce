import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_MODULE_IDS, type AdminModuleId } from "./adminRoutes";
import { MODULE_ACCESS, canRead, canWrite, firstPermittedModule, landingRoute, permittedModules, roleLabel } from "./permissions";

const ROUTES = resolve(__dirname, "../../../backend/src/routes");
const routeFile = (name: string) => readFileSync(resolve(ROUTES, name), "utf8").split("\n");

/** The roles in the `authorize(...)` call on a backend route line (1-based), or "any staff" when it has none. */
function rolesAt(file: string, line: number): string[] | "any staff" {
  const text = routeFile(file)[line - 1];
  const call = /authorize\(([^)]*)\)/.exec(text);
  if (!call) return "any staff";
  return call[1].split(",").map((role) => role.trim().replace(/'/g, "")).sort();
}

const EVERY = ["ADMIN", "SUPER_ADMIN", "VIEWER"];

describe("permission map", () => {
  // Each module's read and write lists against the backend lines cited in permissions.ts.
  const sources: Record<AdminModuleId, { read: [string, number][]; write: [string, number][] }> = {
    dashboard: { read: [["analyticsRoutes.js", 15]], write: [] },
    analytics: { read: [["analyticsRoutes.js", 17]], write: [] },
    orders: { read: [["orderRoutes.js", 28], ["mpesaRoutes.js", 8]], write: [["orderRoutes.js", 29], ["mpesaRoutes.js", 9], ["admin.js", 34]] },
    returns: { read: [["orderRoutes.js", 28]], write: [["orderRoutes.js", 29]] },
    refunds: { read: [["orderRoutes.js", 28]], write: [["orderRoutes.js", 29]] },
    products: { read: [["index.js", 54]], write: [["productRoutes.js", 27], ["productRoutes.js", 28], ["productRoutes.js", 29], ["categoryRoutes.js", 19], ["designerRoutes.js", 19], ["index.js", 55], ["index.js", 56]] },
    stock: { read: [["stockRoutes.js", 17]], write: [["stockRoutes.js", 21], ["stockRoutes.js", 22], ["stockRoutes.js", 23]] },
    storefront: { read: [["settingsRoutes.js", 7]], write: [["settingsRoutes.js", 8], ["settingsRoutes.js", 9]] },
    customers: { read: [["admin.js", 26]], write: [["admin.js", 27], ["admin.js", 28], ["admin.js", 29], ["admin.js", 30]] },
    discounts: { read: [["discountRoutes.js", 18]], write: [["discountRoutes.js", 19], ["discountRoutes.js", 20], ["discountRoutes.js", 21]] },
    promotions: { read: [["subscriptionRoutes.js", 18]], write: [["subscriptionRoutes.js", 19], ["subscriptionRoutes.js", 20]] },
  };

  it.each(ADMIN_MODULE_IDS)("%s matches the backend's authorize lists", (module) => {
    const access = MODULE_ACCESS[module];
    for (const [file, line] of sources[module].read) {
      const roles = rolesAt(file, line);
      expect(roles === "any staff" ? EVERY : roles, `${file}:${line}`).toEqual([...access.read].sort());
    }
    for (const [file, line] of sources[module].write) {
      expect(rolesAt(file, line), `${file}:${line}`).toEqual([...access.write].sort());
    }
  });

  it("reads the role-free staff reads as open to every staff role", () => {
    expect(rolesAt("index.js", 54)).toBe("any staff");
    expect(rolesAt("settingsRoutes.js", 7)).toBe("any staff");
    expect(rolesAt("admin.js", 26)).toBe("any staff");
    expect(routeFile("settingsRoutes.js")[6]).toContain("/storefront/draft");
    expect(routeFile("admin.js")[25]).toContain("'/users'");
  });

  it("gives viewers every module but email promotions, and no writes", () => {
    expect(permittedModules("VIEWER")).toEqual(ADMIN_MODULE_IDS.filter((module) => module !== "promotions"));
    for (const module of ADMIN_MODULE_IDS) expect(canWrite("VIEWER", module)).toBe(false);
    expect(canRead("VIEWER", "promotions")).toBe(false);
  });

  it("gives administrators every module and every write the server allows", () => {
    for (const role of ["ADMIN", "SUPER_ADMIN"]) {
      expect(permittedModules(role)).toEqual([...ADMIN_MODULE_IDS]);
      for (const module of ADMIN_MODULE_IDS) {
        expect(canWrite(role, module)).toBe(module !== "dashboard" && module !== "analytics");
      }
    }
  });

  it.each(["", "admin", "OWNER", "constructor", "toString", "__proto__", "viewer "])("gives the unknown role %j nothing", (role) => {
    expect(permittedModules(role)).toEqual([]);
    expect(firstPermittedModule(role)).toBeNull();
    for (const module of ADMIN_MODULE_IDS) {
      expect(canRead(role, module)).toBe(false);
      expect(canWrite(role, module)).toBe(false);
    }
  });

  it("labels roles plainly", () => {
    expect(roleLabel("SUPER_ADMIN")).toBe("Super admin");
    expect(roleLabel("ADMIN")).toBe("Admin");
    expect(roleLabel("VIEWER")).toBe("View only");
    expect(roleLabel("AUDITOR")).toBe("AUDITOR");
  });
});

describe("sign-in landing", () => {
  it("sends the bare entry to the first permitted module", () => {
    expect(firstPermittedModule("VIEWER")).toBe("dashboard");
    expect(landingRoute("ADMIN", "/admin")).toBe("/admin/overview/dashboard");
    expect(landingRoute("VIEWER", "/admin/")).toBe("/admin/overview/dashboard");
  });

  it("keeps a deep link the role may open, including its parameters", () => {
    expect(landingRoute("ADMIN", "/admin/orders/orders?view=all&order=order-1")).toBeNull();
    expect(landingRoute("VIEWER", "/admin/catalog/products?product=prod-1")).toBeNull();
    expect(landingRoute("VIEWER", "/admin/storefront/preview")).toBeNull();
  });

  it("lands a viewer who asked for a module it may not open on its first permitted module", () => {
    expect(landingRoute("VIEWER", "/admin/customers/promotions")).toBe("/admin/overview/dashboard");
    expect(landingRoute("ADMIN", "/admin/customers/promotions")).toBeNull();
  });

  it("leaves unknown routes and unknown roles where they are, so the shell can say so", () => {
    expect(landingRoute("ADMIN", "/admin/settings/activity")).toBeNull();
    expect(landingRoute("AUDITOR", "/admin")).toBeNull();
    expect(landingRoute("AUDITOR", "/admin/overview/dashboard")).toBeNull();
  });
});
