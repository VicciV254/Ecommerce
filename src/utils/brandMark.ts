/**
 * The Apex Cart mark: a gold "A" blade with two speed strokes. The paths and the square, centred view box
 * must stay identical to the canonical artwork in `public/brand/apex-cart-mark.svg`.
 */
export const BRAND_MARK_VIEW_BOX = "31 33.5 575 575";

export const BRAND_MARK_PATHS = [
  "M318 50L560 548C574 575 588 588 606 592L451 592L260 178Z",
  "M122 446C150 395 215 366 315 363L280 440Z",
  "M31 590C75 520 150 492 266 490L221 590Z",
] as const;

/** Fixed print colour: navy on paper, independent of any published screen theme. */
export const BRAND_NAVY = "#14213D";

/** Gold-400 → gold-500 → gold-600, kept for marks of 64px and more. */
export const BRAND_GRADIENT_STOPS = [
  { offset: 0, color: "#E4BE61" },
  { offset: 0.55, color: "#D4A73C" },
  { offset: 1, color: "#B88A26" },
] as const;

/** Smallest mark that may carry the gradient; below it the flat tone stays crisp. */
export const GRADIENT_MIN_SIZE = 64;

/** Standalone SVG markup of the flat mark, for documents written outside React (printed receipts). */
export function brandMarkSvg(fill: string, size: string) {
  const paths = BRAND_MARK_PATHS.map((path) => `<path d="${path}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BRAND_MARK_VIEW_BOX}" width="${size}" height="${size}" aria-hidden="true" focusable="false"><g fill="${fill}">${paths}</g></svg>`;
}
