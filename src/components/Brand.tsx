import { useId } from "react";
import { BRAND_GRADIENT_STOPS, BRAND_MARK_PATHS, BRAND_MARK_VIEW_BOX, GRADIENT_MIN_SIZE } from "../utils/brandMark";

type MarkTone = "gold" | "gradient" | "navy";
type FlatTone = Exclude<MarkTone, "gradient">;

/** Flat tones follow the published theme: gold is the secondary colour, navy the primary. */
const FLAT_FILL: Record<FlatTone, string> = { gold: "fill-gold-500", navy: "fill-navy-900" };

/**
 * The mark alone. It is always decorative: every placement shows the live brand name beside it.
 * `size` is the base edge in px (`className` may grow it at breakpoints); below 64px a gradient falls back to flat gold.
 */
export function BrandMark({ size, tone, className = "" }: { size: number; tone: MarkTone; className?: string }) {
  const gradientId = `apex-mark-${useId().replace(/[^\w-]/g, "")}`;
  const gradient = tone === "gradient" && size >= GRADIENT_MIN_SIZE;
  const fill = gradient ? "" : FLAT_FILL[tone === "navy" ? "navy" : "gold"];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={BRAND_MARK_VIEW_BOX}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${fill} ${className}`}
    >
      {gradient && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            {BRAND_GRADIENT_STOPS.map((stop) => <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />)}
          </linearGradient>
        </defs>
      )}
      <g fill={gradient ? `url(#${gradientId})` : undefined}>
        {BRAND_MARK_PATHS.map((path) => <path key={path} d={path} />)}
      </g>
    </svg>
  );
}

type LockupSize = "sm" | "md" | "lg" | "xl";

/** Mark edge (px), how it grows (px too, so 200% text never doubles it), and the name size for each lockup size. */
const LOCKUP_SIZES: Record<LockupSize, { mark: number; markGrowth: string; name: string }> = {
  /** 32px mark, 16px name: the admin bar. */
  sm: { mark: 32, markGrowth: "", name: "text-base" },
  /** Phone header 32px + 16px, desktop header 40px + 24px. */
  md: { mark: 32, markGrowth: "lg:size-[40px]", name: "text-base lg:text-2xl" },
  /** 64px growing to 80px: the sign-in band. */
  lg: { mark: 64, markGrowth: "md:size-[80px]", name: "text-xl" },
  /** 80px growing to 96px: the footer. */
  xl: { mark: 80, markGrowth: "md:size-[96px]", name: "text-xl md:text-2xl" },
};

/**
 * Mark plus the live brand name in Marcellus capitals (CSS only, so assistive technology reads the name as written).
 * The wrapping link or heading takes its accessible name from the visible text. On navy the mark is gold, with the
 * gradient from 64px; on light surfaces both are navy. Stacked lockups on navy set the name in gold-400.
 */
export function BrandLogo({ name, surface, layout = "horizontal", size = "sm", className = "" }: {
  name: string;
  surface: "navy" | "light";
  layout?: "horizontal" | "stacked";
  size?: LockupSize;
  className?: string;
}) {
  const { mark, markGrowth, name: nameSize } = LOCKUP_SIZES[size];
  const tone: MarkTone = surface === "light" ? "navy" : mark >= GRADIENT_MIN_SIZE ? "gradient" : "gold";
  const nameColor = surface === "light" ? "text-navy-900" : layout === "stacked" ? "text-gold-400" : "text-white";
  const arrangement = layout === "stacked" ? "flex-col gap-3 text-center" : "gap-2 lg:gap-3";
  // Centred (stacked) names cancel their trailing letter-spacing so they sit centred; a horizontal name doesn't need
  // to, and a negative margin there would poke out of a row that wraps the name.
  const trailing = layout === "stacked" ? "-mr-[0.14em]" : "";
  return (
    // A store name of any length (the API allows 100 characters) wraps between words inside the space it is given,
    // so the lockup never widens its row or the page, including with enlarged text.
    <span className={`inline-flex min-w-0 max-w-full items-center ${arrangement} ${className}`}>
      <BrandMark size={mark} tone={tone} className={markGrowth} />
      <span className={`${trailing} min-w-0 max-w-full font-wordmark uppercase leading-none tracking-[0.14em] [overflow-wrap:break-word] ${nameSize} ${nameColor}`}>
        {name}
      </span>
    </span>
  );
}
