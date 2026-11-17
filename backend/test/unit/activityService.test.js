import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordActivity } from '../../src/services/activityService.js';

test('activity details are trimmed and kept to 200 characters, without splitting a character in two', async () => {
  const written = [];
  const db = { activityLog: { create: async ({ data }) => { written.push(data); return data; } } };
  // 199 letters, then a character outside the Basic Multilingual Plane (two UTF-16 units), then more text.
  const name = `  ${'a'.repeat(199)}🧵 and a much longer tail that no list needs  `;
  await recordActivity(db, 'admin-1', { action: 'PRODUCT_UPDATED', targetType: 'product', targetId: 'prod-1', details: name });
  await recordActivity(db, 'admin-1', { action: 'PRODUCT_UPDATED', details: '  Linen shirt  ' });
  assert.equal(written[0].details, `${'a'.repeat(199)}🧵`);
  assert.equal(Array.from(written[0].details).length, 200);
  assert.equal(written[1].details, 'Linen shirt');
});
