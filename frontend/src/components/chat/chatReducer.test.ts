import { describe, expect, it } from "vitest";

import {
  chatReducer,
  initialChatState,
  type ChatMessageDTO,
  type ChatState,
} from "./chatReducer";

const at = "2026-10-19T16:00:00Z";

const responder: ChatMessageDTO = {
  id: "m1",
  sender: "responder",
  body: "Hi there",
  created_at: at,
};

const active: ChatState = { ...initialChatState, phase: "active" };

function sent(state: ChatState = active) {
  return chatReducer(state, {
    type: "messageSent",
    tempId: "temp-1",
    body: "hello",
    createdAt: at,
  });
}

describe("chatReducer", () => {
  it("starts in the notice phase", () => {
    expect(initialChatState).toEqual({
      phase: "notice",
      messages: [],
      error: null,
    });
  });

  it("moves from notice to connecting to active", () => {
    const connecting = chatReducer(initialChatState, { type: "started" });
    expect(connecting.phase).toBe("connecting");
    expect(chatReducer(connecting, { type: "connected" }).phase).toBe("active");
  });

  it("ignores started and connected outside their phase", () => {
    expect(chatReducer(active, { type: "started" })).toBe(active);
    expect(chatReducer(initialChatState, { type: "connected" })).toBe(
      initialChatState,
    );
  });

  it("appends a received message", () => {
    const state = chatReducer(active, {
      type: "messageReceived",
      message: responder,
    });
    expect(state.messages).toEqual([responder]);
  });

  it("ignores a received message with a duplicate id", () => {
    const once = chatReducer(active, {
      type: "messageReceived",
      message: responder,
    });
    const twice = chatReducer(once, {
      type: "messageReceived",
      message: { ...responder, body: "changed" },
    });
    expect(twice).toBe(once);
    expect(twice.messages).toHaveLength(1);
  });

  it("shows a sent message right away as pending", () => {
    expect(sent().messages).toEqual([
      {
        id: "temp-1",
        sender: "texter",
        body: "hello",
        created_at: at,
        status: "pending",
      },
    ]);
  });

  it("swaps the temporary id for the confirmed message", () => {
    const real: ChatMessageDTO = {
      id: "m2",
      sender: "texter",
      body: "hello",
      created_at: "2026-10-19T16:00:01Z",
    };
    const state = chatReducer(sent(), {
      type: "messageConfirmed",
      tempId: "temp-1",
      message: real,
    });
    expect(state.messages).toEqual([real]);
  });

  it("drops the temporary copy if the real message already arrived", () => {
    const real: ChatMessageDTO = {
      id: "m2",
      sender: "texter",
      body: "hello",
      created_at: at,
    };
    const received = chatReducer(sent(), {
      type: "messageReceived",
      message: real,
    });
    const state = chatReducer(received, {
      type: "messageConfirmed",
      tempId: "temp-1",
      message: real,
    });
    expect(state.messages).toEqual([real]);
  });

  it("marks a failed send and sets the error", () => {
    const state = chatReducer(sent(), {
      type: "messageFailed",
      tempId: "temp-1",
    });
    expect(state.messages[0].status).toBe("failed");
    expect(state.error).toBe("Not sent. Tap to retry.");
  });

  it("puts a retried message back to pending", () => {
    const failed = chatReducer(sent(), {
      type: "messageFailed",
      tempId: "temp-1",
    });
    const state = chatReducer(failed, {
      type: "messageRetried",
      tempId: "temp-1",
    });
    expect(state.messages[0].status).toBe("pending");
    expect(state.error).toBeNull();
  });

  it("ends the conversation and keeps the messages", () => {
    const withMessage = chatReducer(active, {
      type: "messageReceived",
      message: responder,
    });
    const state = chatReducer(withMessage, { type: "conversationClosed" });
    expect(state.phase).toBe("ended");
    expect(state.messages).toEqual([responder]);
  });

  it("resets to the initial state", () => {
    const ended = chatReducer(sent(), { type: "conversationClosed" });
    expect(chatReducer(ended, { type: "reset" })).toEqual(initialChatState);
  });
});
