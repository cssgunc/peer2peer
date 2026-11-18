"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { ApiError } from "@/lib/api";
import { useNewConversationAlerts } from "@/lib/portal/alerts";
import {
  type InboxItem,
  meQueryKey,
  useInbox,
  useMe,
} from "@/lib/portal/queries";

import { AlertsToggle } from "./AlertsToggle";

const lastMessageFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

type InboxProps = {
  selectedId: string | null;
  onSelect: (conversationId: string) => void;
};

/** The responder's conversations (TDD 4.3.2). The portal socket keeps the list fresh. */
export function Inbox({ selectedId, onSelect }: InboxProps) {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const onShift = Boolean(me?.shift);
  const {
    data: items,
    error,
    isError,
    refetch,
  } = useInbox({
    enabled: onShift,
  });
  useNewConversationAlerts();

  useEffect(() => {
    // The shift ended somewhere else (another tab, a job); refresh it so the off-shift state shows.
    if (error instanceof ApiError && error.status === 403) {
      void queryClient.invalidateQueries({ queryKey: meQueryKey });
    }
  }, [error, queryClient]);

  return (
    <section aria-labelledby="inbox-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1
          id="inbox-heading"
          className="text-2xl font-semibold tracking-tight"
        >
          Inbox
        </h1>
        <AlertsToggle />
      </div>
      {!me ? (
        <p role="status">Loading inbox…</p>
      ) : !onShift ? (
        <div className="space-y-1 rounded-lg border border-dashed p-4">
          <p className="font-medium">You&apos;re off shift.</p>
          <p className="text-sm text-muted-foreground">
            Select <strong>Start shift</strong> at the top of the page to see
            your conversations.
          </p>
        </div>
      ) : (
        <>
          {isError && (
            <div className="space-y-3">
              <p role="alert">
                The inbox could not be loaded. Please try again.
              </p>
              <Button variant="outline" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          )}
          {!items ? (
            !isError && <p role="status">Loading inbox…</p>
          ) : items.length === 0 ? (
            <p role="status" className="text-muted-foreground">
              No conversations yet. New ones will show up here.
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <li key={item.conversation_id}>
                  <InboxRow
                    item={item}
                    selected={item.conversation_id === selectedId}
                    onSelect={onSelect}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function InboxRow({
  item,
  selected,
  onSelect,
}: {
  item: InboxItem;
  selected: boolean;
  onSelect: (conversationId: string) => void;
}) {
  const lastMessage = item.last_message_at
    ? lastMessageFormat.format(new Date(item.last_message_at))
    : null;
  const name = [
    item.label,
    item.unread_count > 0 && `${item.unread_count} unread`,
    item.needs_report && "Report needed",
    lastMessage ? `last message ${lastMessage}` : "no messages yet",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      type="button"
      aria-label={name}
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(item.conversation_id)}
      className={cn(
        "flex min-h-11 w-full flex-col gap-1.5 rounded-lg border px-3 py-3 text-left transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        selected && "border-primary bg-muted",
      )}
    >
      <span className="flex w-full items-baseline justify-between gap-2">
        <span
          className={cn(
            "truncate",
            item.unread_count > 0 ? "font-semibold" : "font-medium",
          )}
        >
          {item.label}
        </span>
        {item.last_message_at ? (
          <time
            dateTime={item.last_message_at}
            className="shrink-0 text-xs text-muted-foreground"
          >
            {lastMessage}
          </time>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">
            No messages yet
          </span>
        )}
      </span>
      {(item.unread_count > 0 || item.needs_report) && (
        <span className="flex flex-wrap gap-1.5">
          {item.unread_count > 0 && <Badge>{item.unread_count} unread</Badge>}
          {item.needs_report && (
            <Badge variant="destructive">Report needed</Badge>
          )}
        </span>
      )}
    </button>
  );
}
