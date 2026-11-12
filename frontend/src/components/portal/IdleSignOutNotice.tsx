"use client";

import { useSearchParams } from "next/navigation";

import { IDLE_SIGN_OUT_MESSAGE } from "@/lib/portal/constants";

/** Explains an idle sign-out on the sign-in page (/portal/sign-in?reason=idle). */
export function IdleSignOutNotice() {
  const reason = useSearchParams().get("reason");
  if (reason !== "idle") return null;

  return (
    <p role="status" className="rounded-md border bg-muted p-3 text-sm">
      {IDLE_SIGN_OUT_MESSAGE}
    </p>
  );
}
