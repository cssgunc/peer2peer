import { StrictMode } from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LineStatus } from "@/lib/useLineStatus";

import { StatusBanner } from "./StatusBanner";

const offline: LineStatus = {
  is_online: false,
  next_open_at: "2026-10-27T23:00:00Z",
  line_launched: true,
  line_launch_at: null,
};
const online: LineStatus = { ...offline, is_online: true };
const fetchMock = vi.fn<typeof fetch>();

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function renderBanner() {
  const view = render(<StatusBanner />);
  await act(async () => {});
  return view;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setHidden(hidden: boolean) {
  vi.spyOn(document, "hidden", "get").mockReturnValue(hidden);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
}

function expectUnknown() {
  const banner = screen.getByRole("status");
  expect(banner).toHaveTextContent("Need help now? Call or text 988.");
  expect(banner).not.toHaveTextContent("Responders are online now");
  expect(within(banner).queryByRole("link", { name: "Text Us" })).toBeNull();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("StatusBanner", () => {
  it("shows a neutral message and 988 while loading", () => {
    fetchMock.mockReturnValue(deferredResponse().promise);
    render(<StatusBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "We're checking the line's availability.",
    );
    expectUnknown();
  });

  it("announces confirmed availability and links to Text Us", async () => {
    fetchMock.mockResolvedValue(json(online));
    await renderBanner();
    const banner = screen.getByRole("status");
    expect(banner).toHaveAttribute("aria-atomic", "true");
    expect(banner).toHaveTextContent("Responders are online now");
    expect(
      within(banner).getByRole("link", { name: "Text Us" }),
    ).toHaveAttribute("href", "/text-us");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/status",
      expect.objectContaining({
        credentials: "omit",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    ["2026-10-27T23:00:00Z", "Tuesday at 7:00 PM"],
    ["2026-11-04T00:00:00Z", "Tuesday at 7:00 PM"],
  ])(
    "formats the next opening in Eastern time: %s",
    async (timestamp, text) => {
      fetchMock.mockResolvedValue(
        json({ ...offline, next_open_at: timestamp }),
      );
      await renderBanner();
      expect(screen.getByRole("status")).toHaveTextContent(
        `We're offline right now. We're next open ${text} Eastern time.`,
      );
      expectUnknown();
    },
  );

  it("omits the next opening when none is scheduled", async () => {
    fetchMock.mockResolvedValue(json({ ...offline, next_open_at: null }));
    await renderBanner();
    expect(screen.getByRole("status")).toHaveTextContent(
      "We're offline right now.",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent("next open");
    expectUnknown();
  });

  it("prioritizes the launch date over online presence and uses the Eastern date", async () => {
    fetchMock.mockResolvedValue(
      json({
        ...online,
        line_launched: false,
        line_launch_at: "2026-11-02T01:00:00Z",
      }),
    );
    await renderBanner();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Peer2Peer opens on November 1, 2026 (Eastern time).",
    );
    expectUnknown();
  });

  it("shows a neutral error on the first failed request", async () => {
    fetchMock.mockRejectedValue(new TypeError("Network unavailable"));
    await renderBanner();
    expect(screen.getByRole("status")).toHaveTextContent(
      "We can't confirm the line's availability right now.",
    );
    expectUnknown();
  });

  it("polls every 30 seconds and replaces online with offline", async () => {
    fetchMock
      .mockResolvedValueOnce(json(online))
      .mockImplementation(async () => json(offline));
    await renderBanner();
    await advance(29_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent(
      "We're offline right now.",
    );
    await advance(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("clears online after a failed refresh and recovers on the next poll", async () => {
    fetchMock
      .mockResolvedValueOnce(json(online))
      .mockRejectedValueOnce(new TypeError("Network unavailable"))
      .mockResolvedValueOnce(json(online));
    await renderBanner();
    await advance(30_000);
    expectUnknown();
    expect(screen.getByRole("status")).toHaveTextContent("We can't confirm");
    await advance(30_000);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Responders are online now",
    );
  });

  it("does not use an online body from an HTTP error", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(online), { status: 503 }),
    );
    await renderBanner();
    expectUnknown();
  });

  it.each([
    null,
    { is_online: true },
    { ...online, is_online: "true" },
    { ...online, line_launched: "true" },
    { ...online, next_open_at: "not a date" },
    { ...online, next_open_at: "2026-10-27T19:00:00" },
    { ...online, line_launch_at: "invalid" },
    { ...online, line_launched: false, line_launch_at: null },
  ])("rejects malformed status responses: %j", async (data) => {
    fetchMock
      .mockResolvedValueOnce(json(online))
      .mockResolvedValueOnce(json(data));
    await renderBanner();
    await advance(30_000);
    expectUnknown();
    expect(screen.getByRole("status")).toHaveTextContent("We can't confirm");
  });

  it("rejects a response that is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Unavailable</html>"));
    await renderBanner();
    expectUnknown();
  });

  it("pauses while hidden and clears old online information before refreshing", async () => {
    const resumed = deferredResponse();
    fetchMock
      .mockResolvedValueOnce(json(online))
      .mockReturnValueOnce(resumed.promise);
    await renderBanner();
    setHidden(true);
    await advance(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    setHidden(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expectUnknown();
    await act(async () => resumed.resolve(json(offline)));
    expect(screen.getByRole("status")).toHaveTextContent(
      "We're offline right now.",
    );
  });

  it("does not fetch if mounted in a hidden tab", async () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    fetchMock.mockResolvedValue(json(offline));
    await renderBanner();
    await advance(60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    setHidden(false);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores an old request that finishes after the tab resumes", async () => {
    const old = deferredResponse();
    fetchMock
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(json(offline));
    await renderBanner();
    const signal = fetchMock.mock.calls[0][1]?.signal;
    setHidden(true);
    expect(signal?.aborted).toBe(true);
    setHidden(false);
    await act(async () => {});
    await act(async () => old.resolve(json(online)));
    expect(screen.getByRole("status")).toHaveTextContent(
      "We're offline right now.",
    );
    expectUnknown();
  });

  it("times out a stalled refresh and ignores its late online response", async () => {
    const stalled = deferredResponse();
    fetchMock
      .mockResolvedValueOnce(json(online))
      .mockReturnValueOnce(stalled.promise);
    await renderBanner();
    await advance(30_000);
    await advance(10_000);
    expect(fetchMock.mock.calls[1][1]?.signal?.aborted).toBe(true);
    expectUnknown();
    await act(async () => stalled.resolve(json(online)));
    expectUnknown();
    expect(screen.getByRole("status")).toHaveTextContent("We can't confirm");
  });

  it("cleans up requests, timers, and visibility listeners on unmount", async () => {
    fetchMock.mockReturnValue(deferredResponse().promise);
    const { unmount } = await renderBanner();
    const signal = fetchMock.mock.calls[0][1]?.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    setHidden(true);
    setHidden(false);
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps one polling loop after Strict Mode re-runs the effect", async () => {
    fetchMock.mockImplementation(async () => json(offline));
    render(
      <StrictMode>
        <StatusBanner />
      </StrictMode>,
    );
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    await advance(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
