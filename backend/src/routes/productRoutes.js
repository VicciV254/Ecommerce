import express from 'express';
import {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  searchProducts,
  getFeaturedProducts,
  getRecentProducts,
  getAllTags,
} from '../controllers/productController.js';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { authenticateAdmin, authorize } from '../middleware/adminAuth.js';
import { uploadProductImages } from '../middleware/upload.js';

const router = express.Router();

// Public routes
router.get('/', optionalAuth, getAllProducts);
router.get('/search', optionalAuth, searchProducts);
router.get('/featured', optionalAuth, getFeaturedProducts);
router.get('/recent', optionalAuth, getRecentProducts);
router.get('/tags', getAllTags);
router.get('/:id', optionalAuth, getProductById);

// Admin routes
router.post('/', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), uploadProductImages, createProduct);
router.put('/:id', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), uploadProductImages, updateProduct);
router.delete('/:id', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), deleteProduct);

export default router;
