import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LineAnalytics } from "@/lib/portal/queries";

import { AnalyticsDashboard } from "./AnalyticsDashboard";

// A stand-in for the Next router: replace changes the URL that useSearchParams reads.
const navigation = vi.hoisted(() => {
  let search = "";
  const listeners = new Set<() => void>();
  const setSearch = (value: string) => {
    search = value;
    for (const listener of listeners) listener();
  };
  return {
    router: {
      replace: vi.fn((href: string) =>
        setSearch(new URL(href, "http://x").search),
      ),
    },
    setSearch,
    getSearch: () => search,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } =
    await vi.importActual<typeof import("react")>("react");
  return {
    useRouter: () => navigation.router,
    useSearchParams: () =>
      new URLSearchParams(
        useSyncExternalStore(navigation.subscribe, navigation.getSearch),
      ),
  };
});

const response: LineAnalytics = {
  range: { start: "2026-10-21", end: "2026-11-19" },
  conversations_total: 42,
  by_channel: { web: 30, sms: 12 },
  first_response_seconds: { median: 150, p90: 3900 },
  duration_seconds: { median: 1500 },
  message_count: { median: 18.5 },
  after_hours_attempts: 7,
  topics: [{ label: "Stress", count: 12 }],
  outcomes: [],
  confidence_avg: null,
  series: [
    { date: "2026-11-18", conversations: 3 },
    { date: "2026-11-19", conversations: 0 },
  ],
  suppression_threshold: 5,
};

let queryClient: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;

const analyticsRequests = () =>
  fetchMock.mock.calls
    .map(([path]) => path as string)
    .filter((path) => path.startsWith("/api/admin/analytics/line?"));

function renderDashboard() {
  render(
    <QueryClientProvider client={queryClient}>
      <AnalyticsDashboard />
    </QueryClientProvider>,
  );
}

function tileValue(label: string) {
  const term = screen
    .getAllByText(label)
    .find((element) => element.tagName === "DT");
  return term?.nextElementSibling?.textContent;
}

beforeEach(() => {
  // Fake only Date, so "today" is fixed but promises and timers run normally.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 19, 12));
  navigation.setSearch("");
  navigation.router.replace.mockClear();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  fetchMock = vi.fn(async () => Response.json(response));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AnalyticsDashboard", () => {
  it("shows the summary tiles with formatted durations", async () => {
    renderDashboard();

    await screen.findByText("After-hours attempts");
    expect(tileValue("Conversations")).toBe("42");
    expect(tileValue("Median time to first response")).toBe("2m 30s");
    expect(tileValue("90th percentile time to first response")).toBe("1h 5m");
    expect(tileValue("Median conversation length")).toBe("25m");
    expect(tileValue("Median messages per conversation")).toBe("18.5");
    expect(tileValue("After-hours attempts")).toBe("7");
  });

  it("defaults to the last 30 days and gives every chart a table", async () => {
    renderDashboard();

    const table = await screen.findByRole("table", {
      name: "Conversations per day",
    });
    expect(analyticsRequests()).toEqual([
      "/api/admin/analytics/line?start=2026-10-21&end=2026-11-19",
    ]);
    // Zero days stay in the series.
    expect(
      within(table).getByRole("rowheader", { name: "Nov 19, 2026" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Topics" })).toHaveTextContent(
      "Stress12",
    );
  });

  it("changes the request and the URL when the range or channel changes", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText("After-hours attempts");

    await user.selectOptions(screen.getByLabelText("Date range"), "7d");
    await screen.findByText("After-hours attempts");
    expect(navigation.router.replace).toHaveBeenLastCalledWith(
      "/portal/admin/analytics?range=7d",
    );
    expect(analyticsRequests().at(-1)).toBe(
      "/api/admin/analytics/line?start=2026-11-13&end=2026-11-19",
    );

    await user.selectOptions(screen.getByLabelText("Date range"), "semester");
    expect(analyticsRequests().at(-1)).toBe(
      "/api/admin/analytics/line?start=2026-08-01&end=2026-11-19",
    );

    await user.selectOptions(screen.getByLabelText("Channel"), "sms");
    expect(analyticsRequests().at(-1)).toBe(
      "/api/admin/analytics/line?start=2026-08-01&end=2026-11-19&channel=sms",
    );
    expect(navigation.router.replace).toHaveBeenLastCalledWith(
      "/portal/admin/analytics?range=semester&channel=sms",
    );
  });

  it("reads a custom range from the URL and rejects ranges over 366 days", async () => {
    navigation.setSearch("?range=custom&start=2026-01-01&end=2026-01-31");
    renderDashboard();
    await screen.findByText("After-hours attempts");
    expect(analyticsRequests()).toEqual([
      "/api/admin/analytics/line?start=2026-01-01&end=2026-01-31",
    ]);

    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2024-01-01" },
    });
    expect(
      await screen.findByText("Choose a range of 366 days or fewer."),
    ).toBeInTheDocument();
    expect(analyticsRequests()).toHaveLength(1);
    expect(
      screen.queryByRole("link", { name: "Download CSV" }),
    ).not.toBeInTheDocument();
  });

  it("notes hidden groups and a suppressed confidence average", async () => {
    renderDashboard();

    await screen.findByText("After-hours attempts");
    expect(
      screen.getAllByText("Groups with fewer than 5 conversations are hidden."),
    ).toHaveLength(2);
    expect(
      screen.getByText("Hidden when fewer than 5 conversations have a report."),
    ).toBeInTheDocument();
  });

  it("points the CSV link at the current range", async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText("After-hours attempts");

    await user.selectOptions(screen.getByLabelText("Date range"), "7d");
    await user.selectOptions(screen.getByLabelText("Channel"), "web");
    expect(screen.getByRole("link", { name: "Download CSV" })).toHaveAttribute(
      "href",
      "/api/admin/analytics/line.csv?start=2026-11-13&end=2026-11-19",
    );
  });

  it("hides the website analytics link when no URL is configured", async () => {
    renderDashboard();
    await screen.findByText("After-hours attempts");
    expect(
      screen.queryByRole("link", { name: "Website analytics" }),
    ).not.toBeInTheDocument();
  });
});
