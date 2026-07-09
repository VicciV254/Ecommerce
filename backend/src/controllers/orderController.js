import prisma from '../config/database.js';
import { generateOrderNumber } from '../utils/helpers.js';

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
      return res.status(400).json({ error: 'Cart is empty' });
    }
    
    // Check stock availability
    for (const item of cart.items) {
      if (item.product.stock.quantity < item.quantity) {
        return res.status(400).json({ 
          error: `Insufficient stock for ${item.product.name}` 
        });
      }
    }
    
    // Get address
    const address = await prisma.address.findUnique({
      where: { id: addressId },
    });
    
    if (!address || address.userId !== req.user.id) {
      return res.status(400).json({ error: 'Invalid address' });
    }
    
    // Calculate shipping cost
    const shippingCost = deliveryMethod === 'SAME_DAY' ? 500 : 200;
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
          create: cart.items.map(item => ({
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
            status: normalizedPaymentStatus === 'PAID' ? 'PROCESSING' : 'PENDING',
            description: 'Order placed successfully',
          },
        },
      },
      include: {
        items: true,
        address: true,
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
          action: 'auto-decrement',
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
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
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
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    if (order.userId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    res.json(order);
  } catch (error) {
    next(error);
  }
};

export const cancelOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason = 'Customer requested cancellation' } = req.body;
    
    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    if (order.userId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    if (!['PENDING', 'PROCESSING'].includes(order.status)) {
      return res.status(400).json({ error: 'Order cannot be cancelled at this stage. Please request a return instead.' });
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
    
    // Update order status
    const updatedOrder = await prisma.order.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        paymentStatus: order.paymentStatus === 'PAID' ? 'REFUNDED' : order.paymentStatus,
        notes: [order.notes, `Cancellation: ${reason}`].filter(Boolean).join('\n'),
        trackingHistory: {
          create: [
            {
              status: 'CANCELLED',
              description: `Order cancelled - ${reason}`,
              location: 'Customer self-service',
            },
            ...(order.paymentStatus === 'PAID'
              ? [{
                  status: 'CANCELLED',
                  description: 'Refund simulated to original payment method',
                  location: 'No Maneno Bazaar payments',
                }]
              : []),
          ],
        },
      },
      include: {
        items: true,
        address: true,
        trackingHistory: { orderBy: { createdAt: 'desc' } },
      },
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

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.userId !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
    if (order.deliveryMethod !== 'STORE_PICKUP') {
      return res.status(400).json({ error: 'This order is not marked for store pickup.' });
    }
    if (['CANCELLED', 'RETURNED'].includes(order.status)) {
      return res.status(400).json({ error: 'This order cannot be picked up because it is cancelled or returned.' });
    }
    if (!['PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY'].includes(order.status)) {
      return res.status(400).json({ error: 'This order is not ready for pickup yet.' });
    }

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: {
        status: 'DELIVERED',
        trackingHistory: {
          create: {
            status: 'DELIVERED',
            description: 'Picked up by customer',
            location: 'No Maneno Bazaar pickup desk',
          },
        },
      },
      include: {
        items: true,
        address: true,
        trackingHistory: { orderBy: { createdAt: 'desc' } },
      },
    });

    res.json(updatedOrder);
  } catch (error) {
    next(error);
  }
};

