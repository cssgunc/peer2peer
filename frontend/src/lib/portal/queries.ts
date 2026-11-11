"use client";

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";

// Mirrors MeDTO in backend/app/schemas/auth.py.
export type Me = {
  id: string;
  email: string;
  display_name: string;
  role: "responder" | "coordinator";
  must_change_password: boolean;
  shift: { id: string; started_at: string } | null;
};

export const meQueryKey = ["me"] as const;

export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: () => apiFetch<Me>("/api/auth/me"),
  });
}

// Mirrors InboxItemDTO in backend/app/schemas/portal.py.
export type InboxItem = {
  conversation_id: string;
  label: string;
  channel: "web" | "sms";
  status: "queued" | "active" | "closed";
  opened_at: string;
  last_message_at: string | null;
  unread_count: number;
  needs_report: boolean;
};

export const inboxQueryKey = ["inbox"] as const;

export function fetchInbox() {
  return apiFetch<InboxItem[]>("/api/portal/inbox");
}

export type Guide = components["schemas"]["ContentBlockDTO"];

export const guideQueryKey = ["guide"] as const;

export function useGuide() {
  return useQuery({
    queryKey: guideQueryKey,
    queryFn: () => apiFetch<Guide>("/api/portal/guide"),
    // Reuse cached content between the page and panel without refetching on mount.
    staleTime: Infinity,
  });
}
