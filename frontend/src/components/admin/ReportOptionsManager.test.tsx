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

import { reportOptionsQueryKey } from "@/lib/portal/queries";

import {
  type ReportOption,
  ReportOptionsManager,
} from "./ReportOptionsManager";

let options: ReportOption[];
let failNext: { status: number; detail: string } | null;
let queryClient: QueryClient;

const option = (
  id: string,
  kind: ReportOption["kind"],
  label: string,
  display_order: number,
  is_active = true,
): ReportOption => ({ id, kind, label, display_order, is_active });

// A small stand-in for the admin report options API, ordered like the real one.
function sorted() {
  return [...options].sort(
    (a, b) => a.display_order - b.display_order || a.id.localeCompare(b.id),
  );
}

async function handle(path: string, init?: RequestInit) {
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (failNext && method !== "GET") {
    const { status, detail } = failNext;
    failNext = null;
    return Response.json({ code: "error", detail }, { status });
  }
  if (path === "/api/admin/report-options" && method === "GET") {
    return Response.json(sorted());
  }
  if (path === "/api/admin/report-options" && method === "POST") {
    const created = { id: `new-${options.length}`, ...body };
    options.push(created);
    return Response.json(created, { status: 201 });
  }
  if (path === "/api/admin/report-options/reorder" && method === "PUT") {
    // Like the backend: the listed items take the positions they already held, in the new order.
    const slots = options
      .filter((o) => body.ids.includes(o.id))
      .map((o) => o.display_order)
      .sort((a, b) => a - b);
    body.ids.forEach((id: string, index: number) => {
      options.find((o) => o.id === id)!.display_order = slots[index];
    });
    return Response.json(
      body.ids.map((id: string) => options.find((o) => o.id === id)),
    );
  }
  const match = path.match(/^\/api\/admin\/report-options\/([\w-]+)$/);
  if (match && method === "PATCH") {
    const index = options.findIndex((o) => o.id === match[1]);
    options[index] = { id: match[1], ...body };
    return Response.json(options[index]);
  }
  throw new Error(`Unexpected request: ${method} ${path}`);
}

const writes = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([, init]) => init?.method && init.method !== "GET")
    .map(([path, init]) => ({
      path,
      method: init!.method,
      body: JSON.parse(String(init!.body)),
    }));

function renderManager() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ReportOptionsManager />
    </QueryClientProvider>,
  );
}

const list = (name: "Topics" | "Outcomes") =>
  screen.getByRole("region", { name });
const group = (region: HTMLElement, name: "Active" | "Inactive") => {
  const heading = within(region).getByRole("heading", {
    name: new RegExp(`^${name}`),
  });
  return heading.parentElement!;
};
const labelsIn = (element: HTMLElement) =>
  within(element)
    .queryAllByRole("listitem")
    .map((item) => item.querySelector(".font-medium")?.textContent);

