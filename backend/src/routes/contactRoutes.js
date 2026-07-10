import express from 'express';
import { sendContactMessage } from '../controllers/contactController.js';
import { authLimiter } from '../config/rateLimiter.js';

const router = express.Router();

router.post('/', authLimiter, sendContactMessage);

export default router;
