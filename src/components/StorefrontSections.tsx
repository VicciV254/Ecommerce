import type { CSSProperties, ReactNode } from "react";
import type { MediaAsset, StorefrontSettings } from "../api/catalog";
import { Link } from "../router";
import { useCatalog, type CatalogValue } from "../store/CatalogContext";
import { imageRendition, srcSetOf } from "../store/mediaModel";
import { listingRoute } from "../store/listingQuery";
import {
  resolveCampaign,
  sectionCategories,
  sectionProducts,
  type ResolvedCampaign,
} from "../store/storefrontModel";
import { DepartmentRail, DepartmentRailSkeleton } from "./DepartmentRail";
import { ProductCard } from "./ProductCard";
import { Container, ErrorPanel, SampleImageLabel, SectionTitle } from "./ui";

type Section = StorefrontSettings["sections"][number];

/** Viewport where campaign artwork switches to its mobile composition (Tailwind `md`). */
const MOBILE_ARTWORK_QUERY = "(width < 48rem)";
/** Split heroes show their artwork in one of two columns from 768px. */
const SPLIT_HERO_SIZES = "(min-width: 48rem) 50vw, 100vw";
/** Promotion bands give their artwork a third of the band from 768px (the page Container is 1440px at most). */
const BAND_SIZES = "(min-width: 90rem) 459px, (min-width: 48rem) 33vw, 100vw";
/** Product cards a section shows: 4 on phones, 6 from 768px and 8 from 1280px; "View all" leads to the rest. */
const VISIBLE_FROM: readonly string[] = ["", "", "", "", "hidden md:block", "hidden md:block", "hidden xl:block", "hidden xl:block"];

type SectionsProps = {
  settings: StorefrontSettings;
  mediaById: ReadonlyMap<string, MediaAsset>;
  /** Staff preview lists unavailable references; shoppers never see substitutes. */
  showProblems?: boolean;
};

/** Whether a section shows shoppers anything in the current catalog state; staff-only problem notes do not count. */
function showsShoppersContent(section: Section, settings: StorefrontSettings, catalog: CatalogValue) {
  if (section.type === "campaign") return settings.campaigns.some((campaign) => campaign.id === section.campaignId);
  if (catalog.status !== "ready") return catalog.status === "loading";
  const { items } = section.type === "departments" ? sectionCategories(section, catalog) : sectionProducts(section, catalog);
  return items.length > 0;
}

/**
 * The published sections, enabled ones only, in published order; nothing is added or restored around them. The first
 * campaign shoppers can see is the page's hero (it never rotates); later campaigns render as compact promotion bands.
 */
export function StorefrontSections({ settings, mediaById, showProblems = false }: SectionsProps) {
  const catalog = useCatalog();
  const sections = settings.sections.filter((section) => section.enabled);
  const usesCatalog = sections.some((section) => section.type !== "campaign");
  // The first section shoppers see is the likely largest paint, so only a campaign there loads its artwork eagerly.
  const lead = sections.find((section) => showsShoppersContent(section, settings, catalog));
  const hero = sections.find((section) => section.type === "campaign" && showsShoppersContent(section, settings, catalog));

  if (!sections.length) {
    return (
      <Container className="py-16">
        <div className="rounded-lg border border-divider bg-surface p-10 text-center shadow-card">
          <h2 className="type-h3 text-navy-900">No storefront sections are published yet</h2>
          <p className="mt-2 text-muted">Products remain available in the shop.</p>
          <Link to="/shop" className="mt-5 inline-flex min-h-[44px] items-center rounded-sm bg-navy-900 px-6 text-sm font-semibold text-white hover:bg-gold-500 hover:text-navy-900">
            Browse Products
          </Link>
        </div>
      </Container>
    );
  }

  return (
    <>
      {usesCatalog && catalog.status === "error" && (
        <Container className="pt-10">
          <ErrorPanel title="Products are unavailable" message={catalog.error ?? "The catalog could not be loaded."} onRetry={catalog.reload} />
        </Container>
      )}
      {sections.map((section) => {
        if (section.type === "campaign") {
          const campaign = settings.campaigns.find((item) => item.id === section.campaignId);
          if (!campaign) {
            return showProblems ? <ProblemList key={section.id} title={section.title} problems={[`Campaign ${section.campaignId ?? "(none)"} does not exist`]} /> : null;
          }
          return (
            <CampaignSection
              key={section.id}
              resolved={resolveCampaign(campaign, mediaById, catalog)}
              catalogReady={catalog.status === "ready"}
              showProblems={showProblems}
              priority={section === lead}
              variant={section === hero ? "hero" : "band"}
            />
          );
        }
        if (catalog.status === "error") return null;
        if (catalog.status === "loading") {
          return (
            <Container key={section.id} className="py-8 md:py-10">
              <p role="status" className="sr-only">Loading {section.title.toLowerCase()}…</p>
              {section.type === "departments" ? <DepartmentRailSkeleton /> : <ProductsSkeleton />}
            </Container>
          );
        }
        return section.type === "departments"
          ? <DepartmentsSection key={section.id} section={section} showProblems={showProblems} />
          : <ProductsSection key={section.id} section={section} showProblems={showProblems} />;
      })}
    </>
  );
}

