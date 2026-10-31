import prisma from '../config/database.js';
import { catalogDiscountSchema, catalogDiscountPatchSchema } from '../utils/catalogValidation.js';
import { discountDto, httpError, serializable } from '../services/catalogService.js';

async function validateTargets(db, discount) {
  if (discount.type === 'PERCENTAGE' && discount.value > 100) throw httpError(400, 'Percentage discounts cannot exceed 100');
  if (discount.endDate && discount.endDate < discount.startDate) throw httpError(400, 'Discount end date precedes its start date');
  if (discount.applyTo === 'ALL') {
    if (discount.targetIds.length) throw httpError(400, 'All-product discounts do not take target IDs');
    return;
  }
  if (!discount.targetIds.length) throw httpError(400, 'Select at least one discount target');
  const count = discount.applyTo === 'CATEGORY'
    ? await db.category.count({ where: { id: { in: discount.targetIds }, deletedAt: null } })
    : await db.product.count({ where: { id: { in: discount.targetIds }, deletedAt: null, isDemo: discount.isDemo } });
  if (count !== discount.targetIds.length) throw httpError(400, 'A discount target is unavailable or belongs to a different demo/live mode');
}
export const getAllDiscounts = async (_req, res, next) => {
  try { res.json((await prisma.discount.findMany({ orderBy: { createdAt: 'desc' } })).map(discountDto)); }
  catch (error) { next(error); }
};
export const getActiveDiscounts = async (_req, res, next) => {
  try {
    const now = new Date();
    res.json((await prisma.discount.findMany({ where: {
      isActive: true, startDate: { lte: now }, OR: [{ endDate: null }, { endDate: { gte: now } }],
    }, orderBy: { createdAt: 'desc' } })).map(discountDto));
  } catch (error) { next(error); }
};
export const createDiscount = async (req, res, next) => {
  try {
    const input = catalogDiscountSchema.parse(req.body);
    const discount = await serializable(async (db) => {
      const data = { ...input, endDate: input.endDate ?? null, isActive: input.isActive ?? true, isDemo: false };
      await validateTargets(db, data);
      return db.discount.create({ data });
    });
    res.status(201).json(discountDto(discount));
  } catch (error) { next(error); }
};
export const updateDiscount = async (req, res, next) => {
  try {
    const input = catalogDiscountPatchSchema.parse(req.body);
    const discount = await serializable(async (db) => {
      const current = await db.discount.findUnique({ where: { id: req.params.id } });
      if (!current) throw httpError(404, 'Discount not found');
      await validateTargets(db, { ...current, ...input });
      return db.discount.update({ where: { id: current.id }, data: input });
    });
    res.json(discountDto(discount));
  } catch (error) { next(error); }
};
export const deleteDiscount = async (req, res, next) => {
  try {
    const discount = await prisma.discount.findUnique({ where: { id: req.params.id } });
    if (!discount) throw httpError(404, 'Discount not found');
    if (discount.isDemo) await prisma.discount.update({ where: { id: discount.id }, data: { isActive: false } });
    else await prisma.discount.delete({ where: { id: discount.id } });
    res.json({ success: true });
  } catch (error) { next(error); }
};
