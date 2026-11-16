/**
 * Products for browser tests of selection, zoom and cart: a long-named shirt with three sizes and colours where some
 * combinations do not exist and one is sold out, with images linked to its colours. Explicitly test data; nothing here
 * is imported by the application bundle.
 */
import type { CatalogProduct, CatalogSnapshot, MediaAsset } from "../api/catalog";
import { fixtureImage, fixtureProduct, fixtureSnapshot, fixtureVariant, listPricing } from "./catalogFixtures";

/** Uploaded images are Cloudinary addresses, so renditions (and the 2400px zoom rendition) can be told apart. */
export const storedImage = (name: string) => `https://res.cloudinary.com/apex-test/image/upload/v1763200000/apex-cart/products/${name}.webp`;
/** The pixel size every stand-in image is served at (a portrait product photo). */
export const IMAGE_SIZE = { width: 1200, height: 1500 } as const;

const image = (id: string, overrides: Partial<MediaAsset> = {}) =>
  fixtureImage({ id, url: storedImage(id), ...IMAGE_SIZE, ...overrides });

export const LONG_NAME = "Heritage Organic Cotton and Linen-Blend Short-Sleeve Camp-Collar Shirt with Mother-of-Pearl Buttons";

/** Sizes S/M/L in White/Navy/Black: L/White does not exist, M/Black is sold out, and S/Navy has one left. */
export const campShirt: CatalogProduct = fixtureProduct({
  id: "prod-camp-shirt",
  name: LONG_NAME,
  isDemo: true,
  specifications: { Material: "55% organic cotton, 45% linen", Fit: "Relaxed", Care: "Machine wash cold, line dry" },
  images: [
    image("camp-front", { alt: "Camp-collar shirt laid flat, front", isMain: true, isPlaceholder: true }),
    image("camp-detail", { alt: null, order: 1, isPlaceholder: true }),
    image("camp-white", { alt: "Camp-collar shirt in white", order: 2, variantId: "camp-m-white", isPlaceholder: true }),
    image("camp-navy", { alt: "Camp-collar shirt in navy", order: 3, variantId: "camp-s-navy", isPlaceholder: true }),
    image("camp-black", { alt: "Camp-collar shirt in black", order: 4, variantId: "camp-l-black", isPlaceholder: true }),
  ],
  variants: [
    fixtureVariant({ id: "camp-s-white", attributes: { size: "S", color: "White" }, stock: 6, pricing: listPricing(3200), price: 3200 }),
    fixtureVariant({ id: "camp-m-white", attributes: { size: "M", color: "White" }, stock: 3, pricing: listPricing(3200), price: 3200 }),
    fixtureVariant({ id: "camp-s-navy", attributes: { size: "S", color: "Navy" }, stock: 1, pricing: listPricing(3400), price: 3400 }),
    fixtureVariant({ id: "camp-m-navy", attributes: { size: "M", color: "Navy" }, stock: 5, pricing: listPricing(3400), price: 3400 }),
    fixtureVariant({ id: "camp-m-black", attributes: { size: "M", color: "Black" }, stock: 0, pricing: listPricing(3400), price: 3400 }),
    fixtureVariant({ id: "camp-l-black", attributes: { size: "L", color: "Black" }, stock: 4, pricing: listPricing(3400), price: 3400 }),
  ],
});

/** The standard public snapshot plus the camp shirt. */
export function selectionSnapshot(): CatalogSnapshot {
  const snapshot = fixtureSnapshot();
  return { ...snapshot, products: [campShirt, ...snapshot.products] };
}
