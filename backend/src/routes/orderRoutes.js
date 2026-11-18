import express from 'express';
import {
  applyOrderAction,
  applyOrderDemonstrationAction,
  applyRefundAction,
  approveOrderDemonstrationReturn,
  cancelOrder,
  cancelOrderReturn,
  completeOrderDemonstrationRefund,
  createCheckoutOrder,
  createOrder,
  createPaymentRefund,
  decideOrderReturn,
  getAllOrders,
  getCheckoutQuote,
  getOrderById,
  getRefunds,
  getReturns,
  getStaffOrder,
  getUserOrders,
  payWithDemonstrationPayment,
  quoteOrder,
  receiveOrderDemonstrationReturn,
  receiveOrderReturn,
  requestOrderRefund,
  requestOrderReturn,
  trackOrder,
} from '../controllers/orderController.js';
import { authenticate } from '../middleware/auth.js';
import { authenticateAdmin, authorize } from '../middleware/adminAuth.js';

const router = express.Router();
const staffRead = [authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN', 'VIEWER')];
const staffWrite = [authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN')];

// Public route
router.get('/track/:number', trackOrder);

// Staff routes
router.get('/admin/all', ...staffRead, getAllOrders);
router.get('/admin/returns', ...staffRead, getReturns);
router.get('/admin/refunds', ...staffRead, getRefunds);
router.get('/admin/:id', ...staffRead, getStaffOrder);
router.post('/admin/:id/actions', ...staffWrite, applyOrderAction);
router.post('/admin/:id/refunds', ...staffWrite, requestOrderRefund);
router.post('/admin/returns/:returnId/decision', ...staffWrite, decideOrderReturn);
router.post('/admin/returns/:returnId/receive', ...staffWrite, receiveOrderReturn);
router.post('/admin/refunds/:refundId/:action', ...staffWrite, applyRefundAction);
router.post('/admin/payments/:paymentId/refunds', ...staffWrite, createPaymentRefund);

// Customer routes
router.use(authenticate);
router.post('/quotes', quoteOrder);
router.get('/quotes/:id', getCheckoutQuote);
router.post('/checkout', createCheckoutOrder);
router.post('/', createOrder);
router.get('/', getUserOrders);
router.get('/:id', getOrderById);
router.post('/:id/cancel', cancelOrder);
router.post('/:id/demonstration-payment', payWithDemonstrationPayment);
router.post('/:id/demonstration-actions', applyOrderDemonstrationAction);
router.post('/:id/returns', requestOrderReturn);
router.post('/:id/returns/:returnId/cancel', cancelOrderReturn);
router.post('/:id/returns/:returnId/demonstration-approve', approveOrderDemonstrationReturn);
router.post('/:id/returns/:returnId/demonstration-receive', receiveOrderDemonstrationReturn);
router.post('/:id/refunds/:refundId/demonstration-complete', completeOrderDemonstrationRefund);

export default router;
