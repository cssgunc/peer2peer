"use client";

import { Button } from "@/components/ui/button";
import type { InboxItem } from "@/lib/portal/queries";

import { ConversationView } from "./ConversationView";
import { EscalateButton } from "./EscalateButton";
import { ReportForm } from "./ReportForm";

type ConversationPanelProps = {
  item: InboxItem;
  /** Mobile only: back to the inbox list. */
  onBack: () => void;
  onReportSubmitted: () => void;
  /** The conversation 404'd, for example because it went back to the queue. */
  onUnavailable: () => void;
};

/** The right side of the inbox screen: the selected conversation. */
export function ConversationPanel({
  item,
  onBack,
  onReportSubmitted,
  onUnavailable,
}: ConversationPanelProps) {
  const ended = item.status === "closed" || item.needs_report;
  return (
    <div className="space-y-4">
      <Button
        variant="ghost"
        onClick={onBack}
        className="-ml-3 min-h-11 md:hidden"
      >
        ← Back to inbox
      </Button>
      {ended ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">{item.label}</h2>
            <EscalateButton
              conversationId={item.conversation_id}
              status={item.status}
            />
          </div>
          <p>This conversation has ended.</p>
          <ReportForm
            conversationId={item.conversation_id}
            onSubmitted={onReportSubmitted}
          />
        </>
      ) : (
        <div className="h-[70vh] min-h-96 rounded-lg border border-border">
          <ConversationView
            id={item.conversation_id}
            onUnavailable={onUnavailable}
            headerActions={
              <EscalateButton
                conversationId={item.conversation_id}
                status={item.status}
              />
            }
            reportSlot={
              <ReportForm
                conversationId={item.conversation_id}
                onSubmitted={onReportSubmitted}
              />
            }
          />
        </div>
      )}
    </div>
  );
}
