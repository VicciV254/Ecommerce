import express from 'express';
import { getStorefront, getStorefrontDraft, saveStorefrontDraft, publishStorefront, retiredSettings } from '../controllers/settingsController.js';
import { authenticateAdmin, authorize } from '../middleware/adminAuth.js';

const router = express.Router();
router.get('/storefront', getStorefront);
router.get('/storefront/draft', authenticateAdmin, getStorefrontDraft);
router.put('/storefront/draft', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), saveStorefrontDraft);
router.post('/storefront/publish', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), publishStorefront);
router.get('/admin-data', retiredSettings);
router.put('/admin-data', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), retiredSettings);
router.get('/theme', retiredSettings);
router.put('/theme', authenticateAdmin, authorize('SUPER_ADMIN', 'ADMIN'), retiredSettings);
export default router;