export const returnOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason = 'Customer requested return', resolution = 'REFUND' } = req.body;

    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true, address: true },
    });

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.userId !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
    if (order.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Cancelled orders cannot be returned.' });
    }
    if (!['DELIVERED', 'OUT_FOR_DELIVERY'].includes(order.status)) {
      return res.status(400).json({ error: 'Returns can only be started after delivery or pickup.' });
    }

    const rma = `RMA-${order.orderNumber.replace(/^NM-/, '')}`;
    const normalizedResolution = ['REFUND', 'EXCHANGE', 'STORE_CREDIT'].includes(resolution) ? resolution : 'REFUND';
    const refundDescription = normalizedResolution === 'STORE_CREDIT'
      ? 'Store credit resolution recorded'
      : normalizedResolution === 'EXCHANGE'
        ? 'Exchange request recorded'
        : 'Refund simulated after return request';

    const updatedOrder = await prisma.order.update({
      where: { id },
      data: {
        status: 'RETURNED',
        paymentStatus: normalizedResolution === 'REFUND' && order.paymentStatus === 'PAID' ? 'REFUNDED' : order.paymentStatus,
        notes: [order.notes, `Return ${rma}: ${reason}. Resolution: ${normalizedResolution}`].filter(Boolean).join('\n'),
        trackingHistory: {
          create: [
            {
              status: 'RETURNED',
              description: `Return requested (${rma}) - ${reason}`,
              location: 'Customer self-service return portal',
            },
            {
              status: 'RETURNED',
              description: refundDescription,
              location: 'No Maneno Bazaar returns desk',
            },
          ],
        },
      },
      include: {
        items: true,
        address: true,
        trackingHistory: { orderBy: { createdAt: 'desc' } },
      },
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
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
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
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
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
    
    const order = await prisma.order.update({
      where: { id },
      data: {
        status,
        trackingHistory: {
          create: {
            status,
            description: description || `Order status updated to ${status}`,
            location,
          },
        },
      },
      include: {
        trackingHistory: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    
    res.json(order);
  } catch (error) {
    next(error);
  }
};

const DELIVERY_MAP = {
  pickup: 'STORE_PICKUP',
  'store-pickup': 'STORE_PICKUP',
  STORE_PICKUP: 'STORE_PICKUP',
  'same-day': 'SAME_DAY',
  SAME_DAY: 'SAME_DAY',
  standard: 'STANDARD',
  STANDARD: 'STANDARD',
};

const PAYMENT_MAP = {
  mpesa: 'MPESA',
  MPESA: 'MPESA',
  card: 'CARD',
  CARD: 'CARD',
  bank: 'BANK_TRANSFER',
  bank_transfer: 'BANK_TRANSFER',
  BANK_TRANSFER: 'BANK_TRANSFER',
  cod: 'COD',
  COD: 'COD',
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
    const { orderNumber, items = [], subtotal = 0, tax = 0, shippingCost = 0, total = 0, paymentMethod, paymentStatus, deliveryMethod, address = {}, notes } = req.body;
    if (!items.length) return res.status(400).json({ error: 'Order items are required' });

    const savedAddress = await prisma.address.create({
      data: {
        userId: req.user.id,
        street: address.address || address.street || 'Not provided',
        city: address.city || 'Not provided',
        county: address.county || 'Not provided',
        postalCode: address.zip || address.postalCode || null,
        isDefault: false,
      },
    });

    const delivery = DELIVERY_MAP[deliveryMethod] || 'STANDARD';
    const payment = PAYMENT_MAP[paymentMethod] || 'MPESA';
    const normalizedPaymentStatus = paymentStatus || (payment === 'COD' ? 'PENDING' : 'PAID');
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
        status: normalizedPaymentStatus === 'PAID' ? 'PROCESSING' : 'PENDING',
        deliveryMethod: delivery,
        notes,
        items: {
          create: items.map((item) => ({
            productId: item.productId || 'unknown',
            productName: item.productName || item.name || 'Product',
            productPrice: Number(item.productPrice ?? item.price ?? 0),
            quantity: Number(item.quantity ?? item.qty ?? 1),
            subtotal: Number(item.subtotal ?? ((item.productPrice ?? item.price ?? 0) * (item.quantity ?? item.qty ?? 1))),
            productImage: item.productImage || item.image || null,
          })),
        },
        trackingHistory: {
          create: {
            status: 'PENDING',
            description: normalizedPaymentStatus === 'PAID' ? 'Order Placed - Payment confirmed' : 'Order Placed - Awaiting payment confirmation',
            location: 'No Maneno Bazaar Warehouse',
          },
        },
      },
      include: { items: true, address: true, trackingHistory: { orderBy: { createdAt: 'desc' } } },
    });

    res.status(201).json(order);
  } catch (error) {
    next(error);
  }
};
