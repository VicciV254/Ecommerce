import './config/environment.js';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import app from './app.js';
import prisma from './config/database.js';
import { startBackgroundJobs } from './services/backgroundJobs.js';
import { assertAuthConfigured } from './config/auth.js';

export async function startServer({
  port = Number(process.env.PORT || 5000),
  host = process.env.HOST || '0.0.0.0',
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer from 0 to 65535');
  }
  for (const key of ['DATABASE_URL', 'DIRECT_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    if (!process.env[key]) throw new Error(`${key} must be configured before starting the server`);
  }
  assertAuthConfigured();
  let server;
  let stopJobs;
  let closing;
  const close = () => {
    closing ??= (async () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      stopJobs?.();
      try {
        if (server?.listening) {
          await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        }
      } finally {
        await prisma.$disconnect();
      }
    })();
    return closing;
  };
  const onSignal = () => {
    close().catch((error) => {
      console.error('Server shutdown failed:', error);
      process.exitCode = 1;
    });
  };

  try {
    await prisma.$connect();
    server = app.listen(port, host);
    await once(server, 'listening');
    stopJobs = startBackgroundJobs();
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    console.info(`Server listening on ${host}:${server.address().port}`);
    return { server, close };
  } catch (error) {
    await close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((error) => {
    console.error('Failed to start server:', error.message);
    process.exitCode = 1;
  });
}

export default app;
