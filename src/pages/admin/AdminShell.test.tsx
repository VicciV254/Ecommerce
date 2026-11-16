import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSession } from "../../api/staffSession";
import { saveAdminSession } from "../../api/staffSession";
import { StorefrontProvider } from "../../store/StorefrontContext";
import { fixtureDiscounts, fixtureSnapshot, fixtureStorefront } from "../../test-support/catalogFixtures";
import Admin from "../Admin";
import { navigate } from "../../router";

const api = vi.hoisted(() => ({
  admin: {
    login: vi.fn(),
    analytics: { getDashboard: vi.fn(), getSales: vi.fn() },
    users: { getAll: vi.fn() },
    orders: { getAll: vi.fn(), get: vi.fn() },
    returns: { getAll: vi.fn() },
    refunds: { getAll: vi.fn() },
    attention: { getAll: vi.fn() },
    subscriptions: { getAll: vi.fn() },
  },
  catalog: { getStorefront: vi.fn() },
  catalogAdmin: { getSnapshot: vi.fn(), getStock: vi.fn(), getStorefrontDraft: vi.fn() },
}));
vi.mock("../../api/admin", async (importOriginal) => ({ ...await importOriginal<typeof import("../../api/admin")>(), adminAPI: api.admin }));
vi.mock("../../api/catalog", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../api/catalog")>(),
  catalogAPI: api.catalog,
  catalogAdminAPI: api.catalogAdmin,
}));

const WAIT = { timeout: 3000 };
const staff = (role: string): AdminSession => ({ id: `staff-${role}`, email: `${role.toLowerCase()}@example.test`, username: `${role} member`, role });
/** The fixture's live linen discount is active; its demo discount does not count. */
const discounts = fixtureDiscounts;
const emptyPage = { pagination: { page: 1, limit: 20, total: 0, pages: 0 } };

function signIn(role: string) {
  saveAdminSession(staff(role), "staff-token", "staff-refresh");
}

function renderAdmin(hash: string) {
  window.history.replaceState(null, "", `#${hash}`);
  return render(<StorefrontProvider><Admin /></StorefrontProvider>);
}

const h1 = () => screen.getAllByRole("heading", { level: 1 });
const nav = () => screen.getAllByRole("navigation", { name: "Admin" })[0];

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  // jsdom has no media queries: phone-width layout throughout (the drawer, not the column).
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  api.catalog.getStorefront.mockResolvedValue({ data: fixtureStorefront() });
  api.catalogAdmin.getSnapshot.mockResolvedValue({ data: { ...fixtureSnapshot({ mode: "admin" }), discounts } });
  api.catalogAdmin.getStock.mockResolvedValue({ data: { stocks: [] } });
  api.admin.analytics.getDashboard.mockResolvedValue({
    data: { sales: { total: 0 }, orders: { total: 0, pending: 0, processing: 0, cancelled: 0, returned: 0 }, refunds: { total: 0 }, recentOrders: [] },
  });
  api.admin.analytics.getSales.mockResolvedValue({
    data: { period: "month", totalRevenue: 0, totalOrders: 0, cancelledValue: 0, returnedValue: 0, refundedValue: 0, orders: [] },
  });
  api.admin.attention.getAll.mockResolvedValue({ data: { items: [] } });
  api.admin.orders.getAll.mockResolvedValue({ data: { orders: [], ...emptyPage } });
  api.admin.users.getAll.mockResolvedValue({ data: { users: [] } });
  api.admin.subscriptions.getAll.mockResolvedValue({ data: { subscriptions: [] } });
});

