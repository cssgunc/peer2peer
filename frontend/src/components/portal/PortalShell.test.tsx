import type { UseQueryResult } from "@tanstack/react-query";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Me, useMe } from "@/lib/portal/queries";

import { portalNav } from "./nav";
import { PortalShell } from "./PortalShell";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace }),
}));
vi.mock("@/lib/portal/queries", () => ({ useMe: vi.fn() }));
// The socket has its own tests; keep the shell tests offline.
vi.mock("@/lib/portal/PortalSocketProvider", () => ({
  PortalSocketProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  ConnectionIndicator: () => null,
}));

function mockMe(role: Me["role"], mustChangePassword = false) {
  vi.mocked(useMe).mockReturnValue({
    data: {
      id: "00000000-0000-0000-0000-000000000001",
      email: "staff@example.com",
      display_name: "Staff Member",
      role,
      must_change_password: mustChangePassword,
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

  it("puts a Change password link next to Sign out", () => {
    mockMe("responder");
    renderShell();

    expect(
      screen.getByRole("link", { name: "Change password" }),
    ).toHaveAttribute("href", "/portal/password");
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("sends an account with a temporary password to the password page", () => {
    mockMe("coordinator", true);
    renderShell();

    expect(replace).toHaveBeenCalledWith("/portal/password");
    expect(screen.queryByText("Page content")).not.toBeInTheDocument();
  });

  it("shows only the password page and sign-out while the change is pending", () => {
    vi.mocked(usePathname).mockReturnValue("/portal/password");
    mockMe("coordinator", true);
    renderShell();

    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText("Page content")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Guide" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Change password" }),
    ).not.toBeInTheDocument();
  });
});
