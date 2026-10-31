import { randomUUID } from 'node:crypto';
import prisma from '../config/database.js';
import { generateSlug } from '../utils/helpers.js';
import { catalogProductSchema, catalogProductPatchSchema, productQuerySchema, mediaSchema } from '../utils/catalogValidation.js';
import {
  assertNoPublishedReferences, catalogSnapshot, demoCatalogEnabled, httpError, loadCategories,
  mediaDto, productDto, productInclude, productWhere, serializable, stockStatus,
} from '../services/catalogService.js';

export const getCatalog = async (_req, res, next) => {
  try {
    res.json(await prisma.$transaction((db) => catalogSnapshot(db), { isolationLevel: 'RepeatableRead' }));
  } catch (error) { next(error); }
};

export const getAdminCatalog = async (_req, res, next) => {
  try {
    res.json(await prisma.$transaction((db) => catalogSnapshot(db, true), { isolationLevel: 'RepeatableRead' }));
  } catch (error) { next(error); }
};

async function listProducts(query, recent = false) {
  return prisma.$transaction(async (db) => {
    const context = await loadCategories(db);
    const where = productWhere(context);
    if (query.active === 'false') throw httpError(400, 'Inactive products are available only through the staff catalog');
    if (query.category) {
      const category = context.categories.find((item) => item.id === query.category || item.slug === query.category);
      if (!category || !context.visible.has(category.id)) throw httpError(404, 'Category not found');
      where.categoryId = { in: [...context.visible].filter((id) => context.paths.get(id).some((item) => item.id === category.id)) };
    }
    if (query.designer) {
      const designer = await db.designer.findFirst({
        where: {
          OR: [{ id: query.designer }, { designerId: query.designer }],
          deletedAt: null, isActive: true, ...(!demoCatalogEnabled() && { isDemo: false }),
        },
      });
      if (!designer) throw httpError(404, 'Designer not found');
      where.designerId = designer.id;
    }
    const term = query.search || query.q;
    if (term) {
      where.AND = [{ OR: [
        { name: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
        { tags: { has: term } },
      ] }];
    }
    if (query.featured !== undefined) where.isFeatured = query.featured === 'true';
    const [rows, total] = await Promise.all([
      db.product.findMany({
        where, skip: (query.page - 1) * query.limit, take: query.limit,
        include: productInclude(),
        orderBy: recent ? [{ createdAt: 'desc' }, { id: 'asc' }] : [{ name: 'asc' }, { id: 'asc' }],
      }),
      db.product.count({ where }),
    ]);
    return { products: rows.map((item) => productDto(item, context)), pagination: {
      page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit),
    } };
  }, { isolationLevel: 'RepeatableRead' });
}

export const getAllProducts = async (req, res, next) => {
  try { res.json(await listProducts(productQuerySchema.parse(req.query))); } catch (error) { next(error); }
};
export const searchProducts = getAllProducts;
export const getFeaturedProducts = async (_req, res, next) => {
  try { res.json((await listProducts({ page: 1, limit: 12, featured: 'true' })).products); } catch (error) { next(error); }
};
export const getRecentProducts = async (_req, res, next) => {
  try { res.json((await listProducts({ page: 1, limit: 12 }, true)).products); } catch (error) { next(error); }
};
export const getAllTags = async (_req, res, next) => {
  try {
    const context = await loadCategories();
    const products = await prisma.product.findMany({ where: productWhere(context), select: { tags: true } });
    res.json([...new Set(products.flatMap((item) => item.tags))].sort());
  } catch (error) { next(error); }
};
export const getProductById = async (req, res, next) => {
  try {
    const result = await prisma.$transaction(async (db) => {
      const context = await loadCategories(db);
      const product = await db.product.findFirst({
        where: { id: req.params.id, ...productWhere(context) }, include: {
          ...productInclude(),
          reviews: { take: 20, orderBy: { createdAt: 'desc' }, include: { user: { select: { firstName: true, lastName: true } } } },
        },
      });
      if (!product) throw httpError(404, 'Product not found');
      return { ...productDto(product, context), reviewList: product.reviews.map((review) => ({
        id: review.id, rating: review.rating, comment: review.comment,
        author: `${review.user.firstName} ${review.user.lastName.slice(0, 1)}`,
        createdAt: review.createdAt.toISOString(),
      })) };
    }, { isolationLevel: 'RepeatableRead' });
    res.json(result);
  } catch (error) { next(error); }
};

