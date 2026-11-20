import rateLimit from 'express-rate-limit';

const windowMs = (process.env.RATE_LIMIT_WINDOW || 15) * 60 * 1000; // 15 minutes by default
const maxRequests = process.env.RATE_LIMIT_MAX_REQUESTS || 100;

export const generalLimiter = rateLimit({
  windowMs,
  max: maxRequests,
  message: {
    error: 'Too many requests from this IP, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Unsuccessful sign-ins, sign-ups and verification resends from one client address share this count (successful
 * requests are not counted), so its refusal names no single action.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts
  message: {
    error: 'Too many unsuccessful attempts from this network. Try again later.',
    code: 'AUTH_RATE_LIMIT',
  },
  skipSuccessfulRequests: true,
});

/**
 * Accounts one client address may open in an hour. Every sign-up counts, successful or not, so accounts (and their
 * sample-order quotas) can't be opened in bulk. `REGISTRATION_LIMIT_PER_HOUR` sets it (default 5). Counts are kept per
 * running instance, so on a serverless host the limit is approximate.
 */
export const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.REGISTRATION_LIMIT_PER_HOUR) || 5,
  message: { error: 'Too many accounts were opened from this network. Try again in an hour.', code: 'REGISTRATION_LIMIT' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: {
    error: 'Too many API requests, please slow down.',
  },
});

export const mpesaCallbackLimiter = rateLimit({
  windowMs: 60_000,
  max: 600,
  message: { error: 'Callback request limit reached.', code: 'CALLBACK_RATE_LIMIT' },
  standardHeaders: true,
  legacyHeaders: false,
});
