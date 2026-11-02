import prisma from "../config/database.js";
import emailService from "../services/emailService.js";
import autoStageService from "../services/autoStageService.js";
import { httpError } from "../services/catalogService.js";
import { createPendingOrder, createQuote, getQuote } from "../services/checkoutService.js";
import { cancelOrderReservation, customerOrderWhere, expireReservations } from "../services/inventoryService.js";
import { cancellationSchema, orderInputSchema } from "../utils/checkoutValidation.js";
import { orderDto } from "../utils/orderDto.js";
import { userSummarySelect } from "../utils/account.js";

async function requireReviewedPayment(order) {
  if (order.quoteId && await prisma.mpesaPayment.count({ where: { orderId: order.id, reviewCode: { not: null } } })) {
    throw httpError(409, "This order has payment evidence requiring staff review before fulfilment.", "PAYMENT_REVIEW_REQUIRED");
  }
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
    if (result.created && !result.order.isDemo) {
      emailService.sendOrderConfirmation(result.order, req.user).catch(error => {
        console.error("Failed to send order confirmation email:", error);
      });
    }
    res.status(result.created ? 201 : 200).json(result.order);
  } catch (error) {
    next(error);
  }
};

export const getUserOrders = async (req, res, next) => {
  try {
    await expireReservations();
    const { page, limit } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { userId: req.user.id, ...customerOrderWhere() },
        skip,
        take: limitNum,
        include: {
          items: true,
          address: true,
          trackingHistory: {
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.order.count({ where: { userId: req.user.id, ...customerOrderWhere() } }),
    ]);

    res.json({
      orders: orders.map(orderDto),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getOrderById = async (req, res, next) => {
  try {
    await expireReservations();
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: { id, ...customerOrderWhere() },
      include: {
        items: true,
        address: true,
        trackingHistory: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (order.userId !== req.user.id) {
      return res.status(403).json({ error: "Not authorized" });
    }

    res.json(orderDto(order));
  } catch (error) {
    next(error);
  }
};

export const cancelOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = cancellationSchema.parse(req.body);
    const result = await cancelOrderReservation(req.user.id, id, reason);
    if (result.changed && !result.order.isDemo) {
      emailService.sendOrderCancellation(result.order, req.user).catch(error => {
        console.error("Failed to send cancellation email:", error);
      });
    }
    res.json(result.order);
  } catch (error) {
    next(error);
  }
};

export const pickupOrder = async (req, res, next) => {
  try {
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: { id, isDemo: false },
      include: { items: true, address: true },
    });

    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.userId !== req.user.id)
      return res.status(403).json({ error: "Not authorized" });
    if (order.quoteId && (order.paymentStatus !== "PAID" || order.reservationStatus !== "COMMITTED")) {
      throw httpError(409, "Pickup requires verified payment and committed inventory.", "ORDER_UNPAID");
    }
    await requireReviewedPayment(order);
    if (["CANCELLED", "RETURNED"].includes(order.status)) {
      return res
        .status(400)
        .json({
          error:
            "This order cannot be picked up because it is cancelled or returned.",
        });
    }
    if (order.status !== "READY_FOR_PICKUP") {
      return res
        .status(400)
        .json({ error: "This order is not ready for pickup yet." });
    }

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: {
        status: "DELIVERED",
        pickedUpAt: new Date(),
        trackingHistory: {
          create: {
            status: "DELIVERED",
            description: "Picked up by customer",
            location: "No Maneno Bazaar pickup desk",
          },
        },
      },
      include: {
        items: true,
        address: true,
        trackingHistory: { orderBy: { createdAt: "desc" } },
      },
    });

    // Send pickup confirmation email
    emailService.sendPickupConfirmation(updatedOrder, req.user).catch(err => {
      console.error('Failed to send pickup confirmation email:', err);
    });

    res.json(orderDto(updatedOrder));
  } catch (error) {
    next(error);
  }
};

