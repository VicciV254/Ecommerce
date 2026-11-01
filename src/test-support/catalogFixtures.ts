/**
 * Canonical API fixtures shared by unit and browser tests. Records are explicitly
 * test data; nothing here is imported by the application bundle.
 */
import type {
  CatalogCategory,
  CatalogDesigner,
  CatalogDiscount,
  CatalogProduct,
  CatalogSnapshot,
  CatalogVariant,
  MediaAsset,
  PublishedStorefront,
  StorefrontSettings,
  VariantPricing,
} from "../api/catalog";

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** An undiscounted server projection; discounted fixtures spell out the server's numbers explicitly. */
export function listPricing(price: number): VariantPricing {
  return { price, originalPrice: price, comparePrice: null, discountPercent: 0, discountId: null };
}

/** Defaults to an undiscounted projection of `price`; `stock` is available units and `onHand` adds `reserved`. */
export function fixtureVariant(overrides: Partial<CatalogVariant> & Pick<CatalogVariant, "id">): CatalogVariant {
  const price = overrides.price ?? 1000;
  const stock = overrides.stock ?? 10;
  const reserved = overrides.reserved ?? 0;
  return {
    sku: overrides.id.toUpperCase(), attributes: {}, price, pricing: listPricing(price),
    onHand: stock + reserved, reserved, stock, maxStock: 100, minThreshold: 3, isActive: true,
    ...overrides,
  };
}

export function fixtureImage(overrides: Partial<MediaAsset> & Pick<MediaAsset, "id" | "url">): MediaAsset {
  return {
    productId: null, alt: null, isMain: false, order: 0, width: null, height: null, isPlaceholder: false,
    sourceUrl: null, license: null, credit: null, version: 1,
    ...overrides,
  };
}

export function fixtureCategory(overrides: Partial<CatalogCategory> & Pick<CatalogCategory, "id" | "name">): CatalogCategory {
  return {
    slug: slug(overrides.name), parentId: null, order: 0, image: null, attributeKeys: [], isActive: true, productCount: 0,
    ...overrides,
  };
}

export function fixtureProduct(overrides: Partial<CatalogProduct> & Pick<CatalogProduct, "id" | "name">): CatalogProduct {
  return {
    slug: slug(overrides.name), description: `${overrides.name} described for automated tests.`, price: 1000, comparePrice: null,
    categoryId: "cat-shirts", categoryName: "Shirts", categorySlug: "shirts", categoryPath: ["cat-fashion", "cat-men", "cat-shirts"],
    designerId: null, tags: [], collection: null, specifications: {}, isActive: true, isFeatured: false, isDemo: false,
    images: [], variants: [fixtureVariant({ id: `${overrides.id}-sku` })], stock: 10, maxStock: 100, rating: 0, reviewsCount: 0,
    ...overrides,
  };
}

export const fixtureCategories: CatalogCategory[] = [
  fixtureCategory({ id: "cat-fashion", name: "Fashion", order: 1, productCount: 3 }),
  fixtureCategory({ id: "cat-men", name: "Men", parentId: "cat-fashion", productCount: 3 }),
  fixtureCategory({ id: "cat-shirts", name: "Shirts", parentId: "cat-men", attributeKeys: ["Material"], productCount: 3 }),
  fixtureCategory({ id: "cat-phones-tablets", name: "Phones & Tablets", order: 0, productCount: 1 }),
  fixtureCategory({ id: "cat-smartphones", name: "Smartphones", parentId: "cat-phones-tablets", productCount: 1 }),
];

export const fixtureDesigners: CatalogDesigner[] = [{
  id: "designer-1", slug: "test-studio", name: "Test Studio", specialty: "Tailoring", location: "Nairobi",
  image: null, spotlightTitle: null, spotlightText: null, isActive: true, isDemo: false,
}];

/** The server's projection of the 10% linen promotion on KES 1,000: displayed as KES 900, never recomputed. */
export const linenPromoPricing: VariantPricing = {
  price: 900, originalPrice: 1000, comparePrice: 1000, discountPercent: 10, discountId: "disc-linen",
};

/** A multi-SKU shirt: not every size/colour combination exists, and one SKU is sold out. */
export const linenShirt = fixtureProduct({
  id: "prod-linen-shirt",
  name: "Linen Short-Sleeve Shirt",
  tags: ["shirt", "linen"],
  collection: "Summer edit",
  designerId: "designer-1",
  isFeatured: true,
  specifications: { Material: "Linen" },
  images: [
    fixtureImage({ id: "img-linen-1", url: "https://media.example.test/linen-front.jpg", alt: "Linen shirt, front", isMain: true }),
    fixtureImage({ id: "img-linen-2", url: "https://media.example.test/linen-detail.jpg", alt: "Linen shirt, collar detail", order: 1 }),
  ],
  variants: [
    fixtureVariant({ id: "var-linen-s-white", attributes: { size: "S", color: "White" }, stock: 4, pricing: linenPromoPricing }),
    fixtureVariant({ id: "var-linen-m-white", attributes: { size: "M", color: "White" }, stock: 2, pricing: linenPromoPricing }),
    fixtureVariant({ id: "var-linen-m-blue", attributes: { size: "M", color: "Blue" }, stock: 0, pricing: linenPromoPricing }),
  ],
});

