import bcrypt from 'bcryptjs';
import prisma from '../config/database.js';
import { generateToken, generateRefreshToken } from '../config/auth.js';

export const adminLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    const admin = await prisma.admin.findUnique({
      where: { email },
    });
    
    if (!admin) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const isPasswordValid = await bcrypt.compare(password, admin.password);
    
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Update last login
    await prisma.admin.update({
      where: { id: admin.id },
      data: { lastLogin: new Date() },
    });
    
    // Generate tokens
    const token = generateToken({ adminId: admin.id });
    const refreshToken = generateRefreshToken({ adminId: admin.id });
    
    // Log activity
    await prisma.activityLog.create({
      data: {
        adminId: admin.id,
        action: 'LOGIN',
        details: 'Admin logged in',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });
    
    res.json({
      admin: {
        id: admin.id,
        email: admin.email,
        username: admin.username,
        role: admin.role,
      },
      token,
      refreshToken,
    });
  } catch (error) {
    next(error);
  }
};

export const getAdminMe = async (req, res, next) => {
  try {
    const admin = await prisma.admin.findUnique({
      where: { id: req.admin.id },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        lastLogin: true,
        createdAt: true,
      },
    });
    
    res.json(admin);
  } catch (error) {
    next(error);
  }
};

export const getActivityLogs = async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 50;
    const skip = (pageNum - 1) * limitNum;
    
    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        skip,
        take: limitNum,
        include: {
          admin: {
            select: {
              id: true,
              username: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.activityLog.count(),
    ]);
    
    res.json({
      logs,
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

export const createInitialAdmin = async (req, res, next) => {
  try {
    const { email, username, password } = req.body;
    
    // Check if admin already exists
    const existingAdmin = await prisma.admin.findFirst();
    if (existingAdmin) {
      return res.status(400).json({ error: 'Admin already exists' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const admin = await prisma.admin.create({
      data: {
        email,
        username,
        password: hashedPassword,
        role: 'SUPER_ADMIN',
      },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
      },
    });
    
    res.status(201).json(admin);
  } catch (error) {
    next(error);
  }
};

export const getUsers = async (req, res, next) => {
  try {
    const { verified, disabled, q } = req.query;
    const where = {};
    if (verified === 'true') where.emailVerified = true;
    if (verified === 'false') where.emailVerified = false;
    if (disabled === 'true') where.isDisabled = true;
    if (disabled === 'false') where.isDisabled = false;
    if (q) {
      where.OR = [
        { email: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        emailVerified: true,
        isDisabled: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { orders: true, addresses: true, wishlist: true } },
      },
    });
    res.json({ users });
  } catch (error) {
    next(error);
  }
};

async function sendUserVerification(user) {
  const crypto = await import('crypto');
  const { sendVerificationEmail } = await import('../services/mailService.js');
  const token = crypto.randomBytes(32).toString('hex');
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: false,
      emailVerifyToken: token,
      emailVerifyExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    select: { id: true, email: true, firstName: true },
  });
  const sent = await sendVerificationEmail(updated, token).catch((error) => {
    console.error('Admin verification email failed:', error.message);
    return false;
  });
  return { userId: updated.id, email: updated.email, sent };
}

export const sendVerificationToUser = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isDisabled) return res.status(400).json({ error: 'Cannot verify a disabled account' });
    const result = await sendUserVerification(user);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const sendVerificationToUsers = async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!ids.length) return res.status(400).json({ error: 'Select at least one user' });
    const users = await prisma.user.findMany({ where: { id: { in: ids }, isDisabled: false } });
    const results = [];
    for (const user of users) {
      results.push(await sendUserVerification(user));
    }
    res.json({ results });
  } catch (error) {
    next(error);
  }
};

export const setUserDisabled = async (req, res, next) => {
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { isDisabled: Boolean(req.body.disabled) },
      select: { id: true, email: true, firstName: true, lastName: true, emailVerified: true, isDisabled: true, createdAt: true },
    });
    res.json(user);
  } catch (error) {
    next(error);
  }
};

