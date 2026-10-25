"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";

export type LineStatus = components["schemas"]["StatusDTO"];

type LineStatusState =
  | { status: "loading" | "error"; data: null }
  | { status: "ready"; data: LineStatus };

const POLL_INTERVAL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /(Z|[+-]\d{2}:\d{2})$/i.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isLineStatus(value: unknown): value is LineStatus {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.is_online === "boolean" &&
    typeof data.line_launched === "boolean" &&
    (data.next_open_at === null || isTimestamp(data.next_open_at)) &&
    (data.line_launch_at === null || isTimestamp(data.line_launch_at)) &&
    (data.line_launched || data.line_launch_at !== null)
  );
}

export function useLineStatus(): LineStatusState {
  const [state, setState] = useState<LineStatusState>({
    status: "loading",
    data: null,
  });

  useEffect(() => {
    let disposed = false;
    let controller: AbortController | null = null;
    let interval: number | undefined;
    let timeout: number | undefined;

    function cancelRequest() {
      window.clearTimeout(timeout);
      controller?.abort();
      controller = null;
    }

    async function refresh() {
      if (disposed || document.hidden || controller) return;
      const request = new AbortController();
      controller = request;
      timeout = window.setTimeout(() => {
        // Clear stale success even if a stalled fetch never rejects on abort.
        cancelRequest();
        setState({ status: "error", data: null });
      }, REQUEST_TIMEOUT_MS);

      try {
        const data = await apiFetch<unknown>("/api/status", {
          signal: request.signal,
          credentials: "omit",
        });
        if (disposed || controller !== request) return;
        if (!isLineStatus(data)) throw new Error("Invalid line status");
        setState({ status: "ready", data });
      } catch {
        if (!disposed && controller === request) {
          setState({ status: "error", data: null });
        }
      } finally {
        if (controller === request) {
          window.clearTimeout(timeout);
          controller = null;
        }
      }
    }

    function startPolling() {
      void refresh();
      interval = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    }

    function onVisibilityChange() {
      window.clearInterval(interval);
      cancelRequest();
      // Never restore an old online result when returning to the tab.
      setState({ status: "loading", data: null });
      if (!document.hidden) startPolling();
    }

    if (!document.hidden) startPolling();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      cancelRequest();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return state;
}
