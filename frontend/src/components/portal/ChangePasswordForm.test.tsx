import type { UseQueryResult } from "@tanstack/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Me, useMe } from "@/lib/portal/queries";

import { ChangePasswordForm } from "./ChangePasswordForm";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/portal/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/portal/queries")>()),
  useMe: vi.fn(),
}));

const me: Me = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "staff@example.com",
  display_name: "Staff Member",
  role: "responder",
  must_change_password: true,
  shift: null,
};

function respondWith(status: number, body?: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderForm() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["me"], me);
  render(
    <QueryClientProvider client={queryClient}>
      <ChangePasswordForm />
    </QueryClientProvider>,
  );
  return queryClient;
}

async function fillAndSubmit({
  current = "Temporary-Pass-8kQ2",
  next = "A distinct! password 2026",
  confirm = next,
}: { current?: string; next?: string; confirm?: string } = {}) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Current password"), current);
  await user.type(screen.getByLabelText("New password"), next);
  await user.type(screen.getByLabelText("Confirm new password"), confirm);
  await user.click(screen.getByRole("button", { name: "Change password" }));
}

beforeEach(() => {
  push.mockReset();
  vi.mocked(useMe).mockReturnValue({ data: me } as UseQueryResult<Me>);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ChangePasswordForm", () => {
  it("lists the password rules and explains a temporary password", () => {
    renderForm();

    expect(screen.getByText(/temporary password/)).toBeInTheDocument();
    expect(
      screen.getByText("At least 12 characters (and at most 128)"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toHaveAccessibleDescription(
      /must be/,
    );
  });

  it("blocks submitting when the confirmation doesn't match", async () => {
    const fetchMock = respondWith(204);
    renderForm();

    await fillAndSubmit({ confirm: "Something else entirely" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getByLabelText("Confirm new password"),
    ).toHaveAccessibleDescription("Passwords don't match.");
    expect(push).not.toHaveBeenCalled();
  });

  it("shows a wrong current password next to that field", async () => {
    respondWith(400, { code: "wrong_password", detail: "Incorrect." });
    renderForm();

    await fillAndSubmit();

    const field = await screen.findByLabelText("Current password");
    await vi.waitFor(() =>
      expect(field).toHaveAccessibleDescription(
        "Current password is incorrect.",
      ),
    );
    expect(field).toHaveAttribute("aria-invalid", "true");
  });

  it("shows the API's reasons for a weak password next to the new field", async () => {
    const detail = "Password is too common. Choose a less predictable one.";
    respondWith(422, { code: "weak_password", detail });
    renderForm();

    await fillAndSubmit();

    await vi.waitFor(() =>
      expect(screen.getByLabelText("New password")).toHaveAccessibleDescription(
        expect.stringContaining(detail),
      ),
    );
  });

  it("shows the rate-limit message on 429", async () => {
    respondWith(429, { code: "rate_limited", detail: "Too many requests." });
    renderForm();

    await fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Try again in a few minutes.",
    );
  });

  it("posts the passwords, clears the flag, and goes to the portal", async () => {
    const fetchMock = respondWith(204);
    const queryClient = renderForm();

    await fillAndSubmit();

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/portal"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          current_password: "Temporary-Pass-8kQ2",
          new_password: "A distinct! password 2026",
        }),
      }),
    );
    expect(queryClient.getQueryData<Me>(["me"])?.must_change_password).toBe(
      false,
    );
  });
});
