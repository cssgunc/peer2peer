import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { playAlertSound } from "./alertSound";
import {
  ALERTS_STORAGE_KEY,
  NEW_CONVERSATION_NOTIFICATION,
  useAlertsEnabled,
  useNewConversationAlerts,
} from "./alerts";
import { type PortalEvent, usePortalEvents } from "./PortalSocketProvider";

vi.mock("./alertSound", () => ({
  playAlertSound: vi.fn(),
  primeAlertSound: vi.fn(),
}));
vi.mock("./PortalSocketProvider", () => ({ usePortalEvents: vi.fn() }));

// Records every notification shown, with everything passed to it.
class FakeNotification {
  static permission: NotificationPermission = "granted";
  static shown: { title: string; options?: NotificationOptions }[] = [];
  onclick: (() => void) | null = null;
  constructor(title: string, options?: NotificationOptions) {
    FakeNotification.shown.push({ title, options });
  }
  close() {}
}

const conversationId = "00000000-0000-0000-0000-000000000007";
const created: PortalEvent = {
  type: "conversation.created",
  data: {
    conversation_id: conversationId,
    label_number: 7,
    channel: "sms",
    status: "active",
    opened_at: "2026-11-11T21:00:00Z",
  },
};
const message: PortalEvent = {
  type: "message.created",
  data: {
    conversation_id: conversationId,
    message: {
      id: "message",
      sender: "texter",
      body: "I can't stop thinking about the exam",
      created_at: "2026-11-11T21:01:00Z",
      delivery_status: "received",
    },
  },
};

function emit(event: PortalEvent) {
  const listener = vi.mocked(usePortalEvents).mock.lastCall?.[0];
  act(() => listener?.(event));
}

function turnAlertsOn() {
  window.localStorage.setItem(ALERTS_STORAGE_KEY, "on");
}

beforeEach(() => {
  window.localStorage.clear();
  FakeNotification.permission = "granted";
  FakeNotification.shown = [];
  vi.stubGlobal("Notification", FakeNotification);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useNewConversationAlerts", () => {
  it("does nothing until alerts are turned on", () => {
    renderHook(() => useNewConversationAlerts());

    emit(created);

    expect(playAlertSound).not.toHaveBeenCalled();
    expect(FakeNotification.shown).toEqual([]);
  });

  it("plays the sound and notifies on conversation.created when alerts are on", () => {
    turnAlertsOn();
    renderHook(() => useNewConversationAlerts());

    emit(created);

    expect(playAlertSound).toHaveBeenCalledTimes(1);
    expect(FakeNotification.shown).toHaveLength(1);
  });

  it("ignores other events", () => {
    turnAlertsOn();
    renderHook(() => useNewConversationAlerts());

    emit(message);
    emit({
      type: "conversation.updated",
      data: { conversation_id: conversationId },
    });

    expect(playAlertSound).not.toHaveBeenCalled();
    expect(FakeNotification.shown).toEqual([]);
  });

  it("stops as soon as alerts are turned off", () => {
    turnAlertsOn();
    const { result } = renderHook(() => {
      useNewConversationAlerts();
      return useAlertsEnabled();
    });

    act(() => result.current[1](false));
    emit(created);

    expect(result.current[0]).toBe(false);
    expect(playAlertSound).not.toHaveBeenCalled();
  });

  it("never puts the label or message content in the notification", () => {
    turnAlertsOn();
    renderHook(() => useNewConversationAlerts());

    emit(message);
    emit(created);

    expect(FakeNotification.shown).toHaveLength(1);
    const [{ title, options }] = FakeNotification.shown;
    expect(title).toBe(NEW_CONVERSATION_NOTIFICATION);
    expect(options?.body).toBeUndefined();
    const everything = JSON.stringify({ title, options });
    for (const secret of [
      "Texter",
      "7",
      conversationId,
      "sms",
      "exam",
      "I can't stop",
    ]) {
      expect(everything).not.toContain(secret);
    }
  });

  it("still plays the sound when notifications aren't allowed", () => {
    FakeNotification.permission = "denied";
    turnAlertsOn();
    renderHook(() => useNewConversationAlerts());

    emit(created);

    expect(playAlertSound).toHaveBeenCalledTimes(1);
    expect(FakeNotification.shown).toEqual([]);
  });

  it("still plays the sound in browsers without the Notification API", () => {
    vi.stubGlobal("Notification", undefined);
    turnAlertsOn();
    renderHook(() => useNewConversationAlerts());

    emit(created);

    expect(playAlertSound).toHaveBeenCalledTimes(1);
  });
});

describe("useAlertsEnabled", () => {
  it("remembers the choice in localStorage", () => {
    const first = renderHook(() => useAlertsEnabled());
    expect(first.result.current[0]).toBe(false);

    act(() => first.result.current[1](true));
    first.unmount();

    expect(window.localStorage.getItem(ALERTS_STORAGE_KEY)).toBe("on");
    const second = renderHook(() => useAlertsEnabled());
    expect(second.result.current[0]).toBe(true);
  });

  it("stays off when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useAlertsEnabled());
    expect(result.current[0]).toBe(false);
    vi.mocked(Storage.prototype.getItem).mockRestore();
  });
});
