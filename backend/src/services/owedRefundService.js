import { httpError } from './catalogService.js';
import { customerOrderWhere, lockOrderInventory, orderTransaction } from './inventoryService.js';
import {
  ACTIVE_REFUND_STATUSES, SETTLED_PAYMENT_STATUSES, createRefundInTransaction, inOrderPool,
} from './refundService.js';
import { returnRefundTerms } from './returnService.js';
import { Decimal, decimal, moneyNumber, sumMoney } from '../utils/money.js';
import { orderInclude } from '../utils/orderDto.js';

/**
 * Refunds staff may request again: money received for a cancelled order or a received return
 * that no active refund covers, for example after an earlier refund was cancelled.
 */
export function refundRequestOptions(order) {
  if (!SETTLED_PAYMENT_STATUSES.includes(order.paymentStatus)) return [];
  const active = (order.refunds ?? []).filter((refund) => ACTIVE_REFUND_STATUSES.includes(refund.status));
  const balance = decimal(order.total)
    .minus(sumMoney(active.filter((refund) => inOrderPool(order, refund)).map((refund) => refund.amount)))
    .toDecimalPlaces(0, Decimal.ROUND_DOWN);
  if (balance.lessThan(1)) return [];
  const maxAmount = moneyNumber(balance);
  const options = [];
  if (order.status === 'CANCELLED' && !active.some((refund) => refund.source === 'CANCELLATION')) {
    options.push({ source: 'CANCELLATION', maxAmount });
  }
  for (const request of order.returnRequests ?? []) {
    if (request.status !== 'RECEIVED' || active.some((refund) => refund.returnRequestId === request.id)) continue;
    if ((request.lines ?? []).some((line) => (line.refundableQuantity ?? 0) > 0)) {
      options.push({ source: 'RETURN', returnId: request.id, returnNumber: request.number, maxAmount });
    }
  }
  return options;
}

/** Records a new REQUESTED refund for money still owed; no money moves until it is approved, sent and confirmed. */
export async function requestOwedRefund(orderId, { source, returnId, reason }, actor) {
  return orderTransaction(async (db) => {
    await lockOrderInventory(db, orderId);
    const order = await db.order.findFirst({ where: { id: orderId, ...customerOrderWhere() }, include: orderInclude });
    if (!order) throw httpError(404, 'Order not found', 'ORDER_NOT_FOUND');
    const available = refundRequestOptions(order)
      .some((option) => option.source === source && (source !== 'RETURN' || option.returnId === returnId));
    if (!available) throw httpError(409, 'No refund can be requested for this order now. Reload it to see what is owed.', 'REFUND_NOT_AVAILABLE');
    let terms;
    if (source === 'CANCELLATION') {
      terms = { amount: order.total, includesDeliveryFee: true, dedupeKey: `cancel:${order.id}` };
    } else {
      const request = await db.returnRequest.findUnique({ where: { id: returnId }, include: { lines: { include: { orderItem: true } } } });
      const received = request.lines.map((line) => ({ item: line.orderItem, refundableQuantity: line.refundableQuantity ?? 0 }));
      const { amount, includeDeliveryFee } = await returnRefundTerms(db, order, received, request.merchantFaultConfirmed);
      terms = { amount, includesDeliveryFee: includeDeliveryFee, returnRequestId: request.id, dedupeKey: `return:${request.id}` };
    }
    const refund = await createRefundInTransaction(db, order, { source, ...terms, actor, reason });
    if (!refund) throw httpError(409, 'No refundable balance remains on this order.', 'REFUND_NOT_AVAILABLE');
    return refund;
  });
}
