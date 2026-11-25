import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type AdminHours, HoursManager } from "./HoursManager";

const hours: AdminHours = {
  timezone: "America/New_York",
  weekly: [
    { day_of_week: 0, opens_at: "09:00:00", closes_at: "17:00:00" },
    { day_of_week: 2, opens_at: "18:00:00", closes_at: "22:00:00" },
  ],
  exceptions: [
    {
      id: "upcoming",
      date: "2099-11-26",
      is_closed: true,
      opens_at: null,
      closes_at: null,
      note: "Thanksgiving",
    },
    {
      id: "past",
      date: "2000-01-01",
      is_closed: true,
      opens_at: null,
      closes_at: null,
      note: null,
    },
  ],
};

type Call = { path: string; method: string; body: unknown };
let calls: Call[];
let putResponse: () => Response;

function renderManager() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <HoursManager />
    </QueryClientProvider>,
  );
}

const writes = () => calls.filter((call) => call.method !== "GET");

beforeEach(() => {
  calls = [];
  putResponse = () => Response.json(hours);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        path,
        method,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });
      if (path === "/api/admin/hours" && method === "GET")
        return Response.json(hours);
      if (path === "/api/admin/hours" && method === "PUT") return putResponse();
      if (path.startsWith("/api/admin/hours/exceptions"))
        return Response.json(hours.exceptions[0], {
          status: method === "POST" ? 201 : 200,
        });
      throw new Error(`Unexpected request: ${method} ${path}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function addFridayWindow() {
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Add window on Friday" }),
  );
  const window = screen.getByRole("group", { name: "Friday window 1" });
  fireEvent.change(within(window).getByLabelText("Opens"), {
    target: { value: "20:00" },
  });
  fireEvent.change(within(window).getByLabelText("Closes"), {
    target: { value: "02:00" },
  });
  return user;
}

describe("HoursManager weekly schedule", () => {
  it("labels the times with the line's timezone", async () => {
    renderManager();
    expect(
      await screen.findByText(/Times are in America\/New_York/),
    ).toBeVisible();
  });

  it("saves every window in the week at once", async () => {
    renderManager();
    const user = await addFridayWindow();
    expect(screen.getByText("Ends the following day")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Save weekly schedule" }),
    );

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: "/api/admin/hours",
      method: "PUT",
      body: {
        weekly: [
          { day_of_week: 0, opens_at: "09:00", closes_at: "17:00" },
          { day_of_week: 2, opens_at: "18:00", closes_at: "22:00" },
          { day_of_week: 4, opens_at: "20:00", closes_at: "02:00" },
        ],
      },
    });
    expect(await screen.findByText("Saved.")).toBeVisible();
  });

  it("drops a removed window from the saved week", async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(
      await screen.findByRole("button", { name: "Remove Monday window 1" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Save weekly schedule" }),
    );

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({
      weekly: [{ day_of_week: 2, opens_at: "18:00", closes_at: "22:00" }],
    });
  });

  it("shows the backend's overlap error inline", async () => {
    putResponse = () =>
      Response.json(
        {
          code: "validation_error",
          detail:
            "weekly: Value error, Weekly windows on the same day cannot overlap",
        },
        { status: 422 },
      );
    renderManager();
    const user = await addFridayWindow();
    await user.click(
      screen.getByRole("button", { name: "Save weekly schedule" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Weekly windows on the same day cannot overlap",
    );
    // The unsaved week stays on screen so it can be fixed.
    expect(
      screen.getByRole("group", { name: "Friday window 1" }),
    ).toBeInTheDocument();
  });

  it("won't save a window without both times", async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(
      await screen.findByRole("button", { name: "Add window on Friday" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Save weekly schedule" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Every window needs a start and end time.",
    );
    expect(writes()).toHaveLength(0);
  });
});

describe("HoursManager exceptions", () => {
  it("lists upcoming exceptions and collapses past ones", async () => {
    renderManager();
    const upcoming = await screen.findByRole("list", {
      name: "Upcoming exceptions",
    });
    expect(within(upcoming).getByText(/Thanksgiving/)).toBeVisible();
    expect(screen.getByText("Past exceptions (1)")).toBeVisible();
    expect(
      screen.getByRole("list", { hidden: true, name: "Past exceptions" }),
    ).not.toBeVisible();
  });

  it("won't submit an open exception without times", async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(
      await screen.findByRole("button", { name: "Add exception" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Date"), {
      target: { value: "2099-12-24" },
    });
    await user.click(
      within(dialog).getByRole("radio", { name: "Custom hours" }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save exception" }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Enter both an opening and a closing time.",
    );
    expect(writes()).toHaveLength(0);
  });

  it("creates a closed exception with a note", async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(
      await screen.findByRole("button", { name: "Add exception" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Date"), {
      target: { value: "2099-12-25" },
    });
    await user.type(
      within(dialog).getByLabelText("Note (optional)"),
      "Winter break",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save exception" }),
    );

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: "/api/admin/hours/exceptions",
      method: "POST",
      body: {
        date: "2099-12-25",
        is_closed: true,
        opens_at: null,
        closes_at: null,
        note: "Winter break",
      },
    });
  });

  it("edits an exception into custom hours", async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(
      await screen.findByRole("button", { name: "Edit Thu, Nov 26, 2099" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Date")).toHaveValue("2099-11-26");
    expect(within(dialog).getByLabelText("Note (optional)")).toHaveValue(
      "Thanksgiving",
    );
    await user.click(
      within(dialog).getByRole("radio", { name: "Custom hours" }),
    );
    fireEvent.change(within(dialog).getByLabelText("Opens"), {
      target: { value: "12:00" },
    });
    fireEvent.change(within(dialog).getByLabelText("Closes"), {
      target: { value: "16:00" },
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Save exception" }),
    );

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({
      path: "/api/admin/hours/exceptions/upcoming",
      method: "PATCH",
      body: {
        date: "2099-11-26",
        is_closed: false,
        opens_at: "12:00",
        closes_at: "16:00",
        note: "Thanksgiving",
      },
    });
  });

  it("asks before deleting an exception", async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(
      await screen.findByRole("button", { name: /^Delete Thu, Nov 26, 2099/ }),
    );

    const dialog = await screen.findByRole("alertdialog");
    expect(writes()).toHaveLength(0);
    await user.click(
      within(dialog).getByRole("button", { name: "Delete exception" }),
    );

    await waitFor(() =>
      expect(writes()).toEqual([
        {
          path: "/api/admin/hours/exceptions/upcoming",
          method: "DELETE",
          body: undefined,
        },
      ]),
    );
  });
});
