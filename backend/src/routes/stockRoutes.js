import express from 'express';
import {
  getAllStock,
  getLowStock,
  getProductStock,
  updateStock,
  bulkUpdateStock,
  getStockHistory,
  restockProduct,
} from '../controllers/stockController.js';
import { authenticateAdmin, authorize } from '../middleware/adminAuth.js';

const router = express.Router();

router.use(authenticateAdmin);

router.get('/', authorize('SUPER_ADMIN', 'ADMIN', 'VIEWER'), getAllStock);
router.get('/low', authorize('SUPER_ADMIN', 'ADMIN', 'VIEWER'), getLowStock);
router.get('/:variantId', authorize('SUPER_ADMIN', 'ADMIN', 'VIEWER'), getProductStock);
router.get('/:variantId/history', authorize('SUPER_ADMIN', 'ADMIN', 'VIEWER'), getStockHistory);
router.put('/:variantId', authorize('SUPER_ADMIN', 'ADMIN'), updateStock);
router.post('/bulk', authorize('SUPER_ADMIN', 'ADMIN'), bulkUpdateStock);
router.post('/:variantId/restock', authorize('SUPER_ADMIN', 'ADMIN'), restockProduct);

export default router;
