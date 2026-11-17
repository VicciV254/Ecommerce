import { useEffect, useMemo, type RefObject } from "react";
import { Link, useRoute, useRouteState } from "../../router";
import { CatalogSnapshotProvider } from "../../store/CatalogContext";
import { ProductView, type DetailState, type ProductPreview as PreviewOptions } from "../ProductDetail";
import { useOptionalAdminCatalog } from "./AdminCatalogContext";
import { NEW_PRODUCT, adminModuleRoute, parseProductParam, productPreviewRoute, productsRoute, routePath } from "./adminRoutes";
import { PRODUCT_NOT_FOUND } from "./CatalogManager";
import { useCarry } from "./carriedNotice";
import { productReadiness, type Readiness } from "./catalogReadiness";

/** Related products lead to their own previews, never to shoppers' pages. */
const PREVIEW: PreviewOptions = { productRoute: productPreviewRoute };
const ignore = () => undefined;

/** Why shoppers can or can't see the product, in one sentence. */
function visibility(isActive: boolean, readiness: Readiness | null) {
  if (!isActive) return { live: false, reason: "Hidden (draft): only staff can see it." };
  if (readiness?.open.includes("category-hidden")) {
    return { live: false, reason: readiness.hiddenCategory ? `Its category, ${readiness.hiddenCategory.name}, is hidden.` : "Its category is not available to shoppers." };
  }
  if (readiness?.open.includes("no-active-option")) return { live: false, reason: "It has no active option to buy." };
  return { live: true, reason: "Visible to shoppers." };
}

/**
 * One saved product on shoppers' own product page, taken from the staff catalog (so a hidden product in a hidden
 * category still renders), under a banner saying whether shoppers can see it. Buying is off and the preview makes no
 * cart, wishlist, order or payment request. Every staff role may open it; an unknown or malformed product id goes back
 * to the products list, which says so.
 */
export function ProductPreview({ heading }: { heading: RefObject<HTMLHeadingElement | null> }) {
  const catalog = useOptionalAdminCatalog();
  const route = useRoute();
  const { previous } = useRouteState();
  const carry = useCarry();
  const requested = parseProductParam(route);
  const data = catalog?.data ?? null;
  const product = requested.id !== null && requested.id !== NEW_PRODUCT
    ? data?.snapshot.products.find((item) => item.id === requested.id) ?? null
    : null;
  const missing = requested.id === null || requested.id === NEW_PRODUCT || (data !== null && product === null);
  useEffect(() => {
    if (missing) carry(productsRoute(), PRODUCT_NOT_FOUND);
  }, [missing, carry]);

  const readiness = product && catalog ? productReadiness(product, catalog.categories) : null;
  const shown = product ? visibility(product.isActive, readiness) : null;
  const detail = useMemo<DetailState | null>(() => (product ? { status: "ready", product } : null), [product]);
  // Back to the editor this preview was opened from (with its list filters), or to the product's editor.
  const back = product === null
    ? productsRoute()
    : previous !== null && routePath(previous) === adminModuleRoute("products") && parseProductParam(previous).id === product.id
      ? previous
      : productsRoute(product.id);

  return (
    // Edge to edge inside the content area: the shell's padding is cancelled so the shoppers' page keeps its own.
    <div className="-mx-4 -mt-6 sm:-mx-6 lg:-mx-8">
      <div className="on-navy border-b-4 border-gold-400 bg-navy-950 px-4 py-[12px] text-white sm:px-6 lg:px-8 [overflow-wrap:anywhere]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h1 ref={heading} tabIndex={-1} className="text-lg font-semibold leading-7">
              {shown ? (shown.live ? "Preview of the live product" : "Preview: shoppers can't see this product") : "Product preview"}
            </h1>
            {shown && (
              <p className="text-sm text-on-navy-muted">
                {shown.reason} This shows the saved product: changes not yet saved in the editor are not included.
              </p>
            )}
          </div>
          <Link
            to={back}
            className="inline-flex min-h-[44px] items-center rounded-sm border border-white/70 px-[14px] text-sm font-semibold text-white transition-colors duration-(--motion-feedback) hover:bg-white/10"
          >
            Back to product
          </Link>
        </div>
      </div>

      {!data && !catalog?.error && <p role="status" className="px-4 py-6 text-navy-800 sm:px-6 lg:px-8">Loading catalog data…</p>}
      {data && product && detail && (
        <section aria-label="Product preview" className="bg-surface-page">
          <CatalogSnapshotProvider snapshot={data.snapshot} reload={catalog?.reload}>
            <ProductView key={product.id} product={product} detail={detail} retry={ignore} preview={PREVIEW} />
          </CatalogSnapshotProvider>
        </section>
      )}
    </div>
  );
}
