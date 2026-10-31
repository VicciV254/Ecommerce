import prisma from '../config/database.js';
import { catalogDesignerSchema, catalogDesignerPatchSchema } from '../utils/catalogValidation.js';
import { assertNoPublishedReferences, catalogSnapshot, designerDto, httpError, serializable } from '../services/catalogService.js';

export const getAllDesigners = async (_req, res, next) => {
  try { res.json((await prisma.$transaction((db) => catalogSnapshot(db), { isolationLevel: 'RepeatableRead' })).designers); }
  catch (error) { next(error); }
};
export const getDesignerById = async (req, res, next) => {
  try {
    const catalog = await prisma.$transaction((db) => catalogSnapshot(db), { isolationLevel: 'RepeatableRead' });
    const designer = catalog.designers.find((item) => item.id === req.params.id || item.slug === req.params.id);
    if (!designer) throw httpError(404, 'Designer not found');
    res.json({ ...designer, products: catalog.products.filter((item) => item.designerId === designer.id) });
  } catch (error) { next(error); }
};
export const createDesigner = async (req, res, next) => {
  try {
    const input = catalogDesignerSchema.parse(req.body);
    const designer = await prisma.designer.create({ data: { ...input, location: input.location ?? '' } });
    res.status(201).json(designerDto(designer));
  } catch (error) { next(error); }
};
export const updateDesigner = async (req, res, next) => {
  try {
    const input = catalogDesignerPatchSchema.parse(req.body);
    const designer = await serializable(async (db) => {
      const existing = await db.designer.findFirst({ where: { id: req.params.id, deletedAt: null } });
      if (!existing) throw httpError(404, 'Designer not found');
      if (input.isActive === false) {
        const products = await db.product.findMany({ where: { designerId: existing.id, deletedAt: null }, select: { id: true } });
        await assertNoPublishedReferences(db, { productIds: products.map((item) => item.id) });
      }
      return db.designer.update({ where: { id: existing.id }, data: input });
    });
    res.json(designerDto(designer));
  } catch (error) { next(error); }
};
export const deleteDesigner = async (req, res, next) => {
  try {
    await serializable(async (db) => {
      const designer = await db.designer.findFirst({ where: { id: req.params.id, deletedAt: null } });
      if (!designer) throw httpError(404, 'Designer not found');
      if (await db.product.count({ where: { designerId: designer.id, deletedAt: null } })) {
        throw httpError(409, 'Reassign the products before deleting this designer');
      }
      await db.designer.update({ where: { id: designer.id }, data: { deletedAt: new Date(), isActive: false } });
    });
    res.json({ success: true });
  } catch (error) { next(error); }
};
