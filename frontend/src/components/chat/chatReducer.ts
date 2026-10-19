// Chat window state (TDD 4.6.2). Pure and network-free: the caller decides
// where messages come from and passes ids and timestamps in on each action.

/** Matches `ChatMessageDTO` (TDD 4.7.3). There is never a responder name. */
export type ChatMessageDTO = {
  id: string;
  sender: "texter" | "responder" | "system";
  body: string;
  created_at: string;
};

/** UI-only status for a texter message the server hasn't confirmed yet. */
export type ChatMessage = ChatMessageDTO & { status?: "pending" | "failed" };

export type ChatPhase = "notice" | "connecting" | "active" | "ended";

/** Matches the backend's `ClosedBy`. */
export type ClosedBy = "texter" | "responder" | "inactivity" | "system";

export type ChatState = {
  phase: ChatPhase;
  messages: ChatMessage[];
  error: string | null;
};

export type ChatAction =
  | { type: "started" }
  | { type: "connected" }
  | { type: "messageReceived"; message: ChatMessageDTO }
  | { type: "messageSent"; tempId: string; body: string; createdAt: string }
  | { type: "messageConfirmed"; tempId: string; message: ChatMessageDTO }
  | { type: "messageFailed"; tempId: string }
  | { type: "messageRetried"; tempId: string }
  | { type: "conversationClosed"; by: ClosedBy }
  | { type: "reset" };

export const MAX_MESSAGE_LENGTH = 2_000;

export const initialChatState: ChatState = {
  phase: "notice",
  messages: [],
  error: null,
};

function setStatus(
  messages: ChatMessage[],
  tempId: string,
  status: ChatMessage["status"],
): ChatMessage[] {
  return messages.map((m) => (m.id === tempId ? { ...m, status } : m));
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "started":
      if (state.phase !== "notice") return state;
      return { ...state, phase: "connecting", error: null };
    case "connected":
      if (state.phase !== "connecting") return state;
      return { ...state, phase: "active" };
    case "messageReceived":
      if (state.messages.some((m) => m.id === action.message.id)) return state;
      return { ...state, messages: [...state.messages, action.message] };
    case "messageSent":
      return {
        ...state,
        error: null,
        messages: [
          ...state.messages,
          {
            id: action.tempId,
            sender: "texter",
            body: action.body,
            created_at: action.createdAt,
            status: "pending",
          },
        ],
      };
    case "messageConfirmed": {
      // The real message may already have arrived over the socket; if so,
      // drop the temporary copy instead of showing it twice.
      const exists = state.messages.some((m) => m.id === action.message.id);
      return {
        ...state,
        messages: exists
          ? state.messages.filter((m) => m.id !== action.tempId)
          : state.messages.map((m) =>
              m.id === action.tempId ? action.message : m,
            ),
      };
    }
    case "messageFailed":
      return {
        ...state,
        error: "A message didn't send.",
        messages: setStatus(state.messages, action.tempId, "failed"),
      };
    case "messageRetried": {
      const messages = setStatus(state.messages, action.tempId, "pending");
      return {
        ...state,
        messages,
        error: messages.some((m) => m.status === "failed") ? state.error : null,
      };
    }
    case "conversationClosed":
      // When the student ends it, clear the transcript so it isn't left on a
      // shared device (TDD 4.6.2). Otherwise keep it until they start over.
      return {
        ...state,
        phase: "ended",
        error: null,
        messages: action.by === "texter" ? [] : state.messages,
      };
    case "reset":
      return initialChatState;
  }
}
