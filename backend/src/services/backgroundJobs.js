import { runMaintenance } from './maintenanceService.js';

/**
 * Optional in-process runner for always-on hosts. Serverless deployments call the
 * protected maintenance endpoint instead; both run the same durable, leased steps.
 */
const JOBS = [
  { interval: 15_000, steps: ['payments'] },
  { interval: 60_000, steps: ['reservations', 'notifications'] },
  // Sample orders become due a day at a time; the serverless cron runs this once a day.
  { interval: 3_600_000, steps: ['sampleOrders'] },
];

export function startBackgroundJobs() {
  const enabled = process.env.BACKGROUND_JOBS_ENABLED ?? 'false';
  if (!['true', 'false'].includes(enabled)) {
    throw new Error('BACKGROUND_JOBS_ENABLED must be true or false');
  }
  if (enabled !== 'true' || process.env.NODE_ENV === 'test') {
    console.info('Background jobs are disabled');
    return () => {};
  }

  const timers = JOBS.map(({ interval, steps }) => {
    let running = false;
    return setInterval(async () => {
      if (running) return;
      running = true;
      try {
        await runMaintenance(steps);
      } finally {
        running = false;
      }
    }, interval);
  });

  return () => timers.forEach(clearInterval);
}
