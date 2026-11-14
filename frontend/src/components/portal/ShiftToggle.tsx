"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

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
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import {
  fetchInbox,
  inboxQueryKey,
  meQueryKey,
  useMe,
} from "@/lib/portal/queries";

const startedFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
});

/** Start or end a shift from the portal top bar (TDD 4.3.2). Signing in alone isn't going on shift. */
export function ShiftToggle() {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [pending, setPending] = useState(false);
  const [activeCount, setActiveCount] = useState<number | null>(null);

  if (!me) return null;
  const shift = me.shift;

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: meQueryKey }),
      queryClient.invalidateQueries({ queryKey: inboxQueryKey }),
    ]);
  }

  async function startShift() {
    setPending(true);
    try {
      await apiFetch("/api/portal/shift/start", { method: "POST" });
      await refresh();
    } catch {
      toast.error("Couldn't start your shift. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function endShift() {
    setActiveCount(null);
    setPending(true);
    try {
      await apiFetch("/api/portal/shift/end", { method: "POST" });
      await refresh();
    } catch {
      toast.error("Couldn't end your shift. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function requestEnd() {
    setPending(true);
    let active = 0;
    try {
      // Ask the server now rather than trusting a cached inbox, so the count is current.
      const items = await queryClient.fetchQuery({
        queryKey: inboxQueryKey,
        queryFn: fetchInbox,
        staleTime: 0,
      });
      active = items.filter((item) => item.status === "active").length;
    } catch {
      // If the inbox can't load, still let them end; the server requeues whatever is open.
    }
    setPending(false);
    if (active > 0) {
      setActiveCount(active);
    } else {
      await endShift();
    }
  }

  if (!shift) {
    return (
      <Button className="min-h-11" onClick={startShift} disabled={pending}>
        Start shift
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground">
        On shift since{" "}
        <time dateTime={shift.started_at}>
          {startedFormatter.format(new Date(shift.started_at))}
        </time>
      </span>
      <Button
        variant="outline"
        className="min-h-11"
        onClick={requestEnd}
        disabled={pending}
      >
        End shift
      </Button>
      <AlertDialog
        open={activeCount !== null}
        onOpenChange={(open) => !open && setActiveCount(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End your shift?</AlertDialogTitle>
            <AlertDialogDescription>
              Your {activeCount}{" "}
              {activeCount === 1
                ? "active conversation"
                : "active conversations"}{" "}
              will go back to the queue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my shift</AlertDialogCancel>
            <AlertDialogAction onClick={endShift}>End shift</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
