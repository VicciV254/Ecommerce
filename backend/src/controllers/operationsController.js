import { attentionItems, markAttentionRead } from '../services/attentionService.js';
import { authorizedMaintenance, runMaintenance } from '../services/maintenanceService.js';
import { retryNotification } from '../services/notificationService.js';
import { attentionReadSchema } from '../utils/operationsValidation.js';

export const getAttention = async (req, res, next) => {
  try { res.json({ items: await attentionItems(req.admin.id) }); } catch (error) { next(error); }
};

export const readAttention = async (req, res, next) => {
  try { res.json(await markAttentionRead(req.admin.id, attentionReadSchema.parse(req.body).keys)); } catch (error) { next(error); }
};

export const retryNotificationDelivery = async (req, res, next) => {
  try { res.json(await retryNotification(req.params.id)); } catch (error) { next(error); }
};

export const runScheduledMaintenance = async (req, res, next) => {
  try {
    const allowed = authorizedMaintenance(req.get('authorization'));
    if (allowed === null) return res.status(503).json({ error: 'Scheduled maintenance is not configured.', code: 'MAINTENANCE_DISABLED' });
    if (!allowed) return res.status(401).json({ error: 'Unauthorized', code: 'MAINTENANCE_UNAUTHORIZED' });
    res.json({ ok: true, results: await runMaintenance() });
  } catch (error) {
    next(error);
  }
};
