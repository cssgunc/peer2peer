import type { UseQueryResult } from "@tanstack/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Me, useMe } from "@/lib/portal/queries";

import { portalNav } from "./nav";
import { PortalShell } from "./PortalShell";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/portal/queries", () => ({ useMe: vi.fn() }));

function mockMe(role: Me["role"]) {
  vi.mocked(useMe).mockReturnValue({
    data: {
      id: "00000000-0000-0000-0000-000000000001",
      email: "staff@example.com",
      display_name: "Staff Member",
      role,
      must_change_password: false,
      shift: null,
    },
  } as UseQueryResult<Me>);
}

function renderShell() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PortalShell>
        <p>Page content</p>
      </PortalShell>
    </QueryClientProvider>,
  );
}

const navLinks = () =>
  within(screen.getByRole("navigation", { name: "Portal" }))
    .getAllByRole("link")
    .map((link) => link.textContent);

const adminLabels = portalNav
  .filter((item) => item.coordinatorOnly)
  .map((item) => item.label);

beforeEach(() => vi.mocked(usePathname).mockReturnValue("/portal"));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PortalShell", () => {
  it("shows a coordinator every link, including all 11 admin links", () => {
    mockMe("coordinator");
    renderShell();

    expect(adminLabels).toHaveLength(11);
    expect(navLinks()).toEqual(["Inbox", "Guide", ...adminLabels]);
    expect(screen.getByText("Staff Member")).toBeInTheDocument();
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });

  it("shows a responder only Inbox and Guide", () => {
    mockMe("responder");
    renderShell();

    expect(navLinks()).toEqual(["Inbox", "Guide"]);
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  it("renders the sign-in page bare without fetching the account", () => {
    vi.mocked(usePathname).mockReturnValue("/portal/sign-in");
    renderShell();

    expect(useMe).not.toHaveBeenCalled();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });
});
