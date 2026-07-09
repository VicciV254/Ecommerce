import express from 'express';
import {
  getAllDiscounts,
  getActiveDiscounts,
  createDiscount,
  updateDiscount,
  deleteDiscount,
} from '../controllers/discountController.js';
import { optionalAuth } from '../middleware/auth.js';
import { authenticateAdmin, authorize } from '../middleware/adminAuth.js';

const router = express.Router();

// Public routes
router.get('/active', optionalAuth, getActiveDiscounts);

// Admin routes
router.get('/', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN', 'VIEWER'), getAllDiscounts);
router.post('/', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), createDiscount);
router.put('/:id', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), updateDiscount);
router.delete('/:id', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), deleteDiscount);

export default router;
