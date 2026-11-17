/**
 * Dates as the store counts them: Nairobi calendar days (Africa/Nairobi, East Africa Time, UTC+3 all year). Staff
 * figures, ranges and date filters use these whatever the device's own time zone.
 */
export const NAIROBI_TIME_ZONE = "Africa/Nairobi";

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real `YYYY-MM-DD` date: 2026-02-30 and 2026-13-01 are not. */
export function isCalendarDate(value: string): boolean {
  const match = DAY_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const nairobi = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: NAIROBI_TIME_ZONE, ...options });
const NUMERIC_DATE = nairobi({ year: "numeric", month: "2-digit", day: "2-digit" });
const DAY = nairobi({ day: "numeric" });
const DAY_MONTH = nairobi({ day: "numeric", month: "long" });
const FULL_DATE = nairobi({ day: "numeric", month: "long", year: "numeric" });
const SHORT_DATE = nairobi({ day: "numeric", month: "short", year: "numeric" });
const CLOCK = nairobi({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** The Nairobi calendar date of an instant, as `YYYY-MM-DD`. */
export function nairobiDate(iso: string): string {
  const parts = Object.fromEntries(NUMERIC_DATE.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** "17 November 2026" for the Nairobi date of an instant. */
export const formatNairobiDate = (iso: string) => FULL_DATE.format(new Date(iso));

/** "14:05", the Nairobi time of an instant. */
export const formatNairobiClock = (iso: string) => CLOCK.format(new Date(iso));

/** "17 Nov 2026, 14:05": the Nairobi date and time of an instant, for staff records. */
export const formatNairobiDateTime = (iso: string) => `${SHORT_DATE.format(new Date(iso))}, ${formatNairobiClock(iso)}`;

/**
 * The Nairobi dates from `startIso` to `endIso` in words, naming each month and year once: "1–17 November 2026",
 * "27 October – 2 November 2026", "29 December 2025 – 4 January 2026", or "17 November 2026" for one day.
 */
export function formatNairobiRange(startIso: string, endIso: string): string {
  const [start, end] = [nairobiDate(startIso), nairobiDate(endIso)];
  const [first, last] = [new Date(startIso), new Date(endIso)];
  if (start === end) return FULL_DATE.format(first);
  if (start.slice(0, 7) === end.slice(0, 7)) return `${DAY.format(first)}–${FULL_DATE.format(last)}`;
  if (start.slice(0, 4) === end.slice(0, 4)) return `${DAY_MONTH.format(first)} – ${FULL_DATE.format(last)}`;
  return `${FULL_DATE.format(first)} – ${FULL_DATE.format(last)}`;
}
