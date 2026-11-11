"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiFetch } from "@/lib/api";
import {
  IDLE_TIMEOUT_MS,
  IDLE_WARNING_MINUTES,
  IDLE_WARNING_MS,
} from "@/lib/portal/constants";
import { type Me, meQueryKey } from "@/lib/portal/queries";

// Only the person counts as activity; WebSocket heartbeats never reach these listeners.
const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "wheel",
] as const;
// Record activity at most this often, so mouse movement doesn't run code on every frame.
export const ACTIVITY_THROTTLE_MS = 5_000;
// While the person is active, refresh the server session this often. Activity here never
// reaches the backend on its own, and its idle timer would otherwise sign out someone who is
// reading or typing without making requests.
export const KEEPALIVE_MS = 5 * 60_000;
const CHECK_MS = 1_000;
export const ACTIVITY_CHANNEL = "p2p-portal-activity";
export const IDLE_SIGN_IN_URL = "/portal/sign-in?reason=idle";

type ActivityMessage = { type: "activity"; at: number };

function formatCountdown(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Warns 2 minutes before the 30-minute idle sign-out, then signs out (TDD 4.6.1). */
export function IdleWarning() {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Set to the real clock when the effect starts (reading the clock during render isn't allowed).
  const lastActivity = useRef(0);
  const lastKeepalive = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const signedOut = useRef(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const warning = remaining !== null;
  const warningRef = useRef(false);
  useEffect(() => {
    warningRef.current = warning;
  }, [warning]);

  const markActive = useCallback((at: number, broadcast: boolean) => {
    if (at <= lastActivity.current) return;
    lastActivity.current = at;
    setRemaining(null);
    if (broadcast) {
      channel.current?.postMessage({
        type: "activity",
        at,
      } satisfies ActivityMessage);
    }
  }, []);

  const signOut = useCallback(async () => {
    if (signedOut.current) return;
    signedOut.current = true;
    try {
      await apiFetch("/api/auth/sign-out", { method: "POST" });
    } catch {
      // The backend ends idle sessions itself; leave anyway.
    } finally {
      // Clear so the next person on a shared computer never sees this account's data.
      queryClient.clear();
      router.replace(IDLE_SIGN_IN_URL);
    }
  }, [queryClient, router]);

  // The timer effect runs once; it reaches the latest signOut through this ref, so a new
  // router or query client never restarts the clock or reopens the channel.
  const signOutRef = useRef(signOut);
  useEffect(() => {
    signOutRef.current = signOut;
  }, [signOut]);

  async function staySignedIn() {
    markActive(Date.now(), true);
    lastKeepalive.current = Date.now();
    try {
      // /me refreshes the session's last-seen time on the backend.
      const me = await apiFetch<Me>("/api/auth/me");
      queryClient.setQueryData(meQueryKey, me);
    } catch {
      // The session is already gone (e.g. it expired on the server first).
      void signOut();
    }
  }

  useEffect(() => {
    lastActivity.current = Date.now();
    lastKeepalive.current = Date.now();
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel(ACTIVITY_CHANNEL);
      channel.current.onmessage = (event: MessageEvent<ActivityMessage>) => {
        // Activity in another tab means the person is here; keep this tab signed in too.
        if (event.data?.type === "activity") markActive(event.data.at, false);
      };
    }

    let lastRecorded = 0;
    function onActivity() {
      // Once the warning is up, only "Stay signed in" (or another tab) dismisses it, so a
      // stray mouse movement doesn't hide it before it's read.
      if (warningRef.current) return;
      const now = Date.now();
      if (now - lastRecorded < ACTIVITY_THROTTLE_MS) return;
      lastRecorded = now;
      markActive(now, true);
      if (now - lastKeepalive.current >= KEEPALIVE_MS) {
        lastKeepalive.current = now;
        void apiFetch("/api/auth/me").catch(() => {});
      }
    }

    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, onActivity, {
        passive: true,
        capture: true,
      });
    }

    // Checking against the clock (not counting ticks) also catches a laptop waking from sleep.
    const interval = window.setInterval(() => {
      const idle = Date.now() - lastActivity.current;
      if (idle >= IDLE_TIMEOUT_MS) {
        void signOutRef.current();
      } else if (idle >= IDLE_TIMEOUT_MS - IDLE_WARNING_MS) {
        setRemaining(IDLE_TIMEOUT_MS - idle);
      }
    }, CHECK_MS);

    return () => {
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, onActivity, { capture: true });
      }
      window.clearInterval(interval);
      channel.current?.close();
      channel.current = null;
    };
  }, [markActive]);

  return (
    <AlertDialog
      open={warning}
      // The button and Escape both close the dialog through here, so /me is called once.
      onOpenChange={(open) => {
        if (!open) void staySignedIn();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            You&apos;ll be signed out in {IDLE_WARNING_MINUTES} minutes
          </AlertDialogTitle>
          <AlertDialogDescription>
            You haven&apos;t been active for a while. To protect conversations
            on this computer, you&apos;ll be signed out in{" "}
            {/* No aria-live: the title already gives the time, and a per-second update would
                keep interrupting a screen reader. */}
            <span className="font-semibold tabular-nums">
              {remaining !== null ? formatCountdown(remaining) : ""}
            </span>
            .
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction>Stay signed in</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
