import { randomUUID } from 'node:crypto';
import prisma from '../config/database.js';
import { generateSlug } from '../utils/helpers.js';
import {
  catalogCategorySchema, catalogCategoryPatchSchema, categoryReorderSchema, splitVersionedEdit,
} from '../utils/catalogValidation.js';
import {
  assertNoPublishedReferences, catalogSnapshot, categoryContext, categoryDtos,
  httpError, loadCategories, nextVersion, serializable,
} from '../services/catalogService.js';
import { ACTIVITY, recordActivity } from '../services/activityService.js';

const CATEGORY_CHANGED = 'Someone else changed this category after you opened it. Reload it to see their changes, then make yours again.';
const SIBLINGS_CHANGED = 'The categories here changed after you opened them. Reload and try again.';

export const getAllCategories = async (_req, res, next) => {
  try { res.json((await prisma.$transaction((db) => catalogSnapshot(db), { isolationLevel: 'RepeatableRead' })).categories); }
  catch (error) { next(error); }
};
export const getCategoryById = async (req, res, next) => {
  try {
    const catalog = await prisma.$transaction((db) => catalogSnapshot(db), { isolationLevel: 'RepeatableRead' });
    const category = catalog.categories.find((item) => item.id === req.params.id || item.slug === req.params.id);
    if (!category) throw httpError(404, 'Category not found');
    res.json({ ...category, products: catalog.products.filter((item) => item.categoryPath.includes(category.id)) });
  } catch (error) { next(error); }
};

function validateCategory(rows, candidate) {
  if (candidate.parentId) {
    const parent = rows.find((item) => item.id === candidate.parentId && !item.deletedAt);
    if (!parent) throw httpError(400, 'Select an existing parent category');
  }
  if (rows.some((item) => !item.deletedAt && item.id !== candidate.id && item.parentId === candidate.parentId &&
    item.name.toLowerCase() === candidate.name.toLowerCase())) {
    throw httpError(409, 'A category with this name already exists under that parent');
  }
  return categoryContext([...rows.filter((item) => item.id !== candidate.id), candidate], 400);
}

/** The order that places a category after the last current child of `parentId` (first when it has none). */
function appendedOrder(rows, parentId, movingId = null) {
  const orders = rows.filter((item) => !item.deletedAt && item.parentId === parentId && item.id !== movingId).map((item) => item.order);
  return orders.length ? Math.max(...orders) + 1 : 0;
}

export const createCategory = async (req, res, next) => {
  try {
    const input = catalogCategorySchema.parse(req.body);
    const category = await serializable(async (db) => {
      const { categories } = await loadCategories(db);
      const parent = categories.find((item) => item.id === input.parentId);
      const data = {
        ...input, id: randomUUID(), parentId: input.parentId ?? null, order: appendedOrder(categories, input.parentId ?? null),
        slug: input.slug ?? generateSlug(parent ? `${parent.slug}-${input.name}` : input.name),
        attributeKeys: input.attributeKeys ?? [], isActive: input.isActive ?? true, deletedAt: null,
        headerImage: input.headerImage ?? null, updatedAt: new Date(),
      };
      const context = validateCategory(categories, data);
      await db.category.create({ data });
      await recordActivity(db, req.admin.id, { action: ACTIVITY.CATEGORY_CREATED, targetType: 'category', targetId: data.id, details: data.name });
      return categoryDtos(context, [], true).find((item) => item.id === data.id);
    });
    res.status(201).json(category);
  } catch (error) { next(error); }
};

