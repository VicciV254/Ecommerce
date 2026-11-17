import { z } from 'zod';
import prisma from '../config/database.js';
import { pageQuery } from '../utils/catalogValidation.js';

/**
 * The staff activity log: sign-ins, and changes staff make that have no history of their own. Stock, orders, returns
 * and refunds keep their own histories and are not repeated here.
 */
export const ACTIVITY = Object.freeze({
  LOGIN: 'LOGIN',
  STOREFRONT_PUBLISHED: 'STOREFRONT_PUBLISHED',
  STOREFRONT_RESTORED: 'STOREFRONT_RESTORED',
  PRODUCT_CREATED: 'PRODUCT_CREATED',
  PRODUCT_UPDATED: 'PRODUCT_UPDATED',
  PRODUCT_DELETED: 'PRODUCT_DELETED',
  CATEGORY_CREATED: 'CATEGORY_CREATED',
  CATEGORY_UPDATED: 'CATEGORY_UPDATED',
  CATEGORY_DELETED: 'CATEGORY_DELETED',
  CATEGORIES_REORDERED: 'CATEGORIES_REORDERED',
  DESIGNER_CREATED: 'DESIGNER_CREATED',
  DESIGNER_UPDATED: 'DESIGNER_UPDATED',
  DESIGNER_DELETED: 'DESIGNER_DELETED',
  DISCOUNT_CREATED: 'DISCOUNT_CREATED',
  DISCOUNT_UPDATED: 'DISCOUNT_UPDATED',
  DISCOUNT_STOPPED: 'DISCOUNT_STOPPED',
  DISCOUNT_DELETED: 'DISCOUNT_DELETED',
  CUSTOMER_DISABLED: 'CUSTOMER_DISABLED',
  CUSTOMER_ENABLED: 'CUSTOMER_ENABLED',
  CUSTOMER_DELETED: 'CUSTOMER_DELETED',
  CUSTOMER_VERIFICATION_SENT: 'CUSTOMER_VERIFICATION_SENT',
  PROMOTION_SENT: 'PROMOTION_SENT',
  SUBSCRIBER_REMOVED: 'SUBSCRIBER_REMOVED',
});

/** Details are a display name or a count, never contact details, addresses, tokens or message text. */
const DETAILS_LENGTH = 200;

/** Records one staff change; pass the transaction client so the entry commits, or rolls back, with the change. */
export function recordActivity(db, adminId, { action, targetType = null, targetId = null, details = '' }) {
  return db.activityLog.create({
    data: { adminId, action, targetType, targetId, details: Array.from(details.trim()).slice(0, DETAILS_LENGTH).join('') },
  });
}

/**
 * Records an entry after work no transaction can cover (emails sent one at a time). An object, so tests can replace
 * `record` the way they replace `mailer.send`.
 */
export const activityRecorder = { record: (adminId, entry) => recordActivity(prisma, adminId, entry) };

/**
 * Records sends that have already happened. If recording fails, the failure is logged without personal data and the
 * caller still answers with the send result: an error there would lead staff to send the emails again.
 */
export async function recordAfterSending(adminId, entry) {
  try {
    await activityRecorder.record(adminId, entry);
  } catch (error) {
    console.error(`Staff activity ${entry.action} was not recorded after sending.`, { code: error?.code ?? error?.name ?? 'UNKNOWN' });
  }
}

const withPrefix = (prefix) => Object.values(ACTIVITY).filter((action) => action.startsWith(prefix));

/** The actions each filter of the staff activity list shows; `all` shows every entry. */
export const ACTIVITY_FILTERS = Object.freeze({
  all: null,
  signins: [ACTIVITY.LOGIN],
  storefront: withPrefix('STOREFRONT_'),
  catalog: [...withPrefix('PRODUCT_'), ...withPrefix('CATEGORY_'), ACTIVITY.CATEGORIES_REORDERED, ...withPrefix('DESIGNER_')],
  discounts: withPrefix('DISCOUNT_'),
  customers: withPrefix('CUSTOMER_'),
  promotions: [ACTIVITY.PROMOTION_SENT, ACTIVITY.SUBSCRIBER_REMOVED],
});

export const activityQuerySchema = z.object({
  type: z.enum(Object.keys(ACTIVITY_FILTERS)).default('all'),
  page: pageQuery,
}).strict();
