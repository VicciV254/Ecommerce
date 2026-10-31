import './environment.js';
import jwt from 'jsonwebtoken';

export const AUTH_ISSUER = 'apex-cart-api';
export const AUTH_AUDIENCE = 'apex-cart:v2';

export function assertAuthConfigured() {
  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
    const value = process.env[key];
    if (!value || value.length < 32 || value.startsWith('your_')) {
      const error = new Error(`${key} must be configured as a unique signing secret of at least 32 characters`);
      error.statusCode = 503;
      throw error;
    }
  }
  if (process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
    const error = new Error('Access and refresh signing secrets must be different');
    error.statusCode = 503;
    throw error;
  }
}

function signingKey(key) {
  assertAuthConfigured();
  return process.env[key];
}

function verify(token, key) {
  const secret = signingKey(key);
  if (typeof token !== 'string' || !token) return null;
  try {
    return jwt.verify(token, secret, { algorithms: ['HS256'], issuer: AUTH_ISSUER, audience: AUTH_AUDIENCE });
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError || error instanceof jwt.NotBeforeError) {
      return null;
    }
    throw error;
  }
}

export const generateToken = (payload) =>
  jwt.sign(payload, signingKey('JWT_SECRET'), { algorithm: 'HS256', issuer: AUTH_ISSUER, audience: AUTH_AUDIENCE, expiresIn: process.env.JWT_EXPIRE || '7d' });

export const generateRefreshToken = (payload) =>
  jwt.sign(payload, signingKey('JWT_REFRESH_SECRET'), { algorithm: 'HS256', issuer: AUTH_ISSUER, audience: AUTH_AUDIENCE, expiresIn: process.env.JWT_REFRESH_EXPIRE || '30d' });

export const verifyToken = (token) => verify(token, 'JWT_SECRET');
export const verifyRefreshToken = (token) => verify(token, 'JWT_REFRESH_SECRET');

export const isCustomerToken = (payload) =>
  payload !== null && typeof payload === 'object' &&
  typeof payload.userId === 'string' && payload.userId.length > 0 && payload.adminId === undefined;

export const isAdminToken = (payload) =>
  payload !== null && typeof payload === 'object' &&
  typeof payload.adminId === 'string' && payload.adminId.length > 0 && payload.userId === undefined;