/** Saves a staff edit made against the version the editor loaded (`expectedUpdatedAt`); see `updateProduct`. */
export const updateCategory = async (req, res, next) => {
  try {
    const { expected, changes } = splitVersionedEdit(req.body);
    if (!expected) throw httpError(400, 'Reload this category and try again.', 'VERSION_REQUIRED');
    const input = catalogCategoryPatchSchema.parse(changes);
    const result = await serializable(async (db) => {
      const context = await loadCategories(db);
      const current = context.byId.get(req.params.id);
      if (!current || current.deletedAt) throw httpError(404, 'Category not found');
      if (current.updatedAt.getTime() !== expected.getTime()) throw httpError(409, CATEGORY_CHANGED, 'CATEGORY_CHANGED');
      // A category moved under another parent goes after its new siblings, as a new one would.
      const moved = input.parentId !== undefined && (input.parentId ?? null) !== current.parentId;
      const data = {
        ...input,
        ...(moved && { order: appendedOrder(context.categories, input.parentId ?? null, current.id) }),
        updatedAt: nextVersion(current.updatedAt),
      };
      const candidate = { ...current, ...data };
      const nextContext = validateCategory(context.categories, candidate);
      const newlyHidden = [...context.visible].filter((id) => !nextContext.visible.has(id));
      if (newlyHidden.length) {
        const products = await db.product.findMany({ where: { categoryId: { in: newlyHidden }, deletedAt: null }, select: { id: true } });
        await assertNoPublishedReferences(db, { categoryIds: newlyHidden, productIds: products.map((item) => item.id) });
      }
      await db.category.update({ where: { id: current.id }, data });
      await recordActivity(db, req.admin.id, { action: ACTIVITY.CATEGORY_UPDATED, targetType: 'category', targetId: current.id, details: candidate.name });
      const snapshot = await catalogSnapshot(db, true);
      return snapshot.categories.find((item) => item.id === current.id);
    });
    res.json(result);
  } catch (error) { next(error); }
};

/**
 * Writes the order of one parent's children (`parentId` null for departments): `orderedIds` must be exactly its current
 * children, each once. Any other set means the list changed after the editor loaded it, and nothing is written.
 */
export const reorderCategories = async (req, res, next) => {
  try {
    const { parentId, orderedIds } = categoryReorderSchema.parse(req.body);
    const categories = await serializable(async (db) => {
      const siblings = await db.category.findMany({ where: { parentId, deletedAt: null } });
      const byId = new Map(siblings.map((item) => [item.id, item]));
      const sameSet = orderedIds.length === siblings.length && new Set(orderedIds).size === orderedIds.length &&
        orderedIds.every((id) => byId.has(id));
      if (!sameSet) throw httpError(409, SIBLINGS_CHANGED, 'CATEGORY_SIBLINGS_CHANGED');
      for (const [order, id] of orderedIds.entries()) {
        await db.category.update({ where: { id }, data: { order, updatedAt: nextVersion(byId.get(id).updatedAt) } });
      }
      // The parent exists: its children were just found by `parentId`.
      const details = parentId ? (await db.category.findUnique({ where: { id: parentId }, select: { name: true } })).name : 'departments';
      await recordActivity(db, req.admin.id, { action: ACTIVITY.CATEGORIES_REORDERED, targetType: 'category', targetId: parentId, details });
      const updated = new Map((await catalogSnapshot(db, true)).categories.map((item) => [item.id, item]));
      return orderedIds.map((id) => updated.get(id));
    });
    res.json({ categories });
  } catch (error) { next(error); }
};

export const deleteCategory = async (req, res, next) => {
  try {
    await serializable(async (db) => {
      const category = await db.category.findFirst({ where: { id: req.params.id, deletedAt: null } });
      if (!category) throw httpError(404, 'Category not found');
      const [children, products] = await Promise.all([
        db.category.count({ where: { parentId: category.id, deletedAt: null } }),
        db.product.count({ where: { categoryId: category.id, deletedAt: null } }),
      ]);
      if (children || products) throw httpError(409, 'Remove or move the child categories and products first, or hide the category instead');
      await assertNoPublishedReferences(db, { categoryIds: [category.id] });
      await db.category.update({ where: { id: category.id }, data: { deletedAt: new Date(), isActive: false } });
      await recordActivity(db, req.admin.id, { action: ACTIVITY.CATEGORY_DELETED, targetType: 'category', targetId: category.id, details: category.name });
    });
    res.json({ success: true });
  } catch (error) { next(error); }
};
