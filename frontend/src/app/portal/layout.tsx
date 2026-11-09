import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PortalShell } from "@/components/portal/PortalShell";

import { Providers } from "./providers";

// No analytics script anywhere under /portal (TDD 4.6.9).
export const metadata: Metadata = {
  title: { default: "Portal", template: "%s | Peer2Peer Portal" },
  robots: { index: false },
};

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <PortalShell>{children}</PortalShell>
    </Providers>
  );
}
