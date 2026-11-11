import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeWebSocket } from "@/lib/fake-websocket";

import {
  ConnectionIndicator,
  PortalSocketProvider,
  usePortalEvents,
} from "./PortalSocketProvider";
import {
  conversationQueryKey,
  inboxQueryKey,
  meQueryKey,
  type PortalConversation,
  type PortalMessage,
} from "./queries";

const replace = vi.fn();
// A stable router like Next's, so re-renders don't reopen the socket.
const router = { push: vi.fn(), replace };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("sonner", () => ({ toast: vi.fn() }));

const CONVERSATION_ID = "c1";

const message = (id: string): PortalMessage => ({
  id,
  sender: "texter",
  body: "hello",
  created_at: "2026-11-11T12:00:00Z",
  delivery_status: "received",
});

const conversation = (messages: PortalMessage[]): PortalConversation => ({
  conversation_id: CONVERSATION_ID,
  label: "Texter 1",
  channel: "web",
  status: "active",
  opened_at: "2026-11-11T12:00:00Z",
  closed_at: null,
  messages,
});

let queryClient: QueryClient;
const ws = () => FakeWebSocket.instances.at(-1)!;
const emit = (event: object) => act(() => ws().emit(JSON.stringify(event)));
const isStale = (key: readonly unknown[]) =>
  queryClient.getQueryState(key)?.isInvalidated;

function seed() {
  queryClient.setQueryData(inboxQueryKey, []);
  queryClient.setQueryData(meQueryKey, {});
  queryClient.setQueryData(
    conversationQueryKey(CONVERSATION_ID),
    conversation([message("m1")]),
  );
}

function renderProvider(children?: React.ReactNode) {
  render(
    <QueryClientProvider client={queryClient}>
      <PortalSocketProvider>
        <ConnectionIndicator />
        {children}
      </PortalSocketProvider>
    </QueryClientProvider>,
  );
  act(() => ws().open());
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  queryClient = new QueryClient();
  seed();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("PortalSocketProvider", () => {
  it("connects to /ws/portal and sends a heartbeat every 30 seconds", () => {
    renderProvider();
    expect(ws().url).toBe(`ws://${window.location.host}/ws/portal`);
    act(() => vi.advanceTimersByTime(60_000));
    expect(ws().sent).toEqual([{ type: "heartbeat" }, { type: "heartbeat" }]);
  });

  it("invalidates the inbox on conversation.created", () => {
    renderProvider();
    emit({
      type: "conversation.created",
      data: { conversation_id: "c2" },
    });
    expect(isStale(inboxQueryKey)).toBe(true);
    expect(isStale(conversationQueryKey(CONVERSATION_ID))).toBe(false);
  });

  it.each(["conversation.updated", "conversation.closed"])(
    "invalidates the inbox and the conversation on %s",
    (type) => {
      renderProvider();
      emit({ type, data: { conversation_id: CONVERSATION_ID } });
      expect(isStale(inboxQueryKey)).toBe(true);
      expect(isStale(conversationQueryKey(CONVERSATION_ID))).toBe(true);
    },
  );

  it("appends a new message once and invalidates the inbox", () => {
    renderProvider();
    const event = {
      type: "message.created",
      data: { conversation_id: CONVERSATION_ID, message: message("m2") },
    };
    emit(event);
    emit(event);
    emit({
      type: "message.created",
      data: { conversation_id: CONVERSATION_ID, message: message("m1") },
    });

    const cached = queryClient.getQueryData<PortalConversation>(
      conversationQueryKey(CONVERSATION_ID),
    );
    expect(cached?.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(isStale(inboxQueryKey)).toBe(true);
  });

  it("leaves an uncached conversation uncached", () => {
    renderProvider();
    emit({
      type: "message.created",
      data: { conversation_id: "c2", message: message("m9") },
    });
    expect(
      queryClient.getQueryData(conversationQueryKey("c2")),
    ).toBeUndefined();
  });

  it("refreshes me and shows a toast without message text on shift.ended", () => {
    renderProvider();
    emit({ type: "shift.ended", data: { shift_id: "s1", reason: "ended" } });
    expect(isStale(meQueryKey)).toBe(true);
    expect(toast).toHaveBeenCalledWith("Your shift ended");
  });

  it("clears the cache and goes to sign-in on session.revoked", () => {
    renderProvider();
    emit({ type: "session.revoked", data: {} });
    act(() => ws().serverClose(4001));
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/portal/sign-in");
  });

  it("clears the cache and goes to sign-in when closed with 4001", () => {
    renderProvider();
    act(() => ws().serverClose(4001));
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(replace).toHaveBeenCalledWith("/portal/sign-in");
  });

  it("shows Reconnecting... while down and invalidates queries after reconnecting", () => {
    renderProvider();
    expect(screen.queryByText("Reconnecting...")).not.toBeInTheDocument();

    act(() => ws().serverClose(1006));
    expect(screen.getByText("Reconnecting...")).toBeInTheDocument();
    expect(isStale(inboxQueryKey)).toBe(false);

    act(() => vi.advanceTimersByTime(1_000));
    act(() => ws().open());
    expect(screen.queryByText("Reconnecting...")).not.toBeInTheDocument();
    expect(isStale(inboxQueryKey)).toBe(true);
    expect(isStale(conversationQueryKey(CONVERSATION_ID))).toBe(true);
    expect(replace).not.toHaveBeenCalled();
  });

  it("passes events to usePortalEvents listeners", () => {
    const listener = vi.fn();
    function Listener() {
      usePortalEvents(listener);
      return null;
    }
    renderProvider(<Listener />);
    const event = {
      type: "conversation.created",
      data: { conversation_id: "c2" },
    };
    emit(event);
    expect(listener).toHaveBeenCalledWith(event);
  });

  it("closes the socket on unmount without redirecting", () => {
    renderProvider();
    cleanup();
    expect(ws().readyState).toBe(FakeWebSocket.CLOSED);
    expect(replace).not.toHaveBeenCalled();
  });
});
