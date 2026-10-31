import { Link } from "../router";
import { Container, DemoCatalogNotice, ErrorPanel, LoadingPanel } from "../components/ui";
import { StorefrontSections } from "../components/StorefrontSections";
import { useStorefront } from "../store/StorefrontContext";

export default function Home() {
  const { status, error, storefront, mediaById, reload } = useStorefront();

  if (status === "loading") {
    return <Container className="py-16"><LoadingPanel label="Loading the storefront…" /></Container>;
  }
  if (!storefront) {
    return (
      <Container className="py-16">
        <ErrorPanel title="Storefront content is unavailable" message={error ?? "Storefront content could not be loaded."} onRetry={reload}>
          <Link to="/shop" className="rounded-sm border border-brand-primary px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-brand-primary hover:bg-brand-primary hover:text-white">
            Browse Products
          </Link>
        </ErrorPanel>
      </Container>
    );
  }

  return (
    <div className="pb-8">
      <Container className="pt-6"><DemoCatalogNotice /></Container>
      <StorefrontSections settings={storefront.settings} mediaById={mediaById} />
    </div>
  );
}
