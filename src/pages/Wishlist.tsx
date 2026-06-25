import { PRODUCTS } from "../data/products";
import { Breadcrumb, Container, ProductCard } from "../components/ui";
import { useStore } from "../store/StoreContext";
import { Link } from "../router";

export function Wishlist() {
  const { state, productWithStock } = useStore();
  const items = PRODUCTS.filter((p) => state.wishlist.includes(p.id));

  return (
    <Container className="py-8">
      <Breadcrumb items={[{ label: "Wishlist" }]} />
      <h1 className="mt-5 font-display text-2xl uppercase tracking-wider text-brand-primary">My Wishlist</h1>
      <p className="mt-1 text-xs text-gray-400">{items.length} saved items</p>

      {items.length === 0 ? (
        <div className="mt-10 rounded-lg bg-light-pink p-16 text-center shadow-sm">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor" className="mx-auto h-16 w-16 text-gray-200">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
          </svg>
          <h2 className="mt-4 font-display text-xl text-brand-primary">Your wishlist is empty</h2>
          <p className="mt-1 text-sm text-gray-400">Save items you love to find them easily later.</p>
          <Link
            to="/shop"
            className="mt-6 inline-block rounded-sm bg-brand-primary px-8 py-3 text-xs font-bold uppercase tracking-[0.12em] text-white hover:bg-brand-secondary hover:text-brand-primary"
          >
            Browse Products
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {items.map((p) => (
            <ProductCard key={p.id} product={productWithStock(p)} />
          ))}
        </div>
      )}
    </Container>
  );
}