describe("admin entry and sign-in landing", () => {
  it("replaces the bare entry with the first permitted module", async () => {
    signIn("ADMIN");
    const entries = window.history.length;
    renderAdmin("/admin");
    await waitFor(() => expect(window.location.hash).toBe("#/admin/overview/dashboard"));
    expect(window.history.length).toBe(entries);
    expect(h1().map((heading) => heading.textContent)).toEqual(["Dashboard"]);
    await waitFor(() => expect(document.title).toBe("Dashboard · Admin · Apex Cart"));
  });

  it("shows the sign-in for a signed-out deep link, loads no module data, then lands on that route", async () => {
    api.admin.login.mockResolvedValue({ data: { admin: staff("ADMIN"), token: "staff-token", refreshToken: "staff-refresh" } });
    renderAdmin("/admin/orders/orders?view=all");
    expect(screen.getByRole("heading", { name: "Admin Login" })).toBeTruthy();
    expect(api.catalogAdmin.getSnapshot).not.toHaveBeenCalled();
    expect(api.admin.orders.getAll).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "admin@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "browser-only-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Orders" }, WAIT)).toBeTruthy();
    expect(window.location.hash).toBe("#/admin/orders/orders?view=all");
    await waitFor(() => expect(api.admin.orders.getAll).toHaveBeenCalledWith(expect.objectContaining({ page: 1 })));
  });

  it("lands a viewer who asked for email promotions on the dashboard instead, with a replace", async () => {
    api.admin.login.mockResolvedValue({ data: { admin: staff("VIEWER"), token: "staff-token", refreshToken: "staff-refresh" } });
    renderAdmin("/admin/customers/promotions");
    const entries = window.history.length;
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "viewer@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "browser-only-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" }, WAIT)).toBeTruthy();
    expect(window.location.hash).toBe("#/admin/overview/dashboard");
    expect(window.history.length).toBe(entries);
    expect(api.admin.subscriptions.getAll).not.toHaveBeenCalled();
  });

  it("signs out to the admin entry, which shows the sign-in", async () => {
    signIn("ADMIN");
    renderAdmin("/admin/catalog/stock");
    await screen.findByRole("heading", { level: 1, name: "Stock" });
    fireEvent.click(screen.getAllByRole("button", { name: "Sign out" })[0]);
    expect(await screen.findByRole("heading", { name: "Admin Login" })).toBeTruthy();
    expect(window.location.hash).toBe("#/admin");
  });
});

describe("shell states", () => {
  it("says a page was not found, with links to the permitted modules, and never redirects", async () => {
    signIn("VIEWER");
    renderAdmin("/admin/settings/activity");
    expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeTruthy();
    const main = screen.getByRole("main");
    const links = within(main).getAllByRole("link").map((link) => link.textContent);
    expect(links).toEqual(["Dashboard", "Sales report", "Orders", "Returns", "Refunds", "Products", "Stock", "Storefront editor", "Customers", "Discounts"]);
    expect(window.location.hash).toBe("#/admin/settings/activity");
    await waitFor(() => expect(document.title).toBe("Page not found · Admin · Apex Cart"));
  });

  it("refuses a module the role may not open, without requesting its data", async () => {
    signIn("VIEWER");
    renderAdmin("/admin/customers/promotions");
    expect(await screen.findByRole("heading", { level: 1, name: "Not available for your role" })).toBeTruthy();
    expect(screen.getByText("Your role (View only) can't open Email promotions.")).toBeTruthy();
    expect(within(screen.getByRole("main")).getByRole("link", { name: "Go to Dashboard" }).getAttribute("href")).toBe("#/admin/overview/dashboard");
    expect(within(nav()).queryByRole("link", { name: "Email promotions" })).toBeNull();
    expect(api.admin.subscriptions.getAll).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/admin/customers/promotions");
  });

  it("gives an unknown role no modules and loads no staff data", async () => {
    signIn("AUDITOR");
    renderAdmin("/admin/overview/dashboard");
    expect(await screen.findByRole("heading", { level: 1, name: "No admin access" })).toBeTruthy();
    expect(screen.getByText(/role \(AUDITOR\) has no admin access/)).toBeTruthy();
    expect(within(nav()).queryAllByRole("link")).toEqual([]);
    expect(screen.getAllByRole("link", { name: "Live store" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "Draft preview" })).toBeNull();
    expect(api.catalogAdmin.getSnapshot).not.toHaveBeenCalled();
    expect(api.admin.analytics.getDashboard).not.toHaveBeenCalled();
  });
});

