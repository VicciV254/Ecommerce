import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trustedProxyHops } from '../../src/config/proxy.js';

test('no proxy is trusted by default; on Vercel its one proxy is; TRUST_PROXY_HOPS sets the number explicitly', () => {
  assert.equal(trustedProxyHops({}), 0);
  // Vercel overwrites X-Forwarded-For with the client's address, so its single hop can be trusted.
  assert.equal(trustedProxyHops({ VERCEL: '1' }), 1);
  assert.equal(trustedProxyHops({ TRUST_PROXY_HOPS: '2' }), 2);
  assert.equal(trustedProxyHops({ VERCEL: '1', TRUST_PROXY_HOPS: '0' }), 0);
  for (const value of ['', 'yes', '-1', '1.5', '10']) {
    assert.throws(() => trustedProxyHops({ TRUST_PROXY_HOPS: value }), { code: 'TRUST_PROXY_CONFIGURATION' }, value);
  }
});
