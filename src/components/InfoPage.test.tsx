import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigate, useRoute } from "../router";
import { InfoPage, type InfoSection } from "./InfoPage";

const titles = vi.hoisted(() => [] as string[]);
vi.mock("../store/StorefrontContext", () => ({
  useStorefront: () => ({ brandName: "Apex Cart" }),
  usePageTitle: (title: string) => { titles.push(title); },
}));

const SECTIONS: InfoSection[] = [
  { id: "first", title: "First topic", content: <p>First body</p> },
  { id: "second", title: "Second topic", content: <p>Second body</p> },
];

function Page({ ready = true }: { ready?: boolean }) {
  return (
    <InfoPage title="FAQ" updated="2026-11-18" note={<p>A note</p>} sections={SECTIONS} ready={ready}>
      <p>Introduction</p>
    </InfoPage>
  );
}

/** The app keeps the page mounted across its own section changes and mounts it on arrival from elsewhere. */
function Shell() {
  return useRoute().startsWith("/faq") ? <Page /> : <p>Another page</p>;
}

function RouteReader() {
  useRoute();
  return null;
}

let scrolled: { element: Element; options: unknown }[];
let reducedMotion: boolean;
let fontsLoaded: () => void;
/** jsdom's own `scrollY`, put back after a test that pretends the page was scrolled. */
const SCROLL_Y = Object.getOwnPropertyDescriptor(window, "scrollY");

beforeEach(() => {
  titles.length = 0;
  scrolled = [];
  reducedMotion = false;
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  // The router remembers the last route between tests; read unwatched, this address counts as a fresh load.
  window.location.hash = "#/faq";
  render(<RouteReader />).unmount();
  // jsdom implements none of these.
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element, options?: unknown) {
    scrolled.push({ element: this, options });
  };
  window.matchMedia = ((query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)" && reducedMotion })) as typeof window.matchMedia;
  const ready = new Promise<void>((resolve) => { fontsLoaded = resolve; });
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready } });
});

afterEach(() => {
  Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  Reflect.deleteProperty(window, "matchMedia");
  Reflect.deleteProperty(document, "fonts");
  if (SCROLL_Y) Object.defineProperty(window, "scrollY", SCROLL_Y);
  else Reflect.deleteProperty(window, "scrollY");
});

const heading = (name: string, level: number) => screen.getByRole("heading", { level, name });
const settle = () => act(async () => { fontsLoaded(); await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); });

describe("InfoPage layout", () => {
  it("shows the breadcrumb, a focusable h1, the update date, the note and section headings, titled with the brand", () => {
    render(<Page />);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" }).textContent).toBe("Home/FAQ");
    expect(heading("FAQ", 1).tabIndex).toBe(-1);
    expect(screen.getByText(/^Last updated/).textContent).toBe("Last updated 18 November 2026");
    expect(document.querySelector("time")?.getAttribute("datetime")).toBe("2026-11-18");
    expect(screen.getByRole("note").textContent).toBe("A note");
    for (const { id, title } of SECTIONS) {
      expect(heading(title, 2).id).toBe(id);
      expect(heading(title, 2).tabIndex).toBe(-1);
    }
    expect(titles.at(-1)).toBe("FAQ · Apex Cart");
  });

  it("links each section by route, never by a bare #id, since the hash is the route", () => {
    render(<Page />);
    const links = screen.getByRole("navigation", { name: "On this page" }).querySelectorAll("a");
    expect([...links].map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["First topic", "#/faq?section=first"], ["Second topic", "#/faq?section=second"],
    ]);
    for (const link of document.querySelectorAll("a")) expect(link.getAttribute("href")).toMatch(/^#\//);
  });

  it("lists no sections and no On this page for a short page", () => {
    render(<InfoPage title="Delivery"><p>Options</p></InfoPage>);
    expect(screen.queryByRole("navigation", { name: "On this page" })).toBeNull();
    expect(screen.queryByText(/^Last updated/)).toBeNull();
    expect(titles.at(-1)).toBe("Delivery · Apex Cart");
  });
});

