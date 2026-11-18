import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STORE_FACTS } from "./store/storeFacts";

/** The production address the store keeps; link previews need absolute URLs. */
const SITE = "https://ecommerce-vicciv.vercel.app/";

const read = (path: string) => readFileSync(resolve(process.cwd(), path));
const head = new DOMParser().parseFromString(read("index.html").toString("utf8"), "text/html").head;
const meta = (key: string) => head.querySelector(`meta[name="${key}"], meta[property="${key}"]`)?.getAttribute("content");

describe("site metadata in index.html", () => {
  it("describes the store in the published demonstration wording", () => {
    expect(meta("description")).toBe(STORE_FACTS.demonstration);
    expect(meta("og:description")).toBe(STORE_FACTS.demonstration);
    expect([meta("og:title"), meta("og:site_name"), meta("og:type")]).toEqual([STORE_FACTS.operator, STORE_FACTS.operator, "website"]);
  });

  it("points search and link previews at the production address and its 1200×630 card", () => {
    expect(head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(SITE);
    expect(meta("og:url")).toBe(SITE);
    expect(meta("og:image")).toBe(`${SITE}og-image.png`);
    expect([meta("og:image:width"), meta("og:image:height")]).toEqual(["1200", "630"]);
    expect(meta("og:image:alt")).toBeTruthy();
    expect(meta("twitter:card")).toBe("summary_large_image");
    const card = read("public/og-image.png");
    expect([card.readUInt32BE(16), card.readUInt32BE(20)]).toEqual([1200, 630]);
  });

  it("adds no product or offer markup while the store is a demonstration", () => {
    expect(head.querySelector('script[type="application/ld+json"]')).toBeNull();
  });

  it("lets every crawler in, including the API the pages render from", () => {
    expect(read("public/robots.txt").toString("utf8")).toBe("User-agent: *\nAllow: /\n");
  });
});
