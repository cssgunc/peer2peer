"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ApiError, apiFetch } from "@/lib/api";
import { formatDateOnly } from "@/lib/dates";
import {
  type Feedback,
  type FeedbackFilter,
  feedbackQueryKey,
  useAdminSetting,
  useFeedback,
} from "@/lib/portal/queries";

const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30";

const emptyMessages: Record<FeedbackFilter, string> = {
  all: "No feedback yet.",
  unread: "No unread feedback.",
  read: "No read feedback.",
};

function errorMessage(error: unknown) {
  return error instanceof ApiError
    ? error.detail
    : "Something went wrong. Please try again.";
}

function sendJson<T>(path: string, method: string, body?: unknown) {
  return apiFetch<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Runs one request with pending/error state, as in AccountsManager.
function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(request: () => Promise<T>): Promise<T | undefined> {
    setPending(true);
    setError(null);
    try {
      return await request();
    } catch (caught) {
      setError(errorMessage(caught));
      return undefined;
    } finally {
      setPending(false);
    }
  }

  return { pending, error, run };
}

export function FeedbackInbox() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FeedbackFilter>("all");
  const [deleting, setDeleting] = useState<Feedback | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const feedback = useFeedback(filter);
  const { data: retentionDays } = useAdminSetting<number>(
    "feedback_retention_days",
  );

  // Refreshes every filter's list and the nav's unread count, which share this prefix.
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: feedbackQueryKey });

  async function setRead(item: Feedback, read: boolean) {
    setRowError(null);
    try {
      await sendJson(`/api/admin/feedback/${item.id}`, "PATCH", { read });
      await refresh();
    } catch (error) {
      setRowError(errorMessage(error));
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Anonymous feedback from the Contact page.{" "}
        {retentionDays
          ? `It's deleted automatically ${retentionDays} days after it's submitted.`
          : "It's deleted automatically after the retention period."}
      </p>

      <div className="space-y-1">
        <Label htmlFor="feedback-filter">Show</Label>
        <select
          id="feedback-filter"
          className={selectClass}
          value={filter}
          onChange={(e) => setFilter(e.target.value as FeedbackFilter)}
        >
          <option value="all">All</option>
          <option value="unread">Unread</option>
          <option value="read">Read</option>
        </select>
      </div>

      {rowError && <p role="alert">{rowError}</p>}

      {feedback.isPending ? (
        <p role="status">Loading feedback…</p>
      ) : feedback.isError ? (
        <div className="space-y-3">
          <p role="alert">Feedback could not be loaded.</p>
          <Button variant="outline" onClick={() => feedback.refetch()}>
            Try again
          </Button>
        </div>
      ) : feedback.data.length === 0 ? (
        <p>{emptyMessages[filter]}</p>
      ) : (
        <ul className="space-y-3">
          {feedback.data.map((item) => {
            const date = formatDateOnly(item.created_on);
            return (
              <li
                key={item.id}
                data-testid="feedback-item"
                className="space-y-3 rounded-lg border p-4"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>{date}</span>
                  {!item.read && <Badge>Unread</Badge>}
                </div>
                {/* Plain text only: anyone can submit this, so it's never parsed as Markdown or HTML. */}
                <p className="break-words whitespace-pre-wrap">{item.body}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`${item.read ? "Mark unread" : "Mark read"}: feedback from ${date}`}
                    onClick={() => void setRead(item, !item.read)}
                  >
                    {item.read ? "Mark unread" : "Mark read"}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    aria-label={`Delete feedback from ${date}`}
                    onClick={() => setDeleting(item)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {deleting && (
        <DeleteDialog
          item={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => {
            setDeleting(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function DeleteDialog({
  item,
  onClose,
  onDone,
}: {
  item: Feedback;
  onClose: () => void;
  onDone: () => void;
}) {
  const { pending, error, run } = useAction();

  async function confirm() {
    const done = await run(() =>
      sendJson(`/api/admin/feedback/${item.id}`, "DELETE").then(() => true),
    );
    if (done) onDone();
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this feedback?</AlertDialogTitle>
          <AlertDialogDescription>
            Feedback from {formatDateOnly(item.created_on)} will be permanently
            deleted. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p role="alert">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(event) => {
              // Keep the dialog open so an error from the backend can be shown.
              event.preventDefault();
              void confirm();
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
