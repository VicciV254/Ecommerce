import { isRecord } from "../utils/storage";
import api from "./client";
import type { DeliveryFeeRefund, DeliveryMethod, Pagination, ReturnRule } from "./orders";
import { staffRequest } from "./staffSession";

export type MediaAsset = {
  id: string;
  productId: string | null;
  /** Product images only: the variant this image shows, or null for the whole product. */
  variantId: string | null;
  url: string;
  alt: string | null;
  isMain: boolean;
  order: number;
  width: number | null;
  height: number | null;
  /** Set only for uploaded files, so `format !== null` marks an image whose file cannot change in place. */
  format: string | null;
  bytes: number | null;
  isPlaceholder: boolean;
  sourceUrl: string | null;
  license: string | null;
  credit: string | null;
  version: number;
};

/** Server-computed unit price for one SKU. Shoppers see this; the client never recomputes it. */
export type VariantPricing = {
  /** Payable unit price after the strongest automatic offer (coupons excluded). */
  price: number;
  /** SKU price before automatic offers. */
  originalPrice: number;
  /** Struck-through reference price, when the server supplies one. */
  comparePrice: number | null;
  discountPercent: number;
  discountId: string | null;
};

export type CatalogVariant = {
  id: string;
  sku: string;
  attributes: Record<string, string>;
  /** Base SKU price for staff editing; never used to settle or display a payable price. */
  price: number;
  pricing: VariantPricing;
  /** Units physically held. */
  onHand: number;
  /** Units held for unpaid pending orders. */
  reserved: number;
  /** Sellable units: on hand minus reserved. */
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
  /** Effective return rule from the product's category path. */
  returnRule: ReturnRule;
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
  /** The category's own return rule; null inherits the nearest ancestor's (STANDARD at the top). */
  returnRule: ReturnRule | null;
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
  /** Coupon-only offers apply in checkout quotes when the code is entered; public snapshots omit them. */
  couponCode: string | null;
  applyTo: "ALL" | "CATEGORY" | "SELECTED";
  targetIds: string[];
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  isDemo: boolean;
};

/** Public return terms for new orders; each order keeps the terms it was bought under. */
export type CatalogReturnPolicy = {
  version: number;
  windowDays: number;
  deliveryFeeRefund: DeliveryFeeRefund;
  partialReturns: boolean;
  refundRounding: "UP_TO_WHOLE_KES";
};

/** A delivery method new orders can use, as the checkout policy offers it; quotes still decide the fee charged. */
export type CatalogDelivery = {
  method: DeliveryMethod;
  fee: number;
  /** Merchandise total from which delivery is free; null when it never is. */
  freeAbove: number | null;
  /** Display names of the counties covered; empty means anywhere in Kenya. */
  counties: string[];
};

export type CatalogSnapshot = {
  version: 2;
  mode: "live" | "demo" | "admin";
  products: CatalogProduct[];
  categories: CatalogCategory[];
  designers: CatalogDesigner[];
  discounts: CatalogDiscount[];
  returnPolicy: CatalogReturnPolicy;
  /** The offered methods, in the order shoppers see them; at least one. */
  delivery: CatalogDelivery[];
};

/** A staff record's version: the `updatedAt` an editor loaded, sent back with its save (an older one is refused). */
type Versioned = { updatedAt: string };
export type AdminCatalogProduct = CatalogProduct & Versioned;
export type AdminCatalogCategory = CatalogCategory & Versioned;
/** `GET /admin/catalog`: every product and category, hidden ones included, each with its version. */
export type AdminCatalogSnapshot = Omit<CatalogSnapshot, "mode" | "products" | "categories"> & {
  mode: "admin";
  products: AdminCatalogProduct[];
  categories: AdminCatalogCategory[];
};
/** A staff edit: the changes plus the version the editor loaded (`expectedUpdatedAt`). */
export type VersionedEdit<T> = Partial<T> & { expectedUpdatedAt: string };

