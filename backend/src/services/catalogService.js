import prisma from '../config/database.js';
import { storefrontSchema, STOREFRONT_KEY } from '../utils/catalogValidation.js';
import { checkoutPolicy } from '../config/checkoutPolicy.js';
import { unitPrice } from './pricingService.js';

export { STOREFRONT_KEY };
export const httpError = (statusCode, message, code) => Object.assign(new Error(message), { statusCode, ...(code && { code }) });
export const availableStock = (stock) => {
  if (!Number.isInteger(stock.quantity) || !Number.isInteger(stock.reserved) || stock.reserved < 0 || stock.reserved > stock.quantity) {
    throw httpError(503, 'Variant inventory data is inconsistent', 'INVENTORY_REVIEW');
  }
  return stock.quantity - stock.reserved;
};
export const demoCatalogEnabled = () => process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEMO_CATALOG === 'true';

export function serializable(operation) {
  return prisma.$transaction(operation, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 20_000 })
    .catch((error) => {
      if (error.code === 'P2034') throw httpError(409, 'The catalog changed concurrently. Reload and retry your change.');
      throw error;
    });
}

export function categoryContext(categories, invalidStatus = 503) {
  const byId = new Map(categories.map((item) => [item.id, item]));
  const paths = new Map();
  const visible = new Set();
  for (const category of categories) {
    const seen = new Set();
    const path = [];
    let current = category;
    while (current) {
      if (seen.has(current.id)) throw httpError(invalidStatus, 'Category hierarchy contains a cycle');
      seen.add(current.id);
      path.unshift(current);
      if (current.parentId && !byId.has(current.parentId)) throw httpError(invalidStatus, 'Category parent does not exist');
      current = current.parentId ? byId.get(current.parentId) : null;
    }
    paths.set(category.id, path);
    if (path.every((item) => item.isActive && !item.deletedAt)) visible.add(category.id);
  }
  return { categories, byId, paths, visible };
}

export const loadCategories = async (db = prisma) => categoryContext(await db.category.findMany({
  orderBy: [{ order: 'asc' }, { name: 'asc' }, { id: 'asc' }],
}));

export async function loadCatalogContext(db = prisma) {
  const [context, discounts] = await Promise.all([
    loadCategories(db), db.discount.findMany({ orderBy: { id: 'asc' } }),
  ]);
  return { ...context, discounts, policy: checkoutPolicy(), pricedAt: new Date() };
}

export function productWhere(context, admin = false) {
  if (admin) return { deletedAt: null };
  return {
    deletedAt: null,
    isActive: true,
    categoryId: { in: [...context.visible] },
    ...(!demoCatalogEnabled() && { isDemo: false }),
    variants: { some: { isActive: true } },
    OR: [
      { designerId: null },
      { designer: { is: { isActive: true, deletedAt: null, ...(!demoCatalogEnabled() && { isDemo: false }) } } },
    ],
  };
}

