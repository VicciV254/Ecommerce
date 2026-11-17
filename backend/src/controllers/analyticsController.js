import prisma from '../config/database.js';
import { availableStock, httpError, loadCategories } from '../services/catalogService.js';
import { decimal, sumMoney } from '../utils/money.js';
import { expireReservations } from '../services/inventoryService.js';
import { inOrderPool } from '../services/refundService.js';
import {
  OPEN_REFUND_STATUSES, OPEN_RETURN_STATUSES, ORDER_STEP_FILTERS, paymentsNeedingReview,
} from '../services/attentionService.js';
import { NAIROBI_TIME_ZONE, isReportPeriod, nairobiDaySpan, nairobiPeriodRange } from '../utils/nairobiTime.js';

/** Paid, uncancelled orders. Fully refunded orders net to zero and are excluded. */
const SOLD_ORDER = { paymentStatus: { in: ['PAID', 'PARTIALLY_REFUNDED'] }, status: { not: 'CANCELLED' } };
const MONEY_RECEIVED = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'];
const CONFIRMED_REFUNDS = { where: { status: 'CONFIRMED' }, select: { amount: true, source: true, paymentId: true } };
const isSold = (order) => SOLD_ORDER.paymentStatus.in.includes(order.paymentStatus) && order.status !== 'CANCELLED';
/** Demo orders and products stay out of every figure, whatever the demo settings. */
const REAL = { isDemo: false };
const DEFAULT_PERIOD = 'month';
const STOCK_ALERT_STATUSES = ['LOW_STOCK', 'OUT_OF_STOCK'];
const RECENT_ORDER_LIMIT = 10;

/** Order total less confirmed refunds drawn from the order's own payment. */
const netOrderValue = (order) => decimal(order.total)
  .minus(sumMoney(order.refunds.filter((refund) => inOrderPool(order, refund)).map((refund) => refund.amount)));

async function netSales(where) {
  const sold = { ...where, ...SOLD_ORDER };
  const [gross, refunds] = await Promise.all([
    prisma.order.aggregate({ where: sold, _sum: { total: true }, _count: true }),
    prisma.refund.findMany({
      where: { status: 'CONFIRMED', order: { is: sold } },
      select: { amount: true, source: true, paymentId: true, order: { select: { settledPaymentId: true } } },
    }),
  ]);
  const refunded = sumMoney(refunds.filter((refund) => inOrderPool(refund.order, refund)).map((refund) => refund.amount));
  return { total: decimal(gross._sum.total ?? 0).minus(refunded), count: gross._count };
}

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

/** A reporting period from the request: today, week, month (the default) or year; anything else is refused. */
function reportPeriod(value = DEFAULT_PERIOD) {
  if (!isReportPeriod(value)) throw httpError(400, 'period must be today, week, month or year.', 'PERIOD_INVALID');
  return value;
}

/** The labelled range a response describes: ISO instants and the time zone its days are counted in. */
const rangeDto = (period, { gte, lte }) => ({
  period, start: gte?.toISOString() ?? null, end: lte.toISOString(), timeZone: NAIROBI_TIME_ZONE,
});

/** Figures for real orders placed in `createdAt`; the sales report computes the same ones from its order list. */
async function periodFigures(createdAt) {
  const placed = { ...REAL, createdAt };
  const [sales, ordersPlaced, cancelledOrders, refunds] = await Promise.all([
    netSales(placed),
    prisma.order.count({ where: placed }),
    prisma.order.count({ where: { ...placed, status: 'CANCELLED' } }),
    prisma.refund.aggregate({ where: { status: 'CONFIRMED', order: { is: placed } }, _count: true, _sum: { amount: true } }),
  ]);
  return {
    netSales: sales.total, paidOrders: sales.count, ordersPlaced, cancelledOrders,
    refunds: { count: refunds._count, amount: decimal(refunds._sum.amount ?? 0) },
  };
}

const countByStatus = (groups, statuses) =>
  Object.fromEntries(statuses.map((status) => [status, groups.find((group) => group.status === status)?._count._all ?? 0]));

