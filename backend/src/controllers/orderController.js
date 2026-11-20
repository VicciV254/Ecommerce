import prisma from "../config/database.js";
import { httpError } from "../services/catalogService.js";
import { createPendingOrder, createQuote, getQuote } from "../services/checkoutService.js";
import { applyDemonstrationAction, applyStaffAction, cancelOrderForCustomer, orderReviewState } from "../services/fulfilmentService.js";
import { customerOrderWhere, expireReservations } from "../services/inventoryService.js";
import { dispatchNotifications } from "../services/notificationService.js";
import { customerOrderView, staffOrderView } from "../services/orderViews.js";
import { requestOwedRefund } from "../services/owedRefundService.js";
import { payWithDemonstration } from "../services/paymentService.js";
import { sampleOrdersScheduledForDeletion } from "../services/sampleOrderRetentionService.js";
import {
  completeDemonstrationRefund, createPaymentReviewRefund, listRefunds, refundDto, transitionRefund,
} from "../services/refundService.js";
import {
  approveDemonstrationReturn, cancelReturn, decideReturn, listReturns, receiveDemonstrationReturn, receiveReturn, requestReturn,
  returnDto,
} from "../services/returnService.js";
import { cancellationSchema, idempotencyKeySchema, orderInputSchema } from "../utils/checkoutValidation.js";
import {
  RETURN_STATUSES, REFUND_STATUSES, demonstrationActionSchema, demonstrationRefundSchema, demonstrationReturnSchema,
  listQuerySchema, owedRefundSchema, paymentRefundSchema, refundActionSchema, returnDecisionSchema, returnReceiptSchema,
  returnRequestSchema, staffActionSchema,
} from "../utils/operationsValidation.js";
import { orderInclude, publicTrackingTimeline } from "../utils/orderDto.js";
import { nairobiDaySpan } from "../utils/nairobiTime.js";

