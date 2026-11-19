import type { Metadata } from "next";
import { Suspense } from "react";

import { AnalyticsDashboard } from "@/components/admin/AnalyticsDashboard";

export const metadata: Metadata = { title: "Analytics" };

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Analytics</h1>
      {/* The range and channel live in the URL, which is only known in the browser. */}
      <Suspense fallback={<p role="status">Loading analytics…</p>}>
        <AnalyticsDashboard />
      </Suspense>
    </div>
  );
}
