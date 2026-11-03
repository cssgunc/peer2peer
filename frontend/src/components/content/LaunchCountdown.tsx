"use client";

import Countdown from "@/components/content/Countdown";
import { useLineStatus } from "@/lib/useLineStatus";

/** Home's launch countdown: shown only while the line hasn't launched yet (TDD 5.1). */
export default function LaunchCountdown() {
  const { data } = useLineStatus();
  // Loading, error, launched, or no date: show nothing rather than a guess.
  if (!data || data.line_launched || !data.line_launch_at) return null;

  return (
    <section aria-labelledby="launch-countdown-heading">
      <h2 id="launch-countdown-heading" className="mb-4 text-2xl font-semibold">
        Opening soon
      </h2>
      <Countdown target={data.line_launch_at} />
    </section>
  );
}
