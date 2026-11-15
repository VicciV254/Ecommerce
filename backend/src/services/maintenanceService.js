import { timingSafeEqual } from 'node:crypto';
import inventoryService from './inventoryService.js';
import notificationService from './notificationService.js';
import paymentService from './paymentService.js';

/** Bounded, idempotent steps shared by the protected scheduled endpoint and the optional local worker. */
export const maintenanceTasks = {
  reservations: () => inventoryService.expireReservations(),
  payments: () => paymentService.reconcileDuePayments(),
  notifications: () => notificationService.processDueNotifications({ limit: 25 }),
};

/** One failing step is reported without blocking the others; results contain counts only. */
export async function runMaintenance(names = Object.keys(maintenanceTasks)) {
  const results = {};
  for (const name of names) {
    try {
      results[name] = (await maintenanceTasks[name]()) ?? { ok: true };
    } catch (error) {
      const code = error.code ?? 'MAINTENANCE_STEP_FAILED';
      results[name] = { error: code };
      console.error('Maintenance step failed', { step: name, code });
    }
  }
  return results;
}

/** Vercel sends `Authorization: Bearer <CRON_SECRET>`; anything else is rejected without running work. */
export function authorizedMaintenance(header, secret = process.env.CRON_SECRET) {
  if (typeof secret !== 'string' || secret.length < 16 || /\s/.test(secret)) return null;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(typeof header === 'string' ? header : '');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