/** `quantity` is the on-hand count; the server rejects values below the reserved units. */
export type StockInput = { quantity: number; maxStock?: number; minThreshold?: number };
/** Cloudinary's response to a signed upload, in the shape the media API verifies. */
export type CloudinaryUpload = { publicId: string; version: number; signature: string; format: string; bytes: number };
export type MediaInput = {
  id?: string;
  /** Required for a new image unless `cloudinary` is given, and omitted when it is. */
  url?: string;
  /** A new upload; `width` and `height` are required alongside it. Retained images never carry it. */
  cloudinary?: CloudinaryUpload;
  /** Product images only; `null` means the whole product. New products can only use `null`. */
  variantId?: string | null;
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
  /** On-hand units. */
  quantity: number;
  /** Units held for unpaid pending orders. */
  reserved: number;
  /** Sellable units; `status` is derived from this. */
  available: number;
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
/** Category order changes only through `reorderCategories`; a new category goes after its last sibling. */
export type CategoryInput = {
  name: string;
  slug?: string;
  parentId?: string | null;
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
  /** Username of the staff member who published `publishedVersion`; null when none was recorded. */
  publishedBy: string | null;
  settings: StorefrontSettings;
  /** Media referenced by the draft that still exists, including unpublished standalone assets. */
  media: MediaAsset[];
  /** Referenced media IDs that no longer exist; kept in settings so staff can repair them. */
  unavailableMediaIds: string[];
};

/** One publication in the storefront's history (never its document). `live` marks the version shoppers see. */
export type StorefrontRevision = {
  version: number;
  publishedAt: string;
  /** Null when nobody recorded the publisher. */
  publishedBy: string | null;
  live: boolean;
};
/** `GET /settings/storefront/revisions?page=`: newest first, 20 a page; validated by `parseRevisionPage`. */
export type StorefrontRevisionPage = { revisions: StorefrontRevision[]; pagination: Pagination };

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
  /** `null` makes the discount automatic; a code limits it to checkout quotes that enter it. */
  couponCode?: string | null;
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
  getSnapshot: async () => api.get<AdminCatalogSnapshot>("/admin/catalog", staffRequest()),

  createProduct: async (input: ProductInput) => api.post<AdminCatalogProduct>("/products", input, staffRequest()),
  /** 409 `PRODUCT_CHANGED` when the product changed after `expectedUpdatedAt`; nothing is written then. */
  updateProduct: async (id: string, input: VersionedEdit<ProductInput>) =>
    api.put<AdminCatalogProduct>(path("/products", id), input, staffRequest()),
  deleteProduct: async (id: string) => api.delete<{ success: true }>(path("/products", id), staffRequest()),

  createCategory: async (input: CategoryInput) => api.post<AdminCatalogCategory>("/categories", input, staffRequest()),
  /** 409 `CATEGORY_CHANGED` when the category changed after `expectedUpdatedAt`; nothing is written then. */
  updateCategory: async (id: string, input: VersionedEdit<CategoryInput>) =>
    api.put<AdminCatalogCategory>(path("/categories", id), input, staffRequest()),
  /**
   * Every child of `parentId` (null for departments) in its new order; 409 `CATEGORY_SIBLINGS_CHANGED` when that is
   * not exactly the current set of children.
   */
  reorderCategories: async (parentId: string | null, orderedIds: string[]) =>
    api.post<{ categories: AdminCatalogCategory[] }>("/categories/reorder", { parentId, orderedIds }, staffRequest()),
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
  /** 409 `STOREFRONT_CHANGED` (or `CATALOG_CHANGED` for a write that raced it) when the draft changed after `version`. */
  saveStorefrontDraft: async (version: number, settings: StorefrontSettings) =>
    api.put<StorefrontDraft>("/settings/storefront/draft", { version, settings }, staffRequest()),
  /** 409 `STOREFRONT_CHANGED` or `CATALOG_CHANGED` as for saves; nothing is published then. */
  publishStorefront: async (version: number) =>
    api.post<PublishedStorefront>("/settings/storefront/publish", { version }, staffRequest()),
  /** Any staff member may read the history; the answer is checked by `parseRevisionPage`. */
  getStorefrontRevisions: async (page: number) =>
    api.get<unknown>("/settings/storefront/revisions", staffRequest({ page })),
  /**
   * Copies published version `revision` into the draft; `draftVersion` is the draft version the editor holds. Answers
   * with the new draft. Refusals change nothing: 409 `STOREFRONT_CHANGED` or `CATALOG_CHANGED` (the draft changed;
   * reload), 404 `REVISION_NOT_FOUND`, 409 `REVISION_INVALID` (it breaks the current rules) and 409
   * `REVISION_UNAVAILABLE` (it uses a deleted product, category or image), each with a message to show as it is.
   */
  restoreStorefrontRevision: async (revision: number, draftVersion: number) =>
    api.post<StorefrontDraft>(`/settings/storefront/revisions/${revision}/restore`, { version: draftVersion }, staffRequest()),
};

export type MediaPurpose = "PRODUCT" | "STOREFRONT";

/** Signed fields for one direct browser upload. Request a fresh intent for every file and every attempt. */
export type UploadIntent = {
  /** Cloudinary's upload endpoint: the file goes there directly, never through this API. */
  uploadUrl: string;
  /** Sent unchanged alongside the file, with nothing added. */
  fields: Record<string, string>;
  maxBytes: number;
  acceptedTypes: string[];
  expiresAt: string;
};

export class UploadIntentFormatError extends Error {
  constructor() {
    super("The upload service returned an unexpected response. Try again.");
    this.name = "UploadIntentFormatError";
  }
}

/** Files are only ever sent to Cloudinary's upload API. */
const UPLOAD_ORIGIN = "https://api.cloudinary.com";

function isUploadUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.origin === UPLOAD_ORIGIN && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isUploadIntent(value: unknown): value is UploadIntent {
  return isRecord(value) && isUploadUrl(value.uploadUrl) &&
    isRecord(value.fields) && Object.values(value.fields).every((field) => typeof field === "string") &&
    Number.isInteger(value.maxBytes) && Number(value.maxBytes) > 0 &&
    Array.isArray(value.acceptedTypes) && value.acceptedTypes.every((type) => typeof type === "string") &&
    typeof value.expiresAt === "string";
}

/** `POST /media/uploads` for editing staff; 503 `MEDIA_UPLOADS_DISABLED` means uploads are not configured. */
export async function requestMediaUpload(purpose: MediaPurpose): Promise<UploadIntent> {
  const { data } = await api.post<unknown>("/media/uploads", { purpose }, staffRequest());
  if (!isUploadIntent(data)) throw new UploadIntentFormatError();
  return data;
}
