import { createRef, useLayoutEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Link, navigate, setNavigationBlocker, useRoute, useRouteState, type HeldNavigation } from "./router";

beforeEach(() => { window.location.hash = ""; });

function clickWasIntercepted(link: HTMLElement, options: MouseEventInit = {}) {
  let intercepted = false;
  document.body.addEventListener("click", (event) => {
    intercepted = event.defaultPrevented;
    event.preventDefault();
  }, { once: true });
  fireEvent(link, new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...options }));
  return intercepted;
}

describe("shared Link", () => {
  it("forwards anchor attributes, accessible names and refs", () => {
    const ref = createRef<HTMLAnchorElement>();
    render(<Link ref={ref} to="/cart" aria-label="Cart" aria-current="page" title="Open cart" data-source="header" target="_blank" rel="noopener">Icon</Link>);
    const link = screen.getByRole("link", { name: "Cart" });
    expect(ref.current).toBe(link);
    expect(link.getAttribute("href")).toBe("#/cart");
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(link.getAttribute("title")).toBe("Open cart");
    expect(link.getAttribute("data-source")).toBe("header");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener");
  });

  it("uses the hash router for an ordinary left click", () => {
    const onClick = vi.fn();
    render(<Link to="/shop" onClick={onClick}>Shop</Link>);
    expect(clickWasIntercepted(screen.getByRole("link", { name: "Shop" }))).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("#/shop");
  });

  it("respects a caller that prevents navigation", () => {
    render(<Link to="/shop" onClick={(event) => event.preventDefault()}>Shop</Link>);
    expect(clickWasIntercepted(screen.getByRole("link", { name: "Shop" }))).toBe(true);
    expect(window.location.hash).toBe("");
  });

  for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    it(`leaves ${JSON.stringify(options)} clicks to the browser`, () => {
      render(<Link to="/shop">Shop</Link>);
      expect(clickWasIntercepted(screen.getByRole("link", { name: "Shop" }), options)).toBe(false);
      expect(window.location.hash).toBe("");
    });
  }

  it("leaves new-target and download links to the browser", () => {
    render(<><Link to="/shop" target="_blank">New tab</Link><Link to="/catalog" download="catalog.html">Download</Link></>);
    expect(clickWasIntercepted(screen.getByRole("link", { name: "New tab" }))).toBe(false);
    const download = screen.getByRole("link", { name: "Download" });
    expect(download.getAttribute("download")).toBe("catalog.html");
    expect(clickWasIntercepted(download)).toBe(false);
    expect(window.location.hash).toBe("");
  });
});

function RouteProbe() {
  return <p>route:{useRoute()}</p>;
}

describe("retired routes", () => {
  // Route changes scroll to the top, which jsdom does not implement.
  beforeEach(() => { vi.spyOn(window, "scrollTo").mockImplementation(() => undefined); });

  it("replaces an old showroom link with the shop on load, adding no history entry", () => {
    window.location.hash = "#/showroom?go=events";
    const entries = window.history.length;
    render(<RouteProbe />);
    expect(screen.getByText("route:/shop")).toBeTruthy();
    expect(window.location.hash).toBe("#/shop");
    expect(window.history.length).toBe(entries);
  });

  it("replaces a showroom link followed while the app is open, so Back skips it", async () => {
    render(<RouteProbe />);
    expect(screen.getByText("route:/")).toBeTruthy();
    window.location.hash = "#/showroom/events";
    const entries = window.history.length;
    await waitFor(() => expect(screen.getByText("route:/shop")).toBeTruthy());
    expect(window.location.hash).toBe("#/shop");
    expect(window.history.length).toBe(entries);
  });

  it("leaves current routes and look-alike names untouched", () => {
    for (const hash of ["#/shop?cat=fashion", "#/showrooms", "#/toString", "#/about"]) {
      window.location.hash = hash;
      const { unmount } = render(<RouteProbe />);
      expect(screen.getByText(`route:${hash.slice(1)}`)).toBeTruthy();
      expect(window.location.hash).toBe(hash);
      unmount();
    }
  });
});

