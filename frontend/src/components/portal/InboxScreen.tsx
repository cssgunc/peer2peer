"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { useInbox, useMe } from "@/lib/portal/queries";

import { ConversationPanel } from "./ConversationPanel";
import { Inbox } from "./Inbox";

export const INBOX_PATH = "/portal";
// /portal?c=<id> keeps the selection across a refresh.
export const SELECTED_PARAM = "c";

/**
 * Desktop: the inbox and the selected conversation side by side.
 * Mobile: the inbox alone, or the selected conversation with a back button (TDD 4.8).
 */
export function InboxScreen() {
  const router = useRouter();
  const selectedId = useSearchParams().get(SELECTED_PARAM);
  const { data: me } = useMe();
  const onShift = Boolean(me?.shift);
  const { data: items } = useInbox({ enabled: onShift });
  // Off shift the cached inbox is stale; never show a conversation from it.
  const selected = onShift
    ? items?.find((item) => item.conversation_id === selectedId)
    : undefined;

  // Kept after the selection clears, so the responder sees why the conversation went away.
  const [unavailableId, setUnavailableId] = useState<string | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  const currentId = selected?.conversation_id ?? null;
  if (currentId !== shownId) {
    setShownId(currentId);
    // It left the inbox while open (for example, back to the queue when a shift ended).
    if (
      onShift &&
      currentId === null &&
      shownId !== null &&
      selectedId === shownId
    ) {
      setUnavailableId(shownId);
    }
  }
  const unavailable = !selected && unavailableId !== null;

  // Clear the selection from the URL too, so it can't reopen if the conversation comes back.
  useEffect(() => {
    if (unavailableId !== null && selectedId === unavailableId) {
      router.replace(INBOX_PATH);
    }
  }, [router, selectedId, unavailableId]);

  // A report can finish after the responder has opened another conversation.
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  function select(conversationId: string) {
    setUnavailableId(null);
    router.push(
      `${INBOX_PATH}?${SELECTED_PARAM}=${encodeURIComponent(conversationId)}`,
    );
  }

  function clearSelection() {
    setUnavailableId(null);
    router.push(INBOX_PATH);
  }

  function onReportSubmitted(conversationId: string) {
    if (selectedIdRef.current === conversationId) router.replace(INBOX_PATH);
  }

  return (
    <div
      className={cn(
        onShift &&
          "md:grid md:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)] md:gap-6",
      )}
    >
      <div className={cn((selected || unavailable) && "hidden md:block")}>
        <Inbox selectedId={selected ? selectedId : null} onSelect={select} />
      </div>
      {onShift && (
        <section
          aria-label="Selected conversation"
          className={cn(
            "min-w-0 md:border-l md:pl-6",
            !selected && !unavailable && "hidden md:block",
          )}
        >
          {selected ? (
            <ConversationPanel
              item={selected}
              onBack={clearSelection}
              onReportSubmitted={() =>
                onReportSubmitted(selected.conversation_id)
              }
              onUnavailable={() => setUnavailableId(selected.conversation_id)}
            />
          ) : unavailable ? (
            <div className="space-y-3 md:pt-12">
              <p role="status">This conversation is no longer available</p>
              <Button
                variant="ghost"
                onClick={() => setUnavailableId(null)}
                className="-ml-3 min-h-11"
              >
                Back to inbox
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground md:pt-12">
              Select a conversation from the inbox.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
