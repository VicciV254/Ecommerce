import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { catalogAPI, type CatalogProduct, type CatalogProductDetail, type CatalogReview } from "../api/catalog";
import { apiStatus, describeApiError } from "../api/errors";
import { useMiniCart } from "../components/MiniCart";
import { ProductGallery, type GalleryLayout } from "../components/ProductGallery";
import {
  AvailabilityLine,
  OptionChoices,
  PriceLine,
  PurchaseStatus,
  QuantityStepper,
  VAT_AT_CHECKOUT,
  focusFirstOption,
} from "../components/ProductPurchase";
import { PurchaseBar } from "../components/PurchaseBar";
import { ProductCard } from "../components/ProductCard";
import { Breadcrumb, Container, DemoBadge, ErrorPanel, LoadingPanel, Stars } from "../components/ui";
import { Link, useEntryFocus } from "../router";
import { useCatalog } from "../store/CatalogContext";
import { CatalogFormatError, describeVariant, inCategory, isCatalogProduct, withProductMediaDefaults } from "../store/catalogModel";
import { productReturnFact } from "../store/orderCopy";
import { SHOPPING_FACTS } from "../store/shoppingFacts";
import { useStore } from "../store/StoreContext";
import { addedMessage, useProductSelection } from "../store/useProductSelection";
import { isRecord } from "../utils/storage";

const RELATED_LIMIT = 4;

/**
 * The gallery fills the page Container (16/24/32px side padding, 1440px at most) and from 768px is the left of two
 * columns (gap 32px, 40px from 1024px). Thumbnails are four to a row with `gap-2`, measured inside their 2px borders.
 */
export const PRODUCT_GALLERY: GalleryLayout = {
  sizes: "(min-width: 768px) 50vw, 100vw",
  thumbnailSizes:
    "(min-width: 1440px) 157px, (min-width: 1024px) calc(12.5vw - 23px), (min-width: 768px) calc(12.5vw - 20px), (min-width: 640px) calc(25vw - 22px), calc(25vw - 18px)",
  thumbnails: "grid grid-cols-4 gap-2",
};

export type DetailState =
  | { status: "loading" }
  | { status: "ready"; product: CatalogProductDetail }
  | { status: "not-found" }
  | { status: "error"; message: string };

/**
 * The staff preview (admin): the same page with buying and the wishlist off, links kept inside the preview, and the
 * product name under the preview banner's H1.
 */
export type ProductPreview = {
  /** Where a related product's card leads: that product's own preview. */
  productRoute: (id: string) => string;
};
/** A heading ref that is never attached: the preview's banner takes the entry focus instead. */
const NO_ENTRY_FOCUS: RefObject<HTMLElement | null> = { current: null };

function isReview(value: unknown): value is CatalogReview {
  return isRecord(value) && typeof value.id === "string" && typeof value.rating === "number" &&
    typeof value.comment === "string" && typeof value.author === "string" && typeof value.createdAt === "string";
}

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
        if (current) setState({ status: "ready", product: { ...withProductMediaDefaults(data), reviewList: reviews } });
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
  const { state: detail, retry } = useProductDetail(id);

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
        <Link to="/shop" className="mt-4 inline-block text-sm text-ocean-blue underline">Back to shop</Link>
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
  return <ProductView product={product} detail={detail} retry={retry} />;
}

/** Side by side from 640px while both fit; with enlarged text the 10rem basis wraps them onto their own rows. */
const actionButton =
  "inline-flex min-h-[48px] flex-1 items-center justify-center rounded-sm px-5 text-sm font-bold uppercase tracking-[0.12em] transition-colors duration-(--motion-feedback) sm:basis-[10rem]";

