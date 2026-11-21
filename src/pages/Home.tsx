import { Link } from "../router";
import { usePageReady } from "../components/pageReady";
import { ProductRailSkeleton } from "../components/ProductRail";
import { Container, DemoCatalogNotice, ErrorPanel } from "../components/ui";
import { StorefrontSections } from "../components/StorefrontSections";
import { useStorefront } from "../store/StorefrontContext";

/** Shopping-facts boxes in the loading shape: the strip's four facts. */
const FACT_SHAPES = 4;

/**
 * The storefront's shape while it loads: a full-width hero block at the carousel's heights, a facts row and a product
 * row. A screen tall, so the footer starts below the first screen and the arriving page doesn't push it off.
 */
function HomeSkeleton() {
  return (
    <div className="min-h-svh">
      <p role="status" className="sr-only">Loading the storefront…</p>
      <div aria-hidden="true">
        <div className="skeleton h-[440px] w-full sm:h-[520px] lg:h-[600px]" />
        <Container className="pt-8">
          <div className="facts-grid">
            {Array.from({ length: FACT_SHAPES }, (_, index) => <div key={index} className="skeleton h-24 rounded-lg" />)}
          </div>
        </Container>
        <Container className="pt-8 md:pt-10"><ProductRailSkeleton /></Container>
      </div>
    </div>
  );
}

export default function Home() {
  const { status, error, storefront, mediaById, reload, brandName } = useStorefront();
  usePageReady(status === "ready" && storefront !== null);

  if (status === "loading") return <HomeSkeleton />;
  if (!storefront) {
    return (
      <Container className="py-16">
        <ErrorPanel title="Storefront content is unavailable" message={error ?? "Storefront content could not be loaded."} onRetry={reload}>
          <Link to="/shop" className="rounded-sm border border-brand-primary px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-brand-primary hover:bg-brand-primary hover:text-white">
            Browse products
          </Link>
        </ErrorPanel>
      </Container>
    );
  }

  return (
    <div className="pb-8">
      {/* The page's one H1; the published sections below carry the visible headings. */}
      <h1 className="sr-only">{brandName}</h1>
      <StorefrontSections
        settings={storefront.settings}
        mediaById={mediaById}
        notice={<Container className="pt-6"><DemoCatalogNotice holdPlace /></Container>}
      />
    </div>
  );
}