/** Work waiting now, whatever the period, with the Orders queues' and the attention feed's own predicates. */
async function currentWork() {
  const steps = Object.keys(ORDER_STEP_FILTERS);
  const [stepCounts, reviews, returns, refunds, stock] = await Promise.all([
    Promise.all(steps.map((step) => prisma.order.count({ where: { ...REAL, ...ORDER_STEP_FILTERS[step] } }))),
    paymentsNeedingReview(REAL),
    prisma.returnRequest.groupBy({
      by: ['status'], where: { status: { in: OPEN_RETURN_STATUSES }, order: { is: REAL } }, _count: { _all: true },
    }),
    prisma.refund.groupBy({
      by: ['status'], where: { status: { in: OPEN_REFUND_STATUSES }, order: { is: REAL } }, _count: { _all: true },
    }),
    prisma.stock.groupBy({
      by: ['status'],
      where: { status: { in: STOCK_ALERT_STATUSES }, variant: { is: { isActive: true, product: { is: { ...REAL, deletedAt: null } } } } },
      _count: { _all: true },
    }),
  ]);
  return {
    orders: Object.fromEntries(steps.map((step, index) => [step, stepCounts[index]])),
    paymentsNeedingReview: reviews.length,
    returns: countByStatus(returns, OPEN_RETURN_STATUSES),
    refunds: countByStatus(refunds, OPEN_REFUND_STATUSES),
    stock: countByStatus(stock, STOCK_ALERT_STATUSES),
  };
}

export const getDashboardMetrics = async (req, res, next) => {
  try {
    const period = reportPeriod(req.query.period);
    await expireReservations();
    const now = new Date();
    const createdAt = nairobiPeriodRange(period, now);
    const [figures, current, recentOrders] = await Promise.all([
      periodFigures(createdAt),
      currentWork(),
      prisma.order.findMany({
        where: REAL,
        take: RECENT_ORDER_LIMIT,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
      }),
    ]);
    res.json({ range: rangeDto(period, createdAt), generatedAt: now.toISOString(), figures, current, recentOrders });
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
    const now = new Date();
    // Date-only startDate/endDate are whole Nairobi days and take precedence over the period, as before.
    const days = nairobiDaySpan(req.query.startDate, req.query.endDate, ['startDate', 'endDate']);
    const period = days ? 'custom' : reportPeriod(req.query.period);
    const createdAt = days ? { ...days, lte: days.lte ?? now } : nairobiPeriodRange(period, now);

    const orders = await prisma.order.findMany({
      where: { ...REAL, createdAt },
      include: {
        items: true,
        user: { select: { email: true, firstName: true, lastName: true } },
        refunds: CONFIRMED_REFUNDS,
        returnRequests: { where: { status: 'RECEIVED' }, select: { lines: { select: { receivedQuantity: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const paidOrders = orders.filter(isSold);
    const cancelledOrders = orders.filter((order) => order.status === 'CANCELLED');
    const returnedOrders = orders.filter((order) => order.returnRequests.length > 0);
    const refundedOrders = orders.filter((order) => ['PARTIALLY_REFUNDED', 'REFUNDED'].includes(order.paymentStatus));
    const confirmedRefunds = orders.flatMap((order) => order.refunds);
    const totalRevenue = sumMoney(paidOrders.map(netOrderValue));
    const grossRevenue = sumMoney(orders.filter((order) => MONEY_RECEIVED.includes(order.paymentStatus)).map((order) => order.total));
    const cancelledValue = sumMoney(cancelledOrders.map((order) => order.total));
    const returnedValue = sumMoney(confirmedRefunds.filter((refund) => refund.source === 'RETURN').map((refund) => refund.amount));
    const refundedValue = sumMoney(confirmedRefunds.map((refund) => refund.amount));
    const returnedUnits = (order) => order.returnRequests.flatMap((request) => request.lines)
      .reduce((sum, line) => sum + (line.receivedQuantity ?? 0), 0);
    const totalItemsSold = paidOrders.reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity, 0) - returnedUnits(o), 0);

    res.json({
      period,
      range: rangeDto(period, createdAt),
      generatedAt: now.toISOString(),
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
          where: { isDemo: false, ...SOLD_ORDER },
          include: { refunds: CONFIRMED_REFUNDS },
        },
      },
    });

    const activeCustomers = customersWithOrders.filter(
      (c) => c.orders.length > 0
    ).length;

    const totalSpent = sumMoney(customersWithOrders.flatMap((customer) => customer.orders.map(netOrderValue)));
    const avgOrderValue = totalSpent.div(activeCustomers || 1).toDecimalPlaces(2);

    const topCustomers = customersWithOrders
      .map((c) => ({
        id: c.id,
        name: `${c.firstName} ${c.lastName}`,
        email: c.email,
        totalOrders: c.orders.length,
        totalSpent: sumMoney(c.orders.map(netOrderValue)),
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
