import express from 'express';
import { getAdminData, getTheme, publishAdminData, publishTheme } from '../controllers/settingsController.js';
import { authenticateAdmin, authorize } from '../middleware/adminAuth.js';

const router = express.Router();

router.get('/admin-data', getAdminData);
router.put('/admin-data', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), publishAdminData);
router.get('/theme', getTheme);
router.put('/theme', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), publishTheme);

export default router;
