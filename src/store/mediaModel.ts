/**
 * Responsive renditions built from a stored image address, with no backend calls. Only Cloudinary's stored
 * upload form and Unsplash and Pexels photo addresses can be resized; any other address is used as it is.
 */

export type ImagePreset = "card" | "thumbnail" | "detail" | "hero";

type PresetSpec = {
  /** Candidate widths offered in `srcSet`. */
  widths: readonly number[];
  /** Plain `src` width for browsers that ignore `srcSet`: a middle size, never the largest. */
  fallbackWidth: number;
  sizes: string;
};

export const IMAGE_PRESETS: Readonly<Record<ImagePreset, PresetSpec>> = {
  card: { widths: [240, 320, 480, 640, 960], fallbackWidth: 480, sizes: "(min-width: 1280px) 300px, (min-width: 768px) 33vw, 50vw" },
  thumbnail: { widths: [96, 160, 240], fallbackWidth: 160, sizes: "80px" },
  detail: { widths: [480, 640, 960, 1280, 1600], fallbackWidth: 960, sizes: "(min-width: 1024px) 50vw, 100vw" },
  hero: { widths: [640, 960, 1280, 1920, 2560], fallbackWidth: 1280, sizes: "100vw" },
};

/** The zoom viewer's single large rendition; it is never offered in a `srcSet`. */
export const ZOOM_WIDTH = 2400;

export type ImageRendition = { src: string; srcSet?: string; sizes?: string };

/** `https://res.cloudinary.com/<cloud>/image/upload/v<version>/<public_id>.<ext>`: the only Cloudinary form resized here. */
const CLOUDINARY_STORED = /^(https:\/\/res\.cloudinary\.com\/[^/?#\s]+\/image\/upload\/)(v\d+\/[^?#\s]+\.[A-Za-z0-9]+)$/;

/** A CDN sized by query parameters: `remove` goes first, then each `set` pair replaces its parameter; others are kept. */
type QueryRule = { origin: string; path: RegExp; remove: readonly string[]; set: (width: number) => [string, string][] };
const QUERY_RULES: readonly QueryRule[] = [
  {
    // https://images.unsplash.com/<photo>?...
    origin: "https://images.unsplash.com",
    path: /^\/./,
    remove: ["w", "h", "fit", "crop", "q", "auto"],
    set: (width) => [["w", String(width)], ["auto", "format"], ["q", "75"], ["fit", "max"]],
  },
  {
    // https://images.pexels.com/photos/<id>/<file>.jpeg?...
    origin: "https://images.pexels.com",
    path: /^\/photos\/\d+\/[^/]+\.jpeg$/,
    remove: ["w", "h", "dpr", "fit", "crop"],
    set: (width) => [["auto", "compress"], ["cs", "tinysrgb"], ["w", String(width)]],
  },
];

type Resizer = (width: number) => string;

function resizerFor(url: string): Resizer | null {
  const stored = CLOUDINARY_STORED.exec(url);
  if (stored) {
    const [, upload, asset] = stored;
    // Inserted once, directly after /upload/; already transformed addresses never match, so nothing stacks.
    return (width) => `${upload}c_limit,w_${width}/q_auto/f_auto/${asset}`;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const rule = QUERY_RULES.find((candidate) => candidate.origin === parsed.origin && candidate.path.test(parsed.pathname));
  if (!rule) return null;
  return (width) => {
    const resized = new URL(parsed);
    for (const key of rule.remove) resized.searchParams.delete(key);
    for (const [key, value] of rule.set(width)) resized.searchParams.set(key, value);
    return resized.toString();
  };
}

/**
 * `src`, `srcSet` and `sizes` for a stored address, such as a media asset's URL or an order line's image.
 * `sizes` replaces the preset's value where a layout renders the image at other widths.
 * Addresses that cannot be resized get `src` only.
 */
export function imageRendition(url: string, preset: ImagePreset, sizes?: string): ImageRendition {
  const resize = resizerFor(url);
  if (!resize) return { src: url };
  const { widths, fallbackWidth, sizes: presetSizes } = IMAGE_PRESETS[preset];
  return {
    src: resize(fallbackWidth),
    srcSet: widths.map((width) => `${resize(width)} ${width}w`).join(", "),
    sizes: sizes ?? presetSizes,
  };
}

/** The zoom viewer's rendition, built only when zoom opens; addresses that cannot be resized are returned unchanged. */
export function zoomSource(url: string): string {
  return resizerFor(url)?.(ZOOM_WIDTH) ?? url;
}

/**
 * A `srcset` value: the rendition candidates, or else the address as exactly one candidate. Whitespace separates
 * candidates and descriptors in `srcset`, so it is percent-encoded rather than allowed to add a candidate.
 */
export function srcSetOf(rendition: ImageRendition): string {
  return rendition.srcSet ?? rendition.src.replace(/[\t\n\f\r ]/g, encodeURIComponent);
}
