import { z } from 'zod';
import prisma from '../config/database.js';
import { idSchema } from '../utils/catalogValidation.js';
import { httpError, loadCatalogContext, productDto, productInclude, productWhere } from '../services/catalogService.js';
import { expireReservations } from '../services/inventoryService.js';

export const getWishlist = async (req, res, next) => {
  try {
    await expireReservations();
    const context = await loadCatalogContext();
    const rows = await prisma.wishlist.findMany({
      where: { userId: req.user.id, product: { is: productWhere(context) } },
      include: { product: { include: productInclude() } }, orderBy: { createdAt: 'desc' },
    });
    res.json(rows.map((item) => ({ id: item.id, productId: item.productId, product: productDto(item.product, context) })));
  } catch (error) { next(error); }
};
export const addToWishlist = async (req, res, next) => {
  try {
    const { productId } = z.object({ productId: idSchema }).strict().parse(req.body);
    await expireReservations();
    const context = await loadCatalogContext();
    const product = await prisma.product.findFirst({ where: { id: productId, ...productWhere(context) }, include: productInclude() });
    if (!product) throw httpError(404, 'Product not found');
    const entry = await prisma.wishlist.upsert({
      where: { userId_productId: { userId: req.user.id, productId } },
      create: { userId: req.user.id, productId }, update: {},
    });
    res.status(201).json({ id: entry.id, productId, product: productDto(product, context) });
  } catch (error) { next(error); }
};
export const removeFromWishlist = async (req, res, next) => {
  try {
    const entry = await prisma.wishlist.findUnique({ where: { id: req.params.id } });
    if (!entry) throw httpError(404, 'Wishlist item not found');
    if (entry.userId !== req.user.id) throw httpError(403, 'Not authorized');
    await prisma.wishlist.delete({ where: { id: entry.id } });
    res.json({ success: true });
  } catch (error) { next(error); }
};