function NavigationProbe() {
  const { route, kind, previous } = useRouteState();
  return <p>{`${kind} ${route} from ${previous ?? "nowhere"}`}</p>;
}

describe("navigation kinds and history entries", () => {
  let scrollTo: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined); });

  it("pushes an entry for navigate() and starts the new page at the top", async () => {
    render(<NavigationProbe />);
    expect(screen.getByText("load / from nowhere")).toBeTruthy();
    const entries = window.history.length;
    act(() => navigate("/shop?cat=fashion"));
    await screen.findByText("push /shop?cat=fashion from /");
    expect(window.history.length).toBe(entries + 1);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "instant" });
  });

  it("replaces the current entry in place, keeping the scroll position", async () => {
    render(<NavigationProbe />);
    act(() => navigate("/shop"));
    await screen.findByText("push /shop from /");
    scrollTo.mockClear();
    const entries = window.history.length;
    act(() => navigate("/shop?sort=price-asc", { replace: true }));
    expect(screen.getByText("replace /shop?sort=price-asc from /shop")).toBeTruthy();
    expect(window.location.hash).toBe("#/shop?sort=price-asc");
    expect(window.history.length).toBe(entries);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("reports Back as a traversal to the earlier route", async () => {
    render(<NavigationProbe />);
    act(() => navigate("/shop?page=2"));
    await screen.findByText("push /shop?page=2 from /");
    act(() => navigate("/product/prod-linen-shirt"));
    await screen.findByText("push /product/prod-linen-shirt from /shop?page=2");
    act(() => window.history.back());
    await screen.findByText("traverse /shop?page=2 from /product/prod-linen-shirt");
  });

  it("adds nothing for a push to the current address", async () => {
    render(<NavigationProbe />);
    act(() => navigate("/about"));
    await screen.findByText("push /about from /");
    const entries = window.history.length;
    scrollTo.mockClear();
    act(() => navigate("/about"));
    expect(window.history.length).toBe(entries);
    expect(scrollTo).not.toHaveBeenCalled();
    // An address change made outside navigate() (typed, or by another script) counts as a traversal.
    act(() => { window.location.hash = "#/contact"; });
    await screen.findByText("traverse /contact from /about");
  });

  it("takes up an address change made after the first render but before anything listened", async () => {
    window.history.replaceState(null, "", "#/about");
    // Any hash change events still queued from earlier tests fire now, while nothing listens.
    await new Promise((resolve) => setTimeout(resolve, 0));
    render(<><NavigationProbe /><MovesBeforeListening to="#/shop?cat=fashion" /></>);
    await screen.findByText("traverse /shop?cat=fashion from /about");
  });
});

/**
 * Changes the address after the first render has read it but before anything listens (layout effects run before the
 * router subscribes), as a link followed or Back pressed at that moment does: its events are already over.
 */
function MovesBeforeListening({ to }: { to: string }) {
  useLayoutEffect(() => { window.history.pushState(null, "", to); }, [to]);
  return null;
}

