import { describe, expect, it } from "vitest";
import { IMAGE_PRESETS, ZOOM_WIDTH, imageRendition, zoomSource, type ImagePreset } from "./mediaModel";

const STORED = "https://res.cloudinary.com/apex-test/image/upload/v1763200000/apex-cart/products/20261115-0123456789abcdef01234567.webp";
const resizedStored = (width: number) =>
  `https://res.cloudinary.com/apex-test/image/upload/c_limit,w_${width}/q_auto/f_auto/v1763200000/apex-cart/products/20261115-0123456789abcdef01234567.webp`;
const UNSPLASH = "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?ixlib=rb-4.0.3&w=800&h=600&fit=crop&crop=faces&q=80&auto=compress&ixid=abc";
const PEXELS = "https://images.pexels.com/photos/3735641/pexels-photo-3735641.jpeg?auto=format&cs=srgb&w=1260&h=750&dpr=2&fit=crop&crop=entropy&lazy=keep";
const PRESETS = Object.keys(IMAGE_PRESETS) as ImagePreset[];
/** Candidate URLs in a srcset; Cloudinary transformation commas never precede whitespace. */
const candidates = (srcSet: string | undefined) => (srcSet ?? "").split(", ").map((entry) => entry.split(" "));

describe("image presets", () => {
  it("match the contract's widths and sizes, with a middle fallback width", () => {
    expect(IMAGE_PRESETS).toEqual({
      card: { widths: [240, 320, 480, 640, 960], fallbackWidth: 480, sizes: "(min-width: 1440px) 335px, (min-width: 1280px) calc((100vw - 100px) / 4), (min-width: 768px) calc((100vw - 72px) / 3), calc((100vw - 44px) / 2)" },
      thumbnail: { widths: [96, 160, 240], fallbackWidth: 160, sizes: "80px" },
      detail: { widths: [480, 640, 960, 1280, 1600], fallbackWidth: 960, sizes: "(min-width: 1024px) 50vw, 100vw" },
      hero: { widths: [640, 960, 1280, 1920, 2560], fallbackWidth: 1280, sizes: "100vw" },
    });
    for (const { widths, fallbackWidth } of Object.values(IMAGE_PRESETS)) {
      expect(widths).toContain(fallbackWidth);
      expect(fallbackWidth).toBeLessThan(Math.max(...widths));
    }
  });
});

describe("Cloudinary renditions", () => {
  it("insert one limit/quality/format transformation after /upload/, keeping version, public ID and extension", () => {
    expect(imageRendition(STORED, "card")).toEqual({
      src: resizedStored(480),
      srcSet: [240, 320, 480, 640, 960].map((width) => `${resizedStored(width)} ${width}w`).join(", "),
      sizes: "(min-width: 1440px) 335px, (min-width: 1280px) calc((100vw - 100px) / 4), (min-width: 768px) calc((100vw - 72px) / 3), calc((100vw - 44px) / 2)",
    });
    expect(candidates(imageRendition(STORED, "thumbnail").srcSet)).toEqual([[resizedStored(96), "96w"], [resizedStored(160), "160w"], [resizedStored(240), "240w"]]);
    expect(imageRendition(STORED, "detail").src).toBe(resizedStored(960));
    expect(imageRendition(STORED, "hero").src).toBe(resizedStored(1280));
  });

  it("never stack transformations: transformed, unversioned and other delivery forms keep src only", () => {
    const transformed = imageRendition(STORED, "detail").src;
    expect(imageRendition(transformed, "card")).toEqual({ src: transformed });
    for (const url of [
      "https://res.cloudinary.com/apex-test/image/upload/apex-cart/products/unversioned.jpg",
      "https://res.cloudinary.com/apex-test/image/upload/c_fill,w_300/v1/apex-cart/products/a.jpg",
      "https://res.cloudinary.com/apex-test/image/fetch/v1/https://example.test/a.jpg",
      "https://res.cloudinary.com/apex-test/video/upload/v1/apex-cart/clip.mp4",
      "https://res.cloudinary.com/apex-test/image/upload/v1/apex-cart/products/a.jpg?_a=tracking",
      "http://res.cloudinary.com/apex-test/image/upload/v1/apex-cart/products/a.jpg",
      "https://res.cloudinary.com.example.test/apex-test/image/upload/v1/a.jpg",
    ]) {
      expect(imageRendition(url, "card"), url).toEqual({ src: url });
    }
  });

  it("can take a layout's own sizes while keeping the preset widths", () => {
    const rendition = imageRendition(STORED, "card", "(min-width: 1024px) 20vw, 50vw");
    expect(rendition.sizes).toBe("(min-width: 1024px) 20vw, 50vw");
    expect(candidates(rendition.srcSet).map(([, width]) => width)).toEqual(["240w", "320w", "480w", "640w", "960w"]);
  });
});

