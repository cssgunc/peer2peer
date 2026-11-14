"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import Markdown from "@/components/content/Markdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import {
  escalatedQueryKey,
  type PortalConversation,
  useGuide,
} from "@/lib/portal/queries";

type EscalateButtonProps = {
  conversationId: string;
  status: PortalConversation["status"];
};

export function EscalateButton({
  conversationId,
  status,
}: EscalateButtonProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  // Client-side only until the conversation API says whether it was escalated.
  const { data: recorded } = useQuery({
    queryKey: escalatedQueryKey(conversationId),
    queryFn: () => false,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const escalation = useMutation({
    retry: false,
    mutationFn: () =>
      apiFetch<{ id: string }>(
        `/api/portal/conversations/${conversationId}/escalate`,
        { method: "POST" },
      ),
    onSuccess: () => {
      queryClient.setQueryData(escalatedQueryKey(conversationId), true);
      setOpen(false);
      toast.success("Escalation recorded.");
    },
    onError: () => {
      toast.error("Couldn't record the escalation. Try again.");
    },
  });

  if (status !== "active") return null;

  if (recorded) {
    return (
      <p role="status" className="text-sm font-medium">
        Escalation recorded
      </p>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive">Escalate</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Escalate this conversation</DialogTitle>
          <DialogDescription>
            Follow the escalation protocol, then record the escalation.
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto">
          <EscalationProtocol />
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={escalation.isPending}
            onClick={() => escalation.mutate()}
          >
            {escalation.isPending ? "Recording…" : "Record escalation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// TODO(escalation-protocol): show only the escalation section once the CAPS protocol is final.
function EscalationProtocol() {
  const { data: guide, isPending, isError, refetch } = useGuide();

  if (isPending) {
    return (
      <p role="status" className="text-muted-foreground">
        Loading protocol…
      </p>
    );
  }
  if (isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert">The protocol could not be loaded.</p>
        <Button variant="outline" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  return <Markdown>{guide.body_md}</Markdown>;
}
