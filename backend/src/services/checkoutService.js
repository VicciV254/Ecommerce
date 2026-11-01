import { createHash } from 'node:crypto';
import prisma from '../config/database.js';
import { checkoutPolicy, demoOrdersEnabled, reservationsEnabled } from '../config/checkoutPolicy.js';
import { availableStock, httpError, loadCategories, productInclude, productWhere } from './catalogService.js';
import { priceBasket } from './pricingService.js';
import { expireReservations, reserveOrderItems } from './inventoryService.js';
import { idempotencyKeySchema, orderInputSchema, quoteInputSchema } from '../utils/checkoutValidation.js';
import { orderDto, orderInclude } from '../utils/orderDto.js';
import { generateOrderNumber } from '../utils/helpers.js';
import { decimal, sumMoney } from '../utils/money.js';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const normalize = (input) => ({ ...input, items: [...input.items].sort((a, b) => a.variantId.localeCompare(b.variantId)) });

async function buildSnapshot(db, userId, input, policy, now) {
  const [context, address, discounts] = await Promise.all([
    loadCategories(db),
    db.address.findFirst({ where: { id: input.addressId, userId } }),
    db.discount.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } }),
  ]);
  if (!address) throw httpError(400, 'Select an address belonging to your account', 'ADDRESS_UNAVAILABLE');
  const products = await db.product.findMany({
    where: { id: { in: [...new Set(input.items.map((item) => item.productId))] }, ...productWhere(context) },
    include: productInclude(),
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  const entries = input.items.map((item) => {
    const product = byId.get(item.productId);
    const variant = product?.variants.find((entry) => entry.id === item.variantId && entry.isActive);
    if (!product || !variant?.stock) throw httpError(409, 'An item or selected variant is no longer available', 'ITEM_UNAVAILABLE');
    if (availableStock(variant.stock) < item.quantity) throw httpError(409, `Insufficient stock for ${product.name}`, 'OUT_OF_STOCK');
    return { product, variant, quantity: item.quantity, categoryPath: context.paths.get(product.categoryId).map((category) => category.id) };
  });
  const hasDemo = entries.some((entry) => entry.product.isDemo);
  if (hasDemo && (!demoOrdersEnabled() || entries.some((entry) => !entry.product.isDemo))) {
    throw httpError(409, 'Demo products cannot create commercial orders; use a separate explicitly enabled local demo flow.', 'DEMO_ORDER_UNAVAILABLE');
  }
  const destination = {
    id: address.id, street: address.street, city: address.city, county: address.county, postalCode: address.postalCode,
  };
  return {
    ...priceBasket(entries, discounts, input.couponCode, input.deliveryMethod, destination, policy, now),
    mode: hasDemo ? 'demo' : 'live', address: destination, notes: input.notes,
  };
}

function quoteDto(quote, enabled = reservationsEnabled()) {
  return {
    id: quote.id, version: 1, ...quote.snapshot,
    expiresAt: quote.expiresAt.toISOString(), expired: quote.expiresAt <= new Date(),
    consumed: quote.consumedAt !== null, orderId: quote.order?.id ?? null,
    reservationsEnabled: enabled,
  };
}

export async function createQuote(userId, body) {
  const input = normalize(quoteInputSchema.parse(body));
  const policy = checkoutPolicy();
  const enabled = reservationsEnabled();
  await expireReservations();
  const quote = await prisma.$transaction(async (db) => {
    const now = new Date();
    const snapshot = await buildSnapshot(db, userId, input, policy, now);
    return db.checkoutQuote.create({ data: {
      userId, request: input, snapshot, fingerprint: fingerprint(snapshot),
      expiresAt: new Date(now.getTime() + policy.quoteSeconds * 1000),
    } });
  }, { isolationLevel: 'RepeatableRead', timeout: 20_000 });
  return quoteDto(quote, enabled);
}

export async function getQuote(userId, id) {
  const quote = await prisma.checkoutQuote.findFirst({ where: { id, userId }, include: { order: { select: { id: true } } } });
  if (!quote) throw httpError(404, 'Quote not found', 'QUOTE_NOT_FOUND');
  return quoteDto(quote);
}

function replay(order, requestHash) {
  if (order.requestHash !== requestHash) throw httpError(409, 'This request key was already used with different contents.', 'IDEMPOTENCY_CONFLICT');
  return { order: orderDto(order), created: false };
}

async function consumeMatchingCart(db, userId, ordered) {
  const cart = await db.cart.findUnique({ where: { userId }, include: { items: true } });
  if (!cart) return;
  for (const line of ordered) {
    const item = cart.items.find((entry) => entry.variantId === line.variantId && entry.productId === line.productId);
    if (!item) continue;
    if (item.quantity <= line.quantity) await db.cartItem.delete({ where: { id: item.id } });
    else await db.cartItem.update({ where: { id: item.id }, data: { quantity: { decrement: line.quantity } } });
  }
  const remaining = await db.cartItem.findMany({ where: { cartId: cart.id } });
  const subtotal = sumMoney(remaining.map((item) => decimal(item.price).mul(item.quantity)));
  await db.cart.update({ where: { id: cart.id }, data: {
    subtotal, discount: 0, total: subtotal, ...(!remaining.length && { couponCode: null }),
  } });
}

export async function createPendingOrder(userId, body, key) {
  const input = orderInputSchema.parse(body);
  const idempotencyKey = idempotencyKeySchema.parse(key);
  const requestHash = fingerprint(input);
  const unique = { userId_idempotencyKey: { userId, idempotencyKey } };
  await expireReservations();
  const existing = await prisma.order.findUnique({ where: unique, include: orderInclude });
  if (existing) return replay(existing, requestHash);
  if (!reservationsEnabled()) throw httpError(503, 'Order reservations are not enabled; no order or payment was created.', 'ORDERING_UNAVAILABLE');
  try {
    const result = await prisma.$transaction(async (db) => {
      // Serializing acceptance on the quote also settles a retry whose first response was lost.
      const locked = await db.$queryRaw`SELECT id FROM "CheckoutQuote" WHERE id = ${input.quoteId} AND "userId" = ${userId} FOR UPDATE`;
      if (!locked.length) throw httpError(404, 'Quote not found', 'QUOTE_NOT_FOUND');
      const previous = await db.order.findUnique({ where: unique, include: orderInclude });
      if (previous) return replay(previous, requestHash);
      const quote = await db.checkoutQuote.findUnique({ where: { id: input.quoteId } });
      if (quote.consumedAt) throw httpError(409, 'This quote has already created an order.', 'QUOTE_USED');
      if (quote.expiresAt <= new Date()) throw httpError(409, 'This quote expired. Request and review a new quote.', 'QUOTE_EXPIRED');
      const request = normalize(quoteInputSchema.parse(quote.request));
      const policy = checkoutPolicy();
      const current = await buildSnapshot(db, userId, request, policy, new Date());
      if (fingerprint(current) !== quote.fingerprint) {
        throw httpError(409, 'Prices, delivery or the address changed. Request and review a new quote.', 'QUOTE_CHANGED');
      }
      const now = new Date();
      if (quote.expiresAt <= now) throw httpError(409, 'This quote expired. Request and review a new quote.', 'QUOTE_EXPIRED');
      const order = await db.order.create({
        data: {
          orderNumber: generateOrderNumber(), userId, quoteId: quote.id, idempotencyKey, requestHash,
          addressId: current.address.id, addressSnapshot: current.address,
          pricingSnapshot: {
            currency: current.currency, policyVersion: current.policyVersion, policyHash: current.policyHash,
            vatRate: current.vatRate, couponCode: current.couponCode, couponApplied: current.couponApplied,
            discountedSubtotal: current.discountedSubtotal,
          },
          subtotal: current.subtotal, discount: current.discount, tax: current.tax,
          shippingCost: current.shippingCost, total: current.total,
          status: 'PENDING', paymentStatus: 'PENDING', paymentMethod: 'MPESA',
          isDemo: current.mode === 'demo', deliveryMethod: current.deliveryMethod, notes: current.notes,
          autoStageEnabled: false, reservationStatus: 'HELD',
          reservationExpiresAt: new Date(now.getTime() + policy.reservationSeconds * 1000),
          items: { create: current.lines.map((line) => ({
            productId: line.productId, variantId: line.variantId, sku: line.sku,
            variantAttributes: line.attributes, productName: line.productName,
            productPrice: line.unitPrice, quantity: line.quantity, subtotal: line.total,
            productImage: line.productImage, pricingSnapshot: line,
          })) },
          trackingHistory: { create: { status: 'PENDING', description: 'Order reserved; payment has not been received.' } },
        },
        include: orderInclude,
      });
      await reserveOrderItems(db, order.items);
      await db.checkoutQuote.update({ where: { id: quote.id }, data: { consumedAt: now } });
      await consumeMatchingCart(db, userId, current.lines);
      return { order: orderDto(order), created: true };
    }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 20_000 });
    return result;
  } catch (error) {
    const rawConflict = error.code === 'P2010' && ['40001', '40P01'].includes(error.meta?.code);
    if (!['P2002', 'P2034'].includes(error.code) && !rawConflict) throw error;
    const previous = await prisma.order.findUnique({ where: unique, include: orderInclude });
    if (previous) return replay(previous, requestHash);
    const consumed = await prisma.order.findUnique({ where: { quoteId: input.quoteId }, select: { userId: true } });
    if (consumed?.userId === userId) throw httpError(409, 'This quote has already created an order.', 'QUOTE_USED');
    throw httpError(409, 'Inventory changed concurrently. Retry the same request.', 'ORDER_RETRY');
  }
}
