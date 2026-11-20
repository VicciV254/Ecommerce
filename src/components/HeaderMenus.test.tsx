import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogCategory } from "../api/catalog";
import { buildCategoryTree } from "../store/catalogModel";
import type { CatalogValue } from "../store/CatalogContext";
import { fixtureCategory, fixtureDelivery, fixtureReturnPolicy } from "../test-support/catalogFixtures";
import { DepartmentShortcuts, DepartmentsMenu, DrawerMenu, PANEL_LEAF_LIMIT } from "./HeaderMenus";

const state = vi.hoisted(() => ({ catalog: null as CatalogValue | null }));
vi.mock("../store/CatalogContext", () => ({ useCatalog: () => state.catalog }));

const category = (id: string, name: string, parentId: string | null, order = 0) => fixtureCategory({ id, name, parentId, order, productCount: 1 });
const categories: CatalogCategory[] = [
  category("phones", "Phones & Tablets", null, 0),
  category("smartphones", "Smartphones", "phones"),
  category("fashion", "Fashion", null, 1),
  category("men", "Men's Fashion", "fashion", 0),
  category("bags", "Bags", "fashion", 1),
  ...Array.from({ length: 10 }, (_, index) => category(`men-${index}`, `Men's item ${index + 1}`, "men", index)),
];

beforeEach(() => {
  state.catalog = {
    status: "ready", error: null, mode: "live", products: [], productsById: new Map(),
    categories: buildCategoryTree(categories), designers: [], discounts: [], returnPolicy: fixtureReturnPolicy, delivery: fixtureDelivery, demonstrationOrders: false, sampleOrderRetentionDays: null, reload: vi.fn(),
  };
  window.location.hash = "#/";
});

describe("drawer departments", () => {
  it("drills from departments to groups to leaves, with labelled Back buttons and focus on each level's heading", () => {
    const onNavigate = vi.fn();
    render(<DrawerMenu root={<a href="#/about">About</a>} onNavigate={onNavigate} />);
    expect(screen.getByRole("link", { name: "All departments" }).getAttribute("href")).toBe("#/departments");
    fireEvent.click(screen.getByRole("button", { name: "Fashion" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Fashion" }));
    expect(screen.queryByRole("link", { name: "About" })).toBeNull();
    expect(screen.getByRole("link", { name: "Shop all Fashion" }).getAttribute("href")).toBe("#/shop?cat=fashion");
    // A group with narrower categories opens its own level; one without them is a link.
    expect(screen.getByRole("link", { name: "Bags" }).getAttribute("href")).toBe("#/shop?cat=bags");
    fireEvent.click(screen.getByRole("button", { name: "Men's Fashion" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Men's Fashion" }));
    expect(screen.getByRole("link", { name: "Shop all Men's Fashion" }).getAttribute("href")).toBe("#/shop?cat=men-s-fashion");
    expect(screen.getAllByRole("link", { name: /^Men's item/ })).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Back to Fashion" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Fashion" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to menu" }));
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Departments" }));
    expect(screen.getByRole("link", { name: "About" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Phones & Tablets" }));
    fireEvent.click(screen.getByRole("link", { name: "Smartphones" }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("says when departments are loading or failed, with a retry", () => {
    state.catalog = { ...state.catalog!, status: "error", error: "offline" };
    render(<DrawerMenu root={null} onNavigate={vi.fn()} />);
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Try again" }));
    expect(state.catalog.reload).toHaveBeenCalledTimes(1);
  });
});

describe("desktop departments panel", () => {
  const button = () => screen.getByRole("button", { name: "Departments" });

  it("opens on click with the first department's groups, each with up to eight leaves and View all", () => {
    render(<DepartmentsMenu />);
    expect(button().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button());
    expect(button().getAttribute("aria-expanded")).toBe("true");
    const tabs = within(screen.getByRole("tablist", { name: "Departments" })).getAllByRole("tab");
    expect(tabs.map((tab) => [tab.textContent, tab.getAttribute("aria-selected"), tab.tabIndex])).toEqual([
      ["Phones & Tablets", "true", 0], ["Fashion", "false", -1],
    ]);
    fireEvent.click(tabs[1]);
    const pane = screen.getByRole("tabpanel", { name: "Fashion" });
    expect(within(pane).getByRole("link", { name: "Shop all Fashion" }).getAttribute("href")).toBe("#/shop?cat=fashion");
    const men = within(pane).getByRole("region", { name: "Men's Fashion" });
    expect(within(men).getAllByRole("link", { name: /^Men's item/ })).toHaveLength(PANEL_LEAF_LIMIT);
    expect(within(men).getByRole("link", { name: "View all in Men's Fashion" }).getAttribute("href")).toBe("#/shop?cat=men-s-fashion");
  });

  it("moves through departments with the arrow keys, wrapping, and closes on Escape with focus back on the button", () => {
    render(<DepartmentsMenu />);
    fireEvent.click(button());
    const [phones, fashion] = within(screen.getByRole("tablist")).getAllByRole("tab");
    phones.focus();
    fireEvent.keyDown(phones, { key: "ArrowDown" });
    expect(document.activeElement).toBe(fashion);
    expect(fashion.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "Fashion" })).toBeTruthy();
    fireEvent.keyDown(fashion, { key: "ArrowDown" });
    expect(document.activeElement).toBe(phones);
    fireEvent.keyDown(phones, { key: "End" });
    expect(document.activeElement).toBe(fashion);
    fireEvent.keyDown(fashion, { key: "Escape" });
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it("closes on an outside click, returning focus to the button, and when navigating", () => {
    render(<><DepartmentsMenu /><p>Page content</p></>);
    fireEvent.click(button());
    fireEvent.click(screen.getByText("Page content"));
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button());
    fireEvent.click(button());
    fireEvent.click(screen.getByRole("link", { name: "Shop all Phones & Tablets" }));
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("opens on the department of the category being listed", () => {
    window.location.hash = "#/shop?cat=men-s-item-3";
    render(<DepartmentsMenu />);
    fireEvent.click(button());
    expect(screen.getByRole("tab", { name: "Fashion" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("phone department shortcuts", () => {
  it("links every department after All departments and marks the one being listed", () => {
    window.location.hash = "#/shop?cat=smartphones";
    render(<DepartmentShortcuts />);
    const links = within(screen.getByRole("navigation", { name: "Department shortcuts" })).getAllByRole("link");
    expect(links.map((link) => [link.textContent, link.getAttribute("href"), link.getAttribute("aria-current")])).toEqual([
      ["All departments", "#/departments", null],
      ["Phones & Tablets", "#/shop?cat=phones-tablets", "true"],
      ["Fashion", "#/shop?cat=fashion", null],
    ]);
  });

  it("keeps its row, with All departments, while the catalog loads or after it fails", () => {
    for (const status of ["loading", "error"] as const) {
      state.catalog = { ...state.catalog!, status, categories: buildCategoryTree([]) };
      const { unmount } = render(<DepartmentShortcuts />);
      const links = within(screen.getByRole("navigation", { name: "Department shortcuts" })).getAllByRole("link");
      expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([["All departments", "#/departments"]]);
      unmount();
    }
  });
});
