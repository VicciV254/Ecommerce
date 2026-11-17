import bcrypt from 'bcryptjs';
import prisma from '../config/database.js';
import { generateToken, generateRefreshToken } from '../config/auth.js';
import { ACTIVITY, ACTIVITY_FILTERS, activityQuerySchema, recordActivity, recordAfterSending } from '../services/activityService.js';

/** Staff activity entries per page. */
const ACTIVITY_PER_PAGE = 25;

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

/**
 * Staff activity for SUPER_ADMIN and ADMIN, newest first, 25 a page, optionally one `type` of action. It never returns
 * IP addresses, user agents or emails.
 */
export const getActivityLogs = async (req, res, next) => {
  try {
    const { type, page } = activityQuerySchema.parse(req.query);
    const actions = ACTIVITY_FILTERS[type];
    const where = actions ? { action: { in: actions } } : {};
    const result = await prisma.$transaction(async (db) => {
      const [total, rows] = await Promise.all([
        db.activityLog.count({ where }),
        db.activityLog.findMany({
          where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * ACTIVITY_PER_PAGE, take: ACTIVITY_PER_PAGE,
          select: {
            id: true, createdAt: true, action: true, targetType: true, targetId: true, details: true,
            admin: { select: { username: true, role: true } },
          },
        }),
      ]);
      return {
        entries: rows.map((row) => ({
          id: row.id, at: row.createdAt.toISOString(), action: row.action,
          targetType: row.targetType, targetId: row.targetId, details: row.details,
          staff: { username: row.admin.username, role: row.admin.role },
        })),
        pagination: { page, limit: ACTIVITY_PER_PAGE, pages: Math.ceil(total / ACTIVITY_PER_PAGE), total },
      };
    }, { isolationLevel: 'RepeatableRead' });
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const createInitialAdmin = (_req, res) => res.status(410).json({
  error: 'HTTP staff bootstrap is retired. Use the guarded initialization command with secure environment credentials.',
});

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

/** Records the verification emails actually sent, once the sends finish; nothing when none was sent. */
async function recordVerificationSends(adminId, results) {
  const sent = results.filter((result) => result.sent);
  if (!sent.length) return;
  await recordAfterSending(adminId, {
    action: ACTIVITY.CUSTOMER_VERIFICATION_SENT, targetType: 'customer',
    targetId: sent.length === 1 ? sent[0].userId : null,
    details: `${sent.length} ${sent.length === 1 ? 'customer' : 'customers'}`,
  });
}

export const sendVerificationToUser = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isDisabled) return res.status(400).json({ error: 'Cannot verify a disabled account' });
    const result = await sendUserVerification(user);
    await recordVerificationSends(req.admin.id, [result]);
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
    await recordVerificationSends(req.admin.id, results);
    res.json({ results });
  } catch (error) {
    next(error);
  }
};

export const setUserDisabled = async (req, res, next) => {
  try {
    const disabled = Boolean(req.body.disabled);
    const user = await prisma.$transaction(async (db) => {
      const updated = await db.user.update({
        where: { id: req.params.id },
        data: { isDisabled: disabled },
        select: { id: true, email: true, firstName: true, lastName: true, emailVerified: true, isDisabled: true, createdAt: true },
      });
      await recordActivity(db, req.admin.id, {
        action: disabled ? ACTIVITY.CUSTOMER_DISABLED : ACTIVITY.CUSTOMER_ENABLED, targetType: 'customer', targetId: updated.id,
      });
      return updated;
    });
    res.json(user);
  } catch (error) {
    next(error);
  }
};

export const deleteUser = async (req, res, next) => {
  try {
    const refused = await prisma.$transaction(async (db) => {
      const orders = await db.order.count({ where: { userId: req.params.id } });
      if (orders > 0) return 'Users with orders cannot be deleted. Disable the account instead to preserve order history.';
      const cart = await db.cart.findUnique({ where: { userId: req.params.id } });
      if (cart) await db.cartItem.deleteMany({ where: { cartId: cart.id } });
      await db.cart.deleteMany({ where: { userId: req.params.id } });
      await db.wishlist.deleteMany({ where: { userId: req.params.id } });
      await db.address.deleteMany({ where: { userId: req.params.id } });
      await db.passwordReset.deleteMany({ where: { userId: req.params.id } });
      await db.user.delete({ where: { id: req.params.id } });
      await recordActivity(db, req.admin.id, { action: ACTIVITY.CUSTOMER_DELETED, targetType: 'customer', targetId: req.params.id });
      return null;
    });
    if (refused) return res.status(400).json({ error: refused });
    res.json({ message: 'User deleted' });
  } catch (error) {
    next(error);
  }
};

export const importLocalOrders = (_req, res) => res.status(410).json({
  error: 'Legacy browser receipts cannot be imported into the fresh store.',
});
