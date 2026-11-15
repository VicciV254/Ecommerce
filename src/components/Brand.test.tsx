import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BRAND_MARK_PATHS, BRAND_MARK_VIEW_BOX, brandMarkSvg } from "../utils/brandMark";
import { BrandLogo, BrandMark } from "./Brand";

const canonical = readFileSync(resolve(process.cwd(), "public/brand/apex-cart-mark.svg"), "utf8");
const numbers = (value: string) => value.trim().split(/[\s,]+/).map(Number);

function svgIn(container: HTMLElement) {
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("No mark rendered");
  return svg;
}

describe("brand mark artwork", () => {
  it("uses exactly the canonical file's paths and square, centred view box", () => {
    const document = new DOMParser().parseFromString(canonical, "image/svg+xml");
    const paths = [...document.querySelectorAll("path")].map((path) => path.getAttribute("d"));
    expect(paths).toEqual([...BRAND_MARK_PATHS]);
    expect(numbers(BRAND_MARK_VIEW_BOX)).toEqual(numbers(document.documentElement.getAttribute("viewBox") ?? ""));
    const [, , width, height] = numbers(BRAND_MARK_VIEW_BOX);
    expect(width).toBe(height);
  });

  it("renders the same paths in the component and in standalone print markup", () => {
    const { container } = render(<BrandMark size={32} tone="navy" />);
    expect([...container.querySelectorAll("path")].map((path) => path.getAttribute("d"))).toEqual([...BRAND_MARK_PATHS]);
    const printed = new DOMParser().parseFromString(brandMarkSvg("#14213D", "10mm"), "image/svg+xml").documentElement;
    expect([...printed.querySelectorAll("path")].map((path) => path.getAttribute("d"))).toEqual([...BRAND_MARK_PATHS]);
    expect(printed.getAttribute("width")).toBe("10mm");
    expect(printed.querySelector("g")?.getAttribute("fill")).toBe("#14213D");
  });
});

describe("BrandMark tones", () => {
  it("is decorative and flat gold or navy at small sizes", () => {
    const gold = svgIn(render(<BrandMark size={32} tone="gold" />).container);
    expect(gold.getAttribute("aria-hidden")).toBe("true");
    expect(gold.getAttribute("class")).toContain("fill-gold-500");
    expect(svgIn(render(<BrandMark size={32} tone="navy" />).container).getAttribute("class")).toContain("fill-navy-900");
  });

  it("keeps a requested gradient flat below 64px, and draws it from 64px with a unique id per mark", () => {
    const small = svgIn(render(<BrandMark size={40} tone="gradient" />).container);
    expect(small.querySelector("linearGradient")).toBeNull();
    expect(small.getAttribute("class")).toContain("fill-gold-500");

    const { container } = render(<><BrandMark size={64} tone="gradient" /><BrandMark size={96} tone="gradient" /></>);
    const marks = [...container.querySelectorAll("svg")];
    const ids = marks.map((mark) => mark.querySelector("linearGradient")?.id);
    expect(new Set(ids).size).toBe(2);
    for (const [index, mark] of marks.entries()) {
      expect(mark.querySelector("g")?.getAttribute("fill")).toBe(`url(#${ids[index]})`);
      expect([...mark.querySelectorAll("stop")].map((stop) => stop.getAttribute("stop-color"))).toEqual(["#E4BE61", "#D4A73C", "#B88A26"]);
    }
  });
});

describe("BrandLogo", () => {
  it("names its link with the live brand name, never the hidden mark", () => {
    render(<a href="#/"><BrandLogo name="Apex Cart" surface="navy" size="md" /></a>);
    const link = screen.getByRole("link", { name: "Apex Cart" });
    expect(link.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    // Capitals come from CSS only, so the DOM text (and speech) keeps the written name.
    expect(screen.getByText("Apex Cart").className).toContain("uppercase");
  });

  it("names a heading the same way in the stacked lockup", () => {
    render(<h2><BrandLogo name="Apex Cart" surface="navy" layout="stacked" size="xl" /></h2>);
    expect(screen.getByRole("heading", { name: "Apex Cart" })).toBeTruthy();
  });

  it.each([
    { surface: "navy", layout: "horizontal", size: "md", markClass: "fill-gold-500", gradient: false, nameClass: "text-white" },
    { surface: "navy", layout: "stacked", size: "xl", markClass: null, gradient: true, nameClass: "text-gold-400" },
    { surface: "navy", layout: "stacked", size: "lg", markClass: null, gradient: true, nameClass: "text-gold-400" },
    { surface: "light", layout: "horizontal", size: "sm", markClass: "fill-navy-900", gradient: false, nameClass: "text-navy-900" },
    { surface: "light", layout: "stacked", size: "xl", markClass: "fill-navy-900", gradient: false, nameClass: "text-navy-900" },
  ] as const)("$layout $size on $surface: mark $markClass (gradient $gradient), name $nameClass", ({ surface, layout, size, markClass, gradient, nameClass }) => {
    const { container } = render(<BrandLogo name="Apex Cart" surface={surface} layout={layout} size={size} />);
    const mark = svgIn(container);
    expect(Boolean(mark.querySelector("linearGradient"))).toBe(gradient);
    if (markClass) expect(mark.getAttribute("class")).toContain(markClass);
    expect(screen.getByText("Apex Cart").className).toContain(nameClass);
  });
});
