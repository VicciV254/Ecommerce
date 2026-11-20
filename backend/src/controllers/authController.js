import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import prisma from '../config/database.js';
import { generateToken, generateRefreshToken, isCustomerToken, verifyRefreshToken } from '../config/auth.js';
import { registerSchema, loginSchema, changePasswordSchema, addressSchema, profileSchema } from '../utils/validators.js';
import { isMailConfigured, sendOtpVerificationEmail } from '../services/mailService.js';
import { httpError } from '../services/catalogService.js';
import {
  activateSubscription, canonicalEmail, lockAddress, sanitizedFailure, syncPromotionalPreference,
} from '../services/subscriptionService.js';
import { addressSummarySelect, userAccessError, userSessionSelect } from '../utils/account.js';

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 10);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);
/** What sign-up and profile saves answer for an unexpected failure, as before; the database's own error never leaves. */
const internalError = () => httpError(500, 'Internal server error');

function generateOtp() {
  return randomInt(100000, 1000000).toString();
}

/** While the last code is valid and was sent this recently, asking again sends nothing and gives no fresh attempts. */
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * Issues and emails a new code, unless the account's current code is still valid and under a minute old. The check and
 * the write are one conditional update, so neither a caller's partial record nor two requests at once get round it.
 */
async function issueVerificationOtp(user) {
  const now = new Date();
  const otp = generateOtp();
  const issued = await prisma.user.updateMany({
    where: {
      id: user.id,
      OR: [
        { otpCode: null }, { otpExpiresAt: null }, { otpExpiresAt: { lte: now } },
        { otpLastSentAt: null }, { otpLastSentAt: { lte: new Date(now.getTime() - OTP_RESEND_COOLDOWN_MS) } },
      ],
    },
    data: {
      otpCode: otp,
      otpExpiresAt: new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000),
      otpAttempts: 0,
      otpLastSentAt: now,
      emailVerifyToken: null,
      emailVerifyExpires: null,
    },
  });
  if (!issued.count) return false;

  const sent = await sendOtpVerificationEmail({ id: user.id, email: user.email, firstName: user.firstName }, otp).catch((error) => {
    console.error('OTP verification email failed:', error.message);
    return false;
  });

  return sent;
}

export const register = async (req, res, next) => {
  try {
    const validatedData = registerSchema.parse(req.body);
    
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: validatedData.email },
    });
    
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(validatedData.password, 10);
    const emailVerificationEnabled = process.env.ENABLE_EMAIL_VERIFICATION === 'true';
    
    // Create the account and record its sign-up consent in one transaction; the account then shows the subscription list.
    const user = await prisma.$transaction(async (db) => {
      const email = canonicalEmail(validatedData.email);
      await lockAddress(db, email);
      const created = await db.user.create({
        data: {
          email: validatedData.email,
          password: hashedPassword,
          firstName: validatedData.firstName,
          lastName: validatedData.lastName,
          phone: validatedData.phone,
          emailVerified: emailVerificationEnabled ? false : true,
          emailVerifyToken: null,
          emailVerifyExpires: null,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          profileImage: true,
          emailVerified: true,
          createdAt: true,
          addresses: { select: addressSummarySelect },
        },
      });
      if (validatedData.promotionalEmails) await activateSubscription(db, email);
      return { ...created, promotionalEmails: await syncPromotionalPreference(db, email) };
    }).catch((error) => {
      // Another sign-up with this address won the race; answer as the check above does.
      if (error.code === 'P2002') throw httpError(400, 'Email already registered');
      throw sanitizedFailure(error, internalError);
    });

    let verificationEmailSent = false;
    if (emailVerificationEnabled) {
      verificationEmailSent = await issueVerificationOtp(user);
    }
    
    // Generate tokens
    const token = generateToken({ userId: user.id });
    const refreshToken = generateRefreshToken({ userId: user.id });
    
    res.status(201).json({
      user,
      token,
      refreshToken,
      verificationEmailSent,
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (req, res, next) => {
  try {
    const validatedData = loginSchema.parse(req.body);
    
    // Find user
    const user = await prisma.user.findUnique({
      where: { email: validatedData.email },
      select: { ...userSessionSelect, password: true, promotionalEmails: true, addresses: { select: addressSummarySelect } },
    });
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check password
    const isPasswordValid = await bcrypt.compare(validatedData.password, user.password);
    
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.isDisabled) {
      return res.status(403).json({ error: 'This account has been disabled. Please contact support.' });
    }

    const emailVerified = user.emailVerified;
    if (process.env.ENABLE_EMAIL_VERIFICATION === 'true' && !emailVerified) {
      await issueVerificationOtp(user);
      return res.status(403).json({
        error: 'Please verify your email with the code we sent before signing in',
        requiresOtp: true,
        email: user.email,
      });
    }
    
    // Generate tokens
    const token = generateToken({ userId: user.id });
    const refreshToken = generateRefreshToken({ userId: user.id });
    
    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        profileImage: user.profileImage,
        emailVerified,
        promotionalEmails: user.promotionalEmails,
        addresses: user.addresses,
      },
      token,
      refreshToken,
    });
  } catch (error) {
    next(error);
  }
};

