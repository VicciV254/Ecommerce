import assert from 'node:assert/strict';
import { test } from 'node:test';
import examples from '../storefront-claim-examples.json' with { type: 'json' };
import { claimsUnmeasuredRanking, storefrontClaimIssues, storefrontSchema } from '../../src/utils/catalogValidation.js';
import defaults from '../../src/data/storefront-defaults.json' with { type: 'json' };

/* The same example table is checked against the editor's copy of the rule in `src/store/storefrontClaims.test.ts`. */

test('refuses every shared example heading that claims a ranking or popularity the store does not measure', () => {
  assert.deepEqual(examples.refused.filter((title) => !claimsUnmeasuredRanking(title)), []);
});

test('allows every shared example heading that claims nothing', () => {
  assert.deepEqual(examples.allowed.filter(claimsUnmeasuredRanking), []);
});

test('reports each refused heading at its section path, quoting the heading as typed', () => {
  const sections = ['Featured', 'Customers’ picks', 'Staff picks', 'TRENDING NOW'].map((title, index) => ({ id: `s${index}`, title }));
  assert.deepEqual(storefrontClaimIssues({ sections }).map(({ path, message }) => ({ path, message })), [
    {
      path: ['sections', 1, 'title'],
      message: 'Section "Customers’ picks": headings can\'t claim a ranking or popularity the store doesn\'t measure, such as "best sellers", "top rated" or "trending". Use a heading such as "Featured" or "Staff picks".',
    },
    {
      path: ['sections', 3, 'title'],
      message: 'Section "TRENDING NOW": headings can\'t claim a ranking or popularity the store doesn\'t measure, such as "best sellers", "top rated" or "trending". Use a heading such as "Featured" or "Staff picks".',
    },
  ]);
});

test('leaves stored documents readable: the read schema does not apply the rule', () => {
  const stored = JSON.parse(JSON.stringify(defaults));
  stored.sections[1].title = 'Best sellers';
  assert.equal(storefrontSchema.safeParse(stored).success, true);
});
