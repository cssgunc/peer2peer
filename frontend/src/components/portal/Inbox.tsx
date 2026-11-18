"use client";

import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { useInbox } from "@/lib/portal/queries";

import { ConversationView } from "./ConversationView";
import { EscalateButton } from "./EscalateButton";
import { ReportForm } from "./ReportForm";

export function Inbox() {
  const { data: items, isPending, isError, refetch } = useInbox();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Shown after the selected conversation 404s or leaves the inbox (for example, it went back to the queue when a shift ended).
  const [unavailable, setUnavailable] = useState(false);
  const clearSelection = useCallback(() => setSelectedId(null), []);
  const markUnavailable = useCallback(() => {
    setSelectedId(null);
    setUnavailable(true);
  }, []);
  const selected = items?.find((item) => item.conversation_id === selectedId);

  // The inbox can drop the conversation before its view sees the 404.
  if (selectedId !== null && items && !selected) markUnavailable();

  function select(id: string) {
    setSelectedId(id);
    setUnavailable(false);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
      {isError && (
        <div className="space-y-3">
          <p role="alert">The inbox could not be loaded. Please try again.</p>
          <Button variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      )}
      {isPending ? (
        <p role="status">Loading inbox…</p>
      ) : items ? (
        <div className="grid gap-6 md:grid-cols-[minmax(12rem,18rem)_1fr]">
          <section aria-label="Conversations">
            {items.length === 0 ? (
              <p role="status" className="text-muted-foreground">
                Your inbox is empty.
              </p>
            ) : (
              <ul className="space-y-2">
                {items.map((item) => (
                  <li key={item.conversation_id}>
                    <Button
                      variant={
                        selectedId === item.conversation_id
                          ? "secondary"
                          : "outline"
                      }
                      aria-pressed={selectedId === item.conversation_id}
                      aria-label={`${item.label}, ${item.needs_report ? "Report needed" : item.status}`}
                      onClick={() => select(item.conversation_id)}
                      className="h-auto min-h-11 w-full flex-col items-start gap-1 px-3 py-3 text-left whitespace-normal"
                    >
                      <span>{item.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {item.needs_report ? "Report needed" : item.status}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section
            aria-label="Selected conversation"
            className="min-w-0 space-y-4"
          >
            {selected ? (
              selected.status === "closed" || selected.needs_report ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-xl font-semibold">{selected.label}</h2>
                    <Button variant="ghost" onClick={clearSelection}>
                      Back to inbox
                    </Button>
                  </div>
                  <p>This conversation has ended.</p>
                  <ReportForm
                    conversationId={selected.conversation_id}
                    onSubmitted={() =>
                      setSelectedId((current) =>
                        current === selected.conversation_id ? null : current,
                      )
                    }
                  />
                </>
              ) : (
                <>
                  <Button variant="ghost" onClick={clearSelection}>
                    Back to inbox
                  </Button>
                  <div className="h-[70vh] min-h-96 rounded-lg border border-border">
                    <ConversationView
                      id={selected.conversation_id}
                      onUnavailable={markUnavailable}
                      headerActions={
                        <EscalateButton
                          conversationId={selected.conversation_id}
                          status={selected.status}
                        />
                      }
                      reportSlot={
                        <ReportForm
                          conversationId={selected.conversation_id}
                          onSubmitted={clearSelection}
                        />
                      }
                    />
                  </div>
                </>
              )
            ) : unavailable ? (
              <div className="space-y-3">
                <p role="status">This conversation is no longer available</p>
                <Button variant="ghost" onClick={() => setUnavailable(false)}>
                  Back to inbox
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground">
                Select a conversation from the inbox.
              </p>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
