import { useCallback, useEffect, useState } from "react";
import { catalogAPI, type CatalogProduct, type CatalogProductDetail, type CatalogReview } from "../api/catalog";
import { apiStatus, describeApiError } from "../api/errors";
import {
  Breadcrumb,
  Container,
  DemoBadge,
  ErrorPanel,
  LoadingPanel,
  MissingImage,
  ProductCard,
  SampleImageLabel,
  Stars,
  StockBadge,
} from "../components/ui";
import { useAuth } from "../contexts/AuthContext";
import { Link, navigate } from "../router";
import { useCatalog } from "../store/CatalogContext";
import {
  CatalogFormatError,
  findVariant,
  inCategory,
  isCatalogProduct,
  optionAvailable,
  optionLabel,
  orderedImages,
  productStock,
  stockLevel,
  variantOptions,
  type VariantSelection,
} from "../store/catalogModel";
import { useStore } from "../store/StoreContext";
import { COLOR_MAP } from "../utils/colors";
import { isRecord } from "../utils/storage";
import { formatKES } from "../utils/format";

const RELATED_LIMIT = 4;
const ADDED_FEEDBACK_MS = 1500;

type DetailState =
  | { status: "loading" }
  | { status: "ready"; product: CatalogProductDetail }
  | { status: "not-found" }
  | { status: "error"; message: string };

function isReview(value: unknown): value is CatalogReview {
  return isRecord(value) && typeof value.id === "string" && typeof value.rating === "number" &&
    typeof value.comment === "string" && typeof value.author === "string" && typeof value.createdAt === "string";
}

type InfoTab = "description" | "specifications";

/** Authoritative product record; unknown IDs resolve to not-found rather than a substitute. */
function useProductDetail(id: string) {
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    catalogAPI.getProduct(id)
      .then(({ data }) => {
        if (!isCatalogProduct(data) || data.id !== id) throw new CatalogFormatError("product");
        const reviews = Array.isArray(data.reviewList) ? data.reviewList.filter(isReview) : [];
        if (current) setState({ status: "ready", product: { ...data, reviewList: reviews } });
      })
      .catch((error: unknown) => {
        if (!current) return;
        if (apiStatus(error) === 404) setState({ status: "not-found" });
        else setState({ status: "error", message: error instanceof CatalogFormatError ? error.message : describeApiError(error, "This product could not be loaded.") });
      });
    return () => { current = false; };
  }, [id, attempt]);
  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);
  return { state, retry };
}

export default function ProductDetail({ id }: { id: string }) {
  return <ProductContent key={id} id={id} />;
}