const staffActor = (req) => ({ type: "STAFF", id: req.admin.id });
const PAYMENT_STATUSES = ["PENDING", "PAID", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"];
const ORDER_STATUSES = ["PENDING", "PROCESSING", "SHIPPED", "READY_FOR_PICKUP", "DELIVERED", "CANCELLED"];

async function customerOrder(userId, id) {
  const order = await prisma.order.findFirst({ where: { id, userId, ...customerOrderWhere() }, include: orderInclude });
  if (!order) throw httpError(404, "Order not found", "ORDER_NOT_FOUND");
  const [reviewOpen, scheduled] = await Promise.all([orderReviewState([order.id]), sampleOrdersScheduledForDeletion([order.id])]);
  return customerOrderView(order, { reviewOpen, scheduled });
}

async function staffOrder(id) {
  const order = await prisma.order.findFirst({ where: { id, ...customerOrderWhere() }, include: orderInclude });
  if (!order) throw httpError(404, "Order not found", "ORDER_NOT_FOUND");
  return staffOrderView(order, { reviewOpen: await orderReviewState([order.id]) });
}

export const quoteOrder = async (req, res, next) => {
  try { res.status(201).json(await createQuote(req.user.id, req.body)); } catch (error) { next(error); }
};

export const getCheckoutQuote = async (req, res, next) => {
  try { res.json(await getQuote(req.user.id, req.params.id)); } catch (error) { next(error); }
};

export const createOrder = async (req, res, next) => {
  try {
    const input = orderInputSchema.parse(req.body);
    const result = await createPendingOrder(req.user.id, input, req.get("Idempotency-Key"));
    await dispatchNotifications(result.notificationIds ?? []);
    res.status(result.created ? 201 : 200).json(result.order);
  } catch (error) {
    next(error);
  }
};

export const getUserOrders = async (req, res, next) => {
  try {
    await expireReservations();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const where = { userId: req.user.id, ...customerOrderWhere() };
    const [orders, total] = await Promise.all([
      prisma.order.findMany({ where, skip: (page - 1) * limit, take: limit, include: orderInclude, orderBy: { createdAt: "desc" } }),
      prisma.order.count({ where }),
    ]);
    const ids = orders.map((order) => order.id);
    const [reviewOpen, scheduled] = await Promise.all([orderReviewState(ids), sampleOrdersScheduledForDeletion(ids)]);
    res.json({
      orders: orders.map((order) => customerOrderView(order, { reviewOpen, scheduled })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

export const getOrderById = async (req, res, next) => {
  try {
    await expireReservations();
    res.json(await customerOrder(req.user.id, req.params.id));
  } catch (error) {
    next(error);
  }
};

export const cancelOrder = async (req, res, next) => {
  try {
    const { reason } = cancellationSchema.parse(req.body);
    await cancelOrderForCustomer(req.user.id, req.params.id, reason);
    res.json(await customerOrder(req.user.id, req.params.id));
  } catch (error) {
    next(error);
  }
};

/** Pays the customer's own sample order with a demonstration payment; the body is not read. */
export const payWithDemonstrationPayment = async (req, res, next) => {
  try {
    await payWithDemonstration(req.user.id, req.params.id);
    res.json(await customerOrder(req.user.id, req.params.id));
  } catch (error) {
    next(error);
  }
};

/* Demonstration controls: the owner plays the store's part for their own sample order; each answers with the order. */
export const applyOrderDemonstrationAction = async (req, res, next) => {
  try {
    await applyDemonstrationAction(req.user.id, req.params.id, demonstrationActionSchema.parse(req.body));
    res.json(await customerOrder(req.user.id, req.params.id));
  } catch (error) {
    next(error);
  }
};

export const approveOrderDemonstrationReturn = async (req, res, next) => {
  try {
    await approveDemonstrationReturn(req.user.id, req.params.id, req.params.returnId, demonstrationReturnSchema.parse(req.body));
    res.json(await customerOrder(req.user.id, req.params.id));
  } catch (error) {
    next(error);
  }
};

export const receiveOrderDemonstrationReturn = async (req, res, next) => {
  try {
    await receiveDemonstrationReturn(req.user.id, req.params.id, req.params.returnId, demonstrationReturnSchema.parse(req.body));
    res.json(await customerOrder(req.user.id, req.params.id));
  } catch (error) {
    next(error);
  }
};

export const completeOrderDemonstrationRefund = async (req, res, next) => {
  try {
    await completeDemonstrationRefund(req.user.id, req.params.id, req.params.refundId, demonstrationRefundSchema.parse(req.body));
    res.json(await customerOrder(req.user.id, req.params.id));
  } catch (error) {
    next(error);
  }
};

export const requestOrderReturn = async (req, res, next) => {
  try {
    const input = returnRequestSchema.parse(req.body);
    const key = idempotencyKeySchema.safeParse(req.get("Idempotency-Key"));
    if (!key.success) throw httpError(400, "A valid Idempotency-Key header is required.", "IDEMPOTENCY_KEY_REQUIRED");
    const result = await requestReturn(req.user.id, req.params.id, input, key.data);
    const order = await customerOrder(req.user.id, req.params.id);
    res.status(result.created ? 201 : 200).json({
      returnRequest: order.returns.find((item) => item.id === result.returnRequest.id) ?? returnDto(result.returnRequest),
      order,
    });
  } catch (error) {
    next(error);
  }
};

export const cancelOrderReturn = async (req, res, next) => {
  try {
    await cancelReturn(req.user.id, req.params.id, req.params.returnId);
    res.json(await customerOrder(req.user.id, req.params.id));
  } catch (error) {
    next(error);
  }
};

export const trackOrder = async (req, res, next) => {
  try {
    await expireReservations();
    // Sample orders are tracked publicly only where they are enabled; the timeline is fixed phrases either way.
    const order = await prisma.order.findUnique({
      where: { orderNumber: req.params.number, ...customerOrderWhere() },
      include: { trackingHistory: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json({ orderNumber: order.orderNumber, status: order.status, trackingHistory: publicTrackingTimeline(order) });
  } catch (error) {
    next(error);
  }
};

// Staff
export const getAllOrders = async (req, res, next) => {
  try {
    await expireReservations();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const where = { ...customerOrderWhere() };
    if (ORDER_STATUSES.includes(req.query.status)) where.status = req.query.status;
    if (PAYMENT_STATUSES.includes(req.query.paymentStatus)) where.paymentStatus = req.query.paymentStatus;
    if (["STORE_PICKUP", "SAME_DAY", "STANDARD"].includes(req.query.deliveryMethod)) where.deliveryMethod = req.query.deliveryMethod;
    const createdAt = orderedRange(req.query);
    if (createdAt) where.createdAt = createdAt;
    const [orders, total] = await Promise.all([
      prisma.order.findMany({ where, skip: (page - 1) * limit, take: limit, include: orderInclude, orderBy: { createdAt: "desc" } }),
      prisma.order.count({ where }),
    ]);
    const reviewOpen = await orderReviewState(orders.map((order) => order.id));
    res.json({
      orders: orders.map((order) => staffOrderView(order, { reviewOpen })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
};

export const getStaffOrder = async (req, res, next) => {
  try { res.json(await staffOrder(req.params.id)); } catch (error) { next(error); }
};

export const applyOrderAction = async (req, res, next) => {
  try {
    await applyStaffAction(req.params.id, staffActionSchema.parse(req.body), staffActor(req));
    res.json(await staffOrder(req.params.id));
  } catch (error) {
    next(error);
  }
};

export const getReturns = async (req, res, next) => {
  try { res.json(await listReturns(listQuerySchema(RETURN_STATUSES).parse(req.query))); } catch (error) { next(error); }
};

export const decideOrderReturn = async (req, res, next) => {
  try {
    const request = await decideReturn(req.params.returnId, returnDecisionSchema.parse(req.body), staffActor(req));
    res.json(await staffOrder(request.orderId));
  } catch (error) {
    next(error);
  }
};

export const receiveOrderReturn = async (req, res, next) => {
  try {
    const result = await receiveReturn(req.params.returnId, returnReceiptSchema.parse(req.body), staffActor(req));
    res.json(await staffOrder(result.returnRequest.orderId));
  } catch (error) {
    next(error);
  }
};

export const getRefunds = async (req, res, next) => {
  try { res.json(await listRefunds(listQuerySchema(REFUND_STATUSES).parse(req.query))); } catch (error) { next(error); }
};

export const applyRefundAction = async (req, res, next) => {
  try {
    const refund = await transitionRefund(req.params.refundId, req.params.action, refundActionSchema.parse(req.body), staffActor(req));
    res.json({ refund: refundDto(refund, true), order: await staffOrder(refund.orderId) });
  } catch (error) {
    next(error);
  }
};

export const createPaymentRefund = async (req, res, next) => {
  try {
    const { reason } = paymentRefundSchema.parse(req.body);
    const refund = await createPaymentReviewRefund(req.params.paymentId, reason, staffActor(req));
    res.status(201).json({ refund: refundDto(refund, true), order: await staffOrder(refund.orderId) });
  } catch (error) {
    next(error);
  }
};

export const requestOrderRefund = async (req, res, next) => {
  try {
    const refund = await requestOwedRefund(req.params.id, owedRefundSchema.parse(req.body), staffActor(req));
    res.status(201).json({ refund: refundDto(refund, true), order: await staffOrder(req.params.id) });
  } catch (error) {
    next(error);
  }
};

/**
 * Orders placed on whole Nairobi days: `orderedFrom` to `orderedTo` (both included, either may be absent), or the single
 * `orderedDay`. An impossible or reversed date is a 400; it never falls back to listing every order.
 */
function orderedRange({ orderedDay, orderedFrom, orderedTo }) {
  const given = (value) => value !== undefined && value !== "";
  if (!given(orderedDay)) return nairobiDaySpan(orderedFrom, orderedTo, ["orderedFrom", "orderedTo"]);
  if (given(orderedFrom) || given(orderedTo)) throw httpError(400, "Use orderedDay or orderedFrom/orderedTo, not both.", "DATE_RANGE_INVALID");
  return nairobiDaySpan(orderedDay, orderedDay, ["orderedDay", "orderedDay"]);
}

export const createCheckoutOrder = createOrder;