export const getMe = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        profileImage: true,
        emailVerified: true,
        promotionalEmails: true,
        createdAt: true,
        updatedAt: true,
        addresses: { select: addressSummarySelect },
      },
    });
    
    res.json(user);
  } catch (error) {
    next(error);
  }
};

export const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (typeof refreshToken !== 'string' || !refreshToken || refreshToken.length > 4096) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    const decoded = verifyRefreshToken(refreshToken);

    if (!isCustomerToken(decoded)) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: userSessionSelect,
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const denied = userAccessError(user);
    if (denied) return res.status(403).json(denied);

    res.json({
      token: generateToken({ userId: user.id }),
      refreshToken: generateRefreshToken({ userId: user.id }),
    });
  } catch (error) {
    next(error);
  }
};

export const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Verification token is required' });
    }

    const user = await prisma.user.findUnique({ where: { emailVerifyToken: token } });

    if (!user || !user.emailVerifyExpires || user.emailVerifyExpires < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerifyToken: null,
        emailVerifyExpires: null,
      },
    });

    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    next(error);
  }
};

export const verifyOtp = async (req, res, next) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: 'Email and verification code are required' });
    }

    const normalizedCode = String(code).replace(/\D/g, '');
    if (normalizedCode.length !== 6) {
      return res.status(400).json({ error: 'Enter the 6-digit verification code' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    // An unknown address, a verified account and one without a code get one answer, so it doesn't say which exist.
    if (!user || user.emailVerified || !user.otpCode || !user.otpExpiresAt) {
      return res.status(400).json({ error: "There's no active code for this email. Request a new code, or sign in if your email is already verified." });
    }
    if (user.otpExpiresAt < new Date()) {
      return res.status(400).json({ error: 'Verification code expired. Request a new code.' });
    }
    if ((user.otpAttempts || 0) >= OTP_MAX_ATTEMPTS) {
      return res.status(400).json({ error: 'Too many failed attempts. Request a new code.' });
    }
    if (user.otpCode !== normalizedCode) {
      const attempts = (user.otpAttempts || 0) + 1;
      await prisma.user.update({ where: { id: user.id }, data: { otpAttempts: attempts } });
      const remaining = Math.max(OTP_MAX_ATTEMPTS - attempts, 0);
      return res.status(400).json({ error: `Invalid verification code. ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} remaining.` });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerifyToken: null,
        emailVerifyExpires: null,
        otpCode: null,
        otpExpiresAt: null,
        otpAttempts: 0,
      },
    });

    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    next(error);
  }
};

export const resendVerification = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    // Whether mail can be sent at all is the store's setting, not the account's, so anyone may be told.
    if (!isMailConfigured()) {
      return res.status(503).json({ error: 'Email delivery is not configured.', code: 'MAIL_NOT_CONFIGURED' });
    }
    // One answer whoever asks; only an account that needs verification is sent a code (a failed send is logged).
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerified) await issueVerificationOtp(user);
    res.json({ message: 'If this email needs verification, a new code has been sent.' });
  } catch (error) {
    next(error);
  }
};

