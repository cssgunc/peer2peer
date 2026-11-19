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

/** Formats a `Date` as a local date-only "YYYY-MM-DD" string. */
export function toDateOnly(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Days from `start` to `end` for date-only strings, counting both ends (Nov 1–Nov 7 is 7). */
export function daysInclusive(start: string, end: string): number {
  const toUtc = (isoDate: string) => {
    const [year, month, day] = isoDate.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(end) - toUtc(start)) / 86_400_000) + 1;
}

/** Formats seconds as a short duration, e.g. 150 → "2m 30s", 3900 → "1h 5m"; null → "—". */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  return `${secs}s`;
}
