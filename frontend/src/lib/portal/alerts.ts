"use client";

import { useCallback, useSyncExternalStore } from "react";

import { playAlertSound } from "./alertSound";
import { usePortalEvents } from "./PortalSocketProvider";

export const ALERTS_STORAGE_KEY = "p2p-portal-alerts";
// The whole notification. No label and no message text: it can show on a lock screen or a
// shared monitor, and labels must never let anyone link two conversations together.
export const NEW_CONVERSATION_NOTIFICATION = "New conversation";
const NOTIFICATION_TAG = "p2p-new-conversation";
// Same-tab updates; the "storage" event only fires in other tabs.
const CHANGE_EVENT = "p2p-portal-alerts-change";

function readEnabled() {
  try {
    return window.localStorage.getItem(ALERTS_STORAGE_KEY) === "on";
  } catch {
    // Storage can be blocked (private mode, strict settings); alerts just stay off.
    return false;
  }
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === ALERTS_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** Off until the responder turns alerts on; the choice is kept in localStorage. */
export function useAlertsEnabled() {
  const enabled = useSyncExternalStore(subscribe, readEnabled, () => false);
  const setEnabled = useCallback((on: boolean) => {
    try {
      window.localStorage.setItem(ALERTS_STORAGE_KEY, on ? "on" : "off");
    } catch {
      return;
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [enabled, setEnabled] as const;
}

/** Takes no arguments on purpose, so a caller can't pass a label or message into it. */
export function showNewConversationNotification() {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    const notification = new Notification(NEW_CONVERSATION_NOTIFICATION, {
      tag: NOTIFICATION_TAG,
      // The chime already plays.
      silent: true,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Some mobile browsers only allow notifications from a service worker.
  }
}

/** Chime and notify on conversation.created while alerts are on. */
export function useNewConversationAlerts() {
  const [enabled] = useAlertsEnabled();
  usePortalEvents((event) => {
    if (!enabled || event.type !== "conversation.created") return;
    playAlertSound();
    showNewConversationNotification();
  });
}
