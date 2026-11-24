import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Page from "@/app/portal/admin/resources/page";

import { type AdminResource, type AdminResourceTag } from "./ResourcesManager";

let queryClient: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;
let resources: AdminResource[];
let tags: AdminResourceTag[];
let guide: { id: string; text: string; resource_id: string | null }[];

function requests(method: string) {
  return fetchMock.mock.calls.filter(
    ([, init]) => (init?.method ?? "GET") === method,
  );
}

function resourceTable() {
  return within(screen.getByRole("table"));
}

async function openResourceForm() {
  await userEvent.click(
    await screen.findByRole("button", { name: "New resource" }),
  );
  return within(screen.getByRole("dialog", { name: "New resource" }));
}

async function openTags() {
  await screen.findByRole("table");
  await userEvent.click(screen.getByRole("tab", { name: "Tags" }));
}

function renderPage() {
  render(
    <QueryClientProvider client={queryClient}>
      <Page />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  tags = [
    { id: "tag-1", name: "Ongoing care", display_order: 2 },
    { id: "tag-2", name: "Academic support", display_order: 5 },
  ];
  resources = [
    {
      id: "resource-1",
      name: "Campus support",
      description: "Campus support description.",
      url: "https://example.org/campus",
      phone: "555-0100",
      is_unc: true,
      is_crisis: false,
      is_published: true,
      display_order: 3,
      tags: [tags[0]],
    },
    {
      id: "resource-2",
      name: "Community support",
      description: "Community support description.",
      url: "https://example.org/community",
      phone: null,
      is_unc: false,
      is_crisis: false,
      is_published: false,
      display_order: 7,
      tags: [tags[0], tags[1]],
    },
  ];
  guide = [
    {
      id: "guide-1",
      text: "I need ongoing support.",
      resource_id: "resource-1",
    },
    {
      id: "guide-2",
      text: "I need another option.",
      resource_id: "resource-2",
    },
  ];
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (method === "GET") {
      if (path === "/api/admin/resources") return Response.json(resources);
      if (path === "/api/admin/resource-tags") return Response.json(tags);
      if (path === "/api/admin/fit-guide") return Response.json(guide);
    }
    if (method === "PUT") {
      if (path === "/api/admin/resources/reorder") {
        resources = body.ids.map((id: string, index: number) => ({
          ...resources.find((resource) => resource.id === id)!,
          display_order: index,
        }));
        return Response.json(resources);
      }
      if (path === "/api/admin/resource-tags/reorder") {
        tags = body.ids.map((id: string, index: number) => ({
          ...tags.find((tag) => tag.id === id)!,
          display_order: index,
        }));
        return Response.json(tags);
      }
    }
    if (method === "POST" && path === "/api/admin/resources") {
      const resource = {
        ...body,
        id: "resource-3",
        tags: tags.filter((tag) => body.tag_ids.includes(tag.id)),
      };
      resources.push(resource);
      return Response.json(resource, { status: 201 });
    }
    if (method === "PATCH" && path.startsWith("/api/admin/resources/")) {
      const resource = resources.find((resource) =>
        path.endsWith(`/${resource.id}`),
      )!;
      Object.assign(resource, body, {
        tags: tags.filter((tag) => body.tag_ids.includes(tag.id)),
      });
      return Response.json(resource);
    }
    if (method === "POST" && path === "/api/admin/resource-tags") {
      const tag = { ...body, id: "tag-3" };
      tags.push(tag);
      return Response.json(tag, { status: 201 });
    }
    if (method === "PATCH" && path.startsWith("/api/admin/resource-tags/")) {
      const tag = tags.find((tag) => path.endsWith(`/${tag.id}`))!;
      Object.assign(tag, body);
      return Response.json(tag);
    }
    if (method === "DELETE" && path.startsWith("/api/admin/resources/")) {
      const id = path.split("/").at(-1)!;
      resources = resources.filter((resource) => resource.id !== id);
      guide = guide.map((item) =>
        item.resource_id === id ? { ...item, resource_id: null } : item,
      );
      return new Response(null, { status: 204 });
    }
    if (method === "DELETE" && path.startsWith("/api/admin/resource-tags/")) {
      const id = path.split("/").at(-1)!;
      tags = tags.filter((tag) => tag.id !== id);
      resources = resources.map((resource) => ({
        ...resource,
        tags: resource.tags.filter((tag) => tag.id !== id),
      }));
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  renderPage();
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("ResourcesManager", () => {
  it("shows loading while the lists are unavailable", () => {
    cleanup();
    queryClient.clear();
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading resources and tags",
    );
    expect(
      screen.queryByRole("button", { name: "New resource" }),
    ).not.toBeInTheDocument();
  });

  it("offers a retry after an initial load fails", async () => {
    cleanup();
    queryClient.clear();
    fetchMock.mockResolvedValueOnce(
      Response.json({ detail: "Unavailable" }, { status: 503 }),
    );
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Resources and tags could not be loaded.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("table")).toBeVisible();
  });

  it("renders the page, badges and combined tag/publication filters", async () => {
    const user = userEvent.setup();
    await screen.findByRole("table");
    expect(
      screen.getByRole("heading", { level: 1, name: "Resources" }),
    ).toBeVisible();
    expect(resourceTable().getByText("UNC")).toBeVisible();
    expect(resourceTable().getByText("Published")).toBeVisible();
    expect(resourceTable().getByText("Draft")).toBeVisible();

    await user.selectOptions(screen.getByLabelText("Filter by tag"), "tag-2");
    expect(
      resourceTable().queryByText("Campus support"),
    ).not.toBeInTheDocument();
    expect(resourceTable().getByText("Community support")).toBeVisible();
    await user.selectOptions(
      screen.getByLabelText("Publication status"),
      "true",
    );
    expect(screen.getByText("No resources match these filters.")).toBeVisible();
    await user.selectOptions(
      screen.getByLabelText("Publication status"),
      "false",
    );
    expect(resourceTable().getByText("Community support")).toBeVisible();
  });

  it("creates a resource with the correct body and shows its crisis badge", async () => {
    const user = userEvent.setup();
    const form = await openResourceForm();
    await user.type(form.getByLabelText("Name"), "  New support  ");
    await user.type(
      form.getByLabelText("Description"),
      "  Helpful description.  ",
    );
    await user.type(form.getByLabelText("URL"), "https://example.org/new");
    await user.type(form.getByLabelText("Phone"), "555-0101");
    await user.click(form.getByRole("checkbox", { name: "UNC resource" }));
    await user.click(form.getByRole("checkbox", { name: "Crisis resource" }));
    await user.click(form.getByRole("checkbox", { name: "Published" }));
    await user.click(form.getByRole("checkbox", { name: "Academic support" }));
    await user.click(form.getByRole("button", { name: "Create resource" }));

    await screen.findByRole("cell", { name: "New support" });
    expect(requests("POST")).toHaveLength(1);
    const [path, init] = requests("POST")[0];
    expect(path).toBe("/api/admin/resources");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({
      name: "New support",
      description: "Helpful description.",
      url: "https://example.org/new",
      phone: "555-0101",
      is_unc: true,
      is_crisis: true,
      is_published: true,
      tag_ids: ["tag-2"],
      display_order: 8,
    });
    const row = within(resourceTable().getByText("New support").closest("tr")!);
    expect(row.getByText("Crisis")).toBeVisible();
    expect(row.getByText("UNC")).toBeVisible();
    expect(row.getByText("Academic support")).toBeVisible();
  });

  it.each([
    "ftp://example.org",
    "javascript:alert(1)",
    "example.org",
    "https://",
  ])(
    "shows a field error for invalid URL %s without sending a request",
    async (url) => {
      const user = userEvent.setup();
      const form = await openResourceForm();
      await user.type(form.getByLabelText("Name"), "Support");
      await user.type(form.getByLabelText("Description"), "Description");
      await user.type(form.getByLabelText("URL"), url);
      await user.click(form.getByRole("button", { name: "Create resource" }));

      expect(form.getByLabelText("URL")).toBeInvalid();
      expect(form.getByLabelText("URL")).toHaveAccessibleDescription(
        "Enter a valid URL starting with http:// or https://.",
      );
      expect(requests("POST")).toHaveLength(0);
    },
  );

  it("requires contact information and supports a phone-only draft", async () => {
    const user = userEvent.setup();
    const form = await openResourceForm();
    await user.type(form.getByLabelText("Name"), "Phone support");
    await user.type(form.getByLabelText("Description"), "Description");
    await user.click(form.getByRole("button", { name: "Create resource" }));
    expect(form.getByRole("alert")).toHaveTextContent(
      "Enter a URL or phone number.",
    );
    expect(requests("POST")).toHaveLength(0);

    await user.type(form.getByLabelText("Phone"), "555-0102");
    await user.click(form.getByRole("button", { name: "Create resource" }));
    await screen.findByRole("cell", { name: "Phone support" });
    expect(JSON.parse(requests("POST")[0][1].body)).toMatchObject({
      url: null,
      phone: "555-0102",
      is_published: false,
      tag_ids: [],
    });
  });

  it("edits existing fields, clears an optional contact and warns about unpublishing crisis resources", async () => {
    await screen.findByRole("table");
    resources[0].is_crisis = true;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-resources"] });
    });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Edit Campus support" }),
    );
    const form = within(screen.getByRole("dialog", { name: "Edit resource" }));
    expect(form.getByLabelText("Description")).toHaveValue(
      "Campus support description.",
    );
    expect(form.getByRole("checkbox", { name: "Ongoing care" })).toBeChecked();
    await user.clear(form.getByLabelText("URL"));
    await user.click(form.getByRole("checkbox", { name: "Published" }));
    expect(form.getByRole("note")).toHaveTextContent(
      "Unpublishing a crisis resource removes it from the footer on every public page",
    );
    await user.click(form.getByRole("checkbox", { name: "Ongoing care" }));
    await user.click(form.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(requests("PATCH")[0][0]).toBe("/api/admin/resources/resource-1");
    expect(JSON.parse(requests("PATCH")[0][1].body)).toEqual({
      name: "Campus support",
      description: "Campus support description.",
      url: null,
      phone: "555-0100",
      is_unc: true,
      is_crisis: true,
      is_published: false,
      tag_ids: [],
    });
    await waitFor(() =>
      expect(
        within(
          resourceTable().getByText("Campus support").closest("tr")!,
        ).getByText("Draft"),
      ).toBeVisible(),
    );
  });

  it("keeps the form and its values on a failed save, then allows retry", async () => {
    const user = userEvent.setup();
    const form = await openResourceForm();
    await user.type(form.getByLabelText("Name"), "Retry support");
    await user.type(form.getByLabelText("Description"), "Description");
    await user.type(form.getByLabelText("URL"), "https://example.org/retry");
    fetchMock.mockResolvedValueOnce(
      Response.json({ detail: "Unable to save." }, { status: 503 }),
    );
    await user.click(form.getByRole("button", { name: "Create resource" }));
    expect(await form.findByRole("alert")).toHaveTextContent("Unable to save.");
    expect(form.getByLabelText("Name")).toHaveValue("Retry support");
    await user.click(form.getByRole("button", { name: "Create resource" }));
    expect(
      await screen.findByRole("cell", { name: "Retry support" }),
    ).toBeVisible();
  });

  it("disables saving and closing while a save is in flight", async () => {
    const user = userEvent.setup();
    const form = await openResourceForm();
    await user.type(form.getByLabelText("Name"), "Pending support");
    await user.type(form.getByLabelText("Description"), "Description");
    await user.type(form.getByLabelText("Phone"), "555-0100");
    const request = Promise.withResolvers<Response>();
    fetchMock.mockReturnValueOnce(request.promise);
    await user.click(form.getByRole("button", { name: "Create resource" }));
    expect(form.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(form.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(form.getByLabelText("Name")).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeVisible();
    await act(async () =>
      request.resolve(Response.json({ ...resources[0], id: "resource-3" })),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(requests("POST")).toHaveLength(1);
  });

  it("names affected fit-guide items and deletes only after confirmation", async () => {
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Delete Campus support" }),
    );
    const confirmation = within(screen.getByRole("alertdialog"));
    expect(
      await confirmation.findByText("I need ongoing support."),
    ).toBeVisible();
    expect(
      confirmation.queryByText("I need another option."),
    ).not.toBeInTheDocument();
    expect(
      confirmation.getByText(/their links to this resource are cleared/),
    ).toBeVisible();
    expect(requests("DELETE")).toHaveLength(0);
    await user.click(confirmation.getByRole("button", { name: "Cancel" }));
    expect(requests("DELETE")).toHaveLength(0);

    await user.click(
      screen.getByRole("button", { name: "Delete Campus support" }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole("alertdialog")).getByRole("button", {
          name: "Delete",
        }),
      ).toBeEnabled(),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete",
      }),
    );
    await waitFor(() =>
      expect(
        resourceTable().queryByText("Campus support"),
      ).not.toBeInTheDocument(),
    );
    expect(requests("DELETE")[0]).toEqual([
      "/api/admin/resources/resource-1",
      { method: "DELETE" },
    ]);
  });

  it("blocks deletion while fit-guide usage is unavailable and allows retry", async () => {
    const user = userEvent.setup();
    await screen.findByRole("table");
    fetchMock.mockResolvedValueOnce(
      Response.json({ detail: "Unavailable" }, { status: 503 }),
    );
    await user.click(
      screen.getByRole("button", { name: "Delete Campus support" }),
    );
    const confirmation = within(screen.getByRole("alertdialog"));
    expect(await confirmation.findByRole("alert")).toHaveTextContent(
      "Fit-guide links could not be checked.",
    );
    expect(confirmation.getByRole("button", { name: "Delete" })).toBeDisabled();
    await user.click(confirmation.getByRole("button", { name: "Try again" }));
    expect(
      await confirmation.findByText("I need ongoing support."),
    ).toBeVisible();
    expect(confirmation.getByRole("button", { name: "Delete" })).toBeEnabled();
  });

  it("confirms tag deletion with a count including drafts, and removes tag badges", async () => {
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.selectOptions(
      screen.getByLabelText("Publication status"),
      "true",
    );
    await user.selectOptions(screen.getByLabelText("Filter by tag"), "tag-1");
    await openTags();
    await user.click(
      screen.getByRole("button", { name: "Delete Ongoing care" }),
    );
    let confirmation = within(screen.getByRole("alertdialog"));
    expect(
      await confirmation.findByText("2 resources use this tag."),
    ).toBeVisible();
    expect(
      confirmation.getByText(/removes it from every resource/),
    ).toBeVisible();
    expect(requests("DELETE")).toHaveLength(0);
    await user.click(confirmation.getByRole("button", { name: "Cancel" }));
    expect(requests("DELETE")).toHaveLength(0);
    await user.click(
      screen.getByRole("button", { name: "Delete Ongoing care" }),
    );
    confirmation = within(screen.getByRole("alertdialog"));
    await confirmation.findByText("2 resources use this tag.");
    await user.click(confirmation.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("tab", { name: "Resources" }));
    expect(screen.getByLabelText("Filter by tag")).toHaveValue("");
    await waitFor(() =>
      expect(
        resourceTable().queryByText("Ongoing care"),
      ).not.toBeInTheDocument(),
    );
    expect(resourceTable().getByText("Campus support")).toBeVisible();
    expect(requests("DELETE")[0][0]).toBe("/api/admin/resource-tags/tag-1");
  });

  it("keeps tag deletion disabled when its usage cannot be checked", async () => {
    const user = userEvent.setup();
    await openTags();
    fetchMock.mockResolvedValueOnce(
      Response.json({ detail: "Unavailable" }, { status: 503 }),
    );
    await user.click(
      screen.getByRole("button", { name: "Delete Ongoing care" }),
    );
    const confirmation = within(screen.getByRole("alertdialog"));
    expect(await confirmation.findByRole("alert")).toHaveTextContent(
      "Tag usage could not be checked.",
    );
    expect(confirmation.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(requests("DELETE")).toHaveLength(0);
    await user.click(confirmation.getByRole("button", { name: "Try again" }));
    expect(
      await confirmation.findByText("2 resources use this tag."),
    ).toBeVisible();
    expect(confirmation.getByRole("button", { name: "Delete" })).toBeEnabled();
  });

  it("creates and renames a tag, updating its resource badges", async () => {
    const user = userEvent.setup();
    await openTags();
    await user.click(screen.getByRole("button", { name: "New tag" }));
    let form = within(screen.getByRole("dialog"));
    await user.type(form.getByLabelText("Name"), "  New category  ");
    await user.click(form.getByRole("button", { name: "Create tag" }));
    expect(await screen.findByText("New category")).toBeVisible();
    expect(requests("POST")[0][0]).toBe("/api/admin/resource-tags");
    expect(JSON.parse(requests("POST")[0][1].body)).toEqual({
      name: "New category",
      display_order: 6,
    });
    await user.click(
      screen.getByRole("button", { name: "Rename Ongoing care" }),
    );
    form = within(screen.getByRole("dialog"));
    await user.clear(form.getByLabelText("Name"));
    await user.type(form.getByLabelText("Name"), "Continuing care");
    await user.click(form.getByRole("button", { name: "Save changes" }));
    await screen.findByText("Continuing care");
    expect(requests("PATCH")[0][0]).toBe("/api/admin/resource-tags/tag-1");
    expect(JSON.parse(requests("PATCH")[0][1].body)).toEqual({
      name: "Continuing care",
    });
    await user.click(screen.getByRole("tab", { name: "Resources" }));
    expect(resourceTable().getAllByText("Continuing care")).toHaveLength(2);
  });

  it("shows duplicate tag errors without closing the tag form", async () => {
    const user = userEvent.setup();
    await openTags();
    await user.click(screen.getByRole("button", { name: "New tag" }));
    const form = within(screen.getByRole("dialog"));
    await user.type(form.getByLabelText("Name"), "Ongoing care");
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { code: "tag_exists", detail: "A tag with this name already exists" },
        { status: 409 },
      ),
    );
    await user.click(form.getByRole("button", { name: "Create tag" }));
    expect(await form.findByRole("alert")).toHaveTextContent(
      "A tag with this name already exists",
    );
    expect(form.getByLabelText("Name")).toHaveValue("Ongoing care");
  });

  it("reorders all resource IDs even while the table is filtered", async () => {
    const user = userEvent.setup();
    await screen.findByRole("table");
    await user.selectOptions(
      screen.getByLabelText("Publication status"),
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Reorder resources" }));
    const dialog = within(screen.getByRole("dialog"));
    await user.click(
      dialog.getByRole("button", { name: "Move 'Community support' up" }),
    );
    await waitFor(() =>
      expect(dialog.getAllByRole("listitem")[0]).toHaveTextContent(
        "Community support",
      ),
    );
    expect(requests("PUT")[0][0]).toBe("/api/admin/resources/reorder");
    expect(JSON.parse(requests("PUT")[0][1].body)).toEqual({
      ids: ["resource-2", "resource-1"],
    });
    await user.click(dialog.getByRole("button", { name: "Done" }));
    await user.selectOptions(screen.getByLabelText("Publication status"), "");
    expect(resourceTable().getAllByRole("row")[1]).toHaveTextContent(
      "Community support",
    );
  });

  it("reorders tag IDs and shows the saved order", async () => {
    const user = userEvent.setup();
    await openTags();
    await user.click(
      screen.getByRole("button", { name: "Move 'Academic support' up" }),
    );
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(
        "Academic support",
      ),
    );
    expect(requests("PUT")[0][0]).toBe("/api/admin/resource-tags/reorder");
    expect(JSON.parse(requests("PUT")[0][1].body)).toEqual({
      ids: ["tag-2", "tag-1"],
    });
  });

  it("preserves the previous order after a failed reorder", async () => {
    const user = userEvent.setup();
    await openTags();
    fetchMock.mockResolvedValueOnce(
      Response.json({ detail: "Order could not be saved." }, { status: 503 }),
    );
    await user.click(
      screen.getByRole("button", { name: "Move 'Academic support' up" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Order could not be saved.",
    );
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(
      "Ongoing care",
    );
    await user.click(
      screen.getByRole("button", { name: "Move 'Academic support' up" }),
    );
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")[0]).toHaveTextContent(
        "Academic support",
      ),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps a failed delete open so it can be retried", async () => {
    const user = userEvent.setup();
    await openTags();
    await user.click(
      screen.getByRole("button", { name: "Delete Academic support" }),
    );
    const confirmation = within(screen.getByRole("alertdialog"));
    await confirmation.findByText("1 resource uses this tag.");
    fetchMock.mockResolvedValueOnce(
      Response.json({ detail: "Delete failed." }, { status: 503 }),
    );
    await user.click(confirmation.getByRole("button", { name: "Delete" }));
    expect(await confirmation.findByRole("alert")).toHaveTextContent(
      "Delete failed.",
    );
    await user.click(confirmation.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Delete Academic support" }),
    ).not.toBeInTheDocument();
  });
});
