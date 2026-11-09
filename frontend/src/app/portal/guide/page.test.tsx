import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import Page from "./page";

let queryClient: QueryClient;

function renderPage() {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <Page />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("Guide page", () => {
  it("shows a loading status while fetching the staff guide", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Loading guide");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Responder Guide",
    );
  });

  it("renders the stored title and Markdown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          slug: "portal.guide",
          title: "Updated responder guide",
          body_md: "## Resources\n\nFollow the **protocol**.",
          updated_at: "2026-11-09T12:00:00Z",
        }),
      ),
    );
    renderPage();

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Updated responder guide",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 2, name: "Resources" }),
    ).toBeVisible();
    expect(screen.getByText("protocol").tagName).toBe("STRONG");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("offers a retry when the guide fails to load", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ detail: "Unavailable" }, { status: 503 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          slug: "portal.guide",
          title: "Responder Guide",
          body_md: "Guide is available again.",
          updated_at: null,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The guide could not be loaded",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Guide is available again.")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
