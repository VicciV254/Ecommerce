import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../config/database.js';
import { generateToken, generateRefreshToken, verifyRefreshToken } from '../config/auth.js';
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema, changePasswordSchema, addressSchema } from '../utils/validators.js';
import { sendOtpVerificationEmail, sendVerificationEmail } from '../services/mailService.js';

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 10);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function issueVerificationOtp(user) {
  const otp = generateOtp();
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      otpCode: otp,
      otpExpiresAt: new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000),
      otpAttempts: 0,
      otpLastSentAt: new Date(),
      emailVerifyToken: null,
      emailVerifyExpires: null,
    },
    select: { id: true, email: true, firstName: true },
  });

  const sent = await sendOtpVerificationEmail(updated, otp).catch((error) => {
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
    
    // Create user
    const user = await prisma.user.create({
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
      },
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
        error: 'Please verify your email with the OTP code we sent before signing in',
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
        createdAt: true,
        updatedAt: true,
        addresses: {
          select: {
            id: true,
            street: true,
            city: true,
            county: true,
            postalCode: true,
            isDefault: true,
          },
        },
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

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    const decoded = verifyRefreshToken(refreshToken);

    if (!decoded?.userId) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
      },
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

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
      return res.status(400).json({ error: 'Email and OTP code are required' });
    }

    const normalizedCode = String(code).replace(/\D/g, '');
    if (normalizedCode.length !== 6) {
      return res.status(400).json({ error: 'Enter the 6-digit OTP code' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.emailVerified) {
      return res.json({ message: 'Email already verified' });
    }
    if (!user.otpCode || !user.otpExpiresAt) {
      return res.status(400).json({ error: 'No OTP found. Request a new code.' });
    }
    if (user.otpExpiresAt < new Date()) {
      return res.status(400).json({ error: 'OTP expired. Request a new code.' });
    }
    if ((user.otpAttempts || 0) >= OTP_MAX_ATTEMPTS) {
      return res.status(400).json({ error: 'Too many failed attempts. Request a new code.' });
    }
    if (user.otpCode !== normalizedCode) {
      const attempts = (user.otpAttempts || 0) + 1;
      await prisma.user.update({ where: { id: user.id }, data: { otpAttempts: attempts } });
      return res.status(400).json({ error: `Invalid OTP. ${Math.max(OTP_MAX_ATTEMPTS - attempts, 0)} attempt(s) remaining.` });
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

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerified) {
      return res.json({ message: 'If verification is needed, a new email has been sent' });
    }

    const sent = await issueVerificationOtp(user);
    res.json({
      message: sent
        ? 'If verification is needed, a new OTP has been sent'
        : 'Verification OTP could not be sent. Check email settings.',
      verificationEmailSent: sent,
    });
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
    const { firstName, lastName, phone, profileImage, promotionalEmails } = req.body;
    
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        firstName,
        lastName,
        phone,
        profileImage,
        ...(promotionalEmails !== undefined && { promotionalEmails }),
      },
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
    
    // Handle subscription sync
    if (promotionalEmails !== undefined) {
      if (promotionalEmails) {
        // Add to subscription if enabled
        await prisma.subscription.upsert({
          where: { email: user.email },
          update: { isActive: true },
          create: { email: user.email, isActive: true },
        });
      } else {
        // Deactivate subscription if disabled
        await prisma.subscription.updateMany({
          where: { email: user.email },
          data: { isActive: false },
        });
      }
    }
    
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

export const forgotPassword = async (req, res, next) => {
  try {
    const validatedData = forgotPasswordSchema.parse(req.body);
    
    const user = await prisma.user.findUnique({
      where: { email: validatedData.email },
    });
    
    if (!user) {
      // Don't reveal if email exists or not
      return res.json({ message: 'If the email exists, a reset link will be sent' });
    }
    
    // Generate reset token
    const resetToken = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    const expiresAt = new Date(Date.now() + 3600000); // 1 hour
    
    // Delete any existing reset token
    await prisma.passwordReset.deleteMany({
      where: { userId: user.id },
    });
    
    // Create password reset record
    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        token: resetToken,
        expiresAt,
      },
    });
    
    // TODO: Send email with reset link
    // For now, return the token (in production, this should be sent via email)
    res.json({ 
      message: 'If the email exists, a reset link will be sent',
      token: resetToken, // Remove this in production
    });
  } catch (error) {
    next(error);
  }
};

export const resetPassword = async (req, res, next) => {
  try {
    const validatedData = resetPasswordSchema.parse(req.body);
    
    const passwordReset = await prisma.passwordReset.findUnique({
      where: { token: validatedData.token },
      include: { user: true },
    });
    
    if (!passwordReset || passwordReset.usedAt || new Date(passwordReset.expiresAt) < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(validatedData.password, 10);
    
    // Update user password
    await prisma.user.update({
      where: { id: passwordReset.userId },
      data: { password: hashedPassword },
    });
    
    // Mark token as used
    await prisma.passwordReset.update({
      where: { id: passwordReset.id },
      data: { usedAt: new Date() },
    });
    
    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    next(error);
  }
};

