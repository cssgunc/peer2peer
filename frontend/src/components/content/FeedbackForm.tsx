"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiFetch } from "@/lib/api";

const MAX_LENGTH = 2_000;
const COUNTER_THRESHOLD = 1_800;

type SubmissionStatus =
  "idle" | "submitting" | "success" | "rate-limited" | "error";

export default function FeedbackForm() {
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<SubmissionStatus>("idle");
  const isSubmitting = status === "submitting";
  const showCounter = body.length >= COUNTER_THRESHOLD;
  const canSubmit =
    !isSubmitting && body.trim().length > 0 && body.length <= MAX_LENGTH;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setStatus("submitting");
    try {
      await apiFetch<void>("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({ body: body.trim() }),
      });
      setBody("");
      setStatus("success");
    } catch (error) {
      setStatus(
        error instanceof ApiError && error.status === 429
          ? "rate-limited"
          : "error",
      );
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={isSubmitting}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor="feedback-body">Your feedback</Label>
        <Textarea
          id="feedback-body"
          name="body"
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            setStatus("idle");
          }}
          maxLength={MAX_LENGTH}
          rows={6}
          required
          disabled={isSubmitting}
          aria-describedby={`feedback-privacy${showCounter ? " feedback-count" : ""}`}
        />
        {showCounter && (
          <p
            id="feedback-count"
            className="text-right text-sm text-muted-foreground"
          >
            {body.length.toLocaleString("en-US")} /{" "}
            {MAX_LENGTH.toLocaleString("en-US")}
          </p>
        )}
        <p id="feedback-privacy" className="text-sm text-muted-foreground">
          We don&apos;t collect your name, email, or IP address
        </p>
      </div>
      <Button type="submit" disabled={!canSubmit} className="min-h-11">
        {isSubmitting ? "Submitting…" : "Submit"}
      </Button>
      {status === "success" && (
        <p role="status">Thank you for your feedback!</p>
      )}
      {status === "rate-limited" && (
        <p role="alert" className="text-destructive">
          Too many submissions. Try again later.
        </p>
      )}
      {status === "error" && (
        <p role="alert" className="text-destructive">
          Something went wrong. Please try again later.
        </p>
      )}
    </form>
  );
}
