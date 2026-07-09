import express from 'express';
import {
  register,
  login,
  getMe,
  updateProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  refresh,
  verifyEmail,
  verifyOtp,
  resendVerification,
  logout,
  addAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
} from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { authLimiter } from '../config/rateLimiter.js';

const router = express.Router();

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/refresh', refresh);
router.post('/verify-email', verifyEmail);
router.post('/verify-otp', verifyOtp);
router.post('/resend-verification', authLimiter, resendVerification);
router.post('/logout', logout);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

router.get('/me', authenticate, getMe);
router.put('/profile', authenticate, updateProfile);
router.put('/password', authenticate, changePassword);
router.post('/addresses', authenticate, addAddress);
router.put('/addresses/:id', authenticate, updateAddress);
router.delete('/addresses/:id', authenticate, deleteAddress);
router.put('/addresses/:id/default', authenticate, setDefaultAddress);

export default router;