describe("Unsplash renditions", () => {
  it("replace every sizing parameter, keep the photo path and other parameters", () => {
    const { src, srcSet, sizes } = imageRendition(UNSPLASH, "card");
    const url = new URL(src);
    expect(url.origin + url.pathname).toBe("https://images.unsplash.com/photo-1521572163474-6864f9cf17ab");
    expect([...url.searchParams]).toEqual([["ixlib", "rb-4.0.3"], ["ixid", "abc"], ["w", "480"], ["auto", "format"], ["q", "75"], ["fit", "max"]]);
    expect(url.searchParams.has("h")).toBe(false);
    expect(url.searchParams.has("crop")).toBe(false);
    expect(candidates(srcSet).map(([candidate, width]) => [new URL(candidate).searchParams.get("w"), width])).toEqual(
      [["240", "240w"], ["320", "320w"], ["480", "480w"], ["640", "640w"], ["960", "960w"]],
    );
    expect(sizes).toBe(IMAGE_PRESETS.card.sizes);
  });

  it("are idempotent: resizing a rendition sets the same parameters instead of adding more", () => {
    const first = imageRendition(UNSPLASH, "detail");
    const again = imageRendition(first.src, "detail");
    expect(again).toEqual(first);
    expect(first.src.match(/[?&]w=/g)).toHaveLength(1);
  });
});

describe("Pexels renditions", () => {
  it("set compression, the tiny sRGB profile and the width, drop other sizing parameters and keep the path", () => {
    const { src, srcSet, sizes } = imageRendition(PEXELS, "card");
    const url = new URL(src);
    expect(url.origin + url.pathname).toBe("https://images.pexels.com/photos/3735641/pexels-photo-3735641.jpeg");
    expect([...url.searchParams]).toEqual([["auto", "compress"], ["cs", "tinysrgb"], ["lazy", "keep"], ["w", "480"]]);
    expect(candidates(srcSet).map(([candidate, width]) => [new URL(candidate).searchParams.get("w"), width])).toEqual(
      [["240", "240w"], ["320", "320w"], ["480", "480w"], ["640", "640w"], ["960", "960w"]],
    );
    expect(sizes).toBe(IMAGE_PRESETS.card.sizes);
  });

  it("produce the verified delivery form and are idempotent", () => {
    expect(imageRendition("https://images.pexels.com/photos/1092644/pexels-photo-1092644.jpeg", "card").srcSet)
      .toContain("https://images.pexels.com/photos/1092644/pexels-photo-1092644.jpeg?auto=compress&cs=tinysrgb&w=320 320w");
    const first = imageRendition(PEXELS, "hero");
    expect(imageRendition(first.src, "hero")).toEqual(first);
    expect(first.src.match(/[?&]w=/g)).toHaveLength(1);
  });
});

describe("other addresses", () => {
  it.each([
    "/images/placeholder.jpg",
    "https://media.example.test/linen-front.jpg",
    "http://images.unsplash.com/photo-1?w=800",
    "https://images.unsplash.com.example.test/photo-1?w=800",
    "https://plus.unsplash.com/premium_photo-1?w=800",
    "https://images.pexels.com/photos/3735641/pexels-photo-3735641.png?w=800",
    "https://images.pexels.com/photos/abc/pexels-photo.jpeg?w=800",
    "https://images.pexels.com/videos/3045163/free-video-3045163.jpg?w=800",
    "http://images.pexels.com/photos/3735641/pexels-photo-3735641.jpeg?w=800",
    "https://images.pexels.com.example.test/photos/3735641/pexels-photo-3735641.jpeg",
    "https://www.pexels.com/photo/linen-shirt-3735641/",
    "not a url",
  ])("%s keeps src only, with no srcSet or sizes", (url) => {
    expect(imageRendition(url, "card")).toEqual({ src: url });
    expect(imageRendition(url, "hero", "50vw")).toEqual({ src: url });
  });
});

describe("zoom", () => {
  it("builds one 2400px rendition, or returns the original address", () => {
    expect(ZOOM_WIDTH).toBe(2400);
    expect(zoomSource(STORED)).toBe(resizedStored(2400));
    expect(new URL(zoomSource(UNSPLASH)).searchParams.get("w")).toBe("2400");
    expect([...new URL(zoomSource(PEXELS)).searchParams]).toEqual([["auto", "compress"], ["cs", "tinysrgb"], ["lazy", "keep"], ["w", "2400"]]);
    expect(zoomSource("/images/placeholder.jpg")).toBe("/images/placeholder.jpg");
  });

  it("is never offered in any preset's srcSet", () => {
    for (const preset of PRESETS) {
      for (const url of [STORED, UNSPLASH, PEXELS]) {
        const { src, srcSet } = imageRendition(url, preset);
        expect(`${src} ${srcSet}`).not.toMatch(/w_2400|[?&]w=2400/);
        expect(IMAGE_PRESETS[preset].widths).not.toContain(ZOOM_WIDTH);
      }
    }
  });
});
