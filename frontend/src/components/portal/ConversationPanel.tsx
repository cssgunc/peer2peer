"use client";

import { Button } from "@/components/ui/button";
import type { InboxItem } from "@/lib/portal/queries";

import { EscalateButton } from "./EscalateButton";
import { ReportForm } from "./ReportForm";

type ConversationPanelProps = {
  item: InboxItem;
  /** Mobile only: back to the inbox list. */
  onBack: () => void;
  onReportSubmitted: () => void;
};

/** The right side of the inbox screen: the selected conversation. */
export function ConversationPanel({
  item,
  onBack,
  onReportSubmitted,
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{item.label}</h2>
        {/* TODO(#137): move into the ConversationView header. */}
        <EscalateButton
          conversationId={item.conversation_id}
          status={item.status}
        />
      </div>
      {ended ? (
        <>
          <p>This conversation has ended.</p>
          <ReportForm
            conversationId={item.conversation_id}
            onSubmitted={onReportSubmitted}
          />
        </>
      ) : (
        // TODO(#137): the conversation view (messages and composer) goes here.
        <p>This conversation is {item.status}.</p>
      )}
    </div>
  );
}
