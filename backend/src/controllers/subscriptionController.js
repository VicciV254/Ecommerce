import prisma from '../config/database.js';
import { brandedEmail, sendMail } from '../services/mailService.js';

const PROMOTIONAL_FOOTER_NOTE = 'You are receiving this email because you subscribed to Apex Cart emails.';

export const subscribe = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Check if already subscribed
    const existing = await prisma.subscription.findUnique({
      where: { email },
    });

    if (existing) {
      if (existing.isActive) {
        return res.status(400).json({ error: 'Email is already subscribed' });
      } else {
        // Reactivate
        const subscription = await prisma.subscription.update({
          where: { email },
          data: { isActive: true },
        });
        return res.json({ message: 'Subscription reactivated', subscription });
      }
    }

    // Create new subscription
    const subscription = await prisma.subscription.create({
      data: { email },
    });

    res.status(201).json({ message: 'Successfully subscribed', subscription });
  } catch (error) {
    next(error);
  }
};

export const unsubscribe = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const subscription = await prisma.subscription.findUnique({
      where: { email },
    });

    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    await prisma.subscription.update({
      where: { email },
      data: { isActive: false },
    });

    res.json({ message: 'Successfully unsubscribed' });
  } catch (error) {
    next(error);
  }
};

export const getAllSubscriptions = async (req, res, next) => {
  try {
    const { active } = req.query;
    const where = active !== undefined ? { isActive: active === 'true' } : {};

    const subscriptions = await prisma.subscription.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    res.json({ subscriptions });
  } catch (error) {
    next(error);
  }
};

export const sendPromotionalEmail = async (req, res, next) => {
  try {
    const { subject, content } = req.body;

    if (!subject || !content) {
      return res.status(400).json({ error: 'Subject and content are required' });
    }

    // Get all active subscriptions
    const subscriptions = await prisma.subscription.findMany({
      where: { isActive: true },
    });

    if (subscriptions.length === 0) {
      return res.status(400).json({ error: 'No active subscribers found' });
    }

    const emails = subscriptions.map(sub => sub.email);

    // `content` is admin-authored HTML (the admin editor states "HTML supported"); sent one recipient at a time.
    const html = brandedEmail({ eyebrow: 'Subscriber update', title: subject, body: content, footerNote: PROMOTIONAL_FOOTER_NOTE });
    const results = [];
    for (const email of emails) {
      try {
        const { messageId } = await sendMail({ to: email, subject, html });
        results.push({ email, success: true, messageId });
      } catch (error) {
        results.push({ email, success: false, error: error.message, code: error.code });
      }
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.json({
      message: `Promotional email sent to ${successful} subscribers`,
      total: emails.length,
      successful,
      failed,
      results,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteSubscription = async (req, res, next) => {
  try {
    const { id } = req.params;

    await prisma.subscription.delete({
      where: { id },
    });

    res.json({ message: 'Subscription deleted' });
  } catch (error) {
    next(error);
  }
};