describe("navigation blocker", () => {
  let release: (() => void) | null = null;
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    release = null;
  });
  afterEach(() => release?.());

  /** Holds every route change and keeps the latest one, as a guard with unsaved edits would. */
  function holdAll() {
    const held: HeldNavigation[] = [];
    release = setNavigationBlocker((attempt) => {
      held.push(attempt);
      return true;
    });
    return held;
  }

  async function visit(...routes: string[]) {
    for (const route of routes) {
      act(() => navigate(route));
      await screen.findByText(new RegExp(`^push ${route.replace(/[?]/g, "\\?")} from`));
    }
  }

  it("holds a push or a replace until it is carried out, then adds the entry once", async () => {
    render(<NavigationProbe />);
    const held = holdAll();
    const entries = window.history.length;
    act(() => navigate("/shop"));
    expect(held.map(({ to, kind }) => [to, kind])).toEqual([["/shop", "push"]]);
    expect(window.location.hash).toBe("");
    expect(screen.getByText("load / from nowhere")).toBeTruthy();

    act(() => navigate("/about", { replace: true }));
    expect(held.at(-1)).toMatchObject({ to: "/about", kind: "replace" });
    expect(window.location.hash).toBe("");

    act(() => held[0].proceed());
    await screen.findByText("push /shop from /");
    expect(window.history.length).toBe(entries + 1);
    expect(held).toHaveLength(2);
  });

  it("reverses a held Back without publishing it, then carries it out in the same direction", async () => {
    render(<NavigationProbe />);
    await visit("/a", "/b", "/c");
    const held = holdAll();
    act(() => window.history.back());
    // The address returns to the current route and the page never sees the earlier one.
    await waitFor(() => expect(window.location.hash).toBe("#/c"));
    await waitFor(() => expect(held).toHaveLength(1));
    expect(held[0]).toMatchObject({ to: "/b", kind: "traverse" });
    expect(screen.getByText("push /c from /b")).toBeTruthy();
    // Settled: the duplicate event and the reversal ask nothing more.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(held).toHaveLength(1);

    act(() => held[0].proceed());
    await screen.findByText("traverse /b from /c");
    expect(window.location.hash).toBe("#/b");
    expect(held).toHaveLength(1);
    // The history stack is intact: Forward still reaches the route that was left.
    release?.();
    act(() => window.history.forward());
    await screen.findByText("traverse /c from /b");
  });

  it("reverses a held Forward and a jump of several entries by the same distance", async () => {
    render(<NavigationProbe />);
    await visit("/a", "/b", "/c");
    act(() => window.history.go(-2));
    await screen.findByText("traverse /a from /c");
    const held = holdAll();

    act(() => window.history.forward());
    await waitFor(() => expect(held).toHaveLength(1));
    expect(held[0]).toMatchObject({ to: "/b", kind: "traverse" });
    await waitFor(() => expect(window.location.hash).toBe("#/a"));

    act(() => window.history.go(2));
    await waitFor(() => expect(held).toHaveLength(2));
    expect(held[1]).toMatchObject({ to: "/c", kind: "traverse" });
    await waitFor(() => expect(window.location.hash).toBe("#/a"));
    act(() => held[1].proceed());
    await screen.findByText("traverse /c from /a");
  });

  it("holds an address typed by hand, and carries it out on request", async () => {
    render(<NavigationProbe />);
    await visit("/a");
    const held = holdAll();
    act(() => { window.location.hash = "#/typed"; });
    await waitFor(() => expect(held).toHaveLength(1));
    expect(held[0]).toMatchObject({ to: "/typed", kind: "traverse" });
    await waitFor(() => expect(window.location.hash).toBe("#/a"));
    act(() => held[0].proceed());
    await screen.findByText("traverse /typed from /a");
  });

  it("lets every change through once the blocker is removed", async () => {
    render(<NavigationProbe />);
    const held = holdAll();
    release?.();
    act(() => navigate("/shop"));
    await screen.findByText("push /shop from /");
    act(() => window.history.back());
    await screen.findByText("traverse / from /shop");
    expect(held).toEqual([]);
  });

  it("reverses a held Back to the entry it left after an address change taken up late", async () => {
    window.history.replaceState(null, "", "#/about");
    await new Promise((resolve) => setTimeout(resolve, 0));
    render(<><NavigationProbe /><MovesBeforeListening to="#/shop?cat=fashion" /></>);
    await screen.findByText("traverse /shop?cat=fashion from /about");
    const entries = window.history.length;
    const held = holdAll();
    act(() => window.history.back());
    await waitFor(() => expect(held).toHaveLength(1));
    expect(held[0]).toMatchObject({ to: "/about", kind: "traverse" });
    // Forward again, to the entry Back left: the address and the history are as they were.
    await waitFor(() => expect(window.location.hash).toBe("#/shop?cat=fashion"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(window.location.hash).toBe("#/shop?cat=fashion");
    expect(window.history.length).toBe(entries);
    act(() => held[0].proceed());
    await screen.findByText("traverse /about from /shop?cat=fashion");
  });
});