function mediaData(image, index, name) {
  return {
    url: image.url, alt: image.alt ?? name, isMain: image.isMain ?? index === 0, order: index,
    width: image.width ?? null, height: image.height ?? null,
    isPlaceholder: image.isPlaceholder ?? false,
    sourceUrl: image.sourceUrl ?? null, license: image.license ?? null, credit: image.credit ?? null,
  };
}

async function validateProductRelations(db, input, existing, context) {
  const categoryId = input.categoryId ?? existing?.categoryId;
  const category = context.byId.get(categoryId);
  if (!category || category.deletedAt) throw httpError(400, 'Select an existing category');
  const designerId = input.designerId === undefined ? existing?.designerId : input.designerId;
  if (designerId) {
    const designer = await db.designer.findFirst({ where: { id: designerId, deletedAt: null } });
    if (!designer || (designer.isDemo && !existing?.isDemo)) throw httpError(400, 'Select an available designer for this product');
  }
}

function prepareVariants(input, existing = []) {
  const byId = new Map(existing.map((item) => [item.id, item]));
  const seenIds = new Set();
  const combinations = new Set();
  const variants = input.map((item) => {
    if (item.id && (!byId.has(item.id) || seenIds.has(item.id))) throw httpError(400, 'Variant IDs must belong to this product and be unique');
    if (item.id) seenIds.add(item.id);
    const previous = byId.get(item.id);
    const attributes = item.attributes ?? previous?.attributes ?? {};
    const isActive = item.isActive ?? previous?.isActive ?? true;
    const signature = JSON.stringify(Object.entries(attributes).sort(([a], [b]) => a.localeCompare(b)));
    if (isActive && combinations.has(signature)) throw httpError(400, 'Active variants must have distinct attribute combinations');
    if (isActive) combinations.add(signature);
    return {
      id: item.id,
      data: {
        sku: (item.sku ?? previous?.sku ?? `SKU-${randomUUID()}`).toUpperCase(),
        attributes, price: item.price === undefined ? previous?.price ?? null : item.price, isActive,
      },
      stock: item.stock,
    };
  });
  return variants;
}

async function writeVariants(db, productId, variants, adminId) {
  const retained = variants.flatMap((item) => item.id ? [item.id] : []);
  await db.productVariant.updateMany({ where: { productId, id: { notIn: retained } }, data: { isActive: false } });
  for (const variant of variants) {
    if (!variant.id) {
      const quantity = variant.stock?.quantity ?? 0;
      const minThreshold = variant.stock?.minThreshold ?? 10;
      await db.productVariant.create({ data: {
        productId, ...variant.data, stock: { create: {
          quantity, minThreshold, maxStock: variant.stock?.maxStock ?? 100,
          status: stockStatus(quantity, minThreshold),
        } },
      } });
    } else {
      await db.productVariant.update({ where: { id: variant.id }, data: variant.data });
      if (variant.stock) {
        const current = await db.stock.findUnique({ where: { variantId: variant.id } });
        if (!current) throw httpError(503, 'Variant stock data is incomplete');
        const threshold = variant.stock.minThreshold ?? current.minThreshold;
        await db.stock.update({ where: { id: current.id }, data: {
          ...variant.stock, status: stockStatus(variant.stock.quantity, threshold),
        } });
        await db.stockLog.create({ data: {
          stockId: current.id, previousStock: current.quantity, newStock: variant.stock.quantity,
          action: 'catalog-update', adminId,
        } });
      }
    }
  }
}

