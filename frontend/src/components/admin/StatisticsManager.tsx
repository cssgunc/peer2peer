"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useRef, useState } from "react";

import { SortableList } from "@/components/admin/SortableList";
import ImpactStats from "@/components/content/ImpactStats";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { components } from "@/lib/api-types";

type AdminStatistic = components["schemas"]["AdminStatisticDTO"];
type StatisticInput = components["schemas"]["StatisticInputDTO"];
type DialogState =
  | { kind: "create" }
  | { kind: "edit"; statistic: AdminStatistic }
  | { kind: "delete"; statistic: AdminStatistic }
  | null;

const statisticsQueryKey = ["admin-statistics"] as const;
const statisticsPath = "/api/admin/statistics";

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

export function StatisticsManager() {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogState>(null);
  const dialogTrigger = useRef<HTMLButtonElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const statistics = useQuery({
    queryKey: statisticsQueryKey,
    queryFn: () => apiFetch<AdminStatistic[]>(statisticsPath),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: statisticsQueryKey });
  const reorder = useMutation({
    mutationFn: (ids: string[]) =>
      sendJson<AdminStatistic[]>(`${statisticsPath}/reorder`, "PUT", { ids }),
    onSuccess: refresh,
  });
  const published = statistics.data?.filter((stat) => stat.is_published) ?? [];

  async function onSaved() {
    await refresh();
    setDialog(null);
  }

  function openDialog(
    next: NonNullable<DialogState>,
    trigger: HTMLButtonElement,
  ) {
    dialogTrigger.current = trigger;
    setDialog(next);
  }

  function restoreFocus(event: Event) {
    event.preventDefault();
    // A successful deletion removes its trigger, so use New statistic as a fallback.
    const target = dialogTrigger.current?.isConnected
      ? dialogTrigger.current
      : createButton.current;
    target?.focus();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Manage the impact numbers shown on the Home page.
        </p>
        <Button
          ref={createButton}
          disabled={reorder.isPending}
          onClick={(event) =>
            openDialog({ kind: "create" }, event.currentTarget)
          }
        >
          New statistic
        </Button>
      </div>

      {reorder.isError && <p role="alert">{errorMessage(reorder.error)}</p>}
      {statistics.isPending ? (
        <p role="status">Loading statistics…</p>
      ) : statistics.isError ? (
        <div className="space-y-3">
          <p role="alert">Statistics could not be loaded.</p>
          <Button variant="outline" onClick={() => statistics.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          {statistics.data.length === 0 ? (
            <p>No statistics yet. Create one to get started.</p>
          ) : (
            <SortableList
              items={statistics.data}
              getId={(stat) => stat.id}
              getLabel={(stat) => stat.label}
              onReorder={(ids) => reorder.mutate(ids)}
              disabled={reorder.isPending}
              renderItem={(stat) => (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-semibold wrap-anywhere">{stat.value}</p>
                    <p className="wrap-anywhere">{stat.label}</p>
                    <Badge variant={stat.is_published ? "default" : "outline"}>
                      {stat.is_published ? "Published" : "Draft"}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Edit ${stat.label}`}
                      disabled={reorder.isPending}
                      onClick={(event) =>
                        openDialog(
                          { kind: "edit", statistic: stat },
                          event.currentTarget,
                        )
                      }
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      aria-label={`Delete ${stat.label}`}
                      disabled={reorder.isPending}
                      onClick={(event) =>
                        openDialog(
                          { kind: "delete", statistic: stat },
                          event.currentTarget,
                        )
                      }
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              )}
            />
          )}

          <section
            aria-label="Published statistics preview"
            className="space-y-3"
          >
            <h2 className="text-xl font-semibold">
              Published statistics preview
            </h2>
            {published.length === 0 ? (
              <p>
                No published statistics. The Home page impact section is hidden.
              </p>
            ) : (
              <ImpactStats stats={published} />
            )}
          </section>
        </>
      )}

      {(dialog?.kind === "create" || dialog?.kind === "edit") && (
        <StatisticFormDialog
          statistic={dialog.kind === "edit" ? dialog.statistic : undefined}
          onClose={() => setDialog(null)}
          onSaved={onSaved}
          onCloseAutoFocus={restoreFocus}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteStatisticDialog
          statistic={dialog.statistic}
          onClose={() => setDialog(null)}
          onDeleted={onSaved}
          onCloseAutoFocus={restoreFocus}
        />
      )}
    </div>
  );
}

function StatisticFormDialog({
  statistic,
  onClose,
  onSaved,
  onCloseAutoFocus,
}: {
  statistic?: AdminStatistic;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const id = useId();
  const [label, setLabel] = useState(statistic?.label ?? "");
  const [value, setValue] = useState(statistic?.value ?? "");
  const [published, setPublished] = useState(statistic?.is_published ?? false);
  const save = useMutation({
    mutationFn: (body: StatisticInput) =>
      sendJson<AdminStatistic>(
        statistic ? `${statisticsPath}/${statistic.id}` : statisticsPath,
        statistic ? "PATCH" : "POST",
        body,
      ),
    onSuccess: onSaved,
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending || !label.trim() || !value.trim()) return;
    save.mutate({
      label: label.trim(),
      value: value.trim(),
      is_published: published,
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent
        showCloseButton={!save.isPending}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>
            {statistic ? "Edit statistic" : "New statistic"}
          </DialogTitle>
          <DialogDescription>
            Only published statistics appear on the Home page.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor={`${id}-label`}>Label</Label>
            <Input
              id={`${id}-label`}
              required
              maxLength={200}
              value={label}
              disabled={save.isPending}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-value`}>Value</Label>
            <Input
              id={`${id}-value`}
              required
              maxLength={50}
              placeholder="120+"
              value={value}
              disabled={save.isPending}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${id}-published`}
              checked={published}
              disabled={save.isPending}
              onCheckedChange={(checked) => setPublished(checked === true)}
            />
            <Label htmlFor={`${id}-published`}>Published</Label>
          </div>
          {save.isError && <p role="alert">{errorMessage(save.error)}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={save.isPending || !label.trim() || !value.trim()}
            >
              {save.isPending
                ? "Saving…"
                : statistic
                  ? "Save changes"
                  : "Create statistic"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteStatisticDialog({
  statistic,
  onClose,
  onDeleted,
  onCloseAutoFocus,
}: {
  statistic: AdminStatistic;
  onClose: () => void;
  onDeleted: () => Promise<void>;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const remove = useMutation({
    mutationFn: () =>
      apiFetch<void>(`${statisticsPath}/${statistic.id}`, { method: "DELETE" }),
    onSuccess: onDeleted,
  });

  return (
    <AlertDialog
      open
      onOpenChange={(open) => !open && !remove.isPending && onClose()}
    >
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete statistic?</AlertDialogTitle>
          <AlertDialogDescription>
            Delete “{statistic.value} / {statistic.label}”? This removes it from
            the Home page if published and cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {remove.isError && <p role="alert">{errorMessage(remove.error)}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={(event) => {
              // Leave the confirmation open to show any API error.
              event.preventDefault();
              remove.mutate();
            }}
          >
            {remove.isPending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
