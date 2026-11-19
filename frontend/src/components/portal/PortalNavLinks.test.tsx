import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Me } from "@/lib/portal/queries";

import { PortalNavLinks } from "./PortalNavLinks";

vi.mock("next/navigation", () => ({ usePathname: () => "/portal" }));

let unread: unknown[];
let fetchMock: ReturnType<typeof vi.fn>;

function renderLinks(role: Me["role"]) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <PortalNavLinks role={role} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  unread = [{}, {}, {}];
  fetchMock = vi.fn(async () => Response.json(unread));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PortalNavLinks", () => {
  it("shows a coordinator the unread feedback count", async () => {
    renderLinks("coordinator");
    expect(
      await screen.findByRole("link", { name: "Feedback, 3 unread" }),
    ).toHaveAttribute("href", "/portal/admin/feedback");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/feedback?unread=true",
      undefined,
    );
  });

  it("shows no badge when nothing is unread", async () => {
    unread = [];
    renderLinks("coordinator");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "Feedback" })).toBeTruthy();
  });

  it("never asks for the count on a responder's behalf", () => {
    renderLinks("responder");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
