import express from 'express';
import {
  getAllDesigners,
  getDesignerById,
  createDesigner,
  updateDesigner,
  deleteDesigner,
} from '../controllers/designerController.js';
import { optionalAuth } from '../middleware/auth.js';
import { authenticateAdmin, authorize } from '../middleware/adminAuth.js';

const router = express.Router();

// Public routes
router.get('/', optionalAuth, getAllDesigners);
router.get('/:id', optionalAuth, getDesignerById);

// Admin routes
router.post('/', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), createDesigner);
router.put('/:id', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), updateDesigner);
router.delete('/:id', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), deleteDesigner);

export default router;
