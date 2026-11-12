import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Escalation } from "@/lib/portal/queries";

import { EscalationRecords } from "./EscalationRecords";

const escalation: Escalation = {
  id: "00000000-0000-0000-0000-000000000001",
  conversation_label: "Texter 14",
  status: "open",
  created_by_display_name: "Alex Responder",
  created_at: "2026-11-11T21:00:00Z",
};
const detailPath = `/api/admin/escalations/${escalation.id}`;

let queryClient: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;

function detailCalls() {
  return fetchMock.mock.calls.filter(([path]) => path === detailPath).length;
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/admin/escalations") return Response.json([escalation]);
    if (path === detailPath)
      return Response.json({
        ...escalation,
        payload: { source: "responder" },
      });
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider client={queryClient}>
      <EscalationRecords />
    </QueryClientProvider>,
  );
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("EscalationRecords", () => {
  it("lists escalations without calling the detail endpoint", async () => {
    const user = userEvent.setup();

    expect(await screen.findByText("Texter 14")).toBeInTheDocument();
    expect(screen.getAllByRole("cell")[1]).toHaveTextContent(/^Open$/);
    expect(screen.getByText("Alex Responder")).toBeInTheDocument();

    await user.hover(
      screen.getByRole("button", { name: "Open escalation for Texter 14" }),
    );
    expect(detailCalls()).toBe(0);
  });

  it("warns before fetching and fetches the detail once when opened", async () => {
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", {
        name: "Open escalation for Texter 14",
      }),
    );
    expect(
      screen.getByText("Opening this record is logged."),
    ).toBeInTheDocument();
    expect(detailCalls()).toBe(0);

    await user.click(screen.getByRole("button", { name: "View record" }));
    expect(await screen.findByText("responder")).toBeInTheDocument();
    expect(detailCalls()).toBe(1);
  });

  it("does not keep the detail cached after the dialog closes", async () => {
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", {
        name: "Open escalation for Texter 14",
      }),
    );
    await user.click(screen.getByRole("button", { name: "View record" }));
    await screen.findByText("responder");

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(queryClient.getQueryData(["escalation", escalation.id])).toBe(
        undefined,
      ),
    );
  });
});
