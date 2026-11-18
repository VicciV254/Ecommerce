import { httpError } from './catalogService.js';

/** The one form of an address the subscription list stores and looks up: trimmed and lowercase. */
export const canonicalEmail = (email) => email.trim().toLowerCase();

/** Subscribes `email` (canonical), or keeps it subscribed: one atomic insert-or-update, so racing requests never clash. */
export const activateSubscription = (db, email) =>
  db.subscription.upsert({ where: { email }, create: { email }, update: { isActive: true }, select: { id: true } });

/**
 * Every writer of an address's email preference takes this transaction lock first. Without it, a sign-up and a subscribe
 * racing for one address can each miss the other's uncommitted rows (read committed), leaving the account showing "off"
 * while the address is subscribed.
 */
export const lockAddress = (db, email) => db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${email}, 0))`;

/**
 * Makes every account with this address, in any letter case, show whether promotional emails are actually sent to it:
 * on exactly when an active subscription exists. Every writer runs it inside its transaction; resolves to that value.
 * Exact `lower()` equality, not Prisma's case-insensitive mode, whose ILIKE treats `_` and `%` as wildcards.
 */
export async function syncPromotionalPreference(db, email) {
  const subscription = await db.subscription.findUnique({ where: { email }, select: { isActive: true } });
  const active = subscription?.isActive === true;
  // "updatedAt" holds UTC without a zone, as Prisma writes it.
  await db.$executeRaw`UPDATE "User" SET "promotionalEmails" = ${active}, "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE lower("email") = ${email} AND "promotionalEmails" <> ${active}`;
  return active;
}

const preferencesUnavailable = () =>
  httpError(503, "We couldn't update email preferences just now. Try again.", 'SUBSCRIPTION_UNAVAILABLE');

/**
 * What to pass on when work on email preferences fails: a refusal (an error with a status) as it is; anything else,
 * such as a database error whose message can quote an address or an unsubscribe token, is logged by name and code
 * only and replaced by `replacement()`.
 */
export function sanitizedFailure(error, replacement = preferencesUnavailable) {
  if (error?.statusCode) return error;
  console.error('Email preference work failed', { name: error?.name, code: error?.code });
  return replacement();
}
