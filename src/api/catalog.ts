import api from "./client";
import { staffRequest } from "./staffSession";

export type MediaAsset = {
  id: string;
  productId: string | null;
  url: string;
  alt: string | null;
  isMain: boolean;
  order: number;
  width: number | null;
  height: number | null;
  isPlaceholder: boolean;
  sourceUrl: string | null;
  license: string | null;
  credit: string | null;
  version: number;
};

export type CatalogVariant = {
  id: string;
  sku: string;
  attributes: Record<string, string>;
  price: number;
  stock: number;
  maxStock: number;
  minThreshold: number;
  isActive: boolean;
};

export type CatalogProduct = {
  id: string;
  slug: string;
  name: string;
  description: string;
  price: number;
  comparePrice: number | null;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  /** Category IDs from the department through the assigned category. */
  categoryPath: string[];
  designerId: string | null;
  tags: string[];
  collection: string | null;
  specifications: Record<string, string>;
  isActive: boolean;
  isFeatured: boolean;
  isDemo: boolean;
  images: MediaAsset[];
  variants: CatalogVariant[];
  stock: number;
  maxStock: number;
  rating: number;
  reviewsCount: number;
};

export type CatalogCategory = {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  order: number;
  image: string | null;
  attributeKeys: string[];
  isActive: boolean;
  /** Visible product count including every descendant category. */
  productCount: number;
};

export type CatalogDesigner = {
  id: string;
  slug: string;
  name: string;
  specialty: string;
  location: string;
  image: string | null;
  spotlightTitle: string | null;
  spotlightText: string | null;
  isActive: boolean;
  isDemo: boolean;
};

export type CatalogDiscount = {
  id: string;
  name: string;
  type: "PERCENTAGE" | "FIXED";
  value: number;
  applyTo: "ALL" | "CATEGORY" | "SELECTED";
  targetIds: string[];
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  isDemo: boolean;
};

export type CatalogSnapshot = {
  version: 2;
  mode: "live" | "demo" | "admin";
  products: CatalogProduct[];
  categories: CatalogCategory[];
  designers: CatalogDesigner[];
  discounts: CatalogDiscount[];
};

export type StockInput = { quantity: number; maxStock?: number; minThreshold?: number };
export type MediaInput = {
  id?: string;
  url: string;
  alt?: string | null;
  isMain?: boolean;
  order?: number;
  width?: number | null;
  height?: number | null;
  isPlaceholder?: boolean;
  sourceUrl?: string | null;
  license?: string | null;
  credit?: string | null;
};
export type CatalogStock = {
  id: string;
  variantId: string;
  sku: string;
  attributes: Record<string, string>;
  productId: string;
  productName: string;
  categoryId: string;
  isDemo: boolean;
  quantity: number;
  maxStock: number;
  minThreshold: number;
  status: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";
};
export type VariantInput = {
  id?: string;
  sku?: string;
  attributes?: Record<string, string>;
  price?: number | null;
  isActive?: boolean;
  stock?: StockInput;
};
export type ProductInput = {
  name: string;
  slug?: string;
  description: string;
  price: number;
  compareAtPrice?: number | null;
  categoryId: string;
  designerId?: string | null;
  tags?: string[];
  collection?: string | null;
  specifications?: Record<string, string>;
  isActive?: boolean;
  isFeatured?: boolean;
  variants?: VariantInput[];
  images?: MediaInput[];
};
export type CategoryInput = {
  name: string;
  slug?: string;
  parentId?: string | null;
  order?: number;
  headerImage?: string | null;
  attributeKeys?: string[];
  isActive?: boolean;
};
export type DesignerInput = {
  designerId: string;
  fullName: string;
  specialty: string;
  location?: string;
  profileImage?: string | null;
  spotlightHeading?: string | null;
  spotlightText?: string | null;
  isActive?: boolean;
};

export type ThemeColors = Record<
  "primary" | "secondary" | "accent" | "warmBeige" | "oceanBlue" |
  "oceanBlueDark" | "coral" | "success" | "warning" | "error" |
  "charcoal" | "offWhite" | "lightGray" | "lightPink",
  string
>;
export type Campaign = {
  id: string;
  title: string;
  body: string;
  conditions: string;
  cta: { label: string; target: "shop" | "category" | "product"; targetId: string | null };
  desktopMediaId: string | null;
  mobileMediaId: string | null;
  desktopFocal: { x: number; y: number };
  mobileFocal: { x: number; y: number };
  layout: "split" | "overlay" | "banner";
};
export type StorefrontSettings = {
  brand: { name: string; tagline: string; logoMediaId: string | null; faviconMediaId: string | null };
  theme: { fontId: string; colors: ThemeColors };
  sections: {
    id: string;
    type: "departments" | "featured" | "products" | "campaign";
    title: string;
    enabled: boolean;
    productIds: string[];
    categoryIds: string[];
    campaignId: string | null;
  }[];
  campaigns: Campaign[];
};
export type PublishedStorefront = {
  version: number;
  publishedAt: string | null;
  settings: StorefrontSettings;
  media: MediaAsset[];
};
export type StorefrontDraft = {
  version: number;
  publishedVersion: number;
  publishedAt: string | null;
  settings: StorefrontSettings;
  /** Media referenced by the draft that still exists, including unpublished standalone assets. */
  media: MediaAsset[];
  /** Referenced media IDs that no longer exist; kept in settings so staff can repair them. */
  unavailableMediaIds: string[];
};

