import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureCategory } from "../test-support/catalogFixtures";
import { DepartmentRail } from "./DepartmentRail";

const departments = Array.from({ length: 14 }, (_, index) => fixtureCategory({ id: `dept-${index}`, name: `Department ${index}`, productCount: 3 }));

/** jsdom does no layout: give the rail a size and scroll position, then let it measure as a scroll would. */
async function layOut(rail: HTMLElement, { scrollLeft, clientWidth = 400, scrollWidth = 1400 }: { scrollLeft: number; clientWidth?: number; scrollWidth?: number }) {
  Object.defineProperties(rail, {
    scrollLeft: { configurable: true, value: scrollLeft },
    clientWidth: { configurable: true, value: clientWidth },
    scrollWidth: { configurable: true, value: scrollWidth },
  });
  fireEvent.scroll(rail);
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

const controls = () => screen.queryAllByRole("button").map((button) => button.getAttribute("aria-label"));

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

describe("department rail", () => {
  it("shows Previous and Next only when the rail can move that way", async () => {
    render(<DepartmentRail title="Shop by department" items={departments} />);
    const rail = screen.getByRole("list", { name: "Shop by department" });
    expect(screen.getAllByRole("link", { name: /Department \d+/ })).toHaveLength(14);
    expect(screen.getByRole("link", { name: "All departments" }).getAttribute("href")).toBe("#/departments");
    await layOut(rail, { scrollLeft: 0 });
    expect(controls()).toEqual(["Next departments"]);
    await layOut(rail, { scrollLeft: 500 });
    expect(controls()).toEqual(["Previous departments", "Next departments"]);
    await layOut(rail, { scrollLeft: 1000 });
    expect(controls()).toEqual(["Previous departments"]);
    // Everything fits: no controls at all.
    await layOut(rail, { scrollLeft: 0, clientWidth: 1400 });
    expect(controls()).toEqual([]);
  });

  it("moves by most of the visible width per press, without smooth scrolling under reduced motion", async () => {
    render(<DepartmentRail title="Shop by department" items={departments} />);
    const rail = screen.getByRole("list", { name: "Shop by department" });
    const scrollBy = vi.fn();
    rail.scrollBy = scrollBy;
    await layOut(rail, { scrollLeft: 500 });
    fireEvent.click(screen.getByRole("button", { name: "Next departments" }));
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 340, behavior: "smooth" });
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    fireEvent.click(screen.getByRole("button", { name: "Previous departments" }));
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -340, behavior: "auto" });
  });

  it("hands focus to the remaining button when the focused one disappears at the end", async () => {
    render(<DepartmentRail title="Shop by department" items={departments} />);
    const rail = screen.getByRole("list", { name: "Shop by department" });
    await layOut(rail, { scrollLeft: 500 });
    screen.getByRole("button", { name: "Next departments" }).focus();
    await layOut(rail, { scrollLeft: 1000 });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Previous departments" }));
    await layOut(rail, { scrollLeft: 0 });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next departments" }));
  });
});
