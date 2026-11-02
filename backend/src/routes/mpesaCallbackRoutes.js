import express from 'express';
import helmet from 'helmet';
import { mpesaCallbackLimiter } from '../config/rateLimiter.js';
import { mpesaCallback, paymentErrorHandler } from '../controllers/mpesaController.js';

const router = express.Router();
router.use(helmet());
router.use(mpesaCallbackLimiter);
router.use((req, res, next) => {
  if (req.method === 'POST' && !req.is('application/json')) {
    return res.status(415).json({ error: 'Callbacks require JSON.', code: 'CALLBACK_BODY_INVALID' });
  }
  next();
});
router.use(express.json({ limit: '32kb' }));
router.use((error, _req, res, _next) => {
  console.warn('M-Pesa callback body rejected', { code: 'CALLBACK_BODY_INVALID' });
  res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'Invalid callback body.', code: 'CALLBACK_BODY_INVALID' });
});
router.post('/', (_req, res) => res.status(503).json({ error: 'Uncorrelated M-Pesa callbacks are not accepted.' }));
router.post('/:id/:key', mpesaCallback);
router.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
router.use(paymentErrorHandler);

export default router;
