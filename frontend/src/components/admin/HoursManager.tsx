"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type FormEvent,
  type MouseEvent,
  useId,
  useMemo,
  useState,
} from "react";

import HoursList, {
  getTodayInTimezone,
  type Hours,
} from "@/components/content/HoursList";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ApiError, apiFetch } from "@/lib/api";

// Mirrors AdminHoursDTO in backend/app/schemas/hours.py. Times are wall-clock
// times in `timezone`; they never pass through the browser's timezone.
export type AdminHoursException = Hours["exceptions"][number] & { id: string };
export type AdminHours = Omit<Hours, "exceptions"> & {
  exceptions: AdminHoursException[];
};

const hoursQueryKey = ["admin-hours"] as const;

// day_of_week follows Python's weekday(): 0 is Monday.
const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const NOTE_MAX_LENGTH = 200;

type DraftWindow = { key: number; opens_at: string; closes_at: string };
type DraftWeek = DraftWindow[][];

let nextKey = 0;

/** The API sends `HH:MM:SS`; time inputs use `HH:MM`. */
const toInputTime = (time: string) => time.slice(0, 5);

function weekFromHours(hours: AdminHours): DraftWeek {
  return DAYS.map((_, day) =>
    hours.weekly
      .filter((w) => w.day_of_week === day)
      .map((w) => ({
        key: nextKey++,
        opens_at: toInputTime(w.opens_at),
        closes_at: toInputTime(w.closes_at),
      })),
  );
}

function weeklyFromDraft(week: DraftWeek): Hours["weekly"] {
  return week.flatMap((windows, day) =>
    windows.map((w) => ({
      day_of_week: day,
      opens_at: w.opens_at,
      closes_at: w.closes_at,
    })),
  );
}

function errorMessage(error: unknown) {
  if (!(error instanceof ApiError)) {
    return "Something went wrong. Please try again.";
  }
  // Validation errors arrive as "weekly: Value error, <message>".
  return error.code === "validation_error"
    ? error.detail.replace(/^[^:]*: (Value error, )?/, "")
    : error.detail;
}

