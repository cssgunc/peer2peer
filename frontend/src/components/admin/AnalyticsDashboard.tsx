"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import {
  daysInclusive,
  formatDateOnly,
  formatDuration,
  toDateOnly,
} from "@/lib/dates";
import {
  type AnalyticsBucket,
  type AnalyticsChannel,
  type LineAnalytics,
  useLineAnalytics,
} from "@/lib/portal/queries";

const PATH = "/portal/admin/analytics";
const MAX_DAYS = 366;

// Set by the website analytics work (#164); the link stays hidden until then.
const WEBSITE_ANALYTICS_URL = process.env.NEXT_PUBLIC_WEBSITE_ANALYTICS_URL;

const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30";

const presets = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  semester: "This semester",
  custom: "Custom",
} as const;
type Preset = keyof typeof presets;

const channels: Record<AnalyticsChannel, string> = { web: "Web", sms: "SMS" };

const numberFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

function formatNumber(value: number | null) {
  return value === null ? "—" : numberFormat.format(value);
}

function daysAgo(today: Date, days: number) {
  return new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - days,
  );
}

// No semester setting yet: spring is Jan–May, summer Jun–Jul, fall Aug–Dec.
function semesterStart(today: Date) {
  const month = today.getMonth();
  const startMonth = month < 5 ? 0 : month < 7 ? 5 : 7;
  return new Date(today.getFullYear(), startMonth, 1);
}

function presetRange(preset: Exclude<Preset, "custom">, today: Date) {
  const start =
    preset === "7d"
      ? daysAgo(today, 6)
      : preset === "30d"
        ? daysAgo(today, 29)
        : semesterStart(today);
  return { start: toDateOnly(start), end: toDateOnly(today) };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function rangeError(start: string, end: string) {
  if (!DATE_ONLY.test(start) || !DATE_ONLY.test(end))
    return "Choose a start and end date.";
  const days = daysInclusive(start, end);
  if (days < 1) return "The start date must be on or before the end date.";
  if (days > MAX_DAYS) return `Choose a range of ${MAX_DAYS} days or fewer.`;
  return null;
}

// The range and channel live in the URL so a view can be bookmarked or shared.
function useFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const today = new Date();

  const rawPreset = params.get("range");
  const preset: Preset =
    rawPreset !== null && rawPreset in presets ? (rawPreset as Preset) : "30d";
  const rawChannel = params.get("channel");
  const channel =
    rawChannel !== null && rawChannel in channels
      ? (rawChannel as AnalyticsChannel)
      : null;
  const fallback = presetRange("30d", today);
  const { start, end } =
    preset === "custom"
      ? {
          start: params.get("start") ?? fallback.start,
          end: params.get("end") ?? fallback.end,
        }
      : presetRange(preset, today);

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const query = next.toString();
    router.replace(query ? `${PATH}?${query}` : PATH);
  }

  return {
    preset,
    channel,
    start,
    end,
    error: rangeError(start, end),
    setPreset: (value: Preset) =>
      // Switching to custom starts from the range already on screen.
      update(
        value === "custom"
          ? { range: value, start, end }
          : { range: value, start: null, end: null },
      ),
    setDate: (key: "start" | "end", value: string) => update({ [key]: value }),
    setChannel: (value: string) => update({ channel: value || null }),
  };
}

