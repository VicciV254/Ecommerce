import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nairobiDayRange, nairobiDaySpan, nairobiDayStart, nairobiPeriodRange, REPORT_PERIODS } from '../../src/utils/nairobiTime.js';

/*
 * Nairobi keeps East Africa Time (UTC+3) all year, so a Nairobi day starts at 21:00Z the day before. Every instant here
 * is written in UTC; the suite must pass whatever the process time zone (run it under TZ=UTC and TZ=Africa/Nairobi).
 */
const at = (iso) => new Date(iso);
const iso = (range) => ({ gte: range.gte.toISOString(), lte: range.lte.toISOString() });
const within = (range, instant) => instant >= range.gte && instant <= range.lte;

/** 00:30 EAT on Sunday 1 November 2026, and 23:59 EAT on Saturday 31 October 2026. */
const FIRST_MINUTES_OF_NOVEMBER = at('2026-10-31T21:30:00.000Z');
const LAST_MINUTE_OF_OCTOBER = at('2026-10-31T20:59:00.000Z');
/** 14:05 EAT on Tuesday 17 November 2026. */
const MID_NOVEMBER = at('2026-11-17T11:05:00.000Z');

test('an order at 00:30 EAT on 1 November belongs to November and to orderedDay=2026-11-01; one at 23:59 EAT on 31 October to neither', () => {
  const november = nairobiPeriodRange('month', MID_NOVEMBER);
  assert.deepEqual(iso(november), { gte: '2026-10-31T21:00:00.000Z', lte: MID_NOVEMBER.toISOString() });
  assert.equal(within(november, FIRST_MINUTES_OF_NOVEMBER), true, '00:30 EAT on 1 November is in November');
  assert.equal(within(november, LAST_MINUTE_OF_OCTOBER), false, '23:59 EAT on 31 October is not in November');

  const firstOfNovember = nairobiDayRange('2026-11-01');
  assert.deepEqual(iso(firstOfNovember), { gte: '2026-10-31T21:00:00.000Z', lte: '2026-11-01T20:59:59.999Z' });
  assert.equal(within(firstOfNovember, FIRST_MINUTES_OF_NOVEMBER), true, '00:30 EAT on 1 November is ordered on 2026-11-01');
  assert.equal(within(firstOfNovember, LAST_MINUTE_OF_OCTOBER), false, '23:59 EAT on 31 October is not ordered on 2026-11-01');
  assert.equal(within(nairobiDayRange('2026-10-31'), LAST_MINUTE_OF_OCTOBER), true, '23:59 EAT on 31 October is ordered on 2026-10-31');
});

test('a Nairobi day starts at 21:00Z the day before', () => {
  assert.equal(nairobiDayStart(FIRST_MINUTES_OF_NOVEMBER).toISOString(), '2026-10-31T21:00:00.000Z');
  assert.equal(nairobiDayStart(LAST_MINUTE_OF_OCTOBER).toISOString(), '2026-10-30T21:00:00.000Z');
  assert.equal(nairobiDayStart(at('2026-10-31T21:00:00.000Z')).toISOString(), '2026-10-31T21:00:00.000Z');
  assert.equal(nairobiDayStart(at('2026-10-31T20:59:59.999Z')).toISOString(), '2026-10-30T21:00:00.000Z');
});

test('today runs from the start of the Nairobi day to now, even in the three hours after UTC midnight', () => {
  const justAfterMidnight = at('2026-11-16T21:30:00.000Z'); // 00:30 EAT on 17 November
  assert.deepEqual(iso(nairobiPeriodRange('today', justAfterMidnight)), { gte: '2026-11-16T21:00:00.000Z', lte: justAfterMidnight.toISOString() });
  const lateEvening = at('2026-11-17T20:59:59.000Z'); // 23:59:59 EAT on 17 November
  assert.deepEqual(iso(nairobiPeriodRange('today', lateEvening)), { gte: '2026-11-16T21:00:00.000Z', lte: lateEvening.toISOString() });
});

test('a week runs from Monday 00:00 EAT; on a Sunday it started the previous Monday, across a month boundary', () => {
  const sunday = at('2026-11-01T07:00:00.000Z'); // 10:00 EAT on Sunday 1 November
  assert.deepEqual(iso(nairobiPeriodRange('week', sunday)), { gte: '2026-10-25T21:00:00.000Z', lte: sunday.toISOString() });
  const laterSunday = at('2026-11-22T07:00:00.000Z'); // 10:00 EAT on Sunday 22 November
  assert.equal(nairobiPeriodRange('week', laterSunday).gte.toISOString(), '2026-11-15T21:00:00.000Z');
  // 00:30 EAT on Monday 23 November is still Sunday in UTC: the new week has begun in Nairobi.
  const mondayMorning = at('2026-11-22T21:30:00.000Z');
  assert.equal(nairobiPeriodRange('week', mondayMorning).gte.toISOString(), '2026-11-22T21:00:00.000Z');
  // 23:59 EAT on Sunday 22 November is the week's last minute.
  assert.equal(nairobiPeriodRange('week', at('2026-11-22T20:59:00.000Z')).gte.toISOString(), '2026-11-15T21:00:00.000Z');
  assert.equal(nairobiPeriodRange('week', MID_NOVEMBER).gte.toISOString(), '2026-11-15T21:00:00.000Z');
});

