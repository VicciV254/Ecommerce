import express from 'express';
import {
  getDashboardMetrics,
  getInventoryBreakdown,
  getSalesReport,
  getCategoryPerformance,
  getCustomerInsights,
} from '../controllers/analyticsController.js';
import { authenticateAdmin, authorize } from '../middleware/adminAuth.js';

const router = express.Router();

router.use(authenticateAdmin);

router.get('/dashboard', authorize('SUPER_ADMIN', 'ADMIN', 'VIEWER'), getDashboardMetrics);
router.get('/inventory', authorize('SUPER_ADMIN', 'ADMIN', 'VIEWER'), getInventoryBreakdown);
router.get('/sales', authorize('SUPER_ADMIN', 'ADMIN', 'VIEWER'), getSalesReport);
router.get('/categories', authorize('SUPER_ADMIN', 'ADMIN', 'VIEWER'), getCategoryPerformance);
router.get('/customers', authorize('SUPER_ADMIN', 'ADMIN', 'VIEWER'), getCustomerInsights);

export default router;
