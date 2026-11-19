import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { Feedback } from "@/lib/portal/queries";

import { FeedbackInbox } from "./FeedbackInbox";

const hostileBody =
  "<script>alert(1)</script>\n**bold** [link](https://example.com)\n<b>tag</b>";

const unreadItem: Feedback = {
  id: "a",
  body: hostileBody,
  created_on: "2026-11-01",
  read: false,
};
const readItem: Feedback = {
  id: "b",
  body: "Thanks for being there.",
  created_on: "2026-10-15",
  read: true,
};

let feedback: Feedback[];
let queryClient: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;

function calls(method: string) {
  return fetchMock.mock.calls.filter(
    ([, init]) => (init?.method ?? "GET") === method,
  );
}

function feedbackGets() {
  return calls("GET")
    .map(([path]) => path as string)
    .filter((path) => path.startsWith("/api/admin/feedback"));
}

function renderInbox() {
  render(
    <QueryClientProvider client={queryClient}>
      <FeedbackInbox />
    </QueryClientProvider>,
  );
}

const originalTz = process.env.TZ;
// West of UTC, where new Date("2026-11-01") would show Oct 31.
beforeAll(() => {
  process.env.TZ = "America/New_York";
});
afterAll(() => {
  process.env.TZ = originalTz;
});

beforeEach(() => {
  feedback = [unreadItem, readItem];
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (path === "/api/admin/settings") {
      return Response.json([
        {
          key: "feedback_retention_days",
          value: 180,
          description: "",
          public: false,
          updated_by: null,
          updated_at: null,
        },
      ]);
    }
    if (method === "GET") {
      const unread = new URL(path, "http://x").searchParams.get("unread");
      return Response.json(
        unread === null
          ? feedback
          : feedback.filter((item) => item.read === (unread === "false")),
      );
    }
    if (method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({ ...unreadItem, read: true });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("FeedbackInbox", () => {
  it("lists feedback and sends the filter as ?unread=", async () => {
    const user = userEvent.setup();
    renderInbox();
    expect(await screen.findAllByTestId("feedback-item")).toHaveLength(2);
    expect(feedbackGets()).toEqual(["/api/admin/feedback"]);

    await user.selectOptions(screen.getByLabelText("Show"), "unread");
    await waitFor(() =>
      expect(feedbackGets()).toContain("/api/admin/feedback?unread=true"),
    );
    await user.selectOptions(screen.getByLabelText("Show"), "read");
    await waitFor(() =>
      expect(feedbackGets()).toContain("/api/admin/feedback?unread=false"),
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("feedback-item")).toHaveLength(1),
    );
    expect(screen.getByText("Thanks for being there.")).toBeTruthy();
  });

  it("renders a body with <script>, HTML, and Markdown as literal text", async () => {
    renderInbox();
    const [item] = await screen.findAllByTestId("feedback-item");
    const body = within(item).getByText(/alert\(1\)/);

    expect(body.textContent).toBe(hostileBody);
    expect(body.className).toContain("whitespace-pre-wrap");
    expect(item.querySelector("script, strong, b, a")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
  });

  it("shows created_on as the same calendar date west of UTC", async () => {
    renderInbox();
    const [item] = await screen.findAllByTestId("feedback-item");
    expect(within(item).getByText("Nov 1, 2026")).toBeTruthy();
    expect(screen.queryByText("Oct 31, 2026")).toBeNull();
  });

  it("marks read and unread, then refreshes the list and the unread count", async () => {
    const user = userEvent.setup();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    renderInbox();

    await user.click(
      await screen.findByRole("button", {
        name: "Mark read: feedback from Nov 1, 2026",
      }),
    );
    await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
    expect(calls("PATCH")[0][0]).toBe("/api/admin/feedback/a");
    expect(JSON.parse(calls("PATCH")[0][1].body)).toEqual({ read: true });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["admin-feedback"],
      }),
    );

    await user.click(
      screen.getByRole("button", {
        name: "Mark unread: feedback from Oct 15, 2026",
      }),
    );
    await waitFor(() => expect(calls("PATCH")).toHaveLength(2));
    expect(calls("PATCH")[1][0]).toBe("/api/admin/feedback/b");
    expect(JSON.parse(calls("PATCH")[1][1].body)).toEqual({ read: false });
  });

  it("refreshes the nav's unread count after marking read", async () => {
    const user = userEvent.setup();
    renderInbox();
    // Stands in for the nav badge, which reads the Unread list's cache entry.
    await queryClient.fetchQuery({
      queryKey: ["admin-feedback", "unread"],
      queryFn: () => [unreadItem],
    });

    await user.click(
      await screen.findByRole("button", {
        name: "Mark read: feedback from Nov 1, 2026",
      }),
    );
    await waitFor(() =>
      expect(
        queryClient.getQueryState(["admin-feedback", "unread"])?.isInvalidated,
      ).toBe(true),
    );
  });

  it("asks before deleting, and cancel sends nothing", async () => {
    const user = userEvent.setup();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    renderInbox();

    await user.click(
      await screen.findByRole("button", {
        name: "Delete feedback from Nov 1, 2026",
      }),
    );
    let dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/permanently deleted/)).toBeTruthy();
    expect(calls("DELETE")).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(calls("DELETE")).toHaveLength(0);

    await user.click(
      screen.getByRole("button", { name: "Delete feedback from Nov 1, 2026" }),
    );
    dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls("DELETE")).toHaveLength(1));
    expect(calls("DELETE")[0][0]).toBe("/api/admin/feedback/a");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["admin-feedback"] });
  });

  it("keeps the dialog open with the backend error when deleting fails", async () => {
    fetchMock.mockImplementation(async (path: string, init?: RequestInit) =>
      (init?.method ?? "GET") === "GET"
        ? Response.json(path === "/api/admin/settings" ? [] : feedback)
        : Response.json(
            { code: "not_found", detail: "Feedback not found" },
            { status: 404 },
          ),
    );
    const user = userEvent.setup();
    renderInbox();
    await user.click(
      await screen.findByRole("button", {
        name: "Delete feedback from Nov 1, 2026",
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "Feedback not found",
    );
  });

  it.each([
    ["all", "No feedback yet."],
    ["unread", "No unread feedback."],
    ["read", "No read feedback."],
  ])("shows an empty state for the %s filter", async (filter, message) => {
    feedback = [];
    const user = userEvent.setup();
    renderInbox();
    await screen.findByText("No feedback yet.");
    await user.selectOptions(screen.getByLabelText("Show"), filter);
    expect(await screen.findByText(message)).toBeTruthy();
  });

  it("names the retention period from the admin settings", async () => {
    renderInbox();
    expect(
      await screen.findByText(/deleted automatically 180 days after/),
    ).toBeTruthy();
  });
});
