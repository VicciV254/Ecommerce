import prisma from '../config/database.js';
import { demoOrdersEnabled } from '../config/checkoutPolicy.js';
import { availableStock, httpError, stockStatus } from './catalogService.js';
import { orderInclude } from '../utils/orderDto.js';

export const customerOrderWhere = () => demoOrdersEnabled() ? {} : { isDemo: false };

/** Where a visitor's demonstration steps are recorded, in place of the staff portal. */
export const DEMONSTRATION_LOCATION = 'Demonstration';

/**
 * A demonstration control's binding: the caller's own sample orders, or null where sample orders are off (then the
 * control answers not found). Each control combines it with its own lookup inside its transaction.
 */
export const demonstrationOrderWhere = (userId) => (demoOrdersEnabled() ? { userId, isDemo: true } : null);

/** Where a step was taken: staff in the staff portal, a visitor's demonstration step in the demonstration. */
export const actorLocation = (actor, otherwise) =>
  actor.type === 'STAFF' ? 'Staff portal' : actor.type === 'DEMONSTRATION' ? DEMONSTRATION_LOCATION : otherwise;
export const isInventoryConflict = (error) => error.code === 'P2034' ||
  (error.code === 'P2010' && ['40001', '40P01'].includes(error.meta?.code));

export async function lockOrderInventory(db, orderId) {
  // Every release/finalization locks the order before touching its stock rows.
  await db.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
}

/** Runs an order/stock change serializably, retrying only transaction conflicts. */
export async function orderTransaction(operation) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(operation, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 20_000 });
    } catch (error) {
      if (!isInventoryConflict(error)) throw error;
      if (attempt === 2) throw httpError(409, 'The order changed concurrently. Reload it and retry.', 'ORDER_RETRY');
    }
  }
}

const STOCK_LOG_ACTIONS = { 'cancel-restock': 'order-cancel', 'return-restock': 'return-restock' };

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
    } else if (action === 'cancel-restock' || action === 'return-restock') {
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
      action: STOCK_LOG_ACTIONS[action] ?? action,
    } });
  }
}

export const reserveOrderItems = (db, items) => adjustItems(db, items, 'reserve');

/** Returns inspected, resellable units to physical stock. The caller records the return state in the same transaction. */
export const restockReturnedItems = (db, items) => adjustItems(db, items.filter((item) => item.quantity > 0), 'return-restock');

// Called only inside the verified-payment transaction, never on STK acceptance.
export async function commitOrderReservation(db, orderId, now = new Date()) {
  await lockOrderInventory(db, orderId);
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) throw httpError(404, 'Order not found');
  if (order.reservationStatus === 'COMMITTED') return order;
  if (order.reservationStatus !== 'HELD' || !order.reservationExpiresAt || order.reservationExpiresAt <= now) {
    throw httpError(409, 'Reservation is no longer active; late payment requires review.', 'RESERVATION_EXPIRED');
  }
  await adjustItems(db, order.items, 'commit');
  return db.order.update({ where: { id: order.id }, data: { reservationStatus: 'COMMITTED' } });
}

/**
 * Releases a held reservation or restocks committed units for a cancellation, once.
 * Returns the resulting reservation status; the caller owns the order's status change.
 */
export async function releaseOrderStock(db, order, expired = false) {
  if (['RELEASED', 'EXPIRED'].includes(order.reservationStatus)) return order.reservationStatus;
  if (order.reservationStatus === 'HELD' && order.paymentStatus !== 'PENDING') {
    throw httpError(409, 'Payment and reservation state require review before cancellation.', 'INVENTORY_REVIEW');
  }
  await adjustItems(db, order.items, order.reservationStatus === 'COMMITTED' ? 'cancel-restock' : expired ? 'expire' : 'release');
  return expired ? 'EXPIRED' : 'RELEASED';
}

async function expireInTransaction(db, order) {
  const reservationStatus = await releaseOrderStock(db, order, true);
  const description = 'Inventory reservation expired before payment';
  return db.order.update({
    where: { id: order.id },
    data: {
      status: 'CANCELLED', reservationStatus, cancelledAt: new Date(), cancellationReason: description,
      trackingHistory: { create: { status: 'CANCELLED', description, location: 'Reservation service', actorType: 'SYSTEM' } },
    },
    include: orderInclude,
  });
}

const isExpiredHold = (order, now) => order?.reservationStatus === 'HELD' && order.paymentStatus === 'PENDING' &&
  order.status === 'PENDING' && order.reservationExpiresAt <= now;

export async function expireOrderReservation(db, orderId, now = new Date()) {
  await lockOrderInventory(db, orderId);
  const order = await db.order.findUnique({ where: { id: orderId }, include: orderInclude });
  return isExpiredHold(order, now) ? expireInTransaction(db, order) : order;
}

export async function expireReservations(now = new Date()) {
  const candidates = await prisma.order.findMany({
    where: { reservationStatus: 'HELD', reservationExpiresAt: { lte: now }, paymentStatus: 'PENDING', status: 'PENDING' },
    select: { id: true }, orderBy: { reservationExpiresAt: 'asc' }, take: 100,
  });
  let expired = 0;
  for (const candidate of candidates) {
    try {
      await prisma.$transaction(async (db) => {
        await lockOrderInventory(db, candidate.id);
        const order = await db.order.findUnique({ where: { id: candidate.id }, include: orderInclude });
        if (!isExpiredHold(order, now)) return;
        await expireInTransaction(db, order);
        expired += 1;
      }, { isolationLevel: 'Serializable', timeout: 20_000 });
    } catch (error) {
      if (!isInventoryConflict(error) && error.code !== 'ORDER_RETRY') throw error;
      console.info('Reservation changed concurrently during expiry; it will be checked again', { orderId: candidate.id });
    }
  }
  return { expired };
}

export default { expireReservations };
