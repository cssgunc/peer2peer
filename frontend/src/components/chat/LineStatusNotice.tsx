"use client";

import { useLineStatus } from "@/lib/useLineStatus";

/** Whether responders are online, shown above the chat on the Text Us page. */
export default function LineStatusNotice() {
  const { data, status } = useLineStatus();

  let message = "We're checking the line's availability.";
  if (status === "error") {
    message = "We can't confirm the line's availability right now.";
  } else if (data && !data.line_launched) {
    message = "Peer2Peer hasn't opened yet.";
  } else if (data?.is_online) {
    message = "Responders are online now.";
  } else if (data) {
    message = "We're offline right now.";
  }

  return (
    <p role="status" aria-atomic="true" className="text-sm">
      {message}
    </p>
  );
}