export const poloShirt = fixtureProduct({
  id: "prod-polo-shirt",
  name: "Cotton Polo Shirt",
  price: 2200,
  tags: ["shirt", "polo"],
  images: [fixtureImage({ id: "img-polo", url: "https://media.example.test/polo.jpg", isMain: true })],
  variants: [fixtureVariant({ id: "var-polo", price: 2200, stock: 12 })],
});

export const imagelessShirt = fixtureProduct({
  id: "prod-oxford-shirt",
  name: "Oxford Shirt Without Images",
  price: 1800,
  variants: [fixtureVariant({ id: "var-oxford", price: 1800, stock: 5 })],
});

export const demoPhone = fixtureProduct({
  id: "prod-demo-phone",
  name: "Demo Smartphone",
  price: 15000,
  isDemo: true,
  categoryId: "cat-smartphones", categoryName: "Smartphones", categorySlug: "smartphones",
  categoryPath: ["cat-phones-tablets", "cat-smartphones"],
  images: [fixtureImage({
    id: "img-demo-phone", url: "https://media.example.test/sample-phone.jpg", isMain: true, isPlaceholder: true,
    sourceUrl: "https://images.example.test/source", license: "Test licence",
  })],
  variants: [fixtureVariant({
    id: "var-demo-phone", price: 15000, stock: 7,
    pricing: { price: 7500, originalPrice: 15000, comparePrice: 15000, discountPercent: 50, discountId: "disc-demo" },
  })],
});

/** 10% off the linen shirt only; the demo discount must never touch real products. Prices above are the server's projections. */
export const fixtureDiscounts: CatalogDiscount[] = [
  {
    id: "disc-linen", name: "Linen promotion", type: "PERCENTAGE", value: 10, couponCode: null, applyTo: "SELECTED", targetIds: [linenShirt.id],
    startDate: "2000-01-01T00:00:00.000Z", endDate: "2100-01-01T00:00:00.000Z", isActive: true, isDemo: false,
  },
  {
    id: "disc-demo", name: "Demo storewide", type: "PERCENTAGE", value: 50, couponCode: null, applyTo: "ALL", targetIds: [],
    startDate: "2000-01-01T00:00:00.000Z", endDate: null, isActive: true, isDemo: true,
  },
];

export function fixtureSnapshot(overrides: Partial<CatalogSnapshot> = {}): CatalogSnapshot {
  return {
    version: 2, mode: "demo",
    products: [linenShirt, poloShirt, imagelessShirt, demoPhone],
    categories: fixtureCategories, designers: fixtureDesigners, discounts: fixtureDiscounts,
    ...overrides,
  };
}

export const campaignMedia: MediaAsset[] = [
  fixtureImage({ id: "media-campaign-desktop", url: "https://media.example.test/campaign-desktop.jpg", alt: "" }),
  fixtureImage({ id: "media-campaign-mobile", url: "https://media.example.test/campaign-mobile.jpg", alt: "" }),
];

export function fixtureStorefrontSettings(overrides: Partial<StorefrontSettings> = {}): StorefrontSettings {
  return {
    brand: { name: "Apex Cart", tagline: "", logoMediaId: null, faviconMediaId: null },
    theme: {
      fontId: "default",
      colors: {
        primary: "#14213d", secondary: "#d4a73c", accent: "#926d21", warmBeige: "#f4f1e9",
        oceanBlue: "#1d4e89", oceanBlueDark: "#173f6e", coral: "#b75238", success: "#237a4b",
        warning: "#9a6700", error: "#b42318", charcoal: "#253044", offWhite: "#f8fafc",
        lightGray: "#d8dee7", lightPink: "#eef2f7",
      },
    },
    sections: [
      { id: "departments", type: "departments", title: "Shop by department", enabled: true, productIds: [], categoryIds: [], campaignId: null },
      { id: "featured", type: "featured", title: "Featured products", enabled: true, productIds: [], categoryIds: [], campaignId: null },
    ],
    campaigns: [],
    ...overrides,
  };
}

export function fixtureStorefront(overrides: Partial<PublishedStorefront> = {}): PublishedStorefront {
  return {
    version: 3, publishedAt: "2026-10-31T00:00:00.000Z", settings: fixtureStorefrontSettings(), media: campaignMedia,
    ...overrides,
  };
}
