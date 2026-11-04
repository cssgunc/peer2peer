"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";

import { useMe } from "@/lib/portal/queries";

// A UX guard only; the admin API routes require the coordinator role themselves.
export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data: me } = useMe();
  const isCoordinator = me?.role === "coordinator";

  useEffect(() => {
    if (me && !isCoordinator) {
      router.replace("/portal");
    }
  }, [me, isCoordinator, router]);

  // Render nothing until the role is known, so admin content never flashes for a responder.
  return isCoordinator ? <>{children}</> : null;
}
