"use client";

// Connects the chat window to the backend (TDD 4.6.2, 4.6.4): REST for the
// session, resume, catch-up and ending; the texter WebSocket for live messages.
// Never log message bodies or the token: this page must stay anonymous.

import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";
import { createSocket, type Socket } from "@/lib/ws";

import {
  chatReducer,
  initialChatState,
  type ChatMessageDTO,
  type ClosedBy,
} from "./chatReducer";

/** `sessionStorage`, not `localStorage`: closing the tab ends the identity. */
export const TOKEN_KEY = "p2p_chat_token";

const INVALID_TOKEN_CODE = 4401;

type ChatSession = { token: string };

type ChatConversation = {
  id: string;
  status: "queued" | "active" | "closed";
  messages: ChatMessageDTO[];
};

type ServerFrame =
  | {
      type: "message.created";
      data: { conversation_id: string; message: ChatMessageDTO };
    }
  | {
      type: "conversation.closed";
      data: { conversation_id?: string; closed_by: ClosedBy };
    }
  | { type: "status.changed"; data: { conversation_id: string } }
  | { type: "error"; code: string; detail: string };

type ClientFrame =
  { type: "auth"; token: string } | { type: "message"; body: string };

/** A sent message the server hasn't echoed back yet. */
type Outgoing = { tempId: string; body: string; status: "pending" | "failed" };

function readToken(): string | null {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string) {
  try {
    window.sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage is blocked; the chat still works until the tab reloads.
  }
}

function clearToken() {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
}

