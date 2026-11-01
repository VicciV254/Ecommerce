import prisma from '../config/database.js';
import { availableStock, httpError, loadCategories, productWhere } from '../services/catalogService.js';
import { decimal, sumMoney } from '../utils/money.js';
import { expireReservations } from '../services/inventoryService.js';

async function inventory() {
  await expireReservations();
  return prisma.$transaction(async (db) => ({
    context: await loadCategories(db),
    products: await db.product.findMany({
      where: { isDemo: false, deletedAt: null },
      include: { variants: { where: { isActive: true }, include: { stock: true } }, _count: { select: { reviews: true } } },
    }),
  }), { isolationLevel: 'RepeatableRead' });
}

function inventoryVariants(products) {
  return products.flatMap((product) => product.variants.map((variant) => {
    if (!variant.stock) throw httpError(503, 'Variant stock data is incomplete');
    return { ...variant, price: variant.price ?? product.price };
  }));
}

function periodRange(period = 'month') {
  const now = new Date();
  const start = new Date(now);
  if (period === 'day') {
    start.setHours(0, 0, 0, 0);
  } else if (period === 'week') {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    start.setHours(0, 0, 0, 0);
  } else if (period === 'year') {
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }
  return { gte: start, lte: now };
}

export const getDashboardMetrics = async (req, res, next) => {
  try {
    await expireReservations();
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const categories = await loadCategories();

    // Total sales
    const totalSales = await prisma.order.aggregate({
      where: {
        isDemo: false,
        paymentStatus: 'PAID',
        status: { notIn: ['CANCELLED', 'RETURNED'] },
      },
      _sum: { total: true },
    });

    // This month's sales
    const thisMonthSales = await prisma.order.aggregate({
      where: {
        isDemo: false,
        paymentStatus: 'PAID',
        status: { notIn: ['CANCELLED', 'RETURNED'] },
        createdAt: { gte: startOfMonth },
      },
      _sum: { total: true },
      _count: true,
    });

    // Last month's sales
    const lastMonthSales = await prisma.order.aggregate({
      where: {
        isDemo: false,
        paymentStatus: 'PAID',
        status: { notIn: ['CANCELLED', 'RETURNED'] },
        createdAt: {
          gte: startOfLastMonth,
          lt: endOfLastMonth,
        },
      },
      _sum: { total: true },
      _count: true,
    });

    // Total orders
    const totalOrders = await prisma.order.count({ where: { isDemo: false } });
    const statusGroups = await prisma.order.groupBy({
      by: ['status'],
      where: { isDemo: false },
      _count: { status: true },
      _sum: { total: true },
    });
    const orderStatus = Object.fromEntries(statusGroups.map((item) => [item.status, item._count.status]));
    const cancelledOrders = orderStatus.CANCELLED || 0;
    const returnedOrders = orderStatus.RETURNED || 0;
    const refundedPayments = await prisma.order.aggregate({
      where: { paymentStatus: 'REFUNDED', isDemo: false },
      _count: true,
      _sum: { total: true },
    });

    // Total products
    const totalProducts = await prisma.product.count({ where: { isDemo: false, deletedAt: null } });
    const activeProducts = await prisma.product.count({ where: { ...productWhere(categories), isDemo: false } });
    const lowStockProducts = await prisma.stock.count({
      where: { status: 'LOW_STOCK', variant: { is: { isActive: true, product: { is: { isDemo: false, deletedAt: null } } } } },
    });
    const outOfStockProducts = await prisma.stock.count({
      where: { status: 'OUT_OF_STOCK', variant: { is: { isActive: true, product: { is: { isDemo: false, deletedAt: null } } } } },
    });

    // Total customers
    const totalCustomers = await prisma.user.count();

    // Recent orders
    const recentOrders = await prisma.order.findMany({
      where: { isDemo: false },
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    const currentRevenue = decimal(thisMonthSales._sum.total ?? 0);
    const previousRevenue = decimal(lastMonthSales._sum.total ?? 0);
    res.json({
      sales: {
        total: totalSales._sum.total || 0,
        thisMonth: thisMonthSales._sum.total || 0,
        thisMonthOrders: thisMonthSales._count,
        lastMonth: lastMonthSales._sum.total || 0,
        lastMonthOrders: lastMonthSales._count,
        growth: !previousRevenue.isZero()
          ? currentRevenue.minus(previousRevenue).div(previousRevenue).mul(100).toDecimalPlaces(2).toNumber()
          : 0,
      },
      orders: {
        total: totalOrders,
        pending: orderStatus.PENDING || 0,
        processing: orderStatus.PROCESSING || 0,
        shipped: orderStatus.SHIPPED || 0,
        outForDelivery: orderStatus.READY_FOR_PICKUP || 0,
        delivered: orderStatus.DELIVERED || 0,
        cancelled: cancelledOrders,
        returned: returnedOrders,
        byStatus: orderStatus,
      },
      refunds: {
        count: refundedPayments._count || 0,
        total: refundedPayments._sum.total || 0,
      },
      products: {
        total: totalProducts,
        active: activeProducts,
        lowStock: lowStockProducts,
        outOfStock: outOfStockProducts,
      },
      customers: {
        total: totalCustomers,
      },
      recentOrders,
    });
  } catch (error) {
    next(error);
  }
};

export const getInventoryBreakdown = async (req, res, next) => {
  try {
    const { context, products } = await inventory();
    const breakdown = context.categories.filter((category) => !category.parentId && !category.deletedAt).map((category) => {
      const members = products.filter((product) => context.paths.get(product.categoryId).some((item) => item.id === category.id));
      const variants = inventoryVariants(members);
      return {
        category: category.name, totalProducts: members.length,
        totalValue: sumMoney(variants.map((variant) => decimal(variant.price).mul(variant.stock.quantity))),
        lowStock: variants.filter((variant) => availableStock(variant.stock) > 0 && availableStock(variant.stock) <= variant.stock.minThreshold).length,
        outOfStock: variants.filter((variant) => availableStock(variant.stock) === 0).length,
        stockUnit: 'variant',
      };
    });

    res.json(breakdown);
  } catch (error) {
    next(error);
  }
};

export const getSalesReport = async (req, res, next) => {
  try {
    const { startDate, endDate, period = 'month' } = req.query;
    
    const where = { isDemo: false };

    if (startDate) {
      where.createdAt = { ...where.createdAt, gte: new Date(startDate) };
    }
    if (endDate) {
      where.createdAt = { ...where.createdAt, lte: new Date(endDate) };
    }
    if (!startDate && !endDate) {
      where.createdAt = periodRange(period);
    }

    const orders = await prisma.order.findMany({
      where,
      include: {
        items: true,
        user: { select: { email: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const paidOrders = orders.filter((order) => order.paymentStatus === 'PAID' && order.status !== 'CANCELLED' && order.status !== 'RETURNED');
    const cancelledOrders = orders.filter((order) => order.status === 'CANCELLED');
    const returnedOrders = orders.filter((order) => order.status === 'RETURNED');
    const refundedOrders = orders.filter((order) => order.paymentStatus === 'REFUNDED');
    const totalRevenue = sumMoney(paidOrders.map((order) => order.total));
    const grossRevenue = sumMoney(orders.filter((order) => ['PAID', 'REFUNDED'].includes(order.paymentStatus)).map((order) => order.total));
    const cancelledValue = sumMoney(cancelledOrders.map((order) => order.total));
    const returnedValue = sumMoney(returnedOrders.map((order) => order.total));
    const refundedValue = sumMoney(refundedOrders.map((order) => order.total));
    const totalItemsSold = paidOrders.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0);

    // Sales by category
    const salesByCategory = {};
    paidOrders.forEach((order) => {
      order.items.forEach((item) => {
        const category = item.productName.split(' ')[0] || 'Other';
        if (!salesByCategory[category]) {
          salesByCategory[category] = { revenue: decimal(0), items: 0 };
        }
        salesByCategory[category].revenue = salesByCategory[category].revenue.plus(item.subtotal);
        salesByCategory[category].items += item.quantity;
      });
    });

    res.json({
      period,
      totalRevenue,
      grossRevenue,
      cancelledValue,
      returnedValue,
      refundedValue,
      totalOrders: orders.length,
      paidOrders: paidOrders.length,
      cancelledOrders: cancelledOrders.length,
      returnedOrders: returnedOrders.length,
      refundedOrders: refundedOrders.length,
      totalItemsSold,
      salesByCategory,
      orders: orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        customer: `${order.user?.firstName || ''} ${order.user?.lastName || ''}`.trim(),
        email: order.user?.email || '',
        status: order.status,
        paymentStatus: order.paymentStatus,
        deliveryMethod: order.deliveryMethod,
        subtotal: order.subtotal,
        tax: order.tax,
        shippingCost: order.shippingCost,
        total: order.total,
        createdAt: order.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};

export const getCategoryPerformance = async (req, res, next) => {
  try {
    const { context, products } = await inventory();
    const performance = context.categories.filter((category) => !category.parentId && !category.deletedAt).map((category) => {
      const members = products.filter((product) => context.paths.get(product.categoryId).some((item) => item.id === category.id));
      const variants = inventoryVariants(members);
      return {
        category: category.name, totalProducts: members.length,
        totalStock: variants.reduce((sum, variant) => sum + availableStock(variant.stock), 0),
        totalReviews: members.reduce((sum, product) => sum + product._count.reviews, 0),
        avgRating: (members.reduce((sum, product) => sum + product.rating, 0) / (members.length || 1)).toFixed(1),
      };
    });

    res.json(performance);
  } catch (error) {
    next(error);
  }
};

export const getCustomerInsights = async (req, res, next) => {
  try {
    const totalCustomers = await prisma.user.count();
    
    const customersWithOrders = await prisma.user.findMany({
      include: {
        orders: {
          where: {
            isDemo: false,
            paymentStatus: 'PAID',
            status: { notIn: ['CANCELLED', 'RETURNED'] },
          },
        },
      },
    });

    const activeCustomers = customersWithOrders.filter(
      (c) => c.orders.length > 0
    ).length;

    const totalSpent = sumMoney(customersWithOrders.flatMap((customer) => customer.orders.map((order) => order.total)));
    const avgOrderValue = totalSpent.div(activeCustomers || 1).toDecimalPlaces(2);

    const topCustomers = customersWithOrders
      .map((c) => ({
        id: c.id,
        name: `${c.firstName} ${c.lastName}`,
        email: c.email,
        totalOrders: c.orders.length,
        totalSpent: sumMoney(c.orders.map((order) => order.total)),
      }))
      .sort((a, b) => b.totalSpent.comparedTo(a.totalSpent))
      .slice(0, 10);

    res.json({
      totalCustomers,
      activeCustomers,
      totalSpent,
      avgOrderValue,
      topCustomers,
    });
  } catch (error) {
    next(error);
  }
};
