"use client";

// Dev-only harness: drives ChatWindow with fake timers instead of the API.
// Send a message containing "fail" to see the retry state.

import { useReducer, useRef } from "react";

import ChatWindow from "@/components/chat/ChatWindow";
import { chatReducer, initialChatState } from "@/components/chat/chatReducer";

const NOTICE = `**Peer2Peer** connects you with a trained UNC student for anonymous peer support.

It is **not** a crisis service or a replacement for professional care. If you are in danger, call **911**. For a crisis, call or text **988**.

See our [privacy policy](/privacy).`;

const REPLIES = [
  "Thanks for reaching out. What's on your mind?",
  "That sounds like a lot to carry. Tell me more?",
  "I'm here. Take your time.",
];

export default function FakeChat() {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const nextId = useRef(1);
  const replyIndex = useRef(0);

  const newId = (prefix: string) => `${prefix}-${nextId.current++}`;
  const now = () => new Date().toISOString();

  function deliver(tempId: string, body: string, isRetry = false) {
    setTimeout(() => {
      if (!isRetry && body.toLowerCase().includes("fail")) {
        dispatch({ type: "messageFailed", tempId });
        return;
      }
      dispatch({
        type: "messageConfirmed",
        tempId,
        message: {
          id: newId("msg"),
          sender: "texter",
          body,
          created_at: now(),
        },
      });
      setTimeout(() => {
        dispatch({
          type: "messageReceived",
          message: {
            id: newId("msg"),
            sender: "responder",
            body: REPLIES[replyIndex.current++ % REPLIES.length],
            created_at: now(),
          },
        });
      }, 1_200);
    }, 400);
  }

  return (
    <ChatWindow
      state={state}
      notice={NOTICE}
      onStart={() => {
        dispatch({ type: "started" });
        setTimeout(() => {
          dispatch({ type: "connected" });
          dispatch({
            type: "messageReceived",
            message: {
              id: newId("msg"),
              sender: "system",
              body: "You're connected with a peer responder.",
              created_at: now(),
            },
          });
        }, 800);
      }}
      onSend={(body) => {
        const tempId = newId("temp");
        dispatch({ type: "messageSent", tempId, body, createdAt: now() });
        deliver(tempId, body);
      }}
      onRetry={(tempId) => {
        const failed = state.messages.find((m) => m.id === tempId);
        if (!failed) return;
        dispatch({ type: "messageRetried", tempId });
        // Retries always succeed here so the happy path is reachable.
        deliver(tempId, failed.body, true);
      }}
      onEnd={() => dispatch({ type: "conversationClosed" })}
      onStartOver={() => dispatch({ type: "reset" })}
    />
  );
}