export const returnOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason = "Customer requested return", resolution = "REFUND", images = [] } =
      req.body;

    const order = await prisma.order.findUnique({
      where: { id, isDemo: false },
      include: { items: true, address: true },
    });

    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.userId !== req.user.id)
      return res.status(403).json({ error: "Not authorized" });
    if (order.status === "CANCELLED") {
      return res
        .status(400)
        .json({ error: "Cancelled orders cannot be returned." });
    }
    if (!["DELIVERED", "READY_FOR_PICKUP"].includes(order.status)) {
      return res
        .status(400)
        .json({
          error: "Returns can only be started after delivery or pickup.",
        });
    }

    // Check 5-minute timeout for pickup orders
    if (order.pickedUpAt) {
      const pickupTime = new Date(order.pickedUpAt);
      const now = new Date();
      const diffMinutes = (now.getTime() - pickupTime.getTime()) / (1000 * 60);
      if (diffMinutes > 5) {
        return res
          .status(400)
          .json({ error: "Return requests must be made within 5 minutes of pickup." });
      }
    }

    if (!reason || reason.trim() === "") {
      return res
        .status(400)
        .json({ error: "Return reason is required." });
    }

    const rma = `RMA-${order.orderNumber.replace(/^NM-/, "")}`;
    const normalizedResolution = [
      "REFUND",
      "EXCHANGE",
      "STORE_CREDIT",
    ].includes(resolution)
      ? resolution
      : "REFUND";

    // Set status to AWAITING_REFUND if payment was made, otherwise RETURNED
    const newStatus =
      order.paymentStatus === "PAID" ? "AWAITING_REFUND" : "RETURNED";

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: {
        status: newStatus,
        refundApproved: false,
        awaitingRefundAt: newStatus === 'AWAITING_REFUND' ? new Date() : null,
        refundNotificationSent: false,
        notes: [
          order.notes,
          `Return ${rma}: ${reason}. Resolution: ${normalizedResolution}. Images: ${images.length ? images.join(', ') : 'None'}`,
        ]
          .filter(Boolean)
          .join("\n"),
        trackingHistory: {
          create: [
            {
              status: newStatus,
              description: `Return requested (${rma}) - ${reason}`,
              location: "Customer self-service return portal",
            },
          ],
        },
      },
      include: {
        items: true,
        address: true,
        trackingHistory: { orderBy: { createdAt: "desc" } },
        user: { select: userSummarySelect },
      },
    });

    // Send return request confirmation email
    emailService.sendReturnRequestConfirmation(updatedOrder, req.user).catch(err => {
      console.error('Failed to send return request confirmation email:', err);
    });

    res.json({ ...orderDto(updatedOrder), rma });
  } catch (error) {
    next(error);
  }
};

