import express from 'express';
import {
  subscribe,
  unsubscribe,
  getAllSubscriptions,
  sendPromotionalEmail,
  deleteSubscription,
} from '../controllers/subscriptionController.js';
import { authenticateAdmin, authorize } from '../middleware/adminAuth.js';

const router = express.Router();

// Public routes
router.post('/subscribe', subscribe);
router.post('/unsubscribe', unsubscribe);

// Admin routes
router.get('/admin/all', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), getAllSubscriptions);
router.post('/admin/send-promotional', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), sendPromotionalEmail);
router.delete('/admin/:id', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), deleteSubscription);

export default router;
