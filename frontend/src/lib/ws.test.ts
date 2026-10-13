import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSocket } from "./ws";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  // Test helpers that simulate the server side.
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  emit(data: string) {
    this.onmessage?.({ data });
  }

  serverClose(code: number) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code });
  }
}

const latest = () => FakeWebSocket.instances.at(-1)!;

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  // No jitter, so delays are exactly 1s, 2s, 4s, ...
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createSocket", () => {
  it("connects to a same-origin ws:// URL", () => {
    createSocket({ url: "/ws/chat" });
    expect(latest().url).toBe(`ws://${window.location.host}/ws/chat`);
  });

  it("sends the auth frame on every open", () => {
    const socket = createSocket({
      url: "/ws/chat",
      onOpen: (send) => send({ type: "auth", token: "t" }),
    });
    latest().open();
    latest().serverClose(1006);
    vi.advanceTimersByTime(1_000);
    latest().open();

    expect(FakeWebSocket.instances).toHaveLength(2);
    for (const ws of FakeWebSocket.instances) {
      expect(ws.sent[0]).toEqual({ type: "auth", token: "t" });
    }
    socket.close();
  });

  it("passes parsed JSON to onMessage and drops malformed frames", () => {
    const onMessage = vi.fn();
    createSocket({ url: "/ws/chat", onMessage });
    latest().open();
    latest().emit('{"type":"message","id":1}');
    latest().emit("not json");

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({ type: "message", id: 1 });
  });

  it("grows the backoff delay and stops at 30s", () => {
    const socket = createSocket({ url: "/ws/chat" });
    const expected = [1, 2, 4, 8, 16, 30, 30].map((s) => s * 1_000);

    for (const delay of expected) {
      const count = FakeWebSocket.instances.length;
      latest().serverClose(1006);
      vi.advanceTimersByTime(delay - 1);
      expect(FakeWebSocket.instances).toHaveLength(count);
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances).toHaveLength(count + 1);
    }
    socket.close();
  });

  it("resets the backoff once a connection stays open for 10s", () => {
    const socket = createSocket({ url: "/ws/chat" });
    latest().serverClose(1006);
    vi.advanceTimersByTime(1_000);
    latest().serverClose(1006);
    vi.advanceTimersByTime(2_000);
    latest().open();
    vi.advanceTimersByTime(10_000);
    latest().serverClose(1006);

    const count = FakeWebSocket.instances.length;
    vi.advanceTimersByTime(1_000);
    expect(FakeWebSocket.instances).toHaveLength(count + 1);
    socket.close();
  });

  it.each([4001, 4401])("does not reconnect after a %i close", (code) => {
    const onClose = vi.fn();
    const socket = createSocket({ url: "/ws/chat", onClose });
    latest().open();
    latest().serverClose(code);
    vi.advanceTimersByTime(60_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(onClose).toHaveBeenCalledWith(code);
    expect(socket.getState()).toBe("closed");
  });

  it("fires onReconnect after a drop but not on the first connect", () => {
    const onReconnect = vi.fn();
    const socket = createSocket({ url: "/ws/chat", onReconnect });
    latest().open();
    expect(onReconnect).not.toHaveBeenCalled();

    latest().serverClose(1006);
    vi.advanceTimersByTime(1_000);
    latest().open();
    expect(onReconnect).toHaveBeenCalledTimes(1);
    socket.close();
  });

  it("reconnects right away when the browser comes back online", () => {
    const socket = createSocket({ url: "/ws/chat" });
    latest().serverClose(1006);
    window.dispatchEvent(new Event("online"));

    expect(FakeWebSocket.instances).toHaveLength(2);
    socket.close();
  });

  it("sends heartbeats on the interval and stops after close()", () => {
    const onClose = vi.fn();
    const socket = createSocket({
      url: "/ws/chat",
      heartbeatMs: 5_000,
      onClose,
    });
    const ws = latest();
    ws.open();
    vi.advanceTimersByTime(10_000);
    expect(ws.sent).toEqual([{ type: "heartbeat" }, { type: "heartbeat" }]);

    socket.close();
    vi.advanceTimersByTime(60_000);
    expect(ws.sent).toHaveLength(2);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(onClose).toHaveBeenCalledWith(1000);
  });

  it("returns false from send while disconnected", () => {
    const socket = createSocket({ url: "/ws/chat" });
    expect(socket.send({ type: "message" })).toBe(false);

    latest().open();
    expect(socket.send({ type: "message" })).toBe(true);

    latest().serverClose(1006);
    expect(socket.send({ type: "message" })).toBe(false);
    socket.close();
  });
});
