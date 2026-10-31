import autoStageService from './autoStageService.js';
import refundNotificationService from './refundNotificationService.js';
import { startImageHostServices } from './imageHostService.js';

export function startBackgroundJobs() {
  const enabled = process.env.BACKGROUND_JOBS_ENABLED ?? 'false';
  if (!['true', 'false'].includes(enabled)) {
    throw new Error('BACKGROUND_JOBS_ENABLED must be true or false');
  }
  if (enabled !== 'true' || process.env.NODE_ENV === 'test') {
    console.info('Background jobs are disabled');
    return () => {};
  }

  const stopImages = startImageHostServices();
  const jobs = [
    { name: 'Auto-stage', interval: 10_000, run: () => autoStageService.processAutoStages() },
    { name: 'Refund notification', interval: 60_000, run: () => refundNotificationService.processPendingRefundNotifications() },
  ];
  const timers = jobs.map(({ name, interval, run }) => {
    let running = false;
    return setInterval(async () => {
      if (running) return;
      running = true;
      try {
        await run();
      } catch (error) {
        console.error(`${name} job failed:`, error);
      } finally {
        running = false;
      }
    }, interval);
  });

  return () => {
    timers.forEach(clearInterval);
    stopImages();
  };
}
