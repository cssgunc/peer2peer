//  frontend/src/components/admin/AuditLogTable.tsx, used by frontend/src/app/portal/admin/audit-log/page.tsx. Read-only.
// A table (GET /api/admin/audit-log) with time (shown in America/New_York), actor, action, and target (type and id)
// Filters:

//     action: a select of the AuditAction values, with readable labels (e.g. escalation.view → "Viewed escalation record")
//     actor: a select of accounts from GET /api/admin/accounts

// Pagination from page, page_size, and total (50 per page), with the page and filters kept in the URL query string so a filtered view can be linked
// Show "Deleted account" when actor_display_name is null
"use client";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";

const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30";

export const auditActions = [
  "account.create",
  "account.update",
  "account.deactivate",
  "account.reset_password",
  "settings.update",
  "content.update",
  "hours.update",
  "hours_exception.create",
  "hours_exception.update",
  "hours_exception.delete",
  "report_option.create",
  "report_option.update",
  "feedback.delete",
  "escalation.create",
  "escalation.view",
  "faq.create",
  "faq.update",
  "faq.delete",
  "statistic.create",
  "statistic.update",
  "statistic.delete",
  "fit_guide.create",
  "fit_guide.update",
  "fit_guide.delete",
  "resource.create",
  "resource.update",
  "resource.delete",
  "resource_tag.create",
  "resource_tag.update",
  "resource_tag.delete",
  "faq.reorder",
  "statistic.reorder",
  "fit_guide.reorder",
  "resource.reorder",
  "resource_tag.reorder",
  "report_option.reorder",
] as const;

type AuditAction = components["schemas"]["AuditAction"];

type AuditActor = {
  id: string;
  display_name: string;
};

export const actionLabels: Record<AuditAction, string> = {
  "account.create": "Created account",
  "account.update": "Updated account",
  "account.deactivate": "Deactivated account",
  "account.reset_password": "Reset account password",
  "settings.update": "Updated settings",
  "content.update": "Updated content",
  "hours.update": "Updated hours",
  "hours_exception.create": "Created hours exception",
  "hours_exception.update": "Updated hours exception",
  "hours_exception.delete": "Deleted hours exception",
  "report_option.create": "Created report option",
  "report_option.update": "Updated report option",
  "feedback.delete": "Deleted feedback",
  "escalation.create": "Created escalation record",
  "escalation.view": "Viewed escalation record",
  "faq.create": "Created FAQ",
  "faq.update": "Updated FAQ",
  "faq.delete": "Deleted FAQ",
  "statistic.create": "Created statistic",
  "statistic.update": "Updated statistic",
  "statistic.delete": "Deleted statistic",
  "fit_guide.create": "Created fit guide",
  "fit_guide.update": "Updated fit guide",
  "fit_guide.delete": "Deleted fit guide",
  "resource.create": "Created resource",
  "resource.update": "Updated resource",
  "resource.delete": "Deleted resource",
  "resource_tag.create": "Created resource tag",
  "resource_tag.update": "Updated resource tag",
  "resource_tag.delete": "Deleted resource tag",
  "faq.reorder": "Reordered FAQ",
  "statistic.reorder": "Reordered statistic",
  "fit_guide.reorder": "Reordered fit guide",
  "resource.reorder": "Reordered resource",
  "resource_tag.reorder": "Reordered resource tag",
  "report_option.reorder": "Reordered report option",
};

const sortedAuditActions = [...auditActions].sort((a, b) =>
  actionLabels[a].localeCompare(actionLabels[b]),
);

type AuditRow = {
  id: number;
  actor_display_name: string | null;
  action: AuditAction;
  target_type: string;
  target_id: string | null;
  created_at: string;
};

type ActionFilter = "" | AuditAction;

const datetimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/New_York",
});

function formatAuditTime(createdAt: string): string {
  return datetimeFormatter.format(new Date(createdAt));
}

type AuditPage = {
  items: AuditRow[];
  page: number;
  page_size: number;
  total: number;
};

function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.detail
    : "Something went wrong. Please try again.";
}

function useFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const rawPage = Number(searchParams.get("page") ?? "1");
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const rawAction = searchParams.get("action") ?? "";
  const action: ActionFilter = auditActions.includes(rawAction as AuditAction)
    ? (rawAction as AuditAction)
    : "";

  const actor = searchParams.get("actor") ?? "";

  function updateFilters(changes: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);

    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }

    const query = next.toString();
    router.replace(
      query ? `/portal/admin/audit-log?${query}` : "/portal/admin/audit-log",
    );
  }

  return {
    page,
    action,
    actor,
    setPage: (value: number) => updateFilters({ page: String(value) }),
    setAction: (value: string) =>
      updateFilters({ action: value || null, page: null }),
    setActor: (value: string) =>
      updateFilters({ actor: value || null, page: null }),
  };
}

export function AuditLogTable() {
  const filters = useFilters();

  const params = new URLSearchParams({ page: String(filters.page) });
  if (filters.action) params.set("action", filters.action);
  if (filters.actor) params.set("actor", filters.actor);

  const auditLog = useQuery({
    queryKey: ["admin-audit-log", filters.page, filters.action, filters.actor],
    queryFn: () => apiFetch<AuditPage>(`/api/admin/audit-log?${params}`),
  });

  const accounts = useQuery({
    queryKey: ["admin-accounts"],
    queryFn: () => apiFetch<AuditActor[]>("/api/admin/accounts"),
  });

  const rows = auditLog.data?.items ?? [];

  // loading and error messages
  if (auditLog.isPending) {
    return <p role="status">Loading audit log...</p>;
  }
  if (auditLog.isError) {
    return <p role="alert">{errorMessage(auditLog.error)}</p>;
  }

  const totalPages = Math.max(
    1,
    Math.ceil(auditLog.data.total / auditLog.data.page_size),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="action-filter">Action</label>
          <select
            id="action-filter"
            className={selectClass}
            value={filters.action}
            onChange={(event) => {
              filters.setAction(event.target.value as ActionFilter);
            }}
          >
            <option value="">All actions</option>
            {sortedAuditActions.map((value) => (
              <option key={value} value={value}>
                {actionLabels[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="actor-filter">Actor</label>
          {accounts.isPending ? (
            <p role="status">Loading accounts...</p>
          ) : accounts.isError ? (
            <div>
              <p role="alert">{errorMessage(accounts.error)}</p>
              <Button variant="outline" onClick={() => accounts.refetch()}>
                Try again
              </Button>
            </div>
          ) : (
            <select
              id="actor-filter"
              className={selectClass}
              value={filters.actor}
              onChange={(event) => {
                filters.setActor(event.target.value);
              }}
            >
              <option value="">All actors</option>
              {(accounts.data ?? []).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.display_name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Target</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{formatAuditTime(row.created_at)}</TableCell>
              <TableCell>
                {row.actor_display_name ?? "Deleted account"}
              </TableCell>
              <TableCell>{actionLabels[row.action]}</TableCell>
              <TableCell>
                {row.target_type}: {row.target_id ?? "-"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          disabled={filters.page <= 1}
          onClick={() => filters.setPage(filters.page - 1)}
        >
          Previous
        </Button>

        <span>
          Page {filters.page} of {totalPages} ({auditLog.data.total} events)
        </span>

        <Button
          variant="outline"
          disabled={filters.page >= totalPages}
          onClick={() => filters.setPage(filters.page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