/** A real review record; only returned by the product detail endpoint. */
export type CatalogReview = {
  id: string;
  rating: number;
  comment: string;
  /** Reviewer first name and last initial. */
  author: string;
  createdAt: string;
};
/** `GET /products/:id`: the canonical product plus any real review records. */
export type CatalogProductDetail = CatalogProduct & { reviewList?: CatalogReview[] };

export type DiscountInput = {
  name: string;
  type: CatalogDiscount["type"];
  value: number;
  applyTo: CatalogDiscount["applyTo"];
  targetIds: string[];
  startDate: string;
  /** `null` removes the end date; omitting it on update leaves the date unchanged. */
  endDate?: string | null;
  isActive?: boolean;
};

export type StockBulkUpdate = StockInput & { variantId: string };
/** Largest batch the bulk stock endpoint accepts in one transaction. */
export const BULK_STOCK_LIMIT = 100;

const path = (base: string, id: string) => `${base}/${encodeURIComponent(id)}`;

export const catalogAPI = {
  getSnapshot: () => api.get<CatalogSnapshot>("/catalog"),
  getProduct: (id: string) => api.get<CatalogProductDetail>(path("/products", id)),
  getStorefront: () => api.get<PublishedStorefront>("/settings/storefront"),
};

/** Staff catalog operations; each request carries explicit staff credentials. */
export const catalogAdminAPI = {
  getSnapshot: async () => api.get<CatalogSnapshot>("/admin/catalog", staffRequest()),

  createProduct: async (input: ProductInput) => api.post<CatalogProduct>("/products", input, staffRequest()),
  updateProduct: async (id: string, input: Partial<ProductInput>) =>
    api.put<CatalogProduct>(path("/products", id), input, staffRequest()),
  deleteProduct: async (id: string) => api.delete<{ success: true }>(path("/products", id), staffRequest()),

  createCategory: async (input: CategoryInput) => api.post<CatalogCategory>("/categories", input, staffRequest()),
  updateCategory: async (id: string, input: Partial<CategoryInput>) =>
    api.put<CatalogCategory>(path("/categories", id), input, staffRequest()),
  deleteCategory: async (id: string) => api.delete<{ success: true }>(path("/categories", id), staffRequest()),

  createDesigner: async (input: DesignerInput) => api.post<CatalogDesigner>("/designers", input, staffRequest()),
  updateDesigner: async (id: string, input: Partial<DesignerInput>) =>
    api.put<CatalogDesigner>(path("/designers", id), input, staffRequest()),
  deleteDesigner: async (id: string) => api.delete<{ success: true }>(path("/designers", id), staffRequest()),

  getStock: async () => api.get<{ stocks: CatalogStock[] }>("/admin/stock", staffRequest()),
  updateStock: async (variantId: string, input: StockInput) =>
    api.put<CatalogStock>(path("/admin/stock", variantId), input, staffRequest()),
  /** Atomic update of up to BULK_STOCK_LIMIT distinct SKUs. */
  bulkUpdateStock: async (updates: StockBulkUpdate[]) =>
    api.post<{ stocks: CatalogStock[]; updated: number }>("/admin/stock/bulk", { updates }, staffRequest()),

  createDiscount: async (input: DiscountInput) => api.post<CatalogDiscount>("/admin/discounts", input, staffRequest()),
  updateDiscount: async (id: string, input: DiscountInput) =>
    api.put<CatalogDiscount>(path("/admin/discounts", id), input, staffRequest()),
  deleteDiscount: async (id: string) => api.delete<{ success: true }>(path("/admin/discounts", id), staffRequest()),

  registerMedia: async (input: Omit<MediaInput, "id">) => api.post<MediaAsset>("/media", input, staffRequest()),

  getStorefrontDraft: async () => api.get<StorefrontDraft>("/settings/storefront/draft", staffRequest()),
  saveStorefrontDraft: async (version: number, settings: StorefrontSettings) =>
    api.put<StorefrontDraft>("/settings/storefront/draft", { version, settings }, staffRequest()),
  publishStorefront: async (version: number) =>
    api.post<PublishedStorefront>("/settings/storefront/publish", { version }, staffRequest()),
};