function ProblemList({ title, problems }: { title: string; problems: string[] }) {
  if (!problems.length) return null;
  return (
    <Container className="pt-6">
      <div role="note" className="rounded-md border border-warning/40 bg-warning-tint p-3 text-sm text-navy-800">
        <p className="font-bold text-navy-900">“{title}” has unavailable references</p>
        <ul className="mt-1 list-inside list-disc">
          {problems.map((problem) => <li key={problem}>{problem}</li>)}
        </ul>
      </div>
    </Container>
  );
}

function DepartmentsSection({ section, showProblems }: { section: Section; showProblems: boolean }) {
  const catalog = useCatalog();
  const { items, missing } = sectionCategories(section, catalog);
  const problems = missing.map((id) => `Category ${id} is unavailable`);
  if (!items.length) return showProblems ? <ProblemList title={section.title} problems={[...problems, "No departments to show"]} /> : null;
  return (
    <>
      {showProblems && <ProblemList title={section.title} problems={problems} />}
      <Container className="py-8 md:py-10">
        <DepartmentRail title={section.title} items={items} />
      </Container>
    </>
  );
}

/** The listing that holds every product a section draws from, or the whole shop when no one filter describes it. */
function viewAllRoute(section: Section) {
  return section.type === "featured" && !section.productIds.length ? listingRoute({ featured: true }) : listingRoute();
}

function ProductsSection({ section, showProblems }: { section: Section; showProblems: boolean }) {
  const catalog = useCatalog();
  const { items, missing } = sectionProducts(section, catalog);
  const problems = missing.map((id) => `Product ${id} is unavailable`);
  if (!items.length) {
    return showProblems ? <ProblemList title={section.title} problems={[...problems, "No products to show; shoppers will not see this section"]} /> : null;
  }
  return (
    <>
      {showProblems && <ProblemList title={section.title} problems={problems} />}
      <Container className="py-8 md:py-10">
        <SectionTitle
          action={
            <Link to={viewAllRoute(section)} className="inline-flex min-h-[44px] items-center px-1 font-semibold text-link underline underline-offset-4 hover:text-link-hover">
              View all<span className="sr-only"> {section.title}</span>
            </Link>
          }
        >
          {section.title}
        </SectionTitle>
        <ul aria-label={section.title} className="product-grid">
          {items.map((product, index) => (
            <li key={product.id} className={`min-w-0 ${VISIBLE_FROM[index] ?? "hidden"}`}>
              <ProductCard product={product} />
            </li>
          ))}
        </ul>
      </Container>
    </>
  );
}

