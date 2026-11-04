import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SignInForm } from "./SignInForm";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const me = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "responder@example.com",
  display_name: "Responder",
  role: "responder",
  must_change_password: false,
  shift: null,
};

function respondWith(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderForm() {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <SignInForm />
    </QueryClientProvider>,
  );
  return queryClient;
}

async function submit() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), "responder@example.com");
  await user.type(screen.getByLabelText("Password"), "hunter2");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => push.mockReset());

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SignInForm", () => {
  it("shows the incorrect-credentials message on 401", async () => {
    respondWith(401, { code: "invalid_credentials", detail: "Invalid" });
    renderForm();

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Email or password is incorrect",
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the rate-limit message on 429", async () => {
    respondWith(429, { detail: "Too many requests. Try again later." });
    renderForm();

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many attempts. Try again in a few minutes.",
    );
  });

  it("shows a generic message on other errors", async () => {
    respondWith(500, {});
    renderForm();

    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong. Please try again.",
    );
  });

  it("posts the credentials, seeds the me query, and goes to the portal", async () => {
    const fetchMock = respondWith(200, me);
    const queryClient = renderForm();

    await submit();

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/portal"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/sign-in",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "responder@example.com",
          password: "hunter2",
        }),
      }),
    );
    expect(queryClient.getQueryData(["me"])).toEqual(me);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
