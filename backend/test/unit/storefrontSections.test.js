import assert from 'node:assert/strict';
import { test } from 'node:test';
import examples from '../storefront-section-examples.json' with { type: 'json' };
import { storefrontClaimIssues, storefrontSchema } from '../../src/utils/catalogValidation.js';
import defaults from '../../src/data/storefront-defaults.json' with { type: 'json' };

/*
 * P8.7: a department row, the shopping facts strip and the measured best sellers, plus an optional grid or row layout.
 * Reads parse stored documents with the same schema as writes, so every document stored before must still parse, as
 * stored. The editor mirrors these rules against the same examples (`src/pages/admin/storefrontDraftRules.test.ts`).
 */
const copy = (value) => JSON.parse(JSON.stringify(value));
const settingsWith = ({ sections, campaigns = [] }) => ({ ...copy(defaults), sections: copy(sections), campaigns: copy(campaigns) });
const section = (id, type, extra = {}) => ({
  id, type, title: 'Section', enabled: true, productIds: [], categoryIds: [], campaignId: null, ...extra,
});
const issues = (sections) => {
  const parsed = storefrontSchema.safeParse(settingsWith({ sections }));
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
};

const LAYOUT_KINDS_ONLY = 'Only departments, featured products, selected products and department row sections have a layout';
const ONE_DEPARTMENT = 'A department row shows exactly one category and no chosen products';
const NO_REFERENCES = 'Shopping facts and best sellers sections take no products or categories';
const ONE_EACH = 'A storefront has at most one shopping facts section and one best sellers section';
const FIXED_TITLE = 'The best sellers section is titled "Best sellers"';

test('parses every allowed example and keeps each section as stored: no layout is added where none was', () => {
  for (const example of examples.allowed) {
    const settings = settingsWith(example);
    const parsed = storefrontSchema.safeParse(settings);
    assert.equal(parsed.success, true, `${example.name}: ${JSON.stringify(parsed.error?.issues)}`);
    assert.deepEqual(
      parsed.data.sections.map((item) => Object.keys(item).sort()),
      settings.sections.map((item) => Object.keys(item).sort()),
      example.name,
    );
  }
  // The documents stored today: the defaults, untouched.
  assert.deepEqual(storefrontSchema.parse(copy(defaults)), defaults);
});

test('refuses every refused example', () => {
  for (const example of examples.refused) {
    assert.equal(storefrontSchema.safeParse(settingsWith(example)).success, false, example.name);
  }
});

test('takes a layout only on departments, featured, selected products and department rows, and only grid or rail', () => {
  for (const type of ['departments', 'featured', 'products', 'category']) {
    for (const layout of ['grid', 'rail']) {
      const extra = { layout, ...(type === 'products' && { productIds: ['prod-1'] }), ...(type === 'category' && { categoryIds: ['cat-1'] }) };
      assert.deepEqual(issues([section(type, type, extra)]), [], `${type} as ${layout}`);
    }
  }
  assert.deepEqual(issues([section('facts', 'promises', { layout: 'grid' })]), [LAYOUT_KINDS_ONLY]);
  assert.deepEqual(issues([section('best', 'bestSellers', { title: 'Best sellers', layout: 'rail' })]), [LAYOUT_KINDS_ONLY]);
  assert.match(issues([section('featured', 'featured', { layout: 'carousel' })]).join(), /Invalid enum value/);
});

test('a department row shows exactly one category and no chosen products', () => {
  assert.deepEqual(issues([section('row', 'category')]), [ONE_DEPARTMENT]);
  assert.deepEqual(issues([section('row', 'category', { categoryIds: ['cat-1', 'cat-2'] })]), [ONE_DEPARTMENT]);
  assert.deepEqual(issues([section('row', 'category', { categoryIds: ['cat-1'], productIds: ['prod-1'] })]), [ONE_DEPARTMENT]);
  assert.deepEqual(issues([section('row', 'category', { categoryIds: ['cat-1'] })]), []);
});

test('shopping facts and best sellers take no products or categories, and appear once at most', () => {
  assert.deepEqual(issues([section('facts', 'promises', { productIds: ['prod-1'] })]), [NO_REFERENCES]);
  assert.deepEqual(issues([section('facts', 'promises', { categoryIds: ['cat-1'] })]), [NO_REFERENCES]);
  assert.deepEqual(issues([section('best', 'bestSellers', { title: 'Best sellers', categoryIds: ['cat-1'] })]), [NO_REFERENCES]);
  assert.deepEqual(issues([section('facts', 'promises'), section('facts-2', 'promises')]), [ONE_EACH]);
  const best = (id) => section(id, 'bestSellers', { title: 'Best sellers' });
  assert.deepEqual(issues([best('best'), best('best-2')]), [ONE_EACH]);
  assert.deepEqual(issues([section('facts', 'promises'), best('best')]), []);
});

test('the best sellers heading is fixed: exactly "Best sellers" once trimmed', () => {
  for (const title of ['Top picks', 'Best Sellers', 'Best sellers this week']) {
    assert.deepEqual(issues([section('best', 'bestSellers', { title })]), [FIXED_TITLE], title);
  }
  const parsed = storefrontSchema.parse(settingsWith({ sections: [section('best', 'bestSellers', { title: ' Best sellers  ' })] }));
  assert.equal(parsed.sections[0].title, 'Best sellers');
});

