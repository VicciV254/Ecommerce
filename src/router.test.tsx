import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Link } from "./router";

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
