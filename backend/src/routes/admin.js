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
import { authenticateAdmin } from '../middleware/adminAuth.js';
import { authLimiter } from '../config/rateLimiter.js';

const router = express.Router();

router.post('/login', authLimiter, adminLogin);
router.post('/init', createInitialAdmin);

router.use(authenticateAdmin);
router.get('/me', getAdminMe);
router.get('/activity', getActivityLogs);
router.get('/users', getUsers);
router.post('/users/verify', sendVerificationToUsers);
router.post('/users/:id/verify', sendVerificationToUser);
router.put('/users/:id/disabled', setUserDisabled);
router.delete('/users/:id', deleteUser);
router.post('/orders/import-local', importLocalOrders);

export default router;
