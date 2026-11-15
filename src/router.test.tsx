import { createRef } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Link, navigate, useRoute, useRouteState } from "./router";

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
});
