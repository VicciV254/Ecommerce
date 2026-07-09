import express from 'express';
import {
  getCart,
  addToCart,
  updateCartItem,
  removeCartItem,
  clearCart,
  applyCoupon,
  removeCoupon,
} from '../controllers/cartController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

router.get('/', getCart);
router.post('/items', addToCart);
router.put('/items/:id', updateCartItem);
router.delete('/items/:id', removeCartItem);
router.delete('/', clearCart);
router.post('/coupon', applyCoupon);
router.delete('/coupon', removeCoupon);

export default router;
