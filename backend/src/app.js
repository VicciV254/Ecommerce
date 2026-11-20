import './config/environment.js';
import express from 'express';
import routes from './routes/index.js';
import { moneyJsonReplacer } from './utils/money.js';
import callbackRoutes from './routes/mpesaCallbackRoutes.js';
import { requestBodyErrorHandler } from './middleware/errorHandler.js';
import { trustedProxyHops } from './config/proxy.js';
import { deploymentDatabaseGuard } from './config/deploymentDatabase.js';

const app = express();
app.set('json replacer', moneyJsonReplacer);
// The rate limits count by `req.ip`: behind a proxy it must be the client's address, not the proxy's.
app.set('trust proxy', trustedProxyHops());
// A development deployment answers nothing until it is verified on its approved database and restricted role.
app.use(deploymentDatabaseGuard());

// Body parser
app.use('/api/mpesa/callback', callbackRoutes);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(requestBodyErrorHandler);

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