function chatFetch<T>(path: string, token: string, init?: RequestInit) {
  return apiFetch<T>(path, {
    ...init,
    // The token goes in a header, never the URL.
    credentials: "omit",
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
}

function fetchConversation(token: string, after?: string | null) {
  const query = after ? `?after=${encodeURIComponent(after)}` : "";
  return chatFetch<ChatConversation>(`/api/chat/conversation${query}`, token);
}

export function useChat() {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  /** The token the socket runs on; null when there's no live conversation. */
  const [token, setTokenState] = useState<string | null>(null);
  /** False until a stored token has been checked, so the notice never flashes. */
  const [ready, setReady] = useState(false);

  const tokenRef = useRef<string | null>(null);
  const socketRef = useRef<Socket<ClientFrame> | null>(null);
  const outboxRef = useRef<Outgoing[]>([]);
  const knownIdsRef = useRef(new Set<string>());
  const lastIdRef = useRef<string | null>(null);
  const endedRef = useRef(false);
  const startingRef = useRef(false);
  const resumeStartedRef = useRef(false);
  const tempCounterRef = useRef(0);

  function setToken(next: string | null) {
    tokenRef.current = next;
    setTokenState(next);
  }

  function resetSession() {
    outboxRef.current = [];
    knownIdsRef.current = new Set();
    lastIdRef.current = null;
    endedRef.current = false;
  }

  function fail(entry: Outgoing) {
    entry.status = "failed";
    dispatch({ type: "messageFailed", tempId: entry.tempId });
  }

  /** Adds a server message, confirming the matching pending message if it's ours. */
  function receive(message: ChatMessageDTO) {
    if (knownIdsRef.current.has(message.id)) return;
    knownIdsRef.current.add(message.id);
    lastIdRef.current = message.id;

    if (message.sender === "texter") {
      // The echo confirms the oldest pending message with the same body.
      const outbox = outboxRef.current;
      const match = outbox.find(
        (m) => m.status === "pending" && m.body === message.body,
      );
      if (match) {
        outbox.splice(outbox.indexOf(match), 1);
        dispatch({ type: "messageConfirmed", tempId: match.tempId, message });
        return;
      }
    }
    dispatch({ type: "messageReceived", message });
  }

  /** Ends the chat locally: forgets the token and closes the socket. */
  function finish(by: ClosedBy) {
    if (endedRef.current) return;
    endedRef.current = true;
    clearToken();
    outboxRef.current = [];
    setToken(null);
    dispatch({ type: "conversationClosed", by });
  }

  function loadConversation(conversation: ChatConversation) {
    conversation.messages.forEach(receive);
    if (conversation.status === "closed") finish("system");
  }

  /** Fetches anything missed while disconnected (TDD 4.6.4). */
  const catchUp = useEffectEvent(async (current: string) => {
    try {
      const conversation = await fetchConversation(current, lastIdRef.current);
      if (endedRef.current || current !== tokenRef.current) return;
      loadConversation(conversation);
    } catch {
      // Nothing to add, or a blip the next reconnect retries.
    }
  });

  const handleFrame = useEffectEvent((frame: ServerFrame) => {
    if (endedRef.current) return;
    switch (frame.type) {
      case "message.created":
        receive(frame.data.message);
        break;
      case "conversation.closed":
        finish(frame.data.closed_by ?? "system");
        break;
      case "error": {
        // Errors only answer this socket's own message frames, in order.
        const entry = outboxRef.current.find((m) => m.status === "pending");
        if (entry) fail(entry);
        break;
      }
    }
  });

  const handleOpen = useEffectEvent(
    (current: string, send: (frame: ClientFrame) => boolean) => {
      send({ type: "auth", token: current });
      dispatch({ type: "connected" });
    },
  );

  const handleClose = useEffectEvent((code: number) => {
    // 1000 is our own close. 4401 means the token is no longer valid.
    if (code === INVALID_TOKEN_CODE) finish("system");
  });

  useEffect(() => {
    if (!token) return;
    const socket = createSocket<ServerFrame, ClientFrame>({
      url: "/ws/chat",
      onOpen: (send) => handleOpen(token, send),
      onMessage: (frame) => handleFrame(frame),
      onReconnect: () => void catchUp(token),
      onClose: (code) => handleClose(code),
    });
    socketRef.current = socket;
    return () => {
      if (socketRef.current === socket) socketRef.current = null;
      socket.close();
    };
  }, [token]);

  // A token already in this tab means a refresh: resume instead of showing
  // the notice again.
  const resume = useEffectEvent(async () => {
    const stored = readToken();
    if (!stored) {
      setReady(true);
      return;
    }
    let conversation: ChatConversation | null = null;
    try {
      conversation = await fetchConversation(stored);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearToken();
        setReady(true);
        return;
      }
      // 404 means no message has been sent yet; the chat is still live.
    }
    dispatch({ type: "started" });
    dispatch({ type: "connected" });
    if (conversation) loadConversation(conversation);
    if (!endedRef.current) setToken(stored);
    setReady(true);
  });

  useEffect(() => {
    if (resumeStartedRef.current) return;
    resumeStartedRef.current = true;
    void resume();
  }, []);

  async function start() {
    if (startingRef.current) return;
    startingRef.current = true;
    resetSession();
    dispatch({ type: "started" });
    try {
      const session = await apiFetch<ChatSession>("/api/chat/sessions", {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
      });
      // Ended while the session was being created: never use it.
      if (endedRef.current) return;
      storeToken(session.token);
      setToken(session.token);
    } catch {
      dispatch({ type: "reset" });
    } finally {
      startingRef.current = false;
    }
  }

  function transmit(entry: Outgoing) {
    const sent = socketRef.current?.send({ type: "message", body: entry.body });
    if (!sent) fail(entry);
  }

  function send(body: string) {
    if (endedRef.current) return;
    tempCounterRef.current += 1;
    const entry: Outgoing = {
      tempId: `temp-${tempCounterRef.current}`,
      body,
      status: "pending",
    };
    outboxRef.current.push(entry);
    dispatch({
      type: "messageSent",
      tempId: entry.tempId,
      body,
      createdAt: new Date().toISOString(),
    });
    transmit(entry);
  }

  function retry(tempId: string) {
    const entry = outboxRef.current.find(
      (m) => m.tempId === tempId && m.status === "failed",
    );
    if (!entry) return;
    entry.status = "pending";
    dispatch({ type: "messageRetried", tempId });
    transmit(entry);
  }

  async function end() {
    const current = tokenRef.current ?? readToken();
    try {
      if (current) {
        await chatFetch<void>("/api/chat/conversation/end", current, {
          method: "POST",
        });
      }
    } catch {
      // Forget the token anyway; the server closes idle conversations itself.
    }
    finish("texter");
  }

  function startOver() {
    resetSession();
    dispatch({ type: "reset" });
  }

  return { state, ready, start, send, retry, end, startOver };
}
