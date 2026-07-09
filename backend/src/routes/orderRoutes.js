import express from 'express';
import {
  createOrder,
  getUserOrders,
  getOrderById,
  cancelOrder,
  pickupOrder,
  returnOrder,
  trackOrder,
  getAllOrders,
  updateOrderStatus,
  createCheckoutOrder,
} from '../controllers/orderController.js';
import { authenticate } from '../middleware/auth.js';
import { authenticateAdmin, authorize } from '../middleware/adminAuth.js';

const router = express.Router();

// Public route
router.get('/track/:number', trackOrder);

// Admin routes
router.get('/admin/all', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN', 'VIEWER'), getAllOrders);
router.put('/admin/:id/status', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), updateOrderStatus);

// Customer routes
router.use(authenticate);
router.post('/checkout', createCheckoutOrder);
router.post('/', createOrder);
router.get('/', getUserOrders);
router.get('/:id', getOrderById);
router.post('/:id/cancel', cancelOrder);
router.post('/:id/pickup', pickupOrder);
router.post('/:id/return', returnOrder);

export default router;