function ProductContent({ id }: { id: string }) {
  const catalog = useCatalog();
  const { addToCart, toggleWish, state: store } = useStore();
  const { user } = useAuth();
  const { state: detail, retry } = useProductDetail(id);
  const [selection, setSelection] = useState<VariantSelection>({});
  const [qty, setQty] = useState(1);
  const [tab, setTab] = useState<InfoTab>("description");
  const [added, setAdded] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [loadedImage, setLoadedImage] = useState<string | null>(null);

  useEffect(() => {
    if (!added) return;
    const timer = window.setTimeout(() => setAdded(false), ADDED_FEEDBACK_MS);
    return () => window.clearTimeout(timer);
  }, [added]);

  if (catalog.status === "loading") {
    return <Container className="py-16"><LoadingPanel label="Loading product…" /></Container>;
  }
  if (catalog.status === "error") {
    return (
      <Container className="py-16">
        <ErrorPanel title="Products are unavailable" message={catalog.error ?? "The catalog could not be loaded."} onRetry={catalog.reload} />
      </Container>
    );
  }
  if (detail.status === "not-found") {
    return (
      <Container className="py-20 text-center">
        <h1 className="font-display text-2xl text-brand-primary">Product not found</h1>
        <p className="mt-2 text-sm text-gray-500">This product is not in the current catalog. It may have been removed or the link may be out of date.</p>
        <Link to="/shop" className="mt-4 inline-block text-sm text-ocean-blue underline">Back to Shop</Link>
      </Container>
    );
  }

  const product: CatalogProduct | CatalogProductDetail | undefined =
    detail.status === "ready" ? detail.product : catalog.productsById.get(id);
  if (!product) {
    return detail.status === "error"
      ? <Container className="py-16"><ErrorPanel title="This product could not be loaded" message={detail.message} onRetry={retry} /></Container>
      : <Container className="py-16"><LoadingPanel label="Loading product…" /></Container>;
  }

  const options = variantOptions(product);
  // A choice stays valid only while the current catalog still offers it; single values need no choice.
  const effective: VariantSelection = {};
  for (const option of options) {
    const chosen = selection[option.key];
    if (chosen !== undefined && option.values.includes(chosen)) effective[option.key] = chosen;
    else if (option.values.length === 1) effective[option.key] = option.values[0];
  }
  const complete = options.every((option) => effective[option.key] !== undefined);
  const variant = complete ? findVariant(product, effective) : undefined;
  const aggregate = productStock(product);
  const available = variant ? Math.max(0, variant.stock) : aggregate.quantity;
  const level = variant ? stockLevel(variant.stock, variant.minThreshold) : stockLevel(aggregate.quantity, aggregate.lowThreshold);
  const quantity = Math.max(1, Math.min(qty, Math.max(1, available)));
  const canAdd = Boolean(variant) && available > 0;
  const price = variant ? catalog.priceOfVariant(product, variant) : catalog.priceOf(product);
  const wished = store.wishlist.includes(product.id);
  const reviews = "reviewList" in product ? product.reviewList ?? [] : [];
  const specifications = Object.entries(product.specifications);
  const tabs: InfoTab[] = specifications.length ? ["description", "specifications"] : ["description"];
  const related = catalog.products.filter((item) => item.id !== product.id && inCategory(item, product.categoryId)).slice(0, RELATED_LIMIT);
  const categoryPath = catalog.categories.path(product.categoryId);

  const images = orderedImages(product);
  const imageIndex = Math.min(activeImage, Math.max(0, images.length - 1));
  const currentImage = images[imageIndex];
  const imageError = Boolean(currentImage) && failedImage === currentImage.url;
  const imageLoading = Boolean(currentImage) && loadedImage !== currentImage.url && !imageError;

  const choose = (key: string, value: string) => {
    setSelection({ ...effective, [key]: value });
    setAdded(false);
  };
  const doAdd = () => {
    if (!user) {
      navigate("/login");
      return;
    }
    if (!variant || !canAdd) return;
    addToCart({ productId: product.id, variantId: variant.id, quantity });
    setAdded(true);
  };

  let selectionMessage = "";
  if (!options.length && !variant) selectionMessage = "This product is not currently available.";
  else if (!complete) selectionMessage = `Select ${options.filter((option) => effective[option.key] === undefined).map((option) => optionLabel(option.key).toLowerCase()).join(" and ")} to continue.`;
  else if (!variant) selectionMessage = "This combination is not available. Choose different options.";

  return (
    <Container className="py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Breadcrumb
          items={[
            { label: "Shop", to: "/shop" },
            ...categoryPath.map((category) => ({ label: category.name, to: `/shop?cat=${encodeURIComponent(category.slug)}` })),
            { label: product.name },
          ]}
        />
        <button type="button" onClick={() => navigate("/shop")} className="text-[11px] font-bold uppercase tracking-wider text-brand-primary hover:text-brand-secondary">
          ← Continue Shopping
        </button>
      </div>

      {detail.status === "error" && (
        <div role="status" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-charcoal">
          <span>Latest details and reviews could not be loaded: {detail.message}</span>
          <button type="button" onClick={retry} className="font-bold text-brand-primary underline">Try again</button>
        </div>
      )}

      <div className="mt-6 grid gap-10 lg:grid-cols-2">
        <div>
          <div className="relative aspect-square overflow-hidden rounded-lg bg-warm-beige">
            {!currentImage ? (
              <MissingImage label="Product images are not yet available" />
            ) : (
              <>
                {imageLoading && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-secondary border-t-transparent" />
                    <p className="mt-3 text-xs text-gray-500">Loading image...</p>
                  </div>
                )}
                {imageError ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
                    <p className="text-sm font-medium">Image unavailable</p>
                    <p className="mt-1 text-xs">Try another image.</p>
                  </div>
                ) : (
                  <img
                    key={currentImage.url}
                    src={currentImage.url}
                    alt={currentImage.alt || `${product.name} — image ${imageIndex + 1} of ${images.length}`}
                    className="absolute inset-0 h-full w-full object-cover transition-all duration-500 hover:scale-105"
                    onLoad={() => setLoadedImage(currentImage.url)}
                    onError={() => setFailedImage(currentImage.url)}
                  />
                )}
                {currentImage.isPlaceholder && <SampleImageLabel />}
              </>
            )}
          </div>

          {images.length > 1 && (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {images.map((image, index) => (
                <button
                  key={image.id}
                  type="button"
                  aria-label={`Show image ${index + 1} of ${images.length}`}
                  aria-pressed={index === imageIndex}
                  onClick={() => { setActiveImage(index); setFailedImage(null); }}
                  className={`relative aspect-square overflow-hidden rounded-md border-2 bg-warm-beige transition-all ${
                    index === imageIndex ? "border-brand-primary" : "border-transparent hover:border-brand-secondary"
                  }`}
                >
                  <img src={image.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-brand-accent">{product.categoryName}</p>
            {product.isDemo && <DemoBadge />}
          </div>
          <h1 className="mt-1.5 font-display text-2xl leading-tight text-brand-primary sm:text-3xl">{product.name}</h1>
          {product.isDemo && (
            <p className="mt-2 text-xs text-ocean-blue-dark">Demo listing: details, price, stock and images are samples for review, not real inventory.</p>
          )}

          <div className="mt-3 flex flex-wrap items-baseline gap-3">
            <span className="font-display text-3xl text-brand-primary">
              {price.isFromPrice && <span className="font-body text-sm">From </span>}
              {formatKES(price.price)}
            </span>
            {price.comparePrice !== null && <span className="text-base text-gray-500 line-through">{formatKES(price.comparePrice)}</span>}
            {price.discountPercent > 0 && (
              <span className="rounded-sm bg-coral px-2 py-0.5 text-xs font-bold text-white">-{price.discountPercent}%</span>
            )}
          </div>

          {product.reviewsCount > 0 && (
            <p className="mt-3 flex items-center gap-2">
              <Stars rating={product.rating} size={15} />
              <span className="text-xs text-gray-500">{product.rating.toFixed(1)} ({product.reviewsCount} {product.reviewsCount === 1 ? "review" : "reviews"})</span>
            </p>
          )}

          <div className="mt-5 rounded-md bg-off-white p-4">
            <div className="flex flex-wrap items-center gap-3">
              <StockBadge level={level} />
              {variant && available > 0 && <span className="text-xs text-gray-500">{available} available</span>}
              {!variant && options.length > 0 && <span className="text-xs text-gray-500">Availability depends on the options you choose.</span>}
            </div>
          </div>

          {options.map((option) => (
            <fieldset key={option.key} className="mt-6">
              <legend className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-primary">
                {optionLabel(option.key)}
                {effective[option.key] && <span className="ml-1 font-normal normal-case tracking-normal text-gray-500">{effective[option.key]}</span>}
              </legend>
              <div className="flex flex-wrap gap-2">
                {option.values.map((value) => {
                  const swatch = option.key === "color" ? COLOR_MAP[value] : undefined;
                  const selected = effective[option.key] === value;
                  const possible = optionAvailable(product, effective, option.key, value);
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-label={value}
                      aria-pressed={selected}
                      title={possible ? value : `${value} (not available with the current selection)`}
                      onClick={() => choose(option.key, value)}
                      style={swatch ? { background: swatch } : undefined}
                      className={swatch
                        ? `h-8 w-8 rounded-full border-2 transition-all ${selected ? "border-brand-primary ring-2 ring-brand-secondary/50 ring-offset-1" : "border-gray-300"} ${possible ? "" : "opacity-40"}`
                        : `min-w-11 rounded-sm border px-3 py-2 text-xs font-medium transition-colors ${selected ? "border-brand-primary bg-brand-primary text-white" : "border-light-gray hover:border-brand-accent"} ${possible ? "" : "opacity-50 line-through"}`}
                    >
                      {swatch ? null : value}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}

          <div className="mt-6 flex items-center gap-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-primary">Quantity</p>
            <div className="flex items-center rounded-sm border border-light-gray">
              <button type="button" aria-label="Decrease quantity" disabled={!canAdd || quantity <= 1} onClick={() => setQty(Math.max(1, quantity - 1))} className="px-3 py-2 text-sm text-gray-500 hover:text-brand-primary disabled:opacity-40">−</button>
              <span aria-live="polite" className="w-10 text-center text-sm">{quantity}</span>
              <button type="button" aria-label="Increase quantity" disabled={!canAdd || quantity >= available} onClick={() => setQty(Math.min(available, quantity + 1))} className="px-3 py-2 text-sm text-gray-500 hover:text-brand-primary disabled:opacity-40">+</button>
            </div>
          </div>

          {selectionMessage && <p role="status" className="mt-4 text-xs font-semibold text-charcoal">{selectionMessage}</p>}

          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              disabled={!canAdd}
              onClick={doAdd}
              className={`flex-1 rounded-sm py-3.5 font-body text-xs font-bold uppercase tracking-[0.12em] transition-all ${
                !canAdd
                  ? "cursor-not-allowed bg-gray-100 text-gray-500"
                  : added
                  ? "bg-success text-white"
                  : "bg-brand-primary text-white hover:bg-brand-secondary hover:text-brand-primary"
              }`}
            >
              {variant && available <= 0 ? "Out of Stock" : added ? "✓ Added to Cart" : "Add to Cart"}
            </button>
            <button
              type="button"
              aria-pressed={wished}
              onClick={() => toggleWish(product.id)}
              className={`flex-1 rounded-sm border py-3.5 font-body text-xs font-bold uppercase tracking-[0.12em] transition-all ${
                wished
                  ? "border-error/30 bg-error/5 text-error"
                  : "border-light-gray text-charcoal hover:border-brand-primary hover:text-brand-primary"
              }`}
            >
              {wished ? "♥ In Wishlist" : "♡ Add to Wishlist"}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-16">
        <div className="flex gap-0 border-b border-light-gray">
          {tabs.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={tab === name}
              onClick={() => setTab(name)}
              className={`px-5 py-3 text-[11px] font-bold uppercase tracking-[0.12em] transition-colors ${
                tab === name ? "border-b-2 border-brand-primary text-brand-primary" : "text-gray-500 hover:text-charcoal"
              }`}
            >
              {name === "description" ? "Description" : "Specifications"}
            </button>
          ))}
        </div>
        <div className="py-6 text-sm leading-relaxed text-charcoal">
          {tab === "specifications" && specifications.length ? (
            <table className="w-full max-w-2xl text-left text-sm">
              <tbody>
                {specifications.map(([name, value]) => (
                  <tr key={name} className="border-b border-light-gray">
                    <th scope="row" className="w-1/3 py-2 pr-4 font-semibold text-brand-primary">{name}</th>
                    <td className="py-2">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="whitespace-pre-line">{product.description}</p>
          )}
        </div>
      </div>

      <section aria-labelledby="reviews-title" className="mt-10">
        <h2 id="reviews-title" className="font-display text-xl uppercase tracking-wider text-brand-primary">Customer Reviews</h2>
        {reviews.length ? (
          <ul className="mt-4 grid gap-4 md:grid-cols-2">
            {reviews.map((review) => (
              <li key={review.id} className="rounded-lg bg-white p-5 shadow-sm">
                <p className="flex items-center gap-2">
                  <Stars rating={review.rating} size={13} />
                  <span className="sr-only">{review.rating} out of 5</span>
                </p>
                <p className="mt-2 text-sm text-charcoal">{review.comment}</p>
                <p className="mt-2 text-xs font-semibold text-brand-primary">
                  {review.author} · {new Date(review.createdAt).toLocaleDateString("en-KE")}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-gray-500">
            {detail.status === "ready" ? "No reviews yet." : "Reviews are shown once the latest product details load."}
          </p>
        )}
      </section>

      {related.length > 0 && (
        <section aria-labelledby="related-title" className="mt-16">
          <h2 id="related-title" className="mb-6 font-display text-xl uppercase tracking-wider text-brand-primary">More in {product.categoryName}</h2>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {related.map((item) => <ProductCard key={item.id} product={item} />)}
          </div>
        </section>
      )}
    </Container>
  );
}
