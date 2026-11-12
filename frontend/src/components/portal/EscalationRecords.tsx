"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type Escalation,
  useEscalation,
  useEscalations,
} from "@/lib/portal/queries";

const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

// TODO(escalation-protocol): status names may change with the CAPS protocol.
const statusLabels: Record<Escalation["status"], string> = {
  open: "Open",
  handed_off: "Handed off",
  closed: "Closed",
};

export function EscalationRecords() {
  const { data: escalations, isPending, isError, refetch } = useEscalations();
  const [selected, setSelected] = useState<Escalation | null>(null);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Escalations</h1>
      {isPending ? (
        <p role="status">Loading escalations…</p>
      ) : isError ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert">Escalations could not be loaded. Please try again.</p>
          <Button variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : escalations.length === 0 ? (
        <p className="text-muted-foreground">No escalations recorded.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Created</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Conversation</TableHead>
              <TableHead>Recorded by</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {escalations.map((escalation) => (
              <TableRow key={escalation.id}>
                <TableCell>
                  {dateTime.format(new Date(escalation.created_at))}
                </TableCell>
                <TableCell>{statusLabels[escalation.status]}</TableCell>
                <TableCell>{escalation.conversation_label}</TableCell>
                <TableCell>{escalation.created_by_display_name}</TableCell>
                <TableCell>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Open escalation for ${escalation.conversation_label}`}
                    onClick={() => setSelected(escalation)}
                  >
                    Open
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        {selected && (
          // Keyed so each opening asks for confirmation again.
          <EscalationDetailDialog key={selected.id} escalation={selected} />
        )}
      </Dialog>
    </section>
  );
}

function EscalationDetailDialog({ escalation }: { escalation: Escalation }) {
  // Every detail read is audited, so fetch only after the coordinator confirms.
  const [confirmed, setConfirmed] = useState(false);
  const detail = useEscalation(escalation.id, confirmed);

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Escalation: {escalation.conversation_label}</DialogTitle>
        <DialogDescription>Opening this record is logged.</DialogDescription>
      </DialogHeader>
      {!confirmed ? (
        <DialogFooter>
          <Button onClick={() => setConfirmed(true)}>View record</Button>
        </DialogFooter>
      ) : detail.isPending ? (
        <p role="status">Loading record…</p>
      ) : detail.isError ? (
        <p role="alert">The record could not be loaded.</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="font-medium">Created</dt>
          <dd>{dateTime.format(new Date(detail.data.created_at))}</dd>
          <dt className="font-medium">Status</dt>
          <dd>{statusLabels[detail.data.status]}</dd>
          <dt className="font-medium">Recorded by</dt>
          <dd>{detail.data.created_by_display_name}</dd>
          {/* TODO(escalation-protocol): lay out the payload once its fields are final. */}
          {Object.entries(detail.data.payload ?? {}).map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="font-medium">{key}</dt>
              <dd className="break-all">
                {typeof value === "string" ? value : JSON.stringify(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </DialogContent>
  );
}