export const deleteUser = async (req, res, next) => {
  try {
    const orders = await prisma.order.count({ where: { userId: req.params.id } });
    if (orders > 0) {
      return res.status(400).json({ error: 'Users with orders cannot be deleted. Disable the account instead to preserve order history.' });
    }
    const cart = await prisma.cart.findUnique({ where: { userId: req.params.id } }).catch(() => null);
    if (cart) await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await prisma.cart.deleteMany({ where: { userId: req.params.id } });
    await prisma.wishlist.deleteMany({ where: { userId: req.params.id } });
    await prisma.address.deleteMany({ where: { userId: req.params.id } });
    await prisma.passwordReset.deleteMany({ where: { userId: req.params.id } });
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ message: 'User deleted' });
  } catch (error) {
    next(error);
  }
};

const adminDeliveryMap = {
  pickup: 'STORE_PICKUP',
  'store-pickup': 'STORE_PICKUP',
  STORE_PICKUP: 'STORE_PICKUP',
  'same-day': 'SAME_DAY',
  SAME_DAY: 'SAME_DAY',
  standard: 'STANDARD',
  STANDARD: 'STANDARD',
};
const adminPaymentMap = { mpesa: 'MPESA', MPESA: 'MPESA', card: 'CARD', CARD: 'CARD', bank: 'BANK_TRANSFER', BANK_TRANSFER: 'BANK_TRANSFER', cod: 'COD', COD: 'COD' };

export const importLocalOrders = async (req, res, next) => {
  try {
    const receipts = Array.isArray(req.body.receipts) ? req.body.receipts : [];
    const results = [];
    for (const receipt of receipts) {
      const email = receipt.address?.email;
      if (!email || !receipt.orderNumber) {
        results.push({ orderNumber: receipt.orderNumber, imported: false, reason: 'Missing email or order number' });
        continue;
      }
      const existing = await prisma.order.findUnique({ where: { orderNumber: receipt.orderNumber } });
      if (existing) {
        results.push({ orderNumber: receipt.orderNumber, imported: false, reason: 'Already exists' });
        continue;
      }
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        results.push({ orderNumber: receipt.orderNumber, imported: false, reason: 'No matching user' });
        continue;
      }
      const address = await prisma.address.create({
        data: {
          userId: user.id,
          street: receipt.address.address || 'Not provided',
          city: receipt.address.city || 'Not provided',
          county: receipt.address.county || 'Not provided',
          postalCode: receipt.address.zip || null,
          isDefault: false,
        },
      });
      await prisma.order.create({
        data: {
          orderNumber: receipt.orderNumber,
          userId: user.id,
          addressId: address.id,
          subtotal: Number(receipt.subtotal || 0),
          discount: 0,
          tax: Number(receipt.tax || 0),
          shippingCost: Number(receipt.shippingCost || 0),
          total: Number(receipt.total || 0),
          status: receipt.status || 'PENDING',
          paymentMethod: adminPaymentMap[receipt.paymentMethod] || 'MPESA',
          paymentStatus: receipt.paymentStatus || 'PENDING',
          deliveryMethod: adminDeliveryMap[receipt.deliveryMethod] || 'STANDARD',
          notes: receipt.mpesaCheckoutRequestId ? `Imported local receipt. M-Pesa CheckoutRequestID: ${receipt.mpesaCheckoutRequestId}` : 'Imported local receipt',
          items: {
            create: (receipt.items || []).map((item) => ({
              productId: item.productId || 'unknown',
              productName: item.productName || 'Product',
              productPrice: Number(item.productPrice || 0),
              quantity: Number(item.quantity || 1),
              subtotal: Number(item.subtotal || 0),
              productImage: item.productImage || null,
            })),
          },
          trackingHistory: { create: { status: receipt.status || 'PENDING', description: 'Order Placed - Imported from local receipt', location: 'No Maneno Bazaar Warehouse' } },
          createdAt: receipt.createdAt ? new Date(receipt.createdAt) : undefined,
          updatedAt: receipt.updatedAt ? new Date(receipt.updatedAt) : undefined,
        },
      });
      results.push({ orderNumber: receipt.orderNumber, imported: true });
    }
    res.json({ results });
  } catch (error) {
    next(error);
  }
};
