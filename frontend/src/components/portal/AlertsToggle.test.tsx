import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { primeAlertSound } from "@/lib/portal/alertSound";
import { ALERTS_STORAGE_KEY } from "@/lib/portal/alerts";

import { AlertsToggle } from "./AlertsToggle";

vi.mock("@/lib/portal/alertSound", () => ({
  playAlertSound: vi.fn(),
  primeAlertSound: vi.fn(),
}));

const requestPermission = vi.fn<() => Promise<NotificationPermission>>();
const FakeNotification = { permission: "default", requestPermission };

beforeEach(() => {
  window.localStorage.clear();
  FakeNotification.permission = "default";
  requestPermission.mockResolvedValue("granted");
  vi.stubGlobal("Notification", FakeNotification);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const toggle = () =>
  screen.getByRole("switch", { name: "New conversation alerts" });

it("is off by default and asks for nothing until turned on", () => {
  render(<AlertsToggle />);

  expect(toggle()).not.toBeChecked();
  expect(requestPermission).not.toHaveBeenCalled();
});

it("turns alerts on, asks for notification permission, and remembers it", async () => {
  const user = userEvent.setup();
  render(<AlertsToggle />);

  await user.click(toggle());

  expect(toggle()).toBeChecked();
  expect(requestPermission).toHaveBeenCalledTimes(1);
  expect(primeAlertSound).toHaveBeenCalledTimes(1);
  expect(window.localStorage.getItem(ALERTS_STORAGE_KEY)).toBe("on");
  expect(screen.queryByText(/only hear the sound/)).toBeNull();
});

it("starts on when it was left on", () => {
  window.localStorage.setItem(ALERTS_STORAGE_KEY, "on");
  render(<AlertsToggle />);

  expect(toggle()).toBeChecked();
});

it("turns alerts off", async () => {
  window.localStorage.setItem(ALERTS_STORAGE_KEY, "on");
  const user = userEvent.setup();
  render(<AlertsToggle />);

  await user.click(toggle());

  expect(toggle()).not.toBeChecked();
  expect(window.localStorage.getItem(ALERTS_STORAGE_KEY)).toBe("off");
  expect(requestPermission).not.toHaveBeenCalled();
});

it("says it's sound only when notifications are blocked", async () => {
  FakeNotification.permission = "denied";
  const user = userEvent.setup();
  render(<AlertsToggle />);

  await user.click(toggle());

  expect(requestPermission).not.toHaveBeenCalled();
  expect(
    await screen.findByText(
      "Notifications are blocked in this browser, so you'll only hear the sound.",
    ),
  ).toBeVisible();
});
