import './config/environment.js';
import express from 'express';
import routes from './routes/index.js';
import { moneyJsonReplacer } from './utils/money.js';

const app = express();
app.set('json replacer', moneyJsonReplacer);

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// API routes
app.use('/api', routes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'No Maneno Bazaar API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      products: '/api/products',
      categories: '/api/categories',
      designers: '/api/designers',
      cart: '/api/cart',
      wishlist: '/api/wishlist',
      orders: '/api/orders',
      admin: '/api/admin',
    },
  });
});

export default app;
