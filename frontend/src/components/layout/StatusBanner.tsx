"use client";

import Link from "next/link";

import { useLineStatus } from "@/lib/useLineStatus";

const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "long",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
});

const launchFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "long",
  day: "numeric",
  year: "numeric",
});

export function StatusBanner() {
  const { data, status } = useLineStatus();
  const online = data?.line_launched === true && data.is_online;
  let message =
    status === "error"
      ? "We can't confirm the line's availability right now."
      : "We're checking the line's availability.";

  if (data) {
    if (!data.line_launched && data.line_launch_at) {
      message = `Peer2Peer opens on ${launchFormatter.format(new Date(data.line_launch_at))} (Eastern time).`;
    } else if (online) {
      message = "Responders are online now";
    } else {
      message = "We're offline right now.";
      if (data.next_open_at) {
        const opening = new Date(data.next_open_at);
        message += ` We're next open ${weekdayFormatter.format(opening)} at ${timeFormatter.format(opening)} Eastern time.`;
      }
    }
  }

  return (
    <div
      role="status"
      aria-atomic="true"
      className={
        online
          ? "border-b bg-primary text-primary-foreground"
          : "border-b bg-secondary text-secondary-foreground"
      }
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-6 sm:px-6">
        <p>{message}</p>
        {online ? (
          <Link
            href="/text-us"
            className="inline-flex min-h-11 items-center self-start rounded-sm font-semibold underline underline-offset-4 focus-visible:outline-current"
          >
            Text Us
          </Link>
        ) : (
          <p>Need help now? Call or text 988.</p>
        )}
      </div>
    </div>
  );
}