test('month and year roll over at midnight in Nairobi, not at midnight UTC', () => {
  const newYear = at('2026-12-31T21:30:00.000Z'); // 00:30 EAT on Friday 1 January 2027
  for (const period of ['today', 'month', 'year']) {
    assert.deepEqual(iso(nairobiPeriodRange(period, newYear)), { gte: '2026-12-31T21:00:00.000Z', lte: newYear.toISOString() }, period);
  }
  assert.equal(nairobiPeriodRange('week', newYear).gte.toISOString(), '2026-12-27T21:00:00.000Z');
  const yearsLastMinute = at('2026-12-31T20:59:00.000Z'); // 23:59 EAT on 31 December 2026
  assert.equal(nairobiPeriodRange('month', yearsLastMinute).gte.toISOString(), '2026-11-30T21:00:00.000Z');
  assert.equal(nairobiPeriodRange('year', yearsLastMinute).gte.toISOString(), '2025-12-31T21:00:00.000Z');
  assert.deepEqual(iso(nairobiDayRange('2026-12-31')), { gte: '2026-12-30T21:00:00.000Z', lte: '2026-12-31T20:59:59.999Z' });
  assert.deepEqual(iso(nairobiDayRange('2027-01-01')), { gte: '2026-12-31T21:00:00.000Z', lte: '2027-01-01T20:59:59.999Z' });
});

test('a leap day is a real Nairobi day, and the day after it starts March', () => {
  assert.deepEqual(iso(nairobiDayRange('2028-02-29')), { gte: '2028-02-28T21:00:00.000Z', lte: '2028-02-29T20:59:59.999Z' });
  const firstOfMarch = at('2028-02-29T21:30:00.000Z'); // 00:30 EAT on Wednesday 1 March 2028
  assert.equal(nairobiPeriodRange('today', firstOfMarch).gte.toISOString(), '2028-02-29T21:00:00.000Z');
  assert.equal(nairobiPeriodRange('month', firstOfMarch).gte.toISOString(), '2028-02-29T21:00:00.000Z');
  assert.equal(nairobiPeriodRange('week', firstOfMarch).gte.toISOString(), '2028-02-27T21:00:00.000Z');
  assert.equal(nairobiPeriodRange('month', at('2028-02-29T09:00:00.000Z')).gte.toISOString(), '2028-01-31T21:00:00.000Z');
});

test('impossible or malformed days are rejected instead of rolling over', () => {
  for (const value of [
    '2026-02-30', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-11-00', '2026-11-32',
    '2026-1-01', '26-11-01', '2026-11-01T00:00', ' 2026-11-01', '2026/11/01', '', undefined, null, ['2026-11-01'],
  ]) {
    assert.equal(nairobiDayRange(value) ?? null, null, JSON.stringify(value));
  }
});

test('a span of Nairobi days includes both ends, and either end may be open', () => {
  const names = ['orderedFrom', 'orderedTo'];
  assert.deepEqual(iso(nairobiDaySpan('2026-11-01', '2026-11-17', names)), { gte: '2026-10-31T21:00:00.000Z', lte: '2026-11-17T20:59:59.999Z' });
  assert.deepEqual(iso(nairobiDaySpan('2026-11-01', '2026-11-01', names)), iso(nairobiDayRange('2026-11-01')));
  assert.deepEqual(nairobiDaySpan('2026-11-01', undefined, names), { gte: new Date('2026-10-31T21:00:00.000Z') });
  assert.deepEqual(nairobiDaySpan(undefined, '2026-11-17', names), { lte: new Date('2026-11-17T20:59:59.999Z') });
  assert.equal(nairobiDaySpan(undefined, undefined, names), undefined);
  assert.equal(nairobiDaySpan('', '', names), undefined);
});

test('a span refuses an impossible day or a start after its end with a 400 naming the parameter', () => {
  const names = ['orderedFrom', 'orderedTo'];
  assert.throws(() => nairobiDaySpan('2026-02-30', undefined, names),
    { statusCode: 400, code: 'DATE_INVALID', message: 'orderedFrom must be a real date written as YYYY-MM-DD.' });
  assert.throws(() => nairobiDaySpan('2026-11-01', '2026-13-01', names),
    { statusCode: 400, code: 'DATE_INVALID', message: 'orderedTo must be a real date written as YYYY-MM-DD.' });
  assert.throws(() => nairobiDaySpan('2026-11-02', '2026-11-01', names),
    { statusCode: 400, code: 'DATE_RANGE_INVALID', message: 'orderedFrom must not be later than orderedTo.' });
  assert.throws(() => nairobiDaySpan(['2026-11-01', '2026-11-02'], undefined, names), { statusCode: 400, code: 'DATE_INVALID' });
});

test('only today, week, month and year are periods', () => {
  assert.deepEqual([...REPORT_PERIODS], ['today', 'week', 'month', 'year']);
  for (const period of ['day', 'quarter', 'constructor', 'toString', '', undefined]) {
    assert.throws(() => nairobiPeriodRange(period, MID_NOVEMBER), RangeError, String(period));
  }
});
