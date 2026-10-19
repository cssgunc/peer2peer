"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { MAX_MESSAGE_LENGTH } from "./chatReducer";

/** The counter appears once this many characters have been typed. */
const COUNTER_THRESHOLD = 1_800;

export default function Composer({
  onSend,
  disabled = false,
  placeholder = "Message",
}: {
  onSend: (body: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [body, setBody] = useState("");
  const canSend = !disabled && body.trim().length > 0;

  function send() {
    if (!canSend) return;
    onSend(body.trim());
    setBody("");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    send();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 border-t border-border p-3"
    >
      <div className="flex flex-1 flex-col gap-1">
        <label htmlFor="chat-composer" className="sr-only">
          Message
        </label>
        <Textarea
          id="chat-composer"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={MAX_MESSAGE_LENGTH}
          disabled={disabled}
          rows={1}
          className="max-h-40"
          placeholder={placeholder}
          aria-describedby={
            body.length >= COUNTER_THRESHOLD ? "chat-composer-count" : undefined
          }
        />
        {body.length >= COUNTER_THRESHOLD && (
          <span
            id="chat-composer-count"
            className="self-end text-xs text-muted-foreground"
          >
            {body.length.toLocaleString()} /{" "}
            {MAX_MESSAGE_LENGTH.toLocaleString()}
          </span>
        )}
      </div>
      <Button type="submit" size="lg" disabled={!canSend}>
        Send
      </Button>
    </form>
  );
}