describe("navigation", () => {
  it("lists only permitted modules under group labels, marks the current one and names the discount count", async () => {
    signIn("VIEWER");
    renderAdmin("/admin/orders/orders?view=closed");
    await screen.findByRole("heading", { level: 1, name: "Orders" });
    const groups = within(nav()).getAllByRole("list").map((list) => [
      list.getAttribute("aria-labelledby") && document.getElementById(list.getAttribute("aria-labelledby")!)?.textContent,
      within(list).getAllByRole("link").map((link) => link.textContent?.replace(/\d+, \d+ active$/, "")),
    ]);
    expect(groups).toEqual([
      ["Overview", ["Dashboard", "Sales report"]],
      ["Orders and returns", ["Orders", "Returns", "Refunds"]],
      ["Catalog and inventory", ["Products", "Stock"]],
      ["Storefront", ["Storefront editor"]],
      ["Customers and promotions", ["Customers", "Discounts"]],
    ]);
    // Orders stays current for every view.
    expect(within(nav()).getByRole("link", { name: "Orders" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav()).getAllByRole("link").filter((link) => link.getAttribute("aria-current"))).toHaveLength(1);
    // jsdom drops the space before visually hidden text in accessible names; browsers keep it.
    expect(await within(nav()).findByRole("link", { name: /^Discounts,\s*1 active$/ }, WAIT)).toBeTruthy();
    // Set apart from the module groups.
    expect(within(nav()).queryByRole("link", { name: "Live store" })).toBeNull();
    expect(screen.getByRole("link", { name: "Live store" }).getAttribute("href")).toBe("#/");
    expect(screen.getByRole("link", { name: "Draft preview" }).getAttribute("href")).toBe("#/admin/storefront/preview");
  });

  it("shows the account's name and plain role, and the current location", async () => {
    signIn("SUPER_ADMIN");
    renderAdmin("/admin/catalog/products");
    await screen.findByRole("heading", { level: 1, name: "Products" });
    expect(screen.getAllByText("Catalog and inventory › Products").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Super admin").length).toBeGreaterThan(0);
    const account = screen.getByRole("button", { name: /^Account:\s*SUPER_ADMIN member\s*Super admin$/ });
    expect(account.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(account);
    const panel = document.getElementById(account.getAttribute("aria-controls")!)!;
    expect(within(panel).getByText("super_admin@example.test")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Sign out" })).toBeTruthy();
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(account.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(account);
  });

  it("opens the drawer from the menu button and closes it on navigation", async () => {
    signIn("ADMIN");
    renderAdmin("/admin/overview/dashboard");
    await screen.findByRole("heading", { level: 1, name: "Dashboard" });
    const menu = screen.getByRole("button", { name: "Menu" });
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(menu);
    const drawer = screen.getByRole("dialog", { name: "Admin navigation" });
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    expect(drawer.contains(document.getElementById(menu.getAttribute("aria-controls")!))).toBe(true);
    fireEvent.click(within(drawer).getByRole("link", { name: "Stock" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Stock" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Admin navigation" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1, name: "Stock" })));
  });

  it("closes the drawer when the page changes without it, as with the browser's Back", async () => {
    signIn("ADMIN");
    renderAdmin("/admin/overview/dashboard");
    await screen.findByRole("heading", { level: 1, name: "Dashboard" });
    act(() => navigate("/admin/catalog/stock"));
    await screen.findByRole("heading", { level: 1, name: "Stock" });
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("dialog", { name: "Admin navigation" })).toBeTruthy();
    act(() => window.history.back());
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Admin navigation" })).toBeNull();
    expect(screen.getByRole("button", { name: "Menu" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps one H1 per route as the shell moves between modules", async () => {
    signIn("ADMIN");
    renderAdmin("/admin/overview/dashboard");
    await screen.findByRole("heading", { level: 1, name: "Dashboard" });
    for (const [name, label] of [["Sales report", "Sales report"], ["Customers", "Customers"], ["Email promotions", "Email promotions"]]) {
      fireEvent.click(within(nav()).getByRole("link", { name }));
      expect(await screen.findByRole("heading", { level: 1, name: label })).toBeTruthy();
      expect(h1()).toHaveLength(1);
    }
    await act(async () => undefined);
  });
});
