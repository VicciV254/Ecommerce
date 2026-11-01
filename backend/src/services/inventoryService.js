import prisma from '../config/database.js';
import { demoOrdersEnabled } from '../config/checkoutPolicy.js';
import { availableStock, httpError, stockStatus } from './catalogService.js';
import { orderDto, orderInclude } from '../utils/orderDto.js';

export const customerOrderWhere = () => demoOrdersEnabled() ? {} : { isDemo: false };

async function adjustItems(db, items, action) {
  for (const item of [...items].sort((a, b) => a.variantId?.localeCompare(b.variantId ?? '') ?? 0)) {
    if (!item.variantId || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw httpError(409, 'An order item has no valid variant allocation. Stock restoration requires review.', 'INVENTORY_REVIEW');
    }
    const stock = await db.stock.findUnique({
      where: { variantId: item.variantId }, include: { variant: { select: { productId: true } } },
    });
    if (!stock || stock.variant.productId !== item.productId) {
      throw httpError(409, 'An order item has unavailable variant stock. Stock restoration requires review.', 'INVENTORY_REVIEW');
    }
    let quantity = stock.quantity;
    let reserved = stock.reserved;
    if (action === 'reserve') {
      if (availableStock(stock) < item.quantity) throw httpError(409, 'Insufficient stock for an order variant', 'OUT_OF_STOCK');
      reserved += item.quantity;
    } else if (action === 'legacy-cancel') {
      quantity += item.quantity;
    } else {
      if (reserved < item.quantity) throw httpError(409, 'Reservation quantities are inconsistent; review is required', 'INVENTORY_REVIEW');
      reserved -= item.quantity;
      if (action === 'commit') quantity -= item.quantity;
    }
    if (quantity > 1_000_000) throw httpError(409, 'Restored variant stock exceeds the supported range.', 'INVENTORY_REVIEW');
    const changed = await db.stock.updateMany({
      where: { id: stock.id, quantity: stock.quantity, reserved: stock.reserved },
      data: { quantity, reserved, status: stockStatus(quantity - reserved, stock.minThreshold) },
    });
    if (changed.count !== 1) throw httpError(409, 'Inventory changed concurrently. Retry the same request.', 'ORDER_RETRY');
    await db.stockLog.create({ data: {
      stockId: stock.id, previousStock: availableStock(stock), newStock: quantity - reserved,
      action: action === 'legacy-cancel' ? 'order-cancel' : action,
    } });
  }
}

export const reserveOrderItems = (db, items) => adjustItems(db, items, 'reserve');

// P4 must call this inside its verified-payment transaction, never on STK acceptance.
export async function commitOrderReservation(db, orderId, now = new Date()) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) throw httpError(404, 'Order not found');
  if (order.reservationStatus === 'COMMITTED') return order;
  if (order.reservationStatus !== 'HELD' || !order.reservationExpiresAt || order.reservationExpiresAt <= now) {
    throw httpError(409, 'Reservation is no longer active; late payment requires review.', 'RESERVATION_EXPIRED');
  }
  await adjustItems(db, order.items, 'commit');
  return db.order.update({ where: { id: order.id }, data: { reservationStatus: 'COMMITTED' } });
}

async function releaseInTransaction(db, order, expired, reason, location = 'Customer self-service') {
  if (['RELEASED', 'EXPIRED'].includes(order.reservationStatus)) return { order, changed: false };
  if (!['PENDING', 'PROCESSING'].includes(order.status)) {
    throw httpError(400, 'Order cannot be cancelled at this stage. Please request a return instead.');
  }
  if (order.reservationStatus === 'HELD' && order.paymentStatus !== 'PENDING') {
    throw httpError(409, 'Payment and reservation state require review before cancellation.', 'INVENTORY_REVIEW');
  }
  const status = order.paymentStatus === 'PAID' ? 'AWAITING_REFUND' : 'CANCELLED';
  const description = expired ? 'Inventory reservation expired before payment'
    : reason ? `Order cancelled - ${reason}` : 'Order cancelled by customer';
  await adjustItems(db, order.items, order.reservationStatus === 'COMMITTED' ? 'legacy-cancel' : expired ? 'expire' : 'release');
  const updated = await db.order.update({
    where: { id: order.id },
    data: {
      status, reservationStatus: expired ? 'EXPIRED' : 'RELEASED',
      cancellationReason: expired ? description : reason || null, refundApproved: false,
      trackingHistory: { create: { status, description, location: expired ? 'Reservation service' : location } },
    },
    include: orderInclude,
  });
  return { order: updated, changed: true };
}

export async function cancelOrderReservation(userId, orderId, reason, location) {
  try {
    const result = await prisma.$transaction(async (db) => {
      const order = await db.order.findFirst({ where: { id: orderId, userId, ...customerOrderWhere() }, include: orderInclude });
      if (!order) throw httpError(404, 'Order not found');
      const expired = order.reservationStatus === 'HELD' && order.reservationExpiresAt <= new Date();
      return releaseInTransaction(db, order, expired, reason, location);
    }, { isolationLevel: 'Serializable', timeout: 20_000 });
    return { ...result, order: orderDto(result.order) };
  } catch (error) {
    if (error.code !== 'P2034') throw error;
    const order = await prisma.order.findFirst({ where: { id: orderId, userId, ...customerOrderWhere() }, include: orderInclude });
    if (order && ['RELEASED', 'EXPIRED'].includes(order.reservationStatus)) return { order: orderDto(order), changed: false };
    throw httpError(409, 'Inventory changed concurrently. Retry cancellation.', 'ORDER_RETRY');
  }
}

export async function expireReservations(now = new Date()) {
  const candidates = await prisma.order.findMany({
    where: { reservationStatus: 'HELD', reservationExpiresAt: { lte: now }, paymentStatus: 'PENDING', status: 'PENDING' },
    select: { id: true }, orderBy: { reservationExpiresAt: 'asc' }, take: 100,
  });
  for (const candidate of candidates) {
    try {
      await prisma.$transaction(async (db) => {
        const order = await db.order.findUnique({ where: { id: candidate.id }, include: orderInclude });
        if (!order || order.reservationStatus !== 'HELD' || order.reservationExpiresAt > now || order.paymentStatus !== 'PENDING') return;
        await releaseInTransaction(db, order, true);
      }, { isolationLevel: 'Serializable', timeout: 20_000 });
    } catch (error) {
      if (error.code !== 'P2034' && error.code !== 'ORDER_RETRY') throw error;
      console.info('Reservation changed concurrently during expiry; it will be checked again', { orderId: candidate.id });
    }
  }

}

export default { expireReservations };