function sendJson<T>(path: string, method: string, body?: unknown) {
  return apiFetch<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** Formats a `YYYY-MM-DD` calendar date without shifting it into the browser's timezone. */
const formatDate = (date: string) =>
  dateFormat.format(new Date(`${date}T00:00:00Z`));

function formatTime(time: string) {
  const [hourText, minute] = time.split(":");
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

const isOvernight = (opensAt: string, closesAt: string) =>
  opensAt !== "" && closesAt !== "" && closesAt < opensAt;

export function HoursManager() {
  const hours = useQuery({
    queryKey: hoursQueryKey,
    queryFn: () => apiFetch<AdminHours>("/api/admin/hours"),
  });

  if (hours.isPending) return <p role="status">Loading hours…</p>;
  if (hours.isError) {
    return (
      <div className="space-y-3">
        <p role="alert">The hours could not be loaded. Please try again.</p>
        <Button variant="outline" onClick={() => hours.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  return <HoursEditor hours={hours.data} />;
}

function HoursEditor({ hours }: { hours: AdminHours }) {
  // Null until the coordinator edits the week; then it holds every unsaved change.
  const [draft, setDraft] = useState<DraftWeek | null>(null);
  const saved = useMemo(() => weekFromHours(hours), [hours]);
  const week = draft ?? saved;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-8">
        <WeeklySchedule
          timezone={hours.timezone}
          week={week}
          dirty={draft !== null}
          onChange={setDraft}
          onReset={() => setDraft(null)}
        />
        <ExceptionList hours={hours} />
      </div>
      <section aria-labelledby="hours-preview" className="space-y-3">
        <h2 id="hours-preview" className="text-lg font-semibold">
          Preview
        </h2>
        <p className="text-sm text-muted-foreground">
          How the public site will show these hours, including unsaved changes.
        </p>
        <div className="rounded-lg border p-4">
          <HoursList
            hours={{
              timezone: hours.timezone,
              weekly: weeklyFromDraft(week).filter(
                (w) => w.opens_at && w.closes_at,
              ),
              exceptions: hours.exceptions,
            }}
          />
        </div>
      </section>
    </div>
  );
}

function WeeklySchedule({
  timezone,
  week,
  dirty,
  onChange,
  onReset,
}: {
  timezone: string;
  week: DraftWeek;
  dirty: boolean;
  onChange: (week: DraftWeek) => void;
  onReset: () => void;
}) {
  const queryClient = useQueryClient();
  const timezoneId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function update(day: number, windows: DraftWindow[]) {
    setSaved(false);
    onChange(week.map((w, i) => (i === day ? windows : w)));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const weekly = weeklyFromDraft(week);
    if (weekly.some((w) => !w.opens_at || !w.closes_at)) {
      setError("Every window needs a start and end time.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await sendJson<AdminHours>("/api/admin/hours", "PUT", {
        weekly,
      });
      queryClient.setQueryData(hoursQueryKey, result);
      onReset();
      setSaved(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="weekly-hours" className="space-y-4">
      <div className="space-y-1">
        <h2 id="weekly-hours" className="text-lg font-semibold">
          Weekly schedule
        </h2>
        <p id={timezoneId} className="text-sm text-muted-foreground">
          Times are in {timezone}. A window that ends before it starts runs past
          midnight.
        </p>
      </div>
      <form onSubmit={save} className="space-y-4" noValidate>
        <ul className="divide-y rounded-lg border">
          {week.map((windows, day) => (
            <li
              key={DAYS[day]}
              className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start"
            >
              <span className="font-medium sm:w-28 sm:pt-1.5">{DAYS[day]}</span>
              <div className="flex flex-1 flex-col gap-2">
                {windows.length === 0 && (
                  <span className="text-sm text-muted-foreground sm:pt-1.5">
                    Closed
                  </span>
                )}
                {windows.map((window, index) => (
                  <WindowRow
                    key={window.key}
                    label={`${DAYS[day]} window ${index + 1}`}
                    window={window}
                    describedBy={timezoneId}
                    onChange={(next) =>
                      update(
                        day,
                        windows.map((w) => (w.key === window.key ? next : w)),
                      )
                    }
                    onRemove={() =>
                      update(
                        day,
                        windows.filter((w) => w.key !== window.key),
                      )
                    }
                  />
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  aria-label={`Add window on ${DAYS[day]}`}
                  onClick={() =>
                    update(day, [
                      ...windows,
                      { key: nextKey++, opens_at: "", closes_at: "" },
                    ])
                  }
                >
                  Add window
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending || !dirty}>
            {pending ? "Saving…" : "Save weekly schedule"}
          </Button>
          {dirty && (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setError(null);
                onReset();
              }}
            >
              Discard changes
            </Button>
          )}
          {saved && !dirty && (
            <span role="status" className="text-sm text-muted-foreground">
              Saved.
            </span>
          )}
        </div>
      </form>
    </section>
  );
}

function WindowRow({
  label,
  window,
  describedBy,
  onChange,
  onRemove,
}: {
  label: string;
  window: DraftWindow;
  describedBy: string;
  onChange: (window: DraftWindow) => void;
  onRemove: () => void;
}) {
  const id = useId();
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap items-end gap-2"
    >
      <div className="space-y-1">
        <Label htmlFor={`${id}-opens`} className="text-xs">
          Opens
        </Label>
        <Input
          id={`${id}-opens`}
          type="time"
          value={window.opens_at}
          aria-describedby={describedBy}
          onChange={(e) => onChange({ ...window, opens_at: e.target.value })}
          className="w-32"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-closes`} className="text-xs">
          Closes
        </Label>
        <Input
          id={`${id}-closes`}
          type="time"
          value={window.closes_at}
          aria-describedby={describedBy}
          onChange={(e) => onChange({ ...window, closes_at: e.target.value })}
          className="w-32"
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
      >
        Remove
      </Button>
      {isOvernight(window.opens_at, window.closes_at) && (
        <span className="w-full text-xs text-muted-foreground">
          Ends the following day
        </span>
      )}
    </div>
  );
}

type ExceptionDialog =
  | { kind: "create" }
  | { kind: "edit"; exception: AdminHoursException }
  | { kind: "delete"; exception: AdminHoursException }
  | null;

function describeException(exception: AdminHoursException) {
  if (exception.is_closed) return "Closed all day";
  return `${formatTime(exception.opens_at ?? "")} to ${formatTime(exception.closes_at ?? "")}`;
}

function ExceptionList({ hours }: { hours: AdminHours }) {
  const [dialog, setDialog] = useState<ExceptionDialog>(null);
  const today = getTodayInTimezone(hours.timezone);
  const upcoming = hours.exceptions.filter((e) => e.date >= today);
  const past = hours.exceptions.filter((e) => e.date < today);

  const renderItem = (exception: AdminHoursException) => (
    <li
      key={exception.id}
      className="flex flex-wrap items-center justify-between gap-2 p-3"
    >
      <div>
        <p className="font-medium">{formatDate(exception.date)}</p>
        <p className="text-sm text-muted-foreground">
          {describeException(exception)}
          {exception.note && <> · {exception.note}</>}
        </p>
      </div>
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Edit ${formatDate(exception.date)}`}
          onClick={() => setDialog({ kind: "edit", exception })}
        >
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Delete ${formatDate(exception.date)}`}
          onClick={() => setDialog({ kind: "delete", exception })}
        >
          Delete
        </Button>
      </div>
    </li>
  );

  return (
    <section aria-labelledby="hours-exceptions" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="hours-exceptions" className="text-lg font-semibold">
            Date exceptions
          </h2>
          <p className="text-sm text-muted-foreground">
            Holidays and other days that differ from the weekly schedule.
          </p>
        </div>
        <Button onClick={() => setDialog({ kind: "create" })}>
          Add exception
        </Button>
      </div>
      {upcoming.length === 0 ? (
        <p className="text-sm text-muted-foreground">No upcoming exceptions.</p>
      ) : (
        <ul
          aria-label="Upcoming exceptions"
          className="divide-y rounded-lg border"
        >
          {upcoming.map(renderItem)}
        </ul>
      )}
      {past.length > 0 && (
        <details className="rounded-lg border">
          <summary className="cursor-pointer p-3 text-sm font-medium">
            Past exceptions ({past.length})
          </summary>
          <ul aria-label="Past exceptions" className="divide-y border-t">
            {past.map(renderItem)}
          </ul>
        </details>
      )}
      {(dialog?.kind === "create" || dialog?.kind === "edit") && (
        <ExceptionFormDialog
          timezone={hours.timezone}
          exception={dialog.kind === "edit" ? dialog.exception : undefined}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteExceptionDialog
          exception={dialog.exception}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}

function ExceptionFormDialog({
  timezone,
  exception,
  onClose,
}: {
  timezone: string;
  exception?: AdminHoursException;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const id = useId();
  const [date, setDate] = useState(exception?.date ?? "");
  const [closed, setClosed] = useState(exception?.is_closed ?? true);
  const [opensAt, setOpensAt] = useState(
    exception?.opens_at ? toInputTime(exception.opens_at) : "",
  );
  const [closesAt, setClosesAt] = useState(
    exception?.closes_at ? toInputTime(exception.closes_at) : "",
  );
  const [note, setNote] = useState(exception?.note ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!date) {
      setError("Choose a date.");
      return;
    }
    if (!closed && (!opensAt || !closesAt)) {
      setError("Enter both an opening and a closing time.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await sendJson(
        exception
          ? `/api/admin/hours/exceptions/${exception.id}`
          : "/api/admin/hours/exceptions",
        exception ? "PATCH" : "POST",
        {
          date,
          is_closed: closed,
          opens_at: closed ? null : opensAt,
          closes_at: closed ? null : closesAt,
          note: note.trim() || null,
        },
      );
      await queryClient.invalidateQueries({ queryKey: hoursQueryKey });
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {exception ? "Edit exception" : "Add exception"}
          </DialogTitle>
          <DialogDescription>Times are in {timezone}.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={submit}
          className="space-y-4"
          aria-label="Hours exception"
          noValidate
        >
          <div className="space-y-1">
            <Label htmlFor={`${id}-date`}>Date</Label>
            <Input
              id={`${id}-date`}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <RadioGroup
            value={closed ? "closed" : "custom"}
            onValueChange={(value) => setClosed(value === "closed")}
            aria-label="Hours on this date"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="closed" id={`${id}-closed`} />
              <Label htmlFor={`${id}-closed`}>Closed all day</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="custom" id={`${id}-custom`} />
              <Label htmlFor={`${id}-custom`}>Custom hours</Label>
            </div>
          </RadioGroup>
          {!closed && (
            <div className="flex flex-wrap gap-2">
              <div className="space-y-1">
                <Label htmlFor={`${id}-opens`}>Opens</Label>
                <Input
                  id={`${id}-opens`}
                  type="time"
                  value={opensAt}
                  onChange={(e) => setOpensAt(e.target.value)}
                  className="w-32"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${id}-closes`}>Closes</Label>
                <Input
                  id={`${id}-closes`}
                  type="time"
                  value={closesAt}
                  onChange={(e) => setClosesAt(e.target.value)}
                  className="w-32"
                />
              </div>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor={`${id}-note`}>Note (optional)</Label>
            <Input
              id={`${id}-note`}
              value={note}
              maxLength={NOTE_MAX_LENGTH}
              placeholder="Thanksgiving"
              aria-describedby={`${id}-note-count`}
              onChange={(e) => setNote(e.target.value)}
            />
            <p
              id={`${id}-note-count`}
              className="text-xs text-muted-foreground"
            >
              {note.length} / {NOTE_MAX_LENGTH}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save exception"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteExceptionDialog({
  exception,
  onClose,
}: {
  exception: AdminHoursException;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(event: MouseEvent) {
    // Keep the dialog open until the request finishes, so a failure can show here.
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await sendJson(`/api/admin/hours/exceptions/${exception.id}`, "DELETE");
      await queryClient.invalidateQueries({ queryKey: hoursQueryKey });
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this exception?</AlertDialogTitle>
          <AlertDialogDescription>
            {formatDate(exception.date)} will go back to the weekly schedule.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={pending}>
            {pending ? "Deleting…" : "Delete exception"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
