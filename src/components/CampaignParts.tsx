import type { CSSProperties, ReactNode } from "react";
import { Link } from "../router";
import { imageRendition, srcSetOf } from "../store/mediaModel";
import type { ResolvedCampaign } from "../store/storefrontModel";

/** Viewport where campaign artwork switches to its mobile composition (Tailwind `md`). */
const MOBILE_ARTWORK_QUERY = "(width < 48rem)";

type FocalStyle = CSSProperties & Record<"--focal-desktop" | "--focal-mobile", string>;

/** Artwork for a campaign: the mobile file below 768px when there is one, cropped at the configured focal points. */
export function CampaignArtwork({ resolved, priority, sizes }: { resolved: ResolvedCampaign; priority: boolean; sizes?: string }) {
  const { campaign, desktop, mobile } = resolved;
  if (!desktop) return null;
  const focal: FocalStyle = {
    "--focal-desktop": `${campaign.desktopFocal.x}% ${campaign.desktopFocal.y}%`,
    // Phones always use the mobile crop, applied to the desktop image when no mobile file exists.
    "--focal-mobile": `${campaign.mobileFocal.x}% ${campaign.mobileFocal.y}%`,
  };
  const desktopArt = imageRendition(desktop.url, "hero", sizes);
  const mobileArt = mobile ? imageRendition(mobile.url, "hero", sizes) : null;
  return (
    <picture>
      {mobile && mobileArt && (
        <source
          media={MOBILE_ARTWORK_QUERY}
          srcSet={srcSetOf(mobileArt)}
          sizes={mobileArt.sizes}
          width={mobile.width ?? undefined}
          height={mobile.height ?? undefined}
        />
      )}
      <img
        src={desktopArt.src}
        srcSet={desktopArt.srcSet}
        sizes={desktopArt.sizes}
        width={desktop.width ?? undefined}
        height={desktop.height ?? undefined}
        alt={desktop.alt ?? ""}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        style={focal}
        className="absolute inset-0 h-full w-full object-cover [object-position:var(--focal-desktop)] max-md:[object-position:var(--focal-mobile)]"
      />
    </picture>
  );
}

/**
 * A campaign's copy: headline, body, conditions and its button. A button whose destination needs the catalog appears
 * once the catalog confirms it; until then (and if the catalog can't be loaded) it keeps its place, unseen and out of
 * the accessibility tree, so the copy never moves around it.
 */
export function CampaignCopy({ resolved, catalogReady, variant, onDark }: {
  resolved: ResolvedCampaign;
  catalogReady: boolean;
  /** A hero's display headline, a carousel slide's (a step smaller on phones) or a band's compact one; heroes' buttons press in. */
  variant: "hero" | "slide" | "band";
  /** Light text on a dark scrim, with the gold button. */
  onDark: boolean;
}): ReactNode {
  const { campaign } = resolved;
  // Catalog targets are only linked, or reported missing, once the catalog has loaded.
  const route = campaign.cta.target === "shop" || catalogReady ? resolved.ctaRoute : null;
  const holdButton = !route && !catalogReady;
  const button = `mt-5 inline-flex min-h-[44px] items-center rounded-sm px-6 text-sm font-semibold uppercase tracking-[0.12em] transition-[color,background-color,transform] duration-(--motion-feedback) ${
    onDark ? "bg-gold-500 text-navy-900 hover:bg-gold-400" : "bg-navy-900 text-white hover:bg-gold-500 hover:text-navy-900"
  } ${variant === "band" ? "" : "motion-safe:active:scale-[0.97]"}`;
  const headline = { hero: "type-display", slide: "type-hero", band: "type-h3" }[variant];
  return (
    <div className={onDark ? "text-white" : "text-navy-900"}>
      <h2 className={`${headline} break-words`}>{campaign.title}</h2>
      {campaign.body && <p className={`mt-3 max-w-xl break-words ${onDark ? "text-white/90" : "text-navy-800"}`}>{campaign.body}</p>}
      {campaign.conditions && <p className={`mt-3 max-w-xl break-words text-sm ${onDark ? "text-on-navy-muted" : "text-muted"}`}>{campaign.conditions}</p>}
      {route && <Link to={route} className={button}>{campaign.cta.label}</Link>}
      {holdButton && <span aria-hidden="true" className={`${button} invisible`}>{campaign.cta.label}</span>}
    </div>
  );
}