test('the ranking-claim guard skips only the measured best sellers section', () => {
  const sections = [
    section('best', 'bestSellers', { title: 'Best sellers' }),
    section('featured', 'featured', { title: 'Best sellers' }),
    section('row', 'category', { title: 'Trending phones', categoryIds: ['cat-1'] }),
    section('facts', 'promises', { title: 'Our most popular promises' }),
    section('picks', 'products', { title: 'Staff picks', productIds: ['prod-1'] }),
  ];
  assert.deepEqual(storefrontClaimIssues({ sections }).map(({ path }) => path), [
    ['sections', 1, 'title'], ['sections', 2, 'title'], ['sections', 3, 'title'],
  ]);
});

/* The hero carousel: one section listing 1 to 5 of the storefront's campaigns, in order. */
const CAROUSEL_ONLY = 'Only a hero carousel lists campaigns';
const CAROUSEL_SIZE = 'A hero carousel shows 1 to 5 campaigns';
const CAROUSEL_ONCE = 'A hero carousel lists each campaign once';
const CAROUSEL_REFERENCES = 'A hero carousel requires valid campaign references';
const CAROUSEL_CONTENT = 'A hero carousel takes no products or categories';
const ONE_CAROUSEL = 'A storefront has at most one hero carousel';
const SINGLE_CAMPAIGN = 'Only campaign sections may reference a campaign';
const campaign = (id) => ({
  id, title: `Campaign ${id}`, body: '', conditions: '', cta: { label: 'Shop now', target: 'shop', targetId: null },
  desktopMediaId: null, mobileMediaId: null, desktopFocal: { x: 50, y: 50 }, mobileFocal: { x: 50, y: 50 }, layout: 'split',
});
const SIX = ['one', 'two', 'three', 'four', 'five', 'six'];
const carouselIssues = (sections, campaignIds = SIX) => {
  const parsed = storefrontSchema.safeParse(settingsWith({ sections, campaigns: campaignIds.map(campaign) }));
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
};
const carousel = (campaignIds, extra = {}) => section('hero-carousel', 'carousel', { title: 'Highlights', campaignIds, ...extra });

test('a hero carousel lists 1 to 5 different campaigns that exist, in the order given', () => {
  for (let count = 1; count <= 5; count += 1) {
    assert.deepEqual(carouselIssues([carousel(SIX.slice(0, count))]), [], `${count} campaigns`);
  }
  const parsed = storefrontSchema.parse(settingsWith({ sections: [carousel(['three', 'one'])], campaigns: SIX.map(campaign) }));
  assert.deepEqual(parsed.sections[0].campaignIds, ['three', 'one']);
  assert.deepEqual(carouselIssues([carousel(SIX)]), [CAROUSEL_SIZE]);
  assert.deepEqual(carouselIssues([carousel([])]), [CAROUSEL_SIZE]);
  assert.deepEqual(carouselIssues([section('hero-carousel', 'carousel', { title: 'Highlights' })]), [CAROUSEL_SIZE]);
  assert.deepEqual(carouselIssues([carousel(['one', 'two', 'one'])]), [CAROUSEL_ONCE]);
  assert.deepEqual(carouselIssues([carousel(['one', 'retired'])]), [CAROUSEL_REFERENCES]);
  // A carousel's campaigns must exist whether it is shown or not, as a campaign section's must.
  assert.deepEqual(carouselIssues([carousel(['retired'], { enabled: false })]), [CAROUSEL_REFERENCES]);
});

test('a hero carousel takes no products, categories, single campaign or layout', () => {
  assert.deepEqual(carouselIssues([carousel(['one'], { productIds: ['prod-1'] })]), [CAROUSEL_CONTENT]);
  assert.deepEqual(carouselIssues([carousel(['one'], { categoryIds: ['cat-1'] })]), [CAROUSEL_CONTENT]);
  assert.deepEqual(carouselIssues([carousel(['one'], { campaignId: 'one' })]), [SINGLE_CAMPAIGN]);
  assert.deepEqual(carouselIssues([carousel(['one'], { layout: 'rail' })]), [LAYOUT_KINDS_ONLY]);
  assert.match(carouselIssues([carousel('one')]).join(), /Expected array/);
});

test('only a hero carousel lists campaigns: the field is absent everywhere else, never an empty list', () => {
  assert.deepEqual(carouselIssues([section('hero', 'campaign', { campaignId: 'one', campaignIds: ['one'] })]), [CAROUSEL_ONLY]);
  assert.deepEqual(carouselIssues([section('featured', 'featured', { campaignIds: [] })]), [CAROUSEL_ONLY]);
  assert.deepEqual(carouselIssues([section('hero', 'campaign', { campaignId: 'one' })]), []);
});

test('a storefront has at most one hero carousel, shown or not', () => {
  assert.deepEqual(carouselIssues([carousel(['one']), { ...carousel(['two']), id: 'hero-carousel-2', enabled: false }]), [ONE_CAROUSEL]);
  assert.deepEqual(carouselIssues([carousel(['one']), section('hero', 'campaign', { campaignId: 'two' })]), []);
});

test("the ranking-claim guard checks a hero carousel's heading like any other", () => {
  assert.deepEqual(storefrontClaimIssues({ sections: [carousel(['one'], { title: 'Trending now' }), carousel(['one'])] }).map(({ path }) => path), [
    ['sections', 0, 'title'],
  ]);
});