export const productInclude = (admin = false) => ({
  category: true,
  designer: true,
  images: { where: { deletedAt: null }, orderBy: [{ order: 'asc' }, { id: 'asc' }] },
  variants: {
    ...(!admin && { where: { isActive: true } }),
    include: { stock: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
});

export function mediaDto(image) {
  return {
    id: image.id, productId: image.productId, url: image.url, alt: image.alt,
    isMain: image.isMain, order: image.order, width: image.width, height: image.height,
    isPlaceholder: image.isPlaceholder, sourceUrl: image.sourceUrl,
    license: image.license, credit: image.credit, version: image.version,
  };
}

export function productDto(product, context) {
  const path = context.paths.get(product.categoryId);
  if (!path) throw httpError(503, 'Product category data is incomplete');
  const variants = product.variants.map((variant) => {
    if (!variant.stock) throw httpError(503, 'Variant stock data is incomplete');
    return {
      id: variant.id, sku: variant.sku, attributes: variant.attributes,
      price: variant.price ?? product.price,
      pricing: unitPrice(product, variant, context.discounts, path.map((category) => category.id), context.policy, context.pricedAt),
      stock: availableStock(variant.stock), onHand: variant.stock.quantity, reserved: variant.stock.reserved,
      maxStock: variant.stock.maxStock,
      minThreshold: variant.stock.minThreshold, isActive: variant.isActive,
    };
  });
  const available = variants.filter((variant) => variant.isActive);
  return {
    id: product.id, slug: product.slug, name: product.name, description: product.description,
    price: product.price, comparePrice: product.compareAtPrice,
    categoryId: product.categoryId, categoryName: product.category.name,
    categorySlug: product.category.slug, categoryPath: path.map((item) => item.id),
    designerId: product.designerId, tags: product.tags, collection: product.collection,
    specifications: product.specifications, isActive: product.isActive,
    isFeatured: product.isFeatured, isDemo: product.isDemo,
    images: product.images.map(mediaDto), variants,
    stock: available.reduce((sum, variant) => sum + variant.stock, 0),
    maxStock: available.reduce((sum, variant) => sum + variant.maxStock, 0),
    rating: product.rating, reviewsCount: product.reviewsCount,
  };
}

export function categoryDtos(context, products, admin = false) {
  return context.categories
    .filter((category) => !category.deletedAt && (admin || context.visible.has(category.id)))
    .map((category) => ({
      id: category.id, name: category.name, slug: category.slug, parentId: category.parentId,
      order: category.order, image: category.headerImage, attributeKeys: category.attributeKeys,
      isActive: category.isActive,
      productCount: products.filter((product) => product.categoryPath.includes(category.id)).length,
    }));
}

export function designerDto(designer) {
  return {
    id: designer.id, slug: designer.designerId, name: designer.fullName,
    specialty: designer.specialty, location: designer.location, image: designer.profileImage,
    spotlightTitle: designer.spotlightHeading, spotlightText: designer.spotlightText,
    isActive: designer.isActive, isDemo: designer.isDemo,
  };
}

export function discountDto(discount) {
  return {
    id: discount.id, name: discount.name, type: discount.type, value: discount.value,
    couponCode: discount.couponCode ?? null,
    applyTo: discount.applyTo, targetIds: discount.targetIds,
    startDate: discount.startDate.toISOString(), endDate: discount.endDate?.toISOString() ?? null,
    isActive: discount.isActive, isDemo: discount.isDemo,
  };
}

export async function catalogSnapshot(db, admin = false) {
  const context = await loadCatalogContext(db);
  const [rows, designers] = await Promise.all([
    db.product.findMany({ where: productWhere(context, admin), include: productInclude(admin), orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
    db.designer.findMany({
      where: { deletedAt: null, ...(!admin && { isActive: true, ...(!demoCatalogEnabled() && { isDemo: false }) }) },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    }),
  ]);
  const discounts = context.discounts.filter((discount) => admin ||
    (discount.isActive && !discount.couponCode && (demoCatalogEnabled() || !discount.isDemo)));
  const products = rows.map((product) => productDto(product, context));
  return {
    version: 2, mode: admin ? 'admin' : demoCatalogEnabled() ? 'demo' : 'live',
    products, categories: categoryDtos(context, products, admin),
    designers: designers.map(designerDto), discounts: discounts.map(discountDto),
  };
}

export function settingReferences(settings) {
  const productIds = new Set();
  const categoryIds = new Set();
  const mediaIds = new Set([settings.brand.logoMediaId, settings.brand.faviconMediaId].filter(Boolean));
  for (const section of settings.sections) {
    section.productIds.forEach((id) => productIds.add(id));
    section.categoryIds.forEach((id) => categoryIds.add(id));
  }
  for (const campaign of settings.campaigns) {
    if (campaign.cta.target === 'product') productIds.add(campaign.cta.targetId);
    if (campaign.cta.target === 'category') categoryIds.add(campaign.cta.targetId);
    if (campaign.desktopMediaId) mediaIds.add(campaign.desktopMediaId);
    if (campaign.mobileMediaId) mediaIds.add(campaign.mobileMediaId);
  }
  return { productIds, categoryIds, mediaIds };
}

export async function assertNoPublishedReferences(db, affected) {
  const record = await db.siteSetting.findUnique({ where: { key: STOREFRONT_KEY } });
  if (!record?.publishedValue) return;
  const parsed = storefrontSchema.safeParse(record.publishedValue);
  if (!parsed.success) throw httpError(503, 'Published storefront data is invalid');
  const references = settingReferences(parsed.data);
  for (const kind of ['productIds', 'categoryIds', 'mediaIds']) {
    if ((affected[kind] ?? []).some((id) => references[kind].has(id))) {
      throw httpError(409, 'Remove this reference from the published storefront before hiding or deleting it');
    }
  }
}

export async function validateSettingReferences(db, settings, publishing) {
  const context = await loadCategories(db);
  const references = settingReferences(settings);
  for (const id of references.categoryIds) {
    const category = context.byId.get(id);
    if (!category || category.deletedAt || (publishing && !context.visible.has(id))) {
      throw httpError(400, 'A referenced category is unavailable');
    }
  }
  const products = await db.product.findMany({
    where: { id: { in: [...references.productIds] }, ...(publishing ? productWhere(context) : { deletedAt: null }) },
    select: { id: true },
  });
  if (products.length !== references.productIds.size) throw httpError(400, 'A referenced product is unavailable');
  const media = await db.productImage.findMany({
    where: { id: { in: [...references.mediaIds] }, deletedAt: null },
    include: { product: true },
  });
  if (media.length !== references.mediaIds.size) throw httpError(400, 'A referenced media asset is unavailable');
  if (publishing && !demoCatalogEnabled() && media.some((image) => image.product?.isDemo)) {
    throw httpError(400, 'Demo media cannot be published to the live storefront');
  }
  return media.map(mediaDto);
}

export const stockStatus = (quantity, threshold) =>
  quantity === 0 ? 'OUT_OF_STOCK' : quantity <= threshold ? 'LOW_STOCK' : 'IN_STOCK';

export const stockInclude = { variant: { include: { product: true } } };
export function stockDto(stock) {
  const { variant } = stock;
  return {
    id: stock.id, variantId: variant.id, sku: variant.sku, attributes: variant.attributes,
    productId: variant.productId, productName: variant.product.name, categoryId: variant.product.categoryId,
    isDemo: variant.product.isDemo, quantity: stock.quantity,
    reserved: stock.reserved, available: availableStock(stock),
    maxStock: stock.maxStock, minThreshold: stock.minThreshold,
    status: stockStatus(availableStock(stock), stock.minThreshold),
  };
}
