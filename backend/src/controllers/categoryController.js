import { randomUUID } from 'node:crypto';
import prisma from '../config/database.js';
import { generateSlug } from '../utils/helpers.js';
import { catalogCategorySchema, catalogCategoryPatchSchema } from '../utils/catalogValidation.js';
import {
  assertNoPublishedReferences, catalogSnapshot, categoryContext, categoryDtos,
  httpError, loadCategories, serializable,
} from '../services/catalogService.js';

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

export const createCategory = async (req, res, next) => {
  try {
    const input = catalogCategorySchema.parse(req.body);
    const category = await serializable(async (db) => {
      const { categories } = await loadCategories(db);
      const parent = categories.find((item) => item.id === input.parentId);
      const data = {
        ...input, id: randomUUID(), parentId: input.parentId ?? null, order: input.order ?? 0,
        slug: input.slug ?? generateSlug(parent ? `${parent.slug}-${input.name}` : input.name),
        attributeKeys: input.attributeKeys ?? [], isActive: input.isActive ?? true, deletedAt: null,
        headerImage: input.headerImage ?? null,
      };
      const context = validateCategory(categories, data);
      await db.category.create({ data });
      return categoryDtos(context, [], true).find((item) => item.id === data.id);
    });
    res.status(201).json(category);
  } catch (error) { next(error); }
};

export const updateCategory = async (req, res, next) => {
  try {
    const input = catalogCategoryPatchSchema.parse(req.body);
    const result = await serializable(async (db) => {
      const context = await loadCategories(db);
      const current = context.byId.get(req.params.id);
      if (!current || current.deletedAt) throw httpError(404, 'Category not found');
      const candidate = { ...current, ...input };
      const nextContext = validateCategory(context.categories, candidate);
      const newlyHidden = [...context.visible].filter((id) => !nextContext.visible.has(id));
      if (newlyHidden.length) {
        const products = await db.product.findMany({ where: { categoryId: { in: newlyHidden }, deletedAt: null }, select: { id: true } });
        await assertNoPublishedReferences(db, { categoryIds: newlyHidden, productIds: products.map((item) => item.id) });
      }
      await db.category.update({ where: { id: current.id }, data: input });
      const snapshot = await catalogSnapshot(db, true);
      return snapshot.categories.find((item) => item.id === current.id);
    });
    res.json(result);
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
    });
    res.json({ success: true });
  } catch (error) { next(error); }
};
