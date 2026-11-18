"use client";

import { Skeleton } from "@/components/ui/skeleton";

import ChatWindow from "./ChatWindow";
import { useChat } from "./useChat";

/** The live chat on the Text Us page, backed by the chat API (TDD 4.3.1). */
export default function TextUsChat({ notice }: { notice: string }) {
  const { state, ready, start, send, retry, end, startOver } = useChat();

  if (!ready) {
    return (
      <Skeleton role="status" aria-label="Loading the chat" className="h-96" />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <ChatWindow
        state={state}
        notice={notice}
        onStart={() => void start()}
        onSend={send}
        onRetry={retry}
        onEnd={() => void end()}
        onStartOver={startOver}
      />
    </div>
  );
}
