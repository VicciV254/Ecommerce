import { ProductCard } from "../components/ProductCard";
import { Breadcrumb, CardSkeleton, Container, ErrorPanel, Reveal } from "../components/ui";
import { Link } from "../router";
import { useCatalog } from "../store/CatalogContext";
import { useStore } from "../store/StoreContext";

/** Saved items a loading wishlist shows as card shapes: two rows at the widest. */
const SKELETON_CARDS = 8;

export default function Wishlist() {
  const { state, toggleWish } = useStore();
  const catalog = useCatalog();
  const saved = state.wishlist;
  const items = saved.flatMap((id) => catalog.productsById.get(id) ?? []);
  const unavailable = catalog.status === "ready" ? saved.filter((id) => !catalog.productsById.has(id)) : [];

  return (
    <Container className="py-8">
      <Breadcrumb items={[{ label: "Wishlist" }]} />
      <h1 className="mt-5 font-display text-2xl uppercase tracking-wider text-brand-primary">My wishlist</h1>

      {saved.length === 0 ? (
        <div className="mt-6 rounded-lg bg-white p-16 text-center shadow-sm">
          <h2 className="font-display text-xl text-brand-primary">Your wishlist is empty</h2>
          <p className="mt-1 text-sm text-gray-500">Save items you love to find them easily later.</p>
          <Link
            to="/shop"
            className="mt-6 inline-block rounded-sm bg-brand-primary px-8 py-3 text-xs font-bold uppercase tracking-[0.12em] text-white hover:bg-brand-secondary hover:text-brand-primary"
          >
            Browse products
          </Link>
        </div>
      ) : catalog.status === "loading" ? (
        <>
          <p role="status" className="sr-only">Loading your saved items…</p>
          {/* One card shape for each saved item, up to two rows. */}
          <div aria-hidden="true" className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {saved.slice(0, SKELETON_CARDS).map((id) => <CardSkeleton key={id} />)}
          </div>
        </>
      ) : catalog.status === "error" ? (
        <div className="mt-6">
          <ErrorPanel title="Saved items are unavailable" message={`${catalog.error ?? "The catalog could not be loaded."} Your wishlist is unchanged.`} onRetry={catalog.reload} />
        </div>
      ) : (
        <>
          <p className="mt-1 text-xs text-gray-500">{items.length} saved {items.length === 1 ? "item" : "items"}</p>
          {unavailable.length > 0 && (
            <div role="status" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-charcoal">
              <span>{unavailable.length} saved {unavailable.length === 1 ? "item is" : "items are"} no longer available.</span>
              <button type="button" onClick={() => unavailable.forEach(toggleWish)} className="font-bold text-brand-primary underline">
                Remove unavailable items
              </button>
            </div>
          )}
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {items.map((product) => <Reveal key={product.id} stagger className="grid"><ProductCard product={product} /></Reveal>)}
          </div>
        </>
      )}
    </Container>
  );
}
