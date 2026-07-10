import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { getPaymentStatus, initiateStkPush, mpesaCallback, queryPaymentStatus } from '../controllers/mpesaController.js';

const router = express.Router();

router.post('/callback', mpesaCallback);
router.post('/stk-push', authenticate, initiateStkPush);
router.get('/payments/:checkoutRequestId', authenticate, getPaymentStatus);
router.post('/payments/:checkoutRequestId/query', authenticate, queryPaymentStatus);

export default router;
