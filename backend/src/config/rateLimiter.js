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

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts
  message: {
    error: 'Too many login attempts, please try again later.',
  },
  skipSuccessfulRequests: true,
});

export const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: {
    error: 'Too many API requests, please slow down.',
  },
});
