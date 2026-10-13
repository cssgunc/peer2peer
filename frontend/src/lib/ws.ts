// Reconnecting WebSocket client shared by the student chat and the responder
// portal (TDD 4.6.4). Callers send their auth token in the first frame from
// `onOpen`; tokens never go in the URL (TDD 4.7.3).

/** Close codes after which the server will never accept this session again. */
const AUTH_CLOSE_CODES = new Set([
  4001, // staff session ended
  4401, // texter token is invalid
]);

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const STABLE_AFTER_MS = 10_000;
const JITTER = 0.2;

export type SocketState = "connecting" | "open" | "reconnecting" | "closed";

export type SocketOptions<In, Out> = {
  /** Same-origin path such as `/ws/chat`. */
  url: string;
  /** Called on every connect, including reconnects; send the auth frame here. */
  onOpen?: (send: (data: Out) => boolean) => void;
  onMessage?: (event: In) => void;
  /** Called after a reconnect succeeds, so the caller can fetch missed messages. */
  onReconnect?: () => void;
  /** Sends `{"type":"heartbeat"}` on this interval while connected. */
  heartbeatMs?: number;
  /** Called once when the socket closes for good. */
  onClose?: (code: number) => void;
};

export type Socket<Out> = {
  /** Returns `false` instead of throwing while disconnected. */
  send: (data: Out) => boolean;
  close: () => void;
  getState: () => SocketState;
};

export function createSocket<In, Out = unknown>(
  options: SocketOptions<In, Out>,
): Socket<Out> {
  const { url, onOpen, onMessage, onReconnect, heartbeatMs, onClose } = options;

  let ws: WebSocket | null = null;
  let state: SocketState = "connecting";
  let attempt = 0;
  let hasConnected = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let stableTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  function send(data: Out | { type: "heartbeat" }): boolean {
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(data));
    return true;
  }

  function stopTimers() {
    clearTimeout(reconnectTimer);
    clearTimeout(stableTimer);
    clearInterval(heartbeatTimer);
    reconnectTimer = stableTimer = heartbeatTimer = undefined;
  }

  function connect() {
    reconnectTimer = undefined;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}${url}`);
    ws = socket;

    socket.onopen = () => {
      if (ws !== socket) return;
      state = "open";
      stableTimer = setTimeout(() => (attempt = 0), STABLE_AFTER_MS);
      if (heartbeatMs) {
        heartbeatTimer = setInterval(
          () => send({ type: "heartbeat" }),
          heartbeatMs,
        );
      }
      onOpen?.(send);
      if (hasConnected) onReconnect?.();
      hasConnected = true;
    };

    socket.onmessage = (event: MessageEvent) => {
      if (ws !== socket) return;
      let parsed: In;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      onMessage?.(parsed);
    };

    socket.onclose = (event: CloseEvent) => {
      if (ws !== socket) return;
      ws = null;
      stopTimers();
      if (AUTH_CLOSE_CODES.has(event.code)) {
        finish(event.code);
      } else {
        scheduleReconnect();
      }
    };
  }

  function scheduleReconnect() {
    state = "reconnecting";
    const base = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
    const jitter = 1 + (Math.random() * 2 - 1) * JITTER;
    const delay = Math.min(MAX_DELAY_MS, base * jitter);
    attempt++;
    reconnectTimer = setTimeout(connect, delay);
  }

  function reconnectNow() {
    if (state !== "reconnecting" || reconnectTimer === undefined) return;
    clearTimeout(reconnectTimer);
    connect();
  }

  function onVisibilityChange() {
    if (document.visibilityState === "visible") reconnectNow();
  }

  function finish(code: number) {
    state = "closed";
    window.removeEventListener("online", reconnectNow);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    onClose?.(code);
  }

  function close() {
    if (state === "closed") return;
    const socket = ws;
    ws = null;
    stopTimers();
    socket?.close(1000);
    finish(1000);
  }

  window.addEventListener("online", reconnectNow);
  document.addEventListener("visibilitychange", onVisibilityChange);
  connect();

  return { send, close, getState: () => state };
}
