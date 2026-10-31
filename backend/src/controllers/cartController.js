import { z } from 'zod';
import prisma from '../config/database.js';
import { idSchema } from '../utils/catalogValidation.js';
import { demoCatalogEnabled, httpError, loadCategories, productDto, productInclude, productWhere, serializable } from '../services/catalogService.js';

const quantitySchema = z.number().int().min(1).max(1_000_000);
const addSchema = z.object({ productId: idSchema, variantId: idSchema, quantity: quantitySchema.default(1) }).strict();
const cartInclude = { items: { include: { product: { include: productInclude(true) }, variant: { include: { stock: true } } }, orderBy: { createdAt: 'asc' } } };

async function currentVariant(db, productId, variantId) {
  const context = await loadCategories(db);
  const product = await db.product.findFirst({ where: { id: productId, ...productWhere(context) }, include: productInclude() });
  if (!product) throw httpError(404, 'Product is unavailable');
  const variant = product.variants.find((item) => item.id === variantId);
  if (!variant) throw httpError(404, 'Variant is unavailable for this product');
  if (!variant.stock) throw httpError(503, 'Variant stock data is incomplete');
  return { product, variant };
}

async function cartDto(db, userId) {
  const cart = await db.cart.findUnique({ where: { userId }, include: cartInclude });
  if (!cart) return { items: [], subtotal: 0, discount: 0, total: 0, couponCode: null };
  const context = await loadCategories(db);
  return { ...cart, items: cart.items.map((item) => ({
    id: item.id, productId: item.productId, variantId: item.variantId,
    quantity: item.quantity, price: item.price,
    product: productDto(item.product, context),
    available: item.variant.isActive && item.product.isActive && !item.product.deletedAt &&
      context.visible.has(item.product.categoryId) && (!item.product.isDemo || demoCatalogEnabled()) &&
      (!item.product.designer || (item.product.designer.isActive && !item.product.designer.deletedAt)),
  })) };
}
async function recalculate(db, cartId) {
  const items = await db.cartItem.findMany({ where: { cartId } });
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  await db.cart.update({ where: { id: cartId }, data: { subtotal, discount: 0, total: subtotal, couponCode: null } });
}
export const getCart = async (req, res, next) => {
  try { res.json(await prisma.$transaction((db) => cartDto(db, req.user.id), { isolationLevel: 'RepeatableRead' })); }
  catch (error) { next(error); }
};
export const addToCart = async (req, res, next) => {
  try {
    const input = addSchema.parse(req.body);
    const cart = await serializable(async (db) => {
      const { product, variant } = await currentVariant(db, input.productId, input.variantId);
      const cart = await db.cart.upsert({ where: { userId: req.user.id }, create: { userId: req.user.id }, update: {} });
      const existing = await db.cartItem.findUnique({ where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } } });
      const quantity = (existing?.quantity ?? 0) + input.quantity;
      if (quantity > variant.stock.quantity) throw httpError(409, 'Insufficient stock for this variant');
      await db.cartItem.upsert({
        where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
        create: { cartId: cart.id, productId: product.id, variantId: variant.id, quantity, price: variant.price ?? product.price },
        update: { quantity, price: variant.price ?? product.price },
      });
      await recalculate(db, cart.id);
      return cartDto(db, req.user.id);
    });
    res.json(cart);
  } catch (error) { next(error); }
};
export const updateCartItem = async (req, res, next) => {
  try {
    const { quantity } = z.object({ quantity: z.number().int().min(0).max(1_000_000) }).strict().parse(req.body);
    const result = await serializable(async (db) => {
      const item = await db.cartItem.findUnique({ where: { id: req.params.id }, include: { cart: true } });
      if (!item) throw httpError(404, 'Cart item not found');
      if (item.cart.userId !== req.user.id) throw httpError(403, 'Not authorized');
      if (quantity === 0) await db.cartItem.delete({ where: { id: item.id } });
      else {
        const { product, variant } = await currentVariant(db, item.productId, item.variantId);
        if (quantity > variant.stock.quantity) throw httpError(409, 'Insufficient stock for this variant');
        await db.cartItem.update({ where: { id: item.id }, data: { quantity, price: variant.price ?? product.price } });
      }
      await recalculate(db, item.cartId);
      return cartDto(db, req.user.id);
    });
    res.json(result);
  } catch (error) { next(error); }
};
export const removeCartItem = async (req, res, next) => {
  try {
    const result = await serializable(async (db) => {
      const item = await db.cartItem.findUnique({ where: { id: req.params.id }, include: { cart: true } });
      if (!item) throw httpError(404, 'Cart item not found');
      if (item.cart.userId !== req.user.id) throw httpError(403, 'Not authorized');
      await db.cartItem.delete({ where: { id: item.id } });
      await recalculate(db, item.cartId);
      return cartDto(db, req.user.id);
    });
    res.json(result);
  } catch (error) { next(error); }
};
export const clearCart = async (req, res, next) => {
  try {
    const result = await serializable(async (db) => {
      const cart = await db.cart.findUnique({ where: { userId: req.user.id } });
      if (cart) {
        await db.cartItem.deleteMany({ where: { cartId: cart.id } });
        await recalculate(db, cart.id);
      }
      return cartDto(db, req.user.id);
    });
    res.json(result);
  } catch (error) { next(error); }
};
export const applyCoupon = (_req, res) => res.status(503).json({
  error: 'Coupon application is paused until server-authoritative checkout quotes are available.',
});
export const removeCoupon = async (req, res, next) => {
  try {
    const result = await serializable(async (db) => {
      const cart = await db.cart.findUnique({ where: { userId: req.user.id } });
      if (cart) await recalculate(db, cart.id);
      return cartDto(db, req.user.id);
    });
    res.json(result);
  } catch (error) { next(error); }
};
