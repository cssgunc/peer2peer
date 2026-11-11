"use client";

import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { createSocket, type SocketState } from "@/lib/ws";

import {
  conversationQueryKey,
  inboxQueryKey,
  meQueryKey,
  type PortalConversation,
  type PortalMessage,
} from "./queries";

const HEARTBEAT_MS = 30_000;
const SESSION_ENDED_CODE = 4001;

// Every event names its conversation by id; only message.created carries content.
export type PortalEvent =
  | {
      type: "conversation.created" | "conversation.updated";
      data: { conversation_id: string } & Record<string, unknown>;
    }
  | {
      type: "conversation.closed";
      data: { conversation_id: string } & Record<string, unknown>;
    }
  | {
      type: "message.created";
      data: { conversation_id: string; message: PortalMessage };
    }
  | { type: "shift.ended"; data: { shift_id: string; reason: string } }
  | { type: "session.revoked"; data: Record<string, never> };

type Listener = (event: PortalEvent) => void;

type PortalSocketContextValue = {
  state: SocketState;
  subscribe: (listener: Listener) => () => void;
};

const PortalSocketContext = createContext<PortalSocketContextValue | null>(
  null,
);

function appendMessage(
  queryClient: QueryClient,
  conversationId: string,
  message: PortalMessage,
) {
  queryClient.setQueryData<PortalConversation>(
    conversationQueryKey(conversationId),
    (conversation) => {
      // Only extend a cached conversation; the screen loads the rest over REST.
      if (!conversation) return conversation;
      if (conversation.messages.some((m) => m.id === message.id)) {
        return conversation;
      }
      return { ...conversation, messages: [...conversation.messages, message] };
    },
  );
}

function applyEvent(queryClient: QueryClient, event: PortalEvent) {
  switch (event.type) {
    case "conversation.created":
      queryClient.invalidateQueries({ queryKey: inboxQueryKey });
      break;
    case "conversation.updated":
    case "conversation.closed":
      // Responder and inactivity closes arrive as conversation.updated, so refresh the open screen too.
      queryClient.invalidateQueries({ queryKey: inboxQueryKey });
      queryClient.invalidateQueries({
        queryKey: conversationQueryKey(event.data.conversation_id),
      });
      break;
    case "message.created":
      appendMessage(
        queryClient,
        event.data.conversation_id,
        event.data.message,
      );
      queryClient.invalidateQueries({ queryKey: inboxQueryKey });
      break;
    case "shift.ended":
      queryClient.invalidateQueries({ queryKey: meQueryKey });
      toast("Your shift ended");
      break;
  }
}

export function PortalSocketProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [state, setState] = useState<SocketState>("connecting");
  const listeners = useRef(new Set<Listener>());
  const [subscribe] = useState(() => (listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  });

  useEffect(() => {
    let signedOut = false;
    // session.revoked is followed by a 4001 close; sign out once.
    function signOut() {
      if (signedOut) return;
      signedOut = true;
      socket.close();
      queryClient.clear();
      router.replace("/portal/sign-in");
    }

    const socket = createSocket<PortalEvent>({
      url: "/ws/portal",
      heartbeatMs: HEARTBEAT_MS,
      onStateChange: setState,
      onMessage: (event) => {
        if (event.type === "session.revoked") {
          signOut();
          return;
        }
        applyEvent(queryClient, event);
        for (const listener of listeners.current) listener(event);
      },
      // Messages sent while disconnected never arrive over the socket; reload them over REST.
      onReconnect: () => {
        queryClient.invalidateQueries({ queryKey: inboxQueryKey });
        queryClient.invalidateQueries({ queryKey: ["conversation"] });
      },
      onClose: (code) => {
        if (code === SESSION_ENDED_CODE) signOut();
      },
    });
    return () => socket.close();
  }, [queryClient, router]);

  return (
    <PortalSocketContext.Provider value={{ state, subscribe }}>
      {children}
    </PortalSocketContext.Provider>
  );
}

function usePortalSocket() {
  const context = useContext(PortalSocketContext);
  if (!context) {
    throw new Error(
      "Portal socket hooks must be used inside PortalSocketProvider",
    );
  }
  return context;
}

/** Calls `callback` for every portal event, after the query cache has been updated. */
export function usePortalEvents(callback: Listener) {
  const { subscribe } = usePortalSocket();
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });
  useEffect(() => subscribe((event) => latest.current(event)), [subscribe]);
}

/** Hidden while connected (or on the first connect); visible while reconnecting. */
export function ConnectionIndicator() {
  const { state } = usePortalSocket();
  if (state !== "reconnecting") return null;
  return (
    <span role="status" className="text-sm text-muted-foreground">
      Reconnecting...
    </span>
  );
}
