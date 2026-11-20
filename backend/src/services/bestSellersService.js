import { loadCategories, productWhere } from './catalogService.js';

const DAY_MS = 86_400_000;

/**
 * The measured best sellers. Only real sales count: orders that are not samples, sold (paid or partly refunded, and not
 * cancelled), settled by a production M-Pesa payment and placed in the last `windowDays` days. Units are what buyers
 * kept: ordered less received returns. A product is listed only when at least `minBuyers` different accounts bought it,
 * so the list never rests on one account's purchases alone; that is the whole privacy guarantee (it does not stop
 * someone who knows other purchases from inferring more). Fewer than `minProducts` qualifying products list nothing.
 */
export const BEST_SELLERS = Object.freeze({ windowDays: 30, minBuyers: 2, minProducts: 4, limit: 12 });

/**
 * Ids of the best-selling products the public catalog shows, best first: by distinct orders, then units kept, then id.
 * Visibility is the catalog's own rule (`productWhere`), applied before ranking, so a hidden product neither counts nor
 * takes a place. The sales are aggregated in the database; `db` is a transaction client.
 */
export async function bestSellerIds(db) {
  const visible = await db.product.findMany({
    where: { ...productWhere(await loadCategories(db)), isDemo: false }, select: { id: true },
  });
  if (visible.length < BEST_SELLERS.minProducts) return [];
  const since = new Date(Date.now() - BEST_SELLERS.windowDays * DAY_MS);
  // Order times are stored as UTC without a zone; the cutoff is compared in UTC whatever the session's time zone.
  const ranked = await db.$queryRaw`
    WITH kept AS (
      SELECT oi."productId", o.id AS "orderId", o."userId", SUM(oi.quantity - COALESCE(back.quantity, 0)) AS units
      FROM "Order" o
      JOIN "MpesaPayment" p ON p.id = o."settledPaymentId" AND p.environment = 'production'
      JOIN "OrderItem" oi ON oi."orderId" = o.id
      LEFT JOIN (
        SELECT rl."orderItemId", SUM(rl."receivedQuantity") AS quantity
        FROM "ReturnLine" rl JOIN "ReturnRequest" rr ON rr.id = rl."returnRequestId"
        WHERE rr.status = 'RECEIVED'
        GROUP BY rl."orderItemId"
      ) back ON back."orderItemId" = oi.id
      WHERE o."isDemo" = false AND o."paymentStatus" IN ('PAID', 'PARTIALLY_REFUNDED') AND o.status <> 'CANCELLED'
        AND o."createdAt" >= (${since.toISOString()}::timestamptz AT TIME ZONE 'UTC')
        AND oi."productId" = ANY(${visible.map((product) => product.id)})
      GROUP BY oi."productId", o.id
    )
    SELECT "productId" AS id FROM kept
    WHERE units > 0
    GROUP BY "productId"
    HAVING COUNT(DISTINCT "userId") >= ${BEST_SELLERS.minBuyers}
    ORDER BY COUNT(*) DESC, SUM(units) DESC, "productId" COLLATE "C"
    LIMIT ${BEST_SELLERS.limit}`;
  return ranked.length < BEST_SELLERS.minProducts ? [] : ranked.map((row) => row.id);
}
