import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PortalConversation } from "@/lib/portal/queries";

import { ConversationView } from "./ConversationView";

const ID = "c1";
const base: PortalConversation = {
  conversation_id: ID,
  label: "Texter 3",
  channel: "sms",
  status: "active",
  opened_at: "2026-11-13T15:00:00Z",
  closed_at: null,
  messages: [
    {
      id: "m1",
      sender: "system",
      body: "We're closed right now.",
      created_at: "2026-11-13T15:00:00Z",
      delivery_status: null,
    },
    {
      id: "m2",
      sender: "texter",
      body: "hello there",
      created_at: "2026-11-13T15:01:00Z",
      delivery_status: null,
    },
    {
      id: "m3",
      sender: "responder",
      body: "hi, I'm here",
      created_at: "2026-11-13T15:02:00Z",
      delivery_status: null,
    },
  ],
};

type Handler = (
  url: string,
  init?: RequestInit,
) => Response | Promise<Response>;
let handler: Handler;
const calls: { url: string; method: string }[] = [];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

function renderView(
  props: Partial<Parameters<typeof ConversationView>[0]> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ConversationView id={ID} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  calls.length = 0;
  Element.prototype.scrollIntoView = vi.fn();
  handler = (url) => {
    if (url === "/api/portal/guide") return json({});
    return json(base);
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.endsWith("/read")) return new Response(null, { status: 204 });
      return handler(url, init);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ConversationView", () => {
  it("renders messages in order, responder on the right and system apart", async () => {
    renderView();
    const items = await screen.findAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("We're closed right now."),
      expect.stringContaining("hello there"),
      expect.stringContaining("hi, I'm here"),
    ]);
    expect(items[0]).toHaveClass("self-center");
    expect(items[1]).toHaveClass("self-start");
    expect(items[2]).toHaveClass("self-end");
    expect(
      screen.getByRole("heading", { name: "Texter 3" }),
    ).toBeInTheDocument();
  });

  it("marks the conversation read when it opens", async () => {
    renderView();
    await screen.findByText("hello there");
    expect(calls).toContainEqual({
      url: `/api/portal/conversations/${ID}/read`,
      method: "POST",
    });
  });

  it("shows a sent message as pending, then saved", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    handler = async (url, init) => {
      if (init?.method === "POST" && url.endsWith("/messages")) {
        await gate;
        return json(
          {
            id: "m4",
            sender: "responder",
            body: "on my way",
            created_at: "2026-11-13T15:03:00Z",
            delivery_status: null,
          },
          201,
        );
      }
      return json(base);
    };
    renderView();
    await userEvent.type(
      await screen.findByLabelText("Message"),
      "on my way{Enter}",
    );
    const pending = screen.getByText("on my way");
    expect(pending).toHaveClass("opacity-70");
    release();
    await waitFor(() =>
      expect(screen.getByText("on my way")).not.toHaveClass("opacity-70"),
    );
    expect(screen.getAllByText("on my way")).toHaveLength(1);
  });

  it("lets a failed send be retried", async () => {
    let attempts = 0;
    handler = (url, init) => {
      if (init?.method === "POST" && url.endsWith("/messages")) {
        attempts += 1;
        if (attempts === 1) return json({ code: "boom", detail: "x" }, 500);
        return json(
          {
            id: "m4",
            sender: "responder",
            body: "again",
            created_at: "2026-11-13T15:03:00Z",
            delivery_status: null,
          },
          201,
        );
      }
      return json(base);
    };
    renderView();
    await userEvent.type(
      await screen.findByLabelText("Message"),
      "again{Enter}",
    );
    await userEvent.click(
      await screen.findByRole("button", { name: /tap to retry/i }),
    );
    await waitFor(() => expect(screen.queryByText(/tap to retry/i)).toBeNull());
    expect(attempts).toBe(2);
    expect(screen.getAllByText("again")).toHaveLength(1);
  });

  it("asks for confirmation before ending", async () => {
    renderView();
    await userEvent.click(
      await screen.findByRole("button", { name: "End conversation" }),
    );
    expect(calls.some((c) => c.url.endsWith("/end"))).toBe(false);
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(
      Array.from(dialog.querySelectorAll("button")).find(
        (b) => b.textContent === "End conversation",
      )!,
    );
    await waitFor(() =>
      expect(calls).toContainEqual({
        url: `/api/portal/conversations/${ID}/end`,
        method: "POST",
      }),
    );
  });

  it("replaces the composer with the report slot once closed", async () => {
    handler = () =>
      json({ ...base, status: "closed", closed_at: "2026-11-13T16:00:00Z" });
    renderView({ reportSlot: <p>report form</p> });
    expect(
      await screen.findByText("This conversation has ended"),
    ).toBeInTheDocument();
    expect(screen.getByText("report form")).toBeInTheDocument();
    expect(screen.queryByLabelText("Message")).toBeNull();
  });

  it("shows the unavailable state on a 404", async () => {
    handler = () =>
      json({ code: "conversation_not_found", detail: "gone" }, 404);
    const onUnavailable = vi.fn();
    renderView({ onUnavailable });
    expect(
      await screen.findByText("This conversation is no longer available"),
    ).toBeInTheDocument();
    expect(onUnavailable).toHaveBeenCalled();
  });
});