/** A product section's shape while the catalog loads: the same grid and card count per breakpoint, without motion. */
function ProductsSkeleton() {
  const bar = "rounded-sm bg-surface-soft";
  return (
    <div aria-hidden="true">
      <div className={`mb-5 h-8 w-56 max-w-full ${bar}`} />
      <div className="product-grid">
        {VISIBLE_FROM.map((visibility, index) => (
          <div key={index} className={`overflow-hidden rounded-lg bg-surface shadow-card ${visibility}`}>
            <div className="aspect-square bg-surface-soft" />
            <div className="space-y-2 p-4">
              <div className={`h-3 w-1/2 ${bar}`} />
              <div className={`h-4 w-3/4 ${bar}`} />
              <div className={`h-5 w-1/3 ${bar}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type FocalStyle = CSSProperties & Record<"--focal-desktop" | "--focal-mobile", string>;

/** Artwork for a campaign: the mobile file below 768px when there is one, cropped at the configured focal points. */
function CampaignArtwork({ resolved, priority, sizes }: { resolved: ResolvedCampaign; priority: boolean; sizes?: string }) {
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

function CampaignSection({ resolved, catalogReady, showProblems, priority, variant }: {
  resolved: ResolvedCampaign;
  catalogReady: boolean;
  showProblems: boolean;
  /** The page's leading section: its artwork (whichever source is chosen) loads eagerly with high priority. */
  priority: boolean;
  variant: "hero" | "band";
}) {
  const { campaign, desktop, mobile } = resolved;
  // Catalog targets are only linked, or reported missing, once the catalog has loaded.
  const route = campaign.cta.target === "shop" || catalogReady ? resolved.ctaRoute : null;
  const problems = catalogReady && resolved.ctaProblem ? [...resolved.mediaProblems, resolved.ctaProblem] : resolved.mediaProblems;
  const placeholder = Boolean(desktop?.isPlaceholder || mobile?.isPlaceholder);
  const split = campaign.layout === "split";
  const sample = placeholder ? <SampleImageLabel /> : null;

  const copy = (hero: boolean, onDark: boolean): ReactNode => (
    <div className={onDark ? "text-white" : "text-navy-900"}>
      <h2 className={`${hero ? "type-display" : "type-h3"} break-words`}>{campaign.title}</h2>
      {campaign.body && <p className={`mt-3 max-w-xl break-words ${onDark ? "text-white/90" : "text-navy-800"}`}>{campaign.body}</p>}
      {campaign.conditions && <p className={`mt-3 max-w-xl break-words text-sm ${onDark ? "text-on-navy-muted" : "text-muted"}`}>{campaign.conditions}</p>}
      {route && (
        <Link
          to={route}
          className={`mt-5 inline-flex min-h-[44px] items-center rounded-sm px-6 text-sm font-semibold uppercase tracking-[0.12em] transition-colors duration-(--motion-feedback) ${
            onDark ? "bg-gold-500 text-navy-900 hover:bg-gold-400" : "bg-navy-900 text-white hover:bg-gold-500 hover:text-navy-900"
          }`}
        >
          {campaign.cta.label}
        </Link>
      )}
    </div>
  );

  let body: ReactNode;
  if (variant === "band") {
    // Compact: the copy and conditions stay in plain text beside (or under) a small artwork.
    body = (
      <div className="overflow-hidden rounded-lg border border-divider bg-surface shadow-card md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {desktop && (
          <div className="relative aspect-[21/9] bg-surface-warm md:order-2 md:aspect-auto md:min-h-44">
            <CampaignArtwork resolved={resolved} priority={priority} sizes={BAND_SIZES} />
            {sample}
          </div>
        )}
        <div className="flex flex-col justify-center p-5 md:p-8">{copy(false, false)}</div>
      </div>
    );
  } else if (split) {
    body = (
      <div className="overflow-hidden rounded-lg bg-surface shadow-card md:grid md:grid-cols-2">
        {desktop && (
          <div className="relative aspect-[16/9] bg-surface-warm md:order-2 md:aspect-auto md:min-h-64">
            <CampaignArtwork resolved={resolved} priority={priority} sizes={SPLIT_HERO_SIZES} />
            {sample}
          </div>
        )}
        <div className="flex flex-col justify-center p-6 sm:p-8 md:p-12">{copy(true, false)}</div>
      </div>
    );
  } else {
    // Phones stack the artwork above the copy on navy. From 768px the copy sits on a dim column over the artwork's left
    // side that fades into the image: legible over any artwork (plain white included), the rest of the image left clear.
    body = (
      <div className={`overflow-hidden rounded-lg bg-navy-900 md:relative md:flex ${campaign.layout === "banner" ? "md:min-h-48" : "md:min-h-96"}`}>
        {desktop && (
          <div className="relative aspect-[16/9] md:absolute md:inset-0 md:aspect-auto">
            <CampaignArtwork resolved={resolved} priority={priority} />
            {/* Raised above the copy column, so the notice stays visible wherever the column falls. */}
            {placeholder && <SampleImageLabel className="z-10" />}
          </div>
        )}
        <div className="relative w-full p-6 sm:p-8 md:flex md:w-auto md:max-w-[min(40rem,72%)] md:items-center md:bg-navy-950/85 md:p-10 md:after:pointer-events-none md:after:absolute md:after:inset-y-0 md:after:left-full md:after:w-40 md:after:bg-gradient-to-r md:after:from-navy-950/85 md:after:to-transparent lg:p-12">
          {copy(true, true)}
        </div>
      </div>
    );
  }

  return (
    <>
      {showProblems && <ProblemList title={campaign.title} problems={problems} />}
      <section aria-label={campaign.title} className={variant === "hero" ? "py-6 md:py-8" : "py-4 md:py-6"}>
        <Container>{body}</Container>
      </section>
    </>
  );
}
