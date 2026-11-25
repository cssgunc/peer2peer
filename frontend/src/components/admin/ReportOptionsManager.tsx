"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiFetch } from "@/lib/api";
import { reportOptionsQueryKey } from "@/lib/portal/queries";

import { SortableList } from "./SortableList";

type Kind = "topic" | "outcome";

// Mirrors AdminReportOptionDTO in backend/app/schemas/report.py.
export type ReportOption = {
  id: string;
  kind: Kind;
  label: string;
  display_order: number;
  is_active: boolean;
};

// Mirrors the max_length on ReportOptionInputDTO.label.
export const LABEL_MAX = 100;

const adminReportOptionsQueryKey = ["admin-report-options"] as const;

const KINDS: { kind: Kind; title: string; singular: string }[] = [
  { kind: "topic", title: "Topics", singular: "topic" },
  { kind: "outcome", title: "Outcomes", singular: "outcome" },
];

function errorMessage(error: unknown) {
  return error instanceof ApiError
    ? error.detail
    : "Something went wrong. Please try again.";
}

function sendJson<T>(path: string, method: string, body: unknown) {
  return apiFetch<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// The PATCH endpoint takes every field, so changes are sent on top of the current option.
function updateOption(option: ReportOption, changes: Partial<ReportOption>) {
  const { kind, label, display_order, is_active } = { ...option, ...changes };
  return sendJson<ReportOption>(
    `/api/admin/report-options/${option.id}`,
    "PATCH",
    { kind, label, display_order, is_active },
  );
}

/** Topics and outcomes for the post-conversation report (TDD 4.3.3, 4.7.6). */
export function ReportOptionsManager() {
  const options = useQuery({
    queryKey: adminReportOptionsQueryKey,
    queryFn: () => apiFetch<ReportOption[]>("/api/admin/report-options"),
  });

  if (options.isPending) {
    return <p role="status">Loading report options…</p>;
  }
  if (options.isError) {
    return (
      <div className="space-y-3">
        <p role="alert">Report options could not be loaded.</p>
        <Button variant="outline" onClick={() => options.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <p className="max-w-prose text-sm text-muted-foreground">
        Options can&apos;t be deleted, because past reports and analytics still
        use them. Deactivate an option to hide it from the report form; it stays
        on old reports and in analytics, and you can reactivate it later.
      </p>
      {KINDS.map(({ kind, title, singular }) => (
        <OptionList
          key={kind}
          kind={kind}
          title={title}
          singular={singular}
          allOptions={options.data}
          refreshing={options.isFetching}
        />
      ))}
    </div>
  );
}

type Editor = { mode: "create" } | { mode: "rename"; option: ReportOption };

function OptionList({
  kind,
  title,
  singular,
  allOptions,
  refreshing,
}: {
  kind: Kind;
  title: string;
  singular: string;
  allOptions: ReportOption[];
  refreshing: boolean;
}) {
  const queryClient = useQueryClient();
  const headingId = useId();
  const [editor, setEditor] = useState<Editor | null>(null);
  // The API returns options in display order.
  const mine = allOptions.filter((option) => option.kind === kind);
  const active = mine.filter((option) => option.is_active);
  const inactive = mine.filter((option) => !option.is_active);

  // Refresh this page and any report form open in this browser.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminReportOptionsQueryKey }),
      queryClient.invalidateQueries({ queryKey: reportOptionsQueryKey }),
    ]);

  const setActive = useMutation({
    mutationFn: ({ option, on }: { option: ReportOption; on: boolean }) =>
      updateOption(option, { is_active: on }),
    onSuccess: refresh,
  });
  const reorder = useMutation({
    // Only this list's active ids, so the other list (and inactive options) keep their places.
    mutationFn: (ids: string[]) =>
      sendJson<ReportOption[]>("/api/admin/report-options/reorder", "PUT", {
        ids,
      }),
    onSuccess: refresh,
  });
  const busy = setActive.isPending || reorder.isPending;
  const error = setActive.error ?? reorder.error;

  function renderOption(option: ReportOption) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="font-medium break-words">{option.label}</span>
          {!option.is_active && <Badge variant="outline">Inactive</Badge>}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="min-h-11"
            aria-label={`Rename ${option.label}`}
            disabled={busy}
            onClick={() => setEditor({ mode: "rename", option })}
          >
            Rename
          </Button>
          <Button
            variant="outline"
            className="min-h-11"
            aria-label={`${option.is_active ? "Deactivate" : "Reactivate"} ${option.label}`}
            disabled={busy}
            onClick={() => {
              reorder.reset();
              setActive.mutate({ option, on: !option.is_active });
            }}
          >
            {option.is_active ? "Deactivate" : "Reactivate"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-xl font-semibold">
          {title}
        </h2>
        <Button disabled={busy} onClick={() => setEditor({ mode: "create" })}>
          New {singular}
        </Button>
      </div>
      {error && <p role="alert">{errorMessage(error)}</p>}

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          Active ({active.length})
        </h3>
        {active.length === 0 ? (
          <p className="text-sm">
            No active {singular}s. Responders can&apos;t submit a report until
            there is at least one.
          </p>
        ) : (
          <SortableList
            items={active}
            getId={(option) => option.id}
            getLabel={(option) => option.label}
            renderItem={renderOption}
            disabled={busy || refreshing}
            onReorder={(ids) => {
              setActive.reset();
              reorder.mutate(ids);
            }}
          />
        )}
      </div>

      {inactive.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            Inactive ({inactive.length})
          </h3>
          <ul className="divide-y rounded-lg border">
            {inactive.map((option) => (
              <li key={option.id} className="p-2">
                {renderOption(option)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {editor && (
        <OptionDialog
          kind={kind}
          singular={singular}
          editor={editor}
          siblings={mine}
          nextOrder={
            Math.max(0, ...allOptions.map((option) => option.display_order)) + 1
          }
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            void refresh();
          }}
        />
      )}
    </section>
  );
}

function OptionDialog({
  kind,
  singular,
  editor,
  siblings,
  nextOrder,
  onClose,
  onSaved,
}: {
  kind: Kind;
  singular: string;
  editor: Editor;
  siblings: ReportOption[];
  nextOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const inputId = useId();
  const renaming = editor.mode === "rename" ? editor.option : null;
  const [label, setLabel] = useState(renaming?.label ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (value: string) =>
      renaming
        ? updateOption(renaming, { label: value })
        : sendJson<ReportOption>("/api/admin/report-options", "POST", {
            kind,
            label: value,
            display_order: nextOrder,
            is_active: true,
          }),
    onSuccess: onSaved,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = label.trim();
    if (!value) {
      setProblem("Enter a label.");
      return;
    }
    if (value.length > LABEL_MAX) {
      setProblem(`Keep the label to ${LABEL_MAX} characters or fewer.`);
      return;
    }
    const duplicate = siblings.some(
      (option) =>
        option.id !== renaming?.id &&
        option.label.toLowerCase() === value.toLowerCase(),
    );
    if (duplicate) {
      setProblem(`There's already a ${singular} with that label.`);
      return;
    }
    if (renaming && value === renaming.label) {
      onClose();
      return;
    }
    setProblem(null);
    save.mutate(value);
  }

  const message = problem ?? (save.isError ? errorMessage(save.error) : null);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent showCloseButton={!save.isPending}>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>
              {renaming ? `Rename ${singular}` : `New ${singular}`}
            </DialogTitle>
            <DialogDescription>
              {renaming
                ? "Past reports show the new label too."
                : "It shows on the report form right away."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor={inputId}>Label</Label>
            <Input
              id={inputId}
              value={label}
              maxLength={LABEL_MAX}
              autoFocus
              aria-invalid={message ? true : undefined}
              aria-describedby={`${inputId}-count`}
              onChange={(event) => {
                setLabel(event.target.value);
                setProblem(null);
              }}
            />
            <p
              id={`${inputId}-count`}
              className="text-xs text-muted-foreground"
            >
              {label.length}/{LABEL_MAX}
            </p>
          </div>
          {message && <p role="alert">{message}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
