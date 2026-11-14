import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EscalateButton } from "./EscalateButton";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const conversationId = "00000000-0000-0000-0000-000000000001";
const escalatePath = `/api/portal/conversations/${conversationId}/escalate`;

let queryClient: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;

function renderButton(status: "queued" | "active" | "closed") {
  return render(
    <QueryClientProvider client={queryClient}>
      <EscalateButton conversationId={conversationId} status={status} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/portal/guide")
      return Response.json({
        slug: "portal.guide",
        title: "Responder Guide",
        body_md: "Call the on-call coordinator.",
        updated_at: null,
      });
    if (path === escalatePath)
      return Response.json({ id: "escalation" }, { status: 201 });
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("EscalateButton", () => {
  it("records the escalation and then shows the recorded state", async () => {
    const user = userEvent.setup();
    renderButton("active");

    await user.click(screen.getByRole("button", { name: "Escalate" }));
    expect(
      await screen.findByText("Call the on-call coordinator."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Record escalation" }));

    expect(await screen.findByText("Escalation recorded")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Escalate" }),
    ).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalled();
    const posts = fetchMock.mock.calls.filter(
      ([path]) => path === escalatePath,
    );
    expect(posts).toHaveLength(1);
    expect(posts[0][1]).toMatchObject({ method: "POST" });
  });

  it("keeps the button and shows an error when recording fails", async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/portal/guide")
        return Response.json({
          slug: "portal.guide",
          title: "Responder Guide",
          body_md: "Protocol",
          updated_at: null,
        });
      return Response.json({ code: "error" }, { status: 500 });
    });
    const user = userEvent.setup();
    renderButton("active");

    await user.click(screen.getByRole("button", { name: "Escalate" }));
    await user.click(screen.getByRole("button", { name: "Record escalation" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.queryByText("Escalation recorded")).not.toBeInTheDocument();
  });

  it.each(["closed", "queued"] as const)(
    "is hidden for %s conversations",
    (status) => {
      renderButton(status);
      expect(
        screen.queryByRole("button", { name: "Escalate" }),
      ).not.toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
