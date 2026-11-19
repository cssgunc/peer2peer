/**
 * Formats a date-only "YYYY-MM-DD" string, e.g. "Nov 1, 2026".
 *
 * Not `new Date("YYYY-MM-DD")`: that parses as UTC midnight, which is the previous
 * evening in US time zones, so the date would show a day early.
 */
export function formatDateOnly(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    new Date(year, month - 1, day),
  );
}
