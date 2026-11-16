import { useCallback, useMemo, useState } from "react";
import type { CatalogProduct, CatalogVariant } from "../api/catalog";
import type { VariantSelection } from "./catalogModel";
import { clampedAddMessage, planAdd } from "./cartModel";
import { galleryImages, resolveSelection } from "./selectionModel";
import { useStore } from "./StoreContext";

export type AddOutcome = {
  /** Units added now; 0 when the cart already held all the stock. */
  added: number;
  /** Units the cart holds for the SKU afterwards. */
  total: number;
  /** Why fewer units were added than requested, or `null`. */
  message: string | null;
};

/** The sentence reporting an add: what was added, or why less than requested fit. */
export function addedMessage(name: string, variantLabel: string, outcome: AddOutcome) {
  return outcome.message ?? `Added ${name}${variantLabel ? ` (${variantLabel})` : ""} to your cart.`;
}

/**
 * Adds one SKU as `{ productId, variantId, quantity }`. An identical line grows instead, never beyond the SKU's
 * stock; the outcome says when the request was cut down.
 */
export function useAddToCart() {
  const { state, addToCart } = useStore();
  return useCallback((product: Pick<CatalogProduct, "id">, variant: CatalogVariant, quantity: number): AddOutcome => {
    const plan = planAdd(state.cart, { productId: product.id, variantId: variant.id, quantity }, variant.stock);
    if (plan.quantity > 0) addToCart({ productId: product.id, variantId: variant.id, quantity: plan.quantity });
    return { added: plan.quantity, total: plan.total, message: clampedAddMessage(plan, variant.stock) };
  }, [state.cart, addToCart]);
}

/** The shared selection state behind the product page and Quick View: choices, quantity, gallery order and Add. */
export function useProductSelection(product: CatalogProduct) {
  const [choices, setChoices] = useState<VariantSelection>({});
  const [quantity, setQuantity] = useState(1);
  const addLine = useAddToCart();
  const selection = useMemo(() => resolveSelection(product, choices, quantity), [product, choices, quantity]);
  const images = useMemo(() => galleryImages(product, selection), [product, selection]);
  const choose = useCallback(
    (key: string, value: string) => setChoices({ ...selection.choices, [key]: value }),
    [selection.choices],
  );
  const add = useCallback(
    () => (selection.canAdd && selection.variant ? addLine(product, selection.variant, selection.quantity) : null),
    [addLine, product, selection],
  );
  return { selection, images, choose, setQuantity, add };
}
