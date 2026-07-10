import prisma from '../config/database.js';

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
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Total sales
    const totalSales = await prisma.order.aggregate({
      where: {
        status: { notIn: ['CANCELLED', 'RETURNED'] },
      },
      _sum: { total: true },
    });

    // This month's sales
    const thisMonthSales = await prisma.order.aggregate({
      where: {
        status: { notIn: ['CANCELLED', 'RETURNED'] },
        createdAt: { gte: startOfMonth },
      },
      _sum: { total: true },
      _count: true,
    });

    // Last month's sales
    const lastMonthSales = await prisma.order.aggregate({
      where: {
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
    const totalOrders = await prisma.order.count();
    const statusGroups = await prisma.order.groupBy({
      by: ['status'],
      _count: { status: true },
      _sum: { total: true },
    });
    const orderStatus = Object.fromEntries(statusGroups.map((item) => [item.status, item._count.status]));
    const cancelledOrders = orderStatus.CANCELLED || 0;
    const returnedOrders = orderStatus.RETURNED || 0;
    const refundedPayments = await prisma.order.aggregate({
      where: { paymentStatus: 'REFUNDED' },
      _count: true,
      _sum: { total: true },
    });

    // Total products
    const totalProducts = await prisma.product.count();
    const activeProducts = await prisma.product.count({ where: { isActive: true } });
    const lowStockProducts = await prisma.stock.count({
      where: { status: 'LOW_STOCK' },
    });
    const outOfStockProducts = await prisma.stock.count({
      where: { status: 'OUT_OF_STOCK' },
    });

    // Total customers
    const totalCustomers = await prisma.user.count();

    // Recent orders
    const recentOrders = await prisma.order.findMany({
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

    res.json({
      sales: {
        total: totalSales._sum.total || 0,
        thisMonth: thisMonthSales._sum.total || 0,
        thisMonthOrders: thisMonthSales._count,
        lastMonth: lastMonthSales._sum.total || 0,
        lastMonthOrders: lastMonthSales._count,
        growth: lastMonthSales._sum.total
          ? ((thisMonthSales._sum.total - lastMonthSales._sum.total) / lastMonthSales._sum.total) * 100
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
    const categories = await prisma.category.findMany({
      include: {
        products: {
          include: {
            stock: true,
          },
        },
      },
    });

    const breakdown = categories.map((category) => {
      const totalProducts = category.products.length;
      const totalValue = category.products.reduce(
        (sum, p) => sum + p.price * p.stock.quantity,
        0
      );
      const lowStock = category.products.filter(
        (p) => p.stock.status === 'LOW_STOCK'
      ).length;
      const outOfStock = category.products.filter(
        (p) => p.stock.status === 'OUT_OF_STOCK'
      ).length;

      return {
        category: category.name,
        totalProducts,
        totalValue,
        lowStock,
        outOfStock,
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
    
    const where = {};

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

    const paidOrders = orders.filter((order) => order.status !== 'CANCELLED' && order.status !== 'RETURNED');
    const cancelledOrders = orders.filter((order) => order.status === 'CANCELLED');
    const returnedOrders = orders.filter((order) => order.status === 'RETURNED');
    const refundedOrders = orders.filter((order) => order.paymentStatus === 'REFUNDED');
    const totalRevenue = paidOrders.reduce((sum, o) => sum + o.total, 0);
    const grossRevenue = orders.reduce((sum, o) => sum + o.total, 0);
    const cancelledValue = cancelledOrders.reduce((sum, o) => sum + o.total, 0);
    const returnedValue = returnedOrders.reduce((sum, o) => sum + o.total, 0);
    const refundedValue = refundedOrders.reduce((sum, o) => sum + o.total, 0);
    const totalItemsSold = orders.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0), 0);

    // Sales by category
    const salesByCategory = {};
    orders.forEach((order) => {
      order.items.forEach((item) => {
        const category = item.productName.split(' ')[0] || 'Other';
        if (!salesByCategory[category]) {
          salesByCategory[category] = { revenue: 0, items: 0 };
        }
        salesByCategory[category].revenue += item.subtotal;
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
    const categories = await prisma.category.findMany({
      include: {
        products: {
          include: {
            stock: true,
            _count: {
              select: { reviews: true },
            },
          },
        },
      },
    });

    const performance = categories.map((category) => {
      const totalProducts = category.products.length;
      const totalStock = category.products.reduce(
        (sum, p) => sum + p.stock.quantity,
        0
      );
      const totalReviews = category.products.reduce(
        (sum, p) => sum + p._count.reviews,
        0
      );
      const avgRating = category.products.reduce(
        (sum, p) => sum + p.rating,
        0
      ) / (totalProducts || 1);

      return {
        category: category.name,
        totalProducts,
        totalStock,
        totalReviews,
        avgRating: avgRating.toFixed(1),
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
            status: { notIn: ['CANCELLED', 'RETURNED'] },
          },
        },
      },
    });

    const activeCustomers = customersWithOrders.filter(
      (c) => c.orders.length > 0
    ).length;

    const totalSpent = customersWithOrders.reduce(
      (sum, c) => sum + c.orders.reduce((s, o) => s + o.total, 0),
      0
    );

    const avgOrderValue = customersWithOrders.reduce(
      (sum, c) => sum + c.orders.reduce((s, o) => s + o.total, 0),
      0
    ) / (activeCustomers || 1);

    const topCustomers = customersWithOrders
      .map((c) => ({
        id: c.id,
        name: `${c.firstName} ${c.lastName}`,
        email: c.email,
        totalOrders: c.orders.length,
        totalSpent: c.orders.reduce((s, o) => s + o.total, 0),
      }))
      .sort((a, b) => b.totalSpent - a.totalSpent)
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
