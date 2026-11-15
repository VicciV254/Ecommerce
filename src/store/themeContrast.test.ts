import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fixtureStorefrontSettings } from "../test-support/catalogFixtures";
import { COLOR_SLOTS } from "./storefrontTheme";

/** WCAG 2.2 minimums: normal text, then large text and essential UI boundaries (controls, focus rings). */
const TEXT = 4.5;
const UI = 3;

// Vitest runs from the repository root; jsdom's import.meta.url is not a file URL.
const readRepositoryFile = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const css = readRepositoryFile("src/index.css");
const apiDefaults = JSON.parse(readRepositoryFile("backend/src/data/storefront-defaults.json")) as {
  theme: { colors: Record<string, string> };
};

/** Every `--color-*` declared in the stylesheet's theme blocks, with role aliases resolved to their hex value. */
function themeColors(source: string) {
  const declared = new Map<string, string>();
  for (const [, name, value] of source.matchAll(/--color-([\w-]+):\s*([^;]+);/g)) declared.set(name, value.trim());
  const resolve = (name: string, seen: string[] = []): string => {
    const value = declared.get(name);
    if (!value) throw new Error(`--color-${name} is not declared`);
    const alias = /^var\(--color-([\w-]+)\)$/.exec(value);
    if (!alias) {
      if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`--color-${name} is not a 6-digit hex colour: ${value}`);
      return value.toLowerCase();
    }
    if (seen.includes(alias[1])) throw new Error(`--color-${name} has a circular alias`);
    return resolve(alias[1], [...seen, name]);
  };
  return (name: string) => resolve(name);
}

function luminance(hex: string) {
  const [red, green, blue] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const color = themeColors(css);
const LIGHT_SURFACES = ["surface", "surface-page", "surface-soft", "surface-warm"];
const CONTENT_SURFACES = ["surface", "surface-page"];
const on = (foregrounds: string[], backgrounds: string[], minimum: number, use: string) =>
  foregrounds.flatMap((foreground) => backgrounds.map((background) => ({ foreground, background, minimum, use })));

/** Default-theme pairs the storefront actually renders; a token used on a surface not listed here is unchecked. */
const PAIRS = [
  ...on(["navy-900", "navy-800", "muted", "gold-text", "link", "link-hover"], LIGHT_SURFACES, TEXT, "text on light surfaces"),
  ...on(["navy-900"], ["gold-500", "gold-400", "gold-600"], TEXT, "commerce button labels on gold"),
  ...on(["surface", "on-navy-muted", "gold-400", "gold-500"], ["navy-900"], TEXT, "header, footer and admin bar text on navy"),
  ...on(["surface"], ["navy-800", "success", "error", "coral", "info"], TEXT, "white labels on filled buttons and badges"),
  ...on(["success", "warning", "error", "info"], CONTENT_SURFACES, TEXT, "status text in content"),
  { foreground: "success", background: "success-tint", minimum: TEXT, use: "success notice" },
  { foreground: "warning", background: "warning-tint", minimum: TEXT, use: "warning notice" },
  { foreground: "error", background: "error-tint", minimum: TEXT, use: "error notice" },
  { foreground: "info", background: "info-tint", minimum: TEXT, use: "information notice" },
  ...on(["control"], ["surface", "surface-page", "surface-soft"], UI, "form control borders"),
  ...on(["focus"], LIGHT_SURFACES, UI, "focus ring on light surfaces"),
  { foreground: "gold-400", background: "navy-900", minimum: UI, use: "focus ring on navy" },
  ...on(["surface", "gold-500"], ["navy-900"], UI, "white fields and gold buttons on navy"),
];

describe("default theme contrast", () => {
  it.each(PAIRS)("$foreground on $background reaches $minimum:1 ($use)", ({ foreground, background, minimum }) => {
    expect(contrast(color(foreground), color(background))).toBeGreaterThanOrEqual(minimum);
  });

  it("measures the WCAG reference pairs exactly", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#14213d", "#ffffff")).toBeCloseTo(15.97, 2);
    expect(contrast("#765619", "#f4f1e9")).toBeCloseTo(5.97, 2);
  });

  it("does not let gold 500 pass as text or an unbordered control on light surfaces", () => {
    for (const background of LIGHT_SURFACES) expect(contrast(color("gold-500"), color(background))).toBeLessThan(UI);
  });
});

describe("pre-publication paint", () => {
  it.each(COLOR_SLOTS)("$variable matches the API's initial $key and the shared storefront fixture", ({ key, variable }) => {
    const value = color(variable.replace("--color-", ""));
    expect(value).toBe(apiDefaults.theme.colors[key].toLowerCase());
    expect(value).toBe(fixtureStorefrontSettings().theme.colors[key].toLowerCase());
  });
});
