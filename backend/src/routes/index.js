import express from 'express';
import cors from '../config/cors.js';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { generalLimiter } from '../config/rateLimiter.js';
import { errorHandler, notFound } from '../middleware/errorHandler.js';

import authRoutes from './authRoutes.js';
import productRoutes from './productRoutes.js';
import categoryRoutes from './categoryRoutes.js';
import designerRoutes from './designerRoutes.js';
import cartRoutes from './cartRoutes.js';
import wishlistRoutes from './wishlistRoutes.js';
import orderRoutes from './orderRoutes.js';
import stockRoutes from './stockRoutes.js';
import discountRoutes from './discountRoutes.js';
import analyticsRoutes from './analyticsRoutes.js';
import adminRoutes from './admin.js';
import contactRoutes from './contactRoutes.js';
import mpesaRoutes from './mpesaRoutes.js';
import settingsRoutes from './settingsRoutes.js';
import subscriptionRoutes from './subscriptionRoutes.js';
import { getCatalog, getAdminCatalog, createMedia } from '../controllers/productController.js';
import { authenticateAdmin, authorize } from '../middleware/adminAuth.js';

const router = express.Router();

// Security middleware
router.use(helmet());
router.use(cors);
router.use(compression());

// Logging
if (process.env.NODE_ENV !== 'test') {
  router.use(morgan('combined', { skip: (req) => req.path.toLowerCase().startsWith('/mpesa') }));
}

// Rate limiting
router.use((req, res, next) => req.path.toLowerCase().startsWith('/mpesa/callback') ? next() : generalLimiter(req, res, next));

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
router.get('/catalog', getCatalog);
router.get('/admin/catalog', authenticateAdmin, getAdminCatalog);
router.post('/media', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), createMedia);
router.use('/auth', authRoutes);
router.use('/products', productRoutes);
router.use('/categories', categoryRoutes);
router.use('/designers', designerRoutes);
router.use('/cart', cartRoutes);
router.use('/wishlist', wishlistRoutes);
router.use('/orders', orderRoutes);
router.use('/subscriptions', subscriptionRoutes);
router.use('/contact', contactRoutes);
router.use('/mpesa', mpesaRoutes);
router.use('/settings', settingsRoutes);
router.use('/admin/stock', stockRoutes);
router.use('/admin/discounts', discountRoutes);
router.use('/admin/analytics', analyticsRoutes);
router.use('/admin', adminRoutes);

// Error handling
router.use(notFound);
router.use(errorHandler);

export default router;
