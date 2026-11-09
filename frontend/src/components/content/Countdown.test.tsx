import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Countdown from "./Countdown";

// 2:00 PM Eastern on Nov 3, 2026.
const NOW = new Date("2026-11-03T19:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderCountdown(target: string) {
  const view = render(<Countdown target={target} />);
  // Let the mount effect read the clock.
  act(() => {});
  return view;
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function counts() {
  return screen.getAllByRole("listitem").map((item) => item.textContent);
}

describe("Countdown", () => {
  it("counts down the days, hours, and minutes", () => {
    // 2 days, 3 hours, 4 minutes away.
    renderCountdown("2026-11-05T22:04:00Z");
    expect(counts()).toEqual(["2 days", "3 hours", "4 minutes"]);

    advance(60_000);
    expect(counts()).toEqual(["2 days", "3 hours", "3 minutes"]);

    advance(3 * 60_000 + 24 * 60 * 60_000);
    expect(counts()).toEqual(["1 day", "3 hours", "0 minutes"]);
  });

  it("updates every 15 seconds, not on every second", () => {
    renderCountdown("2026-11-03T19:01:01Z"); // 61 seconds away, so it reads 2 minutes
    expect(counts()).toEqual(["0 days", "0 hours", "2 minutes"]);

    advance(14_999); // a per-second timer would already show 1 minute here
    expect(counts()).toEqual(["0 days", "0 hours", "2 minutes"]);
    advance(1); // the 15-second tick
    expect(counts()).toEqual(["0 days", "0 hours", "1 minute"]);
  });

  it("writes out the target in Eastern time and keeps the numbers out of live regions", () => {
    const { container } = renderCountdown("2026-11-10T23:00:00Z");

    expect(screen.getByText(/Peer2Peer opens on/).textContent).toBe(
      "Peer2Peer opens on Tuesday, November 10, 2026 at 6:00 PM Eastern time.",
    );
    expect(container.querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-11-10T23:00:00Z",
    );
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(container.querySelector("[role=status]")).toBeNull();
  });

  it("shows 1 minute when the target is less than a minute away, then disappears at the target", () => {
    // 20 seconds away, so the target falls between two 15-second ticks.
    const { container } = renderCountdown("2026-11-03T19:00:20Z");
    expect(counts()).toEqual(["0 days", "0 hours", "1 minute"]);

    advance(19_999);
    expect(container).not.toBeEmptyDOMElement();
    advance(1); // exactly the target, not at the next tick 10 seconds later
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing once the target has passed", () => {
    const { container } = renderCountdown("2026-11-03T18:59:00Z");

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a date it can't read", () => {
    const { container } = renderCountdown("not a date");

    expect(container).toBeEmptyDOMElement();
  });

  it("stops its timers when unmounted", () => {
    const { unmount } = renderCountdown("2026-11-05T22:04:00Z");

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("also stops the end-of-countdown timer when unmounted", () => {
    const { unmount } = renderCountdown("2026-11-03T19:00:20Z");
    advance(15_000); // inside the last tick, so the timer for the target is scheduled
    expect(vi.getTimerCount()).toBe(2);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
