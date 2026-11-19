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

export function fetchInbox() {
  return apiFetch<InboxItem[]>("/api/portal/inbox");
}

/** Newest activity first, as the API sorts it. Pass `enabled: false` off shift (the API returns 403). */
export function useInbox({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: inboxQueryKey,
    queryFn: fetchInbox,
    enabled,
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

// Mirrors FeedbackDTO in backend/app/schemas/feedback.py. created_on is a date-only "YYYY-MM-DD".
export type Feedback = {
  id: string;
  body: string;
  created_on: string;
  read: boolean;
};

export type FeedbackFilter = "all" | "unread" | "read";

// The inbox list and the nav's unread count both live under this prefix, so one
// invalidation refreshes both.
export const feedbackQueryKey = ["admin-feedback"] as const;

function feedbackQuery(filter: FeedbackFilter) {
  return {
    queryKey: [...feedbackQueryKey, filter] as const,
    queryFn: () =>
      apiFetch<Feedback[]>(
        filter === "all"
          ? "/api/admin/feedback"
          : `/api/admin/feedback?unread=${filter === "unread"}`,
      ),
  };
}

export function useFeedback(filter: FeedbackFilter) {
  return useQuery(feedbackQuery(filter));
}

/** No count endpoint, so this counts the Unread list; it shares that filter's cache entry. */
export function useFeedbackUnreadCount({
  enabled = true,
}: { enabled?: boolean } = {}) {
  return useQuery({
    ...feedbackQuery("unread"),
    select: (items: Feedback[]) => items.length,
    enabled,
  });
}

// Mirrors AdminSiteSettingsDTO in backend/app/schemas/settings.py.
export type AdminSiteSetting = {
  key: string;
  value: unknown;
  description: string;
  public: boolean;
  updated_by: string | null;
  updated_at: string | null;
};

export const adminSettingsQueryKey = ["admin-settings"] as const;

export function useAdminSetting<T>(key: string) {
  return useQuery({
    queryKey: adminSettingsQueryKey,
    queryFn: () => apiFetch<AdminSiteSetting[]>("/api/admin/settings"),
    select: (settings) =>
      settings.find((setting) => setting.key === key)?.value as T | undefined,
  });
}
