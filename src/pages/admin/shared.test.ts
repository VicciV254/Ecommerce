import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isAcceptedImageUrl } from "./shared";

describe("isAcceptedImageUrl", () => {
  it.each([
    "https://media.example.test/linen-front.jpg",
    "https://images.unsplash.com/photo-1?w=800&q=80",
    "/images/placeholder.jpg",
  ])("accepts %s", (value) => {
    expect(isAcceptedImageUrl(value)).toBe(true);
  });

  it.each([
    "http://media.example.test/a.jpg",
    "https://user:pass@media.example.test/a.jpg",
    "/images/../secret.jpg",
    "not a url",
  ])("still rejects %s", (value) => {
    expect(isAcceptedImageUrl(value)).toBe(false);
  });

  it.each([
    ["a space", "https://media.example.test/a b.jpg"],
    ["an extra srcset candidate", "https://media.example.test/a.jpg 2000w, https://elsewhere.example/x.jpg"],
    ["a tab", "https://media.example.test/a\tb.jpg"],
    ["a line break", "https://media.example.test/a\nb.jpg"],
    ["a no-break space", "https://media.example.test/a\u00a0b.jpg"],
    ["a NUL character", "https://media.example.test/a\u0000b.jpg"],
    ["DEL", "https://media.example.test/a\u007fb.jpg"],
    ["a C1 control character", "https://media.example.test/a\u0085b.jpg"],
    ["a space in a site path", "/images/a b.jpg"],
    ["leading whitespace", " https://media.example.test/a.jpg"],
  ])("[7] rejects an address containing %s", (_label, value) => {
    expect(isAcceptedImageUrl(value)).toBe(false);
  });
});

describe("text sizes", () => {
  /** Every source file of the app (tests aside). */
  const sources = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });

  it("sets text in rem, never px, so it grows with the browser's text size", () => {
    const pixelText = sources(resolve(process.cwd(), "src")).flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(/\btext-\[[\d.]+px\]/g)].map(([found]) => `${path.replace(process.cwd(), "")}: ${found}`));
    expect(pixelText).toEqual([]);
  });
});
