import express from 'express';
import { assertMatchingLocalDatabases } from './config/databaseSafety.js';
import callbackRoutes from './routes/mpesaCallbackRoutes.js';
import { startServer } from './server.js';

export function assertSandboxCallbackConfig(env = process.env) {
  if (!['development', 'test'].includes(env.NODE_ENV) ||
    env.ENABLE_SANDBOX_CALLBACK !== 'true' || env.MPESA_ENVIRONMENT !== 'sandbox' ||
    env.MPESA_LIVE_PAYMENTS_ENABLED !== 'false' || env.BACKGROUND_JOBS_ENABLED !== 'false') {
    throw new Error('The callback-only listener requires explicit local sandbox mode, disabled live payments and disabled jobs.');
  }
  assertMatchingLocalDatabases(env);
  const port = Number(env.SANDBOX_CALLBACK_PORT || '4285');
  if (port === 0 && env.NODE_ENV === 'test') return port;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('SANDBOX_CALLBACK_PORT must be an unprivileged TCP port.');
  return port;
}

export function createSandboxCallbackApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api/mpesa/callback', callbackRoutes);
  app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
  return app;
}

export async function startSandboxCallback() {
  const port = assertSandboxCallbackConfig();
  return startServer({ host: '127.0.0.1', port, application: createSandboxCallbackApp() });
}
