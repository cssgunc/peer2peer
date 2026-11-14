"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ApiError, apiFetch } from "@/lib/api";
import {
  type InboxItem,
  inboxQueryKey,
  useReportOptions,
} from "@/lib/portal/queries";

type ReportFormProps = {
  conversationId: string;
  onSubmitted: () => void;
};

// Mirrors SubmitReportDTO in backend/app/schemas/report.py.
type SubmitReport = {
  topic_ids: string[];
  outcome_id: string;
  confidence: number;
};

export function ReportForm(props: ReportFormProps) {
  // Answers belong to one conversation, including when the parent changes its selection.
  return <ConversationReportForm key={props.conversationId} {...props} />;
}

function ConversationReportForm({
  conversationId,
  onSubmitted,
}: ReportFormProps) {
  const id = useId();
  const queryClient = useQueryClient();
  const options = useReportOptions();
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [outcomeId, setOutcomeId] = useState("");
  const [confidence, setConfidence] = useState("");

  const submission = useMutation({
    retry: false,
    mutationFn: async (report: SubmitReport) => {
      try {
        await apiFetch<void>(
          `/api/portal/conversations/${conversationId}/report`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(report),
          },
        );
      } catch (error) {
        if (
          !(error instanceof ApiError) ||
          error.status !== 409 ||
          error.code !== "report_exists"
        ) {
          throw error;
        }
      }
    },
    onSuccess: () => {
      // Remove immediately, even if refreshing the inbox temporarily fails.
      queryClient.setQueryData<InboxItem[]>(inboxQueryKey, (items) =>
        items?.filter((item) => item.conversation_id !== conversationId),
      );
      void queryClient.invalidateQueries({ queryKey: inboxQueryKey });
      onSubmitted();
    },
  });

  const canSubmit =
    !submission.isPending &&
    !submission.isSuccess &&
    topicIds.length > 0 &&
    topicIds.every((topicId) =>
      options.data?.topics.some((topic) => topic.id === topicId),
    ) &&
    options.data?.outcomes.some((outcome) => outcome.id === outcomeId) &&
    confidence !== "";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    submission.mutate({
      topic_ids: topicIds,
      outcome_id: outcomeId,
      confidence: Number(confidence),
    });
  }

  if (options.isPending) {
    return <p role="status">Loading report options…</p>;
  }

  if (!options.data) {
    return (
      <div className="space-y-3">
        <p role="alert">
          Report options could not be loaded. Please try again.
        </p>
        <Button variant="outline" onClick={() => options.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const unavailable =
    options.data.topics.length === 0 || options.data.outcomes.length === 0;
  const disabled = submission.isPending || submission.isSuccess;

  return (
    <form
      onSubmit={submit}
      aria-labelledby={`${id}-title`}
      aria-busy={submission.isPending}
      className="space-y-6"
    >
      <h2 id={`${id}-title`} className="text-xl font-semibold">
        Post-conversation report
      </h2>
      {unavailable && (
        <p role="alert">
          Report options are unavailable. Please contact a coordinator.
        </p>
      )}
      <fieldset className="space-y-2" aria-describedby={`${id}-topics-help`}>
        <legend className="font-medium">Topics</legend>
        <p id={`${id}-topics-help`} className="text-sm text-muted-foreground">
          Choose at least one topic.
        </p>
        {options.data.topics.map((topic) => (
          <Label
            key={topic.id}
            htmlFor={`${id}-topic-${topic.id}`}
            className="min-h-11"
          >
            <Checkbox
              id={`${id}-topic-${topic.id}`}
              checked={topicIds.includes(topic.id)}
              disabled={disabled}
              onCheckedChange={(checked) =>
                setTopicIds((current) =>
                  checked === true
                    ? [...current, topic.id]
                    : current.filter((topicId) => topicId !== topic.id),
                )
              }
            />
            {topic.label}
          </Label>
        ))}
      </fieldset>
      <fieldset>
        <legend id={`${id}-outcome`} className="mb-2 font-medium">
          Outcome
        </legend>
        <RadioGroup
          aria-labelledby={`${id}-outcome`}
          name={`${id}-outcome`}
          value={outcomeId}
          onValueChange={setOutcomeId}
          disabled={disabled}
          required
        >
          {options.data.outcomes.map((outcome) => (
            <Label
              key={outcome.id}
              htmlFor={`${id}-outcome-${outcome.id}`}
              className="min-h-11"
            >
              <RadioGroupItem
                id={`${id}-outcome-${outcome.id}`}
                value={outcome.id}
              />
              {outcome.label}
            </Label>
          ))}
        </RadioGroup>
      </fieldset>
      <fieldset>
        <legend id={`${id}-confidence`} className="mb-2 font-medium">
          Confidence
        </legend>
        <ToggleGroup
          type="single"
          variant="outline"
          value={confidence}
          onValueChange={setConfidence}
          disabled={disabled}
          aria-labelledby={`${id}-confidence`}
          aria-describedby={`${id}-confidence-help`}
          aria-required="true"
        >
          {[1, 2, 3, 4, 5].map((value) => (
            <ToggleGroupItem
              key={value}
              value={String(value)}
              className="min-h-11 min-w-11"
              aria-label={
                value === 1
                  ? "1 — Not confident"
                  : value === 5
                    ? "5 — Very confident"
                    : String(value)
              }
            >
              {value}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p
          id={`${id}-confidence-help`}
          className="mt-2 text-sm text-muted-foreground"
        >
          1: Not confident · 5: Very confident
        </p>
      </fieldset>
      {submission.isError && (
        <p role="alert" className="text-destructive">
          Your report could not be submitted. Your answers have been kept.
          Please try again.
        </p>
      )}
      <Button type="submit" disabled={!canSubmit} className="min-h-11">
        {submission.isPending ? "Submitting…" : "Submit report"}
      </Button>
    </form>
  );
}
