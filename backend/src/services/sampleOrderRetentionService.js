import { Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import { demoOrdersEnabled, publicSampleOrderRetentionDays, sampleOrderRetentionDays } from '../config/checkoutPolicy.js';
import { httpError } from './catalogService.js';
import { lockOrderInventory, orderTransaction, restoreSampleOrderStock } from './inventoryService.js';
import { SETTLED_PAYMENT_STATUSES } from './refundService.js';

const DAY_MS = 86_400_000;
/** Most sample orders one run deletes; the rest wait for the next run, oldest first. */
export const SAMPLE_ORDER_PURGE_BATCH = 200;
/**
 * Most candidates one run examines. Orders refused for review stay candidates, so a run scans past them to reach younger
 * ones; this bounds the run's work when many are refused.
 */
export const SAMPLE_ORDER_SCAN_LIMIT = 1000;
/** Codes a failure may report as they are; anything else is reported as SAMPLE_ORDER_DELETION_FAILED. */
const STABLE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/*
 * Sample orders without provider or money evidence, as SQL over "Order" o: no M-Pesa attempt linked by id or by the
 * legacy order number, no settled payment id, no refund tied to a payment, carrying a provider reference, using a
 * method other than the demonstration's or reviewing a payment, and no settled payment by any method but the
 * demonstration's. The candidate query, the re-check under the order's lock and the order views all use it.
 */
const WITHOUT_EVIDENCE = Prisma.sql`o."isDemo" = true AND o."settledPaymentId" IS NULL
  AND NOT (o."paymentStatus"::text = ANY(${SETTLED_PAYMENT_STATUSES}) AND o."paymentMethod"::text <> 'DEMONSTRATION')
  AND NOT EXISTS (SELECT 1 FROM "MpesaPayment" p WHERE p."orderId" = o.id)
  AND NOT EXISTS (SELECT 1 FROM "MpesaPayment" p WHERE p."orderNumber" = o."orderNumber")
  AND NOT EXISTS (SELECT 1 FROM "Refund" r WHERE r."orderId" = o.id AND (r."paymentId" IS NOT NULL
    OR r."providerReference" IS NOT NULL OR r.method <> 'DEMONSTRATION' OR r.source::text = 'PAYMENT_REVIEW'))`;

// Order times are stored as UTC without a zone; the cutoff is compared in UTC whatever the session's time zone.
const placedBefore = (cutoff) => Prisma.sql`o."createdAt" < (${cutoff.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/** Of `orderIds`, the sample orders deleted once the retention period passes; none while no retention applies. */
export async function sampleOrdersScheduledForDeletion(orderIds) {
  if (!orderIds.length || publicSampleOrderRetentionDays() === null) return new Set();
  const rows = await prisma.$queryRaw`SELECT o.id FROM "Order" o WHERE o.id = ANY(${orderIds}) AND ${WITHOUT_EVIDENCE}`;
  return new Set(rows.map((row) => row.id));
}

const review = (message) => httpError(409, message, 'INVENTORY_REVIEW');

/** R per order item: the units its received returns put back on sale. */
function restockedByItem(order) {
  const restocked = new Map();
  for (const request of order.returnRequests) {
    if (request.status !== 'RECEIVED') continue;
    for (const line of request.lines) {
      if (!Number.isInteger(line.restockQuantity) || line.restockQuantity < 0) throw review('A received return has no restocked quantity.');
      restocked.set(line.orderItemId, (restocked.get(line.orderItemId) ?? 0) + line.restockQuantity);
    }
  }
  return restocked;
}

/** Whether the order holds a reservation to release (true) or committed stock to give back (false); null for neither. */
function heldStock(order) {
  const { reservationStatus, status, paymentStatus } = order;
  if (reservationStatus === 'HELD' && status === 'PENDING' && paymentStatus === 'PENDING') return true;
  if (reservationStatus === 'COMMITTED' && status !== 'CANCELLED' && SETTLED_PAYMENT_STATUSES.includes(paymentStatus)) return false;
  if (['RELEASED', 'EXPIRED'].includes(reservationStatus) && status === 'CANCELLED') return null;
  throw review('The order\'s reservation and payment state require review.');
}

/**
 * The stock a sample order still holds, one entry per variant: Q per item for a held reservation; Q − R for committed
 * stock (R restocked by received returns); nothing for an expired or released reservation (every cancelled order).
 */
function stockToGiveBack(order) {
  const restocked = restockedByItem(order);
  const held = heldStock(order);
  if (held !== false && restocked.size) throw review('Received returns on an order without committed stock require review.');
  if (held === null) return null;
  const byVariant = new Map();
  for (const item of order.items) {
    const back = item.quantity - (restocked.get(item.id) ?? 0);
    if (!Number.isInteger(item.quantity) || item.quantity <= 0 || back < 0) throw review('An order item\'s quantities require review.');
    if (back === 0) continue;
    if (!item.variantId) throw review('An order item has no variant to give stock back to.');
    const entry = byVariant.get(item.variantId);
    if (entry && entry.productId !== item.productId) throw review('An order variant belongs to two products.');
    byVariant.set(item.variantId, { variantId: item.variantId, productId: item.productId, quantity: (entry?.quantity ?? 0) + back });
  }
  return { held, entries: [...byVariant.values()] };
}

/** Read-state keys staff alerts derive from this order, its returns, refunds and emails (see attentionService). */
const alertKeys = (orderId, returnIds, refundIds, notificationIds) => [
  { alertKey: `order-fulfil:${orderId}` },
  ...returnIds.map((id) => ({ alertKey: { startsWith: `return:${id}:` } })),
  ...refundIds.map((id) => ({ alertKey: { startsWith: `refund:${id}:` } })),
  ...notificationIds.map((id) => ({ alertKey: { startsWith: `notification:${id}:` } })),
];

/** Deletes the order's own records, children first; users, addresses, catalog, stock and every log are kept. */
async function deleteOrderRecords(db, order) {
  const returnIds = order.returnRequests.map((request) => request.id);
  const refundIds = order.refunds.map((refund) => refund.id);
  const notificationIds = (await db.notification.findMany({
    where: { OR: [{ orderId: order.id }, { returnRequestId: { in: returnIds } }, { refundId: { in: refundIds } }] },
    select: { id: true },
  })).map((notification) => notification.id);
  await db.notification.deleteMany({ where: { id: { in: notificationIds } } });
  await db.staffAlertRead.deleteMany({ where: { OR: alertKeys(order.id, returnIds, refundIds, notificationIds) } });
  await db.refund.deleteMany({ where: { orderId: order.id } });
  await db.returnLine.deleteMany({ where: { returnRequestId: { in: returnIds } } });
  await db.returnRequest.deleteMany({ where: { orderId: order.id } });
  await db.trackingEvent.deleteMany({ where: { orderId: order.id } });
  await db.orderItem.deleteMany({ where: { orderId: order.id } });
  await db.order.delete({ where: { id: order.id } });
  if (order.quoteId) await db.checkoutQuote.delete({ where: { id: order.quoteId } });
}

/** One order, under its lock: re-checked, its stock given back and its records deleted, or left alone. */
async function purgeOrder(db, orderId, cutoff) {
  await lockOrderInventory(db, orderId);
  const eligible = await db.$queryRaw`SELECT o.id FROM "Order" o WHERE o.id = ${orderId} AND ${WITHOUT_EVIDENCE} AND ${placedBefore(cutoff)}`;
  if (!eligible.length) return { deleted: false };
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: true, returnRequests: { include: { lines: true } }, refunds: { select: { id: true } } },
  });
  const stock = stockToGiveBack(order);
  if (stock?.entries.length) await restoreSampleOrderStock(db, stock.entries, { held: stock.held });
  await deleteOrderRecords(db, order);
  return { deleted: true };
}

const failureCode = (error) => (typeof error?.code === 'string' && STABLE_CODE.test(error.code) ? error.code : 'SAMPLE_ORDER_DELETION_FAILED');

/** The next candidates after `after` (the last one examined), oldest first. */
function candidatesAfter(cutoff, after, take) {
  const next = after
    ? Prisma.sql`AND (o."createdAt", o.id) > ((${after.createdAt.toISOString()}::timestamptz AT TIME ZONE 'UTC'), ${after.id})`
    : Prisma.empty;
  return prisma.$queryRaw`SELECT o.id, o."createdAt" FROM "Order" o WHERE ${WITHOUT_EVIDENCE} AND ${placedBefore(cutoff)} ${next}
    ORDER BY o."createdAt" ASC, o.id ASC LIMIT ${take}::int`;
}

/**
 * Deletes visitors' sample orders placed more than `SAMPLE_ORDER_RETENTION_DAYS` ago, giving back their sample stock;
 * orders with M-Pesa or money evidence are kept. Oldest first, each in its own transaction, at most
 * SAMPLE_ORDER_PURGE_BATCH deletions and `scanLimit` orders examined per run; an order's failure is counted by code
 * and the scan continues past it. Counts are taken after commit.
 */
export async function purgeSampleOrders({ now = new Date(), scanLimit = SAMPLE_ORDER_SCAN_LIMIT } = {}) {
  const days = sampleOrderRetentionDays();
  if (!demoOrdersEnabled()) return { skipped: 'SAMPLE_ORDERS_DISABLED' };
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const result = { deleted: 0, unchanged: 0, failed: {} };
  let examined = 0;
  let after = null;
  for (;;) {
    // Both limits bound the next page: what may still be deleted, and what may still be examined.
    const take = Math.min(SAMPLE_ORDER_PURGE_BATCH - result.deleted, scanLimit - examined);
    if (take <= 0) break;
    const page = await candidatesAfter(cutoff, after, take);
    if (!page.length) break;
    for (const { id } of page) {
      examined += 1;
      try {
        const outcome = await orderTransaction((db) => purgeOrder(db, id, cutoff));
        result[outcome.deleted ? 'deleted' : 'unchanged'] += 1;
      } catch (error) {
        const code = failureCode(error);
        result.failed[code] = (result.failed[code] ?? 0) + 1;
        console.warn('A sample order was not deleted', { orderId: id, code });
      }
    }
    after = page[page.length - 1];
  }
  return result;
}

export default { purgeSampleOrders };
