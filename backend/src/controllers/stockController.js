import { z } from 'zod';
import prisma from '../config/database.js';
import { catalogStockSchema, idSchema } from '../utils/catalogValidation.js';
import { availableStock, httpError, serializable, stockDto, stockInclude, stockStatus } from '../services/catalogService.js';
import { expireReservations } from '../services/inventoryService.js';

const stockWhere = { variant: { is: { isActive: true, product: { is: { deletedAt: null } } } } };
async function findStock(db, variantId) {
  const stock = await db.stock.findUnique({ where: { variantId }, include: stockInclude });
  if (!stock || stock.variant.product.deletedAt) throw httpError(404, 'Variant stock not found');
  return stock;
}
export const getAllStock = async (_req, res, next) => {
  try {
    await expireReservations();
    res.json({ stocks: (await prisma.stock.findMany({ where: stockWhere, include: stockInclude, orderBy: { id: 'asc' } })).map(stockDto) });
  }
  catch (error) { next(error); }
};
export const getLowStock = async (_req, res, next) => {
  try {
    await expireReservations();
    const rows = await prisma.stock.findMany({ where: stockWhere, include: stockInclude });
    res.json({ stocks: rows.filter((item) => availableStock(item) > 0 && availableStock(item) <= item.minThreshold).map(stockDto) });
  } catch (error) { next(error); }
};
export const getProductStock = async (req, res, next) => {
  try { res.json(stockDto(await findStock(prisma, req.params.variantId))); } catch (error) { next(error); }
};
async function setStock(db, variantId, input, adminId, action) {
  const current = await findStock(db, variantId);
  if (input.quantity < current.reserved) throw httpError(409, 'On-hand quantity cannot be lower than reserved units', 'STOCK_RESERVED');
  const threshold = input.minThreshold ?? current.minThreshold;
  const updated = await db.stock.update({ where: { id: current.id }, data: {
    ...input, status: stockStatus(input.quantity - current.reserved, threshold),
    ...(input.quantity > current.quantity && { lastRestocked: new Date() }),
  }, include: stockInclude });
  await db.stockLog.create({ data: {
    stockId: current.id, previousStock: availableStock(current),
    newStock: input.quantity - current.reserved, action, adminId,
  } });
  return stockDto(updated);
}
export const updateStock = async (req, res, next) => {
  try {
    await expireReservations();
    const input = catalogStockSchema.parse(req.body);
    res.json(await serializable((db) => setStock(db, req.params.variantId, input, req.admin.id, 'set')));
  } catch (error) { next(error); }
};
export const bulkUpdateStock = async (req, res, next) => {
  try {
    await expireReservations();
    const { updates } = z.object({ updates: z.array(catalogStockSchema.extend({ variantId: idSchema })).min(1).max(100) }).strict().parse(req.body);
    if (new Set(updates.map((item) => item.variantId)).size !== updates.length) throw httpError(400, 'Bulk stock updates must identify distinct variants');
    const stocks = await serializable(async (db) => {
      const results = [];
      for (const { variantId, ...input } of updates) results.push(await setStock(db, variantId, input, req.admin.id, 'bulk-update'));
      return results;
    });
    res.json({ stocks, updated: stocks.length });
  } catch (error) { next(error); }
};
export const getStockHistory = async (req, res, next) => {
  try {
    const stock = await findStock(prisma, req.params.variantId);
    const [stockLogs, restockHistory] = await Promise.all([
      prisma.stockLog.findMany({ where: { stockId: stock.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.restockHistory.findMany({ where: { stockId: stock.id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    res.json({ stock: stockDto(stock), stockLogs, restockHistory });
  } catch (error) { next(error); }
};
export const restockProduct = async (req, res, next) => {
  try {
    const input = z.object({
      quantity: z.number().int().positive().max(1_000_000),
      reason: z.string().trim().min(1).max(500).default('Manual restock'),
    }).strict().parse(req.body);
    const result = await serializable(async (db) => {
      const current = await findStock(db, req.params.variantId);
      const quantity = current.quantity + input.quantity;
      if (quantity > 1_000_000) throw httpError(400, 'Stock quantity exceeds the supported range');
      const stock = await setStock(db, current.variantId, { quantity }, req.admin.id, 'restock');
      await db.restockHistory.create({ data: { stockId: current.id, quantity: input.quantity, reason: input.reason, adminId: req.admin.id } });
      return stock;
    });
    res.json(result);
  } catch (error) { next(error); }
};
