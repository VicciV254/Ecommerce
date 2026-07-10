import prisma from "../config/database.js";
import { generateOrderNumber } from "../utils/helpers.js";
import emailService from "../services/emailService.js";
import autoStageService from "../services/autoStageService.js";

export const createOrder = async (req, res, next) => {
  try {
    const { addressId, paymentMethod, deliveryMethod, notes } = req.body;

    // Get user's cart
    const cart = await prisma.cart.findUnique({
      where: { userId: req.user.id },
      include: {
        items: {
          include: {
            product: {
              include: { stock: true },
            },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    // Check stock availability
    for (const item of cart.items) {
      if (item.product.stock.quantity < item.quantity) {
        return res.status(400).json({
          error: `Insufficient stock for ${item.product.name}`,
        });
      }
    }

    // Get address
    const address = await prisma.address.findUnique({
      where: { id: addressId },
    });

    if (!address || address.userId !== req.user.id) {
      return res.status(400).json({ error: "Invalid address" });
    }

    // Calculate shipping cost
    const shippingCost = deliveryMethod === "SAME_DAY" ? 500 : 200;
    const tax = cart.subtotal * 0.16; // 16% VAT
    const total = cart.subtotal - cart.discount + tax + shippingCost;

    // Generate order number
    const orderNumber = generateOrderNumber();

    // Create order
    const order = await prisma.order.create({
      data: {
        orderNumber,
        userId: req.user.id,
        addressId,
        subtotal: cart.subtotal,
        discount: cart.discount,
        tax,
        shippingCost,
        total,
        paymentMethod,
        deliveryMethod,
        notes,
        items: {
          create: cart.items.map((item) => ({
            productId: item.productId,
            productName: item.product.name,
            productPrice: item.price,
            quantity: item.quantity,
            subtotal: item.price * item.quantity,
            productImage: item.product.images[0]?.url || null,
          })),
        },
        trackingHistory: {
          create: {
            status:
              normalizedPaymentStatus === "PAID" ? "PROCESSING" : "PENDING",
            description: "Order placed successfully",
          },
        },
      },
      include: {
        items: true,
        address: true,
        user: true,
      },
    });

    // Update stock
    for (const item of cart.items) {
      await prisma.stock.update({
        where: { productId: item.productId },
        data: {
          quantity: {
            decrement: item.quantity,
          },
        },
      });

      // Log stock change
      await prisma.stockLog.create({
        data: {
          stockId: item.product.stock.id,
          previousStock: item.product.stock.quantity,
          newStock: item.product.stock.quantity - item.quantity,
          action: "auto-decrement",
        },
      });
    }

    // Clear cart
    await prisma.cartItem.deleteMany({
      where: { cartId: cart.id },
    });

    await prisma.cart.update({
      where: { id: cart.id },
      data: {
        subtotal: 0,
        discount: 0,
        total: 0,
        couponCode: null,
      },
    });

    // Send order confirmation email
    emailService.sendOrderConfirmation(order, req.user).catch(err => {
      console.error('Failed to send order confirmation email:', err);
    });

    res.status(201).json(order);
  } catch (error) {
    next(error);
  }
};

export const getUserOrders = async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { userId: req.user.id },
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
      prisma.order.count({ where: { userId: req.user.id } }),
    ]);

    res.json({
      orders,
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
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: { id },
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

    res.json(order);
  } catch (error) {
    next(error);
  }
};

export const cancelOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (order.userId !== req.user.id) {
      return res.status(403).json({ error: "Not authorized" });
    }

    if (!["PENDING", "PROCESSING"].includes(order.status)) {
      return res
        .status(400)
        .json({
          error:
            "Order cannot be cancelled at this stage. Please request a return instead.",
        });
    }

    // Restore stock
    for (const item of order.items) {
      await prisma.stock.updateMany({
        where: { productId: item.productId },
        data: {
          quantity: {
            increment: item.quantity,
          },
        },
      });
    }

    // If payment was made, set status to AWAITING_REFUND, otherwise CANCELLED
    const newStatus =
      order.paymentStatus === "PAID" ? "AWAITING_REFUND" : "CANCELLED";

    // Update order status
    const updatedOrder = await prisma.order.update({
      where: { id },
      data: {
        status: newStatus,
        cancellationReason: reason || null,
        refundApproved: false,
        trackingHistory: {
          create: [
            {
              status: newStatus,
              description: reason
                ? `Order cancelled - ${reason}`
                : "Order cancelled by customer",
              location: "Customer self-service",
            },
          ],
        },
      },
      include: {
        items: true,
        address: true,
        trackingHistory: { orderBy: { createdAt: "desc" } },
      },
    });

    // Send cancellation email
    emailService.sendOrderCancellation(updatedOrder, req.user).catch(err => {
      console.error('Failed to send cancellation email:', err);
    });

    res.json(updatedOrder);
  } catch (error) {
    next(error);
  }
};

export const pickupOrder = async (req, res, next) => {
  try {
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true, address: true },
    });

    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.userId !== req.user.id)
      return res.status(403).json({ error: "Not authorized" });
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

    res.json(updatedOrder);
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
      where: { id },
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
        user: true,
      },
    });

    // Send return request confirmation email
    emailService.sendReturnRequestConfirmation(updatedOrder, req.user).catch(err => {
      console.error('Failed to send return request confirmation email:', err);
    });

    res.json({ ...updatedOrder, rma });
  } catch (error) {
    next(error);
  }
};

