"use client";

import { useState } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { primeAlertSound } from "@/lib/portal/alertSound";
import { useAlertsEnabled } from "@/lib/portal/alerts";

type Permission = NotificationPermission | "unsupported";

/** Turns the new-conversation sound and browser notification on or off (inbox header). */
export function AlertsToggle() {
  const [enabled, setEnabled] = useAlertsEnabled();
  // Only known after turning alerts on here; reading Notification during render breaks SSR.
  const [permission, setPermission] = useState<Permission | null>(null);

  async function onCheckedChange(on: boolean) {
    setEnabled(on);
    if (!on) return;
    primeAlertSound();
    if (typeof Notification === "undefined") {
      setPermission("unsupported");
      return;
    }
    setPermission(
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission,
    );
  }

  const soundOnly =
    enabled && (permission === "denied" || permission === "unsupported");

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Switch
          id="new-conversation-alerts"
          checked={enabled}
          onCheckedChange={onCheckedChange}
          aria-describedby={soundOnly ? "alerts-sound-only" : undefined}
        />
        <Label htmlFor="new-conversation-alerts">New conversation alerts</Label>
      </div>
      {soundOnly && (
        <p id="alerts-sound-only" className="text-xs text-muted-foreground">
          {permission === "denied"
            ? "Notifications are blocked in this browser, so you'll only hear the sound."
            : "This browser can't show notifications, so you'll only hear the sound."}
        </p>
      )}
    </div>
  );
}
