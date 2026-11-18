import { z } from 'zod';
import prisma from '../config/database.js';
import { brandedEmail, frontendUrl, htmlToText, sendMail } from '../services/mailService.js';
import { ACTIVITY, recordActivity, recordAfterSending } from '../services/activityService.js';
import { httpError } from '../services/catalogService.js';
import {
  activateSubscription, canonicalEmail, lockAddress, sanitizedFailure, syncPromotionalPreference,
} from '../services/subscriptionService.js';

const PROMOTIONAL_FOOTER_NOTE = "You're receiving this because you subscribed to Apex Cart emails.";
const UNSUBSCRIBE_LABEL = 'Unsubscribe from these emails';
/** The longest address SMTP can deliver to. */
const MAX_EMAIL_LENGTH = 254;
const subscribeSchema = z.object({ email: z.string().trim().max(MAX_EMAIL_LENGTH).email() });
const unsubscribeSchema = z.object({ token: z.string().uuid() }).strict();
/** Every valid request gets this answer, so it reveals nothing about who is subscribed. */
const SUBSCRIBED = { message: 'Subscribed. Every email has a link to unsubscribe.' };
const linkInvalid = (status) => httpError(status, "This unsubscribe link isn't valid.", 'UNSUBSCRIBE_LINK_INVALID');
/** The fields staff see; the unsubscribe token never leaves the server except inside its subscriber's own emails. */
const STAFF_FIELDS = { id: true, email: true, isActive: true, createdAt: true, updatedAt: true };

export const subscribe = async (req, res, next) => {
  try {
    const parsed = subscribeSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw httpError(400, 'Enter a valid email address.', 'SUBSCRIPTION_EMAIL_INVALID');
    const email = canonicalEmail(parsed.data.email);
    // The same work for every state (new, active, inactive): no read first, no early exit.
    await prisma.$transaction(async (db) => {
      await lockAddress(db, email);
      await activateSubscription(db, email);
      await syncPromotionalPreference(db, email);
    });
    res.json(SUBSCRIBED);
  } catch (error) {
    // Unexpected failures are logged and answered without the details a database error can quote.
    next(sanitizedFailure(error));
  }
};

export const unsubscribe = async (req, res, next) => {
  try {
    const parsed = unsubscribeSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw linkInvalid(400);
    const unsubscribeToken = parsed.data.token.toLowerCase();
    await prisma.$transaction(async (db) => {
      const subscription = await db.subscription.findUnique({ where: { unsubscribeToken }, select: { email: true } });
      if (!subscription) throw linkInvalid(404);
      await lockAddress(db, subscription.email);
      await db.subscription.update({ where: { unsubscribeToken }, data: { isActive: false }, select: { id: true } });
      await syncPromotionalPreference(db, subscription.email);
    });
    res.json({ message: 'Unsubscribed.' });
  } catch (error) {
    next(sanitizedFailure(error));
  }
};

export const getAllSubscriptions = async (req, res, next) => {
  try {
    const { active } = req.query;
    const where = active !== undefined ? { isActive: active === 'true' } : {};

    const subscriptions = await prisma.subscription.findMany({ where, orderBy: { createdAt: 'desc' }, select: STAFF_FIELDS });

    res.json({ subscriptions });
  } catch (error) {
    next(sanitizedFailure(error));
  }
};

const unsubscribeUrl = (token) => `${frontendUrl()}/#/unsubscribe?token=${encodeURIComponent(token)}`;

export const sendPromotionalEmail = async (req, res, next) => {
  try {
    const { subject, content } = req.body;

    if (!subject || !content) {
      return res.status(400).json({ error: 'Subject and content are required' });
    }

    const subscriptions = await prisma.subscription.findMany({ where: { isActive: true }, select: { email: true, unsubscribeToken: true } });

    if (subscriptions.length === 0) {
      return res.status(400).json({ error: 'No active subscribers found' });
    }

    // `content` is admin-authored HTML (the admin editor states "HTML supported"); sent one recipient at a time, each
    // with a link that unsubscribes only that recipient. The text part carries the link as a plain address.
    const message = { eyebrow: 'Subscriber update', title: subject, body: content, footerNote: PROMOTIONAL_FOOTER_NOTE };
    const text = htmlToText(brandedEmail(message));
    const results = [];
    for (const { email, unsubscribeToken } of subscriptions) {
      const link = unsubscribeUrl(unsubscribeToken);
      try {
        const html = brandedEmail({ ...message, footerLink: { href: link, label: UNSUBSCRIBE_LABEL } });
        const { messageId } = await sendMail({ to: email, subject, html, text: `${text}\n${UNSUBSCRIBE_LABEL}: ${link}` });
        results.push({ email, success: true, messageId });
      } catch (error) {
        // Mail errors carry fixed messages and codes only (`sendMail`); a bad footer link fails every recipient.
        results.push({ email, success: false, error: error.message, code: error.code });
      }
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    // The count actually sent, never the subject: staff type it freely and it may hold personal details.
    if (successful > 0) {
      await recordAfterSending(req.admin.id, {
        action: ACTIVITY.PROMOTION_SENT, targetType: 'promotion',
        details: `${successful} ${successful === 1 ? 'subscriber' : 'subscribers'}`,
      });
    }

    res.json({
      message: `Promotional email sent to ${successful} subscribers`,
      total: subscriptions.length,
      successful,
      failed,
      results,
    });
  } catch (error) {
    next(sanitizedFailure(error));
  }
};

export const deleteSubscription = async (req, res, next) => {
  try {
    const { id } = req.params;

    await prisma.$transaction(async (db) => {
      const subscription = await db.subscription.findUnique({ where: { id }, select: { email: true } });
      if (subscription) await lockAddress(db, subscription.email);
      // Counted, not assumed: a delete that raced this one has already removed the row.
      if (!subscription || (await db.subscription.deleteMany({ where: { id } })).count === 0) throw httpError(404, 'Record not found');
      await syncPromotionalPreference(db, subscription.email);
      await recordActivity(db, req.admin.id, { action: ACTIVITY.SUBSCRIBER_REMOVED, targetType: 'subscriber', targetId: id });
    });

    res.json({ message: 'Subscription deleted' });
  } catch (error) {
    next(sanitizedFailure(error));
  }
};
