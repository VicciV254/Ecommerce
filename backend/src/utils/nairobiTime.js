/**
 * Calendar days and reporting periods in Nairobi time. Africa/Nairobi keeps East Africa Time (UTC+3) all year, as Kenya
 * observes no daylight saving, so every boundary is computed with that fixed offset and never with the server's own
 * time zone (UTC on Vercel, where a Nairobi day starts at 21:00 the day before).
 */
export const NAIROBI_TIME_ZONE = 'Africa/Nairobi';
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;
/** Days since Monday for a weekday numbered from Sunday = 0. */
const DAYS_SINCE_MONDAY = [6, 0, 1, 2, 3, 4, 5];
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Reporting periods; each runs from its start in Nairobi up to now. */
export const REPORT_PERIODS = Object.freeze(['today', 'week', 'month', 'year']);
export const isReportPeriod = (value) => REPORT_PERIODS.includes(value);

/** The Nairobi calendar date of an instant, with its weekday (Sunday = 0). */
function nairobiCalendar(instant) {
  const shifted = new Date(instant.getTime() + NAIROBI_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate(), weekday: shifted.getUTCDay() };
}

/** Midnight in Nairobi at the start of a date; a day or month outside its range rolls over, as date arithmetic needs. */
const startOfDate = (year, month, day) => new Date(Date.UTC(year, month, day) - NAIROBI_OFFSET_MS);

/** The instant the Nairobi calendar day containing `instant` starts. */
export function nairobiDayStart(instant) {
  const { year, month, day } = nairobiCalendar(instant);
  return startOfDate(year, month, day);
}

/** `today`, `week` (from Monday), `month` or `year` in Nairobi, up to `now`, as a `{ gte, lte }` filter. */
export function nairobiPeriodRange(period, now = new Date()) {
  if (!isReportPeriod(period)) throw new RangeError(`Unknown reporting period: ${String(period)}`);
  const { year, month, day, weekday } = nairobiCalendar(now);
  let start;
  switch (period) {
    case 'today': start = startOfDate(year, month, day); break;
    case 'week': start = startOfDate(year, month, day - DAYS_SINCE_MONDAY[weekday]); break;
    case 'month': start = startOfDate(year, month, 1); break;
    default: start = startOfDate(year, 0, 1);
  }
  return { gte: start, lte: now };
}

/**
 * The first and last millisecond of a `YYYY-MM-DD` Nairobi day, or null when the value is not a real date: 2026-02-30
 * and 2026-13-01 are refused rather than rolled over into another day.
 */
export function nairobiDayRange(value) {
  const match = typeof value === 'string' ? DAY_PATTERN.exec(value) : null;
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { gte: startOfDate(year, month - 1, day), lte: new Date(startOfDate(year, month - 1, day + 1).getTime() - 1) };
}

const badRequest = (message, code) => Object.assign(new Error(message), { statusCode: 400, code });
const given = (value) => value !== undefined && value !== '';

/**
 * A filter covering whole Nairobi days from `from` to `to`, both included; either may be absent, and with neither the
 * result is undefined (no filter). An impossible date, or a start after the end, is a 400 that names the parameter.
 */
export function nairobiDaySpan(from, to, [fromName, toName] = ['from', 'to']) {
  const [start, end] = [[from, fromName], [to, toName]].map(([value, name]) => {
    if (!given(value)) return null;
    const range = nairobiDayRange(value);
    if (!range) throw badRequest(`${name} must be a real date written as YYYY-MM-DD.`, 'DATE_INVALID');
    return range;
  });
  if (start && end && start.gte > end.gte) throw badRequest(`${fromName} must not be later than ${toName}.`, 'DATE_RANGE_INVALID');
  if (!start && !end) return undefined;
  return { ...(start && { gte: start.gte }), ...(end && { lte: end.lte }) };
}
