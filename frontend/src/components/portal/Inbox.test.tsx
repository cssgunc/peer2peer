import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import InboxPage from "@/app/portal/page";
import {
  inboxQueryKey,
  type InboxItem,
  type Me,
  meQueryKey,
} from "@/lib/portal/queries";

// A stand-in for the Next router: push/replace change the URL that useSearchParams reads.
const navigation = vi.hoisted(() => {
  let search = "";
  const listeners = new Set<() => void>();
  const setSearch = (value: string) => {
    search = value;
    for (const listener of listeners) listener();
  };
  const go = (href: string) => setSearch(new URL(href, "http://x").search);
  return {
    router: { push: vi.fn(go), replace: vi.fn(go) },
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
vi.mock("@/lib/portal/PortalSocketProvider", () => ({
  usePortalEvents: vi.fn(),
}));

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
  last_message_at: "2026-11-11T21:20:00Z",
  unread_count: 3,
  needs_report: false,
};
const onShift: Me = {
  id: "responder",
  email: "responder@example.com",
  display_name: "Responder",
  role: "responder",
  must_change_password: false,
  shift: { id: "shift", started_at: "2026-11-11T20:00:00Z" },
};

let queryClient: QueryClient;
let me: Me;
let items: InboxItem[];
let reportStatus: number;
let reportCode: string;
let inboxStatus: number;
let conversationStatus: number;

function renderInbox() {
  return render(
    <QueryClientProvider client={queryClient}>
      <InboxPage />
    </QueryClientProvider>,
  );
}

const inboxFetches = () =>
  vi.mocked(fetch).mock.calls.filter(([path]) => path === "/api/portal/inbox");

beforeEach(() => {
  navigation.setSearch("");
  me = onShift;
  items = [conversation, active];
  reportStatus = 201;
  reportCode = "";
  inboxStatus = 200;
  conversationStatus = 200;
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) => {
      if (path === "/api/auth/me") return Response.json(me);
      if (path === "/api/portal/inbox")
        return inboxStatus === 200
          ? Response.json(items)
          : Response.json(
              { code: inboxStatus === 403 ? "not_on_shift" : "unavailable" },
              { status: inboxStatus },
            );
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
      if (path === `/api/portal/conversations/${active.conversation_id}/read`)
        return new Response(null, { status: 204 });
      if (path === `/api/portal/conversations/${active.conversation_id}`)
        return conversationStatus === 200
          ? Response.json({
              conversation_id: active.conversation_id,
              label: active.label,
              channel: active.channel,
              status: active.status,
              opened_at: active.opened_at,
              closed_at: null,
              messages: [],
            })
          : Response.json(
              { code: "conversation_not_found" },
              { status: conversationStatus },
            );
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

describe("Inbox", () => {
  it("shows one row per conversation, in the order the API returns them", async () => {
    items = [active, conversation];
    renderInbox();

    const rows = await screen.findAllByRole("button", { name: /^Texter/ });
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Texter 15, 3 unread, last message Nov 11, 4:20 PM",
      "Texter 14, Report needed, last message Nov 11, 4:10 PM",
    ]);
    expect(within(rows[0]).getByText("3 unread")).toBeVisible();
    expect(within(rows[0]).getByText("Nov 11, 4:20 PM")).toHaveAttribute(
      "datetime",
      active.last_message_at,
    );
    expect(within(rows[0]).queryByText("Report needed")).toBeNull();
    expect(within(rows[1]).getByText("Report needed")).toBeVisible();
    expect(within(rows[1]).queryByText(/unread/)).toBeNull();
  });

  it("says when a conversation has no messages yet", async () => {
    items = [{ ...active, last_message_at: null, unread_count: 0 }];
    renderInbox();

    const row = await screen.findByRole("button", { name: /^Texter 15/ });
    expect(row).toHaveAccessibleName("Texter 15, no messages yet");
    expect(within(row).getByText("No messages yet")).toBeVisible();
  });

  it("points to Start shift off shift and never calls the inbox API", async () => {
    me = { ...onShift, shift: null };
    // Even with an inbox left in the cache from the last shift.
    queryClient.setQueryData(inboxQueryKey, items);
    navigation.setSearch(`?c=${active.conversation_id}`);
    renderInbox();

    expect(await screen.findByText("You're off shift.")).toBeVisible();
    expect(screen.getByText("Start shift")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Texter/ })).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Selected conversation" }),
    ).toBeNull();
    expect(inboxFetches()).toHaveLength(0);
  });

  it("shows an empty state on shift with no conversations", async () => {
    items = [];
    renderInbox();

    expect(
      await screen.findByText(
        "No conversations yet. New ones will show up here.",
      ),
    ).toBeVisible();
  });

  it("switches to the off-shift state when the API says the shift is over", async () => {
    inboxStatus = 403;
    renderInbox();
    await screen.findByRole("alert");

    me = { ...onShift, shift: null };
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: meQueryKey });
    });

    expect(await screen.findByText("You're off shift.")).toBeVisible();
  });

  it("keeps the selected conversation in the URL", async () => {
    const user = userEvent.setup();
    renderInbox();

    await user.click(await screen.findByRole("button", { name: /^Texter 15/ }));

    expect(navigation.router.push).toHaveBeenCalledWith(
      `/portal?c=${active.conversation_id}`,
    );
    const panel = screen.getByRole("region", { name: "Selected conversation" });
    expect(
      within(panel).getByRole("heading", { name: "Texter 15" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /^Texter 15/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("opens the conversation from the URL after a refresh", async () => {
    navigation.setSearch(`?c=${active.conversation_id}`);
    renderInbox();

    const panel = await screen.findByRole("region", {
      name: "Selected conversation",
    });
    expect(
      await within(panel).findByRole("heading", { name: "Texter 15" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /^Texter 15/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("goes back to the inbox from the mobile back button", async () => {
    navigation.setSearch(`?c=${active.conversation_id}`);
    const user = userEvent.setup();
    renderInbox();

    await user.click(
      await screen.findByRole("button", { name: "← Back to inbox" }),
    );

    expect(navigation.router.push).toHaveBeenCalledWith("/portal");
    expect(
      screen.getByText("Select a conversation from the inbox."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /^Texter 15/ }),
    ).not.toHaveAttribute("aria-current");
  });

  it("ignores a URL for a conversation that isn't in the inbox", async () => {
    navigation.setSearch("?c=someone-elses-conversation");
    renderInbox();

    expect(
      await screen.findByText("Select a conversation from the inbox."),
    ).toBeVisible();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });
});

describe("Inbox report integration", () => {
  it("preserves the report answers when a background inbox refresh fails", async () => {
    const user = userEvent.setup();
    renderInbox();
    await user.click(
      await screen.findByRole("button", { name: /^Texter 14, Report needed/ }),
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
      await screen.findByRole("button", { name: /^Texter 14, Report needed/ }),
    );

    expect(
      await screen.findByRole("form", { name: "Post-conversation report" }),
    ).toBeVisible();
    expect(screen.getByText("This conversation has ended.")).toBeVisible();
    expect(vi.mocked(fetch).mock.calls.map(([path]) => path)).toEqual([
      "/api/auth/me",
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
        await screen.findByRole("button", {
          name: /^Texter 14, Report needed/,
        }),
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
        screen.getByRole("button", { name: /^Texter 15,/ }),
      ).not.toHaveAttribute("aria-current");
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
      await screen.findByRole("button", { name: /^Texter 15,/ }),
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
      await screen.findByRole("button", { name: /^Texter 14, Report needed/ }),
    );
    await user.click(
      await screen.findByRole("checkbox", { name: "Academic stress" }),
    );
    await user.click(screen.getByRole("radio", { name: "Support provided" }));
    await user.click(screen.getByRole("radio", { name: "5 — Very confident" }));
    await user.click(screen.getByRole("button", { name: "Submit report" }));

    await screen.findByRole("alert");
    expect(
      screen.getByRole("button", { name: /^Texter 14, Report needed/ }),
    ).toHaveAttribute("aria-current", "true");
    expect(
      screen.getByRole("checkbox", { name: "Academic stress" }),
    ).toBeChecked();
    expect(queryClient.getQueryData(inboxQueryKey)).toEqual([
      conversation,
      active,
    ]);
  });

  it("keeps the unavailable message on screen after a 404", async () => {
    conversationStatus = 404;
    const user = userEvent.setup();
    renderInbox();
    await user.click(await screen.findByRole("button", { name: /^Texter 15/ }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /^Texter 15/ }),
      ).not.toHaveAttribute("aria-current"),
    );
    expect(
      screen.getByText("This conversation is no longer available"),
    ).toBeVisible();
    expect(
      screen.queryByText("Select a conversation from the inbox."),
    ).not.toBeInTheDocument();

    expect(navigation.router.replace).toHaveBeenCalledWith("/portal");
    await user.click(screen.getByRole("button", { name: "Back to inbox" }));
    expect(
      screen.getByText("Select a conversation from the inbox."),
    ).toBeVisible();
  });

  it("shows the unavailable message when the inbox drops the selected conversation", async () => {
    const user = userEvent.setup();
    renderInbox();
    await user.click(await screen.findByRole("button", { name: /^Texter 15/ }));
    await screen.findByRole("heading", { name: "Texter 15" });

    act(() => queryClient.setQueryData(inboxQueryKey, [conversation]));

    expect(
      await screen.findByText("This conversation is no longer available"),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Texter 15" }),
    ).not.toBeInTheDocument();
  });
});
