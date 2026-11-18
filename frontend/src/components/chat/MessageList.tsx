"use client";

import { useEffect, useRef } from "react";
import { cn } from "cn";

import type { ChatMessage } from "./chatReducer";

type Sender = ChatMessage["sender"];

const SENDER_LABELS: Record<Sender, string> = {
  texter: "You",
  responder: "Peer responder",
  system: "Peer2Peer",
};

const timeFormat = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
  timeZoneName: "short",
});

export default function MessageList({
  messages,
  onRetry,
  self = "texter",
  labels,
}: {
  messages: ChatMessage[];
  onRetry: (tempId: string) => void;
  /** Whose messages are "me": shown on the right in the primary color. */
  self?: Exclude<Sender, "system">;
  /** Overrides for the sender names shown above each message. */
  labels?: Partial<Record<Sender, string>>;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <ol
        aria-live="polite"
        aria-label="Conversation"
        className="flex flex-col gap-3"
      >
        {messages.map((m) => (
          <li
            key={m.id}
            className={cn(
              "flex max-w-[85%] flex-col gap-1",
              m.sender === self && "items-end self-end",
              m.sender !== self &&
                m.sender !== "system" &&
                "items-start self-start",
              m.sender === "system" && "max-w-full items-center self-center",
            )}
          >
            <span className="text-xs text-muted-foreground">
              {labels?.[m.sender] ?? SENDER_LABELS[m.sender]}
              <span aria-hidden="true"> · </span>
              <time dateTime={m.created_at}>
                {timeFormat.format(new Date(m.created_at))}
              </time>
            </span>
            {/* Plain text only: bodies are never rendered as Markdown or HTML. */}
            <p
              className={cn(
                "rounded-lg px-3 py-2 break-words whitespace-pre-wrap",
                m.sender === self && "bg-primary text-primary-foreground",
                m.sender !== self &&
                  m.sender !== "system" &&
                  "bg-secondary text-foreground",
                m.sender === "system" &&
                  "bg-muted text-center text-sm text-muted-foreground",
                m.status === "pending" && "opacity-70",
              )}
            >
              {m.body}
            </p>
            {m.status === "failed" && (
              <button
                type="button"
                className="text-xs text-destructive underline"
                onClick={() => onRetry(m.id)}
              >
                Not sent. Tap to retry.
              </button>
            )}
          </li>
        ))}
      </ol>
      <div ref={endRef} />
    </div>
  );
}
