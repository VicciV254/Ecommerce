import express from 'express';
import {
  getAllCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../controllers/categoryController.js';
import { optionalAuth } from '../middleware/auth.js';
import { authenticateAdmin, authorize } from '../middleware/adminAuth.js';

const router = express.Router();

// Public routes
router.get('/', optionalAuth, getAllCategories);
router.get('/:id', optionalAuth, getCategoryById);

// Admin routes
router.post('/', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), createCategory);
router.put('/:id', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), updateCategory);
router.delete('/:id', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), deleteCategory);

export default router;