export const trackOrder = async (req, res, next) => {
  try {
    const { number } = req.params;

    const order = await prisma.order.findUnique({
      where: { orderNumber: number },
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
    const { page, limit, status, deliveryMethod, orderedDay } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const skip = (pageNum - 1) * limitNum;

    const where = {};
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
      orders,
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
      where: { id },
    });

    if (!existingOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

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

    res.json(order);
  } catch (error) {
    next(error);
  }
};

export const approveRefund = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true, address: true },
    });
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
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
        user: true,
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

const DELIVERY_MAP = {
  pickup: "STORE_PICKUP",
  "store-pickup": "STORE_PICKUP",
  STORE_PICKUP: "STORE_PICKUP",
  "same-day": "SAME_DAY",
  SAME_DAY: "SAME_DAY",
  standard: "STANDARD",
  STANDARD: "STANDARD",
};

const PAYMENT_MAP = {
  mpesa: "MPESA",
  MPESA: "MPESA",
  card: "CARD",
  CARD: "CARD",
  bank: "BANK_TRANSFER",
  bank_transfer: "BANK_TRANSFER",
  BANK_TRANSFER: "BANK_TRANSFER",
  cod: "COD",
  COD: "COD",
};

function dayRange(day) {
  if (!day) return undefined;
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(`${day}T23:59:59.999Z`);
  if (Number.isNaN(start.getTime())) return undefined;
  return { gte: start, lte: end };
}

export const createCheckoutOrder = async (req, res, next) => {
  try {
    const {
      orderNumber,
      items = [],
      subtotal = 0,
      tax = 0,
      shippingCost = 0,
      total = 0,
      paymentMethod,
      paymentStatus,
      deliveryMethod,
      address = {},
      notes,
    } = req.body;
    if (!items.length)
      return res.status(400).json({ error: "Order items are required" });

    const savedAddress = await prisma.address.create({
      data: {
        userId: req.user.id,
        street: address.address || address.street || "Not provided",
        city: address.city || "Not provided",
        county: address.county || "Not provided",
        postalCode: address.zip || address.postalCode || null,
        isDefault: false,
      },
    });

    const delivery = DELIVERY_MAP[deliveryMethod] || "STANDARD";
    const payment = PAYMENT_MAP[paymentMethod] || "MPESA";
    const normalizedPaymentStatus =
      paymentStatus || (payment === "COD" ? "PENDING" : "PAID");
    const no = orderNumber || generateOrderNumber();

    const order = await prisma.order.create({
      data: {
        orderNumber: no,
        userId: req.user.id,
        addressId: savedAddress.id,
        subtotal: Number(subtotal),
        discount: 0,
        tax: Number(tax),
        shippingCost: Number(shippingCost),
        total: Number(total),
        paymentMethod: payment,
        paymentStatus: normalizedPaymentStatus,
        status: normalizedPaymentStatus === "PAID" ? "PROCESSING" : "PENDING",
        deliveryMethod: delivery,
        notes,
        items: {
          create: items.map((item) => ({
            productId: item.productId || "unknown",
            productName: item.productName || item.name || "Product",
            productPrice: Number(item.productPrice ?? item.price ?? 0),
            quantity: Number(item.quantity ?? item.qty ?? 1),
            subtotal: Number(
              item.subtotal ??
                (item.productPrice ?? item.price ?? 0) *
                  (item.quantity ?? item.qty ?? 1),
            ),
            productImage: item.productImage || item.image || null,
          })),
        },
        trackingHistory: {
          create: {
            status: "PENDING",
            description:
              normalizedPaymentStatus === "PAID"
                ? "Order Placed - Payment confirmed"
                : "Order Placed - Awaiting payment confirmation",
            location: "No Maneno Bazaar Warehouse",
          },
        },
      },
      include: {
        items: true,
        address: true,
        trackingHistory: { orderBy: { createdAt: "desc" } },
      },
    });

    res.status(201).json(order);
  } catch (error) {
    next(error);
  }
};

export const toggleAutoStage = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { enabled } = req.body;

    const order = await prisma.order.findUnique({
      where: { id },
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
