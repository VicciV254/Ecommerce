import { describe, expect, it } from "vitest";
import { formatNairobiClock, formatNairobiDate, formatNairobiRange, isCalendarDate, nairobiDate } from "./nairobiDate";

/* Every instant is written in UTC; Nairobi is UTC+3 all year, so its day starts at 21:00Z the day before. */
describe("Nairobi dates", () => {
  it("reads the Nairobi calendar date of an instant, across the UTC boundary", () => {
    expect(nairobiDate("2026-10-31T21:30:00.000Z")).toBe("2026-11-01");
    expect(nairobiDate("2026-10-31T20:59:59.999Z")).toBe("2026-10-31");
    expect(nairobiDate("2026-12-31T21:00:00.000Z")).toBe("2027-01-01");
    expect(nairobiDate("2028-02-28T21:00:00.000Z")).toBe("2028-02-29");
  });

  it("accepts only real YYYY-MM-DD dates", () => {
    for (const value of ["2026-11-01", "2028-02-29", "2026-12-31"]) expect(isCalendarDate(value), value).toBe(true);
    for (const value of ["2026-02-30", "2026-02-29", "2026-13-01", "2026-00-10", "2026-11-31", "2026-1-01", "26-11-01", "", " 2026-11-01", "2026-11-01T00:00"]) {
      expect(isCalendarDate(value), value).toBe(false);
    }
  });

  it("says a range in words, naming each month and year once", () => {
    expect(formatNairobiRange("2026-10-31T21:00:00.000Z", "2026-11-17T11:05:00.000Z")).toBe("1–17 November 2026");
    expect(formatNairobiRange("2026-11-16T21:00:00.000Z", "2026-11-17T11:05:00.000Z")).toBe("17 November 2026");
    expect(formatNairobiRange("2026-10-25T21:00:00.000Z", "2026-11-01T07:00:00.000Z")).toBe("26 October – 1 November 2026");
    expect(formatNairobiRange("2026-12-27T21:00:00.000Z", "2027-01-01T09:00:00.000Z")).toBe("28 December 2026 – 1 January 2027");
    expect(formatNairobiRange("2025-12-31T21:00:00.000Z", "2026-11-17T11:05:00.000Z")).toBe("1 January – 17 November 2026");
  });

  it("gives the Nairobi date and 24-hour time of an instant", () => {
    expect(formatNairobiDate("2026-10-31T21:30:00.000Z")).toBe("1 November 2026");
    expect(formatNairobiClock("2026-11-17T11:05:00.000Z")).toBe("14:05");
    expect(formatNairobiClock("2026-11-16T21:00:00.000Z")).toBe("00:00");
  });
});