async function writeImages(db, product, input, existing = []) {
  const byId = new Map(existing.map((image) => [image.id, image]));
  const retained = input.flatMap((image) => image.id ? [image.id] : []);
  if (new Set(retained).size !== retained.length || retained.some((id) => !byId.has(id))) {
    throw httpError(400, 'Image IDs must belong to this product and be unique');
  }
  const removed = existing.filter((image) => !retained.includes(image.id)).map((image) => image.id);
  const ordered = input.map((image, index) => ({ ...byId.get(image.id), ...image, position: image.order ?? index }))
    .sort((left, right) => left.position - right.position);
  if (ordered.filter((image) => image.isMain).length > 1) throw httpError(400, 'Only one product image can be the main image');
  const mainIndex = Math.max(0, ordered.findIndex((image) => image.isMain));
  await assertNoPublishedReferences(db, { mediaIds: removed });
  await db.productImage.updateMany({ where: { id: { in: removed } }, data: { deletedAt: new Date() } });
  for (const [index, image] of ordered.entries()) {
    const data = mediaData({ ...image, isMain: index === mainIndex }, index, product.name);
    if (image.id) await db.productImage.update({ where: { id: image.id }, data: { ...data, version: { increment: 1 } } });
    else await db.productImage.create({ data: { productId: product.id, ...data } });
  }
}

export const createProduct = async (req, res, next) => {
  try {
    const input = catalogProductSchema.parse(req.body);
    const result = await serializable(async (db) => {
      const context = await loadCategories(db);
      await validateProductRelations(db, input, null, context);
      const { variants: variantInputs, images, ...fields } = input;
      const variants = prepareVariants(variantInputs ?? [{}]);
      if ((input.isActive ?? false) && !variants.some((item) => item.data.isActive)) throw httpError(400, 'An active product requires an active variant');
      const product = await db.product.create({ data: {
        ...fields, slug: input.slug ?? generateSlug(input.name), tags: input.tags ?? [],
        specifications: input.specifications ?? {}, isActive: input.isActive ?? false,
      } });
      await writeVariants(db, product.id, variants, req.admin.id);
      await writeImages(db, product, images ?? []);
      return productDto(await db.product.findUnique({ where: { id: product.id }, include: productInclude(true) }), context);
    });
    res.status(201).json(result);
  } catch (error) { next(error); }
};

export const updateProduct = async (req, res, next) => {
  try {
    const input = catalogProductPatchSchema.parse(req.body);
    const result = await serializable(async (db) => {
      const existing = await db.product.findFirst({ where: { id: req.params.id, deletedAt: null }, include: productInclude(true) });
      if (!existing) throw httpError(404, 'Product not found');
      const context = await loadCategories(db);
      await validateProductRelations(db, input, existing, context);
      const { variants: variantInputs, images, ...fields } = input;
      if (input.isActive === false) await assertNoPublishedReferences(db, { productIds: [existing.id] });
      const variants = variantInputs ? prepareVariants(variantInputs, existing.variants) : null;
      if ((input.isActive ?? existing.isActive) && !(variants ?? existing.variants.map((data) => ({ data }))).some((item) => item.data.isActive)) {
        throw httpError(400, 'An active product requires an active variant');
      }
      const product = await db.product.update({ where: { id: existing.id }, data: fields });
      if (variants) await writeVariants(db, existing.id, variants, req.admin.id);
      if (images) await writeImages(db, product, images, existing.images);
      return productDto(await db.product.findUnique({ where: { id: existing.id }, include: productInclude(true) }), context);
    });
    res.json(result);
  } catch (error) { next(error); }
};

export const deleteProduct = async (req, res, next) => {
  try {
    await serializable(async (db) => {
      const product = await db.product.findFirst({ where: { id: req.params.id, deletedAt: null } });
      if (!product) throw httpError(404, 'Product not found');
      await assertNoPublishedReferences(db, { productIds: [product.id] });
      await db.product.update({ where: { id: product.id }, data: { deletedAt: new Date(), isActive: false } });
      await db.productVariant.updateMany({ where: { productId: product.id }, data: { isActive: false } });
    });
    res.json({ success: true });
  } catch (error) { next(error); }
};

export const createMedia = async (req, res, next) => {
  try {
    const input = mediaSchema.parse(req.body);
    if (input.id) throw httpError(400, 'Media IDs are assigned by the server');
    const media = await prisma.productImage.create({ data: mediaData(input, 0, input.alt ?? '') });
    res.status(201).json(mediaDto(media));
  } catch (error) { next(error); }
};
