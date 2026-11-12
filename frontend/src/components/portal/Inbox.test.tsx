import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import InboxPage from "@/app/portal/page";
import { inboxQueryKey, type InboxItem } from "@/lib/portal/queries";

const conversation: InboxItem = {
  conversation_id: "00000000-0000-0000-0000-000000000001",
  label: "Texter 14",
  channel: "web",
  status: "closed",
  opened_at: "2026-11-11T21:00:00Z",
  last_message_at: "2026-11-11T21:10:00Z",
  unread_count: 0,
  needs_report: true,
};
const active: InboxItem = {
  ...conversation,
  conversation_id: "00000000-0000-0000-0000-000000000002",
  label: "Texter 15",
  status: "active",
  needs_report: false,
};

let queryClient: QueryClient;
let items: InboxItem[];
let reportStatus: number;
let reportCode: string;
let inboxStatus: number;

function renderInbox() {
  return render(
    <QueryClientProvider client={queryClient}>
      <InboxPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  items = [conversation, active];
  reportStatus = 201;
  reportCode = "";
  inboxStatus = 200;
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/portal/inbox")
        return Response.json(items, { status: inboxStatus });
      if (path === "/api/portal/report-options")
        return Response.json({
          topics: [{ id: "topic", label: "Academic stress" }],
          outcomes: [{ id: "outcome", label: "Support provided" }],
        });
      if (
        path ===
        `/api/portal/conversations/${conversation.conversation_id}/report`
      ) {
        if (reportStatus === 201 || reportCode === "report_exists") {
          items = items.filter(
            (item) => item.conversation_id !== conversation.conversation_id,
          );
        }
        return Response.json(
          reportStatus === 201 ? null : { code: reportCode },
          { status: reportStatus },
        );
      }
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Inbox report integration", () => {
  it("preserves the report answers when a background inbox refresh fails", async () => {
    const user = userEvent.setup();
    renderInbox();
    await user.click(
      await screen.findByRole("button", { name: "Texter 14, Report needed" }),
    );
    await user.click(
      await screen.findByRole("checkbox", { name: "Academic stress" }),
    );

    inboxStatus = 503;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: inboxQueryKey });
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The inbox could not be loaded",
    );
    expect(
      screen.getByRole("checkbox", { name: "Academic stress" }),
    ).toBeChecked();
    expect(
      screen.getByRole("form", { name: "Post-conversation report" }),
    ).toBeVisible();
  });

  it("opens a needs_report conversation directly to the form without loading its history", async () => {
    const user = userEvent.setup();
    renderInbox();
    await user.click(
      await screen.findByRole("button", { name: "Texter 14, Report needed" }),
    );

    expect(
      await screen.findByRole("form", { name: "Post-conversation report" }),
    ).toBeVisible();
    expect(screen.getByText("This conversation has ended.")).toBeVisible();
    expect(vi.mocked(fetch).mock.calls.map(([path]) => path)).toEqual([
      "/api/portal/inbox",
      "/api/portal/report-options",
    ]);
  });

  it.each([
    [201, ""],
    [409, "report_exists"],
  ])(
    "removes the conversation and clears selection after a %s response",
    async (status, code) => {
      reportStatus = status;
      reportCode = code;
      const user = userEvent.setup();
      renderInbox();
      await user.click(
        await screen.findByRole("button", { name: "Texter 14, Report needed" }),
      );
      await user.click(
        await screen.findByRole("checkbox", { name: "Academic stress" }),
      );
      await user.click(screen.getByRole("radio", { name: "Support provided" }));
      await user.click(
        screen.getByRole("radio", { name: "5 — Very confident" }),
      );
      await user.click(screen.getByRole("button", { name: "Submit report" }));

      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: /Texter 14/ }),
        ).not.toBeInTheDocument(),
      );
      expect(screen.queryByRole("form")).not.toBeInTheDocument();
      expect(
        screen.getByText("Select a conversation from the inbox."),
      ).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Texter 15, active" }),
      ).toHaveAttribute("aria-pressed", "false");
      await waitFor(() =>
        expect(
          vi
            .mocked(fetch)
            .mock.calls.filter(([path]) => path === "/api/portal/inbox"),
        ).toHaveLength(2),
      );
      expect(queryClient.getQueryData(inboxQueryKey)).toEqual([active]);
    },
  );

  it("shows the form when the selected conversation closes through a live inbox update", async () => {
    const user = userEvent.setup();
    renderInbox();
    await user.click(
      await screen.findByRole("button", { name: "Texter 15, active" }),
    );
    expect(screen.queryByRole("form")).not.toBeInTheDocument();

    act(() =>
      queryClient.setQueryData(inboxQueryKey, [
        conversation,
        { ...active, status: "closed", needs_report: true },
      ]),
    );

    expect(
      await screen.findByRole("form", { name: "Post-conversation report" }),
    ).toBeVisible();
  });

  it("keeps the conversation selected and the answers visible after a failed submission", async () => {
    reportStatus = 422;
    reportCode = "invalid_option";
    const user = userEvent.setup();
    renderInbox();
    await user.click(
      await screen.findByRole("button", { name: "Texter 14, Report needed" }),
    );
    await user.click(
      await screen.findByRole("checkbox", { name: "Academic stress" }),
    );
    await user.click(screen.getByRole("radio", { name: "Support provided" }));
    await user.click(screen.getByRole("radio", { name: "5 — Very confident" }));
    await user.click(screen.getByRole("button", { name: "Submit report" }));

    await screen.findByRole("alert");
    expect(
      screen.getByRole("button", { name: "Texter 14, Report needed" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("checkbox", { name: "Academic stress" }),
    ).toBeChecked();
    expect(queryClient.getQueryData(inboxQueryKey)).toEqual([
      conversation,
      active,
    ]);
  });
});
