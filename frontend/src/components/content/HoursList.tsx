export type Hours = {
  timezone: string;
  weekly: {
    day_of_week: number;
    opens_at: string;
    closes_at: string;
  }[];

  exceptions: {
    date: string;
    is_closed: boolean;
    opens_at: string | null;
    closes_at: string | null;
    note: string | null;
  }[];
};

function formatTime(time: string): string {
  const [hourText, minute] = time.split(":");
  const hour = Number(hourText);

  let displayHour = hour;
  if (displayHour === 0) {
    displayHour = 12;
  } else if (displayHour > 12) {
    displayHour -= 12;
  }

  const period = hour >= 12 ? "PM" : "AM";
  return `${displayHour}:${minute} ${period}`;
}

function minutesAfterMidnight(time: string): number {
  const [hourText, minuteText] = time.split(":");

  return Number(hourText) * 60 + Number(minuteText);
}

function isOvernight(opensAt: string, closesAt: string): boolean {
  return minutesAfterMidnight(opensAt) > minutesAfterMidnight(closesAt);
}

function getTodayInTimezone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("Unable to determine today's date.");
  }

  return `${year}-${month}-${day}`;
}

function addCalendarDays(isoDate: string, amount: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount); //avoids daylight saving changes by using UTC
  return date.toISOString().slice(0, 10);
}

const days = [
  { number: 0, label: "Monday" },
  { number: 1, label: "Tuesday" },
  { number: 2, label: "Wednesday" },
  { number: 3, label: "Thursday" },
  { number: 4, label: "Friday" },
  { number: 5, label: "Saturday" },
  { number: 6, label: "Sunday" },
];

export default function HoursList({ hours }: { hours: Hours }) {
  const today = getTodayInTimezone(hours.timezone);
  const lastdate = addCalendarDays(today, 13);

  const upcomingExceptions = hours.exceptions.filter(
    (exception) => exception.date >= today && exception.date <= lastdate,
  );
  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {days.map((day) => {
          const windowsForDay = hours.weekly.filter(
            (window) => window.day_of_week === day.number,
          );
          return (
            <li key={day.number}>
              <span className="font-semibold">{day.label}</span>

              {windowsForDay.length === 0 ? (
                <span className="block">Closed</span>
              ) : (
                windowsForDay.map((window) => (
                  <span
                    key={`${day.number}-${window.opens_at}-${window.closes_at}`}
                    className="block"
                  >
                    {formatTime(window.opens_at)} to{" "}
                    {formatTime(window.closes_at)}
                    {isOvernight(window.opens_at, window.closes_at) && (
                      <span> (Ends the following day) </span>
                    )}
                  </span>
                ))
              )}
            </li>
          );
        })}
      </ul>

      {/* Exceptions section */}
      {upcomingExceptions.length > 0 && (
        <div>
          <h3 className="font-semibold">Upcoming Schedule Changes</h3>
          <ul className="space-y-2">
            {upcomingExceptions.map((exception) => {
              const date = new Intl.DateTimeFormat("en-US", {
                timeZone: "UTC",
                month: "short",
                day: "numeric",
              }).format(new Date(`${exception.date}T00:00:00Z`));
              const noteSuffix = exception.note ? ` for ${exception.note}` : "";

              if (exception.is_closed) {
                return (
                  <li key={exception.date}>
                    Closed {date}
                    {noteSuffix}
                  </li>
                );
              }

              if (exception.opens_at !== null && exception.closes_at !== null) {
                return (
                  <li key={exception.date}>
                    Open {date} from {formatTime(exception.opens_at)} to{" "}
                    {formatTime(exception.closes_at)}
                    {noteSuffix}
                  </li>
                );
              }

              return (
                <li key={exception.date}>
                  Open {date}
                  {exception.note ? `: ${exception.note}` : ""}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
