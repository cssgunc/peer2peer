import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  daysInclusive,
  formatDateOnly,
  formatDuration,
  toDateOnly,
} from "./dates";

describe("formatDateOnly", () => {
  const originalTz = process.env.TZ;
  // West of UTC, where parsing "YYYY-MM-DD" as UTC midnight lands on the previous day.
  beforeAll(() => {
    process.env.TZ = "America/New_York";
  });
  afterAll(() => {
    process.env.TZ = originalTz;
  });

  it("keeps the calendar date in a time zone west of UTC", () => {
    expect(new Date(2026, 10, 1).getTimezoneOffset()).toBeGreaterThan(0);
    expect(formatDateOnly("2026-11-01")).toBe("Nov 1, 2026");
    expect(formatDateOnly("2027-01-01")).toBe("Jan 1, 2027");
  });
});

describe("toDateOnly", () => {
  it("uses the local calendar date", () => {
    expect(toDateOnly(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});

describe("daysInclusive", () => {
  it("counts both ends, across a DST change", () => {
    expect(daysInclusive("2026-11-01", "2026-11-01")).toBe(1);
    expect(daysInclusive("2026-10-30", "2026-11-05")).toBe(7);
    expect(daysInclusive("2026-11-05", "2026-11-01")).toBe(-3);
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes, and hours", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(42.4)).toBe("42s");
    expect(formatDuration(120)).toBe("2m");
    expect(formatDuration(150)).toBe("2m 30s");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(3900)).toBe("1h 5m");
  });
});
