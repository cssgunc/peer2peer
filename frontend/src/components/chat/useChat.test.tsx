import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeWebSocket } from "@/lib/fake-websocket";

import type { ChatMessageDTO } from "./chatReducer";
import { TOKEN_KEY, useChat } from "./useChat";

const TOKEN = "secret-token";
const at = "2026-11-17T16:00:00Z";

const fetchMock = vi.fn<typeof fetch>();
const latest = () => FakeWebSocket.instances.at(-1)!;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function message(
  id: string,
  body: string,
  sender: ChatMessageDTO["sender"] = "texter",
): ChatMessageDTO {
  return { id, sender, body, created_at: at };
}

function created(m: ChatMessageDTO) {
  return JSON.stringify({
    type: "message.created",
    data: { conversation_id: "c1", message: m },
  });
}

function calls(path: string) {
  return fetchMock.mock.calls.filter(([url]) => String(url).startsWith(path));
}

/** Renders the hook and waits for the stored-token check to finish. */
async function setup() {
  const view = renderHook(() => useChat());
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  return view;
}

/** Starts a fresh chat and opens its socket. */
async function started() {
  fetchMock.mockResolvedValueOnce(json({ token: TOKEN }, 201));
  const view = await setup();
  await act(() => view.result.current.start());
  act(() => latest().open());
  return view;
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("fetch", fetchMock);
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useChat", () => {
  it("shows the notice when there is no stored token", async () => {
    const { result } = await setup();
    expect(result.current.state.phase).toBe("notice");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("start stores the token in sessionStorage and sends the auth frame", async () => {
    const { result } = await started();

    const [url, init] = calls("/api/chat/sessions")[0];
    expect(url).toBe("/api/chat/sessions");
    expect(init?.method).toBe("POST");
    expect(window.sessionStorage.getItem(TOKEN_KEY)).toBe(TOKEN);
    expect(window.localStorage.length).toBe(0);

    expect(latest().url).toBe(`ws://${window.location.host}/ws/chat`);
    expect(latest().url).not.toContain(TOKEN);
    expect(latest().sent).toEqual([{ type: "auth", token: TOKEN }]);
    expect(result.current.state.phase).toBe("active");
  });

  it("sends a message as pending and confirms it with the server's echo", async () => {
    const { result } = await started();
    act(() => result.current.send("hello"));

    expect(latest().sent.at(-1)).toEqual({ type: "message", body: "hello" });
    expect(result.current.state.messages).toEqual([
      expect.objectContaining({ body: "hello", status: "pending" }),
    ]);

    const real = message("m1", "hello");
    act(() => latest().emit(created(real)));
    expect(result.current.state.messages).toEqual([real]);
  });

  it("matches an echo to the oldest pending message with the same body", async () => {
    const { result } = await started();
    act(() => {
      result.current.send("same");
      result.current.send("other");
      result.current.send("same");
    });
    const [first, , third] = result.current.state.messages;

    act(() => latest().emit(created(message("m1", "same"))));
    const ids = result.current.state.messages.map((m) => m.id);
    expect(ids).toEqual(["m1", expect.any(String), third.id]);
    expect(ids).not.toContain(first.id);
    expect(result.current.state.messages[2].status).toBe("pending");
  });

  it("adds a texter message from another tab without touching pending ones", async () => {
    const { result } = await started();
    act(() => result.current.send("mine"));
    act(() => latest().emit(created(message("m9", "from another tab"))));

    expect(result.current.state.messages.map((m) => m.body)).toEqual([
      "mine",
      "from another tab",
    ]);
    expect(result.current.state.messages[0].status).toBe("pending");
  });

  it("marks the pending message failed on an error frame, and retries it", async () => {
    const { result } = await started();
    act(() => result.current.send("hello"));
    act(() =>
      latest().emit(
        JSON.stringify({
          type: "error",
          code: "rate_limited",
          detail: "Slow down.",
        }),
      ),
    );

    const tempId = result.current.state.messages[0].id;
    expect(result.current.state.messages[0].status).toBe("failed");
    expect(result.current.state.error).toBe("A message didn't send.");

    act(() => result.current.retry(tempId));
    expect(result.current.state.messages[0].status).toBe("pending");
    expect(latest().sent.at(-1)).toEqual({ type: "message", body: "hello" });
  });

  it("marks a message failed when the socket is down", async () => {
    const { result } = await started();
    act(() => latest().serverClose(1006));
    act(() => result.current.send("hello"));

    expect(result.current.state.messages[0].status).toBe("failed");
  });

  it("fetches with after=<last id> on reconnect and adds what was missed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { result } = await started();
    act(() => latest().emit(created(message("m1", "Hi there", "responder"))));

    act(() => latest().serverClose(1006));
    fetchMock.mockResolvedValueOnce(
      json({
        id: "c1",
        status: "active",
        messages: [message("m2", "You still there?", "responder")],
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    act(() => latest().open());

    await waitFor(() =>
      expect(result.current.state.messages.map((m) => m.id)).toEqual([
        "m1",
        "m2",
      ]),
    );
    const [url, init] = calls("/api/chat/conversation")[0];
    expect(url).toBe("/api/chat/conversation?after=m1");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      `Bearer ${TOKEN}`,
    );
    expect(latest().sent[0]).toEqual({ type: "auth", token: TOKEN });
  });

  it("ends the chat and clears the token on conversation.closed", async () => {
    const { result } = await started();
    act(() => latest().emit(created(message("m1", "Take care", "responder"))));
    act(() =>
      latest().emit(
        JSON.stringify({
          type: "conversation.closed",
          data: { conversation_id: "c1", closed_by: "responder" },
        }),
      ),
    );

    expect(result.current.state.phase).toBe("ended");
    // A responder close keeps the transcript until the student starts over.
    expect(result.current.state.messages).toHaveLength(1);
    expect(window.sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(latest().readyState).toBe(FakeWebSocket.CLOSED);
  });

  it("ends the chat and clears the token on a 4401 close", async () => {
    const { result } = await started();
    act(() => latest().serverClose(4401));

    expect(result.current.state.phase).toBe("ended");
    expect(window.sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("ends the conversation over REST, then clears the token and transcript", async () => {
    const { result } = await started();
    act(() => latest().emit(created(message("m1", "Hi", "responder"))));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await act(() => result.current.end());

    const [url, init] = calls("/api/chat/conversation/end")[0];
    expect(url).toBe("/api/chat/conversation/end");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      `Bearer ${TOKEN}`,
    );
    expect(window.sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(result.current.state).toEqual({
      phase: "ended",
      messages: [],
      error: null,
    });

    act(() => result.current.startOver());
    expect(result.current.state.phase).toBe("notice");
  });

  it("resumes the conversation on a refresh with a stored token", async () => {
    window.sessionStorage.setItem(TOKEN_KEY, TOKEN);
    const history = [
      message("m1", "hello"),
      message("m2", "Hi, I'm here", "responder"),
    ];
    fetchMock.mockResolvedValueOnce(
      json({ id: "c1", status: "active", messages: history }),
    );

    const { result } = await setup();

    const [url, init] = calls("/api/chat/conversation")[0];
    expect(url).toBe("/api/chat/conversation");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      `Bearer ${TOKEN}`,
    );
    expect(result.current.state).toEqual({
      phase: "active",
      messages: history,
      error: null,
    });
    expect(calls("/api/chat/sessions")).toHaveLength(0);

    act(() => latest().open());
    expect(latest().sent).toEqual([{ type: "auth", token: TOKEN }]);
  });

  it("resumes with an empty chat when no message has been sent yet", async () => {
    window.sessionStorage.setItem(TOKEN_KEY, TOKEN);
    fetchMock.mockResolvedValueOnce(
      json({ code: "no_conversation", detail: "No conversation yet." }, 404),
    );

    const { result } = await setup();
    expect(result.current.state.phase).toBe("active");
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("drops a stored token the server no longer accepts", async () => {
    window.sessionStorage.setItem(TOKEN_KEY, TOKEN);
    fetchMock.mockResolvedValueOnce(
      json({ code: "invalid_token", detail: "Invalid chat token." }, 401),
    );

    const { result } = await setup();
    expect(result.current.state.phase).toBe("notice");
    expect(window.sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("shows a resumed conversation that already closed as ended", async () => {
    window.sessionStorage.setItem(TOKEN_KEY, TOKEN);
    fetchMock.mockResolvedValueOnce(
      json({
        id: "c1",
        status: "closed",
        messages: [message("m1", "Take care", "responder")],
      }),
    );

    const { result } = await setup();
    expect(result.current.state.phase).toBe("ended");
    expect(result.current.state.messages).toHaveLength(1);
    expect(window.sessionStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("never logs message bodies or the token", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (level) => vi.spyOn(console, level).mockImplementation(() => {}),
    );
    const { result } = await started();
    act(() => result.current.send("a private message"));
    act(() => latest().emit(created(message("m1", "a private message"))));

    for (const spy of spies) {
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).not.toContain("a private message");
      expect(logged).not.toContain(TOKEN);
      spy.mockRestore();
    }
  });
});
