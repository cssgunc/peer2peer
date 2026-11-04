"use client";

import { useEffect, useState } from "react";

const TICK_MS = 15_000;
const MINUTE_MS = 60_000;

const launchFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

type Remaining = { days: number; hours: number; minutes: number };

function remaining(target: number, now: number): Remaining | null {
  const ms = target - now;
  if (ms <= 0) return null;
  // Round up, so a target under a minute away reads "1 minute" instead of all zeros.
  const totalMinutes = Math.ceil(ms / MINUTE_MS);
  return {
    days: Math.floor(totalMinutes / (24 * 60)),
    hours: Math.floor(totalMinutes / 60) % 24,
    minutes: totalMinutes % 60,
  };
}

function plural(count: number, unit: string) {
  return count === 1 ? unit : `${unit}s`;
}

/** Days, hours, and minutes until `target` (an ISO date string). Renders nothing once it passes. */
export default function Countdown({ target }: { target: string }) {
  const targetMs = Date.parse(target);
  // Starts empty and fills in after mount, so the server and client renders always match.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(targetMs)) return;
    let finish: number | undefined;
    function tick() {
      const current = Date.now();
      setNow(current);
      const left = targetMs - current;
      if (left <= 0) {
        window.clearInterval(interval);
      } else if (left < TICK_MS && finish === undefined) {
        // Hide right at the target instead of up to one tick late.
        finish = window.setTimeout(tick, left);
      }
    }
    const interval = window.setInterval(tick, TICK_MS);
    tick();
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(finish);
    };
  }, [targetMs]);

  if (now === null || !Number.isFinite(targetMs)) return null;
  const left = remaining(targetMs, now);
  if (left === null) return null;

  const parts: [number, string][] = [
    [left.days, "day"],
    [left.hours, "hour"],
    [left.minutes, "minute"],
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* The date is the stable, readable version. The numbers below change every update, so
          they deliberately have no aria-live: screen readers aren't interrupted by each tick. */}
      <p>
        Peer2Peer opens on{" "}
        <time dateTime={target}>
          {launchFormatter.format(new Date(targetMs))}
        </time>{" "}
        Eastern time.
      </p>
      <ul className="grid grid-cols-3 gap-3 text-center">
        {parts.map(([count, unit]) => (
          <li key={unit} className="rounded-lg border bg-card p-3">
            <span className="block text-3xl font-semibold tabular-nums">
              {count}
            </span>{" "}
            <span className="text-sm text-muted-foreground">
              {plural(count, unit)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
