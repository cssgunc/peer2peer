import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api";
import { IDLE_WARNING_MS } from "@/lib/portal/constants";

import { ACTIVITY_THROTTLE_MS, IdleWarning, KEEPALIVE_MS } from "./IdleWarning";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
}));
vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

const MINUTE = 60_000;

// A stand-in BroadcastChannel so tests can see what's sent and deliver messages from "other tabs".
class FakeChannel {
  static instances: FakeChannel[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  posted: unknown[] = [];
  closed = false;
  constructor(public name: string) {
    FakeChannel.instances.push(this);
  }
  postMessage(data: unknown) {
    this.posted.push(data);
  }
  close() {
    this.closed = true;
  }
  receive(data: unknown) {
    act(() => this.onmessage?.({ data } as MessageEvent));
  }
}

let queryClient: QueryClient;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-11T19:00:00Z") });
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  FakeChannel.instances = [];
  queryClient = new QueryClient();
  vi.mocked(apiFetch).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderWarning() {
  return render(
    <QueryClientProvider client={queryClient}>
      <IdleWarning />
    </QueryClientProvider>,
  );
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

async function flush() {
  await act(async () => {});
}

const dialog = () => screen.queryByRole("alertdialog");
const apiCalls = (path: string) =>
  vi.mocked(apiFetch).mock.calls.filter(([url]) => url === path);

describe("IdleWarning", () => {
  it("opens the warning at 28 minutes with a live countdown", () => {
    renderWarning();

    advance(28 * MINUTE - 1_000);
    expect(dialog()).toBeNull();

    advance(1_000);
    expect(dialog()).toHaveTextContent("You'll be signed out in 2 minutes");
    expect(dialog()).toHaveTextContent("2:00");

    advance(30_000);
    expect(dialog()).toHaveTextContent("1:30");
    // The changing numbers stay out of live regions.
    expect(dialog()!.querySelector("[aria-live]")).toBeNull();
  });

  it("resets the timer on activity", () => {
    renderWarning();
    advance(20 * MINUTE);

    fireEvent.keyDown(window, { key: "a" });
    advance(27 * MINUTE);
    expect(dialog()).toBeNull(); // only 27 minutes since the key press

    advance(1 * MINUTE);
    expect(dialog()).not.toBeNull();
  });

  it.each(["mouseMove", "mouseDown", "touchStart", "scroll", "wheel"] as const)(
    "counts %s as activity",
    (event) => {
      renderWarning();
      advance(20 * MINUTE);

      fireEvent[event](window);
      advance(27 * MINUTE);

      expect(dialog()).toBeNull();
    },
  );

  it("throttles activity so constant movement isn't recorded every time", () => {
    renderWarning();
    advance(10 * MINUTE);
    fireEvent.mouseMove(window);
    advance(1_000);
    fireEvent.mouseMove(window); // within 5 seconds: ignored

    const [channel] = FakeChannel.instances;
    expect(channel.posted).toHaveLength(1);
  });

  it('"Stay signed in" calls me once and closes the warning', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ id: "me", shift: null });
    renderWarning();
    advance(28 * MINUTE);

    fireEvent.click(screen.getByRole("button", { name: "Stay signed in" }));
    await flush();

    expect(apiCalls("/api/auth/me")).toHaveLength(1);
    expect(dialog()).toBeNull();
    advance(27 * MINUTE);
    expect(dialog()).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it("keeps the warning up through stray mouse movement", () => {
    renderWarning();
    advance(28 * MINUTE);

    fireEvent.mouseMove(window);
    advance(1_000);

    expect(dialog()).not.toBeNull();
  });

  it("signs out at 30 minutes and goes to the sign-in page", async () => {
    const clear = vi.spyOn(queryClient, "clear");
    renderWarning();

    advance(30 * MINUTE);
    await flush();

    expect(apiFetch).toHaveBeenCalledWith("/api/auth/sign-out", {
      method: "POST",
    });
    expect(clear).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith("/portal/sign-in?reason=idle");

    advance(5_000);
    await flush();
    expect(apiCalls("/api/auth/sign-out")).toHaveLength(1); // only once
  });

  it("signs out right away after waking from sleep past the limit", async () => {
    renderWarning();

    // The clock jumps without timers running, like a laptop asleep for 45 minutes.
    vi.setSystemTime(Date.now() + 45 * MINUTE);
    advance(1_000);
    await flush();

    expect(replace).toHaveBeenCalledWith("/portal/sign-in?reason=idle");
  });

  it("shares activity with other tabs and keeps this tab signed in when another is used", () => {
    renderWarning();
    const [channel] = FakeChannel.instances;
    expect(channel.name).toBe("p2p-portal-activity");

    advance(10 * MINUTE);
    fireEvent.mouseMove(window);
    expect(channel.posted).toEqual([{ type: "activity", at: Date.now() }]);

    advance(28 * MINUTE); // 28 minutes idle in this tab
    expect(dialog()).not.toBeNull();

    channel.receive({ type: "activity", at: Date.now() }); // someone working in another tab
    expect(dialog()).toBeNull();
    advance(27 * MINUTE);
    expect(dialog()).toBeNull();
  });

  it("refreshes the server session while the person stays active", () => {
    renderWarning();

    advance(KEEPALIVE_MS - 10_000);
    fireEvent.mouseMove(window);
    expect(apiCalls("/api/auth/me")).toHaveLength(0);

    advance(10_000);
    fireEvent.mouseMove(window);
    expect(apiCalls("/api/auth/me")).toHaveLength(1);
  });

  it("keeps the server's last-seen close enough that the warning opens first", () => {
    // Mirrors LAST_SEEN_THROTTLE in backend/app/services/sessions.py.
    const LAST_SEEN_THROTTLE_MS = 60_000;
    expect(
      KEEPALIVE_MS + ACTIVITY_THROTTLE_MS + LAST_SEEN_THROTTLE_MS,
    ).toBeLessThan(IDLE_WARNING_MS);

    // Read and scroll for 4.5 minutes without the page making any request.
    renderWarning();
    const meCallTimes: number[] = [];
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path === "/api/auth/me") meCallTimes.push(Date.now());
      return undefined as never;
    });
    const start = Date.now();
    for (let t = 0; t < 4.5 * MINUTE; t += 1_000) {
      advance(1_000);
      fireEvent.scroll(window);
    }
    const lastActivity = Date.now();

    // The session was refreshed throughout, and recently enough when they stepped away.
    expect(meCallTimes.length).toBeGreaterThanOrEqual(8);
    expect(meCallTimes[0] - start).toBeLessThanOrEqual(
      KEEPALIVE_MS + ACTIVITY_THROTTLE_MS,
    );
    expect(lastActivity - meCallTimes.at(-1)!).toBeLessThanOrEqual(
      KEEPALIVE_MS + ACTIVITY_THROTTLE_MS,
    );
  });

  it("cleans up its timer, listeners, and channel when unmounted", () => {
    const { unmount } = renderWarning();
    const [channel] = FakeChannel.instances;

    unmount();

    expect(vi.getTimerCount()).toBe(0);
    expect(channel.closed).toBe(true);
  });
});

it("keeps one channel and one clock across re-renders", () => {
  const { rerender } = renderWarning();
  advance(20 * MINUTE);

  rerender(
    <QueryClientProvider client={queryClient}>
      <IdleWarning />
    </QueryClientProvider>,
  );
  advance(8 * MINUTE);

  expect(FakeChannel.instances).toHaveLength(1);
  expect(dialog()).not.toBeNull(); // 28 minutes, not 8
});
