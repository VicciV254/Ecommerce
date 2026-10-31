import type { CSSProperties, ReactNode } from "react";
import type { CatalogCategory, MediaAsset, StorefrontSettings } from "../api/catalog";
import { Link } from "../router";
import { useCatalog } from "../store/CatalogContext";
import {
  resolveCampaign,
  sectionCategories,
  sectionProducts,
  type ResolvedCampaign,
} from "../store/storefrontModel";
import { Container, ErrorPanel, LoadingPanel, MissingImage, ProductCard, SampleImageLabel, SectionTitle } from "./ui";

type Section = StorefrontSettings["sections"][number];

/** Viewport where campaign artwork switches to its mobile composition (Tailwind `md`). */
const MOBILE_ARTWORK_QUERY = "(width < 48rem)";

type SectionsProps = {
  settings: StorefrontSettings;
  mediaById: ReadonlyMap<string, MediaAsset>;
  /** Staff preview lists unavailable references; shoppers never see substitutes. */
  showProblems?: boolean;
};

export function StorefrontSections({ settings, mediaById, showProblems = false }: SectionsProps) {
  const catalog = useCatalog();
  const sections = settings.sections.filter((section) => section.enabled);
  const usesCatalog = sections.some((section) => section.type !== "campaign");

  if (!sections.length) {
    return (
      <Container className="py-16">
        <div className="rounded-lg bg-white p-10 text-center shadow-sm">
          <h2 className="font-display text-xl text-brand-primary">No storefront sections are published yet</h2>
          <p className="mt-2 text-sm text-gray-500">Products remain available in the shop.</p>
          <Link to="/shop" className="mt-5 inline-block rounded-sm bg-brand-primary px-6 py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-brand-secondary hover:text-brand-primary">
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
          return <CampaignSection key={section.id} resolved={resolveCampaign(campaign, mediaById, catalog)} catalogReady={catalog.status === "ready"} showProblems={showProblems} />;
        }
        if (catalog.status === "loading") {
          return <Container key={section.id} className="py-10"><LoadingPanel label={`Loading ${section.title.toLowerCase()}…`} /></Container>;
        }
        if (catalog.status === "error") return null;
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
      <div role="note" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-charcoal">
        <p className="font-bold text-brand-primary">“{title}” has unavailable references</p>
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
      <Container className="py-12">
        <SectionTitle>{section.title}</SectionTitle>
        <ul aria-label={section.title} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {items.map((category) => <li key={category.id}><DepartmentTile category={category} /></li>)}
        </ul>
      </Container>
    </>
  );
}

function DepartmentTile({ category }: { category: CatalogCategory }) {
  return (
    <Link to={`/shop?cat=${encodeURIComponent(category.slug)}`} className="group relative block aspect-[4/5] overflow-hidden rounded-lg bg-warm-beige">
      {category.image ? (
        <img src={category.image} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" />
      ) : (
        <span className="absolute inset-0"><MissingImage label="No department image" /></span>
      )}
      <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
      <span className="absolute inset-x-0 bottom-0 p-4">
        <span className="block font-display text-sm uppercase tracking-wider text-white sm:text-base">{category.name}</span>
        <span className="mt-1 block text-[11px] text-white/85">
          {category.productCount} {category.productCount === 1 ? "product" : "products"}
        </span>
      </span>
    </Link>
  );
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
      <Container className="py-12">
        <SectionTitle
          action={
            <Link to="/shop" className="text-xs font-bold uppercase tracking-[0.12em] text-brand-primary underline-offset-4 hover:text-brand-secondary hover:underline">
              View All →
            </Link>
          }
        >
          {section.title}
        </SectionTitle>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {items.map((product) => <ProductCard key={product.id} product={product} />)}
        </div>
      </Container>
    </>
  );
}

type FocalStyle = CSSProperties & Record<"--focal-desktop" | "--focal-mobile", string>;

function CampaignSection({ resolved, catalogReady, showProblems }: { resolved: ResolvedCampaign; catalogReady: boolean; showProblems: boolean }) {
  const { campaign, desktop, mobile } = resolved;
  // Catalog targets are only linked, or reported missing, once the catalog has loaded.
  const route = campaign.cta.target === "shop" || catalogReady ? resolved.ctaRoute : null;
  const problems = catalogReady && resolved.ctaProblem ? [...resolved.mediaProblems, resolved.ctaProblem] : resolved.mediaProblems;
  const onDark = campaign.layout !== "split";
  const focal: FocalStyle = {
    "--focal-desktop": `${campaign.desktopFocal.x}% ${campaign.desktopFocal.y}%`,
    // Phones always use the mobile crop, applied to the desktop image when no mobile file exists.
    "--focal-mobile": `${campaign.mobileFocal.x}% ${campaign.mobileFocal.y}%`,
  };

  const artwork: ReactNode = desktop ? (
    <picture>
      {mobile && <source media={MOBILE_ARTWORK_QUERY} srcSet={mobile.url} />}
      <img
        src={desktop.url}
        alt={desktop.alt ?? ""}
        style={focal}
        className="absolute inset-0 h-full w-full object-cover [object-position:var(--focal-desktop)] max-md:[object-position:var(--focal-mobile)]"
      />
    </picture>
  ) : null;
  const placeholder = Boolean(desktop?.isPlaceholder || mobile?.isPlaceholder);

  const copy = (
    <div className={onDark ? "text-white" : "text-brand-primary"}>
      <h2 className="font-display text-3xl uppercase leading-tight tracking-wider sm:text-4xl">{campaign.title}</h2>
      {campaign.body && <p className="mt-3 max-w-xl text-sm leading-relaxed opacity-90">{campaign.body}</p>}
      {campaign.conditions && <p className="mt-3 max-w-xl text-xs opacity-80">{campaign.conditions}</p>}
      {route && (
        <Link to={route} className="mt-6 inline-block rounded-sm bg-brand-secondary px-7 py-3 text-xs font-bold uppercase tracking-[0.15em] text-brand-primary transition-colors hover:bg-white">
          {campaign.cta.label}
        </Link>
      )}
    </div>
  );

  return (
    <>
      {showProblems && <ProblemList title={campaign.title} problems={problems} />}
      <section aria-label={campaign.title} className="py-8">
        <Container>
          {campaign.layout === "split" ? (
            <div className="grid overflow-hidden rounded-lg bg-white shadow-sm md:grid-cols-2">
              <div className="flex flex-col justify-center p-8 sm:p-12">{copy}</div>
              {artwork && (
                <div className="relative min-h-64 bg-warm-beige">
                  {artwork}
                  {placeholder && <SampleImageLabel />}
                </div>
              )}
            </div>
          ) : (
            <div className={`relative flex items-center overflow-hidden rounded-lg bg-brand-primary ${campaign.layout === "banner" ? "min-h-48" : "min-h-80 sm:min-h-96"}`}>
              {artwork && (
                <>
                  {artwork}
                  <span className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/45 to-black/10" />
                  {placeholder && <SampleImageLabel />}
                </>
              )}
              <div className="relative w-full p-8 sm:p-12">{copy}</div>
            </div>
          )}
        </Container>
      </section>
    </>
  );
}