export const logout = async (req, res) => {
  res.json({ message: 'Logged out successfully' });
};

export const addAddress = async (req, res, next) => {
  try {
    const validatedData = addressSchema.parse(req.body);

    if (validatedData.isDefault) {
      await prisma.address.updateMany({
        where: { userId: req.user.id },
        data: { isDefault: false },
      });
    }

    const address = await prisma.address.create({
      data: {
        ...validatedData,
        userId: req.user.id,
      },
    });

    res.status(201).json(address);
  } catch (error) {
    next(error);
  }
};

export const updateAddress = async (req, res, next) => {
  try {
    const validatedData = addressSchema.partial().parse(req.body);
    const { id } = req.params;

    const existing = await prisma.address.findUnique({ where: { id } });
    if (!existing || existing.userId !== req.user.id) {
      return res.status(404).json({ error: 'Address not found' });
    }

    if (validatedData.isDefault) {
      await prisma.address.updateMany({
        where: { userId: req.user.id },
        data: { isDefault: false },
      });
    }

    const address = await prisma.address.update({
      where: { id },
      data: validatedData,
    });

    res.json(address);
  } catch (error) {
    next(error);
  }
};

export const deleteAddress = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await prisma.address.findUnique({ 
      where: { id },
      include: { orders: true }
    });
    
    if (!existing || existing.userId !== req.user.id) {
      return res.status(404).json({ error: 'Address not found' });
    }

    // Check if address has associated orders
    if (existing.orders && existing.orders.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete address with associated orders. This address is linked to your order history.' 
      });
    }

    await prisma.address.delete({ where: { id } });
    res.json({ message: 'Address deleted successfully' });
  } catch (error) {
    console.error('Delete address error:', error);
    next(error);
  }
};

export const setDefaultAddress = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await prisma.address.findUnique({ where: { id } });
    if (!existing || existing.userId !== req.user.id) {
      return res.status(404).json({ error: 'Address not found' });
    }

    await prisma.address.updateMany({
      where: { userId: req.user.id },
      data: { isDefault: false },
    });

    const address = await prisma.address.update({
      where: { id },
      data: { isDefault: true },
    });

    res.json(address);
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (req, res, next) => {
  try {
    const { promotionalEmails } = req.body;
    if (promotionalEmails !== undefined && typeof promotionalEmails !== 'boolean') {
      return res.status(400).json({ error: 'promotionalEmails must be true or false' });
    }
    const { firstName, lastName, phone, profileImage } = profileSchema.parse(req.body);

    // The preference follows the subscription list: subscribe or unsubscribe the address, then show what is sent. The
    // subscription is written before any account, the order every preference writer uses, so two writers never deadlock.
    const user = await prisma.$transaction(async (db) => {
      if (promotionalEmails !== undefined) {
        const email = canonicalEmail(req.user.email);
        await lockAddress(db, email);
        if (promotionalEmails) await activateSubscription(db, email);
        else await db.subscription.updateMany({ where: { email }, data: { isActive: false } });
        await syncPromotionalPreference(db, email);
      }
      return db.user.update({
        where: { id: req.user.id },
        data: { firstName, lastName, phone, profileImage },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          profileImage: true,
          emailVerified: true,
          promotionalEmails: true,
          updatedAt: true,
        },
      });
    }).catch((error) => { throw sanitizedFailure(error, internalError); });

    res.json(user);
  } catch (error) {
    next(error);
  }
};

export const changePassword = async (req, res, next) => {
  try {
    const validatedData = changePasswordSchema.parse(req.body);
    
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
    });
    
    // Check current password
    const isPasswordValid = await bcrypt.compare(validatedData.currentPassword, user.password);
    
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(validatedData.newPassword, 10);
    
    await prisma.user.update({
      where: { id: req.user.id },
      data: { password: hashedPassword },
    });
    
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    next(error);
  }
};
