import { useState } from "react";
import { COLOR_MAP, getProduct, stockStatus } from "../data/products";
import { Breadcrumb, Container, ProductCard, Stars, StockBadge } from "../components/ui";
import { formatKES, useStore } from "../store/StoreContext";
import { Link, navigate } from "../router";
import { resolveImageSet } from "../utils/imageSource";
import { useAuth } from "../contexts/AuthContext";

const TABS = ["Description", "Materials", "Care", "Size Guide"] as const;

export default function ProductDetail({ id }: { id: string }) {
  const { addToCart, toggleWish, state, productWithStock, catalog } = useStore();
  const { user } = useAuth();
  const base = catalog.find((p) => p.id === id) ?? getProduct(id);
  const [size, setSize] = useState<string | undefined>(base?.sizes?.[0]);
  const [color, setColor] = useState<string | undefined>(base?.colors?.[0]);
  const [qty, setQty] = useState(1);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Description");
  const [added, setAdded] = useState(false);
  
  if (!base) {
    return (
      <Container className="py-20 text-center">
        <h1 className="font-display text-2xl text-brand-primary">Product not found</h1>
        <Link to="/shop" className="mt-4 inline-block text-sm text-ocean-blue underline">
          Back to Shop
        </Link>
      </Container>
    );
  }

  const p = productWithStock(base);
  const wished = state.wishlist.includes(p.id);
  const out = p.stock <= 0;
  const status = stockStatus(p.stock);
  const related = catalog.filter((r) => r.categorySlug === p.categorySlug && r.id !== p.id).slice(0, 4);

  const doAdd = () => {
    if (!user) {
      navigate("/login");
      return;
    }
    addToCart({ productId: p.id, qty, size, color });
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  const imageSet = resolveImageSet(p);
  const [activeAngle, setActiveAngle] = useState<"front" | "side" | "top" | "closeup">("front");
  const [imageError, setImageError] = useState(false);
  const [imgLoading, setImgLoading] = useState(true);

  const angleOrder: Array<"front" | "side" | "top" | "closeup"> = ["front", "side", "top", "closeup"];
  const angleLabels = {
    front: "Front View",
    side: "Side View",
    top: "Top View",
    closeup: "Detail Shot",
  };

  const currentImage = imageSet[activeAngle];

  return (
    <Container className="py-8">
      <div className="flex items-center justify-between">
        <Breadcrumb
          items={[
            { label: "Shop", to: "/shop" },
            { label: p.category, to: `/shop?cat=${p.categorySlug}` },
            { label: p.name },
          ]}
        />
        <button onClick={() => navigate("/shop")} className="text-[11px] font-bold uppercase tracking-wider text-brand-primary hover:text-brand-secondary">
          ← Continue Shopping
        </button>
      </div>

      <div className="mt-6 grid gap-10 lg:grid-cols-2">
        {/* Images Section */}
        <div>
          {/* Hero Image */}
          <div className="aspect-square overflow-hidden rounded-lg bg-warm-beige relative">
            {imgLoading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-secondary border-t-transparent" />
                <p className="mt-3 text-xs text-gray-400">Loading image...</p>
              </div>
            )}
            {imageError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
                <span className="text-4xl mb-2">📷</span>
                <p className="text-sm font-medium">Image unavailable</p>
                <p className="text-xs mt-1 text-gray-300">Please try another angle or image source.</p>
              </div>
            ) : (
              <img
                src={currentImage}
                alt={`${p.name} — ${angleLabels[activeAngle]}`}
                className="absolute inset-0 w-full h-full object-cover transition-all duration-500 hover:scale-105"
                onLoad={() => setImgLoading(false)}
                onError={() => { setImageError(true); setImgLoading(false); }}
              />
            )}
          </div>

          {/* 4-Angle Thumbnails */}
          <div className="mt-3">
            <div className="grid grid-cols-4 gap-2">
              {angleOrder.map((angle) => (
                <button
                  key={angle}
                  onClick={() => { setActiveAngle(angle); setImageError(false); setImgLoading(true); }}
                  className={`aspect-square overflow-hidden rounded-md bg-warm-beige border-2 transition-all relative ${
                    angle === activeAngle ? "border-brand-primary" : "border-transparent hover:border-brand-secondary"
                  }`}
                  title={angleLabels[angle]}
                >
                  <img
                    src={imageSet[angle]}
                    alt={`${p.name} — ${angleLabels[angle]}`}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.opacity = "0.4";
                    }}
                  />
                  <span className="absolute bottom-0 inset-x-0 bg-black/50 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                    {angle}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-center text-[10px] text-gray-400">
              {imageError ? "Some angles may not have an image available" : "Click any angle to view"}
            </p>
          </div>
        </div>

        {/* Product Info */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-brand-accent">{p.category}</p>
          <h1 className="mt-1.5 font-display text-2xl leading-tight text-brand-primary sm:text-3xl">{p.name}</h1>

          <div className="mt-3 flex items-baseline gap-3">
            <span className="font-display text-3xl text-brand-primary">{formatKES(p.price)}</span>
            {p.comparePrice && (
              <span className="text-base text-gray-400 line-through">{formatKES(p.comparePrice)}</span>
            )}
            {p.discountPercent && (
              <span className="bg-coral text-white text-xs font-bold px-2 py-0.5 rounded-sm">
                -{p.discountPercent}%
              </span>
            )}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Stars rating={p.rating} size={15} />
            <span className="text-xs text-gray-400">
              {p.rating} ({p.reviews} reviews)
            </span>
          </div>

          {/* Stock */}
          <div className="mt-5 rounded-md bg-off-white p-4">
            <div className="flex items-center gap-3">
              <StockBadge stock={p.stock} />
              {!out && <span className="text-xs text-gray-500">{p.stock} remaining</span>}
            </div>
            {!out && (
              <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-light-gray">
                <div
                  className={`h-full rounded-full transition-all ${
                    status === "low" ? "bg-warning" : "bg-success"
                  }`}
                  style={{ width: `${Math.min(100, (p.stock / p.maxStock) * 100)}%` }}
                />
              </div>
            )}
          </div>

          {/* Sizes */}
          {p.sizes && (
            <div className="mt-6">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-primary">Size</p>
              <div className="flex flex-wrap gap-2">
                {p.sizes.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSize(s)}
                    className={`min-w-11 rounded-sm border px-3 py-2 text-xs font-medium transition-colors ${
                      size === s
                        ? "border-brand-primary bg-brand-primary text-white"
                        : "border-light-gray hover:border-brand-accent"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Colors */}
          {p.colors && (
            <div className="mt-5">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-primary">Color: <span className="font-normal text-gray-500">{color}</span></p>
              <div className="flex flex-wrap gap-2">
                {p.colors.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    title={c}
                    className={`h-8 w-8 rounded-full border-2 transition-all ${
                      color === c ? "border-brand-primary ring-2 ring-brand-secondary/50 ring-offset-1" : "border-gray-200"
                    }`}
                    style={{ background: COLOR_MAP[c] ?? "#ccc" }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Qty */}
          <div className="mt-6 flex items-center gap-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-primary">Quantity</p>
            <div className="flex items-center rounded-sm border border-light-gray">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="px-3 py-2 text-sm text-gray-500 hover:text-brand-primary">−</button>
              <span className="w-10 text-center text-sm">{qty}</span>
              <button onClick={() => setQty((q) => q + 1)} className="px-3 py-2 text-sm text-gray-500 hover:text-brand-primary">+</button>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <button
              disabled={out}
              onClick={doAdd}
              className={`flex-1 rounded-sm py-3.5 font-body text-xs font-bold uppercase tracking-[0.12em] transition-all ${
                out
                  ? "cursor-not-allowed bg-gray-100 text-gray-400"
                  : added
                  ? "bg-success text-white"
                  : "bg-brand-primary text-white hover:bg-brand-secondary hover:text-brand-primary"
              }`}
            >
              {out ? "Out of Stock" : added ? "✓ Added to Cart" : "Add to Cart"}
            </button>
            <button
              onClick={() => toggleWish(p.id)}
              className={`flex-1 rounded-sm border py-3.5 font-body text-xs font-bold uppercase tracking-[0.12em] transition-all ${
                wished
                  ? "border-error/30 bg-error/5 text-error"
                  : "border-light-gray text-charcoal hover:border-brand-primary hover:text-brand-primary"
              }`}
            >
              {wished ? "♥ In Wishlist" : "♡ Add to Wishlist"}
            </button>
          </div>

          <div className="mt-7 space-y-2 text-xs text-gray-500">
            <p>📦 Free delivery on orders over KES 5,000</p>
            <p>🔄 30-day returns policy</p>
            <p>🔒 Secure M-Pesa & card payments</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-16">
        <div className="flex gap-0 border-b border-light-gray">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-3 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors ${
                tab === t ? "border-b-2 border-brand-primary text-brand-primary" : "text-gray-400 hover:text-charcoal"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="py-6 text-sm leading-relaxed text-charcoal">
          {tab === "Description" && <p>{p.description}</p>}
          {tab === "Materials" && (
            <ul className="list-inside list-disc space-y-1.5 text-gray-500">
              <li>Premium quality materials</li>
              <li>Durable, long-lasting construction</li>
              <li>Ethically sourced where possible</li>
            </ul>
          )}
          {tab === "Care" && (
            <ul className="list-inside list-disc space-y-1.5 text-gray-500">
              <li>Follow label instructions</li>
              <li>Machine washable at 30°C (apparel)</li>
              <li>Iron on medium heat where applicable</li>
            </ul>
          )}
          {tab === "Size Guide" && (
            <p className="text-gray-500">
              Please refer to the size options above. For assistance, call us on{" "}
              <strong className="text-brand-primary">0720 784379</strong> or visit us on Digo Road.
            </p>
          )}
        </div>
      </div>

      {/* Reviews */}
      <div className="mt-10">
        <h2 className="font-display text-xl uppercase tracking-wider text-brand-primary">Customer Reviews ({p.reviews})</h2>
        <div className="mt-2 flex items-center gap-2">
          <Stars rating={p.rating} size={16} />
          <span className="text-xs text-gray-400">{p.rating} out of 5</span>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {[
            { t: "Excellent quality! Highly recommend to anyone looking for value.", n: "John K.", r: 5 },
            { t: "Great value for money. Will definitely buy again from No Maneno.", n: "Mary W.", r: 4 },
          ].map((rev, i) => (
            <div key={i} className="rounded-lg bg-light-pink p-5 shadow-sm">
              <Stars rating={rev.r} size={13} />
              <p className="mt-2 text-sm italic text-charcoal">"{rev.t}"</p>
              <p className="mt-2 text-xs font-semibold text-brand-primary">— {rev.n}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Related */}
      <div className="mt-16">
        <h2 className="mb-6 font-display text-xl uppercase tracking-wider text-brand-primary">You May Also Like</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {related.map((r) => (
            <ProductCard key={r.id} product={productWithStock(r)} />
          ))}
        </div>
      </div>

      <div className="mt-10 text-center">
        <button onClick={() => navigate("/shop")} className="text-xs font-semibold text-brand-primary underline-offset-4 hover:underline">
          ← Continue Shopping
        </button>
      </div>
    </Container>
  );
}
