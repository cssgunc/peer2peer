import HoursList, { type Hours } from "@/components/content/HoursList";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const sampleHours: Hours = {
  timezone: "America/New_York",
  weekly: [],
  exceptions: [],
};

const expectedDays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

it("renders the days Monday through Sunday in order", () => {
  render(<HoursList hours={sampleHours} />);

  const rows = screen.getAllByRole("listitem");
  const renderedDays = rows.map((row) => row.firstElementChild?.textContent);

  expect(renderedDays).toEqual(expectedDays);
});

/** Test for no windows on Tuesday */
const sampleHours2: Hours = {
  timezone: "America/New_York",
  weekly: [
    { day_of_week: 0, opens_at: "19:00:00", closes_at: "23:00:00" }, // Monday
    { day_of_week: 2, opens_at: "20:00:00", closes_at: "23:00:00" }, // Wednesday
    { day_of_week: 3, opens_at: "19:00:00", closes_at: "21:00:00" }, // Thursday
    { day_of_week: 4, opens_at: "19:00:00", closes_at: "21:00:00" }, // Friday
    { day_of_week: 5, opens_at: "18:00:00", closes_at: "21:00:00" }, // Saturday
    { day_of_week: 6, opens_at: "8:00:00", closes_at: "21:00:00" }, // Sunday
  ],
  exceptions: [],
};

it("shows no windows on Tuesday, windows on all other days", () => {
  render(<HoursList hours={sampleHours2} />);

  const rows = screen.getAllByRole("listitem");
  const expectedSchedules = [
    "7:00 PM to 11:00 PM", // Mon
    "Closed", // Tues
    "8:00 PM to 11:00 PM", // Wednesday
    "7:00 PM to 9:00 PM", // Thursday
    "7:00 PM to 9:00 PM", // Friday
    "6:00 PM to 9:00 PM", // Sat
    "8:00 AM to 9:00 PM", // Sun
  ];

  expectedSchedules.forEach((schedule, index) => {
    expect(rows[index]?.textContent).toContain(schedule);
  });

  expect(screen.getAllByText("Closed")).toHaveLength(1);
});

/** Two Windows Test */
const sample_two_windows: Hours = {
  timezone: "America/New_York",
  weekly: [
    { day_of_week: 2, opens_at: "8:00:00", closes_at: "12:00:00" },
    { day_of_week: 2, opens_at: "16:00:00", closes_at: "23:00:00" },
  ],
  exceptions: [],
};

it("shows two windows on Wednesday, all other days closed", () => {
  render(<HoursList hours={sample_two_windows} />);

  const rows = screen.getAllByRole("listitem");
  const expectedSchedule = [
    "Closed",
    "Closed",
    "8:00 AM to 12:00 PM",
    "Closed",
    "Closed",
    "Closed",
    "Closed",
  ];

  expectedSchedule.forEach((schedule, index) => {
    expect(rows[index]?.textContent).toContain(schedule);
  });

  expect(rows[2]?.textContent).toContain("4:00 PM to 11:00 PM");
  expect(screen.getAllByText("Closed")).toHaveLength(6);
});

/** Ends the next day test */
const sample_ends_next_day: Hours = {
  timezone: "America/New_York",
  weekly: [{ day_of_week: 0, opens_at: "18:00:00", closes_at: "1:00:00" }],
  exceptions: [],
};
it("shows Monday shift ends the next day", () => {
  render(<HoursList hours={sample_ends_next_day} />);

  const rows = screen.getAllByRole("listitem");
  const expectedSchedule = [
    "6:00 PM to 1:00 AM (Ends the following day)",
    "Closed",
    "Closed",
    "Closed",
    "Closed",
    "Closed",
    "Closed",
  ];

  expectedSchedule.forEach((schedule, index) => {
    expect(rows[index]?.textContent).toContain(schedule);
  });
  expect(screen.getAllByText("Closed")).toHaveLength(6);
});

/** Exceptions within next 14 days */
it("shows an exception within the next 14 days", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-15T12:00:00.000Z"));

  const hours: Hours = {
    ...sampleHours,
    exceptions: [
      {
        date: "2026-11-26",
        is_closed: true,
        opens_at: null,
        closes_at: null,
        note: "Thanksgiving",
      },
    ],
  };

  render(<HoursList hours={hours} />);

  expect(screen.getByText("Closed Nov 26 for Thanksgiving")).toBeTruthy();
});

it("leaves out an exception from a past date", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T12:00:00.000Z"));

  const hours: Hours = {
    ...sampleHours,
    exceptions: [
      {
        date: "2026-10-26",
        is_closed: true,
        opens_at: null,
        closes_at: null,
        note: "Staff training",
      },
    ],
  };

  render(<HoursList hours={hours} />);

  expect(screen.queryByText("Closed Oct 26 for Staff training")).toBeNull();
  expect(
    screen.queryByRole("heading", { name: "Upcoming Schedule Changes" }),
  ).toBeNull();
});
