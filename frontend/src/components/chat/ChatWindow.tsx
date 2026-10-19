"use client";

import { Button } from "@/components/ui/button";

import type { ChatPhase, ChatState } from "./chatReducer";
import Composer from "./Composer";
import EndConversationDialog from "./EndConversationDialog";
import MessageList from "./MessageList";
import PreChatNotice from "./PreChatNotice";

export type ChatWindowProps = {
  state: ChatState;
  /** The `chat.notice` Markdown shown before the first message. */
  notice: string;
  onStart: () => void;
  onSend: (body: string) => void;
  onRetry: (tempId: string) => void;
  onEnd: () => void;
  onStartOver: () => void;
};

const PLACEHOLDERS: Partial<Record<ChatPhase, string>> = {
  connecting: "Waiting for a peer responder…",
  ended: "This conversation has ended",
};

export default function ChatWindow({
  state,
  notice,
  onStart,
  onSend,
  onRetry,
  onEnd,
  onStartOver,
}: ChatWindowProps) {
  const { phase, messages, error } = state;

  return (
    <section
      aria-label="Chat with a peer responder"
      className="flex h-dvh flex-col bg-background"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border p-3">
        <h2 className="font-semibold">Peer2Peer chat</h2>
        {(phase === "connecting" || phase === "active") && (
          <EndConversationDialog onConfirm={onEnd} />
        )}
      </header>

      {phase === "notice" ? (
        <PreChatNotice notice={notice} onStart={onStart} />
      ) : (
        <>
          {phase === "connecting" && (
            <p role="status" className="p-3 text-center text-sm">
              Connecting you with a peer responder…
            </p>
          )}
          <MessageList messages={messages} onRetry={onRetry} />
          {error && (
            <p role="alert" className="px-3 pt-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {phase === "ended" && <EndedNotice onStartOver={onStartOver} />}
          <Composer
            onSend={onSend}
            disabled={phase !== "active"}
            placeholder={PLACEHOLDERS[phase]}
          />
        </>
      )}
    </section>
  );
}

function EndedNotice({ onStartOver }: { onStartOver: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 border-t border-border bg-muted p-4 text-center">
      <p className="font-medium">This conversation has ended.</p>
      <p className="text-sm">
        If you are in danger, call <a href="tel:911">911</a>. For a crisis,
        reach the Suicide &amp; Crisis Lifeline: <a href="tel:988">Call 988</a>{" "}
        or <a href="sms:988">Text 988</a>.
      </p>
      <Button onClick={onStartOver}>Start a new conversation</Button>
    </div>
  );
}
