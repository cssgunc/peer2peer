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

// Shared with the inbox and conversation screens; the portal socket keeps them fresh.
export const inboxQueryKey = ["inbox"] as const;

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

export function useInbox() {
  return useQuery({
    queryKey: inboxQueryKey,
    queryFn: () => apiFetch<InboxItem[]>("/api/portal/inbox"),
  });
}

// Mirrors ReportOptionsDTO in backend/app/schemas/report.py.
export type ReportOptions = {
  topics: { id: string; label: string }[];
  outcomes: { id: string; label: string }[];
};

export const reportOptionsQueryKey = ["report-options"] as const;

export function useReportOptions() {
  return useQuery({
    queryKey: reportOptionsQueryKey,
    queryFn: () => apiFetch<ReportOptions>("/api/portal/report-options"),
  });
}

export const conversationQueryKey = (id: string) =>
  ["conversation", id] as const;

// Mirrors PortalMessageDTO in backend/app/schemas/portal.py.
export type PortalMessage = {
  id: string;
  sender: "texter" | "responder" | "system";
  body: string;
  created_at: string;
  delivery_status: "received" | "sent" | "delivered" | "failed" | null;
};

// Mirrors PortalConversationDTO in backend/app/schemas/portal.py.
export type PortalConversation = {
  conversation_id: string;
  label: string;
  channel: "web" | "sms";
  status: "queued" | "active" | "closed";
  opened_at: string;
  closed_at: string | null;
  messages: PortalMessage[];
};

export function useConversation(id: string) {
  return useQuery({
    queryKey: conversationQueryKey(id),
    queryFn: () =>
      apiFetch<PortalConversation>(`/api/portal/conversations/${id}`),
  });
}

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

// Set once a responder records an escalation; the API doesn't report it back yet.
export const escalatedQueryKey = (conversationId: string) =>
  ["escalated", conversationId] as const;

// Mirrors EscalationDTO in backend/app/schemas/escalations.py.
// TODO(escalation-protocol): the final shape waits on the CAPS protocol.
export type Escalation = {
  id: string;
  conversation_label: string;
  status: "open" | "handed_off" | "closed";
  created_by_display_name: string;
  created_at: string;
};

// Mirrors EscalationDetailDTO in backend/app/schemas/escalations.py.
export type EscalationDetail = Escalation & {
  payload: Record<string, unknown> | null;
};

export const escalationsQueryKey = ["escalations"] as const;

export function useEscalations() {
  return useQuery({
    queryKey: escalationsQueryKey,
    queryFn: () => apiFetch<Escalation[]>("/api/admin/escalations"),
  });
}

// Every fetch writes an audit entry, so only fetch when enabled and keep nothing afterwards.
export function useEscalation(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["escalation", id],
    queryFn: () => apiFetch<EscalationDetail>(`/api/admin/escalations/${id}`),
    enabled,
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
