/**
 * Proxies in front of the API whose X-Forwarded-For entries are trusted, so `req.ip` (which the rate limits count by)
 * is the client's address. `TRUST_PROXY_HOPS` sets it (0 to 9); otherwise one on Vercel, whose proxy replaces the
 * header with the client's address and drops any the client sent, and none elsewhere, where a client could forge it.
 */
export function trustedProxyHops(env = process.env) {
  const value = env.TRUST_PROXY_HOPS;
  if (value === undefined) return env.VERCEL === '1' ? 1 : 0;
  if (!/^\d$/.test(value)) {
    throw Object.assign(new Error('TRUST_PROXY_HOPS must be a whole number from 0 to 9'), { code: 'TRUST_PROXY_CONFIGURATION' });
  }
  return Number(value);
}
