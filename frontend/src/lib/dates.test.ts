import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { formatDateOnly } from "./dates";

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