export function ProductView({ product, detail, retry, preview }: {
  product: CatalogProduct | CatalogProductDetail;
  detail: DetailState;
  retry: () => void;
  preview?: ProductPreview;
}) {
  const catalog = useCatalog();
  const { toggleWish, state: store } = useStore();
  const miniCart = useMiniCart();
  const { selection, images, choose, setQuantity, add } = useProductSelection(product);
  const heading = useRef<HTMLHeadingElement>(null);
  const purchase = useRef<HTMLDivElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const statusId = useId();
  const factsId = useId();
  /** The last add's report, kept only while the choice and quantity it was made with are unchanged. */
  const [report, setReport] = useState<{ key: string; text: string } | null>(null);
  useEntryFocus(preview ? NO_ENTRY_FOCUS : heading);
  const NameHeading = preview ? "h2" : "h1";

  const reportKey = `${selection.choiceKey}|${selection.quantity}`;
  const wished = store.wishlist.includes(product.id);
  const reviews = "reviewList" in product ? product.reviewList ?? [] : [];
  const specifications = Object.entries(product.specifications);
  const related = catalog.products.filter((item) => item.id !== product.id && inCategory(item, product.categoryId)).slice(0, RELATED_LIMIT);
  const categoryPath = catalog.categories.path(product.categoryId);
  const returnFact = catalog.returnPolicy ? productReturnFact(product.returnRule, catalog.returnPolicy) : null;
  const incomplete = selection.status.kind === "incomplete";
  const hasChoices = selection.options.some((option) => option.kind === "choice");

  const chooseOptions = () => focusFirstOption(purchase.current);
  const doAdd = () => {
    const outcome = add();
    if (!outcome) return;
    const text = addedMessage(product.name, selection.variant ? describeVariant(selection.variant) : "", outcome);
    setReport({ key: reportKey, text });
    miniCart?.open({ message: text });
  };
  const status = report?.key === reportKey ? report.text : selection.message;

  return (
    <Container className="py-6 md:py-8">
      <Breadcrumb
        linked={!preview}
        items={[
          { label: "Shop", to: "/shop" },
          ...categoryPath.map((category) => ({ label: category.name, to: `/shop?cat=${encodeURIComponent(category.slug)}` })),
          { label: product.name },
        ]}
      />

      {detail.status === "error" && (
        <div role="status" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning-tint p-3 text-sm text-navy-800">
          <span>Latest details and reviews could not be loaded: {detail.message}</span>
          <button type="button" onClick={retry} className="inline-flex min-h-[44px] items-center font-semibold text-link underline underline-offset-4">Try again</button>
        </div>
      )}

      {/* Phones: facts, then the gallery, then the purchase controls. From 768px the gallery sits left of both. */}
      <div className="mt-4 grid items-start gap-6 md:grid-cols-2 md:grid-rows-[auto_1fr] md:gap-x-8 lg:gap-x-10">
        <div className="min-w-0 md:col-start-2 md:row-start-1">
          <NameHeading ref={heading} tabIndex={-1} className="type-h1 break-words text-navy-900">{product.name}</NameHeading>
          {product.isDemo && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ocean-blue-dark">
              <DemoBadge />
              <span>Demo listing: details, price, stock and images are samples for review, not real inventory.</span>
            </p>
          )}
          <div className="mt-3"><PriceLine price={selection.price} large /></div>
          {product.reviewsCount > 0 && (
            <p className="mt-2 flex items-center gap-2">
              <Stars rating={product.rating} size={15} />
              <span className="text-sm text-muted">{product.rating.toFixed(1)} ({product.reviewsCount} {product.reviewsCount === 1 ? "review" : "reviews"})</span>
            </p>
          )}
          <div className="mt-3"><AvailabilityLine selection={selection} /></div>
        </div>

        <div className="min-w-0 md:col-start-1 md:row-span-2 md:row-start-1">
          <ProductGallery name={product.name} images={images} resetKey={selection.choiceKey} layout={PRODUCT_GALLERY} priority />
        </div>

        <div ref={purchase} className="min-w-0 space-y-5 md:col-start-2 md:row-start-2">
          <OptionChoices selection={selection} onChoose={choose} />
          <QuantityStepper value={selection.quantity} max={selection.maxQuantity} disabled={!selection.canAdd} onChange={setQuantity} />
          <div className="space-y-3">
            {preview ? (
              <p className="rounded-sm border border-divider bg-surface-soft px-4 py-3 text-sm font-semibold text-navy-900">Buying is off in this preview.</p>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <button
                  ref={action}
                  type="button"
                  disabled={!incomplete && !selection.canAdd}
                  aria-describedby={statusId}
                  onClick={incomplete ? chooseOptions : doAdd}
                  className={`${actionButton} ${
                    incomplete || selection.canAdd
                      ? "bg-navy-900 text-white hover:bg-gold-500 hover:text-navy-900"
                      : "cursor-not-allowed bg-surface-soft text-muted"
                  }`}
                >
                  {incomplete ? "Choose options" : "Add to cart"}
                </button>
                <button
                  type="button"
                  aria-pressed={wished}
                  onClick={() => toggleWish(product.id)}
                  className={`${actionButton} border ${wished ? "border-error/40 bg-error-tint text-error" : "border-control text-navy-900 hover:border-navy-900"}`}
                >
                  {wished ? "♥ In wishlist" : "♡ Save to wishlist"}
                </button>
              </div>
            )}
            <PurchaseStatus id={statusId} message={status} tone={report?.key === reportKey ? "info" : "warning"} />
            <p className="text-sm text-muted">{VAT_AT_CHECKOUT}</p>
          </div>
          <section aria-labelledby={factsId} className="rounded-md border border-divider bg-surface-page p-4 text-sm text-navy-800">
            <h2 id={factsId} className="font-semibold text-navy-900">Delivery and returns</h2>
            <p className="mt-2"><span className="font-semibold text-navy-900">Delivery: </span>{SHOPPING_FACTS.delivery}</p>
            {returnFact && (
              <p className="mt-2"><span className="font-semibold text-navy-900">Returns: </span>{returnFact.window} {returnFact.refunds}</p>
            )}
          </section>
        </div>
      </div>

      <section aria-labelledby="details-title" className="mt-12">
        <h2 id="details-title" className="type-h2 text-navy-900">Details</h2>
        <p className="mt-3 max-w-3xl whitespace-pre-line text-navy-800">{product.description}</p>
        {specifications.length > 0 && (
          <>
            <h3 className="type-h3 mt-8 text-navy-900">Specifications</h3>
            {product.isDemo && <p className="mt-1 text-sm text-ocean-blue-dark">Sample values for review, not verified product facts.</p>}
            <dl className="mt-3 max-w-3xl divide-y divide-divider border-y border-divider">
              {specifications.map(([name, value]) => (
                <div key={name} className="grid gap-1 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-4">
                  <dt className="font-semibold text-navy-900 [overflow-wrap:anywhere]">{name}</dt>
                  <dd className="text-navy-800 [overflow-wrap:anywhere]">{value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </section>

      <section aria-labelledby="reviews-title" className="mt-12">
        <h2 id="reviews-title" className="type-h2 text-navy-900">Customer reviews</h2>
        {reviews.length ? (
          <ul className="mt-4 grid gap-4 md:grid-cols-2">
            {reviews.map((review) => (
              <li key={review.id} className="rounded-lg bg-surface p-5 shadow-card">
                <p className="flex items-center gap-2">
                  <Stars rating={review.rating} size={13} />
                  <span className="sr-only">{review.rating} out of 5</span>
                </p>
                <p className="mt-2 text-navy-800">{review.comment}</p>
                <p className="mt-2 text-sm font-semibold text-navy-900">
                  {review.author} · {new Date(review.createdAt).toLocaleDateString("en-KE")}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-muted">
            {preview ? "Reviews aren't part of this preview." : detail.status === "ready" ? "No reviews yet." : "Reviews are shown once the latest product details load."}
          </p>
        )}
      </section>

      {related.length > 0 && (
        <section aria-labelledby="related-title" className="mt-12">
          <h2 id="related-title" className="type-h2 mb-5 text-navy-900">More in {product.categoryName}</h2>
          <div className="product-grid">
            {related.map((item) => <ProductCard key={item.id} product={item} previewRoute={preview?.productRoute(item.id)} />)}
          </div>
        </section>
      )}

      {!preview && (hasChoices || selection.canAdd) && (
        <PurchaseBar inlineAction={action} price={selection.price} canAdd={selection.canAdd} onAdd={doAdd} onChooseOptions={chooseOptions} />
      )}
    </Container>
  );
}