export const trackOrder = async (req, res, next) => {
  try {
    await expireReservations();
    const { number } = req.params;

    const order = await prisma.order.findUnique({
      where: { orderNumber: number, isDemo: false },
      include: {
        trackingHistory: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json({
      orderNumber: order.orderNumber,
      status: order.status,
      trackingHistory: order.trackingHistory,
    });
  } catch (error) {
    next(error);
  }
};

// Admin functions
export const getAllOrders = async (req, res, next) => {
  try {
    await expireReservations();
    const { page, limit, status, deliveryMethod, orderedDay } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const skip = (pageNum - 1) * limitNum;

    const where = { isDemo: false };
    if (status) where.status = status;
    if (deliveryMethod) where.deliveryMethod = deliveryMethod;
    const createdAt = dayRange(orderedDay);
    if (createdAt) where.createdAt = createdAt;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: limitNum,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
          items: true,
          address: true,
          trackingHistory: {
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.order.count({ where }),
    ]);

    res.json({
      orders: orders.map(orderDto),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, description, location } = req.body;

    const existingOrder = await prisma.order.findUnique({
      where: { id, isDemo: false },
    });

    if (!existingOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }
    if (existingOrder.quoteId && status === 'CANCELLED') {
      const result = await cancelOrderReservation(existingOrder.userId, id, description || 'Cancelled by staff', 'Staff portal');
      return res.json(result.order);
    }
    if (existingOrder.quoteId && (existingOrder.paymentStatus !== 'PAID' || existingOrder.reservationStatus !== 'COMMITTED')) {
      throw httpError(409, 'Order progression requires verified payment and committed inventory.', 'ORDER_UNPAID');
    }
    await requireReviewedPayment(existingOrder);

    // Prevent status updates for cancelled orders awaiting refund
    if (existingOrder.status === 'AWAITING_REFUND' && status !== 'CANCELLED') {
      return res.status(400).json({ error: 'Order is awaiting refund approval. Cannot change status.' });
    }

    // Prevent status updates for delivered orders unless refund is being processed
    if (existingOrder.status === 'DELIVERED' && status !== 'AWAITING_REFUND' && status !== 'RETURNED') {
      return res.status(400).json({ error: 'Order has been delivered. Cannot change status unless processing a refund.' });
    }

    // Prevent status updates for cancelled orders except refund approval
    if (existingOrder.status === 'CANCELLED' && status !== 'AWAITING_REFUND') {
      return res.status(400).json({ error: 'Order is cancelled. Cannot change status except to process refund.' });
    }

    // Pause auto-stage when admin manually updates status
    const updateData = {
      status,
      autoStagePaused: true,
      autoStageLastUpdate: new Date(),
      trackingHistory: {
        create: {
          status,
          description: description || `Order status updated to ${status}`,
          location,
        },
      },
    };

    const order = await prisma.order.update({
      where: { id },
      data: updateData,
      include: {
        trackingHistory: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    // Send pickup ready email for store pickup orders when status is PROCESSING or SHIPPED
    if (order.deliveryMethod === 'STORE_PICKUP' && ['PROCESSING', 'SHIPPED'].includes(status)) {
      const user = await prisma.user.findUnique({
        where: { id: order.userId },
      });
      if (user) {
        emailService.sendPickupReady(order, user).catch(err => {
          console.error('Failed to send pickup ready email:', err);
        });
      }
    }

    res.json(orderDto(order));
  } catch (error) {
    next(error);
  }
};

export const approveRefund = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const order = await prisma.order.findUnique({
      where: { id, isDemo: false },
      include: { items: true, address: true },
    });
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    if (order.quoteId) {
      throw httpError(503, 'Verified refund processing for quoted orders is not available yet.', 'REFUNDS_UNAVAILABLE');
    }
    
    if (order.status !== 'AWAITING_REFUND') {
      return res.status(400).json({ error: 'Order is not awaiting refund' });
    }
    
    if (order.refundApproved) {
      return res.status(400).json({ error: 'Refund has already been approved' });
    }
    
    const updatedOrder = await prisma.order.update({
      where: { id },
      data: {
        refundApproved: true,
        paymentStatus: 'REFUNDED',
        status: 'CANCELLED',
        trackingHistory: {
          create: {
            status: 'CANCELLED',
            description: 'Refund approved and processed by admin',
            location: 'No Maneno Bazaar admin',
          },
        },
      },
      include: {
        items: true,
        address: true,
        trackingHistory: { orderBy: { createdAt: 'desc' } },
        user: { select: userSummarySelect },
      },
    });

    // Send refund processed email to user
    const user = await prisma.user.findUnique({
      where: { id: updatedOrder.userId },
    });
    if (user) {
      emailService.sendRefundProcessed(updatedOrder, user).catch(err => {
        console.error('Failed to send refund processed email:', err);
      });
    }

    res.json(updatedOrder);
  } catch (error) {
    next(error);
  }
};

function dayRange(day) {
  if (!day) return undefined;
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(`${day}T23:59:59.999Z`);
  if (Number.isNaN(start.getTime())) return undefined;
  return { gte: start, lte: end };
}

export const createCheckoutOrder = createOrder;

export const toggleAutoStage = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { enabled } = req.body;

    const order = await prisma.order.findUnique({
      where: { id, isDemo: false },
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const updatedOrder = await autoStageService.toggleAutoStage(id, enabled);
    res.json(updatedOrder);
  } catch (error) {
    next(error);
  }
};

export const bulkToggleAutoStage = async (req, res, next) => {
  try {
    const { orderIds, enabled } = req.body;

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ error: 'Order IDs are required' });
    }

    const result = await autoStageService.bulkToggleAutoStage(orderIds, enabled);
    res.json({ message: `Auto-stage ${enabled ? 'enabled' : 'disabled'} for ${result.count} orders` });
  } catch (error) {
    next(error);
  }
};