describe("InfoPage section navigation", () => {
  it("scrolls a section reached in the app to the top and focuses its heading, smoothly unless motion is reduced", async () => {
    render(<Shell />);
    act(() => navigate("/faq?section=second"));
    await waitFor(() => expect(document.activeElement).toBe(heading("Second topic", 2)));
    expect(scrolled).toEqual([{ element: heading("Second topic", 2), options: { block: "start", behavior: "smooth" } }]);

    reducedMotion = true;
    act(() => navigate("/faq?section=first"));
    await waitFor(() => expect(document.activeElement).toBe(heading("First topic", 2)));
    expect(scrolled.at(-1)).toEqual({ element: heading("First topic", 2), options: { block: "start", behavior: "instant" } });
  });

  it("focuses the section, not the h1, when arriving from another page at a section", async () => {
    window.location.hash = "#/elsewhere";
    render(<Shell />);
    act(() => navigate("/faq?section=second"));
    await waitFor(() => expect(document.activeElement).toBe(heading("Second topic", 2)));
    expect(scrolled.map(({ element }) => element)).toEqual([heading("Second topic", 2)]);
  });

  it("focuses the h1 when arriving from another page without a section", async () => {
    window.location.hash = "#/elsewhere";
    render(<Shell />);
    act(() => navigate("/faq"));
    await waitFor(() => expect(document.activeElement).toBe(heading("FAQ", 1)));
    expect(scrolled).toEqual([]);
  });

  it("focuses the h1 on Back to the page itself, where the router has already scrolled to the top", async () => {
    render(<Shell />);
    act(() => navigate("/faq?section=second"));
    await waitFor(() => expect(document.activeElement).toBe(heading("Second topic", 2)));
    const scrollTo = vi.mocked(window.scrollTo);
    scrollTo.mockClear();
    act(() => window.history.back());
    await waitFor(() => expect(document.activeElement).toBe(heading("FAQ", 1)));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
    expect(scrolled).toHaveLength(1);
    // Forward returns to the section.
    act(() => window.history.forward());
    await waitFor(() => expect(document.activeElement).toBe(heading("Second topic", 2)));
    expect(scrolled).toHaveLength(2);
  });

  it("scrolls and focuses again when the link to the section already in the address is clicked, adding no entry", async () => {
    render(<Shell />);
    act(() => navigate("/faq?section=second"));
    await waitFor(() => expect(document.activeElement).toBe(heading("Second topic", 2)));
    const link = screen.getByRole("link", { name: "Second topic" });
    link.focus();
    const entries = window.history.length;
    fireEvent.click(link);
    expect(document.activeElement).toBe(heading("Second topic", 2));
    expect(scrolled).toHaveLength(2);
    expect(window.location.hash).toBe("#/faq?section=second");
    expect(window.history.length).toBe(entries);
    // A modified click is the browser's (a new tab, say), so nothing moves here; the stand-in browser opens nothing.
    document.addEventListener("click", (event) => event.preventDefault(), { once: true });
    link.focus();
    fireEvent.click(link, { ctrlKey: true });
    expect(document.activeElement).toBe(link);
    expect(scrolled).toHaveLength(2);
  });

  it("ignores an unknown section, treating it as none", async () => {
    render(<Shell />);
    act(() => navigate("/faq?section=nowhere"));
    await waitFor(() => expect(document.activeElement).toBe(heading("FAQ", 1)));
    expect(scrolled).toEqual([]);
  });
});

describe("InfoPage fresh load at a section", () => {
  it("scrolls once the content is ready and the fonts have loaded, leaving focus where the browser put it", async () => {
    window.location.hash = "#/faq?section=second";
    const { rerender } = render(<Page ready={false} />);
    await settle();
    expect(scrolled).toEqual([]);

    rerender(<Page ready />);
    await waitFor(() => expect(scrolled).toEqual([{ element: heading("Second topic", 2), options: { block: "start", behavior: "instant" } }]));
    expect(document.activeElement).toBe(document.body);
  });

  it("waits for the fonts before scrolling", async () => {
    window.location.hash = "#/faq?section=second";
    render(<Page />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(scrolled).toEqual([]);
    await settle();
    expect(scrolled).toHaveLength(1);
  });

  it("leaves the page alone when the person moved focus or scrolled before it was ready", async () => {
    window.location.hash = "#/faq?section=second";
    const { unmount } = render(<Page />);
    screen.getByRole("link", { name: "First topic" }).focus();
    await settle();
    expect(scrolled).toEqual([]);
    unmount();

    const ready = new Promise<void>((resolve) => { fontsLoaded = resolve; });
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready } });
    render(<Page />);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 240 });
    await settle();
    expect(scrolled).toEqual([]);
  });

  it("ignores an unknown section on a fresh load", async () => {
    window.location.hash = "#/faq?section=nowhere";
    render(<Page />);
    await settle();
    expect(scrolled).toEqual([]);
    expect(document.activeElement).toBe(document.body);
  });
});
