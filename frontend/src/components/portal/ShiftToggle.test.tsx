import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api";
import type { InboxItem, Me } from "@/lib/portal/queries";

import { ShiftToggle } from "./ShiftToggle";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const offShift: Me = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "staff@example.com",
  display_name: "Staff Member",
  role: "responder",
  must_change_password: false,
  shift: null,
};
// 7:02 PM Eastern.
const onShift: Me = {
  ...offShift,
  shift: { id: "shift-1", started_at: "2026-11-12T00:02:00Z" },
};

function item(status: InboxItem["status"], n: number): InboxItem {
  return {
    conversation_id: `c${n}`,
    label: `Texter ${n}`,
    channel: "web",
    status,
    opened_at: "2026-11-12T00:10:00Z",
    last_message_at: null,
    unread_count: 0,
    needs_report: false,
  };
}

function mockApi(me: Me, inbox: InboxItem[] = []) {
  vi.mocked(apiFetch).mockImplementation(async (path: string) => {
    if (path === "/api/auth/me") return me;
    if (path === "/api/portal/inbox") return inbox;
    return undefined;
  });
}

async function renderToggle(me: Me, inbox: InboxItem[] = []) {
  mockApi(me, inbox);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <ShiftToggle />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: /shift/ });
  return { invalidate };
}

async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

const posts = (path: string) =>
  vi
    .mocked(apiFetch)
    .mock.calls.filter(
      ([url, init]) => url === path && init?.method === "POST",
    );

function expectRefetched(invalidate: ReturnType<typeof vi.fn>) {
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["me"] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["inbox"] });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ShiftToggle", () => {
  it("shows only Start shift when off shift", async () => {
    await renderToggle(offShift);

    expect(
      screen.getByRole("button", { name: "Start shift" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End shift" })).toBeNull();
    expect(screen.queryByText(/On shift since/)).toBeNull();
  });

  it("shows End shift and the start time (Eastern) when on shift", async () => {
    await renderToggle(onShift);

    expect(
      screen.getByRole("button", { name: "End shift" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start shift" })).toBeNull();
    expect(screen.getByText(/On shift since/)).toHaveTextContent(
      "On shift since 7:02 PM",
    );
  });

  it("starts a shift, then refetches me and inbox", async () => {
    const { invalidate } = await renderToggle(offShift);

    await click("Start shift");

    expect(posts("/api/portal/shift/start")).toHaveLength(1);
    expectRefetched(invalidate);
  });

  it("ends right away when there are no active conversations", async () => {
    // Closed and queued items don't go back to the queue, so they don't need a warning.
    const { invalidate } = await renderToggle(onShift, [
      item("closed", 1),
      item("queued", 2),
    ]);

    await click("End shift");

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(posts("/api/portal/shift/end")).toHaveLength(1);
    expectRefetched(invalidate);
  });

  it("asks first when conversations are active, and ends on confirm", async () => {
    const { invalidate } = await renderToggle(onShift, [
      item("active", 1),
      item("active", 2),
      item("closed", 3),
    ]);

    await click("End shift");

    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "Your 2 active conversations will go back to the queue.",
    );
    expect(posts("/api/portal/shift/end")).toHaveLength(0);

    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "End shift" }).at(-1)!,
      );
    });

    expect(posts("/api/portal/shift/end")).toHaveLength(1);
    expectRefetched(invalidate);
  });

  it("keeps the shift when the confirmation is cancelled", async () => {
    await renderToggle(onShift, [item("active", 1)]);

    await click("End shift");
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "Your 1 active conversation will go back to the queue.",
    );
    await click("Keep my shift");

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(posts("/api/portal/shift/end")).toHaveLength(0);
  });
});
