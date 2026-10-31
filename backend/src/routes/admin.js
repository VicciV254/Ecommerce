import express from 'express';
import {
  adminLogin,
  getAdminMe,
  getActivityLogs,
  createInitialAdmin,
  getUsers,
  sendVerificationToUser,
  sendVerificationToUsers,
  setUserDisabled,
  deleteUser,
  importLocalOrders,
} from '../controllers/adminController.js';
import { authenticateAdmin, authorize } from '../middleware/adminAuth.js';
import { authLimiter } from '../config/rateLimiter.js';

const router = express.Router();

router.post('/login', authLimiter, adminLogin);
router.post('/init', createInitialAdmin);

router.use(authenticateAdmin);
router.get('/me', getAdminMe);
router.get('/activity', getActivityLogs);
router.get('/users', getUsers);
router.post('/users/verify', authorize('SUPER_ADMIN', 'ADMIN'), sendVerificationToUsers);
router.post('/users/:id/verify', authorize('SUPER_ADMIN', 'ADMIN'), sendVerificationToUser);
router.put('/users/:id/disabled', authorize('SUPER_ADMIN', 'ADMIN'), setUserDisabled);
router.delete('/users/:id', authorize('SUPER_ADMIN', 'ADMIN'), deleteUser);
router.post('/orders/import-local', importLocalOrders);

export default router;
