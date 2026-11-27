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

import type { components } from "@/lib/api-types";
import { StatisticsManager } from "./StatisticsManager";

type AdminStatistic = components["schemas"]["AdminStatisticDTO"];
const initialStatistics: AdminStatistic[] = [
  {
    id: "a",
    label: "Students trained",
    value: "120+",
    is_published: true,
    display_order: 0,
  },
  {
    id: "b",
    label: "Years of support",
    value: "10",
    is_published: false,
    display_order: 1,
  },
  {
    id: "c",
    label: "Conversations",
    value: "500+",
    is_published: true,
    display_order: 2,
  },
];

let statistics: AdminStatistic[];
let queryClient: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;

function calls(method: string) {
  return fetchMock.mock.calls.filter(
    ([, init]) => (init?.method ?? "GET") === method,
  );
}

function renderManager() {
  render(
    <QueryClientProvider client={queryClient}>
      <StatisticsManager />
    </QueryClientProvider>,
  );
}

function preview() {
  return within(
    screen.getByRole("region", { name: "Published statistics preview" }),
  );
}

beforeEach(() => {
  statistics = initialStatistics.map((stat) => ({ ...stat }));
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (path === "/api/admin/statistics" && method === "GET") {
      return Response.json(statistics);
    }
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    if (path === "/api/admin/statistics" && method === "POST") {
      const created = { ...body, id: "d", display_order: statistics.length };
      statistics.push(created);
      return Response.json(created, { status: 201 });
    }
    if (path === "/api/admin/statistics/reorder" && method === "PUT") {
      statistics = body.ids.map((id: string, index: number) => ({
        ...statistics.find((stat) => stat.id === id)!,
        display_order: index,
      }));
      return Response.json(statistics);
    }
    const item = statistics.find(
      (stat) => path === `/api/admin/statistics/${stat.id}`,
    );
    if (item && method === "PATCH") {
      Object.assign(item, body);
      return Response.json(item);
    }
    if (item && method === "DELETE") {
      statistics = statistics.filter((stat) => stat.id !== item.id);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("StatisticsManager", () => {
  it.each([
    "New statistic",
    "Edit Students trained",
    "Delete Students trained",
  ])(
    "returns keyboard focus to %s after cancelling its dialog",
    async (name) => {
      const user = userEvent.setup();
      renderManager();
      const trigger = await screen.findByRole("button", { name });
      await user.click(trigger);
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(trigger).toHaveFocus());
    },
  );

  it("lists drafts and published statistics but previews only published items in order", async () => {
    renderManager();
    const list = await screen.findByRole("list");
    expect(within(list).getByText("120+")).toBeInTheDocument();
    expect(within(list).getByText("Years of support")).toBeInTheDocument();
    expect(within(list).getAllByText("Published")).toHaveLength(2);
    expect(within(list).getByText("Draft")).toBeInTheDocument();
    expect(
      preview()
        .getAllByRole("term")
        .map((term) => term.textContent),
    ).toEqual(["Students trained", "Conversations"]);
    expect(preview().queryByText("Years of support")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/statistics", undefined);
  });

  it.each([false, true])(
    "creates a statistic with published=%s and the right body",
    async (published) => {
      const user = userEvent.setup();
      renderManager();
      await user.click(
        await screen.findByRole("button", { name: "New statistic" }),
      );
      expect(
        screen.getByRole("checkbox", { name: "Published" }),
      ).not.toBeChecked();
      await user.type(screen.getByLabelText("Label"), "Peer supporters");
      await user.type(screen.getByLabelText("Value"), "120+");
      if (published)
        await user.click(screen.getByRole("checkbox", { name: "Published" }));
      await user.click(
        screen.getByRole("button", { name: "Create statistic" }),
      );

      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(calls("POST")).toHaveLength(1);
      expect(calls("POST")[0][0]).toBe("/api/admin/statistics");
      expect(calls("POST")[0][1].headers).toEqual({
        "Content-Type": "application/json",
      });
      expect(JSON.parse(calls("POST")[0][1].body)).toEqual({
        label: "Peer supporters",
        value: "120+",
        is_published: published,
      });
      expect(
        within(screen.getByRole("list")).getByText("Peer supporters"),
      ).toBeInTheDocument();
      expect(preview().queryByText("Peer supporters") !== null).toBe(published);
    },
  );

  it("prefills the edit dialog, sends the changed values, and updates the preview", async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(
      await screen.findByRole("button", { name: "Edit Students trained" }),
    );
    expect(screen.getByLabelText("Label")).toHaveValue("Students trained");
    expect(screen.getByLabelText("Value")).toHaveValue("120+");
    expect(screen.getByRole("checkbox", { name: "Published" })).toBeChecked();
    await user.clear(screen.getByLabelText("Label"));
    await user.type(screen.getByLabelText("Label"), "Responders trained");
    await user.clear(screen.getByLabelText("Value"));
    await user.type(screen.getByLabelText("Value"), "150+");
    await user.click(screen.getByRole("checkbox", { name: "Published" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(calls("PATCH")).toHaveLength(1);
    expect(calls("PATCH")[0][0]).toBe("/api/admin/statistics/a");
    expect(JSON.parse(calls("PATCH")[0][1].body)).toEqual({
      label: "Responders trained",
      value: "150+",
      is_published: false,
    });
    expect(
      within(screen.getByRole("list")).getByText("150+"),
    ).toBeInTheDocument();
    expect(preview().queryByText("Responders trained")).not.toBeInTheDocument();
    expect(preview().queryByText("Students trained")).not.toBeInTheDocument();
  });

  it("limits field lengths and rejects empty or whitespace-only values", async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(screen.getByRole("button", { name: "New statistic" }));
    expect(screen.getByLabelText("Label")).toHaveAttribute("maxlength", "200");
    expect(screen.getByLabelText("Value")).toHaveAttribute("maxlength", "50");
    const submit = screen.getByRole("button", { name: "Create statistic" });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText("Label"), "   ");
    await user.type(screen.getByLabelText("Value"), "120+");
    expect(submit).toBeDisabled();
    expect(calls("POST")).toHaveLength(0);
  });

  it("reorders all ids, including drafts, and updates the list and preview", async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(
      await screen.findByRole("button", { name: "Move 'Conversations' up" }),
    );
    await waitFor(() =>
      expect(
        preview()
          .getAllByRole("term")
          .map((term) => term.textContent),
      ).toEqual(["Students trained", "Conversations"]),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Move 'Conversations' up" }),
      ).toBeEnabled(),
    );
    await user.click(
      screen.getByRole("button", { name: "Move 'Conversations' up" }),
    );
    await waitFor(() =>
      expect(
        preview()
          .getAllByRole("term")
          .map((term) => term.textContent),
      ).toEqual(["Conversations", "Students trained"]),
    );
    expect(
      calls("PUT").map(([path, init]) => [path, JSON.parse(init.body)]),
    ).toEqual([
      ["/api/admin/statistics/reorder", { ids: ["a", "c", "b"] }],
      ["/api/admin/statistics/reorder", { ids: ["c", "a", "b"] }],
    ]);
    expect(
      screen.getByRole("button", { name: "Move 'Conversations' up" }),
    ).toBeDisabled();
  });

  it("asks before deleting, allows cancellation, and removes the confirmed item", async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(
      await screen.findByRole("button", { name: "Delete Students trained" }),
    );
    let dialog = screen.getByRole("alertdialog");
    expect(
      within(dialog).getByText(/120\+ \/ Students trained/),
    ).toBeInTheDocument();
    expect(calls("DELETE")).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(calls("DELETE")).toHaveLength(0);

    await user.click(
      screen.getByRole("button", { name: "Delete Students trained" }),
    );
    dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(calls("DELETE")).toEqual([
      ["/api/admin/statistics/a", { method: "DELETE" }],
    ]);
    expect(screen.queryByText("Students trained")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "New statistic" }),
      ).toHaveFocus(),
    );
  });

  it("keeps a failed save open with the entered data and permits retry", async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(
      await screen.findByRole("button", { name: "Edit Students trained" }),
    );
    await user.clear(screen.getByLabelText("Value"));
    await user.type(screen.getByLabelText("Value"), "200+");
    fetchMock.mockResolvedValueOnce(
      Response.json({ detail: "Unable to save." }, { status: 500 }),
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to save.",
    );
    expect(screen.getByLabelText("Value")).toHaveValue("200+");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(preview().getByText("200+")).toBeInTheDocument();
  });

  it("keeps the delete confirmation open if deletion fails", async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(
      await screen.findByRole("button", { name: "Delete Students trained" }),
    );
    fetchMock.mockResolvedValueOnce(
      Response.json({ detail: "Unable to delete." }, { status: 500 }),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to delete.",
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(statistics).toHaveLength(3);
  });

  it("leaves the order unchanged when reordering fails", async () => {
    const user = userEvent.setup();
    renderManager();
    const move = await screen.findByRole("button", {
      name: "Move 'Students trained' down",
    });
    fetchMock.mockResolvedValueOnce(
      Response.json({ detail: "Unable to reorder." }, { status: 500 }),
    );
    await user.click(move);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to reorder.",
    );
    expect(
      screen.getByRole("button", { name: "Move 'Students trained' up" }),
    ).toBeDisabled();
    expect(
      preview()
        .getAllByRole("term")
        .map((term) => term.textContent),
    ).toEqual(["Students trained", "Conversations"]);
  });

  it("shows an empty preview when every statistic is a draft", async () => {
    statistics = statistics.map((stat) => ({ ...stat, is_published: false }));
    renderManager();
    await screen.findByRole("list");
    expect(preview().getByText(/No published statistics/)).toBeInTheDocument();
    expect(preview().queryByRole("term")).not.toBeInTheDocument();
  });

  it("shows an empty list state", async () => {
    statistics = [];
    renderManager();
    expect(await screen.findByText(/No statistics yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New statistic" })).toBeEnabled();
  });

  it("can retry a failed list request", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValueOnce(new Error("Offline"));
    renderManager();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Statistics could not be loaded.",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("list")).toBeInTheDocument();
  });
});
