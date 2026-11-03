import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLineStatus } from "@/lib/useLineStatus";

import LaunchCountdown from "./LaunchCountdown";

vi.mock("@/lib/useLineStatus", () => ({ useLineStatus: vi.fn() }));

const NOW = new Date("2026-11-03T19:00:00Z");
const beforeLaunch = {
  is_online: false,
  next_open_at: null,
  line_launched: false,
  line_launch_at: "2026-11-10T23:00:00Z",
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

function renderWith(state: ReturnType<typeof useLineStatus>) {
  vi.mocked(useLineStatus).mockReturnValue(state);
  const view = render(<LaunchCountdown />);
  act(() => {});
  return view;
}

describe("LaunchCountdown", () => {
  it("shows the countdown to line_launch_at before the line launches", () => {
    renderWith({ status: "ready", data: beforeLaunch });

    expect(
      screen.getByRole("heading", { level: 2, name: "Opening soon" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/November 10, 2026/)).toBeInTheDocument();
  });

  it("renders nothing once the line has launched", () => {
    const { container } = renderWith({
      status: "ready",
      data: { ...beforeLaunch, line_launched: true },
    });

    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    { status: "loading", data: null },
    { status: "error", data: null },
  ] as const)("renders nothing while $status", (state) => {
    const { container } = renderWith(state);

    expect(container).toBeEmptyDOMElement();
  });
});
