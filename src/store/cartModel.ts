import type { CatalogProduct, CatalogVariant, MediaAsset } from "../api/catalog";
import { describeVariant, variantPriceView } from "./catalogModel";
import { reviewCart, type CartLineReview } from "./checkoutModel";
import { lineImage } from "./selectionModel";

/**
 * Shared cart selectors: the mini-cart and the cart page build their lines, quantities and estimated subtotal from
 * these functions only, so the two always agree. Amounts are estimates from the catalog's per-SKU prices, excluding
 * VAT and delivery; only a server quote states what is payable.
 */

type Line = { productId: string; variantId: string; quantity: number };

export type CartLineView<L extends Line = Line> = {
  /** Stable while the line exists: one line per SKU. */
  key: string;
  index: number;
  line: L;
  product: CatalogProduct | undefined;
  variant: CatalogVariant | undefined;
  /** Variant options, for example "Size: M · Color: White"; empty for single-SKU products. */
  variantLabel: string;
  image: MediaAsset | undefined;
  /** Projected unit price excluding VAT, or `null` when the SKU is no longer sold. */
  unitPrice: number | null;
  comparePrice: number | null;
  /** `unitPrice` × quantity, or `null` when there is no price. */
  subtotal: number | null;
  /** Sellable units of the SKU; 0 when it is unavailable. */
  stock: number;
  problem: CartLineReview<L>["problem"];
};

export type CartEstimate = {
  /** Units across every line, as the header badge counts them. */
  quantity: number;
  /** Estimated subtotal excluding VAT and delivery, over the lines that still have a price. */
  subtotal: number;
  /** Lines left out of the subtotal because their SKU is no longer sold. */
  excluded: number;
};

const CENTS = 100;
const toCents = (amount: number) => Math.round(amount * CENTS);

export const lineKey = (line: Line) => `${line.productId}\u0000${line.variantId}`;

export function cartLineViews<L extends Line>(cart: readonly L[], productsById: ReadonlyMap<string, CatalogProduct>): CartLineView<L>[] {
  return reviewCart(cart, productsById).lines.map(({ line, index, product, variant, problem }) => {
    const price = product && variant ? variantPriceView(variant) : null;
    return {
      key: lineKey(line),
      index,
      line,
      product,
      variant,
      variantLabel: variant ? describeVariant(variant) : "",
      image: product ? lineImage(product.images, line.variantId) : undefined,
      unitPrice: price?.price ?? null,
      comparePrice: price?.comparePrice ?? null,
      subtotal: price ? (toCents(price.price) * line.quantity) / CENTS : null,
      stock: product && variant ? Math.max(0, variant.stock) : 0,
      problem,
    };
  });
}

export function cartEstimate(lines: readonly CartLineView[]): CartEstimate {
  let cents = 0;
  let quantity = 0;
  let excluded = 0;
  for (const view of lines) {
    quantity += view.line.quantity;
    if (view.unitPrice === null) excluded += 1;
    else cents += toCents(view.unitPrice) * view.line.quantity;
  }
  return { quantity, subtotal: cents / CENTS, excluded };
}

/** How much of a requested add fits within the SKU's stock, given what the cart already holds. */
export type PlannedAdd = {
  /** Units to add now; 0 when the cart already holds all the stock. */
  quantity: number;
  /** Units the cart will hold for the SKU afterwards. */
  total: number;
  /** True when fewer than the requested units fit. */
  clamped: boolean;
};

export function planAdd(cart: readonly Line[], line: Line, stock: number): PlannedAdd {
  const held = cart.find((item) => item.productId === line.productId && item.variantId === line.variantId)?.quantity ?? 0;
  const room = Math.max(0, Math.max(0, stock) - held);
  const quantity = Math.min(line.quantity, room);
  return { quantity, total: held + quantity, clamped: quantity < line.quantity };
}

/** The message for an add that did not fit in full, or `null` when every requested unit was added. */
export function clampedAddMessage(plan: PlannedAdd, stock: number): string | null {
  if (!plan.clamped) return null;
  if (plan.quantity === 0) return `Your cart already has all ${stock} available, so nothing more was added.`;
  return `Only ${stock} available, so your cart now has ${plan.total}.`;
}

/* ------------------------------------------------------------------ */
/* Guest-cart merge on sign-in                                         */
/* ------------------------------------------------------------------ */

export type MergeEntry = {
  productId: string;
  variantId: string;
  name: string;
  variantLabel: string;
  /** Units the guest cart held. */
  requested: number;
  /** Units the account cart holds for the SKU afterwards (0 for removed lines). */
  quantity: number;
};
export type MergeRemoval = MergeEntry & { reason: "unavailable" | "sold-out" };

export type MergeOutcome<L extends Line = Line> = {
  cart: L[];
  /** Guest lines added in full (new lines or added to an existing line). */
  added: MergeEntry[];
  /** Guest lines that only partly fit: the account line now holds `quantity`, the SKU's stock. */
  reduced: MergeEntry[];
  /** Guest lines left out because the SKU is no longer sold or is sold out. */
  removed: MergeRemoval[];
};

/** How a merged line is named once its product has left the catalog. */
const MISSING_PRODUCT = "An item you added earlier";

export const mergeChanged = (outcome: Pick<MergeOutcome, "added" | "reduced" | "removed">) =>
  outcome.added.length + outcome.reduced.length + outcome.removed.length > 0;

/**
 * Adds a guest cart to an account cart, keyed by SKU: quantities are summed and clamped to stock, and lines whose SKU
 * is no longer sold or is sold out are left out. Account lines without a guest counterpart are unchanged. Merging an
 * empty guest cart changes nothing, so a merge that runs twice (the guest cart is cleared after the first) adds nothing.
 */
export function mergeGuestCart(
  account: readonly Line[], guest: readonly Line[], productsById: ReadonlyMap<string, CatalogProduct>,
): MergeOutcome {
  const cart = account.map((line) => ({ productId: line.productId, variantId: line.variantId, quantity: line.quantity }));
  const outcome: MergeOutcome = { cart, added: [], reduced: [], removed: [] };
  for (const line of guest) {
    const product = productsById.get(line.productId);
    const variant = product?.variants.find((item) => item.id === line.variantId && item.isActive);
    const base = {
      productId: line.productId,
      variantId: line.variantId,
      name: product?.name ?? MISSING_PRODUCT,
      variantLabel: variant ? describeVariant(variant) : "",
      requested: line.quantity,
    };
    if (!product || !variant) {
      outcome.removed.push({ ...base, quantity: 0, reason: "unavailable" });
      continue;
    }
    const stock = Math.max(0, variant.stock);
    const existing = cart.find((item) => item.productId === line.productId && item.variantId === line.variantId);
    if (stock === 0) {
      outcome.removed.push({ ...base, quantity: existing?.quantity ?? 0, reason: "sold-out" });
      continue;
    }
    const wanted = (existing?.quantity ?? 0) + line.quantity;
    const quantity = Math.min(wanted, stock);
    if (existing) existing.quantity = quantity;
    else cart.push({ productId: line.productId, variantId: line.variantId, quantity });
    (quantity < wanted ? outcome.reduced : outcome.added).push({ ...base, quantity });
  }
  return outcome;
}
