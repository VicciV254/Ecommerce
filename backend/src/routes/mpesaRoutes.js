import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { authenticateAdmin, authorize } from '../middleware/adminAuth.js';
import { getOrderPayments, getPaymentStatus, initiateStkPush, paymentErrorHandler, queryPaymentStatus } from '../controllers/mpesaController.js';

const router = express.Router();

router.get('/admin/orders/:orderId/payments', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN', 'VIEWER'), getOrderPayments);
router.post('/admin/payments/:id/query', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), queryPaymentStatus);
router.post('/stk-push', authenticate, initiateStkPush);
router.get('/orders/:orderId/payments', authenticate, getOrderPayments);
router.get('/payments/:id', authenticate, getPaymentStatus);
router.post('/payments/:id/query', authenticate, queryPaymentStatus);
router.use(paymentErrorHandler);

export default router;
