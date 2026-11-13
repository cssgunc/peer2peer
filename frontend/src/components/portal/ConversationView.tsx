"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import EndConversationDialog from "@/components/chat/EndConversationDialog";
import Composer from "@/components/chat/Composer";
import MessageList from "@/components/chat/MessageList";
import type { ChatMessage } from "@/components/chat/chatReducer";
import { ApiError, apiFetch } from "@/lib/api";
import {
  conversationQueryKey,
  inboxQueryKey,
  type PortalConversation,
  type PortalMessage,
  useConversation,
} from "@/lib/portal/queries";

import { GuidePanel } from "./GuidePanel";

const openedFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/New_York",
});

const STATUS_LABELS: Record<PortalConversation["status"], string> = {
  queued: "Waiting",
  active: "Active",
  closed: "Ended",
};

function toChatMessage(m: PortalMessage): ChatMessage {
  return {
    id: m.id,
    sender: m.sender,
    body: m.body,
    created_at: m.created_at,
  };
}

/** Keyed by id so switching conversations resets the outbox and read baseline. */
export function ConversationView(props: ConversationViewProps) {
  return <ConversationViewInner key={props.id} {...props} />;
}

type ConversationViewProps = {
  id: string;
  /** Called when the conversation can't be loaded (404), so the inbox can clear its selection. */
  onUnavailable?: () => void;
  /** Room in the header for the escalate button. */
  headerActions?: ReactNode;
  /** Where the post-conversation report form goes once the conversation has ended. */
  reportSlot?: ReactNode;
};

function ConversationViewInner({
  id,
  onUnavailable,
  headerActions,
  reportSlot,
}: ConversationViewProps) {
  const queryClient = useQueryClient();
  const { data, error } = useConversation(id);
  // Responder messages the server hasn't confirmed yet, or that failed.
  const [outbox, setOutbox] = useState<ChatMessage[]>([]);
  const [endError, setEndError] = useState(false);
  const tempCounter = useRef(0);

  const markRead = useCallback(() => {
    // Best effort: a missed read receipt only leaves an unread badge behind.
    apiFetch(`/api/portal/conversations/${id}/read`, { method: "POST" })
      .then(() => queryClient.invalidateQueries({ queryKey: inboxQueryKey }))
      .catch(() => {});
  }, [id, queryClient]);

  const unavailable = error instanceof ApiError && error.status === 404;

  useEffect(() => {
    if (unavailable) onUnavailable?.();
  }, [unavailable, onUnavailable]);

  // Opening marks the conversation read.
  useEffect(() => {
    markRead();
  }, [markRead]);

  // A texter message arriving while the tab is visible is read as it lands.
  const lastTexterId = useRef<string | null | undefined>(undefined);
  const latestTexterId = data?.messages.findLast(
    (m) => m.sender === "texter",
  )?.id;
  useEffect(() => {
    if (!data) return;
    const previous = lastTexterId.current;
    lastTexterId.current = latestTexterId ?? null;
    if (previous === undefined || previous === (latestTexterId ?? null)) return;
    if (document.visibilityState === "visible") markRead();
  }, [data, latestTexterId, markRead]);

  if (unavailable) {
    return (
      <p role="alert" className="p-4 text-muted-foreground">
        This conversation is no longer available
      </p>
    );
  }
  if (error) {
    return (
      <p role="alert" className="p-4 text-destructive">
        Couldn&apos;t load this conversation.
      </p>
    );
  }
  if (!data) {
    return <p className="p-4 text-muted-foreground">Loading…</p>;
  }

  const closed = data.status === "closed";

  async function deliver(tempId: string, body: string) {
    try {
      const saved = await apiFetch<PortalMessage>(
        `/api/portal/conversations/${id}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        },
      );
      // The socket may have delivered it already; don't add it twice.
      queryClient.setQueryData<PortalConversation>(
        conversationQueryKey(id),
        (old) =>
          old && !old.messages.some((m) => m.id === saved.id)
            ? { ...old, messages: [...old.messages, saved] }
            : old,
      );
      setOutbox((current) => current.filter((m) => m.id !== tempId));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        queryClient.invalidateQueries({ queryKey: conversationQueryKey(id) });
        return;
      }
      if (e instanceof ApiError && e.code === "conversation_closed") {
        setOutbox((current) => current.filter((m) => m.id !== tempId));
        queryClient.invalidateQueries({ queryKey: conversationQueryKey(id) });
        return;
      }
      setOutbox((current) =>
        current.map((m) => (m.id === tempId ? { ...m, status: "failed" } : m)),
      );
    }
  }

  function send(body: string) {
    const tempId = `pending-${tempCounter.current++}`;
    setOutbox((current) => [
      ...current,
      {
        id: tempId,
        sender: "responder",
        body,
        created_at: new Date().toISOString(),
        status: "pending",
      },
    ]);
    void deliver(tempId, body);
  }

  function retry(tempId: string) {
    const failed = outbox.find((m) => m.id === tempId);
    if (!failed) return;
    setOutbox((current) =>
      current.map((m) => (m.id === tempId ? { ...m, status: "pending" } : m)),
    );
    void deliver(tempId, failed.body);
  }

  async function end() {
    setEndError(false);
    try {
      await apiFetch(`/api/portal/conversations/${id}/end`, {
        method: "POST",
      });
      await queryClient.invalidateQueries({
        queryKey: conversationQueryKey(id),
      });
    } catch {
      setEndError(true);
    }
  }

  const messages = [...data.messages.map(toChatMessage), ...outbox];

  return (
    <section aria-label={data.label} className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3">
        <div className="flex flex-col">
          <h2 className="text-lg font-semibold">{data.label}</h2>
          <p className="text-sm text-muted-foreground">
            {STATUS_LABELS[data.status]}
            <span aria-hidden="true"> · </span>
            Opened{" "}
            <time dateTime={data.opened_at}>
              {openedFormat.format(new Date(data.opened_at))}
            </time>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <GuidePanel />
          {headerActions}
          {!closed && (
            <EndConversationDialog
              onConfirm={end}
              description="This ends the conversation for the texter and for you. You can't send more messages afterward."
            />
          )}
        </div>
      </header>
      {endError && (
        <p role="alert" className="px-3 pt-2 text-sm text-destructive">
          Couldn&apos;t end the conversation. Try again.
        </p>
      )}
      <MessageList
        messages={messages}
        onRetry={retry}
        self="responder"
        labels={{ texter: data.label, responder: "You" }}
      />
      {closed ? (
        <div className="flex flex-col gap-3 border-t border-border p-3">
          <p className="font-medium">This conversation has ended</p>
          {reportSlot}
        </div>
      ) : (
        <Composer onSend={send} />
      )}
    </section>
  );
}
