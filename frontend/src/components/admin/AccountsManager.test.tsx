import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { meQueryKey, type Me } from "@/lib/portal/queries";

import { type Account, AccountsManager } from "./AccountsManager";

const me: Me = {
  id: "1",
  email: "me@unc.edu",
  display_name: "Casey Coordinator",
  role: "coordinator",
  must_change_password: false,
  shift: null,
};

const accounts: Account[] = [
  {
    id: "1",
    email: "me@unc.edu",
    display_name: "Casey Coordinator",
    role: "coordinator",
    is_active: true,
    last_login_at: "2026-11-01T12:00:00Z",
    on_shift: false,
  },
  {
    id: "2",
    email: "riley@unc.edu",
    display_name: "Riley Responder",
    role: "responder",
    is_active: true,
    last_login_at: null,
    on_shift: true,
  },
];

let queryClient: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;

function calls(method: string) {
  return fetchMock.mock.calls.filter(
    ([, init]) => (init?.method ?? "GET") === method,
  );
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(meQueryKey, me);
  fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (path === "/api/auth/me") return Response.json(me);
    if (method === "GET") return Response.json(accounts);
    if (path.endsWith("/reset-password")) {
      return Response.json({ temporary_password: "reset-pass-9" });
    }
    if (method === "POST") {
      return Response.json(
        { ...accounts[1], id: "3", temporary_password: "temp-pass-123" },
        { status: 201 },
      );
    }
    return Response.json(accounts[1]);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider client={queryClient}>
      <AccountsManager />
    </QueryClientProvider>,
  );
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("AccountsManager", () => {
  it("renders the table and sends filters as query parameters", async () => {
    const user = userEvent.setup();
    expect(await screen.findByText("Riley Responder")).toBeTruthy();
    expect(screen.getByText("riley@unc.edu")).toBeTruthy();
    expect(screen.getByText("Never")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/accounts", undefined);

    await user.selectOptions(screen.getByLabelText("Role"), "responder");
    await user.selectOptions(screen.getByLabelText("Status"), "false");
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/accounts?role=responder&is_active=false",
        undefined,
      ),
    );
  });

  it("shows the temporary password after creating, and drops it on close", async () => {
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "New account" }),
    );
    await user.type(screen.getByLabelText("Email"), "new@unc.edu");
    await user.type(screen.getByLabelText("Display name"), "New Person");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect((await screen.findByTestId("temporary-password")).textContent).toBe(
      "temp-pass-123",
    );
    expect(screen.getByText(/won't be shown again/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(JSON.parse(calls("POST")[0][1].body)).toEqual({
      email: "new@unc.edu",
      display_name: "New Person",
      role: "responder",
    });

    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.textContent).not.toContain("temp-pass-123");
    // And it never entered React Query's caches.
    expect(
      JSON.stringify(queryClient.getMutationCache().getAll()),
    ).not.toContain("temp-pass-123");
  });

  it("asks before deactivating, then sends is_active: false", async () => {
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Deactivate Riley Responder" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(/signs them out and ends their shift/),
    ).toBeTruthy();
    expect(calls("PATCH")).toHaveLength(0);

    await user.click(
      within(dialog).getByRole("button", { name: "Deactivate" }),
    );
    await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
    expect(calls("PATCH")[0][0]).toBe("/api/admin/accounts/2");
    expect(JSON.parse(calls("PATCH")[0][1].body)).toEqual({ is_active: false });
  });

  it("shows the backend error when deactivating is refused", async () => {
    fetchMock.mockImplementation(async (_path: string, init?: RequestInit) =>
      (init?.method ?? "GET") === "GET"
        ? Response.json(accounts)
        : Response.json(
            { code: "last_coordinator", detail: "Last coordinator." },
            { status: 422 },
          ),
    );
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Deactivate Riley Responder" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Deactivate" }),
    );
    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "Last coordinator.",
    );
  });

  it("gives the current coordinator's row no deactivate action", async () => {
    await screen.findByText("Riley Responder");
    expect(
      screen.queryByRole("button", { name: "Deactivate Casey Coordinator" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Deactivate Riley Responder" }),
    ).toBeTruthy();
  });

  it("confirms a reset, then shows the new password once", async () => {
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", {
        name: "Reset password for Riley Responder",
      }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Reset password" }),
    );
    expect((await screen.findByTestId("temporary-password")).textContent).toBe(
      "reset-pass-9",
    );
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.textContent).not.toContain("reset-pass-9");
  });

  it("edits only the changed fields", async () => {
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Edit Riley Responder" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(
      within(dialog).getByLabelText("Role"),
      "coordinator",
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
    expect(JSON.parse(calls("PATCH")[0][1].body)).toEqual({
      role: "coordinator",
    });
  });
});