beforeEach(() => {
  options = [
    option("t1", "topic", "Academic stress", 1),
    option("o1", "outcome", "Support provided", 2),
    option("t2", "topic", "Relationships", 3),
    option("o2", "outcome", "Referred to CAPS", 4),
    option("t3", "topic", "Homesickness", 5),
    option("t4", "topic", "Old topic", 6, false),
  ];
  failNext = null;
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  vi.stubGlobal("fetch", vi.fn(handle));
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("ReportOptionsManager", () => {
  it("shows topics and outcomes, each split into active and inactive", async () => {
    renderManager();
    await screen.findByText("Academic stress");

    expect(labelsIn(group(list("Topics"), "Active"))).toEqual([
      "Academic stress",
      "Relationships",
      "Homesickness",
    ]);
    expect(labelsIn(group(list("Topics"), "Inactive"))).toEqual(["Old topic"]);
    expect(labelsIn(group(list("Outcomes"), "Active"))).toEqual([
      "Support provided",
      "Referred to CAPS",
    ]);
    // No inactive outcomes, so no inactive group.
    expect(
      within(list("Outcomes")).queryByRole("heading", { name: /^Inactive/ }),
    ).toBeNull();
    expect(screen.getByText(/can't be deleted/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it.each([
    ["Topics", "New topic", "topic", "Grief"],
    ["Outcomes", "New outcome", "outcome", "Safety plan made"],
  ] as const)(
    "creating from %s sends kind %s",
    async (listName, button, kind, label) => {
      const user = userEvent.setup();
      renderManager();
      await screen.findByText("Academic stress");

      await user.click(
        within(list(listName)).getByRole("button", { name: button }),
      );
      await user.type(screen.getByLabelText("Label"), `  ${label}  `);
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() =>
        expect(within(list(listName)).getByText(label)).toBeVisible(),
      );
      expect(writes()).toEqual([
        {
          path: "/api/admin/report-options",
          method: "POST",
          body: { kind, label, display_order: 7, is_active: true },
        },
      ]);
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );

  it("deactivating sends is_active: false and moves the option to the inactive group", async () => {
    const user = userEvent.setup();
    renderManager();
    await screen.findByText("Academic stress");

    await user.click(
      screen.getByRole("button", { name: "Deactivate Relationships" }),
    );

    await waitFor(() =>
      expect(labelsIn(group(list("Topics"), "Inactive"))).toEqual([
        "Relationships",
        "Old topic",
      ]),
    );
    expect(labelsIn(group(list("Topics"), "Active"))).toEqual([
      "Academic stress",
      "Homesickness",
    ]);
    expect(writes()).toEqual([
      {
        path: "/api/admin/report-options/t2",
        method: "PATCH",
        body: {
          kind: "topic",
          label: "Relationships",
          display_order: 3,
          is_active: false,
        },
      },
    ]);
  });

  it("reactivating brings an option back to its old place", async () => {
    const user = userEvent.setup();
    options.find((o) => o.id === "t2")!.is_active = false;
    renderManager();
    await screen.findByText("Academic stress");

    await user.click(
      screen.getByRole("button", { name: "Reactivate Relationships" }),
    );

    await waitFor(() =>
      expect(labelsIn(group(list("Topics"), "Active"))).toEqual([
        "Academic stress",
        "Relationships",
        "Homesickness",
      ]),
    );
    expect(writes()[0].body.is_active).toBe(true);
  });

  it("reordering one list doesn't change the other", async () => {
    const user = userEvent.setup();
    renderManager();
    await screen.findByText("Academic stress");

    await user.click(
      screen.getByRole("button", { name: "Move 'Homesickness' up" }),
    );

    await waitFor(() =>
      expect(labelsIn(group(list("Topics"), "Active"))).toEqual([
        "Academic stress",
        "Homesickness",
        "Relationships",
      ]),
    );
    // Only this list's active ids go to the API.
    expect(writes()).toEqual([
      {
        path: "/api/admin/report-options/reorder",
        method: "PUT",
        body: { ids: ["t1", "t3", "t2"] },
      },
    ]);
    expect(labelsIn(group(list("Outcomes"), "Active"))).toEqual([
      "Support provided",
      "Referred to CAPS",
    ]);
    expect(options.find((o) => o.id === "o1")!.display_order).toBe(2);
    expect(options.find((o) => o.id === "o2")!.display_order).toBe(4);
    expect(options.find((o) => o.id === "t4")!.display_order).toBe(6);
  });

  it("renames with every field the API needs", async () => {
    const user = userEvent.setup();
    renderManager();
    await screen.findByText("Academic stress");

    await user.click(
      screen.getByRole("button", { name: "Rename Support provided" }),
    );
    const input = screen.getByLabelText("Label");
    expect(input).toHaveValue("Support provided");
    await user.clear(input);
    await user.type(input, "Supported");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(within(list("Outcomes")).getByText("Supported")).toBeVisible(),
    );
    expect(writes()).toEqual([
      {
        path: "/api/admin/report-options/o1",
        method: "PATCH",
        body: {
          kind: "outcome",
          label: "Supported",
          display_order: 2,
          is_active: true,
        },
      },
    ]);
  });

  it("caps labels at 100 characters and rejects blank or duplicate labels", async () => {
    const user = userEvent.setup();
    renderManager();
    await screen.findByText("Academic stress");
    await user.click(screen.getByRole("button", { name: "New topic" }));
    const input = screen.getByLabelText("Label");

    expect(input).toHaveAttribute("maxLength", "100");
    await user.type(input, "   ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a label.");

    await user.clear(input);
    await user.type(input, "academic STRESS");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "There's already a topic with that label.",
    );
    expect(writes()).toEqual([]);
  });

  it("refreshes the responders' report options after a change", async () => {
    const user = userEvent.setup();
    queryClient.setQueryData(reportOptionsQueryKey, {
      topics: [],
      outcomes: [],
    });
    renderManager();
    await screen.findByText("Academic stress");
    expect(
      queryClient.getQueryState(reportOptionsQueryKey)?.isInvalidated,
    ).toBe(false);

    await user.click(
      screen.getByRole("button", { name: "Deactivate Homesickness" }),
    );

    await waitFor(() =>
      expect(
        queryClient.getQueryState(reportOptionsQueryKey)?.isInvalidated,
      ).toBe(true),
    );
  });

  it("shows the API's error and keeps the dialog open when saving fails", async () => {
    failNext = {
      status: 422,
      detail: "label: String should have at most 100 characters",
    };
    const user = userEvent.setup();
    renderManager();
    await screen.findByText("Academic stress");

    await user.click(screen.getByRole("button", { name: "New outcome" }));
    await user.type(screen.getByLabelText("Label"), "Followed up");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "label: String should have at most 100 characters",
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByLabelText("Label")).toHaveValue("Followed up");
  });

  it("shows an error in the list when deactivating fails", async () => {
    failNext = { status: 404, detail: "Report option not found" };
    const user = userEvent.setup();
    renderManager();
    await screen.findByText("Academic stress");

    await user.click(
      screen.getByRole("button", { name: "Deactivate Academic stress" }),
    );

    expect(await within(list("Topics")).findByRole("alert")).toHaveTextContent(
      "Report option not found",
    );
    expect(labelsIn(group(list("Topics"), "Active"))).toContain(
      "Academic stress",
    );
  });

  it("says when a list has no active options", async () => {
    options = options.filter((o) => o.kind === "topic");
    renderManager();
    await screen.findByText("Academic stress");

    expect(
      await within(list("Outcomes")).findByText(/No active outcomes/),
    ).toBeVisible();
  });

  it("offers a retry when the options can't load", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ code: "error", detail: "nope" }, { status: 500 }),
    );
    const user = userEvent.setup();
    renderManager();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Report options could not be loaded.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Academic stress")).toBeVisible();
  });
});