export function AnalyticsDashboard() {
  const filters = useFilters();
  const { start, end, channel, error } = filters;
  const analytics = useLineAnalytics(
    { start, end, channel },
    { enabled: error === null },
  );
  const csvHref = `/api/admin/analytics/line.csv?${new URLSearchParams({ start, end })}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label htmlFor="analytics-range">Date range</Label>
          <select
            id="analytics-range"
            className={selectClass}
            value={filters.preset}
            onChange={(e) => filters.setPreset(e.target.value as Preset)}
          >
            {Object.entries(presets).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {filters.preset === "custom" && (
          <>
            <div className="space-y-1">
              <Label htmlFor="analytics-start">Start date</Label>
              <Input
                id="analytics-start"
                type="date"
                value={start}
                onChange={(e) => filters.setDate("start", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="analytics-end">End date</Label>
              <Input
                id="analytics-end"
                type="date"
                value={end}
                onChange={(e) => filters.setDate("end", e.target.value)}
              />
            </div>
          </>
        )}
        <div className="space-y-1">
          <Label htmlFor="analytics-channel">Channel</Label>
          <select
            id="analytics-channel"
            className={selectClass}
            value={channel ?? ""}
            onChange={(e) => filters.setChannel(e.target.value)}
          >
            <option value="">All channels</option>
            {Object.entries(channels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {error === null && (
          <a
            href={csvHref}
            download
            className={buttonVariants({ variant: "outline" })}
          >
            Download CSV
          </a>
        )}
        {WEBSITE_ANALYTICS_URL && (
          <a
            href={WEBSITE_ANALYTICS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "link" })}
          >
            Website analytics
          </a>
        )}
      </div>
      {error === null && channel !== null && (
        <p className="text-sm text-muted-foreground">
          The CSV export always covers all channels.
        </p>
      )}

      {error !== null ? (
        <p role="alert">{error}</p>
      ) : analytics.isPending ? (
        <p role="status">Loading analytics…</p>
      ) : analytics.isError ? (
        <div className="space-y-3">
          <p role="alert">
            {analytics.error instanceof ApiError
              ? analytics.error.detail
              : "Analytics could not be loaded."}
          </p>
          <Button variant="outline" onClick={() => analytics.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <Results data={analytics.data} />
      )}
    </div>
  );
}

function Results({ data }: { data: LineAnalytics }) {
  const hiddenNote = `Groups with fewer than ${data.suppression_threshold} conversations are hidden.`;
  // The API drops small groups without saying so, so any non-empty range may have hidden some.
  const mayHide = data.conversations_total > 0;

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">
        {formatDateOnly(data.range.start)} – {formatDateOnly(data.range.end)}
      </p>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile
          label="Conversations"
          value={formatNumber(data.conversations_total)}
        />
        <Tile
          label="Median time to first response"
          value={formatDuration(data.first_response_seconds.median)}
        />
        <Tile
          label="90th percentile time to first response"
          value={formatDuration(data.first_response_seconds.p90)}
        />
        <Tile
          label="Median conversation length"
          value={formatDuration(data.duration_seconds.median)}
        />
        <Tile
          label="Median messages per conversation"
          value={formatNumber(data.message_count.median)}
        />
        <Tile
          label="After-hours attempts"
          value={formatNumber(data.after_hours_attempts)}
        />
      </dl>

      <ChartSection
        title="Conversations per day"
        rows={data.series.map((day) => ({
          label: formatDateOnly(day.date),
          count: day.conversations,
        }))}
        labelHeader="Date"
      />

      <ChartSection
        title="Topics"
        rows={data.topics}
        labelHeader="Topic"
        horizontal
        note={mayHide ? hiddenNote : undefined}
      />

      <ChartSection
        title="Outcomes"
        rows={data.outcomes}
        labelHeader="Outcome"
        horizontal
        note={mayHide ? hiddenNote : undefined}
      />

      <section className="space-y-1">
        <h2 className="text-lg font-semibold">Average confidence</h2>
        {data.confidence_avg === null ? (
          <p className="text-sm text-muted-foreground">
            Hidden when fewer than {data.suppression_threshold} conversations
            have a report.
          </p>
        ) : (
          <p className="text-2xl font-semibold">
            {formatNumber(data.confidence_avg)}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              out of 5
            </span>
          </p>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold">{value}</dd>
    </div>
  );
}

// Each chart is decorative for screen readers; the visually hidden table carries the data.
// Topic and outcome labels are editable and can be long, so those charts put them on the
// left as horizontal bars, where a narrow screen doesn't drop them.
function ChartSection({
  title,
  rows,
  labelHeader,
  note,
  horizontal = false,
}: {
  title: string;
  rows: AnalyticsBucket[];
  labelHeader: string;
  note?: string;
  horizontal?: boolean;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm">No data to show.</p>
      ) : (
        <>
          <div
            aria-hidden="true"
            className={horizontal ? undefined : "h-64"}
            style={horizontal ? { height: rows.length * 40 + 40 } : undefined}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={rows}
                layout={horizontal ? "vertical" : "horizontal"}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={horizontal}
                  horizontal={!horizontal}
                />
                {horizontal ? (
                  <>
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={130}
                      interval={0}
                      tick={{ fontSize: 12 }}
                    />
                  </>
                ) : (
                  <>
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} width={32} />
                  </>
                )}
                <Tooltip />
                <Bar
                  dataKey="count"
                  name="Conversations"
                  fill="var(--primary)"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="sr-only">
            <caption>{title}</caption>
            <thead>
              <tr>
                <th scope="col">{labelHeader}</th>
                <th scope="col">Conversations</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
    </section>
  );
}
