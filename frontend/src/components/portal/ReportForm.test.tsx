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
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  inboxQueryKey,
  type InboxItem,
  type ReportOptions,
} from "@/lib/portal/queries";

import { ReportForm } from "./ReportForm";

const conversationId = "00000000-0000-0000-0000-000000000001";
const options: ReportOptions = {
  topics: [
    { id: "00000000-0000-0000-0000-000000000002", label: "Academic stress" },
    { id: "00000000-0000-0000-0000-000000000003", label: "Relationships" },
  ],
  outcomes: [
    { id: "00000000-0000-0000-0000-000000000004", label: "Support provided" },
    {
      id: "00000000-0000-0000-0000-000000000005",
      label: "Referred to resources",
    },
  ],
};

let queryClient: QueryClient;
let getOptions: () => Promise<Response>;
let postReport: () => Promise<Response>;
const onSubmitted = vi.fn();

function form(id = conversationId) {
  return (
    <QueryClientProvider client={queryClient}>
      <ReportForm conversationId={id} onSubmitted={onSubmitted} />
    </QueryClientProvider>
  );
}

async function fillReport(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("checkbox", { name: "Academic stress" }),
  );
  await user.click(screen.getByRole("radio", { name: "Support provided" }));
  await user.click(screen.getByRole("radio", { name: "5 — Very confident" }));
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  getOptions = async () => Response.json(options);
  postReport = async () => Response.json(null, { status: 201 });
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string) => {
      if (path === "/api/portal/report-options") return getOptions();
      if (path.endsWith("/report")) return postReport();
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("ReportForm", () => {
  it("requires a topic, an outcome, and confidence and has no free-text fields", async () => {
    const user = userEvent.setup();
    render(form());
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading report options",
    );
    const submit = await screen.findByRole("button", { name: "Submit report" });
    expect(submit).toBeDisabled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/portal/report-options", undefined);

    const topic = screen.getByRole("checkbox", { name: "Academic stress" });
    const confidence = screen.getByRole("radio", { name: "1 — Not confident" });
    await user.click(topic);
    expect(submit).toBeDisabled();
    await user.click(confidence);
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "Support provided" }));
    expect(submit).toBeEnabled();

    await user.click(topic);
    expect(submit).toBeDisabled();
    await user.click(topic);
    await user.click(confidence);
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "3" }));
    expect(submit).toBeEnabled();
  });

  it("posts only the selected topic IDs, outcome ID, and numeric confidence", async () => {
    const user = userEvent.setup();
    const otherConversation = {
      conversation_id: "another-conversation",
    } as InboxItem;
    queryClient.setQueryData(inboxQueryKey, [
      { conversation_id: conversationId },
      otherConversation,
    ]);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    render(form());
    await fillReport(user);
    await user.click(screen.getByRole("checkbox", { name: "Relationships" }));
    await user.click(
      screen.getByRole("radio", { name: "Referred to resources" }),
    );
    expect(
      screen.getByRole("radio", { name: "Support provided" }),
    ).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Submit report" }));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledWith(
      `/api/portal/conversations/${conversationId}/report`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic_ids: options.topics.map((topic) => topic.id),
          outcome_id: options.outcomes[1].id,
          confidence: 5,
        }),
      },
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: inboxQueryKey });
    expect(queryClient.getQueryData(inboxQueryKey)).toEqual([
      otherConversation,
    ]);
  });

  it("disables the controls while submitting and prevents duplicate submissions", async () => {
    const user = userEvent.setup();
    let finish!: (response: Response) => void;
    postReport = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    render(form());
    await fillReport(user);
    await user.dblClick(screen.getByRole("button", { name: "Submit report" }));

    expect(screen.getByRole("button", { name: "Submitting…" })).toBeDisabled();
    expect(screen.getByRole("form")).toHaveAttribute("aria-busy", "true");
    for (const control of [
      ...screen.getAllByRole("checkbox"),
      ...screen.getAllByRole("radio"),
    ]) {
      expect(control).toBeDisabled();
    }
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([path]) => String(path).endsWith("/report")),
    ).toHaveLength(1);
    await act(async () => finish(Response.json(null, { status: 201 })));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledOnce());
  });

  it("treats a report_exists conflict as success", async () => {
    postReport = async () =>
      Response.json({ code: "report_exists" }, { status: 409 });
    const user = userEvent.setup();
    render(form());
    await fillReport(user);
    await user.click(screen.getByRole("button", { name: "Submit report" }));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    [422, "invalid_option"],
    [500, "server_error"],
    [409, "another_conflict"],
    [0, "network_error"],
  ])(
    "preserves answers after a %s error and allows retry",
    async (status, code) => {
      postReport = async () => {
        if (status === 0) throw new TypeError("Failed to fetch");
        return Response.json({ code }, { status });
      };
      const user = userEvent.setup();
      render(form());
      await fillReport(user);
      await user.click(screen.getByRole("button", { name: "Submit report" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Your answers have been kept",
      );
      expect(
        screen.getByRole("checkbox", { name: "Academic stress" }),
      ).toBeChecked();
      expect(
        screen.getByRole("radio", { name: "Support provided" }),
      ).toBeChecked();
      expect(
        screen.getByRole("radio", { name: "5 — Very confident" }),
      ).toBeChecked();
      expect(onSubmitted).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Submit report" }),
      ).toBeEnabled();

      postReport = async () => Response.json(null, { status: 201 });
      await user.click(screen.getByRole("button", { name: "Submit report" }));
      await waitFor(() => expect(onSubmitted).toHaveBeenCalledOnce());
    },
  );

  it("lets the responder retry loading the options", async () => {
    getOptions = async () => Response.json(null, { status: 503 });
    const user = userEvent.setup();
    render(form());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Report options could not be loaded",
    );
    expect(
      screen.queryByRole("button", { name: "Submit report" }),
    ).not.toBeInTheDocument();

    getOptions = async () => Response.json(options);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("checkbox", { name: "Academic stress" }),
    ).toBeVisible();
  });

  it.each(["topics", "outcomes"] as const)(
    "cannot submit when there are no %s",
    async (kind) => {
      getOptions = async () => Response.json({ ...options, [kind]: [] });
      render(form());
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Report options are unavailable",
      );
      expect(
        screen.getByRole("button", { name: "Submit report" }),
      ).toBeDisabled();
    },
  );

  it("resets the answers when a different conversation is selected", async () => {
    const user = userEvent.setup();
    const view = render(form());
    await fillReport(user);
    view.rerender(form("another-conversation"));

    expect(
      await screen.findByRole("checkbox", { name: "Academic stress" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Support provided" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("radio", { name: "5 — Very confident" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Submit report" }),
    ).toBeDisabled();
  });

  it("supports keyboard selection of confidence", async () => {
    const user = userEvent.setup();
    render(form());
    const group = await screen.findByRole("radiogroup", { name: "Confidence" });
    const first = within(group).getByRole("radio", {
      name: "1 — Not confident",
    });
    first.focus();
    await user.keyboard("{ArrowRight}");
    const second = within(group).getByRole("radio", { name: "2" });
    await waitFor(() => expect(second).toHaveFocus());
    await user.keyboard(" ");
    expect(second).toBeChecked();
  });

  it("passes axe before and after a failed submission", async () => {
    const user = userEvent.setup();
    const { container } = render(form());
    await screen.findByRole("button", { name: "Submit report" });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    // jsdom has no layout engine for color contrast; all other axe rules run.
    const axeOptions = { rules: { "color-contrast": { enabled: false } } };
    expect((await axe.run(container, axeOptions)).violations).toEqual([]);

    postReport = async () => Response.json(null, { status: 500 });
    await fillReport(user);
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    await screen.findByRole("alert");
    expect((await axe.run(container, axeOptions)).violations).toEqual([]);
  });
});
