import type { Metadata } from "next";
import { Suspense } from "react";

import { InboxScreen } from "@/components/portal/InboxScreen";

export const metadata: Metadata = { title: "Inbox" };

export default function Page() {
  return (
    // The selection lives in the URL (?c=), which is only known in the browser.
    <Suspense fallback={<p role="status">Loading inbox…</p>}>
      <InboxScreen />
    </Suspense>
  );
}
