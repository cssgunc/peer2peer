import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionLabels, auditActions, AuditLogTable } from "./AuditLogTable";

// Navigation mock router
const navigation = vi.hoisted(() => {
  let search = "";
  const listeners = new Set<() => void>();
  const setSearch = (value: string) => {
    search = value;
    for (const listener of listeners) listener();
  };
  return {
    router: {
      replace: vi.fn((href: string) =>
        setSearch(new URL(href, "http://x").search),
      ),
    },
    setSearch,
    getSearch: () => search,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } =
    await vi.importActual<typeof import("react")>("react");
  return {
    useRouter: () => navigation.router,
    useSearchParams: () =>
      new URLSearchParams(
        useSyncExternalStore(navigation.subscribe, navigation.getSearch),
      ),
  };
});

let queryClient: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;

const auditLogRequests = () =>
  fetchMock.mock.calls
    .map(([path]) => path as string)
    .filter((path) => path.startsWith("/api/admin/audit-log"));

function renderAuditLog() {
  render(
    <QueryClientProvider client={queryClient}>
      <AuditLogTable />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  navigation.setSearch("");
  navigation.router.replace.mockClear();

  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  fetchMock = vi.fn(async (path: string) => {
    if (path === "/api/admin/accounts") {
      return Response.json([{ id: "actor-1", display_name: "TestName" }]);
    }

    if (path.startsWith("/api/admin/audit-log")) {
      const params = new URL(path, "http://x").searchParams;

      return Response.json({
        items: [
          {
            id: 1,
            actor_display_name: null,
            action: "escalation.view",
            target_type: "escalation",
            target_id: null,
            created_at: "2026-01-15T12:00:00Z",
          },
        ],
        page: Number(params.get("page") ?? "1"),
        page_size: 50,
        total: 101,
      });
    }

    throw new Error(`Unexpected request: ${path}`);
  });

  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("AuditLogTable", () => {
  it("changes the request when filters and page change", async () => {
    const user = userEvent.setup();
    renderAuditLog();

    await screen.findByRole("table");
    expect(auditLogRequests()).toContain("/api/admin/audit-log?page=1");

    // selecting an action
    await user.selectOptions(
      screen.getByLabelText("Action"),
      "escalation.view",
    );
    await waitFor(() =>
      expect(auditLogRequests()).toContain(
        "/api/admin/audit-log?page=1&action=escalation.view",
      ),
    );

    // selecting an actor
    await user.selectOptions(screen.getByLabelText("Actor"), "actor-1");
    await waitFor(() =>
      expect(auditLogRequests()).toContain(
        "/api/admin/audit-log?page=1&action=escalation.view&actor=actor-1",
      ),
    );

    // moving to page 2
    await user.click(await screen.findByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(auditLogRequests()).toContain(
        "/api/admin/audit-log?page=2&action=escalation.view&actor=actor-1",
      ),
    );
  });

  it("disables Previous on the first page", async () => {
    renderAuditLog();
    await screen.findByRole("table");

    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("disables Next on the last page", async () => {
    navigation.setSearch("?page=3");
    renderAuditLog();
    await screen.findByRole("table");

    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("null actor shows 'Deleted Account'", async () => {
    renderAuditLog();

    expect(await screen.findByText("Deleted account")).toBeTruthy();
  });

  it("no edit or delete control anywhere", async () => {
    renderAuditLog();
    await screen.findByRole("table");

    expect(screen.queryByRole("button", { name: /edit|delete/i })).toBeNull();
  });

  it("has a readable label for every audit action", () => {
    expect([...auditActions].sort()).toEqual(Object.keys(actionLabels).sort());

    for (const action of auditActions) {
      expect(actionLabels[action]).toBeTruthy();
      expect(actionLabels[action]).not.toBe(action);
    }
  });
});
